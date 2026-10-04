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
import { PLAYER_CONFIG } from './player.js';

// 夕暮れ：空は上ほど濃い紺、地平線は赤みのある紫。霧は地平線の色に合わせて遠くを溶かす
const SKY_TOP = 0x10162a;
const SKY_MID = 0x2e2c4c;
const SKY_HORIZON = 0x8a5a62;
const SKY = 0x3a3450; // 霧と、空を描く前の背景の色
const FOG_NEAR = 120;
const FOG_FAR = 420;
const SKY_RADIUS = 440; // 空の球（カメラについて動く。描画範囲 FOG_FAR + 50 より内側に）
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

// 視点（C キー・右上のボタンで切り替え）。数値は m、fov は画角（度）。
//   chase：自転車の後ろ上から追いかける。遅いときや曲がっているときは高く上げて見下ろし、
//          曲がる方向を先に見る（交差点の先が建物に隠れにくいように）。速いほど画角を広げて速さを出す
//   high ：高めの斜め上から見下ろす（道を覚えるとき向き）
//   first：自転車に乗った目線
const CAMERAS = {
  chase: { name: '追いかけ', back: [13, 10], up: [10, 6], turnUp: 3, ahead: [18, 18], fov: [58, 72], turn: 4 },
  high: { name: '見下ろし', back: [18, 18], up: [34, 30], turnUp: 0, ahead: [10, 14], fov: [55, 60], turn: 3 },
  first: { name: '自転車目線', back: [0, 0], up: [1.7, 1.7], turnUp: 0, ahead: [20, 28], fov: [70, 82], turn: 9 },
};
const CAMERA_ORDER = ['chase', 'high', 'first'];
const CAMERA_EASE = 2.5; // 高さ・距離・画角の変わる速さ（1 秒あたり）
const LEAN_INTO_TURN = 0.35; // 曲がっているとき、向きの変わる速さ（rad/s）× この秒数ぶん先を見る
const STORAGE_KEY = 'yamanote-race:camera3d';
const LANDMARK_RANGE = 380; // この距離までのランドマークの名前を出す m

// 空：カメラを囲む球の内側に、上ほど濃い色のグラデーションを描く
function makeSky() {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_TOP) },
      mid: { value: new THREE.Color(SKY_MID) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader: `varying float h; void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying float h;
      void main() {
        vec3 c = h < 0.12 ? mix(horizon, mid, smoothstep(-0.05, 0.12, h)) : mix(mid, top, smoothstep(0.12, 0.6, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

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
  constructor(withColor = false, withUV = false) {
    this.pos = [];
    this.nor = [];
    this.col = withColor ? [] : null;
    this.uv = withUV ? [] : null;
  }
  // uvs：3 つの頂点のテクスチャ座標 [[u, v], [u, v], [u, v]]（withUV のとき）
  tri(a, b, c, n, color, uvs = ROOF_UV) {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) {
      this.nor.push(...n);
      if (this.col) this.col.push(...color);
      if (this.uv) this.uv.push(...uvs[k]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

// ---- 建物の窓 ----
// 窓のテクスチャ：WINDOW_COLS × WINDOW_ROWS 個の窓。1 個が横 WINDOW_W m・縦 FLOOR_H m（1 階ぶん）に当たる。
// 色は白地（建物ごとの色がかかる）に暗い窓。灯りのテクスチャは、ところどころの窓だけ明るい
const WINDOW_COLS = 8, WINDOW_ROWS = 8, WINDOW_PX = 32;
const WINDOW_W = 3.6, FLOOR_H = 3.2;
const ROOF_UV = [[0.002, 0.002], [0.002, 0.002], [0.002, 0.002]]; // 窓のない枠の部分（屋上・地面の物に使う）
const LIT_SHARE = 0.28; // 灯りのついた窓の割合

function windowTextures(maxAnisotropy) {
  const size = WINDOW_COLS * WINDOW_PX;
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAnisotropy;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lit = [];
  for (let i = 0; i < WINDOW_COLS * WINDOW_ROWS; i++) lit.push(rand() < LIT_SHARE ? 0.55 + rand() * 0.45 : 0);
  const cell = (ctx, i, j, inset = 8) => [i * WINDOW_PX + inset, j * WINDOW_PX + inset + 2, WINDOW_PX - inset * 2, WINDOW_PX - inset * 2 - 3];
  const color = make((ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (let j = 0; j < WINDOW_ROWS; j++) {
      for (let i = 0; i < WINDOW_COLS; i++) {
        ctx.fillStyle = '#4a5466';
        ctx.fillRect(...cell(ctx, i, j));
      }
    }
  });
  const glow = make((ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    for (let j = 0; j < WINDOW_ROWS; j++) {
      for (let i = 0; i < WINDOW_COLS; i++) {
        const v = lit[j * WINDOW_COLS + i];
        if (!v) continue;
        ctx.fillStyle = `rgba(255, ${200 + Math.round(v * 30)}, ${130 + Math.round(v * 60)}, ${v})`;
        ctx.fillRect(...cell(ctx, i, j));
      }
    }
  });
  return { color, glow };
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
    // 窓は壁の端から並べる（横は WINDOW_W m ごと、縦は 1 階 FLOOR_H m ごと）
    const u1 = len / WINDOW_W / WINDOW_COLS, v1 = h / FLOOR_H / WINDOW_ROWS;
    const ua = [0, 0], ub = [u1, 0], uc = [u1, v1], ud = [0, v1];
    if (ccw) {
      b.tri(a, c, bb, nrm, color, [ua, uc, ub]);
      b.tri(a, d, c, nrm, color, [ua, ud, uc]);
    } else {
      b.tri(a, bb, c, nrm, color, [ua, ub, uc]);
      b.tri(a, c, d, nrm, color, [ua, uc, ud]);
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
// 街灯：幅 STREETLIGHT_MIN_W m 以上の車道に、STREETLIGHT_SPACING m おきに道の片側に立てる
const STREETLIGHT_MIN_W = 8;
const STREETLIGHT_SPACING = 32;
const STREETLIGHT_H = 6.5;
const LAMP_COLOR = 0xffd9a0;

function streetLights(map) {
  const spots = [];
  for (const r of map.roads) {
    if (r.path || r.w < STREETLIGHT_MIN_W) continue;
    let next = STREETLIGHT_SPACING / 2;
    let walked = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const nx = -(z2 - z1) / len, nz = (x2 - x1) / len; // 道の左側
      while (next <= walked + len) {
        const t = (next - walked) / len;
        const off = r.w / 2 + 0.8;
        spots.push([x1 + (x2 - x1) * t + nx * off, z1 + (z2 - z1) * t + nz * off]);
        next += STREETLIGHT_SPACING;
      }
      walked += len;
    }
  }
  return spots;
}

function addStreetLights(group, map) {
  const spots = streetLights(map);
  if (!spots.length) return;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, STREETLIGHT_H, 6), mat(0x4a4f5a), spots.length);
  const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshBasicMaterial({ color: LAMP_COLOR }), spots.length);
  // 足もとの明るい円（加算で重ねる）
  const poolGeo = new THREE.CircleGeometry(5.5, 24);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    pole.setMatrixAt(i, m.makeTranslation(x, STREETLIGHT_H / 2, z));
    lamp.setMatrixAt(i, m.makeTranslation(x, STREETLIGHT_H + 0.1, z));
    pool.setMatrixAt(i, m.makeTranslation(x, Y.signal - 0.01, z));
  });
  group.add(pole, lamp, pool);
}

// textures：窓のテクスチャ（windowTextures）
function buildWorld(map, textures) {
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
    if (!tileBuilders.has(key)) tileBuilders.set(key, new GeometryBuilder(true, true));
    // 壁の色：灰色を基本に、建物ごとに少し暖色・寒色に振る。高い建物ほど少し明るく
    const t = Math.min(1, h / 80);
    const r = ((i * 7919) % 100) / 100, tint = (((i * 104729) % 100) / 100 - 0.5) * 0.06;
    const v = 0.34 + 0.14 * t + r * 0.08;
    addBuilding(tileBuilders.get(key), bd.p, h, [v + tint, v * 1.02, v * 1.08 - tint]);
    heights.push(h);
    tileOf.push(key);
  });
  const tiles = new Map();
  for (const [key, b] of tileBuilders) {
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      map: textures.color,
      emissiveMap: textures.glow,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
    });
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.userData.opacity = 1;
    tiles.set(key, mesh);
    group.add(mesh);
  }
  group.userData = { tiles, heights, tileOf };

  addStreetLights(group, map);

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
  // 夕暮れの光：空からの青みのある光と、西の低い位置からの赤みのある光
  scene.add(new THREE.HemisphereLight(0x9aa6d8, 0x2a2228, 1.5));
  const sun = new THREE.DirectionalLight(0xffb07a, 1.5);
  sun.position.set(-1, 0.35, 0.25);
  scene.add(sun);
  const sky = makeSky();
  scene.add(sky);
  const textures = windowTextures(renderer.capabilities.getMaxAnisotropy());
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
  let cameraMode = 'chase';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (CAMERAS[saved]) cameraMode = saved;
  } catch {
    // 保存できない環境でも遊べる
  }
  const cam = { back: null, up: 0, ahead: 0, fov: 60, turnRate: 0, prevAngle: null };
  let viewW = 1, viewH = 1;
  const goalVec = new THREE.Vector3();
  const toGoal = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  // 区間が変わったら作り直す
  function setMap(map) {
    if (world) {
      scene.remove(world);
      world.traverse((m) => {
        m.geometry?.dispose();
        m.material?.dispose();
      });
    }
    world = buildWorld(map, textures);
    worldMap = map;
    scene.add(world);
    camAngle = null;
    cam.back = null;
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

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = (from, to, dt) => from + (to - from) * Math.min(1, CAMERA_EASE * dt);

  function placeCamera(game, dt) {
    const p = game.player;
    const c = CAMERAS[cameraMode];
    // 速さ（0〜1）と、曲がる速さ（rad/s。なめらかにする）
    const k = Math.max(0, Math.min(1, p.speed / PLAYER_CONFIG.maxSpeed));
    if (cam.prevAngle === null || dt <= 0) cam.prevAngle = p.angle;
    const rate = dt > 0 ? wrap(p.angle - cam.prevAngle) / dt : 0;
    cam.prevAngle = p.angle;
    cam.turnRate += (rate - cam.turnRate) * Math.min(1, 5 * dt);
    const turning = Math.min(1, Math.abs(cam.turnRate) / 1.2);

    const target = {
      back: c.back[0] + (c.back[1] - c.back[0]) * k,
      up: c.up[0] + (c.up[1] - c.up[0]) * k + c.turnUp * turning,
      ahead: c.ahead[0] + (c.ahead[1] - c.ahead[0]) * k,
      fov: c.fov[0] + (c.fov[1] - c.fov[0]) * k,
    };
    if (cam.back === null) Object.assign(cam, target); // 最初と、区間が変わったときはすぐその位置に
    else for (const key of ['back', 'up', 'ahead', 'fov']) cam[key] = ease(cam[key], target[key], dt);

    // 向きはなめらかに追いかける（急に回ると酔うので）
    if (camAngle === null) camAngle = p.angle;
    camAngle += wrap(p.angle - camAngle) * Math.min(1, c.turn * dt);
    const fx = Math.sin(camAngle), fz = -Math.cos(camAngle);
    // 曲がっている方向を先に見る
    const look = camAngle + Math.max(-0.5, Math.min(0.5, cam.turnRate * LEAN_INTO_TURN));
    const lx = Math.sin(look), lz = -Math.cos(look);
    camera.position.set(p.x - fx * cam.back, cam.up, p.y - fz * cam.back);
    camera.lookAt(p.x + lx * cam.ahead, cameraMode === 'first' ? 1.5 : 1, p.y + lz * cam.ahead);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    player.visible = cameraMode !== 'first'; // 自転車目線では自分の自転車は描かない
  }

  // ゴールが画面のどこに見えるか（HUD が距離や方向の矢印を出すのに使う）
  function locateGoal(game) {
    const g = game.map.goal;
    goalVec.set(g.x, 3, g.y);
    camera.getWorldDirection(camDir);
    toGoal.copy(goalVec).sub(camera.position);
    const behind = toGoal.dot(camDir) <= 0;
    goalVec.project(camera);
    let x = ((goalVec.x + 1) / 2) * viewW, y = ((1 - goalVec.y) / 2) * viewH;
    // 後ろにあるときは、画面の中心について反対側に映る
    if (behind) (x = viewW - x), (y = viewH - y);
    r3d.hud.goal3d = { x, y, behind };
  }

  // ランドマークの名前を出す画面上の位置（HUD が描く）。カメラの前の LANDMARK_RANGE m 以内だけ
  const lmVec = new THREE.Vector3();
  function locateLandmarks(game) {
    const list = [];
    camera.getWorldDirection(camDir);
    for (const lm of game.map.landmarks ?? []) {
      const dist = Math.hypot(lm.x - camera.position.x, lm.y - camera.position.z);
      if (dist > LANDMARK_RANGE || dist < 6) continue;
      lmVec.set(lm.x, lm.k === 'station' ? 26 : 16, lm.y);
      toGoal.copy(lmVec).sub(camera.position);
      if (toGoal.dot(camDir) <= 0) continue;
      lmVec.project(camera);
      if (Math.abs(lmVec.x) > 1.1 || Math.abs(lmVec.y) > 1.1) continue;
      list.push({ lm, x: ((lmVec.x + 1) / 2) * viewW, y: ((1 - lmVec.y) / 2) * viewH, dist });
    }
    r3d.hud.landmarks3d = list; // データの並び（重要度の高い順）のまま
  }

  function setCameraMode(mode) {
    cameraMode = mode;
    cam.back = null;
    camAngle = null;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 保存できなくても切り替えは効く
    }
  }

  let lastTime = performance.now();

  const r3d = {
    mode: '3d',
    // HUD：3D では地図を真上から見ていないので、ランドマークの名前とゴール方向の矢印は出さない
    // （ゴールは光の柱とミニマップで分かる）
    hud: { ppm: 1, landmarks: false, goalPointer: false, goal3d: null, landmarks3d: null },

    // 視点の名前と切り替え（game.js の C キー・右上のボタンから）
    get cameraName() {
      return CAMERAS[cameraMode].name;
    },
    nextCamera() {
      setCameraMode(CAMERA_ORDER[(CAMERA_ORDER.indexOf(cameraMode) + 1) % CAMERA_ORDER.length]);
      return CAMERAS[cameraMode].name;
    },

    resize(w, h, dpr) {
      viewW = w;
      viewH = h;
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
      sky.position.copy(camera.position);
      locateGoal(game);
      locateLandmarks(game);
      fadeOccluders(game, dt);
      renderer.render(scene, camera);
    },
  };
  window.render3d = { renderer, scene, camera, r3d }; // デバッグ・自動テスト用
  return r3d;
}
