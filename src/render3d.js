// 3D版の世界の描き方（Three.js）。地図データ（道路・建物・公園・水域・線路）を立体にし、
// 自転車の後ろ上から追いかける視点で描く。HUD（メニュー・レースバー・ミニマップ）は game.js が
// 上に重ねた透明なキャンバスに描く。
//
// 座標：地図の (x, y)（m。x は東、y は南が正）を Three.js の (x, 高さ, y) に置く（y が上）。
// 向き：自転車などの angle（北が 0、時計回り）は rotation.y = -angle（前が -z 方向のモデル）。
import * as THREE from 'three';
import { signalState } from './obstacles.js';
import { pointAt, frontDistance, carCount, ELEVATED_H } from './trainpath.js';
import { AREA_COLORS, LINE_STYLES, cellKey, nodeKey, surfaceAt } from './map.js';
import { PLAYER_CONFIG } from './player.js';
import { pedLook, pedSwing } from './pedestrians.js';
import { carLook } from './vehicles.js';
import { signalPose, LAMPS } from './signals.js';

// 夕暮れ：空は上ほど濃い紺、地平線は赤みのある紫。霧は地平線の色に合わせて遠くを溶かす
const SKY_TOP = 0x10162a;
const SKY_MID = 0x2e2c4c;
const SKY_HORIZON = 0x8a5a62;
const SKY = 0x3a3450; // 霧と、空を描く前の背景の色
const FOG_NEAR = 120;
const FOG_FAR = 420;

// 時間帯（昼・夕方・夜）ごとの空・霧・光・窓の灯り・街灯。夕方が最初の設定（上の SKY_* と同じ）
const TIMES = {
  day: {
    sky: [0x3f78c4, 0x86afdf, 0xd3e1ee], fog: 0xb9cadb,
    hemi: [0xffffff, 0x4a4640, 1.9], sun: [0xfff2dd, 2.3], sunDir: [-0.45, 1, 0.35],
    glow: 0.05, lamps: false,
  },
  evening: {
    sky: [SKY_TOP, SKY_MID, SKY_HORIZON], fog: SKY,
    hemi: [0x9aa6d8, 0x2a2228, 1.5], sun: [0xffb07a, 1.5], sunDir: [-1, 0.35, 0.25],
    glow: 0.9, lamps: true,
  },
  night: {
    sky: [0x03050c, 0x0a0f1e, 0x1b1f36], fog: 0x0e1222,
    hemi: [0x4a5a8a, 0x101014, 0.75], sun: [0x8b9cd0, 0.45], sunDir: [0.4, 1, -0.3],
    glow: 1.35, lamps: true,
  },
};
// 天気が空・霧・光をどう変えるか。gray：空と霧を灰色に寄せる割合、light：光の強さの倍率
const WEATHERS = {
  clear: { gray: 0, fogNear: FOG_NEAR, fogFar: FOG_FAR, light: 1 },
  rain: { gray: 0.8, fogNear: 50, fogFar: 260, light: 0.65 },
  snow: { gray: 0.7, fogNear: 60, fogFar: 300, light: 0.85, whiten: 0.25 },
};
// 街灯の灯りと足もとの明かり（すべての区間の立体で共有し、時間帯で明るさを変える）
const LAMP_MAT = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
const POOL_MAT = new THREE.MeshBasicMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
let windowGlow = TIMES.evening.glow; // 新しく作る区間の窓の灯りの強さ
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
const SHADOW_RANGE = 110; // 影を付ける範囲（自転車のまわり、この距離の四方）m

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
  mesh.userData.uniforms = material.uniforms; // 時間帯で色を変える
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
// 位置・法線・色・テクスチャ座標を貯めて 1 つの BufferGeometry にする。
// 区間ごとに何十万個の数値を入れるので、ふつうの配列ではなく、足りなくなったら倍に広げる Float32Array に詰める
// （ふつうの配列だと、作り終えたあとのメモリの片付けで描画が引っかかる）
class FloatList {
  constructor(size = 4096) {
    this.a = new Float32Array(size);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let size = this.a.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Float32Array(size);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  get length() {
    return this.n;
  }
  // 作り終えた分だけの配列（コピーせずに切り出す）
  view() {
    return this.a.subarray(0, this.n);
  }
}

class GeometryBuilder {
  constructor(withColor = false, withUV = false) {
    this.pos = new FloatList();
    this.nor = new FloatList();
    this.col = withColor ? new FloatList() : null;
    this.uv = withUV ? new FloatList(2048) : null;
  }
  // uvs：3 つの頂点のテクスチャ座標 [[u, v], [u, v], [u, v]]（withUV のとき）
  tri(a, b, c, n, color, uvs = ROOF_UV) {
    const P = this.pos, N = this.nor;
    P.reserve(9);
    N.reserve(9);
    const pa = P.a;
    let i = P.n;
    pa[i++] = a[0]; pa[i++] = a[1]; pa[i++] = a[2];
    pa[i++] = b[0]; pa[i++] = b[1]; pa[i++] = b[2];
    pa[i++] = c[0]; pa[i++] = c[1]; pa[i++] = c[2];
    P.n = i;
    const na = N.a;
    i = N.n;
    for (let k = 0; k < 3; k++) (na[i++] = n[0]), (na[i++] = n[1]), (na[i++] = n[2]);
    N.n = i;
    if (this.col) {
      const C = this.col;
      C.reserve(9);
      const ca = C.a;
      i = C.n;
      for (let k = 0; k < 3; k++) (ca[i++] = color[0]), (ca[i++] = color[1]), (ca[i++] = color[2]);
      C.n = i;
    }
    if (this.uv) {
      const U = this.uv;
      U.reserve(6);
      const ua = U.a;
      i = U.n;
      for (let k = 0; k < 3; k++) (ua[i++] = uvs[k][0]), (ua[i++] = uvs[k][1]);
      U.n = i;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
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

// 高架橋：線の下に厚さ DECK_T の板（上面と両側面）を作る
const DECK_T = 1.1;
const DECK_EXTRA = 1.6; // 線路の幅より広げる m
const DECK_COLOR = 0x6a6e78;
const PILLAR_SPACING = 16;

function addDeck(b, p, w, y) {
  addRibbon(b, p, w, y); // 上面
  const hw = w / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
    for (const side of [1, -1]) {
      const ox = nx * hw * side, oz = nz * hw * side;
      const a = [x1 + ox, y, z1 + oz], c = [x2 + ox, y, z2 + oz], d = [x2 + ox, y - DECK_T, z2 + oz], e = [x1 + ox, y - DECK_T, z1 + oz];
      const n = [nx * side, 0, nz * side];
      b.tri(a, c, d, n);
      b.tri(a, d, e, n);
    }
  }
  addRibbon(b, p, w, y - DECK_T); // 下面
}

// 高架橋の柱の位置（線に沿って PILLAR_SPACING m おき）
function pillarSpots(p, spacing = PILLAR_SPACING) {
  const spots = [];
  let next = spacing / 2, walked = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    while (next <= walked + len) {
      const t = (next - walked) / len;
      spots.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, i / 2, t]); // 位置と、どの線分のどこか
      next += spacing;
    }
    walked += len;
  }
  return spots;
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
// ---- 道路の橋・高架 ----
// 地図データの道路の e（橋・高架の高さ m）から、道路の点ごとの高さを決める。
// OSM で「橋」になっているのは線路や道路の上の部分だけで、手前の上り坂は普通の道として描かれていることが多い。
// そこで、橋の点の高さを、つながる道に沿って一定の勾配（RAMP_SLOPE）で下げていき、手前の道を坂にする
// （橋の下をくぐる道は橋とつながっていないので、高さは変わらない）
const RAMP_SLOPE = 0.11; // 坂の勾配（高さ 5.5m の橋なら、手前 50m かけて上る）
const ROAD_DECK_T = 0.9;
const ROAD_PILLAR_SPACING = 14;

function computeRoadHeights(map) {
  const nodeH = new Map(); // 点（座標）→ 高さ
  const key = (r, v) => nodeKey(r.p[2 * v], r.p[2 * v + 1]);
  // 橋の点は橋の高さに固定。ただし、どこにもつながっていない端は固定せず、橋の中で坂にする
  // （駐車場の一部などが孤立した橋として描かれていて、宙に浮いてしまうため）
  const fixed = new Set();
  for (const r of map.roads) {
    if (!r.e) continue;
    const n = r.p.length / 2;
    for (let v = 0; v < n; v++) {
      const k = key(r, v);
      const end = v === 0 || v === n - 1;
      if (end && !(map.nodes.get(k) ?? []).some((o) => o.road !== r)) continue;
      nodeH.set(k, Math.max(nodeH.get(k) ?? 0, r.e));
      fixed.add(k);
    }
  }
  // 高い点から順に、となりの点へ「高さ − 距離 × 勾配」を伝える（高さの大きい順に取り出すヒープ）
  const heap = [];
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const pa = (i - 1) >> 1;
      if (heap[pa][1] >= heap[i][1]) break;
      [heap[pa], heap[i]] = [heap[i], heap[pa]];
      i = pa;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i;
        if (l < heap.length && heap[l][1] > heap[m][1]) m = l;
        if (rr < heap.length && heap[rr][1] > heap[m][1]) m = rr;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const entry of nodeH) push(entry);
  while (heap.length) {
    const [k, h] = pop();
    if (h < (nodeH.get(k) ?? 0)) continue;
    for (const { road, v } of map.nodes.get(k) ?? []) {
      for (const w of [v - 1, v + 1]) {
        if (w < 0 || w >= road.p.length / 2) continue;
        const nk = key(road, w);
        if (fixed.has(nk)) continue;
        const nh = h - Math.hypot(road.p[2 * w] - road.p[2 * v], road.p[2 * w + 1] - road.p[2 * v + 1]) * RAMP_SLOPE;
        if (nh > 0.05 && nh > (nodeH.get(nk) ?? 0)) {
          nodeH.set(nk, nh);
          push([nk, nh]);
        }
      }
    }
  }
  const heights = new Map(); // 道路 → 点ごとの高さ（Float32Array）。どこも高さ 0 の道路は入れない
  for (const r of map.roads) {
    const n = r.p.length / 2;
    let any = false;
    const hs = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      hs[v] = nodeH.get(key(r, v)) ?? 0;
      if (hs[v] > 0) any = true;
    }
    if (any) heights.set(r, hs);
  }
  return heights;
}

// 道路 road の点 v と次の点のあいだ、割合 t（0〜1）の高さ
function roadHeightAt(heights, road, v, t) {
  const hs = heights.get(road);
  if (!hs) return 0;
  const a = hs[Math.max(0, Math.min(hs.length - 1, v))], b = hs[Math.max(0, Math.min(hs.length - 1, v + 1))];
  return a + (b - a) * t;
}

// 線分 seg（map.js の surfaceAt の segs の 1 つ）の上の、地点 (x, y) の高さ
function segHeight(heights, seg, x, y) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - seg.x1) * dx + (y - seg.y1) * dy) / len2)) : 0;
  return roadHeightAt(heights, seg.road, seg.v, t);
}

// 地点 (x, y) の高さ。橋と下の道が重なる所では、直前の高さ prev に近い方を選ぶ（急に上下に飛ばないように）
function groundHeight(heights, segs, x, y, prev) {
  if (!segs?.length) return 0;
  let best = 0, bestD = Infinity;
  for (const s of segs) {
    const h = segHeight(heights, s, x, y);
    const d = prev == null ? h : Math.abs(h - prev);
    if (d < bestD) (bestD = d), (best = h);
  }
  return best;
}

// 高さの変わる帯（橋の道路の上面）
function addRibbonH(b, p, w, hs, lift) {
  const hw = w / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const y1 = hs[i / 2] + lift, y2 = hs[i / 2 + 1] + lift;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = (-(z2 - z1) / len) * hw, nz = ((x2 - x1) / len) * hw;
    const a = [x1 + nx, y1, z1 + nz], bb = [x1 - nx, y1, z1 - nz], c = [x2 - nx, y2, z2 - nz], d = [x2 + nx, y2, z2 + nz];
    b.tri(a, c, bb, UP);
    b.tri(a, d, c, UP);
  }
  for (let i = 2; i + 2 < p.length; i += 2) addDisc(b, p[i], p[i + 1], hw, hs[i / 2] + lift, 8);
}

// 橋の側面と裏（地面より上にある所だけ）
function addRoadDeckSides(b, p, w, hs) {
  const hw = w / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const y1 = hs[i / 2], y2 = hs[i / 2 + 1];
    if (y1 < 0.5 && y2 < 0.5) continue;
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
    const b1 = Math.max(0.05, y1 - ROAD_DECK_T), b2 = Math.max(0.05, y2 - ROAD_DECK_T);
    for (const side of [1, -1]) {
      const ox = nx * hw * side, oz = nz * hw * side;
      const n = [nx * side, 0, nz * side];
      b.tri([x1 + ox, y1, z1 + oz], [x2 + ox, y2, z2 + oz], [x2 + ox, b2, z2 + oz], n);
      b.tri([x1 + ox, y1, z1 + oz], [x2 + ox, b2, z2 + oz], [x1 + ox, b1, z1 + oz], n);
    }
    // 裏
    b.tri([x1 + nx * hw, b1, z1 + nz * hw], [x2 - nx * hw, b2, z2 - nz * hw], [x1 - nx * hw, b1, z1 - nz * hw], [0, -1, 0]);
    b.tri([x1 + nx * hw, b1, z1 + nz * hw], [x2 + nx * hw, b2, z2 + nz * hw], [x2 - nx * hw, b2, z2 - nz * hw], [0, -1, 0]);
  }
}

// 街灯：幅 STREETLIGHT_MIN_W m 以上の車道に、STREETLIGHT_SPACING m おきに道の片側に立てる。
// 歩道の端の柱から道路の上へ少し上向きの腕を伸ばし、先の平たい灯具の下面が光る（日本の道路でよく見る形）
const STREETLIGHT_MIN_W = 8;
const STREETLIGHT_SPACING = 32;
const STREETLIGHT_H = 6.8; // 柱の高さ m
const STREETLIGHT_ARM = 1.9; // 腕の長さ m（道路の側へ）
const STREETLIGHT_TILT = 0.12; // 腕の上向きの角度 rad

function streetLights(map, heights) {
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
        // 位置・高さと、道路の側を向く向き（道の左側に立つので、道路の側は -n）
        spots.push([x1 + (x2 - x1) * t + nx * off, z1 + (z2 - z1) * t + nz * off, roadHeightAt(heights, r, i / 2, t), Math.atan2(nz, -nx)]);
        next += STREETLIGHT_SPACING;
      }
      walked += len;
    }
  }
  return spots;
}

function addStreetLights(group, map, heights) {
  const spots = streetLights(map, heights);
  if (!spots.length) return;
  const n = spots.length;
  // 部品（ローカルの +x が道路の側）：柱・腕・灯具の箱・光る下面・足もとの明かり
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, STREETLIGHT_H, 8).translate(0, STREETLIGHT_H / 2, 0);
  const armGeo = new THREE.CylinderGeometry(0.045, 0.05, STREETLIGHT_ARM, 6)
    .rotateZ(-Math.PI / 2) // 横向き（+x へ伸びる）
    .translate(STREETLIGHT_ARM / 2, 0, 0)
    .rotateZ(STREETLIGHT_TILT); // 先を少し上げる
  const tipX = STREETLIGHT_ARM * Math.cos(STREETLIGHT_TILT), tipY = STREETLIGHT_ARM * Math.sin(STREETLIGHT_TILT);
  const headGeo = new THREE.BoxGeometry(0.75, 0.13, 0.3).translate(tipX + 0.25, tipY - 0.02, 0);
  const lensGeo = new THREE.BoxGeometry(0.6, 0.03, 0.22).translate(tipX + 0.25, tipY - 0.1, 0);
  const poolGeo = new THREE.CircleGeometry(5.5, 24).rotateX(-Math.PI / 2).translate(tipX + 0.25, 0, 0); // 灯具の真下
  const metal = mat(0x5a606b);
  const pole = new THREE.InstancedMesh(poleGeo, metal, n);
  const arm = new THREE.InstancedMesh(armGeo, metal, n);
  const head = new THREE.InstancedMesh(headGeo, mat(0x2a2e35), n);
  const lens = new THREE.InstancedMesh(lensGeo, LAMP_MAT, n); // 時間帯で明るさが変わる（setAtmosphere）
  const pool = new THREE.InstancedMesh(poolGeo, POOL_MAT, n);
  const m = new THREE.Matrix4(), rot = new THREE.Matrix4();
  spots.forEach(([x, z, h, angle], i) => {
    // ローカルの +x を道路の側へ向ける
    const base = new THREE.Matrix4().makeTranslation(x, h, z).multiply(rot.makeRotationY(angle));
    pole.setMatrixAt(i, base);
    arm.setMatrixAt(i, m.copy(base).multiply(rot.makeTranslation(0, STREETLIGHT_H - 0.15, 0)));
    head.setMatrixAt(i, m.copy(base).multiply(rot.makeTranslation(0, STREETLIGHT_H - 0.15, 0)));
    lens.setMatrixAt(i, m.copy(base).multiply(rot.makeTranslation(0, STREETLIGHT_H - 0.15, 0)));
    pool.setMatrixAt(i, m.copy(base).multiply(rot.makeTranslation(0, Y.signal - 0.01, 0)));
  });
  for (const part of [pole, arm, head]) part.castShadow = true;
  group.add(pole, arm, head, lens, pool);
}

// 道路 r の線分のうち、地点 (x, z) にいちばん近いもの（segHeight に渡す形）
function nearestSeg(map, r, x, z) {
  let best = null, bestD = Infinity;
  for (let i = 0; i + 3 < r.p.length; i += 2) {
    const s = { x1: r.p[i], y1: r.p[i + 1], x2: r.p[i + 2], y2: r.p[i + 3], road: r, v: i / 2 };
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.y1) * dy) / len2));
    const d = Math.hypot(x - (s.x1 + t * dx), z - (s.y1 + t * dy));
    if (d < bestD) (bestD = d), (best = s);
  }
  return best;
}

// 区間の立体を作る。区間を選んだときに画面が止まらないよう、少しずつ作る（ジェネレーター）。
// yield する値は進み具合（0〜1）、最後に立体（THREE.Group）を返す。textures：窓のテクスチャ（windowTextures）
const BUILDINGS_PER_STEP = 150; // 1 回に作る建物の数
const ROADS_PER_STEP = 120; // 1 回に作る道路の数
const TILES_PER_STEP = 4; // 1 回に仕上げる建物のまとまりの数
function* buildWorldSteps(map, textures) {
  const group = new THREE.Group();
  const { minX, minY, maxX, maxY } = map.bounds;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 2000, maxY - minY + 2000), mat(GROUND));
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
  group.add(ground);

  // 公園・水域（種類ごとに 1 つにまとめる）
  const areaBuilders = {};
  for (let ai = 0; ai < map.areas.length; ai++) {
    const a = map.areas[ai];
    if (ai > 0 && ai % 20 === 0) yield (0.05 * ai) / map.areas.length;
    const b = (areaBuilders[a.k] ??= new GeometryBuilder());
    for (const r of a.r) addPolygon(b, r, a.k === 'water' ? Y.water : Y.area);
  }
  for (const [k, b] of Object.entries(areaBuilders)) {
    const m = new THREE.Mesh(b.build(), mat(hex(AREA_COLORS[k] ?? AREA_COLORS.grass)));
    m.receiveShadow = true;
    group.add(m);
  }

  yield 0.05;
  // 川と線路（トンネルは描かない）。高い所を走る線路（e: 1）は、柱の上の高架橋として持ち上げる
  const lineBuilders = {};
  const deck = new GeometryBuilder();
  const pillars = [];
  for (let li = 0; li < map.lines.length; li++) {
    const l = map.lines[li];
    if (li > 0 && li % 150 === 0) yield 0.05 + (0.05 * li) / map.lines.length;
    if (l.u) continue;
    const b = (lineBuilders[l.k] ??= new GeometryBuilder());
    if (l.e && l.k !== 'river') {
      addRibbon(b, l.p, l.w, ELEVATED_H + 0.05);
      addDeck(deck, l.p, l.w + DECK_EXTRA, ELEVATED_H);
      pillars.push(...pillarSpots(l.p));
    } else {
      addRibbon(b, l.p, l.w, l.k === 'river' ? Y.river : Y.rail);
    }
  }
  for (const [k, b] of Object.entries(lineBuilders)) group.add(new THREE.Mesh(b.build(), mat(hex((LINE_STYLES[k] ?? LINE_STYLES.rail).color))));
  const deckMesh = new THREE.Mesh(deck.build(), mat(DECK_COLOR));
  deckMesh.castShadow = deckMesh.receiveShadow = true;
  group.add(deckMesh);
  if (pillars.length) {
    const pillar = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, ELEVATED_H - DECK_T, 1.1), mat(DECK_COLOR), pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach(([x, z], i) => pillar.setMatrixAt(i, m.makeTranslation(x, (ELEVATED_H - DECK_T) / 2, z)));
    pillar.castShadow = true;
    group.add(pillar);
  }

  yield 0.1;
  // 道路（歩道・車道）と一方通行の矢印
  const roadHeights = computeRoadHeights(map); // 道路の高さ（建物の高さとは別）
  // 道路も TILE m 四方ごとに分ける（初めて描くときに GPU へ送る量を分け、画面の外の区画は描かない）
  const roadTiles = new Map(); // 区画 → { paths, roads }
  const arrows = new GeometryBuilder(), roadDeck = new GeometryBuilder();
  const roadPillars = [];
  for (let ri = 0; ri < map.roads.length; ri++) {
    const r = map.roads[ri];
    if (ri > 0 && ri % ROADS_PER_STEP === 0) yield 0.1 + (0.15 * ri) / map.roads.length;
    let cx = 0, cz = 0;
    for (let k = 0; k < r.p.length; k += 2) (cx += r.p[k]), (cz += r.p[k + 1]);
    const tileKey = `${Math.floor(cx / (r.p.length / 2) / TILE)},${Math.floor(cz / (r.p.length / 2) / TILE)}`;
    if (!roadTiles.has(tileKey)) roadTiles.set(tileKey, { paths: new GeometryBuilder(), roads: new GeometryBuilder() });
    const b = r.path ? roadTiles.get(tileKey).paths : roadTiles.get(tileKey).roads;
    const lift = r.path ? Y.path : Y.road;
    const hs = roadHeights.get(r);
    if (!hs) {
      addRibbon(b, r.p, r.w, lift);
      continue;
    }
    // 橋・高架：坂のついた上面、側面と裏、高い所には柱
    addRibbonH(b, r.p, r.w, hs, lift);
    addRoadDeckSides(roadDeck, r.p, r.w, hs);
    for (const [x, z, v, t] of pillarSpots(r.p, ROAD_PILLAR_SPACING)) {
      const h = roadHeightAt(roadHeights, r, v, t);
      if (h > 2.5) roadPillars.push([x, z, h - ROAD_DECK_T]);
    }
  }
  const roadDeckMesh = new THREE.Mesh(roadDeck.build(), mat(DECK_COLOR));
  roadDeckMesh.castShadow = roadDeckMesh.receiveShadow = true;
  group.add(roadDeckMesh);
  if (roadPillars.length) {
    const pillar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1, 0.9), mat(DECK_COLOR), roadPillars.length);
    const m = new THREE.Matrix4();
    roadPillars.forEach(([x, z, h], i) => pillar.setMatrixAt(i, m.makeTranslation(x, h / 2, z).multiply(new THREE.Matrix4().makeScale(1, h, 1))));
    pillar.castShadow = true;
    group.add(pillar);
  }
  for (const r of map.roads) {
    for (const [x, z, angle] of r.arrows) {
      // 2D版と同じ矢じりの形（長さ約 3.6m）。angle は北が 0、時計回り
      const s = Math.sin(angle), c = Math.cos(angle);
      const ay = Y.arrow + (roadHeights.has(r) ? groundHeight(roadHeights, [nearestSeg(map, r, x, z)], x, z, null) : 0);
      const at = (u, v) => [x + u * c - v * s, ay, z + u * s + v * c];
      arrows.tri(at(0, -2.2), at(-1.6, 1.4), at(0, 0.6), UP);
      arrows.tri(at(0, -2.2), at(0, 0.6), at(1.6, 1.4), UP);
    }
  }
  yield 0.26;
  const pathMat = mat(PATH), roadMat = mat(ROAD);
  let rt = 0;
  for (const t of roadTiles.values()) {
    if (++rt % 8 === 0) yield 0.26 + (0.04 * rt) / roadTiles.size;
    for (const [b, material] of [[t.paths, pathMat], [t.roads, roadMat]]) {
      if (!b.pos.length) continue; // その区画にない種類の道
      const m = new THREE.Mesh(b.build(), material);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  group.add(new THREE.Mesh(arrows.build(), mat(ARROW, { side: THREE.DoubleSide })));

  yield 0.3;
  // 建物（高い建物ほど少し明るく）。TILE ごとに 1 つの立体にまとめる
  const tileBuilders = new Map();
  const heights = []; // 建物ごとの高さ m（高さが分からない建物は推定した値）
  const tileOf = []; // 建物ごとのまとまりの名前
  for (let i = 0; i < map.buildings.length; i++) {
    const bd = map.buildings[i];
    if (i > 0 && i % BUILDINGS_PER_STEP === 0) yield 0.3 + (0.6 * i) / map.buildings.length;
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
  }
  yield 0.9;
  const tiles = new Map();
  let ti = 0;
  for (const [key, b] of tileBuilders) {
    if (++ti % TILES_PER_STEP === 0) yield 0.9 + (0.08 * ti) / tileBuilders.size;
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      map: textures.color,
      emissiveMap: textures.glow,
      emissive: 0xffffff,
      emissiveIntensity: windowGlow,
    });
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.opacity = 1;
    tiles.set(key, mesh);
    group.add(mesh);
  }
  group.userData = { tiles, heights, tileOf, roadHeights };

  addStreetLights(group, map, roadHeights);

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

// 一度に作る（テスト用）
function buildWorld(map, textures) {
  const steps = buildWorldSteps(map, textures);
  let r;
  while (!(r = steps.next()).done);
  return r.value;
}

// ---- 自転車 ----
// ひし形のフレーム・フォーク・スポークの車輪・サドル・ハンドル・クランクとペダルの自転車と、乗っている人
// （前かがみの胴体・ヘルメット・ハンドルを握る腕・ペダルに足を乗せてひざを曲げ伸ばしする脚）。
// 車輪とクランクは進んだ距離で回り、曲がるときは車体ごと傾く（animateBike）。前は -z
const WHEEL_R = 0.34;
const BIKE = {
  rearAxle: [0, WHEEL_R, 0.52],
  frontAxle: [0, WHEEL_R, -0.53],
  bb: [0, 0.3, 0.06], // ペダルの軸（ボトムブラケット）
  seat: [0, 0.86, 0.2], // シートチューブの上
  headTop: [0, 0.9, -0.38],
  headBottom: [0, 0.74, -0.42],
  saddle: [0, 0.97, 0.24],
  bar: [0, 1.02, -0.36],
  crank: 0.17, // クランクの長さ m
  hip: [0, 1.03, 0.21],
  shoulder: [0, 1.43, -0.12],
  thigh: 0.46, // 太もも m
  shin: 0.46, // すね m
  gear: 0.5, // クランクは車輪の何倍の速さで回るか（ギアの比を見た目に合わせて）
};
const UNIT_TUBE = new THREE.CylinderGeometry(1, 1, 1, 8); // 高さ 1・半径 1（tube で伸ばして使う）
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tubeTmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3() };

// a から b までの太さ r の管（腕や脚は毎回置き直す）
function placeTube(mesh, a, b, r) {
  const { a: va, b: vb, d } = tubeTmp;
  va.set(...a);
  vb.set(...b);
  d.subVectors(vb, va);
  const len = d.length() || 1e-6;
  mesh.position.addVectors(va, vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, d.divideScalar(len));
  mesh.scale.set(r, len, r);
}

function makeBike(colors = {}, opacity = 1) {
  const c = { frame: 0xffcc33, jersey: 0xffcc33, shorts: 0x22324f, helmet: 0xe8443a, skin: 0xf2d0a9, tire: 0x1b1d22, metal: 0x9aa0aa, saddle: 0x15171b, ...colors };
  const transparent = opacity < 1;
  const o = { transparent, opacity, depthWrite: !transparent };
  const m = (color) => mat(color, o);
  const bike = new THREE.Group();
  bike.rotation.order = 'YXZ'; // 向き（y）のあとに傾き（z）
  const body = new THREE.Group(); // 傾く部分
  bike.add(body);
  const tube = (a, b, r, material) => {
    const mesh = new THREE.Mesh(UNIT_TUBE, material);
    placeTube(mesh, a, b, r);
    body.add(mesh);
    return mesh;
  };
  const B = BIKE;
  const frameMat = m(c.frame), metalMat = m(c.metal);
  // フレーム：トップ・ダウン・シートの各チューブ、後ろの三角（チェーンステー・シートステー）、ヘッドチューブとフォーク
  tube(B.seat, B.headTop, 0.022, frameMat);
  tube(B.bb, B.headBottom, 0.026, frameMat);
  tube(B.bb, B.seat, 0.024, frameMat);
  for (const x of [-0.06, 0.06]) {
    tube([x, B.bb[1], B.bb[2]], [x, B.rearAxle[1], B.rearAxle[2]], 0.014, frameMat);
    tube([x * 0.5, B.seat[1] - 0.04, B.seat[2]], [x, B.rearAxle[1], B.rearAxle[2]], 0.012, frameMat);
    tube([x * 0.6, B.headBottom[1], B.headBottom[2]], [x, B.frontAxle[1], B.frontAxle[2]], 0.014, metalMat);
  }
  tube(B.headBottom, B.headTop, 0.03, frameMat);
  // ハンドル（ステム・横のバー・握り）とサドル
  tube(B.headTop, B.bar, 0.018, metalMat);
  tube([-0.26, B.bar[1], B.bar[2]], [0.26, B.bar[1], B.bar[2]], 0.016, metalMat);
  for (const x of [-0.26, 0.26]) tube([x * 0.82, B.bar[1], B.bar[2]], [x, B.bar[1], B.bar[2]], 0.022, m(c.saddle));
  tube(B.seat, B.saddle, 0.014, metalMat);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.26), m(c.saddle));
  saddle.position.set(...B.saddle);
  body.add(saddle);
  // 車輪：タイヤ・リム・スポーク（回る）
  const tireGeo = new THREE.TorusGeometry(WHEEL_R - 0.02, 0.025, 6, 24);
  tireGeo.rotateY(Math.PI / 2);
  const wheels = [B.rearAxle, B.frontAxle].map((axle) => {
    const w = new THREE.Group();
    w.position.set(...axle);
    w.add(new THREE.Mesh(tireGeo, m(c.tire)));
    for (let k = 0; k < 6; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.008, (WHEEL_R - 0.03) * 2, 0.008), metalMat);
      spoke.rotation.x = (k * Math.PI) / 6;
      w.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), metalMat);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    body.add(w);
    return w;
  });
  // クランクとペダル（回る）
  const crank = new THREE.Group();
  crank.position.set(...B.bb);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 16), metalMat);
  ring.rotation.z = Math.PI / 2;
  ring.position.x = 0.05;
  crank.add(ring);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, B.crank, 0.03), metalMat);
    arm.position.set(side * 0.08, (side * B.crank) / 2, 0);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.07), m(c.saddle));
    pedal.position.set(side * 0.12, side * B.crank, 0);
    crank.add(arm, pedal);
  }
  body.add(crank);
  // 乗っている人：胴体（腰から肩へ）・頭とヘルメット・腕（肩からハンドルへ）・脚（腰からひざ、ひざからペダルへ）
  const jersey = m(c.jersey), skin = m(c.skin), shorts = m(c.shorts);
  tube(B.hip, B.shoulder, 0.15, jersey);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), skin);
  head.position.set(0, B.shoulder[1] + 0.2, B.shoulder[2] - 0.1);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m(c.helmet));
  helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0.01));
  helmet.scale.set(1, 0.95, 1.2);
  body.add(head, helmet);
  for (const x of [-0.17, 0.17]) {
    const shoulder = [x, B.shoulder[1] - 0.02, B.shoulder[2]];
    const elbow = [x * 1.25, B.shoulder[1] - 0.2, B.shoulder[2] - 0.14];
    const grip = [Math.sign(x) * 0.24, B.bar[1] + 0.02, B.bar[2]];
    tube(shoulder, elbow, 0.038, jersey);
    tube(elbow, grip, 0.032, skin);
  }
  const legs = [-1, 1].map((side) => ({
    side,
    thigh: tube([0, 0, 0], [0, -1, 0], 0.06, shorts),
    shin: tube([0, 0, 0], [0, -1, 0], 0.045, skin),
  }));
  bike.userData = { body, wheels, crank, legs, phase: 0, lean: 0, prevAngle: null };
  return bike;
}

// 腰 hip からペダル foot まで、太もも・すねの 2 本で届くひざの位置（横から見た y-z の面で、ひざは前に出る）
function kneeOf(hip, foot) {
  const dy = foot[1] - hip[1], dz = foot[2] - hip[2];
  const d = Math.min(BIKE.thigh + BIKE.shin - 1e-3, Math.hypot(dy, dz));
  const base = Math.atan2(dz, dy); // 腰から足への向き
  const bend = Math.acos((BIKE.thigh ** 2 + d * d - BIKE.shin ** 2) / (2 * BIKE.thigh * d));
  const a = base + bend; // ひざは前（-z）側に曲がる
  return [foot[0], hip[1] + Math.cos(a) * BIKE.thigh, hip[2] + Math.sin(a) * BIKE.thigh];
}

// 自転車を pose（x, y, angle）に置き、速さ speed（m/s）に合わせて車輪とクランクを回して脚を動かし、曲がる速さに合わせて傾ける
function animateBike(bike, pose, speed, dt, h = 0) {
  const s = bike.userData;
  bike.position.set(pose.x, h, pose.y);
  bike.rotation.y = -pose.angle;
  if (s.prevAngle === null || dt <= 0) s.prevAngle = pose.angle;
  const turn = dt > 0 ? Math.atan2(Math.sin(pose.angle - s.prevAngle), Math.cos(pose.angle - s.prevAngle)) / dt : 0;
  s.prevAngle = pose.angle;
  // 傾き：曲がる速さ × 速さ（遠心力の向きと逆、つまり曲がる側に倒す）。急に変わらないよう追いかける
  const target = Math.max(-0.4, Math.min(0.4, -turn * Math.abs(speed) * 0.045));
  s.lean += (target - s.lean) * Math.min(1, 8 * dt);
  s.body.rotation.z = s.lean;
  // 車輪とクランク：進んだ距離だけ回す
  s.phase += (speed * dt) / WHEEL_R;
  for (const w of s.wheels) w.rotation.x = -s.phase;
  const crankAngle = -s.phase * BIKE.gear;
  s.crank.rotation.x = crankAngle;
  // 脚：ペダルの位置に足を置き、ひざを曲げる
  for (const leg of s.legs) {
    const a = crankAngle + (leg.side > 0 ? 0 : Math.PI);
    // クランクの回転（x 軸まわり）と同じ向きに回るペダルの位置
    const foot = [leg.side * 0.13, BIKE.bb[1] + Math.cos(a) * BIKE.crank, BIKE.bb[2] + Math.sin(a) * BIKE.crank];
    const hip = [leg.side * 0.1, BIKE.hip[1], BIKE.hip[2]];
    const knee = kneeOf(hip, foot);
    knee[0] = leg.side * 0.12;
    placeTube(leg.thigh, hip, knee, 0.06);
    placeTube(leg.shin, knee, foot, 0.045);
  }
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
  car.traverse((m) => {
    if (!m.material) return;
    m.material.transparent = true;
    m.castShadow = true;
  });
  return car;
}

// ---- 歩行者 ----
// 頭・髪・胴体・腕・脚の人の形。歩行者は最大 45 人いるので、部品ごとに全員分を 1 つの InstancedMesh にまとめて描く
// （1 人ずつ別の立体にすると描く回数が数百回増えて重い）。服などの色は部品ごとの色（setColorAt）で変える
const MAX_PEDS = 64;
const PED = {
  hip: 0.84, // 腰の高さ m（背の高さ 1.0 のとき）
  shoulder: 1.4,
  legSwing: 0.5, // 足の振り rad
  armSwing: 0.45,
};
function makeCrowd() {
  const part = (geo, n = MAX_PEDS) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    m.castShadow = true;
    m.frustumCulled = false; // 歩行者は街じゅうに散らばるので、まとめて描く
    m.count = 0;
    return m;
  };
  const leg = new THREE.BoxGeometry(0.14, 0.82, 0.16);
  leg.translate(0, -0.41, 0); // 腰を軸に振る
  const arm = new THREE.BoxGeometry(0.09, 0.56, 0.11);
  arm.translate(0, -0.28, 0); // 肩を軸に振る
  const hair = new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const canopy = new THREE.ConeGeometry(0.62, 0.3, 10, 1, true);
  const crowd = {
    head: part(new THREE.SphereGeometry(0.115, 10, 8)),
    hair: part(hair),
    torso: part(new THREE.BoxGeometry(0.4, 0.6, 0.23)),
    legL: part(leg),
    legR: part(leg),
    armL: part(arm),
    armR: part(arm),
    canopy: part(canopy),
    stick: part(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5)),
  };
  crowd.canopy.material.side = THREE.DoubleSide;
  return crowd;
}

// ---- 車 ----
// 車体・窓の部分（前後が斜め）・屋根・タイヤ・バンパーを 1 つの立体に、ライト（光って見える）をもう 1 つにまとめる。
// 車種と色が同じ車は同じ形を使い回す
const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
// 8 つの角（下の 4 つ・上の 4 つ。同じ順で回る）の六面体
function addHexa(b, corners, color) {
  const [b0, b1, b2, b3, t0, t1, t2, t3] = corners;
  const center = corners.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
  const quad = (p0, p1, p2, p3) => {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    const fc = [(p0[0] + p2[0]) / 2 - center[0], (p0[1] + p2[1]) / 2 - center[1], (p0[2] + p2[2]) / 2 - center[2]];
    if (n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0) n = n.map((x) => -x); // 外向きに
    b.tri(p0, p1, p2, n, color);
    b.tri(p0, p2, p3, n, color);
  };
  quad(b0, b1, b2, b3); // 底
  quad(t0, t1, t2, t3); // 上
  quad(b0, b1, t1, t0);
  quad(b1, b2, t2, t1);
  quad(b2, b3, t3, t2);
  quad(b3, b0, t0, t3);
}
// 箱（x：左右、y：高さ、z：前後）
function addBox(b, x0, x1, y0, y1, z0, z1, color) {
  addHexa(b, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color);
}
// 横向きの円柱（タイヤ）
function addWheel(b, x, y, z, r, w, color, sides = 10) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p = (a, dx) => [x + dx, y + Math.sin(a) * r, z + Math.cos(a) * r];
    const n = [0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)];
    b.tri(p(a0, -w / 2), p(a1, -w / 2), p(a1, w / 2), n, color);
    b.tri(p(a0, -w / 2), p(a1, w / 2), p(a0, w / 2), n, color);
    b.tri([x - w / 2, y, z], p(a1, -w / 2), p(a0, -w / 2), [-1, 0, 0], color);
    b.tri([x + w / 2, y, z], p(a0, w / 2), p(a1, w / 2), [1, 0, 0], color);
  }
}

const carGeometries = new Map(); // 車種と色 → { body, lights }
function carGeometry(look) {
  const key = `${look.type}:${look.color}`;
  let g = carGeometries.get(key);
  if (g) return g;
  const body = new GeometryBuilder(true), lights = new GeometryBuilder(true);
  const hl = look.L / 2, hw = look.W / 2;
  const paint = rgb(look.color), glass = rgb('#1c222b'), dark = rgb('#25282e'), tire = rgb('#141518');
  const [y0, y1] = look.body, [c0, c1] = look.cabin;
  // 下の車体（前後の端は少し低く削る）
  addHexa(body, [[-hw, y0, -hl], [hw, y0, -hl], [hw, y0, hl], [-hw, y0, hl], [-hw, y1 - 0.1, -hl], [hw, y1 - 0.1, -hl], [hw, y1, hl - 0.2], [-hw, y1, hl - 0.2]], paint);
  addBox(body, -hw + 0.02, hw - 0.02, y1 - 0.1, y1, -hl + 0.25, hl - 0.2, paint);
  // 窓の部分（前後が斜めのガラス）と屋根
  const [fb, bb] = look.cabinBottom, [ft, bt] = look.cabinTop;
  const bw = hw * 0.94, tw = hw * 0.84;
  addHexa(body, [[-bw, c0, fb], [bw, c0, fb], [bw, c0, bb], [-bw, c0, bb], [-tw, c1 - 0.06, ft], [tw, c1 - 0.06, ft], [tw, c1 - 0.06, bt], [-tw, c1 - 0.06, bt]], glass);
  addBox(body, -tw - 0.02, tw + 0.02, c1 - 0.08, c1, ft - 0.03, bt + 0.03, paint);
  // 窓のあいだの柱（前・真ん中・後ろ）
  const pillar = (z0, z1) => {
    addBox(body, -bw - 0.01, -bw + 0.07, c0, c1 - 0.06, z0, z1, paint);
    addBox(body, bw - 0.07, bw + 0.01, c0, c1 - 0.06, z0, z1, paint);
  };
  pillar((fb + ft) / 2 - 0.06, (fb + ft) / 2 + 0.06);
  pillar((ft + bt) / 2 - 0.07, (ft + bt) / 2 + 0.07);
  pillar((bb + bt) / 2 - 0.06, (bb + bt) / 2 + 0.06);
  // バンパー（前後）
  addBox(body, -hw + 0.05, hw - 0.05, y0, y0 + 0.22, -hl - 0.06, -hl + 0.1, dark);
  addBox(body, -hw + 0.05, hw - 0.05, y0, y0 + 0.22, hl - 0.1, hl + 0.06, dark);
  // タイヤ
  const wr = 0.32, wz = hl - 0.75;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addWheel(body, sx * (hw - 0.08), wr, sz * wz, wr, 0.24, tire);
  // ライト：前は白、後ろは赤。タクシーは屋根の行灯
  const lightY = y1 - 0.28;
  for (const sx of [-1, 1]) {
    addBox(lights, sx * (hw - 0.42) - 0.17, sx * (hw - 0.42) + 0.17, lightY, lightY + 0.14, -hl - 0.04, -hl + 0.02, rgb('#fff4d0'));
    addBox(lights, sx * (hw - 0.36) - 0.16, sx * (hw - 0.36) + 0.16, lightY + 0.04, lightY + 0.16, hl - 0.02, hl + 0.04, rgb('#ff3b3b'));
  }
  if (look.sign) addBox(lights, -0.26, 0.26, c1, c1 + 0.2, (ft + bt) / 2 - 0.12, (ft + bt) / 2 + 0.12, rgb('#ffd34d'));
  g = { body: body.build(), lights: lights.build() };
  carGeometries.set(key, g);
  return g;
}
const CAR_BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const CAR_LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // ライトは光って見える（明るさが光の当たり方によらない）

function makeCar(a) {
  const g = carGeometry(carLook(a));
  const car = new THREE.Group();
  const body = new THREE.Mesh(g.body, CAR_BODY_MAT);
  body.castShadow = body.receiveShadow = true;
  car.add(body, new THREE.Mesh(g.lights, CAR_LIGHT_MAT));
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
  const hemi = new THREE.HemisphereLight(0x9aa6d8, 0x2a2228, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb07a, 1.5);
  sun.position.set(-1, 0.35, 0.25);
  scene.add(sun, sun.target);
  // 影：夕日なので長く伸びる。重いので、タッチ操作の端末（スマホ・タブレット）では今は付けない
  const shadows = !window.matchMedia('(pointer: coarse)').matches;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_RANGE;
    sc.right = SHADOW_RANGE;
    sc.top = SHADOW_RANGE;
    sc.bottom = -SHADOW_RANGE;
    sc.near = 1;
    sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
  }
  const SUN_DIR = new THREE.Vector3(-1, 0.35, 0.25).normalize(); // 時間帯で変わる（setAtmosphere）
  const sky = makeSky();
  scene.add(sky);
  const textures = windowTextures(renderer.capabilities.getMaxAnisotropy());
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, FOG_FAR + 50);

  let world = null; // 今の区間の動かない物
  let worldMap = null;
  const player = makeBike();
  // ゴースト：同じ形の半透明の白
  const ghost = makeBike({ frame: 0xe8ecf4, jersey: 0xe8ecf4, shorts: 0xc9ced8, helmet: 0xffffff, skin: 0xe8ecf4, tire: 0x9aa0aa, metal: 0xd0d4dc, saddle: 0xb0b5bf }, 0.45);
  player.traverse((m) => m.isMesh && (m.castShadow = true));
  scene.add(player, ghost);
  let ghostPrev = null; // ゴーストの速さを求めるための前回の位置
  let bikeH = 0, ghostH = 0; // 自転車・ゴーストの高さ m（橋の上で上がる）
  const train = [];
  const trainGroup = new THREE.Group();
  scene.add(trainGroup);
  const agentMeshes = new Map(); // 車 → 立体（使い回す）。歩行者は crowd で描く
  const crowd = makeCrowd();
  let currentWeather = 'clear';
  const agentGroup = new THREE.Group();
  scene.add(agentGroup);
  for (const m of Object.values(crowd)) scene.add(m);
  // 信号機：区間の信号ぜんぶを、部品（地面の円・柱・腕・箱・3 つの灯）ごとに 1 つの InstancedMesh にまとめる
  // （1 区間に 100〜200 個あり、1 個ずつ別の立体にすると描く回数が数百回増える）
  let signalMeshes = []; // [{ group }]（並びは InstancedMesh の番号と同じ）
  const signalGroup = new THREE.Group();
  scene.add(signalGroup);
  const signalParts = {}; // 部品の名前 → InstancedMesh
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

  // 今の区間の道路の高さ（作っている途中なら空。みな地面の高さになる）
  const NO_HEIGHTS = new Map();
  const roadH = () => world?.userData.roadHeights ?? NO_HEIGHTS;

  // ---- 区間の立体の準備 ----
  // 区間の立体は少しずつ作り（build）、できたら少しずつ見せる（reveal。初めて描くときに GPU へ送るのが重いので、
  // 何回かに分けて送る）。作った立体は最近の WORLD_CACHE 区間ぶん覚えておき、次の区間は結果画面のうちに作っておく
  const WORLD_CACHE = 3;
  const BUILD_BUDGET_MS = 10; // 1 回の描画で作るのに使う時間（今の区間）
  const BACKGROUND_BUDGET_MS = 6; // 先に作っておく区間に使う時間（レース中は使わない）
  const REVEAL_PER_FRAME = 6; // 1 回の描画で見せる（GPU へ送る）部品の数
  const worlds = new Map(); // 地図 → { steps, group, progress, revealed, used }

  function worldFor(map) {
    let w = worlds.get(map);
    if (!w) {
      w = { steps: buildWorldSteps(map, textures), group: null, progress: 0, revealed: 0, used: 0 };
      worlds.set(map, w);
      // 古いものから捨てる（今の区間は捨てない）
      while (worlds.size > WORLD_CACHE) {
        const [oldMap, old] = [...worlds.entries()].filter(([m]) => m !== map && m !== worldMap).sort((a, b) => a[1].used - b[1].used)[0] ?? [];
        if (!oldMap) break;
        worlds.delete(oldMap);
        old.group?.traverse((m) => {
          m.geometry?.dispose();
          m.material?.dispose();
        });
      }
    }
    w.used = performance.now();
    return w;
  }

  // 決めた時間だけ作り進める
  function build(w, budgetMs) {
    const t0 = performance.now();
    while (!w.group && performance.now() - t0 < budgetMs) {
      const r = w.steps.next();
      if (r.done) {
        w.group = r.value;
        w.group.children.forEach((m) => (m.visible = false)); // reveal で少しずつ見せる
      } else {
        w.progress = r.value * 0.85;
      }
    }
  }

  // 準備ができていなければ 0〜1 の進み具合、できていれば null
  function progressOf(map) {
    const w = worlds.get(map);
    if (!w) return 0;
    if (!w.group) return w.progress;
    const n = w.group.children.length;
    return w.revealed >= n ? null : 0.85 + (0.15 * w.revealed) / n;
  }

  // 今の区間を切り替える（できていれば、すぐに見せる）
  function setMap(map) {
    if (world) scene.remove(world);
    const w = worldFor(map);
    world = w.group; // まだ作っている途中なら null
    worldMap = map;
    if (world) scene.add(world);
    signalMeshes.obs = null; // 信号は新しい区間の高さで置き直す
    camAngle = null;
    cam.back = null;
  }

  // GPU へ送る：区画は画面に映ったときに初めて GPU へ送られる（そのときに引っかかる）。
  // そこで準備のうちに、少しずつ全部を一度描いて送っておく。
  //   今の区間：画面の外の区画も、その回だけ描かせる（frustumCulled を外す）
  //   先に作っておく区間：見えない 1 × 1 の描画先に描く
  const warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const warmScene = new THREE.Scene();
  let unculled = []; // 今回だけ画面の外でも描く区画（描いたら元に戻す）

  function reveal(w, count, current) {
    const kids = w.group.children;
    const from = w.revealed;
    const to = Math.min(kids.length, from + count);
    if (current) {
      for (let k = from; k < to; k++) {
        kids[k].visible = true;
        kids[k].frustumCulled = false;
        unculled.push(kids[k]);
      }
    } else {
      // この回の分だけを見えない描画先に描く
      kids.forEach((m, k) => (m.visible = k >= from && k < to));
      kids.forEach((m, k) => k >= from && k < to && (m.frustumCulled = false));
      warmScene.add(w.group);
      renderer.setRenderTarget(warmTarget);
      renderer.render(warmScene, camera);
      renderer.setRenderTarget(null);
      warmScene.remove(w.group);
      kids.forEach((m, k) => {
        m.frustumCulled = true;
        m.visible = k < to;
      });
    }
    w.revealed = to;
  }

  // 毎回の描画で：今の区間を作り進め、できたら少しずつ見せる。手が空いていれば先の区間も作る
  function advanceWorlds(game) {
    const w = worldFor(worldMap);
    if (!w.group) {
      build(w, BUILD_BUDGET_MS);
      if (w.group) {
        world = w.group;
        scene.add(world);
        signalMeshes.obs = null;
      }
    }
    if (w.group && w.revealed < w.group.children.length) reveal(w, REVEAL_PER_FRAME, true);
    // 手が空いていれば（今の区間ができていて、レース中でなければ）先の区間を作り、GPU へ送っておく
    if (progressOf(worldMap) === null && game.state !== 'racing' && game.state !== 'countdown') {
      const next = [...worlds.values()].find((o) => o !== w && (!o.group || o.revealed < o.group.children.length));
      if (next && !next.group) build(next, BACKGROUND_BUDGET_MS);
      else if (next) reveal(next, REVEAL_PER_FRAME, false);
    }
  }

  // 信号：交差点の地面の円（2D版の丸と同じ範囲）と、柱の上の灯り
  // 信号機の形：道の左端に柱、道の上へ腕、その先に道を横切る向きの横長の箱と 3 つの灯（左から青・黄・赤）。
  // 灯は箱を前後に突き抜ける短い円柱なので、どちらから来ても見える。高さは m
  const SIG = { poleH: 5.6, armY: 5.45, boxY: 5.05, lampGap: 0.5 };
  const sigGeo = {
    pad: new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2),
    pole: new THREE.CylinderGeometry(0.09, 0.12, SIG.poleH, 8).translate(0, SIG.poleH / 2, 0),
    arm: new THREE.BoxGeometry(1, 0.12, 0.12), // 長さは道幅に合わせて伸ばす
    box: new THREE.BoxGeometry(1.65, 0.52, 0.36),
    lamp: new THREE.CylinderGeometry(0.17, 0.17, 0.42, 14).rotateX(Math.PI / 2),
  };
  const sigMat = {
    pad: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
    pole: new THREE.MeshLambertMaterial({ color: 0x7a808b }),
    box: new THREE.MeshLambertMaterial({ color: 0x23262c }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }), // 光って見える（色は 1 個ずつ）
  };
  const sigTmp = { base: new THREE.Matrix4(), local: new THREE.Matrix4(), out: new THREE.Matrix4(), color: new THREE.Color() };

  function syncSignals(obs) {
    if (signalMeshes.obs === obs || !world) return;
    for (const m of Object.values(signalParts)) {
      signalGroup.remove(m);
      m.dispose();
    }
    signalMeshes = [];
    signalMeshes.obs = obs;
    const places = [];
    for (const g of obs.signals) {
      for (const [x, z] of g.nodes) {
        // 橋や坂の上の交差点なら、その高さに置く（重なる道路のうち一番高いもの）
        const segs = surfaceAt(worldMap, x, z).segs ?? [];
        const h = Math.max(0, ...segs.map((sg) => segHeight(roadH(), sg, x, z)));
        places.push({ group: g, x, z, h, pose: signalPose(worldMap, x, z) });
      }
    }
    const n = places.length;
    const make = (name, geo, material, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, material, Math.max(1, n));
      m.count = n;
      m.castShadow = shadow;
      signalParts[name] = m;
      signalGroup.add(m);
      return m;
    };
    const pad = make('pad', sigGeo.pad, sigMat.pad);
    const pole = make('pole', sigGeo.pole, sigMat.pole, true);
    const arm = make('arm', sigGeo.arm, sigMat.pole, true);
    const box = make('box', sigGeo.box, sigMat.box, true);
    const lamps = LAMPS.map((l, i) => make(`lamp${i}`, sigGeo.lamp, sigMat.lamp));
    const { base, local, out } = sigTmp;
    places.forEach((p, i) => {
      // 向き：道の向き。腕と箱は道を横切る向き（ローカルの x）、柱は道の左端（ローカルの -x）
      base.makeTranslation(p.x, p.h, p.z).multiply(local.makeRotationY(-p.pose.angle));
      const reach = p.pose.hw + 0.6;
      const put = (mesh, x, y, z, sx = 1) => {
        local.makeTranslation(x, y, z);
        if (sx !== 1) local.multiply(out.makeScale(sx, 1, 1));
        mesh.setMatrixAt(i, out.multiplyMatrices(base, local));
      };
      put(pad, 0, Y.signal + (p.h > 0 ? 0.35 : 0), 0); // 坂の上では少し浮かせる（平らな円が坂に埋もれないように）
      put(pole, -reach, 0, 0);
      put(arm, -reach / 2, SIG.armY, 0, reach);
      put(box, 0, SIG.boxY, 0);
      lamps.forEach((lamp, k) => put(lamp, (k - 1) * SIG.lampGap, SIG.boxY, 0));
      signalMeshes.push({ group: p.group });
    });
    for (const m of Object.values(signalParts)) m.instanceMatrix.needsUpdate = true;
  }

  // 信号の色：点いている灯だけ明るく、地面の円は今の色
  function updateSignalColors(obs) {
    const { color } = sigTmp;
    const states = new Map();
    signalMeshes.forEach((s, i) => {
      let st = states.get(s.group);
      if (!st) states.set(s.group, (st = signalState(s.group, obs.clock)));
      signalParts.pad.setColorAt(i, color.setHex(SIGNAL_COLORS[st]));
      LAMPS.forEach((l, k) => signalParts[`lamp${k}`].setColorAt(i, color.set(l.state === st ? l.on : l.off)));
    });
    for (const m of Object.values(signalParts)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  function syncAgents(obs) {
    const alive = new Set(obs.agents);
    for (const [a, m] of agentMeshes) {
      if (!alive.has(a)) {
        agentGroup.remove(m);
        agentMeshes.delete(a);
      }
    }
    const peds = [];
    for (const a of obs.agents) {
      if (a.kind === 'ped') {
        peds.push(a);
        continue;
      }
      let m = agentMeshes.get(a);
      if (!m) {
        m = makeCar(a);
        agentMeshes.set(a, m);
        agentGroup.add(m);
      }
      m.position.set(a.x, agentHeight(a), a.y);
      m.rotation.y = -(a.angle ?? 0);
    }
    drawCrowd(peds);
  }

  // 乗っている道路の高さ（橋の上の車・歩行者）
  function agentHeight(a) {
    const segLen = Math.hypot(a.road.p[2 * (a.v + a.dir)] - a.road.p[2 * a.v], a.road.p[2 * (a.v + a.dir) + 1] - a.road.p[2 * a.v + 1]) || 1;
    const t = Math.max(0, Math.min(1, a.s / segLen));
    const h = a.dir > 0 ? roadHeightAt(roadH(), a.road, a.v, t) : roadHeightAt(roadH(), a.road, a.v - 1, 1 - t);
    return Number.isFinite(h) ? h : 0;
  }

  // 歩行者を部品ごとに置く。腕と足は歩いた距離に合わせて振り、雨の日は傘をさす（右手で持つ）
  const pm = { base: new THREE.Matrix4(), local: new THREE.Matrix4(), out: new THREE.Matrix4(), rot: new THREE.Matrix4() };
  const pc = new THREE.Color();
  function drawCrowd(peds) {
    const n = Math.min(MAX_PEDS, peds.length);
    const rain = currentWeather === 'rain';
    const put = (mesh, i, x, y, z, rotX = 0) => {
      pm.local.makeTranslation(x, y, z);
      if (rotX) pm.local.multiply(pm.rot.makeRotationX(rotX));
      mesh.setMatrixAt(i, pm.out.multiplyMatrices(pm.base, pm.local));
    };
    const color = (mesh, i, hex) => mesh.setColorAt(i, pc.set(hex));
    for (let i = 0; i < n; i++) {
      const a = peds[i];
      const look = pedLook(a);
      const swing = pedSwing(a);
      const s = look.scale;
      pm.base.makeTranslation(a.x, agentHeight(a), a.y);
      pm.base.multiply(pm.rot.makeRotationY(-(a.angle ?? 0)));
      pm.base.multiply(pm.rot.makeScale(s, s, s));
      put(crowd.legL, i, -0.1, PED.hip, 0, swing * PED.legSwing);
      put(crowd.legR, i, 0.1, PED.hip, 0, -swing * PED.legSwing);
      put(crowd.torso, i, 0, PED.hip + 0.3, 0);
      put(crowd.armL, i, -0.25, PED.shoulder, 0, -swing * PED.armSwing);
      // 傘を持つ右手は前に上げる
      put(crowd.armR, i, 0.25, PED.shoulder, 0, rain ? 0.9 : swing * PED.armSwing);
      put(crowd.head, i, 0, 1.56, 0);
      put(crowd.hair, i, 0, 1.585, 0.015);
      color(crowd.legL, i, look.pants);
      color(crowd.legR, i, look.pants);
      color(crowd.torso, i, look.shirt);
      color(crowd.armL, i, look.shirt);
      color(crowd.armR, i, look.shirt);
      color(crowd.head, i, look.skin);
      color(crowd.hair, i, look.hair);
      if (rain) {
        put(crowd.stick, i, 0.22, 1.52, -0.38); // 手から上へ
        put(crowd.canopy, i, 0.12, 2.12, -0.22); // 頭の上
        color(crowd.stick, i, '#3c3f46');
        color(crowd.canopy, i, look.umbrella);
      }
    }
    for (const [key, mesh] of Object.entries(crowd)) {
      mesh.count = key === 'canopy' || key === 'stick' ? (rain ? n : 0) : n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      car.position.set((head.x + tail.x) / 2, (head.h + tail.h) / 2, (head.y + tail.y) / 2);
      car.rotation.order = 'YXZ';
      car.rotation.y = -Math.atan2(head.x - tail.x, -(head.y - tail.y));
      car.rotation.x = Math.atan2(head.h - tail.h, CAR_LEN); // 坂では前を上げ下げする
      const under = head.under || tail.under;
      car.traverse((m) => m.material && (m.material.opacity = under ? 0.25 : 1));
    });
  }

  // カメラから自転車（の頭の高さ）までの線をさえぎる建物のまとまりを透かす
  function fadeOccluders(game, dt) {
    if (!world) return;
    const { tiles, heights, tileOf } = world.userData;
    const p = game.player;
    const ax = camera.position.x, ay = camera.position.y, az = camera.position.z;
    const bx = p.x, by = bikeH + 1.5, bz = p.y;
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
    // 橋の上では自転車と一緒にカメラも上がる
    camera.position.set(p.x - fx * cam.back, bikeH + cam.up, p.y - fz * cam.back);
    camera.lookAt(p.x + lx * cam.ahead, bikeH + (cameraMode === 'first' ? 1.5 : 1), p.y + lz * cam.ahead);
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

    // 時間帯（day / evening / night）と天気（clear / rain / snow）。見た目だけで、走りやすさは変えない
    setAtmosphere(time, weather) {
      const t = TIMES[time] ?? TIMES.evening, w = WEATHERS[weather] ?? WEATHERS.clear;
      currentWeather = weather; // 雨の日は歩行者が傘をさす
      const gray = new THREE.Color(0x8a8f99);
      const tone = (hex, k = w.gray) => {
        const c = new THREE.Color(hex);
        // 灰色に寄せるときも、暗い時間帯は暗いままにする（明るさを保つ）
        const g = gray.clone().multiplyScalar(c.getHSL({}).l * 1.6 + 0.1);
        c.lerp(g, k);
        if (w.whiten) c.lerp(new THREE.Color(0xdfe5ee), w.whiten * (time === 'night' ? 0.3 : 1));
        return c;
      };
      const u = sky.userData.uniforms;
      u.top.value.copy(tone(t.sky[0]));
      u.mid.value.copy(tone(t.sky[1]));
      u.horizon.value.copy(tone(t.sky[2]));
      const fog = tone(t.fog);
      scene.fog.color.copy(fog);
      scene.fog.near = w.fogNear;
      scene.fog.far = w.fogFar;
      renderer.setClearColor(fog);
      hemi.color.set(t.hemi[0]);
      hemi.groundColor.set(t.hemi[1]);
      hemi.intensity = t.hemi[2] * w.light;
      sun.color.set(t.sun[0]);
      sun.intensity = t.sun[1] * w.light * (weather === 'clear' ? 1 : 0.6);
      SUN_DIR.set(...t.sunDir).normalize();
      // 窓の灯り（今ある区間の立体すべてと、これから作る区間）
      windowGlow = t.glow;
      for (const wd of worlds.values()) for (const m of wd.group?.userData.tiles?.values() ?? []) m.material.emissiveIntensity = t.glow;
      // 街灯：昼は消す。夜は足もとをより明るく
      LAMP_MAT.color.set(t.lamps ? 0xffd9a0 : 0x6b6e75);
      POOL_MAT.visible = t.lamps;
      POOL_MAT.opacity = time === 'night' ? 0.6 : 0.35;
    },

    // 区間の立体の準備（game.js から）：進み具合（できていれば null）と、先に作っておく
    progress(map) {
      return map ? progressOf(map) : null;
    },
    prepare(map) {
      worldFor(map);
    },
    // テスト用：区間 map（省略すると今の区間）の立体をすぐに作り終える
    finishNow(map = worldMap) {
      if (map !== worldMap) setMap(map);
      const w = worldFor(worldMap);
      build(w, Infinity);
      w.group.children.forEach((m) => (m.visible = true));
      w.revealed = w.group.children.length;
      if (world !== w.group) {
        world = w.group;
        scene.add(world);
        signalMeshes.obs = null;
      }
    },

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
      advanceWorlds(game);

      const p = game.player;
      // 自転車の高さ：今いる道路（橋の上なら橋の高さ）。急に変わらないよう少しなめらかにする
      const rh = roadH();
      const targetH = groundHeight(rh, game.surface.segs, p.x, p.y, bikeH);
      bikeH = game.state === 'racing' ? bikeH + (targetH - bikeH) * Math.min(1, 12 * dt) : targetH;
      animateBike(player, p, game.state === 'racing' ? p.speed : 0, dt, bikeH);
      ghost.visible = Boolean(game.ghostPose);
      if (game.ghostPose) {
        const gp = game.ghostPose;
        const gs = ghostPrev && dt > 0 ? Math.hypot(gp.x - ghostPrev.x, gp.y - ghostPrev.y) / dt : 0;
        ghostH = groundHeight(roadH(), surfaceAt(worldMap, gp.x, gp.y).segs, gp.x, gp.y, ghostH);
        animateBike(ghost, gp, Math.min(gs, 20), dt, ghostH);
        ghostPrev = { x: gp.x, y: gp.y };
      } else {
        ghostPrev = null;
      }
      // 光の向き（時間帯で変わる）。影を付ける範囲も自転車について動かす
      sun.target.position.set(p.x, 0, p.y);
      sun.position.set(p.x + SUN_DIR.x * 300, SUN_DIR.y * 300, p.y + SUN_DIR.z * 300);

      syncSignals(game.obstacles);
      updateSignalColors(game.obstacles);
      syncAgents(game.obstacles);
      syncTrain(game);
      placeCamera(game, dt);
      // デバッグ・自動テスト用：window.render3d.debugCamera = { pos: [x, y, z], look: [x, y, z] } でカメラを固定する
      const dc = window.render3d?.debugCamera;
      if (dc) {
        camera.position.set(...dc.pos);
        camera.lookAt(...dc.look);
      }
      sky.position.copy(camera.position);
      locateGoal(game);
      locateLandmarks(game);
      fadeOccluders(game, dt);
      renderer.render(scene, camera);
      // 今回だけ画面の外でも描いた区画を元に戻す
      for (const m of unculled) m.frustumCulled = true;
      unculled = [];
    },
  };
  window.render3d = { renderer, scene, camera, r3d }; // デバッグ・自動テスト用
  return r3d;
}
