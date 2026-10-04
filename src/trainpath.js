// ライバルの山手線が地図の上を走る道筋。地図データの線路（lines の k が 'yamanote' と 'rail'）を
// つないで、出発駅から到着駅までの経路を作る。名前のない渡り線や駅の中の線路でつながることがあるので
// ほかの線路も使うが、山手線の線路を優先する。見た目だけで、勝ち負けは train.js の進み具合で決まる。

const M_PER_DEG_LAT = 110540; // tools/fetch-osm.mjs と同じ座標の換算
const GAP_M = 60; // 線路の切れ目（地下の部分を外したところなど）をこの距離までつなぐ
const GAP_COST = 3; // 切れ目をつなぐ線は、線路より通りにくくする（線路があればそちらを選ぶ）
const STATION_SLACK_M = 150; // 駅のまわりで出発・到着の候補にする範囲
const STATION_COST = 4; // 駅から離れた点ほど割高にする（駅の手前で道のりを縮めないように）
const OTHER_RAIL_COST = 2; // 山手線以外の線路（渡り線など）は、必要なところだけ通るよう割高にする

// 駅の緯度経度 → 区間の座標（m。x は東、y は南が正）
export function stationXY(map, st) {
  const { lat, lon } = map.origin;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return [(st.lon - lon) * mPerDegLon, -(st.lat - lat) * M_PER_DEG_LAT];
}

// 出発駅 from から到着駅 to まで（{ lat, lon }）の線路上の経路。
// 返り値 { path: [[x, y], ...], cum: 先頭からの距離の配列, length, offsets: 駅から線路までの距離, jumps: つないだ切れ目の数 }。
// 山手線の線路がなければ null
export function trainPath(map, from, to) {
  const tracks = (map.lines ?? []).filter((l) => l.k === 'yamanote' || l.k === 'rail');
  if (!tracks.some((l) => l.k === 'yamanote')) return null;
  const key = (x, y) => `${x},${y}`;
  const pos = new Map();
  const adj = new Map();
  // 辺：[行き先, コスト, 切れ目をつないだ線か, トンネルか]
  const link = (a, b, cost, jump = false, under = false) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, cost, jump, under]);
    adj.get(b).push([a, cost, jump, under]);
  };
  for (const t of tracks) {
    for (let i = 0; i + 3 < t.p.length; i += 2) {
      const a = key(t.p[i], t.p[i + 1]), b = key(t.p[i + 2], t.p[i + 3]);
      pos.set(a, [t.p[i], t.p[i + 1]]);
      pos.set(b, [t.p[i + 2], t.p[i + 3]]);
      const cost = Math.hypot(t.p[i + 2] - t.p[i], t.p[i + 3] - t.p[i + 1]) * (t.k === 'yamanote' ? 1 : OTHER_RAIL_COST);
      link(a, b, cost, false, Boolean(t.u));
    }
  }
  // 行き止まりの点から近くの線路の点へ、切れ目をつなぐ線を足す
  const nodes = [...pos.keys()];
  for (const a of nodes) {
    if (adj.get(a).length !== 1) continue;
    const [ax, ay] = pos.get(a);
    const near = adj.get(a)[0][0];
    for (const b of nodes) {
      if (b === a || b === near) continue;
      const [bx, by] = pos.get(b);
      const d = Math.hypot(bx - ax, by - ay);
      if (d <= GAP_M) link(a, b, d * GAP_COST, true);
    }
  }

  // 駅のまわりの山手線の線路の点（いちばん近い点から STATION_SLACK_M 以内）から出発し、到着する。
  // 新宿駅のように駅の中の線路に名前がなく、いちばん近い山手線の線路が切れ端のことがあるので、
  // 候補をまとめて仮の点 S・G につなぎ、駅からの距離も道のりに含めて最短の組を選ぶ
  const onYamanote = new Set();
  for (const t of tracks) if (t.k === 'yamanote') for (let i = 0; i < t.p.length; i += 2) onYamanote.add(key(t.p[i], t.p[i + 1]));
  const around = ([x, y]) => {
    const list = [...onYamanote].map((k) => [k, Math.hypot(pos.get(k)[0] - x, pos.get(k)[1] - y)]);
    const min = Math.min(...list.map(([, d]) => d));
    return list.filter(([, d]) => d <= min + STATION_SLACK_M);
  };
  const s = 'S', g = 'G';
  adj.set(s, []);
  for (const [k, d] of around(stationXY(map, from))) adj.get(s).push([k, d * STATION_COST, false]);
  for (const [k, d] of around(stationXY(map, to))) adj.get(k).push([g, d * STATION_COST, false]);
  adj.set(g, []);

  // ダイクストラ法（点の数は千程度なので単純な探し方で十分）
  const dist = new Map([[s, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let u = null, du = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < du) (u = k), (du = d);
    if (u === null || u === g) break;
    done.add(u);
    for (const [v, cost, jump, under] of adj.get(u)) {
      if (du + cost < (dist.get(v) ?? Infinity)) {
        dist.set(v, du + cost);
        prev.set(v, [u, jump, under]);
      }
    }
  }
  if (!dist.has(g)) return null;
  const path = [];
  let jumps = 0;
  // 点は [x, y, その点に着く区間がトンネルか]
  for (let c = prev.get(g)[0]; c !== s; ) {
    const p = prev.get(c);
    path.unshift([...pos.get(c), p[2] ? 1 : 0]);
    if (p[1]) jumps++;
    c = p[0];
  }
  const fromXY = stationXY(map, from), toXY = stationXY(map, to);
  const offsets = [Math.hypot(path[0][0] - fromXY[0], path[0][1] - fromXY[1]), Math.hypot(path.at(-1)[0] - toXY[0], path.at(-1)[1] - toXY[1])];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return { path, cum, length: cum.at(-1), offsets, jumps };
}

// 経路の先頭から d m の位置と向き（angle は北が 0、時計回り。自転車と同じ）。under：トンネルの中か
export function pointAt(route, d) {
  const { path, cum } = route;
  d = Math.max(0, Math.min(route.length, d));
  let i = 1;
  while (i < path.length - 1 && cum[i] < d) i++;
  const [ax, ay] = path[i - 1], [bx, by] = path[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / seg;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(bx - ax, -(by - ay)), under: Boolean(path[i][2]) };
}

// ---- 描画 ----

const CAR_LENGTH = 20; // 1 両の長さ m（実物の山手線は 20m × 11 両）
const CAR_WIDTH = 3.2;
const MAX_CARS = 11;
// 実物（E235系）と同じ銀色の車体に黄緑の帯。線路の黄緑と見分けがつくように
const CAR_BODY = '#d4d8de';
const CAR_BAND = '#8cc63f';
const UNDER_ALPHA = 0.35; // トンネルの中は薄く

// 区間の道のりに収まる両数（短い区間で電車が経路からはみ出さないよう、道のりの半分まで）
export const carCount = (route) => Math.max(3, Math.min(MAX_CARS, Math.floor(route.length / 2 / CAR_LENGTH)));

// 進み具合 progress（0〜1）のときの先頭の位置 m。発車時は編成がすべて経路の上に乗っている
export function frontDistance(route, progress) {
  const trainLen = carCount(route) * CAR_LENGTH;
  return trainLen + (route.length - trainLen) * progress;
}

// 地点 (x, y) から電車のいちばん近い車両までの距離 m と、その車両がトンネルの中か（電車の音の大きさに使う）
export function trainDistance(route, progress, x, y) {
  const front = frontDistance(route, progress);
  let dist = Infinity, under = false;
  for (let i = 0; i < carCount(route); i++) {
    const p = pointAt(route, front - CAR_LENGTH * (i + 0.5));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < dist) (dist = d), (under = p.under);
  }
  return { dist, under };
}

// 地図の上に電車を描く（座標はメートル。map.js と同じ変換の中で呼ぶ）
export function drawTrain(ctx, route, progress) {
  const front = frontDistance(route, progress);
  const n = carCount(route);
  for (let i = n - 1; i >= 0; i--) {
    const p = pointAt(route, front - CAR_LENGTH * (i + 0.5));
    ctx.save();
    ctx.globalAlpha = p.under ? UNDER_ALPHA : 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    // 車体（両端を少し空けて連結部に見せる）
    ctx.fillStyle = CAR_BODY;
    ctx.strokeStyle = '#1b1d22';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.roundRect(-CAR_WIDTH / 2, -CAR_LENGTH / 2 + 0.4, CAR_WIDTH, CAR_LENGTH - 0.8, 0.8);
    ctx.fill();
    ctx.stroke();
    // 黄緑の帯（車体の両側）
    ctx.fillStyle = CAR_BAND;
    ctx.fillRect(-CAR_WIDTH / 2 + 0.3, -CAR_LENGTH / 2 + 1, 0.7, CAR_LENGTH - 2);
    ctx.fillRect(CAR_WIDTH / 2 - 1, -CAR_LENGTH / 2 + 1, 0.7, CAR_LENGTH - 2);
    // 先頭車の運転席（黒い窓）
    if (i === 0) {
      ctx.fillStyle = '#1b1d22';
      ctx.fillRect(-CAR_WIDTH / 2 + 0.4, -CAR_LENGTH / 2 + 0.8, CAR_WIDTH - 0.8, 1.6);
    }
    ctx.restore();
  }
}
