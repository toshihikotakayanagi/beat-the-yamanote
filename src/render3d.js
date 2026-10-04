// 3D版の世界の描き方（Three.js）。地図データ（道路・建物・公園・水域・線路）を立体にし、
// 自転車の後ろ上から追いかける視点で描く。HUD（メニュー・レースバー・ミニマップ）は game.js が
// 上に重ねた透明なキャンバスに描く。
//
// 座標：地図の (x, y)（m。x は東、y は南が正）を Three.js の (x, 高さ, y) に置く（y が上）。
// 向き：自転車などの angle（北が 0、時計回り）は rotation.y = -angle（前が -z 方向のモデル）。
import * as THREE from 'three';
import { signalState } from './obstacles.js';
import { pointAt, frontDistance, carCount } from './trainpath.js';
import { AREA_COLORS, LINE_STYLES, cellKey } from './map.js';

const SKY = 0x232a36;
const FOG_NEAR = 120;
const FOG_FAR = 420;
const GROUND = 0x1f2228;
const ROAD = 0x4a4f5a;
const PATH = 0x3a3f48;
const ARROW = 0x6b7280;

// 高さ（重なる面がちらつかないよう、少しずつ上げる）m
const Y = { area: 0.02, water: 0.04, river: 0.05, path: 0.06, road: 0.08, rail: 0.1, arrow: 0.12, signal: 0.13 };

// 建物は TILE m 四方ごとにまとめる。カメラと自転車のあいだをさえぎるまとまりだけ透かす
// （東京では駅ビルや高架の下を道路がくぐるので、自転車が建物の中に入って見えなくなることがある）
const TILE = 120;
const SEE_THROUGH = 0.22; // 透かしたときの不透明度
const FADE_SPEED = 6; // 透かす・戻すの速さ（1 秒あたり）

// 追いかける視点
const CAMERA_BACK = 13; // 自転車の後ろ m
const CAMERA_UP = 6.5; // 高さ m
const LOOK_AHEAD = 8; // 自転車の前方のこの位置を見る m
const CAMERA_TURN = 4; // 向きの追従の速さ（大きいほど速く回る）

// 建物の高さが分からないとき：床面積から決め、建物ごとに少しばらつかせる
function guessHeight(area, i) {
  const base = area < 120 ? 7 : area < 400 ? 11 : area < 1500 ? 18 : 26;
  const jitter = ((i * 2654435761) % 1000) / 1000; // 番号から決まる 0〜1
  return base * (0.8 + 0.5 * jitter);
}

function insidePolygon(px, py, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1]);
  return a / 2; // 符号つき
}

// 点列（[x0, y0, ...]、最後が最初と同じなら除く）
function openRing(p) {
  const n = p.length;
  return n >= 4 && p[0] === p[n - 2] && p[1] === p[n - 1] ? p.slice(0, n - 2) : p;
}

// 位置・法線・色を貯めて 1 つの BufferGeometry にする
class GeometryBuilder {
  constructor(withColor = false) {
    this.pos = [];
    this.nor = [];
    this.col = withColor ? [] : null;
  }
  tri(a, b, c, n, color) {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) {
      this.nor.push(...n);
      if (this.col) this.col.push(...color);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const UP = [0, 1, 0];

// 線（道路・線路・川）を、幅 w の帯にして地面に貼る。曲がり角のすき間は円盤で埋める
function addRibbon(b, p, w, y) {
  const hw = w / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = (-(z2 - z1) / len) * hw, nz = ((x2 - x1) / len) * hw;
    const a = [x1 + nx, y, z1 + nz], bb = [x1 - nx, y, z1 - nz], c = [x2 - nx, y, z2 - nz], d = [x2 + nx, y, z2 + nz];
    b.tri(a, c, bb, UP);
    b.tri(a, d, c, UP);
  }
  const seg = 8;
  for (let i = 2; i + 2 < p.length; i += 2) addDisc(b, p[i], p[i + 1], hw, y, seg);
}
function addDisc(b, x, z, r, y, seg) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    b.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], UP);
  }
}

// 多角形（[x0, y0, ...]）を高さ y の平面として塗る
function addPolygon(b, p, y) {
  const ring = openRing(p);
  const contour = [];
  for (let i = 0; i < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
  if (contour.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [i, j, k] of tris) {
    const A = contour[i], B = contour[j], C = contour[k];
    // 上から見て反時計回り（法線が上）になるよう並べる
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cross > 0) b.tri([A.x, y, A.y], [C.x, y, C.y], [B.x, y, B.y], UP);
    else b.tri([A.x, y, A.y], [B.x, y, B.y], [C.x, y, C.y], UP);
  }
}

// 建物：底面の多角形を高さ h まで立ち上げる（壁と屋上）
function addBuilding(b, p, h, color) {
  const ring = openRing(p);
  const n = ring.length / 2;
  if (n < 3) return;
  const ccw = polygonArea(ring) > 0; // 地図座標（y が南）での向き
  const roof = color.map((c) => Math.min(1, c * 1.25));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = ring[2 * i], z1 = ring[2 * i + 1], x2 = ring[2 * j], z2 = ring[2 * j + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    // 外向きの法線
    let nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
    if (!ccw) (nx = -nx), (nz = -nz);
    const a = [x1, 0, z1], bb = [x2, 0, z2], c = [x2, h, z2], d = [x1, h, z1];
    const nrm = [nx, 0, nz];
    if (ccw) {
      b.tri(a, c, bb, nrm, color);
      b.tri(a, d, c, nrm, color);
    } else {
      b.tri(a, bb, c, nrm, color);
      b.tri(a, c, d, nrm, color);
    }
  }
  const contour = [];
  for (let i = 0; i < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = contour[i], B = contour[j], C = contour[k];
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cross > 0) b.tri([A.x, h, A.y], [C.x, h, C.y], [B.x, h, B.y], UP, roof);
    else b.tri([A.x, h, A.y], [B.x, h, B.y], [C.x, h, C.y], UP, roof);
  }
}

const hex = (s) => new THREE.Color(s);
// 面の裏表を気にしなくて済むよう両面を描く（法線は自分で付けているので明るさは正しい）
const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts });

// 区間の地図から、動かない物（地面・道路・建物など）をまとめた立体を作る
function buildWorld(map) {
  const group = new THREE.Group();
  const { minX, minY, maxX, maxY } = map.bounds;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 2000, maxY - minY + 2000), mat(GROUND));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
  group.add(ground);

  // 公園・水域（種類ごとに 1 つにまとめる）
  const areaBuilders = {};
  for (const a of map.areas) {
    const b = (areaBuilders[a.k] ??= new GeometryBuilder());
    for (const r of a.r) addPolygon(b, r, a.k === 'water' ? Y.water : Y.area);
  }
  for (const [k, b] of Object.entries(areaBuilders)) group.add(new THREE.Mesh(b.build(), mat(hex(AREA_COLORS[k] ?? AREA_COLORS.grass))));

  // 川と線路（トンネルは描かない）
  const lineBuilders = {};
  for (const l of map.lines) {
    if (l.u) continue;
    const b = (lineBuilders[l.k] ??= new GeometryBuilder());
    addRibbon(b, l.p, l.w, l.k === 'river' ? Y.river : Y.rail);
  }
  for (const [k, b] of Object.entries(lineBuilders)) group.add(new THREE.Mesh(b.build(), mat(hex((LINE_STYLES[k] ?? LINE_STYLES.rail).color))));

  // 道路（歩道・車道）と一方通行の矢印
  const paths = new GeometryBuilder(), roads = new GeometryBuilder(), arrows = new GeometryBuilder();
  for (const r of map.roads) addRibbon(r.path ? paths : roads, r.p, r.w, r.path ? Y.path : Y.road);
  for (const r of map.roads) {
    for (const [x, z, angle] of r.arrows) {
      // 2D版と同じ矢じりの形（長さ約 3.6m）。angle は北が 0、時計回り
      const s = Math.sin(angle), c = Math.cos(angle);
      const at = (u, v) => [x + u * c - v * s, Y.arrow, z + u * s + v * c];
      arrows.tri(at(0, -2.2), at(-1.6, 1.4), at(0, 0.6), UP);
      arrows.tri(at(0, -2.2), at(0, 0.6), at(1.6, 1.4), UP);
    }
  }
  group.add(new THREE.Mesh(paths.build(), mat(PATH)));
  group.add(new THREE.Mesh(roads.build(), mat(ROAD)));
  group.add(new THREE.Mesh(arrows.build(), mat(ARROW, { side: THREE.DoubleSide })));

  // 建物（高い建物ほど少し明るく）。TILE ごとに 1 つの立体にまとめる
  const tileBuilders = new Map();
  const heights = []; // 建物ごとの高さ m（高さが分からない建物は推定した値）
  const tileOf = []; // 建物ごとのまとまりの名前
  map.buildings.forEach((bd, i) => {
    const area = Math.abs(polygonArea(openRing(bd.p)));
    const h = map.heights?.[i] > 0 ? map.heights[i] : guessHeight(area, i);
    const key = `${Math.floor((bd.minX + bd.maxX) / 2 / TILE)},${Math.floor((bd.minY + bd.maxY) / 2 / TILE)}`;
    if (!tileBuilders.has(key)) tileBuilders.set(key, new GeometryBuilder(true));
    const t = Math.min(1, h / 80);
    const v = 0.2 + 0.12 * t + (((i * 7919) % 100) / 100) * 0.04;
    addBuilding(tileBuilders.get(key), bd.p, h, [v, v * 1.03, v * 1.12]);
    heights.push(h);
    tileOf.push(key);
  });
  const tiles = new Map();
  for (const [key, b] of tileBuilders) {
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.userData.opacity = 1;
    tiles.set(key, mesh);
    group.add(mesh);
  }
  group.userData = { tiles, heights, tileOf };

  // ゴール：地面の輪と、遠くから見える光の柱
  const g = map.goal;
  const ring = new THREE.Mesh(new THREE.RingGeometry(g.radius - 1.2, g.radius, 48), new THREE.MeshBasicMaterial({ color: 0x50c878 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(g.x, Y.signal + 0.02, g.y);
  group.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(g.radius, 48), new THREE.MeshBasicMaterial({ color: 0x50c878, transparent: true, opacity: 0.18 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(g.x, Y.signal, g.y);
  group.add(disc);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 120, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x50c878, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  beam.position.set(g.x, 60, g.y);
  group.add(beam);

  return group;
}

// 自転車（黄色。前に赤い印）と、乗っている人
function makeBike(color = 0xffcc33, nose = 0xe8443a, opacity = 1) {
  const transparent = opacity < 1;
  const o = { transparent, opacity, depthWrite: !transparent };
  const bike = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 1.7), mat(color, o));
  frame.position.y = 0.55;
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.4), mat(nose, o));
  front.position.set(0, 0.95, -0.75);
  const rider = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.4), mat(color, o));
  rider.position.set(0, 1.45, 0.1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), mat(0xf2d0a9, o));
  head.position.set(0, 1.98, 0.05);
  bike.add(frame, front, rider, head);
  return bike;
}

// 電車 1 両：銀色の車体に黄緑の帯、先頭車は黒い窓
const CAR_LEN = 19.2, CAR_W = 2.95, CAR_H = 3.6;
function makeTrainCar(lead) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_W, CAR_H, CAR_LEN), mat(0xd4d8de));
  body.position.y = CAR_H / 2 + 0.4;
  const band = new THREE.Mesh(new THREE.BoxGeometry(CAR_W + 0.04, 0.45, CAR_LEN - 0.4), mat(0x8cc63f));
  band.position.y = 2.1;
  const windows = new THREE.Mesh(new THREE.BoxGeometry(CAR_W + 0.03, 0.8, CAR_LEN - 2), mat(0x2a3038));
  windows.position.y = 2.95;
  car.add(body, band, windows);
  if (lead) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(CAR_W - 0.3, 1.2, 0.1), mat(0x15181d));
    cab.position.set(0, 3, -CAR_LEN / 2 - 0.02);
    car.add(cab);
  }
  car.traverse((m) => m.material && (m.material.transparent = true));
  return car;
}

function makeCar(color) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.4), mat(color));
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), mat(0x1e232b));
  cabin.position.set(0, 1.3, 0.2);
  car.add(body, cabin);
  return car;
}

const SIGNAL_COLORS = { green: 0x3ccf6e, yellow: 0xffc93c, red: 0xff4d4d };

export function createRenderer3D(canvas) {
  // preserveDrawingBuffer：画面の保存（スクリーンショット）で描いた絵が読めるように
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(SKY);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x2a2420, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.4);
  sun.position.set(-0.5, 1, 0.3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, FOG_FAR + 50);

  let world = null; // 今の区間の動かない物
  let worldMap = null;
  const player = makeBike();
  const ghost = makeBike(0xe8ecf4, 0x9aa0aa, 0.45);
  scene.add(player, ghost);
  const train = [];
  const trainGroup = new THREE.Group();
  scene.add(trainGroup);
  const agentMeshes = new Map(); // 車・歩行者 → 立体（使い回す）
  const agentGroup = new THREE.Group();
  scene.add(agentGroup);
  let signalMeshes = []; // [{ light, pad, group }]
  const signalGroup = new THREE.Group();
  scene.add(signalGroup);
  let camAngle = null;

  // 区間が変わったら作り直す
  function setMap(map) {
    if (world) {
      scene.remove(world);
      world.traverse((m) => {
        m.geometry?.dispose();
        m.material?.dispose();
      });
    }
    world = buildWorld(map);
    worldMap = map;
    scene.add(world);
    camAngle = null;
  }

  // 信号：交差点の地面の円（2D版の丸と同じ範囲）と、柱の上の灯り
  function syncSignals(obs) {
    if (signalMeshes.obs === obs) return;
    signalGroup.clear();
    signalMeshes = [];
    signalMeshes.obs = obs;
    for (const g of obs.signals) {
      for (const [x, z] of g.nodes) {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(x, Y.signal, z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6), mat(0x5a606b));
        pole.position.set(x + 2.6, 2.1, z);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        light.position.set(x + 2.6, 4.4, z);
        signalGroup.add(pad, pole, light);
        signalMeshes.push({ group: g, pad, light });
      }
    }
  }

  function syncAgents(obs) {
    const alive = new Set(obs.agents);
    for (const [a, m] of agentMeshes) {
      if (!alive.has(a)) {
        agentGroup.remove(m);
        agentMeshes.delete(a);
      }
    }
    for (const a of obs.agents) {
      let m = agentMeshes.get(a);
      if (!m) {
        if (a.kind === 'car') {
          m = makeCar(a.color);
        } else {
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.65, 8), mat(0xc9b8ff));
          m.geometry.translate(0, 0.83, 0);
        }
        agentMeshes.set(a, m);
        agentGroup.add(m);
      }
      m.position.set(a.x, 0, a.y);
      m.rotation.y = -(a.angle ?? 0);
    }
  }

  function syncTrain(game) {
    const route = game.map.trainRoute;
    const show = game.inRace && route;
    trainGroup.visible = Boolean(show);
    if (!show) return;
    const n = carCount(route);
    while (train.length < n) {
      const car = makeTrainCar(train.length === 0);
      train.push(car);
      trainGroup.add(car);
    }
    const front = frontDistance(route, game.trainProgress);
    train.forEach((car, i) => {
      car.visible = i < n;
      if (i >= n) return;
      // 車両の前後の位置から向きを決める（曲線でも線路に沿う）
      const head = pointAt(route, front - 20 * i - 0.4);
      const tail = pointAt(route, front - 20 * (i + 1) + 0.4);
      car.position.set((head.x + tail.x) / 2, 0, (head.y + tail.y) / 2);
      car.rotation.y = -Math.atan2(head.x - tail.x, -(head.y - tail.y));
      const under = head.under || tail.under;
      car.traverse((m) => m.material && (m.material.opacity = under ? 0.25 : 1));
    });
  }

  // カメラから自転車（の頭の高さ）までの線をさえぎる建物のまとまりを透かす
  function fadeOccluders(game, dt) {
    const { tiles, heights, tileOf } = world.userData;
    const p = game.player;
    const ax = camera.position.x, ay = camera.position.y, az = camera.position.z;
    const bx = p.x, by = 1.5, bz = p.y;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(len / 1.5));
    const fade = new Set();
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const cell = worldMap.cells.get(cellKey(x, z));
      if (!cell) continue;
      for (const b of cell.buildings) {
        if (fade.has(tileOf[b.id]) || y > heights[b.id]) continue;
        if (x >= b.minX && x <= b.maxX && z >= b.minY && z <= b.maxY && insidePolygon(x, z, b.p)) fade.add(tileOf[b.id]);
      }
    }
    for (const [key, mesh] of tiles) {
      const target = fade.has(key) ? SEE_THROUGH : 1;
      const o = mesh.userData.opacity;
      if (o === target) continue;
      const next = target < o ? Math.max(target, o - FADE_SPEED * dt) : Math.min(target, o + FADE_SPEED * dt);
      mesh.userData.opacity = next;
      const transparent = next < 1;
      if (mesh.material.transparent !== transparent) {
        mesh.material.transparent = transparent;
        mesh.material.depthWrite = !transparent; // 透かした建物の向こうも描く
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = next;
      mesh.renderOrder = transparent ? 1 : 0;
    }
  }

  function placeCamera(game, dt) {
    const p = game.player;
    // 向きはなめらかに追いかける（急に回ると酔うので）
    if (camAngle === null) camAngle = p.angle;
    let d = p.angle - camAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    camAngle += d * Math.min(1, CAMERA_TURN * dt);
    const fx = Math.sin(camAngle), fz = -Math.cos(camAngle);
    camera.position.set(p.x - fx * CAMERA_BACK, CAMERA_UP, p.y - fz * CAMERA_BACK);
    camera.lookAt(p.x + fx * LOOK_AHEAD, 1, p.y + fz * LOOK_AHEAD);
  }

  let lastTime = performance.now();

  const r3d = {
    mode: '3d',
    // HUD：3D では地図を真上から見ていないので、ランドマークの名前とゴール方向の矢印は出さない
    // （ゴールは光の柱とミニマップで分かる）
    hud: { ppm: 1, landmarks: false, goalPointer: false },

    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    drawWorld(game, hudCtx) {
      // HUD のキャンバスは毎回まっさらにする（3D の世界が透けて見える）
      hudCtx.setTransform(1, 0, 0, 1, 0, 0);
      hudCtx.clearRect(0, 0, hudCtx.canvas.width, hudCtx.canvas.height);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (!game.map) return;
      if (game.map !== worldMap) setMap(game.map);

      const p = game.player;
      player.position.set(p.x, 0, p.y);
      player.rotation.y = -p.angle;
      ghost.visible = Boolean(game.ghostPose);
      if (game.ghostPose) {
        ghost.position.set(game.ghostPose.x, 0, game.ghostPose.y);
        ghost.rotation.y = -game.ghostPose.angle;
      }

      syncSignals(game.obstacles);
      for (const s of signalMeshes) {
        const c = SIGNAL_COLORS[signalState(s.group, game.obstacles.clock)];
        s.light.material.color.setHex(c);
        s.pad.material.color.setHex(c);
      }
      syncAgents(game.obstacles);
      syncTrain(game);
      placeCamera(game, dt);
      fadeOccluders(game, dt);
      renderer.render(scene, camera);
    },
  };
  window.render3d = { renderer, scene, camera }; // デバッグ・自動テスト用
  return r3d;
}
