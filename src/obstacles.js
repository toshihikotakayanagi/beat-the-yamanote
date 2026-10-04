// 信号・歩行者・他の車。
// 歩行者と車は自転車の周りだけに出し、遠ざかったら消す（地図全体には置かない）。
import { cellKey, nodeKey } from './map.js';
import { pedLook, pedSwing } from './pedestrians.js';

// 信号のサイクル（秒）。近くの信号（同じ交差点）は同じ色になる。
// 赤の平均待ち時間（6秒）と信号無視のペナルティ（main.js で 5 秒）を近くして、
// 「赤になったばかりなら無視、もうすぐ青なら待つ」という駆け引きにする。
const SIGNAL = { green: 30, yellow: 3, red: 12 };
const CYCLE = SIGNAL.green + SIGNAL.yellow + SIGNAL.red;
const SIGNAL_GROUP_DIST = 25; // この距離以内の信号は同じ交差点とみなす m
export const SIGNAL_ZONE = 5; // 赤信号でこの距離に入ると信号無視 m

const AGENTS = {
  ped: { max: 45, speed: [1.1, 1.7], radius: 1.0 },
  car: { max: 14, speed: [7, 10], radius: 2.2 },
};
const CAR_ROADS = new Set([
  'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service',
]);
const PED_ROADS = new Set([
  'footway', 'pedestrian', 'path', 'living_street', 'residential', 'service',
  'unclassified', 'tertiary', 'secondary', 'primary',
]);
const SPAWN_MIN = 120; // 画面外に出すための最小距離 m
const SPAWN_MAX = 220;
const DESPAWN = 260;
const CAR_COLORS = ['#d9d9d9', '#5b8def', '#e05252', '#2f3542', '#f1c40f', '#ffffff'];

// 再現できる乱数（同じ種なら毎回同じ動き）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupSignals(signals) {
  const parent = signals.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const d = Math.hypot(signals[i][0] - signals[j][0], signals[i][1] - signals[j][1]);
      if (d <= SIGNAL_GROUP_DIST) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  signals.forEach((s, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  });
  // 交差点ごとのずれは固定（毎回同じ信号パターンなので、道を覚える楽しみがある）
  const rng = mulberry32(2024);
  return [...groups.values()].map((nodes, id) => ({ id, nodes, offset: rng() * CYCLE }));
}

export function signalState(group, clock) {
  const t = (clock + group.offset) % CYCLE;
  if (t < SIGNAL.green) return 'green';
  if (t < SIGNAL.green + SIGNAL.yellow) return 'yellow';
  return 'red';
}

export function createObstacles(map, seed = 1) {
  return {
    signals: groupSignals(map.signals),
    agents: [],
    clock: 0,
    rng: mulberry32(seed),
    inside: new Set(), // 自転車が今入っている信号の範囲（入った瞬間だけ判定するため）
    populated: false,
  };
}

const vertex = (road, v) => [road.p[2 * v], road.p[2 * v + 1]];
const vertexCount = (road) => road.p.length / 2;
const canUse = (kind, road) => (kind === 'car' ? CAR_ROADS : PED_ROADS).has(road.t);

// 道路 road の頂点 v から、向き dir に進めるか（車は一方通行を守る）
function canGo(kind, road, v, dir) {
  if (v + dir < 0 || v + dir >= vertexCount(road)) return false;
  return kind !== 'car' || !road.o || road.o === dir;
}

function spawn(obs, map, kind, px, py, rmin, rmax) {
  const { rng } = obs;
  for (let tries = 0; tries < 12; tries++) {
    const ang = rng() * Math.PI * 2;
    const r = rmin + rng() * (rmax - rmin);
    const cell = map.cells.get(cellKey(px + Math.sin(ang) * r, py - Math.cos(ang) * r));
    if (!cell) continue;
    const segs = cell.segs.filter((s) => canUse(kind, s.road));
    if (!segs.length) continue;
    const seg = segs[Math.floor(rng() * segs.length)];
    const road = seg.road;
    let dir = kind === 'car' && road.o ? road.o : rng() < 0.5 ? 1 : -1;
    const v = dir === 1 ? seg.v : seg.v + 1;
    if (!canGo(kind, road, v, dir)) continue;
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const [smin, smax] = AGENTS[kind].speed;
    const a = {
      kind,
      road,
      v,
      dir,
      s: rng() * len,
      speed: smin + rng() * (smax - smin),
      side: rng() < 0.5 ? -1 : 1, // 歩行者は道の左右どちらかの端を歩く
      color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      x: 0,
      y: 0,
      angle: 0,
      hx: 0,
      hy: 0,
    };
    place(a);
    if (Math.hypot(a.x - px, a.y - py) < rmin * 0.8) continue;
    obs.agents.push(a);
    return;
  }
}

// 道路の端の頂点に着いたら、つながっている別の道路へ進む。行き止まりなら引き返す。
function continueAt(obs, map, a) {
  const [x, y] = vertex(a.road, a.v);
  const options = [];
  for (const n of map.nodes.get(nodeKey(x, y)) ?? []) {
    if (n.road === a.road || !canUse(a.kind, n.road)) continue;
    for (const dir of [1, -1]) if (canGo(a.kind, n.road, n.v, dir)) options.push({ road: n.road, v: n.v, dir });
  }
  if (options.length) {
    const o = options[Math.floor(obs.rng() * options.length)];
    a.road = o.road;
    a.v = o.v;
    a.dir = o.dir;
    return true;
  }
  if (canGo(a.kind, a.road, a.v, -a.dir)) {
    a.dir = -a.dir;
    return true;
  }
  return false; // 一方通行の行き止まり：消す
}

function advance(obs, map, a, dist) {
  for (let guard = 0; dist > 0 && guard < 20; guard++) {
    if (!canGo(a.kind, a.road, a.v, a.dir)) {
      if (!continueAt(obs, map, a)) return false;
      a.s = 0;
      continue;
    }
    const [x1, y1] = vertex(a.road, a.v);
    const [x2, y2] = vertex(a.road, a.v + a.dir);
    const rest = Math.hypot(x2 - x1, y2 - y1) - a.s;
    if (dist < rest) {
      a.s += dist;
      dist = 0;
    } else {
      dist -= rest;
      a.v += a.dir;
      a.s = 0;
    }
  }
  place(a);
  return true;
}

// 線分上の位置から座標を出す。日本は左側通行なので、車は進行方向の左に寄せる。
function place(a) {
  const [x1, y1] = vertex(a.road, a.v);
  const next = Math.max(0, Math.min(vertexCount(a.road) - 1, a.v + a.dir));
  const [x2, y2] = vertex(a.road, next);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const hx = (x2 - x1) / len, hy = (y2 - y1) / len;
  const hw = a.road.w / 2;
  const offset = a.kind === 'car' ? hw * 0.45 : a.side * hw * 0.85;
  // 進行方向 (hx, hy) の左側は (hy, -hx)（y 軸が下向きのため）
  a.x = x1 + hx * a.s + hy * offset;
  a.y = y1 + hy * a.s - hx * offset;
  a.hx = hx;
  a.hy = hy;
  a.angle = Math.atan2(hx, -hy);
}

// 車は前に自転車がいるとき、赤・黄信号の手前で止まる
function carShouldStop(obs, a, player) {
  const ahead = (x, y, near, far, width) => {
    const dx = x - a.x, dy = y - a.y;
    const along = dx * a.hx + dy * a.hy;
    const side = Math.abs(-dx * a.hy + dy * a.hx);
    return along > near && along < far && side < width;
  };
  if (ahead(player.x, player.y, 0, 10, 3)) return true;
  for (const g of obs.signals) {
    if (signalState(g, obs.clock) === 'green') continue;
    for (const [x, y] of g.nodes) if (ahead(x, y, SIGNAL_ZONE - 1, SIGNAL_ZONE + 8, a.road.w / 2 + 2)) return true;
  }
  return false;
}

// 1 フレーム分進める。racing のときだけ自転車との判定を行い、起きたことを返す。
// 返り値: [{ type: 'red' | 'ped' | 'car' }]
export function updateObstacles(obs, map, player, dt, racing) {
  obs.clock += dt;
  const events = [];

  obs.agents = obs.agents.filter((a) => Math.hypot(a.x - player.x, a.y - player.y) < DESPAWN);
  for (const kind of ['ped', 'car']) {
    const count = obs.agents.filter((a) => a.kind === kind).length;
    // 最初は画面内にも置く。その後は画面外から補充する
    const rmin = obs.populated ? SPAWN_MIN : 25;
    const n = obs.populated ? Math.min(2, AGENTS[kind].max - count) : AGENTS[kind].max - count;
    for (let i = 0; i < n; i++) spawn(obs, map, kind, player.x, player.y, rmin, SPAWN_MAX);
  }
  obs.populated = true;

  obs.agents = obs.agents.filter((a) => {
    if (a.kind === 'car' && carShouldStop(obs, a, player)) return true;
    return advance(obs, map, a, a.speed * dt);
  });

  if (!racing) return events;

  for (const a of obs.agents) {
    if (Math.hypot(a.x - player.x, a.y - player.y) < AGENTS[a.kind].radius) {
      events.push({ type: a.kind });
      break; // 1 フレームに 1 回まで
    }
  }

  // 信号：範囲に「入った瞬間」が赤なら信号無視
  for (const g of obs.signals) {
    const inside = g.nodes.some(([x, y]) => Math.hypot(x - player.x, y - player.y) < SIGNAL_ZONE);
    if (inside && !obs.inside.has(g.id) && signalState(g, obs.clock) === 'red') events.push({ type: 'red' });
    if (inside) obs.inside.add(g.id);
    else obs.inside.delete(g.id);
  }
  return events;
}

// 自転車が今いる信号範囲を「入っている」扱いにする（スタート地点が範囲内のとき用）
export function markInsideSignals(obs, player) {
  obs.inside.clear();
  for (const g of obs.signals) {
    if (g.nodes.some(([x, y]) => Math.hypot(x - player.x, y - player.y) < SIGNAL_ZONE)) obs.inside.add(g.id);
  }
}

const SIGNAL_COLORS = { green: '#3ccf6e', yellow: '#ffc93c', red: '#ff4d4d' };

// 歩行者を真上から見た形で描く：交互に前に出る足、肩（服の色）、頭（髪の色）。雨の日は傘。
// 実寸（肩幅約 0.45m）だと小さすぎて暗い地図に紛れるので、大きく描き、足もとに薄紫の丸を敷く（避ける相手だと分かるように）
const PED_SCALE = 3.2;
function drawPedestrian(ctx, a, weather) {
  const look = pedLook(a);
  const swing = pedSwing(a);
  const k = PED_SCALE * look.scale;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  ctx.scale(k, k);
  ctx.fillStyle = 'rgba(201, 184, 255, 0.45)';
  ctx.beginPath();
  ctx.arc(0, 0, 0.36, 0, Math.PI * 2);
  ctx.fill();
  // 足（前が -y）
  ctx.fillStyle = look.pants;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 0.1, -swing * side * 0.22, 0.07, 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (weather === 'rain') {
    // 傘（上から見ると丸い）
    ctx.fillStyle = look.umbrella;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, -0.05, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 0.03;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, -0.05);
      ctx.lineTo(Math.cos((i * Math.PI) / 2 + 0.4) * 0.5, -0.05 + Math.sin((i * Math.PI) / 2 + 0.4) * 0.5);
      ctx.stroke();
    }
  } else {
    // 肩と腕（腕は足と逆に振る）
    ctx.fillStyle = look.shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.23, 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.25, swing * side * 0.12, 0.05, 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 頭
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(0, -0.02, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// opts.weather：天気（雨の日は歩行者が傘をさす）
export function drawObstacles(ctx, obs, view, opts = {}) {
  const visible = (x, y) => x > view.left - 5 && x < view.right + 5 && y > view.top - 5 && y < view.bottom + 5;

  for (const g of obs.signals) {
    const state = signalState(g, obs.clock);
    for (const [x, y] of g.nodes) {
      if (!visible(x, y)) continue;
      ctx.fillStyle = SIGNAL_COLORS[state];
      ctx.strokeStyle = '#111317';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  for (const a of obs.agents) {
    if (!visible(a.x, a.y)) continue;
    if (a.kind === 'ped') {
      drawPedestrian(ctx, a, opts.weather);
    } else {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.fillStyle = a.color;
      ctx.fillRect(-0.95, -2.25, 1.9, 4.5);
      ctx.fillStyle = 'rgba(20, 24, 30, 0.7)'; // フロントガラス
      ctx.fillRect(-0.8, -1.3, 1.6, 0.9);
      ctx.restore();
    }
  }
}
