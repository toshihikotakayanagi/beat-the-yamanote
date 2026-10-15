// 信号・歩行者・他の車。
// 歩行者と車は自転車の周りだけに出し、遠ざかったら消す（地図全体には置かない）。
import { cellKey, nodeKey } from './map.js';
import { pedLook, pedSwing } from './pedestrians.js';
import { carLook } from './vehicles.js';
import { signalPose, LAMPS } from './signals.js';

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
      spawnW: road.w, // 出てきた道の幅（車種を決めるのに使う。vehicles.js）
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

// 長い車（路線バス・トラック）の、ふつうの車より前後に長いぶんの半分 m（ふつうの車は 0）
function longExtra(a) {
  const c = a.kind === 'car' ? carLook(a) : null;
  return c?.long ? c.L / 2 - LONG_CAR_END : 0;
}
const LONG_CAR_END = 2.3; // ふつうの車の、真ん中から前の端までの長さ（セダンの長さの半分）

// 自転車とぶつかったか。長い車は、車体の向きに伸ばした範囲（前後の端の丸の真ん中を結ぶ線から radius 以内）で調べる
function hits(a, player) {
  const r = AGENTS[a.kind].radius;
  const extra = longExtra(a);
  const dx = player.x - a.x, dy = player.y - a.y;
  if (!extra) return Math.hypot(dx, dy) < r;
  const along = Math.max(-extra, Math.min(extra, dx * a.hx + dy * a.hy));
  return Math.hypot(dx - a.hx * along, dy - a.hy * along) < r;
}

// 車は前に自転車がいるとき、赤・黄信号の手前で止まる
function carShouldStop(obs, a, player) {
  const ahead = (x, y, near, far, width) => {
    const dx = x - a.x, dy = y - a.y;
    const along = dx * a.hx + dy * a.hy;
    const side = Math.abs(-dx * a.hy + dy * a.hx);
    return along > near && along < far && side < width;
  };
  const nose = longExtra(a); // 長い車は車体の前が前にあるぶん、早めに止まる
  if (ahead(player.x, player.y, 0, 10 + nose, 3)) return true;
  for (const g of obs.signals) {
    if (signalState(g, obs.clock) === 'green') continue;
    for (const [x, y] of g.nodes) if (ahead(x, y, SIGNAL_ZONE - 1 + nose, SIGNAL_ZONE + 8 + nose, a.road.w / 2 + 2)) return true;
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
    if (hits(a, player)) {
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

// 色を明るく・暗くする（#rrggbb、k > 1 で明るく）
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

// 車を真上から見た形で描く：角の丸い車体、前後の窓、屋根、ドアミラー、ライト（タクシーは屋根の行灯）
function drawCar(ctx, a) {
  const c = carLook(a);
  if (c.long) return drawLongCar(ctx, a, c);
  const hl = c.L / 2, hw = c.W / 2;
  const [fb, bb] = c.cabinBottom, [ft, bt] = c.cabinTop; // 窓の部分の前後（下と上）
  const glass = 'rgba(25, 30, 40, 0.92)';
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  // 影（車体の縁取り）
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)';
  ctx.beginPath();
  ctx.roundRect(-hw - 0.08, -hl - 0.08, c.W + 0.16, c.L + 0.16, 0.55);
  ctx.fill();
  // 車体
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.roundRect(-hw, -hl, c.W, c.L, 0.5);
  ctx.fill();
  // ドアミラー
  ctx.fillRect(-hw - 0.14, fb + 0.15, 0.14, 0.18);
  ctx.fillRect(hw, fb + 0.15, 0.14, 0.18);
  // 前の窓（フロントガラス）と後ろの窓：窓の部分の下と上のあいだ
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.88, fb);
  ctx.lineTo(hw * 0.88, fb);
  ctx.lineTo(hw * 0.78, ft);
  ctx.lineTo(-hw * 0.78, ft);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-hw * 0.78, bt);
  ctx.lineTo(hw * 0.78, bt);
  ctx.lineTo(hw * 0.86, bb);
  ctx.lineTo(-hw * 0.86, bb);
  ctx.closePath();
  ctx.fill();
  // 横の窓（細い帯）
  ctx.fillRect(-hw * 0.9, ft, 0.12, bt - ft);
  ctx.fillRect(hw * 0.9 - 0.12, ft, 0.12, bt - ft);
  // 屋根（少し明るく）
  ctx.fillStyle = shade(c.color.startsWith('#') ? c.color : '#888888', 1.12);
  ctx.beginPath();
  ctx.roundRect(-hw * 0.74, ft + 0.05, hw * 1.48, bt - ft - 0.1, 0.25);
  ctx.fill();
  if (c.sign) {
    ctx.fillStyle = '#ffd34d'; // タクシーの行灯
    ctx.fillRect(-0.28, (ft + bt) / 2 - 0.12, 0.56, 0.24);
  }
  // ライト：前は白、後ろは赤
  ctx.fillStyle = '#fff6d5';
  ctx.fillRect(-hw + 0.12, -hl + 0.02, 0.38, 0.16);
  ctx.fillRect(hw - 0.5, -hl + 0.02, 0.38, 0.16);
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(-hw + 0.1, hl - 0.16, 0.36, 0.13);
  ctx.fillRect(hw - 0.46, hl - 0.16, 0.36, 0.13);
  ctx.restore();
}

// 路線バスとトラックを真上から見た形で描く。バス：白い屋根に冷房の箱と前後の窓。トラック：車ごとの色の運転台と銀色の荷箱
function drawLongCar(ctx, a, c) {
  const hl = c.L / 2, hw = c.W / 2;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)';
  ctx.beginPath();
  ctx.roundRect(-hw - 0.08, -hl - 0.08, c.W + 0.16, c.L + 0.16, 0.4);
  ctx.fill();
  if (c.type === 'bus') {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.roundRect(-hw, -hl, c.W, c.L, 0.35);
    ctx.fill();
    ctx.fillStyle = '#2e8b57'; // 屋根の縁の緑の帯
    ctx.fillRect(-hw, -hl + 0.6, 0.14, c.L - 1.2);
    ctx.fillRect(hw - 0.14, -hl + 0.6, 0.14, c.L - 1.2);
    ctx.fillStyle = 'rgba(25, 30, 40, 0.92)'; // 前と後ろの窓
    ctx.fillRect(-hw + 0.15, -hl + 0.05, c.W - 0.3, 0.3);
    ctx.fillRect(-hw + 0.3, hl - 0.25, c.W - 0.6, 0.2);
    ctx.fillStyle = '#c9ccc8'; // 屋根の冷房
    ctx.fillRect(-0.85, -2.6, 1.7, 3.1);
  } else {
    const cab = 1.9;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.roundRect(-hw + 0.08, -hl, c.W - 0.16, cab, 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(25, 30, 40, 0.92)';
    ctx.fillRect(-hw + 0.25, -hl + 0.08, c.W - 0.5, 0.35);
    ctx.fillStyle = '#a3a7ad'; // 荷箱
    ctx.fillRect(-hw, -hl + cab + 0.1, c.W, c.L - cab - 0.1);
    ctx.strokeStyle = '#8a8e95';
    ctx.lineWidth = 0.06;
    ctx.strokeRect(-hw + 0.1, -hl + cab + 0.2, c.W - 0.2, c.L - cab - 0.3);
  }
  ctx.fillStyle = '#fff6d5';
  ctx.fillRect(-hw + 0.15, -hl + 0.02, 0.4, 0.14);
  ctx.fillRect(hw - 0.55, -hl + 0.02, 0.4, 0.14);
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(-hw + 0.1, hl - 0.15, 0.3, 0.12);
  ctx.fillRect(hw - 0.4, hl - 0.15, 0.3, 0.12);
  ctx.restore();
}

// 信号機を真上から見た形で描く：道の端の柱から道の上へ伸びる腕と、道を横切る向きの横長の箱に 3 つの灯（左から青・黄・赤）。
// 点いている灯だけ明るい。見やすいよう実寸より大きい
function drawSignalHead(ctx, x, y, pose, state) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pose.angle);
  // 腕（道の左端から中央へ）
  ctx.strokeStyle = '#7a808b';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(-pose.hw - 0.6, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#7a808b';
  ctx.beginPath();
  ctx.arc(-pose.hw - 0.6, 0, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // 箱と灯
  ctx.fillStyle = '#1b1d22';
  ctx.strokeStyle = '#5a606b';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.roundRect(-1.5, -0.55, 3, 1.1, 0.4);
  ctx.fill();
  ctx.stroke();
  LAMPS.forEach((lamp, i) => {
    ctx.fillStyle = lamp.state === state ? lamp.on : lamp.off;
    ctx.beginPath();
    ctx.arc(-0.95 + i * 0.95, 0, 0.36, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// opts.weather：天気（雨の日は歩行者が傘をさす）、opts.map：地図（信号機の向きを道に合わせる）
export function drawObstacles(ctx, obs, view, opts = {}) {
  const visible = (x, y) => x > view.left - 5 && x < view.right + 5 && y > view.top - 5 && y < view.bottom + 5;

  for (const g of obs.signals) {
    const state = signalState(g, obs.clock);
    for (const [x, y] of g.nodes) {
      if (!visible(x, y)) continue;
      // 地面の円（信号の色。この近くで赤だと信号無視）
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = SIGNAL_COLORS[state];
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SIGNAL_COLORS[state];
      ctx.lineWidth = 0.35;
      ctx.stroke();
      if (opts.map) drawSignalHead(ctx, x, y, signalPose(opts.map, x, y), state);
    }
  }

  for (const a of obs.agents) {
    if (!visible(a.x, a.y)) continue;
    if (a.kind === 'ped') {
      drawPedestrian(ctx, a, opts.weather);
    } else {
      drawCar(ctx, a);
    }
  }
}
