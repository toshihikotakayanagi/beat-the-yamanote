// OpenStreetMap から区間の道路・建物・信号と、背景（公園・水域・線路）を取得し、ゲーム用 JSON に変換する。
//
// 使い方:
//   node tools/fetch-osm.mjs shibuya-harajuku            # キャッシュがあればそれを使う
//   node tools/fetch-osm.mjs shibuya-harajuku --refresh  # Overpass から取り直す
//   node tools/fetch-osm.mjs all                         # stations.json の全区間
//
// 取得結果は tools/.cache/ に保存し、変換だけやり直すときは再取得しない
// （Overpass は無料の共用サーバーなので負荷をかけない）。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Overpass のサーバー。混雑で失敗したら次のサーバーで取り直す（どれも overpass-api.de の同じデータ）
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter'];
const FETCH_INTERVAL_MS = 10000; // 続けて取得するときの間隔（サーバーへの配慮）
const FETCH_TIMEOUT_MS = 180000; // 返事がないときにあきらめるまで
const RETRY_LIMIT = 12; // 混雑で失敗したときに試す回数
const RETRY_WAIT_MS = 60000;

// 駅の代表点（駅舎の中心付近）と区間の一覧は data/stations.json で管理する
const { stations: STATIONS, sections } = JSON.parse(await readFile(join(ROOT, 'data', 'stations.json'), 'utf8'));
const SECTIONS = Object.fromEntries(sections.map((s) => [s.id, s]));

const MARGIN_M = 400; // 2駅を囲む四角の余白
const GOAL_RADIUS_M = 25;
const M_PER_DEG_LAT = 110540;

// highway 種別ごとの道幅 (m)。ここにない種別は取り込まない。
const ROAD_WIDTH = {
  trunk: 16,
  trunk_link: 8,
  primary: 14,
  primary_link: 8,
  secondary: 14,
  secondary_link: 8,
  tertiary: 10,
  tertiary_link: 6,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  service: 4,
  pedestrian: 6,
  footway: 3,
  cycleway: 3,
  path: 3,
  track: 3,
};

const round = (v) => Math.round(v * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 区間の座標系：2駅の中点を原点とするメートル座標（x は東、y は南が正）
function sectionFrame(section) {
  const from = STATIONS[section.from];
  const to = STATIONS[section.to];
  const lat0 = (from.lat + to.lat) / 2;
  const lon0 = (from.lon + to.lon) / 2;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = (lat, lon) => [round((lon - lon0) * mPerDegLon), round(-(lat - lat0) * M_PER_DEG_LAT)];
  const south = Math.min(from.lat, to.lat) - MARGIN_M / M_PER_DEG_LAT;
  const north = Math.max(from.lat, to.lat) + MARGIN_M / M_PER_DEG_LAT;
  const west = Math.min(from.lon, to.lon) - MARGIN_M / mPerDegLon;
  const east = Math.max(from.lon, to.lon) + MARGIN_M / mPerDegLon;
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(',');
  return { from, to, lat0, lon0, toXY, south, north, west, east, bbox };
}

// 道路・建物・信号（走る地図そのもの）
const roadsQuery = (bbox) => `[out:json][timeout:90];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  node["highway"="traffic_signals"](${bbox});
);
out geom;`;

// ランドマーク（地図に名前を出す目印）。位置は外枠（bb）から中心を求める
const landmarksQuery = (bbox) => `[out:json][timeout:60];
(
  nwr["tourism"~"^(attraction|museum|gallery|zoo|theme_park|viewpoint|artwork)$"]["name"](${bbox});
  nwr["historic"]["name"](${bbox});
  nwr["shop"~"^(department_store|mall)$"]["name"](${bbox});
  nwr["leisure"~"^(park|stadium)$"]["name"](${bbox});
  nwr["amenity"~"^(place_of_worship|university)$"]["name"](${bbox});
  wr["building"]["name"]["building:levels"](${bbox});
);
out tags bb;`;

// 背景（見た目だけで、走れる場所や基準タイムには影響しない）：公園・緑地・水域の面と、川・線路の線。
// 大きな公園や堀はリレーション（複数の線をつないだ面、穴あり）なので wr で取る
const areasQuery = (bbox) => `[out:json][timeout:120];
(
  wr["leisure"~"^(park|garden)$"](${bbox});
  wr["landuse"~"^(grass|forest|cemetery|recreation_ground|village_green|meadow)$"](${bbox});
  wr["natural"~"^(wood|water|scrub|grassland)$"](${bbox});
  wr["waterway"="riverbank"](${bbox});
  way["waterway"~"^(river|canal|stream)$"](${bbox});
  way["railway"~"^(rail|light_rail|monorail|narrow_gauge)$"](${bbox});
);
out geom;`;

// 自転車で入れない場所（OSM の way の番号）。この中に完全に入っている道は取り込まない。
// 明治神宮の境内は自転車の乗り入れが禁止されている（森の中の参道を抜ける近道ができていた）
const NO_BIKE_AREAS = [{ id: 469908925, name: '明治神宮' }];
const noBikeQuery = () => `[out:json][timeout:60];
way(id:${NO_BIKE_AREAS.map((a) => a.id).join(',')});
out geom;`;

// 木（見た目だけ）：1 本ずつの木（点）と並木（線）
const treesQuery = (bbox) => `[out:json][timeout:90];
(
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
);
out geom;`;

// 道ばたの物（見た目だけ）：バス停と自動販売機
const streetQuery = (bbox) => `[out:json][timeout:90];
(
  node["highway"="bus_stop"](${bbox});
  node["amenity"="vending_machine"](${bbox});
);
out;`;

const QUERIES = { roads: roadsQuery, landmarks: landmarksQuery, areas: areasQuery, nobike: noBikeQuery, trees: treesQuery, street: streetQuery };
const KIND_NAMES = { roads: '道路', landmarks: 'ランドマーク', areas: '公園・水域・線路', nobike: '自転車で入れない場所', trees: '木', street: 'バス停・自動販売機' };

// kind：'roads'（道路など）、'landmarks'、'areas'。取得結果は種類ごとにキャッシュする
async function loadOsm(id, kind, bbox, refresh) {
  const cachePath = join(ROOT, 'tools', '.cache', kind === 'roads' ? `${id}.osm.json` : `${id}.${kind}.osm.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      console.log(`キャッシュを使用: ${cachePath}`);
      return cached;
    } catch {
      // キャッシュがなければ取得する
    }
  }
  const query = QUERIES[kind](bbox);
  let osm = null;
  for (let attempt = 1; !osm; attempt++) {
    // 続けて取得するときは間をあける（サーバーへの配慮）
    const wait = lastFetchAt + FETCH_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
    const url = OVERPASS_URLS[(attempt - 1) % OVERPASS_URLS.length];
    console.log(`Overpass から${KIND_NAMES[kind]}を取得中 (${new URL(url).host}, bbox ${bbox}) ...`);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'yamanote-race-game/0.1 (hobby project)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      res = { ok: false, status: `つながらない: ${e.name}`, busy: true };
    }
    // 混雑（429：回数制限、504：タイムアウト）やつながらないときは、待って次のサーバーで取り直す
    if ((res.busy || res.status === 429 || res.status === 504) && attempt < RETRY_LIMIT) {
      console.log(`  混雑しています（${res.status}）。${RETRY_WAIT_MS / 1000} 秒後に取り直します（${attempt}/${RETRY_LIMIT}）`);
      await sleep(RETRY_WAIT_MS);
      continue;
    }
    if (res.busy) throw new Error(`Overpass エラー: ${res.status}`);
    if (!res.ok) throw new Error(`Overpass エラー: ${res.status} ${(await res.text()).slice(0, 300)}`);
    osm = await res.json();
  }
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(osm));
  return osm;
}
let lastFetchAt = 0;

// ランドマークの重要度（大きいほど優先して表示）と種類。表示しないものは null。
// 有名かどうかは Wikipedia / Wikidata へのリンクの有無で判断する
// （リンクのない小さな記念碑やカラオケ店、タワーマンションが並ぶのを防ぐ）
function landmarkRank(tags, sizeM) {
  const notable = Boolean(tags.wikidata || tags.wikipedia);
  const levels = parseInt(tags['building:levels'], 10) || 0;
  const residential = /^(apartments|residential|house)$/.test(tags.building) || tags['building:use'] === 'residential';
  if (/^(attraction|museum|zoo|theme_park)$/.test(tags.tourism)) return { score: notable ? 100 : 40, kind: 'sight' };
  if (tags.tourism === 'artwork' || tags.historic) return notable ? { score: 90, kind: 'sight' } : null;
  if (/^(department_store|mall)$/.test(tags.shop)) return { score: notable ? 80 : 55, kind: 'shop' };
  if (tags.leisure === 'stadium' || tags.amenity === 'university') return { score: notable ? 75 : 45, kind: 'building' };
  if (tags.building && levels >= 20 && (!residential || notable)) {
    return { score: (notable ? 70 : 40) + Math.min(levels, 60) / 6, kind: 'building' };
  }
  if (/^(gallery|viewpoint)$/.test(tags.tourism)) return notable ? { score: 60, kind: 'sight' } : null;
  // 公園と神社・寺は小さいものが多いので、大きいほど優先（sizeM は外枠の対角線）
  if (tags.leisure === 'park' && (sizeM >= 80 || notable)) {
    return { score: 30 + Math.min(sizeM / 20, 30) + (notable ? 30 : 0), kind: 'park' };
  }
  if (tags.amenity === 'place_of_worship' && (sizeM >= 30 || notable)) {
    return { score: 25 + Math.min(sizeM / 10, 30) + (notable ? 30 : 0), kind: 'worship' };
  }
  return null;
}

const LANDMARK_MIN_GAP_M = 60; // これより近い目印は重要度の低い方を出さない
const LANDMARK_MAX = 40; // 1 区間あたりの上限

function selectLandmarks(osm, frame) {
  const { toXY } = frame;
  const inFrame = (lat, lon) => lat >= frame.south && lat <= frame.north && lon >= frame.west && lon <= frame.east;
  const candidates = [];
  // 駅は必ず出す
  for (const st of Object.values(STATIONS)) {
    if (!inFrame(st.lat, st.lon)) continue;
    const [x, y] = toXY(st.lat, st.lon);
    candidates.push({ n: `${st.name}駅`, x, y, k: 'station', score: 1000 });
  }
  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    if (!tags.name) continue;
    let lat, lon, sizeM = 0;
    if (el.bounds) {
      const b = el.bounds;
      lat = (b.minlat + b.maxlat) / 2;
      lon = (b.minlon + b.maxlon) / 2;
      const [x0, y0] = toXY(b.minlat, b.minlon);
      const [x1, y1] = toXY(b.maxlat, b.maxlon);
      sizeM = Math.hypot(x1 - x0, y1 - y0);
    } else if (el.lat != null) {
      ({ lat, lon } = el);
    } else continue;
    if (!inFrame(lat, lon)) continue;
    const rank = landmarkRank(tags, sizeM);
    if (!rank) continue;
    const [x, y] = toXY(lat, lon);
    candidates.push({ n: tags.name, x, y, k: rank.kind, score: rank.score });
  }
  // 重要度の高い順に、近くにもう目印がなければ採用する
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= LANDMARK_MAX) break;
    if (picked.some((p) => p.n === c.n || Math.hypot(p.x - c.x, p.y - c.y) < LANDMARK_MIN_GAP_M)) continue;
    picked.push(c);
  }
  return picked.map(({ n, x, y, k }) => ({ n, x, y, k }));
}

// ---- 背景（公園・水域・線路） ----

// 面の種類。描く順（緑 → 水）は src/map.js が決める
function areaKind(tags) {
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water';
  if (tags.landuse === 'cemetery') return 'cemetery';
  if (tags.landuse === 'forest' || tags.natural === 'wood') return 'wood';
  if (/^(park|garden)$/.test(tags.leisure)) return 'park';
  if (/^(grass|recreation_ground|village_green|meadow)$/.test(tags.landuse) || /^(scrub|grassland)$/.test(tags.natural)) return 'grass';
  return null;
}

const SHORT_RAIL_TUNNEL_M = 150;
const lowLines = new WeakSet(); // 切り通し・地面より低い線路 // 道路橋の下などをくぐる短い線路のトンネル（目白駅・目黒駅の山手線）は描く

// OSM の印（layer・bridge）から決まる線路の高さを、駅の中でそろえるために変える線路（OSM の way の番号 → true：高い所、
// false：地面）。同じホームの両側の線路が、片方だけ高架になっていると、ホームが段違いになる。
// 代々木駅：山手線は layer=1（高い所）、並ぶ中央・総武線は印がなく地面になっていた。実物は 2・3 番線で山手線と総武線が
// 同じホームの両側に止まるので、駅を通る中央・総武線の緩行線も高い所にする（駅の南の端の短い区間と、北で山手線をまたぐ
// 総武線の橋は、もともと高い所なので、途中で上がり下がりしなくなる）。代々木に止まらない快速線は、新宿の南口の
// 歩行者デッキ（高さ 5.5m）の下まで続くので地面のままにする
// 日暮里駅〜鶯谷駅〜上野駅の手前：山手線の外回りと京浜東北線の 2 本だけが layer=1 になっていた（真下を東北新幹線の
// トンネル（layer=-4）が通るため）。実物は地面の高さを走り、山手線の内回りは印がないので、地面にそろえる
const FORCED_LINE_LEVELS = new Map([
  [144655506, true], // 中央緩行線（西行き）
  [144655497, true], // 中央緩行線（東行き）
  [834998691, false], // 山手線（日暮里駅）
  [776865650, false], // 山手線（日暮里〜上野）
  [834998683, false], // 京浜東北線（日暮里駅）
  [834998687, false], // 京浜東北線（日暮里駅）
  [834998684, false], // 京浜東北線（日暮里〜上野）
  [211148511, false], // 京浜東北線（日暮里〜上野）
  // 大塚駅：山手線の内回りは駅の西 約 160m から東の都電をまたぐ橋まで高い所だが、外回りは駅の西半分が地面で、
  // 外回りと貨物線は東の 2 つの橋のあいだ（約 45m）も地面だった。4 本とも、駅の西 約 190m から東の橋まで高い所にそろえる
  [366845924, { level: true, from: 38 }], // 山手線の外回り（点 38〜。池袋から続く長い線の駅の側）
  [144131737, { level: true, upTo: 1 }], // 山手線の内回り（点 0〜1。駅の西 約 160〜190m）
  [184543323, { level: true, upTo: 3 }], // 山手貨物線（点 0〜3）
  [184543314, true], // 山手線の外回り（東の 2 つの橋のあいだ）
  [184543317, true], // 山手貨物線（東の 2 つの橋のあいだ）
  [184543320, true], // 山手貨物線（東の 2 つの橋のあいだ）
  // 目白駅：山手線だけが、駅の南北の道路をまたぐ 2 つの橋（高田馬場側・池袋側）のあいだも layer=1 になっていて、並ぶ山手
  // 貨物線は地面だった（駅の中は駅ビルの下をくぐる地面の線）。実物は掘割の中を走るので、橋のあいだは地面にそろえる
  [709822635, false], // 山手線（駅の南）
  [155308624, false], // 山手線（駅の南）
  [709822632, false], // 山手線（駅の北）
  [155308621, false], // 山手線（駅の北）
]);

// 線の種類と幅 m。地下（トンネル・暗渠）は描かない。lengthM：その線の長さ
function lineKind(tags, lengthM) {
  if (tags.railway) {
    // 線路は本物のトンネルと地下だけ外す。layer が負でも切り通し（目黒駅付近の山手線など）は地上から見え、
    // 駅ビルの下をくぐる線路（tunnel=building_passage）も駅の中でつながっているので残す
    const tunnel = tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage' && lengthM > SHORT_RAIL_TUNNEL_M;
    const yamanote = /山手線/.test(tags.name ?? '');
    // 切り通し・地面より低い線路（道路の橋の高さを決めるときに使う。データには入れない）
    const low = Number(tags.layer) < 0 || (tags.cutting && tags.cutting !== 'no');
    // 山手線のトンネル（目黒駅の手前の約270mなど）は描かないが、電車が地図の上を走る道筋に使うので u: 1 を付けて残す
    if (tunnel || tags.location === 'underground') return yamanote ? { k: 'yamanote', w: 3, u: 1 } : null;
    // 山手線は路線の色で目立たせる（名前に「山手線」を含む線路）。
    // e: 1 は高い所を走る線路（橋・高架・土手）。3D版で持ち上げて描き、電車もその高さを走る
    const line = { k: yamanote ? 'yamanote' : 'rail', w: 3 };
    const elevated = (tags.bridge && tags.bridge !== 'no') || Number(tags.layer) > 0 || tags.embankment === 'yes' || tags.viaduct === 'yes';
    if (elevated && !line.u) line.e = 1;
    if (low) lowLines.add(line);
    return line;
  }
  // 川は暗渠（tunnel=culvert など）と地下を外す
  if ((tags.tunnel && tags.tunnel !== 'no') || Number(tags.layer) < 0 || tags.location === 'underground') return null;
  if (tags.waterway === 'river' || tags.waterway === 'canal') return { k: 'river', w: 8 };
  if (tags.waterway === 'stream') return { k: 'river', w: 3 };
  return null;
}

// 点列 [x0, y0, x1, y1, ...] を間引く（ダグラス・ポーカー法。tol m 以内のずれは省く）
function simplify(p, tol) {
  const n = p.length / 2;
  if (n <= 2) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1, farD = tol;
    for (let i = a + 1; i < b; i++) {
      // 両端が同じ点（閉じた輪）のときは、その点からの距離
      const d = len < 1e-6
        ? Math.hypot(p[2 * i] - ax, p[2 * i + 1] - ay)
        : Math.abs((bx - ax) * (ay - p[2 * i + 1]) - (ax - p[2 * i]) * (by - ay)) / len;
      if (d > farD) (farD = d), (far = i);
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

// 閉じた輪 [x0, y0, ...] を四角の範囲で切り取る（サザーランド・ホジマン法）
function clipRing(ring, box) {
  const inside = [
    (x) => x >= box.minX,
    (x) => x <= box.maxX,
    (x, y) => y >= box.minY,
    (x, y) => y <= box.maxY,
  ];
  const cross = [
    (ax, ay, bx, by) => [box.minX, ay + ((by - ay) * (box.minX - ax)) / (bx - ax)],
    (ax, ay, bx, by) => [box.maxX, ay + ((by - ay) * (box.maxX - ax)) / (bx - ax)],
    (ax, ay, bx, by) => [ax + ((bx - ax) * (box.minY - ay)) / (by - ay), box.minY],
    (ax, ay, bx, by) => [ax + ((bx - ax) * (box.maxY - ay)) / (by - ay), box.maxY],
  ];
  let pts = ring;
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const out = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const ax = pts[2 * j], ay = pts[2 * j + 1];
      const bx = pts[2 * i], by = pts[2 * i + 1];
      const ain = inside[e](ax, ay), bin = inside[e](bx, by);
      if (bin) {
        if (!ain) out.push(...cross[e](ax, ay, bx, by));
        out.push(bx, by);
      } else if (ain) out.push(...cross[e](ax, ay, bx, by));
    }
    pts = out;
  }
  return pts.map(round);
}

// リレーションの部品の線（端どうしがつながる）をつないで閉じた輪にする。閉じられなかった線は捨てる。
// 点は [lat, lon] の組
function joinRings(lines) {
  const rings = [];
  const open = lines.map((l) => l.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (open.length) {
    let cur = open.pop();
    for (let grew = true; grew && !same(cur[0], cur.at(-1)); ) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const l = open[i];
        if (same(cur.at(-1), l[0])) cur = cur.concat(l.slice(1));
        else if (same(cur.at(-1), l.at(-1))) cur = cur.concat(l.slice(0, -1).reverse());
        else if (same(cur[0], l.at(-1))) cur = l.concat(cur.slice(1));
        else if (same(cur[0], l[0])) cur = l.slice().reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur.at(-1))) rings.push(cur);
  }
  return rings;
}

const AREA_MIN_M2 = 150; // これより小さい面（植え込みなど）は描かない
const SIMPLIFY_M = 1; // 背景の形を間引く許容誤差 m

function ringArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1]);
  return Math.abs(a / 2);
}

// 背景の面 areas: [{ k, r: [輪, ...] }]（輪は偶奇規則で塗る。穴も同じ配列に入る）と
// 線 lines: [{ k, w, p }] を作る
function convertAreas(osm, frame, bounds) {
  const { toXY } = frame;
  const box = { minX: bounds.minX - 20, minY: bounds.minY - 20, maxX: bounds.maxX + 20, maxY: bounds.maxY + 20 };
  const areas = [];
  const lines = [];
  const latlon = (geom) => geom.map((g) => [g.lat, g.lon]);
  const flat = (ring) => ring.flatMap(([lat, lon]) => toXY(lat, lon));
  const addArea = (k, rings) => {
    const r = [];
    for (const ring of rings) {
      const pts = clipRing(simplify(flat(ring), SIMPLIFY_M), box);
      if (pts.length >= 6 && ringArea(pts) >= AREA_MIN_M2) r.push(pts);
    }
    if (r.length) areas.push({ k, r });
  };
  const inBox = (p) => {
    for (let i = 0; i < p.length; i += 2) if (p[i] >= box.minX && p[i] <= box.maxX && p[i + 1] >= box.minY && p[i + 1] <= box.maxY) return true;
    return false;
  };
  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'way' && el.geometry) {
      const geom = latlon(el.geometry);
      const closed = geom.length >= 4 && geom[0][0] === geom.at(-1)[0] && geom[0][1] === geom.at(-1)[1];
      const area = areaKind(tags);
      if (area && closed) {
        addArea(area, [geom]);
        continue;
      }
      const pts = flat(geom);
      const line = lineKind(tags, polylineLength(pts));
      if (line) {
        // 高さを変える線路は、変える点の範囲（from〜upTo）だけを分けて高さを変える
        const pieces = [[line, pts]];
        const forced = FORCED_LINE_LEVELS.get(el.id);
        if (forced != null) {
          const f = typeof forced === 'boolean' ? { level: forced } : forced;
          const n = pts.length / 2, a = f.from ?? 0, b = f.upTo ?? n - 1;
          const leveled = { ...line };
          if (f.level) leveled.e = 1;
          else delete leveled.e;
          pieces.length = 0;
          if (a > 0) pieces.push([line, pts.slice(0, (a + 1) * 2)]);
          pieces.push([leveled, pts.slice(a * 2, (b + 1) * 2)]);
          if (b < n - 1) pieces.push([line, pts.slice(b * 2)]);
        }
        for (const [l, lp] of pieces) {
          const p = simplify(lp, SIMPLIFY_M);
          if (p.length >= 4 && inBox(p)) lines.push({ ...l, p });
        }
      }
    } else if (el.type === 'relation' && el.members && (tags.type === 'multipolygon' || !tags.type)) {
      const area = areaKind(tags);
      if (!area) continue;
      const parts = el.members.filter((m) => m.type === 'way' && m.geometry?.length >= 2 && m.geometry.every(Boolean));
      addArea(area, joinRings(parts.map((m) => latlon(m.geometry))));
    }
  }
  return { areas, lines };
}

// 線路の下をくぐる短いガード下とみなすトンネルの長さの上限 m。
// これより長いもの（六本木通り 96m、日比谷地下道 409m など）は本物の地下道・アンダーパスなので外す
const SHORT_UNDERPASS_M = 80;
const PATH_TYPES = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track']);

// 座標列 [x0, y0, x1, y1, ...]（m）の長さ
function polylineLength(p) {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return len;
}

// lengthM：その道の長さ（短いガード下の判定に使う）
function isRideable(tags, lengthM) {
  if (!(tags.highway in ROAD_WIDTH)) return false;
  // 屋内（indoor=yes のほか indoor=footway / highway などもある）
  if (tags.indoor && tags.indoor !== 'no') return false;
  // 地下は扱わない。ただし次の 2 つは地上の道としてつなぐ
  //   ・建物の下をくぐる通路（tunnel=building_passage）
  //   ・線路の下をくぐる短いガード下：車道で、長さ SHORT_UNDERPASS_M 以下、深さは layer -1 まで。
  //     これがないと線路を渡れる場所が減り、新橋→浜松町や品川→大崎が大回りになる。
  //     歩行者用の地下道は入れない（大通りを信号なしで渡れる抜け道になるため）
  const tunnel = tags.tunnel && tags.tunnel !== 'no';
  const shortUnderpass =
    tunnel && !PATH_TYPES.has(tags.highway) && lengthM <= SHORT_UNDERPASS_M && (Number(tags.layer) || -1) >= -1;
  if (tunnel && tags.tunnel !== 'building_passage' && !shortUnderpass) return false;
  if (!shortUnderpass && (Number(tags.layer) < 0 || (tags.level ?? '').startsWith('-'))) return false;
  // 駅のホーム（タグがなく「JR新宿駅;1階;1番線」のような名前だけのものもある）
  if (tags.railway === 'platform' || tags.public_transport === 'platform' || /番線/.test(tags.name ?? '')) return false;
  // 名前が「〜駅」の歩道は駅の構内（目白駅には線路沿いの約 230m の「目白駅」という通路がある）。
  // 「駅前通り」のような道路は「駅」で終わらないので残る
  // 駅舎の中の通路は「JR秋葉原駅;3階」「JR秋葉原駅(改札外);1階;電気街北口」のように
  // 「駅;」「改札」「〜階」を含む名前が多い（地下鉄の出入口の短い歩道も外れるが、走る道には影響しない）
  if (['footway', 'path', 'pedestrian'].includes(tags.highway) && /駅$|駅;|改札|\d階/.test(tags.name ?? '')) return false;
  if (tags.area === 'yes' && tags.highway !== 'pedestrian') return false;
  if (tags.motorroad === 'yes') return false; // 自動車専用道路
  if (tags.access === 'private' || tags.access === 'no') return false;
  return true;
}

function oneway(tags) {
  if (tags.oneway === 'yes' || tags.oneway === '1') return 1;
  if (tags.oneway === '-1') return -1;
  return 0;
}

const STATION_SLACK_M = 60; // スタート・ゴールの候補にする範囲（駅にいちばん近い点からの距離）
const STATION_MAX_CANDIDATES = 150;

// source から各点までの最短コスト（adj: 点 → [[隣の点, コスト], ...]）。二分ヒープを使うダイクストラ法
function shortestTimes(adj, source) {
  const dist = new Map([[source, 0]]);
  const heap = [[0, source]];
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist.get(u)) continue;
    for (const [v, cost] of adj.get(u) ?? []) {
      const nd = d + cost;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        push([nd, v]);
      }
    }
  }
  return dist;
}

// スタートからゴールまで、一方通行を守って行ける最短距離 m（行けなければ null）
function legalRouteLength(roads, start, goal) {
  const key = (x, y) => `${x},${y}`;
  const adj = new Map();
  const add = (a, b, l) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push([b, l]);
  };
  for (const r of roads) {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const a = key(r.p[i], r.p[i + 1]), b = key(r.p[i + 2], r.p[i + 3]);
      const l = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
      if (r.o !== -1) add(a, b, l);
      if (r.o !== 1) add(b, a, l);
    }
  }
  const s = key(start.x, start.y), g = key(goal.x, goal.y);
  const dist = new Map([[s, 0]]);
  const queue = [[0, s]];
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
    const [du, u] = queue.splice(bi, 1)[0];
    if (u === g) return du;
    if (du > dist.get(u)) continue;
    for (const [v, l] of adj.get(u) ?? []) {
      const nd = du + l;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        queue.push([nd, v]);
      }
    }
  }
  return null;
}

// 建物の高さ m（3D版で使う）。height タグ、なければ階数 × 3.2m。分からなければ 0（描く側で決める）
function buildingHeight(tags) {
  const h = parseFloat(tags.height);
  if (h > 0) return Math.round(h);
  const levels = parseFloat(tags['building:levels']);
  if (levels > 0) return Math.round(levels * 3.2 + (parseFloat(tags['roof:levels']) || 0) * 2);
  return 0;
}

// noBike：自転車で入れない場所の多角形（区間の座標、[x0, y0, ...]）の配列
function convert(id, osm, frame, noBike = []) {
  const { from, to, toXY } = frame;
  const inside = (x, y, p) => {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // 道の点がすべて、どれか 1 つの自転車で入れない場所の中にあるか
  const inNoBike = (pts) => noBike.some((poly) => {
    for (let i = 0; i < pts.length; i += 2) if (!inside(pts[i], pts[i + 1], poly)) return false;
    return true;
  });
  let noBikeDropped = 0;
  const roads = [];
  const buildings = [];
  const heights = []; // buildings と同じ順の高さ m
  const signals = [];

  // 橋・高架・屋根付きの道（駅の歩行者デッキなど）。スタートとゴールには選ばない
  const elevated = new WeakSet();
  const bridges = new Set();
  const lowRoads = new Set();
  const forcedBridges = new Map(); // FORCED_BRIDGES で橋にした道 → 高さ m

  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node' && tags.highway === 'traffic_signals') {
      signals.push(toXY(el.lat, el.lon));
    } else if (el.type === 'way' && el.geometry) {
      const pts = el.geometry.flatMap((g) => toXY(g.lat, g.lon));
      if (tags.building && tags.building !== 'roof' && !tags.highway) {
        if (pts.length >= 6) {
          buildings.push(pts);
          heights.push(buildingHeight(tags));
        }
      } else if (tags.highway && isRideable(tags, polylineLength(pts))) {
        if (pts.length >= 4 && inNoBike(pts)) {
          noBikeDropped++;
        } else if (pts.length >= 4) {
          const make = (p) => {
            const road = { t: tags.highway, w: ROAD_WIDTH[tags.highway], p };
            const ow = oneway(tags);
            if (ow) road.o = ow;
            if (tags.name) road.n = tags.name;
            roads.push(road);
            return road;
          };
          const forced = FORCED_BRIDGES.get(el.id);
          if (forced) {
            // OSM では橋でないが、ゲームでは橋にする道。upTo の点までを橋にし、残りは普通の道として分ける
            const cut = forced.upTo != null ? (forced.upTo + 1) * 2 : pts.length;
            const road = make(pts.slice(0, cut));
            if (cut < pts.length) make(pts.slice(cut - 2));
            elevated.add(road);
            bridges.add(road);
            forcedBridges.set(road, forced.height);
            continue;
          }
          const road = make(pts);
          if ((tags.bridge && tags.bridge !== 'no') || Number(tags.layer) > 0 || tags.covered === 'yes') elevated.add(road);
          // 橋・高架（3D版で持ち上げる。高さは processSection で、下に何を越えるかで決める）
          if ((tags.bridge && tags.bridge !== 'no') || Number(tags.layer) > 0) bridges.add(road);
          // 地面より低い道（ガード下など）
          if (Number(tags.layer) < 0 || (tags.tunnel && tags.tunnel !== 'no')) lowRoads.add(road);
        }
      }
    }
  }

  // 道路網のつながり（一方通行は無視）。いちばん大きなまとまりを「本線」とする。
  // 駅前には、どこにもつながっていない小さな広場や歩道が描かれていることがある（浜松町など）
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const nodeKey = (x, y) => `${x},${y}`;
  for (const r of roads) {
    for (let i = 0; i < r.p.length; i += 2) {
      const k = nodeKey(r.p[i], r.p[i + 1]);
      if (!parent.has(k)) parent.set(k, k);
      if (i > 0) parent.set(find(k), find(nodeKey(r.p[i - 2], r.p[i - 1])));
    }
  }
  const size = new Map();
  for (const k of parent.keys()) size.set(find(k), (size.get(find(k)) ?? 0) + 1);
  const mainRoot = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const onMain = (x, y) => find(nodeKey(x, y)) === mainRoot;

  // スタート・ゴールの候補：駅の代表点のまわりの道路上の点（本線につながっている地上の点だけ）。
  // いちばん近い点から STATION_SLACK_M 以内の点を候補にする
  const stationCandidates = (x, y) => {
    const list = [];
    for (const r of roads) {
      if (ROAD_WIDTH[r.t] < 5) continue; // 歩道ではなく車道から始める
      // 一方通行は除く（地下へ入る一方通行の端だと、逆走しないと出られない）
      if (r.o) continue;
      // 駅の歩行者デッキなど高い所の道は除く（浜松町では入口が南側にしかなく、大回りになった）
      if (elevated.has(r)) continue;
      for (let i = 0; i < r.p.length; i += 2) {
        if (!onMain(r.p[i], r.p[i + 1])) continue;
        list.push({ d: Math.hypot(r.p[i] - x, r.p[i + 1] - y), x: r.p[i], y: r.p[i + 1], road: r, i, key: nodeKey(r.p[i], r.p[i + 1]) });
      }
    }
    list.sort((a, b) => a.d - b.d);
    return list.filter((c) => c.d <= list[0].d + STATION_SLACK_M).slice(0, STATION_MAX_CANDIDATES);
  };

  // 所要時間で重み付けした道路網（歩道は速度上限が半分なので 2 倍）。順方向と、ゴールからたどる逆方向
  const forward = new Map();
  const backward = new Map();
  const link = (adj, a, b, cost) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push([b, cost]);
  };
  for (const r of roads) {
    const factor = PATH_TYPES.has(r.t) ? 2 : 1;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const a = nodeKey(r.p[i], r.p[i + 1]), b = nodeKey(r.p[i + 2], r.p[i + 3]);
      const cost = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]) * factor;
      if (r.o !== -1) link(forward, a, b, cost), link(backward, b, a, cost);
      if (r.o !== 1) link(forward, b, a, cost), link(backward, a, b, cost);
    }
  }

  // 駅のどちら側から出て、どちら側に着くか：電車と同じく線路を渡らずに済む側が自然なので、
  // 駅にいちばん近いスタートから所要時間が最短のゴールを選び、そのゴールへ最短で着くスタートを選び直す
  // （いちばん近い点を機械的に選ぶと、駅の反対側に置かれて線路を渡る回り道になることがある）
  const [fx, fy] = toXY(from.lat, from.lon);
  const [tx, ty] = toXY(to.lat, to.lon);
  const startCands = stationCandidates(fx, fy);
  const goalCands = stationCandidates(tx, ty);
  const pickBest = (cands, dist) =>
    cands.reduce((best, c) => ((dist.get(c.key) ?? Infinity) < (dist.get(best.key) ?? Infinity) ? c : best), cands[0]);
  const goal = pickBest(goalCands, shortestTimes(forward, startCands[0].key));
  const start = pickBest(startCands, shortestTimes(backward, goal.key));

  // スタート時の向きは道路に沿った前後どちらかのうち、ゴールに近い方
  // （ゴールへの直線方向だと、目の前が駅ビルで動けないことがある）
  const toGoal = Math.atan2(goal.x - start.x, -(goal.y - start.y));
  let startAngle = toGoal;
  let bestDot = -Infinity;
  for (const j of [start.i - 2, start.i + 2]) {
    const p = start.road.p;
    if (j < 0 || j >= p.length) continue;
    const a = Math.atan2(p[j] - start.x, -(p[j + 1] - start.y));
    const dot = Math.cos(a - toGoal);
    if (dot > bestDot) (bestDot = dot), (startAngle = a);
  }

  const [minX, minY] = toXY(frame.north, frame.west);
  const [maxX, maxY] = toXY(frame.south, frame.east);

  const data = {
    id,
    from: from.name,
    to: to.name,
    origin: { lat: frame.lat0, lon: frame.lon0 },
    bounds: { minX, minY, maxX, maxY },
    start: { x: start.x, y: start.y, angle: Math.round(startAngle * 100) / 100 },
    goal: { x: goal.x, y: goal.y, radius: GOAL_RADIUS_M },
    roads,
    buildings,
    signals,
    heights,
  };
  const info = {
    noBikeDropped,
    startOffset: start.d,
    goalOffset: goal.d,
    route: legalRouteLength(roads, start, goal),
  };
  return { data, info, bridges, lowRoads, forcedBridges };
}

// 木 trees: [x, y, 種類, ...]。種類は 0：広葉樹（丸い）、1：イチョウ、2：桜（横に広い）、3：針葉樹。
// 並木は TREE_ROW_SPACING_M おきに 1 本にする。車道の上にかかる木（地図の道の幅の内側）と、ほかの木に近すぎる木は除く
const TREE_ROW_SPACING_M = 9;
const TREE_MIN_GAP_M = 2.5;
const TREE_MAX = 3000; // 1 区間あたりの上限
function treeKind(tags) {
  const name = [tags.genus, tags.species, tags.taxon, tags['species:ja'], tags['genus:ja'], tags['taxon:ja']].filter(Boolean).join(' ');
  if (/ginkgo|イチョウ|銀杏|公孫樹/i.test(name)) return 1;
  if (/prunus|cerasus|サクラ|桜|ソメイヨシノ/i.test(name)) return 2;
  if (tags.leaf_type === 'needleleaved' || /pinus|cryptomeria|chamaecyparis|マツ|松|スギ|杉|ヒノキ/i.test(name)) return 3;
  return 0;
}
function convertTrees(osm, frame, bounds, roads) {
  const { toXY } = frame;
  const inBox = (x, y) => x >= bounds.minX - 20 && x <= bounds.maxX + 20 && y >= bounds.minY - 20 && y <= bounds.maxY + 20;
  const cands = [];
  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node') cands.push([...toXY(el.lat, el.lon), treeKind(tags)]);
    else if (el.type === 'way' && el.geometry) {
      const p = el.geometry.map((g) => toXY(g.lat, g.lon));
      const kind = treeKind(tags);
      let carry = 0; // 前の区切りから持ち越した長さ
      for (let i = 0; i + 1 < p.length; i++) {
        const [ax, ay] = p[i], [bx, by] = p[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        for (let d = carry; d <= len; d += TREE_ROW_SPACING_M) cands.push([round(ax + ((bx - ax) * d) / len), round(ay + ((by - ay) * d) / len), kind]);
        carry = (carry - len) % TREE_ROW_SPACING_M;
        if (carry < 0) carry += TREE_ROW_SPACING_M;
      }
    }
  }
  // 車道（地面の高さ。橋・地下を除く）の線分。木の点から道の真ん中までが道幅の半分より近ければ車道の上
  const segs = [];
  for (const r of roads) {
    if (PATH_TYPES.has(r.t) || r.e || r.u) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) segs.push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.w / 2 - 0.5]);
  }
  const CELL = 50;
  const grid = new Map(); // 50m 四方ごとの線分
  for (const sg of segs) {
    const r = sg[4] + 1;
    for (let gx = Math.floor((Math.min(sg[0], sg[2]) - r) / CELL); gx <= Math.floor((Math.max(sg[0], sg[2]) + r) / CELL); gx++) {
      for (let gy = Math.floor((Math.min(sg[1], sg[3]) - r) / CELL); gy <= Math.floor((Math.max(sg[1], sg[3]) + r) / CELL); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(sg);
      }
    }
  }
  const onRoad = (x, y) =>
    (grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []).some(([ax, ay, bx, by, hw]) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      return Math.hypot(x - ax - dx * t, y - ay - dy * t) < hw;
    });
  const trees = [];
  const kept = new Map(); // 5m 四方ごとの残した木
  for (const [x, y, k] of cands) {
    if (trees.length / 3 >= TREE_MAX) break;
    if (!inBox(x, y) || onRoad(x, y)) continue;
    const cx = Math.floor(x / 5), cy = Math.floor(y / 5);
    let near = false;
    for (let i = -1; i <= 1 && !near; i++) for (let j = -1; j <= 1 && !near; j++) near = (kept.get(`${cx + i},${cy + j}`) ?? []).some(([qx, qy]) => Math.hypot(qx - x, qy - y) < TREE_MIN_GAP_M);
    if (near) continue;
    const key = `${cx},${cy}`;
    if (!kept.has(key)) kept.set(key, []);
    kept.get(key).push([x, y]);
    trees.push(x, y, k);
  }
  return trees;
}

// バス停 stops: [x, y, ...] と自動販売機 vending: [x, y, ...]（見た目だけ。3D 版が近くの道に向けて置く）。
// 同じ停留所が上り・下りや乗り場ごとに何点もあるので、STOP_MIN_GAP_M より近いバス停は 1 つにまとめる
const STOP_MIN_GAP_M = 12;
function convertStreet(osm, frame, bounds) {
  const { toXY } = frame;
  const inBox = (x, y) => x >= bounds.minX - 20 && x <= bounds.maxX + 20 && y >= bounds.minY - 20 && y <= bounds.maxY + 20;
  const stops = [], vending = [];
  for (const el of osm.elements) {
    if (el.type !== 'node') continue;
    const [x, y] = toXY(el.lat, el.lon);
    if (!inBox(x, y)) continue;
    const tags = el.tags ?? {};
    if (tags.highway === 'bus_stop') {
      let near = false;
      for (let i = 0; i < stops.length && !near; i += 2) near = Math.hypot(stops[i] - x, stops[i + 1] - y) < STOP_MIN_GAP_M;
      if (!near) stops.push(x, y);
    } else if (tags.amenity === 'vending_machine' && tags.indoor !== 'yes' && !tags.level) vending.push(x, y);
  }
  return { stops, vending };
}

// OSM では橋になっていないが、ゲームでは橋にする道（OSM の way の番号 → 橋の高さ m と、橋にする点の範囲）。
// upTo があれば、その番号の点までを橋にして、そこから先は普通の道として分ける（坂は 3D 版が付ける）。
// 西日暮里駅の道灌山通り：実物は掘割の山手線の上を渡り、すぐ北の宇都宮線・常磐線などの高架の下をくぐるが、
// ゲームは山手線も地面の高さなので、地面の線路と高架の線路をまとめてまたぐ高い橋にする
// （高架の電車の屋根 ≒ 10m の上を、橋げたの厚さぶんあけて通る）。両側の歩道と、橋の上の横断歩道・脇道へのつなぎも
// 別の道として描かれているので、同じ高さにする（坂の途中の高さだと線路の上でたわみ、高架の電車にぶつかる）
const FORCED_BRIDGES = new Map([
  [1217374166, { height: 12 }],
  [1217374168, { height: 12 }],
  [1217374167, { height: 12, upTo: 1 }], // 点 0〜1 が線路の上。点 1（諏訪台通りとの交差点）から南は普通の道
  [535587406, { height: 12 }], // 西側の歩道（南の部分）
  [333944228, { height: 12, upTo: 1 }], // 西側の歩道（北の部分）。点 0〜1 が高架の線路の上
  [333944230, { height: 12 }], // 東側の歩道
  [1082255705, { height: 12 }], // 橋の上の横断歩道
  [1292591748, { height: 12 }], // 橋から西の脇道へのつなぎ
]);

// 3D版で持ち上げる道路（橋・高架）の高さ m を e に入れる。地面の高さを走る線路や道路の上を越えるなら高い橋、
// それ以外（川、切り通しの線路、地下の道、高架の線路の下をくぐる所）は低い橋とする。
// 東京の山手線は切り通し（目白・目黒など）や高架が多く、そこをまたぐ道は地面とほぼ同じ高さを通る
const BRIDGE_HIGH_M = 5.5;
const BRIDGE_LOW_M = 1;
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
function setBridgeHeights(roads, bridges, lowRoads, lines) {
  // 越えると高い橋になる線：地面の高さの線路（高架・切り通しでない）と、地面の高さの道路（橋・地下でない）
  const under = [
    ...lines.filter((l) => l.k !== 'river' && !l.e && !l.u && !lowLines.has(l)).map((l) => l.p),
    ...roads.filter((r) => !bridges.has(r) && !lowRoads.has(r)).map((r) => r.p),
  ];
  const boxOf = (p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) (x0 = Math.min(x0, p[i])), (x1 = Math.max(x1, p[i])), (y0 = Math.min(y0, p[i + 1])), (y1 = Math.max(y1, p[i + 1]));
    return [x0, y0, x1, y1];
  };
  const underBoxes = under.map(boxOf);
  for (const r of bridges) {
    const [x0, y0, x1, y1] = boxOf(r.p);
    let high = false;
    for (let k = 0; k < under.length && !high; k++) {
      const b = underBoxes[k];
      if (b[0] > x1 || b[2] < x0 || b[1] > y1 || b[3] < y0) continue;
      const q = under[k];
      for (let i = 0; i + 3 < r.p.length && !high; i += 2) {
        for (let j = 0; j + 3 < q.length; j += 2) {
          if (segmentsCross(r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], q[j], q[j + 1], q[j + 2], q[j + 3])) {
            high = true;
            break;
          }
        }
      }
    }
    r.e = high ? BRIDGE_HIGH_M : BRIDGE_LOW_M;
  }
}

async function processSection(id, refresh) {
  const section = SECTIONS[id];
  const frame = sectionFrame(section);
  const osm = await loadOsm(id, 'roads', frame.bbox, refresh);
  const noBikeOsm = await loadOsm('all', 'nobike', '', refresh);
  const noBike = noBikeOsm.elements.filter((e) => e.geometry).map((e) => e.geometry.flatMap((g) => frame.toXY(g.lat, g.lon)));
  const { data, info, bridges, lowRoads, forcedBridges } = convert(id, osm, frame, noBike);
  data.landmarks = selectLandmarks(await loadOsm(id, 'landmarks', frame.bbox, refresh), frame);
  Object.assign(data, convertAreas(await loadOsm(id, 'areas', frame.bbox, refresh), frame, data.bounds));
  setBridgeHeights(data.roads, bridges, lowRoads, data.lines);
  for (const [road, height] of forcedBridges) road.e = height;
  data.trees = convertTrees(await loadOsm(id, 'trees', frame.bbox, refresh), frame, data.bounds, data.roads);
  Object.assign(data, convertStreet(await loadOsm(id, 'street', frame.bbox, refresh), frame, data.bounds));

  const outPath = join(ROOT, 'data', `${id}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  const json = JSON.stringify(data);
  await writeFile(outPath, json);
  console.log(
    `保存: ${outPath} (${(json.length / 1024).toFixed(0)} KB) ` +
      `道路 ${data.roads.length} / 建物 ${data.buildings.length} / 信号 ${data.signals.length} / ランドマーク ${data.landmarks.length} / 面 ${data.areas.length} / 川・線路 ${data.lines.length} / 木 ${data.trees.length / 3} / バス停 ${data.stops.length / 2} / 自販機 ${data.vending.length / 2}`,
  );
  console.log(
    `  ${data.from}→${data.to}: スタートは駅から ${info.startOffset.toFixed(0)} m、ゴールは駅から ${info.goalOffset.toFixed(0)} m、` +
      (info.route == null ? '一方通行を守るとゴールに行けません（要確認）' : `一方通行を守った最短ルート ${info.route.toFixed(0)} m`) +
      (info.noBikeDropped ? `、自転車で入れない場所の道 ${info.noBikeDropped} 本を除外` : ''),
  );
}

const target = process.argv[2];
const refresh = process.argv.includes('--refresh');
const ids = target === 'all' ? Object.keys(SECTIONS) : [target];
if (!ids.every((id) => SECTIONS[id])) {
  console.error(`区間名を指定してください: all, ${Object.keys(SECTIONS).join(', ')}`);
  process.exit(1);
}
for (const id of ids) await processSection(id, refresh);
