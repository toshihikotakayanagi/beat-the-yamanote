// ライバルの山手線が地図の上を走る道筋。地図データの線路（lines の k が 'yamanote' と 'rail'）を
// つないで、出発駅から到着駅までの経路を作る。名前のない渡り線や駅の中の線路でつながることがあるので
// ほかの線路も使うが、山手線の線路を優先する。見た目だけで、勝ち負けは train.js の進み具合で決まる。

const M_PER_DEG_LAT = 110540; // tools/fetch-osm.mjs と同じ座標の換算
const GAP_M = 60; // 線路の切れ目（地下の部分を外したところなど）をこの距離までつなぐ
const GAP_COST = 3; // 切れ目をつなぐ線は、線路より通りにくくする（線路があればそちらを選ぶ）
const STATION_SLACK_M = 150; // 駅のまわりで出発・到着の候補にする範囲
const STATION_COST = 4; // 駅から離れた点ほど割高にする（駅の手前で道のりを縮めないように）
const OTHER_RAIL_COST = 2;
export const ELEVATED_H = 6; // 高い所を走る線路（橋・高架・土手。e: 1）の高さ m（3D版）
const RAMP_M = 45; // 高さの変わり目は、前後この距離で平均してなめらかにする（電車が段差を跳ねないように） // 山手線以外の線路（渡り線など）は、必要なところだけ通るよう割高にする

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
  // 辺：[行き先, コスト, 切れ目をつないだ線か, トンネルか, 高い所か]
  const link = (a, b, cost, jump = false, under = false, high = false) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, cost, jump, under, high]);
    adj.get(b).push([a, cost, jump, under, high]);
  };
  for (const t of tracks) {
    for (let i = 0; i + 3 < t.p.length; i += 2) {
      const a = key(t.p[i], t.p[i + 1]), b = key(t.p[i + 2], t.p[i + 3]);
      pos.set(a, [t.p[i], t.p[i + 1]]);
      pos.set(b, [t.p[i + 2], t.p[i + 3]]);
      const cost = Math.hypot(t.p[i + 2] - t.p[i], t.p[i + 3] - t.p[i + 1]) * (t.k === 'yamanote' ? 1 : OTHER_RAIL_COST);
      link(a, b, cost, false, Boolean(t.u), Boolean(t.e));
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
    for (const [v, cost, jump, under, high] of adj.get(u)) {
      if (du + cost < (dist.get(v) ?? Infinity)) {
        dist.set(v, du + cost);
        prev.set(v, [u, jump, under, high]);
      }
    }
  }
  if (!dist.has(g)) return null;
  const path = [];
  let jumps = 0;
  // 点は [x, y, その点に着く区間がトンネルか, その点に着く区間が高い所か]
  for (let c = prev.get(g)[0]; c !== s; ) {
    const p = prev.get(c);
    path.unshift([...pos.get(c), p[2] ? 1 : 0, p[3] ? 1 : 0]);
    if (p[1]) jumps++;
    c = p[0];
  }
  const fromXY = stationXY(map, from), toXY = stationXY(map, to);
  const offsets = [Math.hypot(path[0][0] - fromXY[0], path[0][1] - fromXY[1]), Math.hypot(path.at(-1)[0] - toXY[0], path.at(-1)[1] - toXY[1])];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return { path, cum, length: cum.at(-1), offsets, jumps, heights: smoothHeights(path, cum) };
}

// 経路の点ごとの高さ m（3D版）。区間ごとの高さ（高い所なら ELEVATED_H）を、前後 RAMP_M の範囲で平均する
function smoothHeights(path, cum) {
  const n = path.length;
  // 区間 i（点 i-1 → i）の高さ。最初の点は次の区間に合わせる
  const seg = path.map((p, i) => (i === 0 ? (path[1]?.[3] ?? 0) : p[3]) * ELEVATED_H);
  return path.map((_, i) => {
    let sum = 0, weight = 0;
    for (let j = 1; j < n; j++) {
      // 区間 j のうち、点 i の前後 RAMP_M に入る長さで重みをつける
      const a = Math.max(cum[j - 1], cum[i] - RAMP_M), b = Math.min(cum[j], cum[i] + RAMP_M);
      if (b <= a) continue;
      sum += seg[j] * (b - a);
      weight += b - a;
    }
    return weight > 0 ? sum / weight : seg[i];
  });
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
  const h = route.heights ? route.heights[i - 1] + (route.heights[i] - route.heights[i - 1]) * t : 0;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, h, angle: Math.atan2(bx - ax, -(by - ay)), under: Boolean(path[i][2]) };
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
  const hw = CAR_WIDTH / 2, hl = CAR_LENGTH / 2;
  for (let i = n - 1; i >= 0; i--) {
    const p = pointAt(route, front - CAR_LENGTH * (i + 0.5));
    ctx.save();
    ctx.globalAlpha = p.under ? UNDER_ALPHA : 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    // 車体を真上から：銀色の車体（両端を少し空けて連結部に見せる）
    ctx.fillStyle = CAR_BODY;
    ctx.strokeStyle = '#1b1d22';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.roundRect(-hw, -hl + 0.4, CAR_WIDTH, CAR_LENGTH - 0.8, 0.8);
    ctx.fill();
    ctx.stroke();
    // 横から少し見える黄緑のドア（片側 4 つ）
    ctx.fillStyle = CAR_BAND;
    for (const dz of [-6.9, -2.3, 2.3, 6.9]) {
      ctx.fillRect(-hw + 0.15, dz - 0.75, 0.45, 1.5);
      ctx.fillRect(hw - 0.6, dz - 0.75, 0.45, 1.5);
    }
    // 屋根（少し暗い灰色）と冷房装置
    ctx.fillStyle = '#9ea4ad';
    ctx.fillRect(-hw + 0.75, -hl + 1.2, CAR_WIDTH - 1.5, CAR_LENGTH - 2.4);
    ctx.fillStyle = '#7d838c';
    for (const az of [-4.5, 4.5]) ctx.fillRect(-0.85, az - 1.2, 1.7, 2.4);
    // パンタグラフ（4 両に 1 両。ひし形の枠）
    if (i % 4 === 2) {
      ctx.strokeStyle = '#2a2e35';
      ctx.lineWidth = 0.18;
      const pz = -hl + 3.2;
      ctx.beginPath();
      ctx.moveTo(-0.85, pz + 0.4);
      ctx.lineTo(0.85, pz + 0.4);
      ctx.moveTo(-0.45, pz - 0.6);
      ctx.lineTo(0, pz + 0.4);
      ctx.lineTo(0.45, pz - 0.6);
      ctx.stroke();
    }
    // 先頭車の黒い顔と前照灯、最後尾の尾灯
    if (i === 0) {
      ctx.fillStyle = '#15181d';
      ctx.fillRect(-hw + 0.3, -hl + 0.4, CAR_WIDTH - 0.6, 1.4);
      ctx.fillStyle = '#fff6d5';
      ctx.fillRect(-hw + 0.5, -hl + 0.3, 0.5, 0.35);
      ctx.fillRect(hw - 1.0, -hl + 0.3, 0.5, 0.35);
    }
    if (i === n - 1) {
      ctx.fillStyle = '#15181d';
      ctx.fillRect(-hw + 0.3, hl - 1.8, CAR_WIDTH - 0.6, 1.4);
      ctx.fillStyle = '#ff4d4d';
      ctx.fillRect(-hw + 0.5, hl - 0.65, 0.5, 0.35);
      ctx.fillRect(hw - 1.0, hl - 0.65, 0.5, 0.35);
    }
    ctx.restore();
  }
}
