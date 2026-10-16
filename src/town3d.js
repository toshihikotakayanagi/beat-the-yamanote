// 3D版の街の物（その 6〜13）：季節と天気の飾り・動物・縁日・移動販売・船・電車の開いたドア・表彰台・タイトルのミニチュア・
// 花火・富士山・大きな車・公園や配達の人・アーケード・大型ビジョン・自転車の飾り・寺社・交番・首都高・夜の店・乗客・雲と虹・
// 東京湾の船・駅員さん・学校・ガソリンスタンド・駐車場・銭湯・噴水・シェアサイクル・撮り鉄・航空障害灯・掲示板・病院・郵便局・
// 銀行・自動ドア・はとバス・宅配便・稲光・音符・墓地・屋上の看板と給水塔・立体駐車場・ペットショップと花屋・消防署・お散歩カート・
// 盆踊り・建設中のビル・ロータリー・川沿いの桜・ランニング大会・選挙カー・屋台村・カモと白鳥・打ち水・窓ふきのゴンドラなど。
// どれも見た目だけ。モデルは tools/build-city5.py〜build-city12.py で作る。
// 置く処理（add…Props）は src/render3d.js の区間の立体を作る手順から、動かす処理は createRenderer3D の中から呼ぶ。
// 共通の部品（材質・形を作る道具・置ける場所の判定など）は src/render3d.js から読み込む（お互いに読み込み合うので、
// このファイルのいちばん外側では、render3d.js の const や class を使わない。関数の中で使うのはよい）
import * as THREE from 'three';
import { cellKey, surfaceAt } from './map.js';
import {
  CAR_BODY_MAT,
  CAR_LIGHT_MAT,
  DECK_T,
  FENCE_OFF,
  FENCE_STATION_CLEAR,
  FURNITURE_CLEAR_START,
  GUARD_RADIUS,
  GUARD_STATIONS,
  GeometryBuilder,
  NEON_DISTRICTS,
  SCRAMBLE,
  SHOP_STREETS,
  STREET_GLOW_MAT,
  STREET_MAT,
  Y,
  addDeck,
  addModelParts,
  addOffsetStrip,
  bikes,
  carGeometry,
  city3,
  faceTo,
  fillBike,
  freeSpot,
  inBounds,
  insidePolygon,
  latLonXY,
  loadModelParts,
  nearestRoadPoint,
  onTrack,
  pillarSpots,
  polygonArea,
  roadHeightAt,
  scenery
} from './render3d.js';

// ---- 街の物 その 6（Blender で作ったモデル。tools/build-city5.py） ----
// 動物（電線のカラス・地面のハト・ネコ）・季節の飾り・縁日・キッチンカー・川を進む船・雨と雪の日の物。
// 犬の散歩・移動販売の車・おみこしは道を進む（syncRiders）。電車の開いたドア・表彰台・タイトル画面のミニチュアも。どれも見た目だけ
const CITY5_URL = 'data/models/city5.glb';
const CITY5_NAMES = {
  crow: 'C5_Crow', crowFlyA: 'C5_CrowFlyA', crowFlyB: 'C5_CrowFlyB', pigeon: 'C5_Pigeon', pigeonFlyA: 'C5_PigeonFlyA', pigeonFlyB: 'C5_PigeonFlyB',
  cat0: 'C5_Cat0', cat1: 'C5_Cat1', cat2: 'C5_Cat2', dogWalk0: 'C5_DogWalk0', dogWalk1: 'C5_DogWalk1',
  tanabata: 'C5_Tanabata', furin: 'C5_FurinRack', xmas: 'C5_XmasTree', treeLights: 'C5_TreeLights', petal: 'C5_Petal',
  yatai0: 'C5_Yatai0', yatai1: 'C5_Yatai1', yatai2: 'C5_Yatai2', lanterns: 'C5_Lanterns', mikoshi: 'C5_Mikoshi',
  yakiimo: 'C5_Yakiimo', foodTruck: 'C5_FoodTruck', chirigami: 'C5_Chirigami', cruise: 'C5_Cruise', canoe: 'C5_Canoe',
  puddle: 'C5_Puddle', snowman: 'C5_Snowman', snowPile: 'C5_SnowPile', doorOpen: 'C5_DoorOpen',
  podium: 'C5_Podium', champion: 'C5_Champion', medal: 'C5_Medal',
  miniBldg0: 'C5_MiniBldg0', miniBldg1: 'C5_MiniBldg1', miniBldg2: 'C5_MiniBldg2', miniBldg3: 'C5_MiniBldg3',
  miniTree: 'C5_MiniTree', miniTower: 'C5_MiniTower', miniSkytree: 'C5_MiniSkytree', miniStation: 'C5_MiniStation',
};
const city5 = { geos: null, parts: null, done: false };
loadModelParts(CITY5_URL, CITY5_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city5.parts = parts; // 表彰台の人とメダルは、色を変えて作り直す
    city5.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 6）のモデルを読み込めませんでした: ${CITY5_URL}`, e))
  .finally(() => (city5.done = true));
const TREE_LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // 冬のイルミネーション（昼は消す）
const FESTIVAL_NAME = /神社|稲荷|八幡|天神|大社|神宮|宮$/; // 縁日を出す寺社（名前で選ぶ）
const FESTIVALS_MAX = 2; // 1 区間に出す縁日の数
const CROWS_MAX = 36;
const PUDDLES = 320; // 雨の日の水たまりの数（1 区間）
const SNOW_PILES = 260;

// 区間ごとに決まる乱数（同じ区間は毎回同じ置き方）
function seededRng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 道 r の、地点 (x, z) にいちばん近い線分の向き（長さ 1）
function roadDirAt(r, x, z) {
  let bi = 0, bd = Infinity;
  for (let k = 0; k + 3 < r.p.length; k += 2) {
    const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - x, (r.p[k + 1] + r.p[k + 3]) / 2 - z);
    if (d < bd) (bd = d), (bi = k);
  }
  const l = Math.hypot(r.p[bi + 2] - r.p[bi], r.p[bi + 3] - r.p[bi + 1]) || 1;
  return [(r.p[bi + 2] - r.p[bi]) / l, (r.p[bi + 3] - r.p[bi + 1]) / l];
}

function addCity5Props(group, map, roadHeights) {
  const g = city5.geos;
  if (!g) return;
  const rnd = seededRng(map.id ?? 'city5');
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  // 置き場所：static（いつも）・spring〜winter（その季節だけ）・rain / snow（その天気だけ）
  const targets = { static: group };
  const seasonal = {}, weather = {};
  for (const k of ['spring', 'summer', 'autumn', 'winter']) group.add((targets[k] = seasonal[k] = new THREE.Group()));
  for (const k of ['rain', 'snow']) group.add((targets[k] = weather[k] = new THREE.Group()));
  group.userData.seasonal = seasonal;
  group.userData.weatherProps = weather;
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (where, key, x, h, z, rotY, sx = 1, sy = sx, sz = sx) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);

  // ---- カラス（電線の上）とハト（駅前と公園の地面に群れで）。自転車が近づくと飛び立つ（syncCity5） ----
  const birds = [];
  const wire = group.userData.wireSegs ?? [];
  for (let i = 0; i + 5 < wire.length && birds.filter((b) => b.kind === 'crow').length < CROWS_MAX; i += 6) {
    if (rnd() > 0.1) continue;
    const ax = wire[i], ay = wire[i + 1], az = wire[i + 2], bx = wire[i + 3], by = wire[i + 4], bz = wire[i + 5];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const n = 1 + Math.floor(rnd() * 3);
    const t0 = 0.2 + rnd() * 0.4;
    for (let k = 0; k < n; k++) {
      const t = t0 + k * (0.5 / l);
      const s = rnd() < 0.5 ? 1 : -1;
      birds.push({ kind: 'crow', home: [ax + dx * t, ay + (by - ay) * t + 0.01, az + dz * t], rot: along((-dz / l) * s, (dx / l) * s) });
    }
  }
  const flock = (cx, cz, n) => {
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 4, z = cz + (rnd() - 0.5) * 4;
      if (free(x, z)) birds.push({ kind: 'pigeon', home: [x, (surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area) + 0.01, z], rot: rnd() * Math.PI * 2 });
    }
  };
  for (const st of stations) {
    for (let tries = 0; tries < 20; tries++) {
      const a = rnd() * Math.PI * 2, d = 15 + rnd() * 25;
      const x = st.x + Math.cos(a) * d, z = st.y + Math.sin(a) * d;
      if (free(x, z) && surfaceAt(map, x, z).kind === 'path') {
        flock(x, z, 6 + Math.floor(rnd() * 5));
        break;
      }
    }
  }
  const parks = (map.areas ?? []).filter((a) => a.k === 'park' && a.r?.[0]?.length >= 6)
    .map((a) => {
      const p = a.r[0];
      let cx = 0, cz = 0;
      for (let i = 0; i < p.length; i += 2) (cx += p[i]), (cz += p[i + 1]);
      return { x: cx / (p.length / 2), z: cz / (p.length / 2), area: Math.abs(polygonArea(p)) };
    })
    .filter((pk) => inBounds(map, pk.x, pk.z))
    .sort((a, b) => b.area - a.area);
  for (const pk of parks.slice(0, 3)) if (free(pk.x, pk.z)) flock(pk.x, pk.z, 5 + Math.floor(rnd() * 4));
  if (birds.length) {
    const meshes = {};
    for (const kind of ['crow', 'pigeon']) {
      const n = birds.filter((b) => b.kind === kind).length;
      if (!n) continue;
      meshes[kind] = ['', 'FlyA', 'FlyB'].map((pose) => {
        const m = new THREE.InstancedMesh(g[kind + pose].body, STREET_MAT, n);
        m.frustumCulled = false;
        m.userData.keepUnculled = true;
        m.castShadow = true;
        m.name = kind + pose; // デバッグ・自動テスト用
        group.add(m);
        return m;
      });
    }
    for (const b of birds) Object.assign(b, { pos: [...b.home], vel: [0, 0, 0], state: 'sit', t: 0 });
    group.userData.birds = { list: birds, meshes };
  }

  // ---- ネコ：小さな建物（家）の壁ぎわに座る ----
  const houses = map.buildings.filter((b) => b.p.length >= 8 && Math.abs(polygonArea(b.p)) < 220);
  for (let k = 0, placed = 0; k < 200 && placed < 14 && houses.length; k++) {
    const b = houses[Math.floor(rnd() * houses.length)];
    const i = 2 * Math.floor(rnd() * (b.p.length / 2 - 1));
    const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 2) continue;
    let nx = -(bz - az) / l, nz = (bx - ax) / l;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
    const x = mx + nx * 0.5, z = mz + nz * 0.5;
    if (!free(x, z)) continue;
    put('static', `cat${placed % 3}`, x, surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area, z, along(nx, nz) + (rnd() - 0.5) * 1.2);
    placed++;
  }

  // ---- 季節の飾り：駅のまわりの空いた地面に、夏は七夕の笹飾りと風鈴の棚、冬はクリスマスツリー ----
  for (const st of stations) {
    let done = false;
    for (const dist of [24, 36, 50]) {
      for (let k = 0; k < 12 && !done; k++) {
        const a = (k / 12) * Math.PI * 2 + 0.26;
        const x = st.x + Math.cos(a) * dist, z = st.y + Math.sin(a) * dist;
        const near = nearestRoadPoint(map, x, z, false);
        if (!near || near.d > 12 || near.d < 3) continue;
        const fx = (near.x - x) / near.d, fz = (near.z - z) / near.d; // 道の方
        const sx = -fz, sz = fx; // 道に沿う向き
        const corners = [[0, 0], [2.6, 0], [-2.6, 0], [0, 1.5], [0, -1.5], [2.6, 1.2], [-2.6, 1.2]];
        if (!corners.every(([u, w]) => free(x + sx * u + fx * w, z + sz * u + fz * w, false))) continue;
        put('summer', 'tanabata', x - sx * 1.8, Y.area, z - sz * 1.8, 0);
        (group.userData.taken ??= []).push([x, z, 4]); // 季節の飾りの場所（addCity7Props でほかの物を置かない）
        put('summer', 'furin', x + sx * 1.2, Y.area, z + sz * 1.2, along(fx, fz));
        put('winter', 'xmas', x, Y.area, z, rnd() * 6);
        done = true;
      }
      if (done) break;
    }
  }
  // 冬のイルミネーション：駅から 450m 以内の丸い木（tools/build-trees.py の TREE_Round）
  for (const m of group.userData.roundTrees ?? []) {
    const x = m.elements[12], z = m.elements[14];
    if (stations.some((st) => Math.hypot(st.x - x, st.y - z) < 450)) (lists.get('winter|treeLights') ?? lists.set('winter|treeLights', []).get('winter|treeLights')).push(m);
  }

  // ---- 縁日：名前に「神社」などの付く寺社のいちばん近い道ばたに、屋台を並べ、上にちょうちんの列 ----
  const festivals = [];
  for (const l of (map.landmarks ?? []).filter((l) => l.k === 'worship' && FESTIVAL_NAME.test(l.n) && inBounds(map, l.x, l.y))) {
    if (festivals.length >= FESTIVALS_MAX) break;
    const near = nearestRoadPoint(map, l.x, l.y, false);
    if (!near || near.d > 60 || near.road.e) continue;
    const r = near.road;
    const [dx, dz] = roadDirAt(r, near.x, near.z);
    let nx = -dz, nz = dx; // 道の横（寺社の側）
    if ((l.x - near.x) * nx + (l.y - near.z) * nz < 0) (nx = -nx), (nz = -nz);
    const placed = [];
    for (let k = -2; k <= 2; k++) {
      const cx = near.x + dx * k * 3 + nx * (r.w / 2 + 1.5), cz = near.z + dz * k * 3 + nz * (r.w / 2 + 1.5);
      const ok = [[0, 0], [1.2, 0], [-1.2, 0], [0, 0.9], [0, -0.9]].every(([u, w]) => free(cx + dx * u + nx * w, cz + dz * u + nz * w, false));
      if (!ok) continue;
      put('static', `yatai${(k + 2) % 3}`, cx, Y.area, cz, along(-nx, -nz)); // 店の前を道へ向ける
      placed.push([cx, cz]);
    }
    if (placed.length < 2) continue;
    const [ax, az] = placed[0], [bx, bz] = placed[placed.length - 1];
    const span = Math.hypot(bx - ax, bz - az) + 3;
    // ちょうちんの列（屋台の前の上、端から端まで。モデルは X の向きに 8m）
    put('static', 'lanterns', ax - dx * 1.5 - nx * 1.0, 3.1, az - dz * 1.5 - nz * 1.0, faceTo(dx, dz), span / 8, 1, 1);
    festivals.push({ x: near.x, z: near.z, name: l.n });
    for (const [px, pz] of placed) (group.userData.taken ??= []).push([px, pz, 2]);
  }
  group.userData.festivals = festivals;

  // ---- キッチンカー：大きい公園のそばの車道の端に止める（開いた窓を歩道の側へ） ----
  let trucks = 0;
  for (const pk of parks) {
    if (trucks >= 2) break;
    const near = nearestRoadPoint(map, pk.x, pk.z, true);
    if (!near || near.d > 60 || near.road.e || near.road.w < 6) continue;
    const [dx, dz] = roadDirAt(near.road, near.x, near.z);
    const rx = -dz, rz = dx; // 進む向きの右（窓の側）
    const x = near.x + rx * (near.road.w / 2 - 1.1), z = near.z + rz * (near.road.w / 2 - 1.1);
    if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < FURNITURE_CLEAR_START)) continue;
    put('static', 'foodTruck', x, Y.road, z, along(dx, dz));
    trucks++;
  }

  // ---- 雨の日の水たまりと、雪の日の道の端の雪の山・雪だるま ----
  const segs = [];
  let total = 0;
  for (const r of map.roads) {
    if (r.e) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const len = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
      if (len < 2) continue;
      total += len * Math.min(r.w, 12);
      segs.push({ r, i, len, cum: total });
    }
  }
  const pickSeg = () => {
    const v = rnd() * total;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].cum < v) lo = mid + 1;
      else hi = mid;
    }
    return segs[lo];
  };
  const onSeg = (sg, t, lat) => {
    const { r, i, len } = sg;
    const dx = (r.p[i + 2] - r.p[i]) / len, dz = (r.p[i + 3] - r.p[i + 1]) / len;
    return { x: r.p[i] + dx * len * t - dz * lat, z: r.p[i + 1] + dz * len * t + dx * lat, dx, dz, h: roadHeightAt(roadHeights, r, i / 2, t) };
  };
  if (segs.length) {
    for (let k = 0; k < PUDDLES; k++) {
      const sg = pickSeg();
      const q = onSeg(sg, rnd(), (rnd() - 0.5) * sg.r.w * 0.8);
      if (q.h > 0.3 || !inBounds(map, q.x, q.z)) continue;
      const s = 0.6 + rnd() * 1.1;
      put('rain', 'puddle', q.x, (sg.r.path ? Y.path + 0.02 : Y.signal + 0.006), q.z, rnd() * 6.28, s, 1, s);
      (group.userData.puddles ??= []).push([q.x, q.z, s * 0.85]); // 水しぶき（syncSplash）
    }
    for (let k = 0; k < SNOW_PILES; k++) {
      const sg = pickSeg();
      if (sg.r.path || sg.r.w < 6) continue;
      const side = rnd() < 0.5 ? 1 : -1;
      const q = onSeg(sg, rnd(), side * (sg.r.w / 2 - 0.5));
      if (q.h > 0.3 || !inBounds(map, q.x, q.z)) continue;
      put('snow', 'snowPile', q.x, Y.road, q.z, along(q.dx, q.dz), 0.8 + rnd() * 0.6);
    }
    for (let k = 0, placed = 0; k < 400 && placed < 14; k++) {
      const sg = pickSeg();
      const side = rnd() < 0.5 ? 1 : -1;
      const q = onSeg(sg, rnd(), side * (sg.r.w / 2 + 2.5));
      if (q.h > 0.3 || !free(q.x, q.z, false)) continue;
      put('snow', 'snowman', q.x, Y.area, q.z, along(-q.dz * side, q.dx * side) + Math.PI);
      placed++;
    }
  }

  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = targets[where];
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, key === 'treeLights' ? TREE_LIGHT_MAT : STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && key !== 'puddle';
      if (key === 'puddle') mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  // ---- 川を進む船：観光船・屋形船・カヌー（幅 8m 以上の川を行き来する） ----
  const boats = [];
  let bi = 0;
  for (const l of map.lines) {
    if (l.k !== 'river' || l.w < 8) continue;
    const cum = [0];
    for (let i = 0; i + 3 < l.p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(l.p[i + 2] - l.p[i], l.p[i + 3] - l.p[i + 1]));
    const len = cum[cum.length - 1];
    if (len < 150) continue;
    const n = Math.min(3, 1 + Math.floor(len / 400));
    for (let j = 0; j < n; j++, bi++) {
      let kind = ['cruise', 'yakata', 'canoe'][bi % 3];
      if (kind === 'cruise' && l.w < 14) kind = 'canoe';
      const geo = kind === 'yakata' ? scenery.geos?.yakata : g[kind];
      if (!geo) continue;
      const o = new THREE.Group();
      const body = new THREE.Mesh(geo.body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      if (geo.glow) o.add(new THREE.Mesh(geo.glow, STREET_GLOW_MAT));
      o.name = `boat-${kind}`; // デバッグ・自動テスト用
      group.add(o);
      const lat = Math.max(0, l.w / 2 - (kind === 'cruise' ? 5 : kind === 'yakata' ? 4 : 2.5));
      boats.push({ o, kind, p: l.p, cum, len, s: (len * (j + 0.5)) / n, dir: j % 2 ? 1 : -1, speed: { cruise: 2.6, yakata: 1.8, canoe: 1.3 }[kind], lat, bob: rnd() * 6 });
    }
  }
  group.userData.boats = boats;
}

// ---- 街の物 その 7（Blender で作ったモデル。tools/build-city6.py） ----
// 季節の行事の飾り（鯉のぼり・ハロウィンのかぼちゃ・門松としめ飾り）・工事現場の警備員・公園の人・商店街のアーケード・大型ビジョン。
// 大きな車・ジョギングやベビーカーの人・配達の人は道を進む（syncRiders）。花火・富士山・自転車の飾りも。どれも見た目だけ
const CITY6_URL = 'data/models/city6.glb';
const CITY6_NAMES = {
  burst: 'C6_Burst', koinobori: 'C6_Koinobori', pumpkins: 'C6_Pumpkins', kadomatsu: 'C6_Kadomatsu', shimekazari: 'C6_Shimekazari',
  fuji: 'C6_Fuji', fujiSnow: 'C6_FujiSnow', openBus: 'C6_OpenBus', tanker: 'C6_Tanker', mover: 'C6_Mover', garbage: 'C6_Garbage', adTruck: 'C6_AdTruck',
  guard: 'C6_Guard', guardArm: 'C6_GuardArm', jogger: 'C6_Jogger', stroller: 'C6_Stroller', benchSitter: 'C6_BenchSitter', kids: 'C6_Kids', playBall: 'C6_PlayBall',
  courier: 'C6_Courier', cargoBike: 'C6_CargoBike', arcadeRoof: 'C6_ArcadeRoof', arcadePost: 'C6_ArcadePost', arcadeGate: 'C6_ArcadeGate', vision: 'C6_Vision',
  bag: 'C6_Bag', flowers: 'C6_Flowers', backpack: 'C6_Backpack', packFlowers: 'C6_PackFlowers', scarfRing: 'C6_ScarfRing', scarfTail: 'C6_ScarfTail',
};
const city6 = { geos: null, done: false };
loadModelParts(CITY6_URL, CITY6_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city6.geos = geos;
    for (const b of bikes) if (b.userData.accessory) fillBike(b); // 自転車の飾りを付け直す
  })
  .catch((e) => console.warn(`街の物（その 7）のモデルを読み込めませんでした: ${CITY6_URL}`, e))
  .finally(() => (city6.done = true));
const GUARD_SHOULDER = [0.21, 1.42, 0]; // 警備員の右肩（tools/build-city6.py）
const ARCADE_STEP = 4; // アーケードの屋根 1 区切りの長さ m
// 大型ビジョンを付ける繁華街（render3d.js の値を使うので、読み込み合いの順番に関係なく使えるよう関数にする）
const visionSpots = () => [...NEON_DISTRICTS, { lat: SCRAMBLE.lat, lon: SCRAMBLE.lon, r: 120 }];

// 大型ビジョンと宣伝トラックの画（すべての画面で 1 枚を共有し、syncCity6 で少しずつ描き変える）
const VISION_W = 256, VISION_H = 144;
const visionCanvas = document.createElement('canvas');
visionCanvas.width = VISION_W;
visionCanvas.height = VISION_H;
const visionTex = new THREE.CanvasTexture(visionCanvas);
visionTex.colorSpace = THREE.SRGBColorSpace;
const VISION_MAT = new THREE.MeshBasicMaterial({ map: visionTex });
function drawVision(t) {
  const x = visionCanvas.getContext('2d');
  const W = VISION_W, H = VISION_H;
  const scene = Math.floor(t / 6) % 4, k = (t % 6) / 6;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (scene === 0) {
    // 色が流れる背景と、横に流れる「TOKYO」
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${(t * 40) % 360}, 80%, 55%)`);
    g.addColorStop(1, `hsl(${(t * 40 + 120) % 360}, 80%, 45%)`);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.font = 'bold 64px sans-serif';
    x.fillText('TOKYO', W * 1.3 - k * W * 1.6, H / 2);
  } else if (scene === 1) {
    // 山手線の黄緑と、走る電車
    x.fillStyle = '#1b2a14';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#9acd32';
    x.fillRect(0, H - 34, W, 8);
    x.font = 'bold 30px sans-serif';
    x.fillText('山手線に勝て！', W / 2, 44);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = '#d8dce2';
      x.fillRect(((k * W * 1.5 + i * 46) % (W + 200)) - 190, H - 62, 42, 26);
      x.fillStyle = '#9acd32';
      x.fillRect(((k * W * 1.5 + i * 46) % (W + 200)) - 190, H - 46, 42, 5);
    }
  } else if (scene === 2) {
    // 色とりどりの丸
    x.fillStyle = '#10121a';
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      x.fillStyle = `hsl(${i * 40}, 85%, 60%)`;
      x.beginPath();
      x.arc(W / 2 + Math.cos(t * 1.2 + i) * 80, H / 2 + Math.sin(t * 1.7 + i * 2) * 40, 14 + 8 * Math.sin(t * 3 + i), 0, Math.PI * 2);
      x.fill();
    }
  } else {
    // 点滅する「SALE」
    x.fillStyle = Math.floor(t * 3) % 2 ? '#d8202a' : '#f2c230';
    x.fillRect(0, 0, W, H);
    x.fillStyle = Math.floor(t * 3) % 2 ? '#fff' : '#d8202a';
    x.font = 'bold 58px sans-serif';
    x.fillText('SALE', W / 2, H / 2 - 12);
    x.font = 'bold 26px sans-serif';
    x.fillText('50% OFF', W / 2, H / 2 + 36);
  }
  visionTex.needsUpdate = true;
}
drawVision(0);

// 字の板の画（アーケードの入口の名前）
function nameBoardTexture(name) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const x = cv.getContext('2d');
  x.fillStyle = '#f4ecd8';
  x.fillRect(0, 0, 512, 96);
  x.fillStyle = '#b8302a';
  x.font = 'bold 60px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(name, 256, 50, 490);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 自転車の飾り（自分の自転車だけ）：マフラー・かごの買い物袋・花束（ロードバイクは背中のリュック）
const ACCESSORY_SPOTS = {
  road: { neck: [0, 1.52, -0.16], pack: [0, 1.34, 0.175], tilt: -0.68 },
  up: { neck: [0, 1.55, 0.06], pack: [0, 1.28, 0.325], tilt: -0.34 },
  basket: [0, 0.93, -0.59], // ママチャリ・電動アシスト自転車の前かごの底
};
function attachAccessory(bike) {
  const s = bike.userData, g = city6.geos;
  s.scarfTail = null;
  if (!s.accessory || s.accessory === 'none' || (!g && s.accessory !== 'child')) return;
  const kind = s.type === 'road' || !s.type ? 'road' : 'up';
  const spot = ACCESSORY_SPOTS[kind];
  const add = (key, pos, rotX = 0) => {
    const m = new THREE.Mesh(g[key].body, STREET_MAT);
    m.position.set(...pos);
    m.rotation.x = rotX;
    m.castShadow = true;
    s.body.add(m);
    return m;
  };
  if (s.accessory === 'child') {
    // 電動アシスト自転車の後ろの子ども乗せだけ
    if (s.type === 'ebike' && city7.geos) {
      const m = new THREE.Mesh(city7.geos.child.body, STREET_MAT);
      m.position.set(...CHILD_SEAT);
      m.castShadow = true;
      s.body.add(m);
    }
  } else if (s.accessory === 'scarf') {
    add('scarfRing', spot.neck);
    s.scarfTail = add('scarfTail', [spot.neck[0], spot.neck[1] + 0.02, spot.neck[2] + 0.09]);
  } else if (kind === 'road') add(s.accessory === 'bag' ? 'backpack' : 'packFlowers', spot.pack, spot.tilt);
  else add(s.accessory === 'bag' ? 'bag' : 'flowers', ACCESSORY_SPOTS.basket);
}

function addCity6Props(group, map, roadHeights, buildingHeights) {
  const g = city6.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-6`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const seasonal = group.userData.seasonal ?? {};
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (where, key, x, h, z, rotY, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const groundY = (x, z) => (surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area);

  // ---- 季節の行事：春は家の庭に鯉のぼり、秋は家や店の前にハロウィンのかぼちゃ、冬は駅の入口に門松としめ飾り ----
  const houses = map.buildings.filter((b) => b.p.length >= 8 && Math.abs(polygonArea(b.p)) < 260);
  const besideHouse = (out, onPath) => {
    for (let k = 0; k < 40 && houses.length; k++) {
      const b = houses[Math.floor(rnd() * houses.length)];
      const i = 2 * Math.floor(rnd() * (b.p.length / 2 - 1));
      const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 3) continue;
      let nx = -(bz - az) / l, nz = (bx - ax) / l;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
      const x = mx + nx * out, z = mz + nz * out;
      if (free(x, z, onPath)) return { x, z, nx, nz };
    }
    return null;
  };
  const wind = 0.5 + rnd(); // 鯉のぼりがなびく向き（区間で同じ）
  for (let k = 0; k < 7; k++) {
    const s = besideHouse(2.2, false);
    if (s) put('spring', 'koinobori', s.x, Y.area, s.z, wind);
  }
  for (let k = 0; k < 10; k++) {
    const s = besideHouse(0.8, true);
    if (s) put('autumn', 'pumpkins', s.x, groundY(s.x, s.z), s.z, along(s.nx, s.nz));
  }
  for (const ent of group.children.filter((o) => o.name === 'entrance')) {
    ent.updateMatrixWorld(true);
    const rot = ent.rotation.y - Math.PI / 2; // 飾りの前（-z）を入口の前（ローカルの +x、道の側）へ
    const p1 = ent.localToWorld(new THREE.Vector3(0.9, 0, 3.8));
    put('winter', 'kadomatsu', p1.x, ent.position.y, p1.z, rot);
    const p2 = ent.localToWorld(new THREE.Vector3(0.48, 3.05, 0));
    put('winter', 'shimekazari', p2.x, p2.y, p2.z, rot);
  }

  // ---- 工事現場の警備員：工事中の所の手前で、赤く光る誘導灯を振る（syncCity6） ----
  const guards = [];
  for (let i = 0; i + 1 < (map.works?.length ?? 0) && guards.length < 12; i += 2) {
    const x = map.works[i], z = map.works[i + 1];
    const near = nearestRoadPoint(map, x, z, false);
    if (!near || near.d > near.road.w / 2 + 25 || near.road.e) continue;
    let vx = x - near.x, vz = z - near.z;
    const l = Math.hypot(vx, vz) || 1;
    (vx /= l), (vz /= l);
    const ux = -vz, uz = vx; // 道に沿う向き（コーンの並び。tools の addTownProps と同じ）
    const gx = near.x + vx * (near.road.w / 2 - 0.6) - ux * 6.6, gz = near.z + vz * (near.road.w / 2 - 0.6) - uz * 6.6;
    if (!inBounds(map, gx, gz)) continue;
    const o = new THREE.Group();
    o.position.set(gx, near.road.path ? Y.path : Y.road, gz);
    o.rotation.y = along(-ux, -uz); // 来る車の方を向く
    const body = new THREE.Mesh(g.guard.body, STREET_MAT);
    body.castShadow = true;
    const arm = new THREE.Group();
    arm.position.set(...GUARD_SHOULDER);
    arm.add(new THREE.Mesh(g.guardArm.body, STREET_MAT), new THREE.Mesh(g.guardArm.glow, STREET_GLOW_MAT));
    o.add(body, arm);
    o.name = 'guard'; // デバッグ・自動テスト用
    group.add(o);
    guards.push({ arm, phase: rnd() * 6 });
  }
  group.userData.guards = guards;

  // ---- 公園の人：大きい公園の中に、ベンチで休む人と、ボール遊びをする子ども（ボールは syncCity6 で行き来する） ----
  const kids = [];
  const parks = (map.areas ?? []).filter((a) => a.k === 'park' && a.r?.[0]?.length >= 6)
    .map((a) => ({ ring: a.r[0], area: Math.abs(polygonArea(a.r[0])) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 4);
  for (const pk of parks) {
    const ring = pk.ring;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) (minX = Math.min(minX, ring[i])), (maxX = Math.max(maxX, ring[i])), (minZ = Math.min(minZ, ring[i + 1])), (maxZ = Math.max(maxZ, ring[i + 1]));
    const spot = (need) => {
      for (let k = 0; k < 40; k++) {
        const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
        const a = rnd() * Math.PI * 2;
        const pts = need.map(([u, w]) => [x + Math.cos(a) * u - Math.sin(a) * w, z + Math.sin(a) * u + Math.cos(a) * w]);
        if (pts.every(([px, pz]) => insidePolygon(px, pz, ring) && free(px, pz, false))) return { x, z, a };
      }
      return null;
    };
    for (let k = 0; k < 2; k++) {
      const s = spot([[0, 0], [1, 0], [-1, 0], [0, 0.6]]);
      if (s) put('static', 'benchSitter', s.x, Y.area, s.z, -s.a);
    }
    const s = spot([[0, 0], [1.8, 0], [-1.8, 0]]);
    if (s) {
      const o = new THREE.Group();
      o.position.set(s.x, Y.area, s.z);
      o.rotation.y = -s.a;
      const body = new THREE.Mesh(g.kids.body, STREET_MAT);
      body.castShadow = true;
      const ball = new THREE.Mesh(g.playBall.body, STREET_MAT);
      ball.castShadow = true;
      o.add(body, ball);
      o.name = 'kids'; // デバッグ・自動テスト用
      group.add(o);
      kids.push({ ball, phase: rnd() * 6 });
    }
  }
  group.userData.kids = kids;

  // ---- 商店街のアーケード：名前が商店街の道（幅 14m まで）の上に屋根と柱、道の両端に入口のアーチと名前の板 ----
  const clearOfGates = (x, z) => ![map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < 25);
  const boardTex = new Map();
  for (const r of map.roads) {
    if (!r.n || !SHOP_STREETS.test(r.n) || r.e || r.w > 14) continue;
    const width = r.w + 1;
    let walked = 0, pieces = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const n = Math.max(1, Math.round(len / ARCADE_STEP));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        if (!inBounds(map, x, z) || !clearOfGates(x, z)) continue;
        // 大きな車道との交差点の上には屋根を架けない
        if ((surfaceAt(map, x, z).segs ?? []).some((sg) => sg.road !== r && !sg.road.path && sg.road.w >= 6)) continue;
        put('static', 'arcadeRoof', x, 0, z, along(ux, uz), width, 1, len / n / ARCADE_STEP);
        if ((walked + len * t) % 8 < len / n) for (const s of [-1, 1]) put('static', 'arcadePost', x - uz * s * (width / 2), Y.path, z + ux * s * (width / 2), 0);
        pieces++;
      }
      walked += len;
    }
    if (pieces < 4) continue;
    // 入口のアーチ（両端。名前の板は外を向く）
    const n2 = r.p.length / 2;
    for (const [i0, i1] of [[0, 1], [n2 - 1, n2 - 2]]) {
      const x = r.p[2 * i0], z = r.p[2 * i0 + 1];
      if (!inBounds(map, x, z) || !clearOfGates(x, z)) continue;
      const dx = x - r.p[2 * i1], dz = z - r.p[2 * i1 + 1], l = Math.hypot(dx, dz) || 1;
      const o = new THREE.Group();
      o.position.set(x, Y.path, z);
      o.rotation.y = along(dx / l, dz / l);
      const sx = Math.max(0.7, width / 10);
      const gate = new THREE.Mesh(g.arcadeGate.body, STREET_MAT);
      gate.scale.x = sx;
      gate.castShadow = true;
      o.add(gate);
      if (g.arcadeGate.glow) {
        const glow = new THREE.Mesh(g.arcadeGate.glow, STREET_GLOW_MAT);
        glow.scale.x = sx;
        o.add(glow);
      }
      if (!boardTex.has(r.n)) boardTex.set(r.n, nameBoardTexture(r.n));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(7 * sx, 1.25), new THREE.MeshBasicMaterial({ map: boardTex.get(r.n) }));
      board.position.set(0, 8.2, -0.35);
      board.rotation.y = Math.PI; // 板の面（+z）を、アーチの前（-z、通りの外）へ
      o.add(board);
      o.name = 'arcadeGate'; // デバッグ・自動テスト用
      group.add(o);
    }
  }

  // ---- 大型ビジョン：繁華街の高いビルの、道に向いた壁に（画は syncCity6 で動かす） ----
  let visions = 0;
  for (const d of visionSpots()) {
    const [cx, cz] = latLonXY(map, d.lat, d.lon);
    if (!inBounds(map, cx, cz)) continue;
    const cands = map.buildings
      .filter((b) => (buildingHeights?.[b.id] ?? 0) >= 20 && Math.hypot((b.minX + b.maxX) / 2 - cx, (b.minY + b.maxY) / 2 - cz) < d.r * 0.7)
      .sort((a, b) => Math.hypot((a.minX + a.maxX) / 2 - cx, (a.minY + a.maxY) / 2 - cz) - Math.hypot((b.minX + b.maxX) / 2 - cx, (b.minY + b.maxY) / 2 - cz));
    let placed = 0;
    for (const b of cands) {
      if (placed >= 2 || visions >= 6) break;
      const h = buildingHeights[b.id];
      let best = null;
      for (let i = 0; i + 3 < b.p.length; i += 2) {
        const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
        const l = Math.hypot(bx - ax, bz - az);
        if (l < 13) continue;
        let nx = -(bz - az) / l, nz = (bx - ax) / l;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
        const near = nearestRoadPoint(map, mx + nx * 6, mz + nz * 6, true);
        if (!near || near.d > 20) continue;
        if (!best || near.d < best.d) best = { mx, mz, nx, nz, d: near.d };
      }
      if (!best) continue;
      const o = new THREE.Group();
      o.position.set(best.mx + best.nx * 0.5, Math.min(Math.max(h - 9, 8), 30), best.mz + best.nz * 0.5);
      o.rotation.y = along(best.nx, best.nz);
      const frame = new THREE.Mesh(g.vision.body, STREET_MAT);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.6), VISION_MAT);
      screen.position.set(0, 3.2, -0.04);
      screen.rotation.y = Math.PI;
      o.add(frame, screen);
      o.name = 'vision'; // デバッグ・自動テスト用
      group.add(o);
      placed++;
      visions++;
    }
  }

  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = where === 'static' ? group : seasonal[where];
    if (!parent) continue;
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && key !== 'arcadeRoof';
      parent.add(mesh);
    }
  }
}

// ---- 街の物 その 8（Blender で作ったモデル。tools/build-city7.py） ----
// 神社とお寺の入口・交番・首都高・赤ちょうちんの居酒屋とラーメンの屋台・タクシー乗り場。
// 電車の乗客・子ども乗せの子ども・雲と虹・東京湾の船・ゴールの駅員さんも。どれも見た目だけ
const CITY7_URL = 'data/models/city7.glb';
const CITY7_NAMES = {
  torii: 'C7_Torii', toro: 'C7_Toro', komainu: 'C7_Komainu', sanmon: 'C7_Sanmon', koban: 'C7_Koban', hwyPier: 'C7_HwyPier', hwySign: 'C7_HwySign',
  izakaya: 'C7_Izakaya', ramen: 'C7_Ramen', taxiSign: 'C7_TaxiSign', paxYamanote: 'C7_PaxYamanote', paxCommuter: 'C7_PaxCommuter', child: 'C7_Child',
  cloud0: 'C7_Cloud0', cloud1: 'C7_Cloud1', cloud2: 'C7_Cloud2', rainbow: 'C7_Rainbow', containerShip: 'C7_ContainerShip', ferry: 'C7_Ferry',
  staff: 'C7_Staff', staffArm: 'C7_StaffArm',
};
const city7 = { geos: null, done: false };
loadModelParts(CITY7_URL, CITY7_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city7.geos = geos;
    for (const b of bikes) if (b.userData.accessory === 'child') fillBike(b); // 子ども乗せの子どもを付け直す
  })
  .catch((e) => console.warn(`街の物（その 8）のモデルを読み込めませんでした: ${CITY7_URL}`, e))
  .finally(() => (city7.done = true));
const SHRINE_NAME = /神社|稲荷|八幡|天神|大社|神宮/, TEMPLE_NAME = /寺|院$|観音|不動/;
// 首都高が上を通る道（名前。昭和通りは国道 4 号＝trunk の所だけ）。実物の路線をおおまかに当てはめたもの
const HWY_ROAD = (r) => !r.e && r.n && (/^(玉川通り|六本木通り|甲州街道|海岸通り)/.test(r.n) || (/^昭和通り/.test(r.n) && r.t === 'trunk'));
const HWY_Y = 14; // 高架の上面の高さ m
const HWY_W = 17; // 高架の幅 m
const HWY_PIER_SPACING = 32;
const NIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // 夜だけ灯る物（灯籠の窓）
const CHILD_SEAT = [0, 0.86, 0.56]; // 電動アシスト自転車の子ども乗せの座る所（tools/build-bicycle.py）

function addCity7Props(group, map, roadHeights, buildingHeights) {
  const g = city7.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-7`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (where, key, x, h, z, rotY, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  // ほかの物（駅の入口・季節の飾り・縁日の屋台など）とぶつからないよう、置いた所を覚えておく
  const taken = [...(group.userData.taken ?? [])];
  for (const o of group.children) if (o.name === 'entrance') taken.push([o.position.x, o.position.z, 5]);
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  const night = new THREE.Group(); // 夕方と夜だけ（ラーメンの屋台）
  group.add(night);
  group.userData.nightProps = night;

  // ---- 神社とお寺の入口：寺社のいちばん近い道の、寺社の側に、鳥居（と狛犬・灯籠）か山門 ----
  let gates = 0;
  for (const l of (map.landmarks ?? []).filter((l) => l.k === 'worship' && inBounds(map, l.x, l.y))) {
    if (gates >= 8) break;
    const shrine = SHRINE_NAME.test(l.n), temple = !shrine && TEMPLE_NAME.test(l.n);
    if (!shrine && !temple) continue;
    const near = nearestRoadPoint(map, l.x, l.y, false);
    if (!near || near.d > 70 || near.road.e) continue;
    const [dx, dz] = roadDirAt(near.road, near.x, near.z);
    let nx = -dz, nz = dx; // 道の横（寺社の側）
    if ((l.x - near.x) * nx + (l.y - near.z) * nz < 0) (nx = -nx), (nz = -nz);
    // 道の端から、縁日の屋台の奥（置けなければ、もう少し奥）。参道（歩道）の上には置いてよい
    const need = shrine ? [[-2.2, 0], [2.2, 0], [0, 0], [-1.7, -2], [1.7, -2], [-3.6, -1], [3.6, -1]] : [[-3.6, 0], [3.6, 0], [0, 0], [-3.6, 1.3], [3.6, -1.3]];
    let cx = null, cz = null;
    for (const off of [6, 8, 10, 4.5].map((o) => near.road.w / 2 + o)) {
      const x0 = near.x + nx * off, z0 = near.z + nz * off;
      if (need.every(([u, w]) => free(x0 + dx * u + nx * w, z0 + dz * u + nz * w)) && clear(x0, z0, 5)) {
        (cx = x0), (cz = z0);
        break;
      }
    }
    if (cx === null) continue;
    const at = (u, w) => [cx + dx * u + nx * w, cz + dz * u + nz * w];
    const face = along(-nx, -nz); // 前を道へ
    if (shrine) {
      put('static', 'torii', cx, Y.area, cz, face);
      for (const s of [-1, 1]) {
        const [kx, kz] = at(s * 1.7, -2);
        put('static', 'komainu', kx, Y.area, kz, face + s * 0.35);
        const [tx, tz] = at(s * 3.6, -1);
        put('static', 'toro', tx, Y.area, tz, face);
      }
    } else put('static', 'sanmon', cx, Y.area, cz, face);
    taken.push([cx, cz, 5]);
    gates++;
  }

  // ---- 交番：駅のまわりの空いた地面に、道の方を向けて 1 つ（入口と季節の飾りから離す） ----
  for (const st of stations) {
    let done = false;
    for (const dist of [28, 40, 55, 70]) {
      for (let k = 0; k < 16 && !done; k++) {
        const a = (k / 16) * Math.PI * 2 + 0.6;
        const x = st.x + Math.cos(a) * dist, z = st.y + Math.sin(a) * dist;
        const near = nearestRoadPoint(map, x, z, false);
        if (!near || near.d > 9 || near.d < 4) continue;
        const fx = (near.x - x) / near.d, fz = (near.z - z) / near.d;
        const corners = [[2.4, 2.2], [2.4, -2.2], [-2.2, 2.2], [-2.2, -2.2], [0, 0], [3, 1.6]];
        if (!corners.every(([u, w]) => free(x + fx * u - fz * w, z + fz * u + fx * w, false)) || !clear(x, z, 4)) continue;
        const o = new THREE.Group();
        o.position.set(x, Y.area, z);
        o.rotation.y = along(fx, fz);
        o.add(new THREE.Mesh(g.koban.body, STREET_MAT), new THREE.Mesh(g.koban.glow, STREET_GLOW_MAT));
        o.children[0].castShadow = true;
        o.name = 'koban'; // デバッグ・自動テスト用
        group.add(o);
        taken.push([x, z, 4]);
        done = true;
      }
      if (done) break;
    }
  }

  // ---- タクシー乗り場：駅の近くの車道の端に、客を待つタクシーの列と案内、歩道に並ぶ人 ----
  const taxis = [];
  for (const st of stations) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, d = 35 + (k % 3) * 12;
      const near = nearestRoadPoint(map, st.x + Math.cos(a) * d, st.y + Math.sin(a) * d, true);
      if (!near || near.road.e || near.road.w < 10 || near.road.path) continue;
      const ds = Math.hypot(near.x - st.x, near.z - st.y);
      if (ds < 25 || ds > 90) continue;
      if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - near.x, pt.y - near.z) < 30)) continue;
      if (!best || ds < best.ds) best = { ...near, ds };
    }
    if (!best) continue;
    const r = best.road;
    const [dx, dz] = roadDirAt(r, best.x, best.z);
    let nx = -dz, nz = dx;
    if ((st.x - best.x) * nx + (st.y - best.z) * nz < 0) (nx = -nx), (nz = -nz); // 駅の側の端
    const edge = r.w / 2;
    // 左側通行：駅の側の端（n）が進む向きの左になる向き（左は (前の z, -前の x)）
    const fdx = -nz, fdz = nx;
    for (let k = 0; k < 4; k++) {
      const x = best.x + nx * (edge - 1.3) - fdx * k * 5.6, z = best.z + nz * (edge - 1.3) - fdz * k * 5.6;
      if (!inBounds(map, x, z)) continue;
      taxis.push({ x, z, rot: along(fdx, fdz) });
    }
    const sx = best.x + nx * (edge + 0.9) + fdx * 2.5, sz = best.z + nz * (edge + 0.9) + fdz * 2.5;
    if (free(sx, sz)) put('static', 'taxiSign', sx, Y.path, sz, along(-nx, -nz));
    const queue = [];
    for (let k = 0; k < 6; k++) {
      const x = sx - fdx * (0.9 + k * 0.75) + nx * 0.4, z = sz - fdz * (0.9 + k * 0.75) + nz * 0.4;
      if (free(x, z)) queue.push([x, z, along(fdx, fdz)]);
    }
    if (queue.length && city3.geos) {
      queue.forEach(([x, z, rot], k) => put('static', `queue${k % 4}`, x, Y.path, z, rot));
    }
    taken.push([best.x, best.z, 12]);
  }
  if (taxis.length) {
    const tg = carGeometry({ type: 'taxi', color: '#1f2a44' });
    const body = new THREE.InstancedMesh(tg.body, CAR_BODY_MAT, taxis.length), light = new THREE.InstancedMesh(tg.lights, CAR_LIGHT_MAT, taxis.length);
    const m = new THREE.Matrix4();
    taxis.forEach((t, i) => {
      m.makeRotationY(t.rot).setPosition(t.x, Y.road, t.z);
      body.setMatrixAt(i, m);
      light.setMatrixAt(i, m);
    });
    body.castShadow = true;
    body.name = 'taxiQueue'; // デバッグ・自動テスト用
    group.add(body, light);
  }

  // ---- 赤ちょうちんの居酒屋：繁華街・ガード下の駅のまわり・名前が横丁や小路の道の、道に向いた建物の壁に ----
  const districts = NEON_DISTRICTS.map((d) => [...latLonXY(map, d.lat, d.lon), d.r]);
  for (const st of stations) if (GUARD_STATIONS.test(st.n)) districts.push([st.x, st.y, GUARD_RADIUS]);
  const alleyRoads = map.roads.filter((r) => r.n && /横丁|小路/.test(r.n));
  const nearAlley = (x, z) => alleyRoads.some((r) => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2] - ax, bz = r.p[i + 3] - az, l2 = bx * bx + bz * bz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
      if (Math.hypot(x - ax - bx * t, z - az - bz * t) < r.w / 2 + 4) return true;
    }
    return false;
  });
  const izakayas = [];
  for (const b of map.buildings) {
    if (izakayas.length >= 16) break;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const inDistrict = districts.some(([dx, dz, r]) => Math.hypot(dx - cx, dz - cz) < r);
    if (!inDistrict && !nearAlley(cx, cz)) continue;
    if ((buildingHeights?.[b.id] ?? 0) < 3.5 || rnd() > 0.35) continue;
    for (let i = 0; i + 3 < b.p.length; i += 2) {
      const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 5) continue;
      let nx = -(bz - az) / l, nz = (bx - ax) / l;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
      const near = nearestRoadPoint(map, mx + nx * 2, mz + nz * 2, false);
      if (!near || near.d > near.road.w / 2 + 1.5 || near.road.e) continue;
      if (!inBounds(map, mx, mz) || izakayas.some(([x, z]) => Math.hypot(x - mx, z - mz) < 14)) continue;
      if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - mx, pt.y - mz) < FURNITURE_CLEAR_START)) continue;
      put('static', 'izakaya', mx + nx * 0.12, 0, mz + nz * 0.12, along(nx, nz));
      izakayas.push([mx, mz]);
      break;
    }
  }

  // ---- ラーメンの屋台（夕方と夜だけ）：駅のまわりの歩道の広い所に ----
  let ramens = 0;
  // 駅から 15〜80m の歩道の横の空いた地面に、歩道の方を向けて（1 駅に 1 つ）
  for (const st of stations) {
    let done = false;
    for (const r of map.roads) {
      if (done || ramens >= 3 || !r.path || r.e) continue;
      for (let i = 0; i + 3 < r.p.length && !done; i += 2) {
        const mx = (r.p[i] + r.p[i + 2]) / 2, mz = (r.p[i + 1] + r.p[i + 3]) / 2;
        const ds = Math.hypot(mx - st.x, mz - st.y);
        if (ds < 15 || ds > 80) continue;
        const l = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
        if (l < 4) continue;
        const ux = (r.p[i + 2] - r.p[i]) / l, uz = (r.p[i + 3] - r.p[i + 1]) / l;
        for (const s of [1, -1]) {
          const nx = -uz * s, nz = ux * s;
          const x = mx + nx * (r.w / 2 + 1.3), z = mz + nz * (r.w / 2 + 1.3);
          if (!clear(x, z, 3) || ![[0, 0], [1.2, 0], [-1.2, 0], [0, 0.9], [0, -0.7]].every(([u, w]) => free(x + ux * u + nx * w, z + uz * u + nz * w, false))) continue;
          put('night', 'ramen', x, Y.area, z, along(-nx, -nz));
          taken.push([x, z, 3]);
          ramens++;
          done = true;
          break;
        }
      }
    }
  }

  // ---- 首都高：名前の決まった大きな道の上に、高さ HWY_Y m の高架（板・防音壁・橋脚・案内板）。上を車が走る（syncCity7） ----
  const hwys = map.roads.filter(HWY_ROAD).filter((r) => r.p.length >= 4);
  if (hwys.length) {
    const deck = new GeometryBuilder(), walls = new GeometryBuilder(true), lines = new GeometryBuilder(true);
    const WALL = [0.62, 0.68, 0.64], WHITE_L = [0.88, 0.88, 0.86];
    const paths = [];
    for (const r of hwys) {
      addDeck(deck, r.p, HWY_W, HWY_Y);
      for (const s of [-1, 1]) addOffsetStrip(lines, r.p, s * (HWY_W / 2 - 1.2), 0.18, HWY_Y + 0.02, WHITE_L);
      addOffsetStrip(lines, r.p, 0, 0.5, HWY_Y + 0.02, [0.85, 0.7, 0.2]); // 真ん中の線
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1e-6) continue;
        const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
        for (const s of [-1, 1]) {
          const ox = nx * (HWY_W / 2 - 0.15) * s, oz = nz * (HWY_W / 2 - 0.15) * s;
          const a = [x1 + ox, HWY_Y, z1 + oz], c = [x2 + ox, HWY_Y, z2 + oz], d = [x2 + ox, HWY_Y + 2.4, z2 + oz], e = [x1 + ox, HWY_Y + 2.4, z1 + oz];
          walls.tri(a, c, d, [nx * s, 0, nz * s], WALL);
          walls.tri(a, d, e, [nx * s, 0, nz * s], WALL);
        }
      }
      for (const [x, z, i] of pillarSpots(r.p, HWY_PIER_SPACING)) {
        if (!inBounds(map, x, z) || onTrack(map, x, z, 5)) continue;
        if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < 20)) continue;
        if ((surfaceAt(map, x, z).segs ?? []).some((sg) => sg.road !== r && !sg.road.path && sg.road.w >= 6)) continue; // 交差点の真ん中には立てない
        const dx = r.p[2 * i + 2] - r.p[2 * i], dz = r.p[2 * i + 3] - r.p[2 * i + 1], l = Math.hypot(dx, dz) || 1;
        put('static', 'hwyPier', x, 0, z, faceTo(-dz / l, dx / l), 1, (HWY_Y - DECK_T) / 12.6, 1); // 高架の下まで伸ばす
        if (rnd() < 0.08) put('static', 'hwySign', x + (-dz / l) * (HWY_W / 2 + 0.1), HWY_Y - 2.9, z + (dx / l) * (HWY_W / 2 + 0.1), along(-dz / l, dx / l));
      }
      const cum = [0];
      for (let i = 0; i + 3 < r.p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]));
      if (cum[cum.length - 1] > 60) paths.push({ p: r.p, cum, len: cum[cum.length - 1] });
    }
    const deckMesh = new THREE.Mesh(deck.build(), new THREE.MeshLambertMaterial({ color: 0x5a5e66, side: THREE.DoubleSide }));
    deckMesh.castShadow = deckMesh.receiveShadow = true;
    deckMesh.name = 'highway'; // デバッグ・自動テスト用
    const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    wallMesh.castShadow = true;
    group.add(deckMesh, wallMesh, new THREE.Mesh(lines.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // 高架を走る車（左側通行で 2 車線ずつ）
    const total = paths.reduce((s, p) => s + p.len, 0);
    const cars = [];
    const looks = [['sedan', '#c8ccd4'], ['minivan', '#f4f4f0'], ['kei', '#3a5a8a'], ['sedan', '#1e2028'], ['taxi', '#1f2a44'], ['minivan', '#8a2a2a']];
    const n = Math.min(16, Math.round(total / 120));
    for (let k = 0; k < n && paths.length; k++) {
      const [type, color] = looks[k % looks.length];
      const cg = carGeometry({ type, color });
      const o = new THREE.Group();
      const body = new THREE.Mesh(cg.body, CAR_BODY_MAT);
      body.castShadow = true;
      o.add(body, new THREE.Mesh(cg.lights, CAR_LIGHT_MAT));
      o.name = 'hwyCar'; // デバッグ・自動テスト用
      group.add(o);
      const path = paths[k % paths.length];
      cars.push({ o, path, s: rnd() * path.len, dir: k % 2 ? 1 : -1, lane: k % 4 < 2 ? 2.4 : 5.6, speed: 15 + rnd() * 6 });
    }
    group.userData.hwyCars = cars;
  }

  // ---- 東京湾の船・雲は syncCity7。並べた物を InstancedMesh にする ----
  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = where === 'night' ? night : group;
    const qk = key.startsWith('queue') ? Number(key.slice(5)) : null;
    const geos = qk !== null ? { body: city3.geos[`stand${qk}`].body, glow: null } : g[key];
    for (const [geo, material] of [[geos.body, STREET_MAT], [geos.glow, key === 'toro' ? NIGHT_MAT : STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      parent.add(mesh);
    }
  }
}

// ゴールの門の横の駅員さん（勝ったら手を挙げて振る。syncCity7）
function addGoalStaff(group) {
  const g = city7.geos, gg = group.userData.goalGate;
  if (!g || !gg) return;
  const staff = [];
  for (const side of [-1, 1]) {
    const o = new THREE.Group();
    o.position.set(side * (gg.reach + 0.4), 0, 4.0);
    o.rotation.y = Math.atan2(side * 0.8, -0.6); // 前（-z）を道の真ん中と、走ってくる自転車の方へ
    const body = new THREE.Mesh(g.staff.body, STREET_MAT);
    body.castShadow = true;
    const arm = new THREE.Group();
    arm.position.set(0.21, 1.42, 0);
    arm.add(new THREE.Mesh(g.staffArm.body, STREET_MAT));
    o.add(body, arm);
    o.name = 'staff'; // デバッグ・自動テスト用
    gg.gate.add(o);
    staff.push({ arm, side });
  }
  group.userData.goalStaff = staff;
}

// ---- 街の物 その 9（Blender で作ったモデル。tools/build-city8.py） ----
// 学校・ガソリンスタンド・コインパーキング・銭湯・噴水・シェアサイクルのポートは、OpenStreetMap の施設の位置（map.facilities）に置く。
// 撮り鉄・航空障害灯・掲示板も。下校する子どもと湯おけの人は道を進む（syncRiders）。どれも見た目だけ
const CITY8_URL = 'data/models/city8.glb';
const CITY8_NAMES = {
  schoolGate: 'C8_SchoolGate', tetsubo: 'C8_Tetsubo', jungleGym: 'C8_JungleGym', soccerGoal: 'C8_SoccerGoal', pupils: 'C8_Pupils',
  gasStation: 'C8_GasStation', parkSign: 'C8_ParkSign', parkStall: 'C8_ParkStall', chimney: 'C8_Chimney', sentoFront: 'C8_SentoFront', bather: 'C8_Bather',
  fountain: 'C8_Fountain', fountainWater: 'C8_FountainWater', cyclePort: 'C8_CyclePort', railfanUp: 'C8_RailfanUp', railfanDown: 'C8_RailfanDown',
  tripod: 'C8_Tripod', obstLight: 'C8_ObstLight', electionBoard: 'C8_ElectionBoard', noticeBoard: 'C8_NoticeBoard',
};
const city8 = { geos: null, done: false };
loadModelParts(CITY8_URL, CITY8_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city8.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 9）のモデルを読み込めませんでした: ${CITY8_URL}`, e))
  .finally(() => (city8.done = true));
const OBST_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // 航空障害灯（夕方と夜に点滅。syncCity8）
const OBST_MIN_H = 45; // この高さ m 以上のビルの屋上の角に航空障害灯
const WATER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }); // 噴水の水

function addCity8Props(group, map, roadHeights, buildingHeights) {
  const g = city8.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-8`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (key, x, h, z, rotY, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const taken = [...(group.userData.taken ?? [])];
  for (const o of group.children) if (['entrance', 'koban'].includes(o.name)) taken.push([o.position.x, o.position.z, 5]);
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const fits = (x, z, dx, dz, pts, onPath) => pts.every(([u, w]) => free(x + dx * u - dz * w, z + dz * u + dx * w, onPath)); // u は (dx, dz) の向き、w はその左
  const F = map.facilities ?? {};
  const each = (list, fn) => {
    for (let i = 0; i + 3 < (list?.length ?? 0); i += 4) fn(list[i], list[i + 1], list[i + 2], list[i + 3]);
  };
  // 道の方を向く向き：いちばん近い道の中心への向き (fx, fz) と、道の向き (ux, uz)
  const toward = (x, z, carOnly) => {
    const near = nearestRoadPoint(map, x, z, carOnly);
    if (!near) return null;
    const d = near.d || 1;
    const [ux, uz] = roadDirAt(near.road, near.x, near.z);
    return { near, fx: (near.x - x) / d, fz: (near.z - z) / d, ux, uz };
  };

  // ---- 学校：敷地の道の側に校門、空いた地面に鉄棒・ジャングルジム・サッカーゴール ----
  const schools = [];
  each(F.schools, (x, z, w, d) => {
    if (!inBounds(map, x, z)) return;
    schools.push([x, z]);
    const t = toward(x, z, false);
    if (t && t.near.d < Math.max(w, d) / 2 + 15) {
      // 校門：敷地の中心からいちばん近い道の端に、道の方を向けて
      const gx = t.near.x - t.fx * (t.near.road.w / 2 + 1.0), gz = t.near.z - t.fz * (t.near.road.w / 2 + 1.0);
      if (fits(gx, gz, t.ux, t.uz, [[-2.8, 0], [2.8, 0]], true) && clear(gx, gz, 3)) {
        put('schoolGate', gx, Y.area, gz, along(t.fx, t.fz));
        taken.push([gx, gz, 3]);
      }
    }
    // 校庭の遊具：敷地の中の空いた地面を探して置く
    const half = Math.max(12, Math.min(60, Math.max(w, d) / 2));
    const gear = [['tetsubo', [[-2.4, 0], [2.4, 0], [0, 0.6], [0, -0.6]]], ['jungleGym', [[-1, -1], [1, 1], [1, -1], [-1, 1]]], ['soccerGoal', [[-2.6, 0], [2.6, 0], [0, -1.6]]], ['soccerGoal', [[-2.6, 0], [2.6, 0], [0, -1.6]]]];
    for (const [key, need] of gear) {
      for (let k = 0; k < 30; k++) {
        const px = x + (rnd() - 0.5) * 2 * half, pz = z + (rnd() - 0.5) * 2 * half;
        const a = Math.floor(rnd() * 4) * (Math.PI / 2);
        const dx = Math.cos(a), dz = Math.sin(a);
        if (!fits(px, pz, dx, dz, [[0, 0], ...need], false) || !clear(px, pz, 2.5)) continue;
        put(key, px, Y.area, pz, Math.atan2(-dz, dx));
        taken.push([px, pz, 2.5]);
        break;
      }
    }
  });
  group.userData.schools = schools;

  // ---- ガソリンスタンド：いちばん近い車道の横に、屋根と給油機。給油中の車も ----
  const fueling = [];
  each(F.fuel, (x, z) => {
    if (!inBounds(map, x, z)) return;
    const t = toward(x, z, true);
    if (!t || t.near.d > 45 || t.near.road.e) return;
    for (const off of [7.5, 9, 11, 6.5]) {
      const cx = t.near.x - t.fx * (t.near.road.w / 2 + off), cz = t.near.z - t.fz * (t.near.road.w / 2 + off);
      // 屋根の四隅と真ん中（u は道に沿う向き、w は道から離れる向き）
      const pts = [[0, 0], [-6.5, -4.5], [6.5, -4.5], [-6.5, 4.5], [6.5, 4.5], [0, 4.5], [0, -4.5]];
      const ok = pts.every(([u, w]) => free(cx + t.ux * u - t.fx * w, cz + t.uz * u - t.fz * w)); // 歩道の上にかかってもよい（車の出入り口）
      if (!ok || !clear(cx, cz, 7)) continue;
      put('gasStation', cx, Y.area, cz, along(t.fx, t.fz));
      fueling.push({ x: cx - t.ux * 1.3, z: cz - t.uz * 1.3, rot: along(t.fx, t.fz) }); // 給油機の島の横に、道の方を向けて
      taken.push([cx, cz, 8]);
      break;
    }
  });

  // ---- コインパーキング：小さな駐車場に、区画（白線・車止め・ロック板）を並べ、半分ほどに車。道の側に「P」の看板 ----
  const parked = [];
  each(F.parking, (x, z, w, d) => {
    if (!inBounds(map, x, z)) return;
    const t = toward(x, z, true);
    if (!t || t.near.d > 40 || t.near.road.e) return;
    const n = Math.max(2, Math.min(8, Math.floor(Math.max(w, d, 12) / 2.6)));
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * 2.5;
      const sx = x + t.ux * u, sz = z + t.uz * u;
      // 区画の 4 隅（奥行きは道から離れる向き）
      if (!fits(sx, sz, t.ux, t.uz, [[-1.1, 0], [1.1, 0], [0, 2.3], [0, -2.3]], false) || !clear(sx, sz, 2)) continue;
      put('parkStall', sx, Y.area, sz, along(t.fx, t.fz));
      if (rnd() < 0.6) parked.push({ x: sx - t.fx * 0.2, z: sz - t.fz * 0.2, rot: along(-t.fx, -t.fz), k });
      placed++;
    }
    if (!placed) return;
    const px = x + t.fx * (t.near.d - t.near.road.w / 2 - 0.8) + t.ux * ((n / 2) * 2.5 + 0.8), pz = z + t.fz * (t.near.d - t.near.road.w / 2 - 0.8) + t.uz * ((n / 2) * 2.5 + 0.8);
    if (free(px, pz)) put('parkSign', px, Y.area, pz, along(t.fx, t.fz));
    taken.push([x, z, (n / 2) * 2.5]);
  });
  const parkedCars = [...fueling.map((f) => ({ ...f, k: 0 })), ...parked];
  if (parkedCars.length) {
    const looks = [['sedan', '#c8ccd4'], ['kei', '#f4f4f0'], ['minivan', '#1e2028'], ['kei', '#d84a3a'], ['sedan', '#3a5a8a']];
    const byLook = new Map();
    parkedCars.forEach((c, i) => {
      const lk = looks[(i * 7 + c.k) % looks.length];
      const key = lk.join();
      if (!byLook.has(key)) byLook.set(key, { lk, list: [] });
      byLook.get(key).list.push(c);
    });
    const m = new THREE.Matrix4();
    for (const { lk, list } of byLook.values()) {
      const cg = carGeometry({ type: lk[0], color: lk[1] });
      const body = new THREE.InstancedMesh(cg.body, CAR_BODY_MAT, list.length), light = new THREE.InstancedMesh(cg.lights, CAR_LIGHT_MAT, list.length);
      list.forEach((c, i) => {
        m.makeRotationY(c.rot).setPosition(c.x, Y.area, c.z);
        body.setMatrixAt(i, m);
        light.setMatrixAt(i, m);
      });
      body.castShadow = true;
      body.name = 'parkedCars'; // デバッグ・自動テスト用
      group.add(body, light);
    }
  }

  // ---- 銭湯：建物の道に向いた壁に入口、そばの空いた地面に高い煙突 ----
  const baths = [];
  each(F.baths, (x, z) => {
    if (!inBounds(map, x, z)) return;
    baths.push([x, z]);
    const cell = map.cells.get(cellKey(x, z));
    const b = cell?.buildings.find((b) => insidePolygon(x, z, b.p)) ?? map.buildings.find((b) => x >= b.minX - 8 && x <= b.maxX + 8 && z >= b.minY - 8 && z <= b.maxY + 8);
    if (b) {
      let best = null;
      for (let i = 0; i + 3 < b.p.length; i += 2) {
        const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
        const l = Math.hypot(bx - ax, bz - az);
        if (l < 4.5) continue;
        let nx = -(bz - az) / l, nz = (bx - ax) / l;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
        const near = nearestRoadPoint(map, mx + nx * 2, mz + nz * 2, false);
        if (!near || near.road.e || !free(mx + nx * 1.5, mz + nz * 1.5)) continue; // 橋や高架の道の側、前がふさがった壁には付けない
        if (!best || near.d < best.d) best = { mx, mz, nx, nz, d: near.d };
      }
      if (best) put('sentoFront', best.mx + best.nx * 0.12, 0, best.mz + best.nz * 0.12, along(best.nx, best.nz));
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, r = 6 + (k % 3) * 4;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (!fits(cx, cz, 1, 0, [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], false) || !clear(cx, cz, 1.5)) continue;
      put('chimney', cx, Y.area, cz, 0);
      taken.push([cx, cz, 1.5]);
      break;
    }
  });
  group.userData.baths = baths;

  // ---- 噴水（水は syncCity8 で上下）とシェアサイクルのポート ----
  const fountains = [];
  each(F.fountains, (x, z) => {
    if (!inBounds(map, x, z) || !clear(x, z, 5)) return;
    const ring = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * 4.4, Math.sin((k * Math.PI) / 4) * 4.4])];
    if (!fits(x, z, 1, 0, ring, true)) return;
    const y = surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area;
    put('fountain', x, y, z, 0);
    const water = new THREE.Mesh(g.fountainWater.body, WATER_MAT);
    water.position.set(x, y, z);
    water.name = 'fountainWater'; // デバッグ・自動テスト用
    group.add(water);
    fountains.push(water);
    taken.push([x, z, 5]);
  });
  group.userData.fountains = fountains;
  each(F.cycles, (x, z) => {
    if (!inBounds(map, x, z)) return;
    const t = toward(x, z, false);
    if (!t || t.near.d > 25) return;
    // 道の端の外側（歩道の上でもよい）に、道に沿って並べる
    for (const off of [1.2, 2.2, 3.4]) {
      const cx = t.near.x - t.fx * (t.near.road.w / 2 + off), cz = t.near.z - t.fz * (t.near.road.w / 2 + off);
      if (!fits(cx, cz, t.ux, t.uz, [[0, 0], [-3.5, 0], [4.2, 0], [0, -0.9], [0, 0.6]], true) || !clear(cx, cz, 3)) continue;
      put('cyclePort', cx, surfaceAt(map, cx, cz).kind === 'path' ? Y.path : Y.area, cz, along(t.fx, t.fz));
      taken.push([cx, cz, 3.5]);
      break;
    }
  });

  // ---- 撮り鉄：山手線の地面の線路の柵の外で、線路にカメラを向ける（電車が近づくと構える。syncCity8） ----
  const railfans = [];
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station');
  for (const l of map.lines) {
    if (l.k !== 'yamanote' || l.e || l.u || railfans.length >= 4) continue;
    for (let i = 0; i + 3 < l.p.length && railfans.length < 4; i += 2) {
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 30 || rnd() > 0.35) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = ux * side;
        const x = (x1 + x2) / 2 + nx * (FENCE_OFF + 1.4), z = (z1 + z2) / 2 + nz * (FENCE_OFF + 1.4);
        if (stations.some((st) => Math.hypot(st.x - x, st.y - z) < FENCE_STATION_CLEAR) || !free(x, z) || !clear(x, z, 2) || onTrack(map, x, z, FENCE_OFF)) continue;
        const o = new THREE.Group();
        o.position.set(x, surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area, z);
        o.rotation.y = along(-nx + ux * 0.6, -nz + uz * 0.6); // 線路の、少し先の方を向く
        const up = new THREE.Mesh(g.railfanUp.body, STREET_MAT), down = new THREE.Mesh(g.railfanDown.body, STREET_MAT);
        const tripod = new THREE.Mesh(g.tripod.body, STREET_MAT);
        tripod.position.set(0.7, 0, 0.2);
        up.castShadow = down.castShadow = true;
        up.visible = false;
        o.add(up, down, tripod);
        o.name = 'railfan'; // デバッグ・自動テスト用
        group.add(o);
        railfans.push({ o, up, down });
        taken.push([x, z, 2]);
        break;
      }
    }
  }
  group.userData.railfans = railfans;

  // ---- 航空障害灯：高いビルの屋上の、外側の角 4 か所（夕方と夜に赤く点滅） ----
  for (const b of map.buildings) {
    const h = buildingHeights?.[b.id] ?? 0;
    if (h < OBST_MIN_H) continue;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    if (!inBounds(map, cx, cz)) continue;
    for (const [qx, qz] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
      let best = null, bd = Infinity;
      for (let i = 0; i + 1 < b.p.length; i += 2) {
        const d = Math.hypot(b.p[i] - qx, b.p[i + 1] - qz);
        if (d < bd) (bd = d), (best = [b.p[i], b.p[i + 1]]);
      }
      if (best) put('obstLight', best[0] + (cx - best[0]) * 0.04, h, best[1] + (cz - best[1]) * 0.04, 0, 3, 3, 3); // 遠くからも見えるよう大きめ
    }
  }

  // ---- 掲示板：住宅地の細い道の端に、選挙のポスター掲示板と町内会の掲示板 ----
  let boards = 0;
  for (const r of map.roads) {
    if (boards >= 10 || r.path || r.e || r.w > 6) continue;
    if (rnd() > 0.08) continue;
    const i = 2 * Math.floor(rnd() * (r.p.length / 2 - 1));
    const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 8) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    const side = rnd() < 0.5 ? 1 : -1;
    const nx = -uz * side, nz = ux * side;
    const x = (x1 + x2) / 2 + nx * (r.w / 2 + 0.9), z = (z1 + z2) / 2 + nz * (r.w / 2 + 0.9);
    const key = boards % 2 ? 'noticeBoard' : 'electionBoard';
    if (!fits(x, z, ux, uz, [[0, 0], [-1.8, 0], [1.8, 0]], false) || !clear(x, z, 2)) continue;
    put(key, x, Y.area, z, along(-nx, -nz));
    taken.push([x, z, 2]);
    boards++;
  }

  for (const [key, list] of lists) {
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, key === 'obstLight' ? OBST_MAT : STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && key !== 'parkStall';
      group.add(mesh);
    }
  }
  group.userData.taken = taken;
}

// ---- 街の物 その 10（Blender で作ったモデル。tools/build-city9.py） ----
// 病院・郵便局・銀行の入口（OpenStreetMap の位置。map.services）・縁日の夜の電球・コンビニの自動ドア・はとバスとガイドさん・
// 宅配便の車と荷物を運ぶ人。稲光と音符も。どれも見た目だけ
const CITY9_URL = 'data/models/city9.glb';
const CITY9_NAMES = {
  hospital: 'C9_Hospital', postOffice: 'C9_PostOffice', bank: 'C9_Bank', fairBulbs: 'C9_FairBulbs', autoDoor: 'C9_AutoDoor',
  hatoBus: 'C9_HatoBus', tourGroup: 'C9_TourGroup', deliveryVan: 'C9_DeliveryVan', parcelWalker: 'C9_ParcelWalker', bolt: 'C9_Bolt', note: 'C9_Note',
};
const city9 = { geos: null, done: false };
loadModelParts(CITY9_URL, CITY9_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city9.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 10）のモデルを読み込めませんでした: ${CITY9_URL}`, e))
  .finally(() => (city9.done = true));
// コンビニの自動ドア（tools/build-shops.py の SF_Front：ドアは壁から 0.14m 外、壁に沿って -3.4〜-1.8m）
const SHOP_DOOR_Z = -2.6, SHOP_DOOR_X = 0.15, AUTO_DOOR_OPEN = 1.5; // 開くと隣のガラスのところまで
const AUTO_DOOR_NEAR = 9; // 自転車がこの距離 m まで来たら開く

// 建物の、道に向いた壁（前がふさがっていない）の真ん中 { mx, mz, nx, nz }。点 (x, z) のいちばん近い建物で探す
function streetWall(map, roadHeights, x, z, minLen = 6.5) {
  const cell = map.cells.get(cellKey(x, z));
  const b = cell?.buildings.find((b) => insidePolygon(x, z, b.p)) ?? map.buildings.find((b) => x >= b.minX - 8 && x <= b.maxX + 8 && z >= b.minY - 8 && z <= b.maxY + 8);
  if (!b) return null;
  let best = null;
  for (let i = 0; i + 3 < b.p.length; i += 2) {
    const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < minLen) continue;
    let nx = -(bz - az) / l, nz = (bx - ax) / l;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
    const near = nearestRoadPoint(map, mx + nx * 2, mz + nz * 2, false);
    if (!near || near.road.e || !inBounds(map, mx, mz) || !freeSpot(map, roadHeights, mx + nx * 1.5, mz + nz * 1.5)) continue;
    if (!best || near.d < best.d) best = { mx, mz, nx, nz, d: near.d, b };
  }
  return best;
}

function addCity9Props(group, map, roadHeights) {
  const g = city9.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-9`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const put = (where, key, m) => {
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const at = (x, h, z, rotY) => new THREE.Matrix4().makeRotationY(rotY).setPosition(x, h, z);
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const taken = [...(group.userData.taken ?? [])];
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);

  // コンビニの店先の場所には付けない
  group.traverse((o) => {
    if (o.name !== 'shopFronts' || !o.isInstancedMesh) return;
    const m = new THREE.Matrix4();
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, m);
      taken.push([m.elements[12], m.elements[14], 4.5]);
    }
  });
  // ---- 病院・郵便局・銀行：建物の道に向いた壁に入口 ----
  const S = map.services ?? {};
  const used = new Set();
  for (const [key, list] of [['hospital', S.hospitals], ['postOffice', S.postOffices], ['bank', S.banks]]) {
    for (let i = 0; i + 1 < (list?.length ?? 0); i += 2) {
      const w = streetWall(map, roadHeights, list[i], list[i + 1]);
      if (!w || used.has(w.b) || !clear(w.mx, w.mz, 3)) continue;
      used.add(w.b);
      put('static', key, at(w.mx + w.nx * 0.12, 0, w.mz + w.nz * 0.12, along(w.nx, w.nz)));
      taken.push([w.mx, w.mz, 3]);
    }
  }

  // ---- 縁日の夜の電球：ちょうちんの列と同じ所に、少し下げて（夕方と夜だけ） ----
  const night = group.userData.nightProps;
  group.traverse((o) => {
    if (o.name !== 'lanterns' || !o.isInstancedMesh || !night) return;
    const m = new THREE.Matrix4();
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, m);
      put('night', 'fairBulbs', m.clone().premultiply(new THREE.Matrix4().makeTranslation(0, -0.15, 0)));
    }
  });

  // ---- コンビニの自動ドア：店先 1 つに 2 枚。自転車が近づくと左右に開く（syncCity9） ----
  let fronts = null;
  group.traverse((o) => o.name === 'shopFronts' && o.isInstancedMesh && (fronts = o));
  if (fronts) {
    const doors = new THREE.InstancedMesh(g.autoDoor.body, STREET_MAT, fronts.count * 2);
    const bases = [];
    const m = new THREE.Matrix4(), c = new THREE.Vector3();
    for (let k = 0; k < fronts.count; k++) {
      fronts.getMatrixAt(k, m);
      const base = m.clone().multiply(new THREE.Matrix4().makeTranslation(SHOP_DOOR_X, 0, SHOP_DOOR_Z)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      c.setFromMatrixPosition(base);
      bases.push({ m: base, x: c.x, z: c.z, open: 0 });
    }
    doors.frustumCulled = false;
    doors.userData.keepUnculled = true;
    doors.name = 'autoDoors'; // デバッグ・自動テスト用
    group.add(doors);
    group.userData.autoDoors = { mesh: doors, bases };
  }

  // ---- はとバス：区間の駅のひとつの近くの広い道の端に止め、歩道にガイドさんと観光客の列 ----
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  for (const st of stations.sort(() => rnd() - 0.5)) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, d = 40 + (k % 3) * 15;
      const near = nearestRoadPoint(map, st.x + Math.cos(a) * d, st.y + Math.sin(a) * d, true);
      if (!near || near.road.e || near.road.w < 10 || near.road.path) continue;
      const ds = Math.hypot(near.x - st.x, near.z - st.y);
      if (ds < 30 || ds > 110 || !clear(near.x, near.z, 14)) continue;
      if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - near.x, pt.y - near.z) < 35)) continue;
      if (!best || ds < best.ds) best = { ...near, ds };
    }
    if (!best) continue;
    const [dx, dz] = roadDirAt(best.road, best.x, best.z);
    let nx = -dz, nz = dx;
    if ((st.x - best.x) * nx + (st.y - best.z) * nz < 0) (nx = -nx), (nz = -nz); // 駅の側の端
    const fdx = -nz, fdz = nx; // 左側通行：駅の側（n）が左になる向き
    const edge = best.road.w / 2;
    const bx = best.x + nx * (edge - 1.4), bz = best.z + nz * (edge - 1.4);
    put('static', 'hatoBus', at(bx, Y.road, bz, along(fdx, fdz)));
    // 列は歩道に、バスの乗り口（前の左）の横から後ろへ
    const gx = bx + nx * 2.6 + fdx * 3.8, gz = bz + nz * 2.6 + fdz * 3.8;
    if (free(gx, gz) && free(gx - fdx * 4, gz - fdz * 4)) put('static', 'tourGroup', at(gx, surfaceAt(map, gx, gz).kind === 'path' ? Y.path : Y.area, gz, along(fdx, fdz)));
    taken.push([bx, bz, 8]);
    break;
  }

  // ---- 宅配便：細い道の端に止まった軽バンと、荷物を抱えて建物との間を行き来する人（syncCity9） ----
  const deliveries = [];
  for (let k = 0; k < 400 && deliveries.length < 4; k++) {
    const r = map.roads[Math.floor(rnd() * map.roads.length)];
    if (!r || r.path || r.e || r.w < 5 || r.w > 9 || r.p.length < 4) continue;
    const i = 2 * Math.floor(rnd() * (r.p.length / 2 - 1));
    const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 12) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    const nx = uz, nz = -ux; // 進む向きの左（左側通行で止める側）
    const vx = (x1 + x2) / 2 + nx * (r.w / 2 - 1.0), vz = (z1 + z2) / 2 + nz * (r.w / 2 - 1.0);
    if (!inBounds(map, vx, vz) || !clear(vx, vz, 6) || [map.start, map.goal].some((pt) => Math.hypot(pt.x - vx, pt.y - vz) < 30)) continue;
    // 歩く先：道の外の、建物の壁の手前（道に直角に）
    let wx = null, wz = null;
    for (let d = 2; d <= 12; d += 1) {
      const px = vx + nx * d, pz = vz + nz * d;
      if (surfaceAt(map, px, pz).kind === 'building') {
        (wx = vx + nx * (d - 0.8)), (wz = vz + nz * (d - 0.8));
        break;
      }
    }
    if (wx === null) continue;
    put('static', 'deliveryVan', at(vx, Y.road, vz, along(ux, uz)));
    const walker = new THREE.Mesh(g.parcelWalker.body, STREET_MAT);
    walker.castShadow = true;
    walker.name = 'parcelWalker'; // デバッグ・自動テスト用
    group.add(walker);
    const sx = vx - ux * 1.9 + nx * 0.2, sz = vz - uz * 1.9 + nz * 0.2; // バンの後ろから
    deliveries.push({ walker, sx, sz, wx: wx - ux * 1.9, wz: wz - uz * 1.9, phase: rnd() * 10 });
    taken.push([vx, vz, 4]);
  }
  group.userData.deliveries = deliveries;

  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = where === 'night' ? night : group;
    if (!parent) continue;
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      parent.add(mesh);
    }
  }
  group.userData.taken = taken;
}

// ---- 街の物 その 11（Blender で作ったモデル。tools/build-city10.py） ----
// 墓地（墓石と石の塀。地図の墓地の面）・屋上の広告看板と給水塔・立体駐車場・ペットショップと花屋・消防署（OpenStreetMap の位置）。
// お散歩カートと自転車の警察官は道を進み（syncRiders）、消防署からはときどき消防車が出る（syncCity10）。落ち葉も。どれも見た目だけ
const CITY10_URL = 'data/models/city10.glb';
const CITY10_NAMES = {
  grave: 'C10_Grave', stoneWall: 'C10_StoneWall', billboard: 'C10_Billboard', waterTank: 'C10_WaterTank', parkTower: 'C10_ParkTower',
  petShop: 'C10_PetShop', florist: 'C10_Florist', fireStation: 'C10_FireStation', daycareCart: 'C10_DaycareCart', leaf: 'C10_Leaf',
};
const city10 = { geos: null, done: false };
loadModelParts(CITY10_URL, CITY10_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city10.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 11）のモデルを読み込めませんでした: ${CITY10_URL}`, e))
  .finally(() => (city10.done = true));
const GRAVES_MAX = 500; // 1 区間の墓石の数の上限

// 屋上の広告看板の画（架空の広告 4 種類）
const AD_TEXTURES = [
  ['#d8302a', '#fff', 'カレー', 'ヤマテ亭'],
  ['#1f4aa8', '#fff', '東京ソーダ', 'すっきり新発売'],
  ['#1e2028', '#f2c230', '今夜9時', 'ドラマ「山手線」'],
  ['#f2c230', '#1e2028', '家電のマルミ', '駅前店'],
].map(([bg, fg, big, small]) => {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const x = cv.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 512, 192);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 84px sans-serif';
  x.fillText(big, 256, 82, 480);
  x.font = 'bold 36px sans-serif';
  x.fillText(small, 256, 156, 480);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 });
});

function addCity10Props(group, map, roadHeights, buildingHeights) {
  const g = city10.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-10`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (key, x, h, z, rotY, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const taken = [...(group.userData.taken ?? [])];
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);

  // ---- 墓地：墓地の面の中に墓石を並べ、道に近い辺に石の塀 ----
  let graves = 0;
  for (const a of map.areas ?? []) {
    if (a.k !== 'cemetery' || graves >= GRAVES_MAX) continue;
    const ring = a.r?.[0];
    if (!ring || ring.length < 6) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) (minX = Math.min(minX, ring[i])), (maxX = Math.max(maxX, ring[i])), (minZ = Math.min(minZ, ring[i + 1])), (maxZ = Math.max(maxZ, ring[i + 1]));
    // 列の向き：いちばん長い辺に合わせる
    let ux = 1, uz = 0, best = 0;
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const l = Math.hypot(ring[i + 2] - ring[i], ring[i + 3] - ring[i + 1]);
      if (l > best) (best = l), (ux = (ring[i + 2] - ring[i]) / l), (uz = (ring[i + 3] - ring[i + 1]) / l);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, R = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    for (let i = -R; i <= R && graves < GRAVES_MAX; i += 1.8) {
      for (let j = -R; j <= R && graves < GRAVES_MAX; j += 2.6) {
        const x = cx + ux * i - uz * j, z = cz + uz * i + ux * j;
        if (!insidePolygon(x, z, ring) || !free(x, z, false) || !free(x + ux * 0.7, z + uz * 0.7, false) || !free(x - ux * 0.7, z - uz * 0.7, false)) continue;
        put('grave', x, Y.area, z, along(-uz, ux) + (rnd() - 0.5) * 0.06);
        graves++;
      }
    }
    // 塀：道から 6m 以内の辺に、内側へ 0.4m 入れて 4m ずつ
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const x1 = ring[i], z1 = ring[i + 1], x2 = ring[i + 2], z2 = ring[i + 3];
      const l = Math.hypot(x2 - x1, z2 - z1);
      if (l < 4) continue;
      const ex = (x2 - x1) / l, ez = (z2 - z1) / l;
      let nx = -ez, nz = ex;
      if (!insidePolygon((x1 + x2) / 2 + nx * 0.5, (z1 + z2) / 2 + nz * 0.5, ring)) (nx = -nx), (nz = -nz); // 内向き
      const near = nearestRoadPoint(map, (x1 + x2) / 2 - nx * 3, (z1 + z2) / 2 - nz * 3, false);
      if (!near || near.d > 6) continue;
      const n = Math.floor(l / 4);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) * (l / n);
        const x = x1 + ex * t + nx * 0.4, z = z1 + ez * t + nz * 0.4;
        if (free(x, z, false)) put('stoneWall', x, Y.area, z, faceTo(ex, ez), l / n / 4, 1, 1);
      }
    }
  }

  // ---- 屋上：中くらいの高さのビルの屋上に、広告看板（道の方を向く）か給水塔 ----
  const boards = [];
  let roofs = 0;
  for (const b of map.buildings) {
    if (roofs >= 24) break;
    const h = buildingHeights?.[b.id] ?? 0;
    if (h < 12 || h > 40 || rnd() > 0.05) continue;
    const area = Math.abs(polygonArea(b.p));
    if (area < 200 || area > 2000) continue;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    if (!insidePolygon(cx, cz, b.p) || !inBounds(map, cx, cz)) continue;
    // 置く物の大きさが屋上からはみ出さないか（四隅を確かめる）
    const near = nearestRoadPoint(map, cx, cz, true);
    const fx = near ? (near.x - cx) / (near.d || 1) : 1, fz = near ? (near.z - cz) / (near.d || 1) : 0;
    const billboard = rnd() < 0.6;
    const half = billboard ? [5, 1.5] : [1.6, 1.6];
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, c]) => [cx - fz * a * half[0] + fx * c * half[1], cz + fx * a * half[0] + fz * c * half[1]]);
    if (!corners.every(([x, z]) => insidePolygon(x, z, b.p))) continue;
    if (billboard) {
      put('billboard', cx, h, cz, along(fx, fz));
      boards.push({ x: cx, z: cz, h, fx, fz });
    } else put('waterTank', cx, h, cz, rnd() * 6);
    roofs++;
  }
  boards.forEach((bd, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 3.6), AD_TEXTURES[k % AD_TEXTURES.length]);
    m.position.set(bd.x + bd.fx * 0.27, bd.h + 4.0, bd.z + bd.fz * 0.27);
    m.rotation.y = Math.atan2(bd.fx, bd.fz); // 画の面（+z）を道の方へ
    m.name = 'adBoard'; // デバッグ・自動テスト用
    group.add(m);
  });

  // ---- 立体駐車場：駅から 60〜180m の空いた地面に 1 つ（入口の前に、出入りする車。syncCity10） ----
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  const towers = [];
  for (const st of stations) {
    if (towers.length >= 2) break;
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2, d = 60 + rnd() * 120;
      const x = st.x + Math.cos(a) * d, z = st.y + Math.sin(a) * d;
      const near = nearestRoadPoint(map, x, z, true);
      if (!near || near.d < 6 || near.d > 12 || near.road.e) continue;
      const fx = (near.x - x) / near.d, fz = (near.z - z) / near.d;
      const pts = [[0, 0], [3, 3.5], [-3, 3.5], [3, -3.5], [-3, -3.5], [0, 5]];
      if (!pts.every(([u, w]) => free(x - fz * u + fx * w, z + fx * u + fz * w, false)) || !clear(x, z, 6)) continue;
      put('parkTower', x, Y.area, z, along(fx, fz));
      const cg = carGeometry({ type: towers.length % 2 ? 'minivan' : 'sedan', color: towers.length % 2 ? '#f4f4f0' : '#3a5a8a' });
      const car = new THREE.Group();
      const body = new THREE.Mesh(cg.body, CAR_BODY_MAT);
      body.castShadow = true;
      car.add(body, new THREE.Mesh(cg.lights, CAR_LIGHT_MAT));
      car.name = 'towerCar'; // デバッグ・自動テスト用
      group.add(car);
      towers.push({ car, x: x + fx * 0.3, z: z + fz * 0.3, rot: along(fx, fz), phase: rnd() * 30 });
      taken.push([x, z, 6]);
      break;
    }
  }
  group.userData.towers = towers;

  // ---- ペットショップと花屋：商店街の道か駅のまわりの、道に向いた壁に（それぞれ 3 つまで） ----
  const shopRoads = map.roads.filter((r) => r.n && SHOP_STREETS.test(r.n) && !r.e);
  const cands = [];
  for (const r of shopRoads) for (let i = 0; i + 1 < r.p.length; i += 4) cands.push([r.p[i], r.p[i + 1]]);
  for (const st of stations) for (let k = 0; k < 8; k++) cands.push([st.x + Math.cos(k) * (60 + k * 15), st.y + Math.sin(k) * (60 + k * 15)]);
  const usedB = new Set();
  let pets = 0, flowers = 0;
  for (const [x, z] of cands.sort(() => rnd() - 0.5)) {
    if (pets >= 3 && flowers >= 3) break;
    const w = streetWall(map, roadHeights, x, z);
    if (!w || usedB.has(w.b) || !clear(w.mx, w.mz, 4)) continue;
    const key = pets <= flowers ? 'petShop' : 'florist';
    usedB.add(w.b);
    put(key, w.mx + w.nx * 0.12, 0, w.mz + w.nz * 0.12, along(w.nx, w.nz));
    taken.push([w.mx, w.mz, 4]);
    key === 'petShop' ? pets++ : flowers++;
  }

  // ---- 消防署：建物の道に向いた壁に車庫。開いた車庫の前の道から、ときどき消防車が出る（syncCity10） ----
  const fires = [];
  const FS = map.services?.fireStations ?? [];
  for (let i = 0; i + 1 < FS.length; i += 2) {
    const w = streetWall(map, roadHeights, FS[i], FS[i + 1], 12.5);
    if (!w || !clear(w.mx, w.mz, 7)) continue;
    put('fireStation', w.mx + w.nx * 0.12, 0, w.mz + w.nz * 0.12, along(w.nx, w.nz));
    // 開いた車庫（壁に沿って -2.9m）の前
    const ex = -w.nz, ez = w.nx; // 壁に沿う向き（店先の +x と同じ回し方）
    fires.push({ x: w.mx + w.nx * 3 - ex * 2.9, z: w.mz + w.nz * 3 - ez * 2.9, wait: 8 + rnd() * 20 });
    taken.push([w.mx, w.mz, 7]);
  }
  group.userData.fireStations = fires;

  for (const [key, list] of lists) {
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key === 'billboard' ? 'adBillboard' : key; // デバッグ・自動テスト用（屋上の物 その 2 の看板と区別）
      mesh.castShadow = material === STREET_MAT && key !== 'grave';
      group.add(mesh);
    }
  }
  group.userData.taken = taken;
}

// ---- 街の物 その 12（Blender で作ったモデル。tools/build-city11.py） ----
// 盆踊り（夏の夕方と夜、大きな公園）・建設中のビルとタワークレーン・駅前ロータリー・川沿いの桜並木（春）・ランニング大会・選挙カー。
// 記念写真（勝ったときの結果画面）も。どれも見た目だけ
const CITY11_URL = 'data/models/city11.glb';
const CITY11_NAMES = {
  yagura: 'C11_Yagura', bonLanterns: 'C11_BonLanterns', dancer0: 'C11_Dancer0', dancer1: 'C11_Dancer1',
  construction: 'C11_Construction', craneMast: 'C11_CraneMast', craneTop: 'C11_CraneTop', busShelter: 'C11_BusShelter', roundabout: 'C11_Roundabout',
  riverSakura: 'C11_RiverSakura', bonbori: 'C11_Bonbori', runner0: 'C11_Runner0', runner1: 'C11_Runner1', runner2: 'C11_Runner2', runner3: 'C11_Runner3',
  waterStation: 'C11_WaterStation', electionVan: 'C11_ElectionVan', waver: 'C11_Waver',
};
const city11 = { geos: null, done: false };
loadModelParts(CITY11_URL, CITY11_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city11.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 12）のモデルを読み込めませんでした: ${CITY11_URL}`, e))
  .finally(() => (city11.done = true));
const BON_DANCERS = 24; // 盆踊りの輪の人数
const MARATHON_RUNNERS = 40; // ランニング大会のランナーの数

function addCity11Props(group, map, roadHeights, buildingHeights) {
  const g = city11.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-11`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (where, key, x, h, z, rotY, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sx, sy, sz));
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const taken = [...(group.userData.taken ?? [])];
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const seasonal = group.userData.seasonal ?? {};
  const night = group.userData.nightProps;
  // 夏の夕方と夜だけ（盆踊り）：季節の「夏」の中の、夜の物
  const bonGroup = new THREE.Group();
  (seasonal.summer ?? group).add(bonGroup);
  group.userData.bonGroup = bonGroup;

  // ---- 盆踊り：いちばん大きい公園の、空いた広い所に、やぐらと提灯の線、まわりを輪になって踊る人（syncCity11） ----
  const parks = (map.areas ?? []).filter((a) => a.k === 'park' && a.r?.[0]?.length >= 6).map((a) => ({ ring: a.r[0], area: Math.abs(polygonArea(a.r[0])) })).sort((a, b) => b.area - a.area);
  const bon = [];
  for (const pk of parks.slice(0, 4)) {
    if (bon.length) break;
    const ring = pk.ring;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) (minX = Math.min(minX, ring[i])), (maxX = Math.max(maxX, ring[i])), (minZ = Math.min(minZ, ring[i + 1])), (maxZ = Math.max(maxZ, ring[i + 1]));
    for (let k = 0; k < 60; k++) {
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      const pts = [[0, 0], ...Array.from({ length: 12 }, (_, i) => [Math.cos((i * Math.PI) / 6) * 9, Math.sin((i * Math.PI) / 6) * 9])];
      if (!pts.every(([u, w]) => insidePolygon(x + u, z + w, ring) && free(x + u, z + w, false)) || !clear(x, z, 10)) continue;
      const o = new THREE.Group();
      o.position.set(x, Y.area, z);
      const yagura = new THREE.Mesh(g.yagura.body, STREET_MAT);
      yagura.castShadow = true;
      o.add(yagura);
      for (let i = 0; i < 4; i++) {
        const l = new THREE.Group();
        l.position.set(0, 5.6, 0);
        l.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
        l.add(new THREE.Mesh(g.bonLanterns.body, STREET_MAT), new THREE.Mesh(g.bonLanterns.glow, STREET_GLOW_MAT));
        o.add(l);
      }
      const dancers = [0, 1].map((v) => {
        const m = new THREE.InstancedMesh(g[`dancer${v}`].body, STREET_MAT, BON_DANCERS / 2);
        m.frustumCulled = false;
        m.castShadow = true;
        o.add(m);
        return m;
      });
      o.name = 'bonOdori'; // デバッグ・自動テスト用
      bonGroup.add(o);
      bon.push({ dancers, R: 6.5 });
      taken.push([x, z, 10]);
      break;
    }
  }
  group.userData.bon = bon;

  // ---- 建設中のビル：工事中の所の近くの、空いた広い地面に 1 つ。上でタワークレーンの腕が回る（syncCity11） ----
  const cranes = [];
  const works = map.works ?? [];
  for (let i = 0; i + 1 < works.length && cranes.length < 1; i += 2) {
    for (let k = 0; k < 20; k++) {
      const x = works[i] + (rnd() - 0.5) * 60, z = works[i + 1] + (rnd() - 0.5) * 60;
      const pts = [[0, 0], [8.5, 8.5], [-8.5, 8.5], [8.5, -8.5], [-8.5, -8.5], [12, 0]];
      if (!pts.every(([u, w]) => free(x + u, z + w, false)) || !clear(x, z, 12)) continue;
      put('static', 'construction', x, Y.area, z, rnd() * Math.PI);
      put('static', 'craneMast', x + 11, Y.area, z, 0);
      const top = new THREE.Group();
      top.position.set(x + 11, Y.area + 34, z);
      const arm = new THREE.Mesh(g.craneTop.body, STREET_MAT);
      arm.castShadow = true;
      top.add(arm);
      top.name = 'craneTop'; // デバッグ・自動テスト用
      group.add(top);
      cranes.push({ top, phase: rnd() * 10 });
      taken.push([x, z, 12]);
      break;
    }
  }
  group.userData.cranes = cranes;

  // ---- 駅前ロータリー：駅のまわりの空いた所（駅前広場の歩道でもよい）に真ん中の島。入らなければ小さくする。
  // 島からいちばん近い車道の、駅の側の端に乗り場の屋根（1 区間に 1 つ） ----
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  let roundabout = false;
  for (const st of stations) {
    if (roundabout) break;
    for (const sc of [1, 0.75, 0.55, 0.4]) {
      if (roundabout) break;
      const R = 9 * sc;
      for (let k = 0; k < 48 && !roundabout; k++) {
        const a = (k / 48) * Math.PI * 2 * 3, d = 25 + (k % 5) * 20;
        const x = st.x + Math.cos(a) * d, z = st.y + Math.sin(a) * d;
        const ring = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * R, Math.sin((i * Math.PI) / 4) * R])];
        if (!ring.every(([u, w]) => free(x + u, z + w)) || !clear(x, z, R + 1)) continue;
        const near = nearestRoadPoint(map, x, z, true);
        if (!near || near.d > R + 20 || near.road.w < 6) continue;
        put('static', 'roundabout', x, surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area, z, 0, sc, 1, sc);
        taken.push([x, z, R + 1]);
        roundabout = true;
        const [dx, dz] = roadDirAt(near.road, near.x, near.z);
        let nx = -dz, nz = dx;
        if ((st.x - near.x) * nx + (st.y - near.z) * nz < 0) (nx = -nx), (nz = -nz);
        // 道に沿って前後にずらしながら、屋根（長さ 13m）が入る所を探す
        shelter: for (const side of [1, -1]) {
          for (const shift of [0, 8, -8, 16, -16, 24, -24]) {
            const ox = nx * side, oz = nz * side;
            const sx = near.x + dx * shift + ox * (near.road.w / 2 + 1.8), sz = near.z + dz * shift + oz * (near.road.w / 2 + 1.8);
            if (![[0, 0], [5.5, 0], [-5.5, 0], [0, 1.2]].every(([u, w]) => free(sx + dx * u + ox * w, sz + dz * u + oz * w)) || !clear(sx, sz, 3)) continue;
            put('static', 'busShelter', sx, surfaceAt(map, sx, sz).kind === 'path' ? Y.path : Y.area, sz, along(-ox, -oz));
            taken.push([sx, sz, 6]);
            break shelter;
          }
        }
      }
    }
  }

  // ---- 川沿いの桜並木（春）：川の岸に沿って 18m おきに、川へ張り出す桜。夜はぼんぼりが灯る ----
  let sakura = 0;
  for (const l of map.lines) {
    if (l.k !== 'river' || l.w < 6 || sakura >= 60) continue;
    let next = 9, walked = 0;
    for (let i = 0; i + 3 < l.p.length && sakura < 60; i += 2) {
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      while (next <= walked + len && sakura < 60) {
        const t = (next - walked) / len;
        next += 18;
        for (const s of [1, -1]) {
          const nx = -uz * s, nz = ux * s; // 岸の外向き
          const x = x1 + (x2 - x1) * t + nx * (l.w / 2 + 2.5), z = z1 + (z2 - z1) * t + nz * (l.w / 2 + 2.5);
          if (!free(x, z, false) || !clear(x, z, 3)) continue;
          put('spring', 'riverSakura', x, Y.area, z, faceTo(-nx, -nz)); // +X（張り出す側）を川へ
          if (sakura % 2 === 0) put('springNight', 'bonbori', x + ux * 4, Y.area, z + uz * 4, 0);
          sakura++;
        }
      }
      walked += len;
    }
  }

  // ---- ランニング大会：区間の大きな車道の 1 本に沿って、ランナーの列が走る（ときどき。syncCity11）。途中に給水所 ----
  // （動かす InstancedMesh は区間の立体の直下に置かない：少しずつ見せる仕組み reveal が直下の物の frustumCulled を戻すため）
  const marathonGroup = new THREE.Group();
  group.add(marathonGroup);
  group.userData.marathonGroup = marathonGroup;
  const course = map.roads.filter((r) => !r.e && !r.path && r.w >= 12 && r.p.length >= 6).sort((a, b) => b.p.length - a.p.length)[0];
  if (course) {
    const cum = [0];
    for (let i = 0; i + 3 < course.p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(course.p[i + 2] - course.p[i], course.p[i + 3] - course.p[i + 1]));
    const len = cum[cum.length - 1];
    if (len > 200) {
      const meshes = [0, 1, 2, 3].map((v) => {
        const m = new THREE.InstancedMesh(g[`runner${v}`].body, STREET_MAT, MARATHON_RUNNERS);
        m.frustumCulled = false;
        m.castShadow = true;
        m.count = 0;
        m.name = 'runners'; // デバッグ・自動テスト用
        marathonGroup.add(m);
        return m;
      });
      const runners = Array.from({ length: MARATHON_RUNNERS }, (_, k) => ({ v: k % 4, off: -k * 2.2 - rnd() * 1.5, lane: (rnd() - 0.5) * 3, speed: 3.2 + rnd() * 0.8, ph: rnd() * 6 }));
      group.userData.marathon = { p: course.p, cum, len, w: course.w, meshes, runners, t: -rnd() * 60 };
      // 給水所：コースの真ん中あたりの、進む向きの左の道ばた
      let i = 0;
      while (i + 2 < cum.length && cum[i + 1] < len / 2) i++;
      const t = (len / 2 - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const ax = course.p[2 * i], az = course.p[2 * i + 1], bx = course.p[2 * i + 2], bz = course.p[2 * i + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l;
      const wx = ax + (bx - ax) * t + uz * (course.w / 2 + 1.3), wz = az + (bz - az) * t - ux * (course.w / 2 + 1.3);
      if (free(wx, wz) && clear(wx, wz, 3)) put('marathon', 'waterStation', wx, surfaceAt(map, wx, wz).kind === 'path' ? Y.path : Y.area, wz, along(-uz, ux));
    }
  }
  const springNight = new THREE.Group();
  (seasonal.spring ?? group).add(springNight);
  group.userData.springNight = springNight;
  const parents = { static: group, spring: seasonal.spring ?? group, springNight, marathon: marathonGroup };
  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = parents[where] ?? group;
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      parent.add(mesh);
    }
  }
  group.userData.taken = taken;
}

// ---- 街の物 その 13（Blender で作ったモデル。tools/build-city12.py） ----
// 夜の屋台村（湯気）・川のカモと白鳥・打ち水をする人（夏の昼）・窓ふきのゴンドラ・駅前の大きなクリスマスツリーと人だかり（冬）・
// 高架下の自転車置き場の列。除雪車は雪の日に道を走る（syncRiders）。どれも見た目だけ
const CITY12_URL = 'data/models/city12.glb';
const CITY12_NAMES = { yataiMura: 'C12_YataiMura', snowPlow: 'C12_SnowPlow', duck: 'C12_Duck', swan: 'C12_Swan', uchimizu: 'C12_Uchimizu', gondola: 'C12_Gondola' };
const city12 = { geos: null, done: false };
loadModelParts(CITY12_URL, CITY12_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city12.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 13）のモデルを読み込めませんでした: ${CITY12_URL}`, e))
  .finally(() => (city12.done = true));
// 湯気の画（白いぼやけた丸）
const STEAM_TEX = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

function addCity12Props(group, map, roadHeights, buildingHeights) {
  const g = city12.geos;
  if (!g) return;
  const rnd = seededRng(`${map.id ?? 'city'}-12`);
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const lists = new Map();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);
  const put = (where, key, x, h, z, rotY, sc = 1) => {
    const m = new THREE.Matrix4().compose(tmpP.set(x, h, z), tmpQ.setFromAxisAngle(Y_UP, rotY), tmpS.set(sc, sc, sc));
    const id = `${where}|${key}`;
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push(m);
  };
  const free = (x, z, onPath = true) => inBounds(map, x, z) && freeSpot(map, roadHeights, x, z, onPath);
  const taken = [...(group.userData.taken ?? [])];
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const seasonal = group.userData.seasonal ?? {};
  const night = group.userData.nightProps ?? group;
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station' && inBounds(map, l.x, l.y));
  const groundY = (x, z) => (surfaceAt(map, x, z).kind === 'path' ? Y.path : Y.area);

  // ---- 夜の屋台村：駅のまわりの、歩道に面した空いた地面に 1 つ（夕方と夜だけ。湯気は syncCity12） ----
  const steams = [];
  for (const st of stations) {
    if (steams.length) break;
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2, d = 30 + rnd() * 70;
      const x = st.x + Math.cos(a) * d, z = st.y + Math.sin(a) * d;
      const near = nearestRoadPoint(map, x, z, false);
      if (!near || near.d < 3 || near.d > 9) continue;
      const fx = (near.x - x) / near.d, fz = (near.z - z) / near.d; // 道の方（お客さんの側）
      const pts = [[0, 0], [5.3, 0], [-5.3, 0], [5.3, -1.6], [-5.3, -1.6], [0, 1]];
      if (!pts.every(([u, w]) => free(x - fz * u + fx * w, z + fx * u + fz * w, false)) || !clear(x, z, 6)) continue;
      put('night', 'yataiMura', x, Y.area, z, along(fx, fz));
      for (const u of [-3.3, 0, 3.3]) steams.push([x - fz * u - fx * 0.7, z + fx * u - fz * 0.7]);
      taken.push([x, z, 6]);
      break;
    }
  }
  if (steams.length) {
    const sg = new THREE.Group();
    for (const [x, z] of steams) {
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: STEAM_TEX, transparent: true, depthWrite: false }));
        sp.position.set(x, 1.3, z);
        sp.userData = { x, z, ph: k / 4 + rnd() * 0.1 };
        sg.add(sp);
      }
    }
    sg.name = 'yataiSteam'; // デバッグ・自動テスト用
    night.add(sg);
    group.userData.steam = sg;
  }

  // ---- 川のカモと白鳥：幅 8m 以上の川に、数羽ずつ群れで（ゆっくり泳ぐ。syncCity12） ----
  const swimmers = [];
  for (const l of map.lines) {
    if (l.k !== 'river' || l.w < 8 || swimmers.length >= 30) continue;
    for (let i = 0; i + 3 < l.p.length && swimmers.length < 30; i += 2) {
      if (rnd() > 0.25) continue;
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 10) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const swan = rnd() < 0.25;
      const n = swan ? 2 : 3 + Math.floor(rnd() * 3);
      const t = 0.3 + rnd() * 0.4, lat = (rnd() - 0.5) * (l.w * 0.5);
      const cx = x1 + (x2 - x1) * t - uz * lat, cz = z1 + (z2 - z1) * t + ux * lat;
      if (!inBounds(map, cx, cz) || (surfaceAt(map, cx, cz).segs ?? []).length) continue; // 橋の下はよける
      for (let k = 0; k < n; k++) swimmers.push({ kind: swan ? 'swan' : 'duck', cx: cx + (rnd() - 0.5) * 3, cz: cz + (rnd() - 0.5) * 3, ux, uz, ph: rnd() * 6, r: 2 + rnd() * 4 });
    }
  }
  if (swimmers.length) {
    const meshes = {};
    for (const kind of ['duck', 'swan']) {
      const n = swimmers.filter((s) => s.kind === kind).length;
      if (!n) continue;
      const m = new THREE.InstancedMesh(g[kind].body, STREET_MAT, n);
      m.frustumCulled = false;
      m.userData.keepUnculled = true;
      m.name = kind; // デバッグ・自動テスト用
      const holder = new THREE.Group(); // 少しずつ見せる仕組み（reveal）の直下に置かない
      holder.add(m);
      group.add(holder);
      meshes[kind] = m;
    }
    group.userData.swimmers = { list: swimmers, meshes };
  }

  // ---- 打ち水（夏の昼）：家や店の前の道ばたで、ひしゃくで道に水をまく人 ----
  const houses = map.buildings.filter((b) => b.p.length >= 8 && Math.abs(polygonArea(b.p)) < 400);
  for (let k = 0, placed = 0; k < 200 && placed < 6 && houses.length; k++) {
    const b = houses[Math.floor(rnd() * houses.length)];
    const i = 2 * Math.floor(rnd() * (b.p.length / 2 - 1));
    const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 4) continue;
    let nx = -(bz - az) / l, nz = (bx - ax) / l;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
    const x = mx + nx * 0.9, z = mz + nz * 0.9;
    const near = nearestRoadPoint(map, x, z, false);
    if (!near || near.d > 6 || !free(x, z) || !free(x + nx * 2.3, z + nz * 2.3) || !clear(x, z, 2)) continue;
    put('summerDay', 'uchimizu', x, groundY(x, z), z, along(nx, nz));
    taken.push([x, z, 2]);
    placed++;
  }

  // ---- 窓ふきのゴンドラ：高いビル（50m 以上）の道に向いた壁を、上から下へゆっくり降りる（syncCity12） ----
  const gondolas = [];
  for (const b of map.buildings) {
    if (gondolas.length >= 3) break;
    const h = buildingHeights?.[b.id] ?? 0;
    if (h < 50) continue;
    let best = null;
    for (let i = 0; i + 3 < b.p.length; i += 2) {
      const ax = b.p[i], az = b.p[i + 1], bx = b.p[i + 2], bz = b.p[i + 3];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 10) continue;
      let nx = -(bz - az) / l, nz = (bx - ax) / l;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (insidePolygon(mx + nx * 0.5, mz + nz * 0.5, b.p)) (nx = -nx), (nz = -nz);
      const near = nearestRoadPoint(map, mx + nx * 4, mz + nz * 4, true);
      if (!near || !inBounds(map, mx, mz)) continue;
      if (!best || near.d < best.d) best = { mx, mz, nx, nz, d: near.d };
    }
    if (!best || best.d > 30) continue;
    const o = new THREE.Group();
    o.position.set(best.mx + best.nx * 0.05, h, best.mz + best.nz * 0.05);
    o.rotation.y = along(best.nx, best.nz);
    const gon = new THREE.Mesh(g.gondola.body, STREET_MAT);
    gon.castShadow = true;
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.02), new THREE.MeshBasicMaterial({ color: 0x2a2d33 }));
    const cable2 = cable.clone();
    o.add(gon, cable, cable2);
    o.name = 'gondola'; // デバッグ・自動テスト用
    group.add(o);
    gondolas.push({ gon, cables: [cable, cable2], h, ph: rnd() * 100 });
  }
  group.userData.gondolas = gondolas;

  // ---- 駅前の大きなクリスマスツリー（冬）：駅のまわりの広い所に、2 倍の大きさのツリーと、見上げる人だかり ----
  if (city5.geos && city3.geos) {
    for (const st of stations) {
      let done = false;
      for (let k = 0; k < 48 && !done; k++) {
        const a = (k / 48) * Math.PI * 6, d = 30 + (k % 4) * 15;
        const x = st.x + Math.cos(a) * d, z = st.y + Math.sin(a) * d;
        const ring = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * 6, Math.sin((i * Math.PI) / 4) * 6])];
        if (!ring.every(([u, w]) => free(x + u, z + w)) || !clear(x, z, 7)) continue;
        const y = groundY(x, z);
        put('winter', 'bigTree', x, y, z, rnd() * 6, 2);
        for (let j = 0; j < 12; j++) {
          const b = (j / 12) * Math.PI * 2 + rnd() * 0.3, r = 5.2 + rnd() * 0.8;
          put('winter', `crowd${j % 4}`, x + Math.cos(b) * r, y, z + Math.sin(b) * r, along(-Math.cos(b), -Math.sin(b)));
        }
        taken.push([x, z, 7]);
        done = true;
      }
      if (done) break;
    }
  }

  // ---- 高架下の自転車置き場：高い所を走る山手線の線路の下の空いた地面に、線路に沿って並べる ----
  if (city3.geos) {
    let racks = 0;
    for (const l of map.lines) {
      if (l.k !== 'yamanote' || !l.e || racks >= 10) continue;
      let next = 10, walked = 0;
      for (let i = 0; i + 3 < l.p.length && racks < 10; i += 2) {
        const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1e-6) continue;
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        while (next <= walked + len && racks < 10) {
          const t = (next - walked) / len;
          next += 30;
          const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
          const pts = [[0, 0], [7, 0], [-7, 0], [0, 2.2], [0, -2.2]].map(([a, b]) => [x + ux * a - uz * b, z + uz * a + ux * b]);
          // 高架の下なので、線路の近くでも置く（freeSpot は線路の近くを外すので、ここでは建物・道だけを見る）
          if (!pts.every(([px, pz]) => inBounds(map, px, pz) && !['building', 'road'].includes(surfaceAt(map, px, pz).kind)) || !clear(x, z, 8)) continue;
          put('static', 'bikePark', x, 0, z, along(ux, uz));
          taken.push([x, z, 8]);
          racks++;
        }
        walked += len;
      }
    }
  }

  const summerDay = new THREE.Group();
  (seasonal.summer ?? group).add(summerDay);
  group.userData.summerDay = summerDay;
  const parents = { static: group, night, winter: seasonal.winter ?? group, summerDay };
  for (const [id, list] of lists) {
    const [where, key] = id.split('|');
    const parent = parents[where] ?? group;
    const geos = key === 'bigTree' ? city5.geos.xmas : key.startsWith('crowd') ? { body: city3.geos[`stand${key.slice(5)}`].body } : key === 'bikePark' ? city3.geos.bikePark : g[key];
    for (const [geo, material] of [[geos.body, STREET_MAT], [geos.glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      parent.add(mesh);
    }
  }
  group.userData.taken = taken;
}


export {
  AUTO_DOOR_NEAR,
  AUTO_DOOR_OPEN,
  BON_DANCERS,
  HWY_Y,
  MARATHON_RUNNERS,
  NIGHT_MAT,
  OBST_MAT,
  TREE_LIGHT_MAT,
  VISION_MAT,
  addCity10Props,
  addCity11Props,
  addCity12Props,
  addCity5Props,
  addCity6Props,
  addCity7Props,
  addCity8Props,
  addCity9Props,
  addGoalStaff,
  attachAccessory,
  city10,
  city11,
  city12,
  city5,
  city6,
  city7,
  city8,
  city9,
  drawVision,
  roadDirAt,
  seededRng
};
