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
  constructor(withColor = false, withUV = false, withStyle = false) {
    this.pos = new FloatList();
    this.nor = new FloatList();
    this.col = withColor ? new FloatList() : null;
    this.uv = withUV ? new FloatList(2048) : null;
    this.sty = withStyle ? new FloatList(1024) : null; // 建物の外観の種類（FACADE）
  }
  // uvs：3 つの頂点のテクスチャ座標 [[u, v], [u, v], [u, v]]（withUV のとき）、style：外観の種類（withStyle のとき）
  tri(a, b, c, n, color, uvs = ROOF_UV, style = FACADE.plain) {
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
    if (this.sty) {
      const S = this.sty;
      S.reserve(3);
      S.a[S.n++] = style;
      S.a[S.n++] = style;
      S.a[S.n++] = style;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    if (this.sty) g.setAttribute('wstyle', new THREE.BufferAttribute(this.sty.view(), 1));
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

// 建物の外観の種類。1 枚の画像（アトラス）に横に並べ、シェーダーで建物ごとに使い分ける（描く回数は増えない）。
// 1 枚分（256px 四方）が、横 WINDOW_COLS 個 × 縦 WINDOW_ROWS 階ぶん。shop は 1 階のお店、plain は窓のない壁・屋根・屋上の設備
export const FACADE = { office: 0, apartment: 1, glass: 2, house: 3, shop: 4, plain: 5 };
const FACADE_COUNT = 6;

function windowTextures(maxAnisotropy) {
  const T = WINDOW_COLS * WINDOW_PX; // 1 種類の大きさ px
  const U = WINDOW_PX; // 窓 1 つ（1 階ぶん）の大きさ px
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = T * FACADE_COUNT;
    c.height = T;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // 繰り返しはシェーダーで（fract）
    t.anisotropy = maxAnisotropy;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // 灯り：種類ごとに、点いている窓の割合と色
  const glowColor = (warm, v) => (warm ? `rgba(255, ${200 + Math.round(v * 30)}, ${130 + Math.round(v * 60)}, ${v})` : `rgba(${215 + Math.round(v * 30)}, 232, 255, ${v})`);
  const plan = []; // [種類, 列, 段, 点いているか（0〜1）]
  const each = (style, fn) => {
    for (let j = 0; j < WINDOW_ROWS; j++) for (let i = 0; i < WINDOW_COLS; i++) fn(style * T + i * U, j * U, i, j);
  };
  const color = make((ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, T * FACADE_COUNT, T);
    // オフィス：縦長の窓の格子と、窓の真ん中の桟
    each(FACADE.office, (x, y) => {
      ctx.fillStyle = '#3d4a5c';
      ctx.fillRect(x + 5, y + 7, U - 10, U - 12);
      ctx.fillStyle = '#c9d1db';
      ctx.fillRect(x + U / 2 - 1, y + 7, 2, U - 12);
    });
    // マンション：窓と、各階のベランダ（明るい帯と手すり）
    each(FACADE.apartment, (x, y) => {
      ctx.fillStyle = '#46505c';
      ctx.fillRect(x + 6, y + 5, U - 12, 15);
      ctx.fillStyle = '#e4e4e4';
      ctx.fillRect(x, y + 22, U, 10);
      ctx.fillStyle = '#9aa0a8';
      for (let k = 2; k < U; k += 5) ctx.fillRect(x + k, y + 22, 1, 7);
    });
    // ガラス張り：青みのあるガラスの帯と、階の境の細い帯
    each(FACADE.glass, (x, y) => {
      const g = ctx.createLinearGradient(x, y, x + U, y + U);
      g.addColorStop(0, '#5f7f9e');
      g.addColorStop(1, '#3f5a75');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + 4, U, U - 4);
      ctx.fillStyle = '#2b3846';
      ctx.fillRect(x, y, U, 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x + U - 1, y + 4, 1, U - 4);
    });
    // 一戸建て：小さな窓がところどころ
    each(FACADE.house, (x, y, i, j) => {
      if ((i * 7 + j * 3) % 5 > 2) return;
      ctx.fillStyle = '#6b6e75';
      ctx.fillRect(x + 8, y + 8, U - 16, 14);
      ctx.fillStyle = '#4a4f57';
      ctx.fillRect(x + 10, y + 10, U - 20, 10);
    });
    // お店（1 階）：上に看板の帯、下は大きなガラス
    const signs = ['#c94f4f', '#4f7fc9', '#5aa36b', '#e0a03a', '#8e6cc4', '#2bb3b1'];
    each(FACADE.shop, (x, y, i) => {
      ctx.fillStyle = signs[(i * 5 + 3) % signs.length];
      ctx.fillRect(x, y, U, 6);
      ctx.fillStyle = '#3a3f47';
      ctx.fillRect(x + 2, y + 8, U - 4, U - 9);
    });
    // 窓のない壁（屋根・屋上の設備）は白のまま
  });
  const glow = make((ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, T * FACADE_COUNT, T);
    each(FACADE.office, (x, y) => {
      if (rand() < 0.3) (ctx.fillStyle = glowColor(false, 0.6 + rand() * 0.4)), ctx.fillRect(x + 5, y + 7, U - 10, U - 12);
    });
    each(FACADE.apartment, (x, y) => {
      if (rand() < 0.35) (ctx.fillStyle = glowColor(true, 0.55 + rand() * 0.45)), ctx.fillRect(x + 6, y + 5, U - 12, 15);
    });
    each(FACADE.glass, (x, y) => {
      if (rand() < 0.22) (ctx.fillStyle = glowColor(false, 0.4 + rand() * 0.4)), ctx.fillRect(x, y + 4, U, U - 4);
    });
    each(FACADE.house, (x, y, i, j) => {
      if ((i * 7 + j * 3) % 5 > 2) return;
      if (rand() < 0.4) (ctx.fillStyle = glowColor(true, 0.6 + rand() * 0.4)), ctx.fillRect(x + 10, y + 10, U - 20, 10);
    });
    each(FACADE.shop, (x, y, i) => {
      if (rand() < 0.85) (ctx.fillStyle = glowColor(true, 0.7 + rand() * 0.3)), ctx.fillRect(x + 2, y + 8, U - 4, U - 9);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x, y, U, 6); // 看板もほんのり
    });
  });
  void plan;
  return { color, glow };
}

// 建物の材質：アトラスから、頂点の外観の種類（wstyle）の 1 枚を選んで繰り返し貼る。
// マンションとオフィスの 1 階はお店にする
const FACADE_SHADER_KEY = 'facade-v1';
function useFacades(material) {
  material.customProgramCacheKey = () => FACADE_SHADER_KEY;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float wstyle;\nvarying float vStyle;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vStyle = wstyle;');
    shader.fragmentShader = 'varying float vStyle;\n' + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `float facade = floor(vStyle + 0.5);
  if (facade < 1.5 && vMapUv.y * ${WINDOW_ROWS.toFixed(1)} < 1.0) facade = ${FACADE.shop.toFixed(1)};
  vec2 facadeCell = fract(vMapUv);
  vec2 facadeUv = vec2((facade + 0.004 + facadeCell.x * 0.992) / ${FACADE_COUNT.toFixed(1)}, facadeCell.y);
  vec2 facadeDx = dFdx(vMapUv) * vec2(1.0 / ${FACADE_COUNT.toFixed(1)}, 1.0);
  vec2 facadeDy = dFdy(vMapUv) * vec2(1.0 / ${FACADE_COUNT.toFixed(1)}, 1.0);
  diffuseColor *= textureGrad(map, facadeUv, facadeDx, facadeDy);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance *= textureGrad(emissiveMap, facadeUv, facadeDx, facadeDy).rgb;`,
      );
  };
  return material;
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
// 面（3 点）を、法線を外向き（center から離れる向き）にして加える
function triOut(b, a, c, d, color, center, style = FACADE.plain) {
  const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  const f = [(a[0] + c[0] + d[0]) / 3 - center[0], (a[1] + c[1] + d[1]) / 3 - center[1], (a[2] + c[2] + d[2]) / 3 - center[2]];
  if (n[0] * f[0] + n[1] * f[1] + n[2] * f[2] < 0) n = [-n[0], -n[1], -n[2]];
  b.tri(a, c, d, n, color, ROOF_UV, style);
}
// 箱（屋上の設備）
function addRoofBox(b, x, z, y, w, d, h, color) {
  const c = [x, y + h / 2, z];
  const P = (sx, sy, sz) => [x + (sx * w) / 2, y + sy * h, z + (sz * d) / 2];
  const quads = [
    [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)],
    [P(-1, 0, -1), P(1, 0, -1), P(1, 1, -1), P(-1, 1, -1)],
    [P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1)],
    [P(-1, 0, -1), P(-1, 0, 1), P(-1, 1, 1), P(-1, 1, -1)],
    [P(1, 0, -1), P(1, 0, 1), P(1, 1, 1), P(1, 1, -1)],
  ];
  for (const [q0, q1, q2, q3] of quads) {
    triOut(b, q0, q1, q2, color, c);
    triOut(b, q0, q2, q3, color, c);
  }
}

// 建物：底面の多角形を高さ h まで立ち上げる。look：{ wall, roof（色）, style（外観）, gable（三角屋根）, rooftop（屋上の設備）, seed }
function addBuilding(b, p, h, look) {
  const ring = openRing(p);
  const n = ring.length / 2;
  if (n < 3) return;
  const ccw = polygonArea(ring) > 0; // 地図座標（y が南）での向き
  const { wall: color, roof } = look;
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
      b.tri(a, c, bb, nrm, color, [ua, uc, ub], look.style);
      b.tri(a, d, c, nrm, color, [ua, ud, uc], look.style);
    } else {
      b.tri(a, bb, c, nrm, color, [ua, ub, uc], look.style);
      b.tri(a, c, d, nrm, color, [ua, uc, ud], look.style);
    }
  }
  // 三角屋根（四角い一戸建て）：長い辺に沿った棟
  if (look.gable && n === 4) {
    const P = (k) => [ring[2 * k], h, ring[2 * k + 1]];
    const e0 = Math.hypot(ring[2] - ring[0], ring[3] - ring[1]), e1 = Math.hypot(ring[4] - ring[2], ring[5] - ring[3]);
    const [p0, p1, p2, p3] = e0 >= e1 ? [P(0), P(1), P(2), P(3)] : [P(1), P(2), P(3), P(0)];
    const rh = Math.min(2.2, Math.min(e0, e1) * 0.35); // 屋根の高さ
    const mid = (a, c) => [(a[0] + c[0]) / 2, h + rh, (a[2] + c[2]) / 2];
    const m1 = mid(p1, p2), m3 = mid(p3, p0);
    const center = [(p0[0] + p2[0]) / 2, h, (p0[2] + p2[2]) / 2];
    triOut(b, p0, p1, m1, roof, center);
    triOut(b, p0, m1, m3, roof, center);
    triOut(b, p2, p3, m3, roof, center);
    triOut(b, p2, m3, m1, roof, center);
    triOut(b, p1, p2, m1, color, center); // 妻（三角の壁）
    triOut(b, p3, p0, m3, color, center);
    return;
  }
  const contour = [];
  for (let i = 0; i < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = contour[i], B = contour[j], C = contour[k];
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cross > 0) b.tri([A.x, h, A.y], [C.x, h, C.y], [B.x, h, B.y], UP, roof);
    else b.tri([A.x, h, A.y], [B.x, h, B.y], [C.x, h, C.y], UP, roof);
  }
  // 屋上の設備（室外機・給水タンク）：多角形の中に収まる所に 1〜3 個
  if (look.rooftop) {
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i += 2) (cx += ring[i]), (cz += ring[i + 1]);
    cx /= n;
    cz /= n;
    const count = 1 + (look.seed % 3);
    for (let k = 0; k < count; k++) {
      const r1 = ((look.seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5, r2 = ((look.seed * (k + 7) * 40503) % 1000) / 1000 - 0.5;
      const x = cx + r1 * 8, z = cz + r2 * 8;
      if (!insidePolygon(x, z, ring)) continue;
      const tank = k === 0 && look.seed % 4 === 0;
      addRoofBox(b, x, z, h, tank ? 2.4 : 1.6, tank ? 2.4 : 1.1, tank ? 2.2 : 1.1, tank ? [0.55, 0.57, 0.6] : [0.62, 0.64, 0.66]);
    }
  }
}

// 建物の見た目を、高さ h と床面積 area と番号 i から決める（番号から決めるので毎回同じ）
const HOUSE_WALLS = [[0.86, 0.8, 0.7], [0.78, 0.7, 0.6], [0.9, 0.88, 0.84], [0.66, 0.56, 0.48], [0.8, 0.82, 0.84]];
const HOUSE_ROOFS = [[0.3, 0.22, 0.18], [0.24, 0.27, 0.33], [0.18, 0.18, 0.2], [0.42, 0.26, 0.2]];
const APARTMENT_WALLS = [[0.86, 0.82, 0.74], [0.9, 0.9, 0.88], [0.68, 0.5, 0.42], [0.76, 0.74, 0.7], [0.82, 0.78, 0.7]];
const OFFICE_WALLS = [[0.66, 0.68, 0.72], [0.58, 0.6, 0.64], [0.74, 0.74, 0.74], [0.62, 0.6, 0.56]];
const GLASS_WALLS = [[0.82, 0.88, 0.96], [0.74, 0.8, 0.9], [0.86, 0.9, 0.92]];
function buildingLook(h, area, i) {
  const r = (k) => (((i + 1) * 2654435761 * (k + 1)) % 9973) / 9973;
  const pick = (list, k) => list[Math.floor(r(k) * list.length)];
  const shade = (c, k) => c.map((v) => v * (0.9 + r(k) * 0.15));
  let style;
  if (h < 9 && area < 300) style = FACADE.house;
  else if (h >= 45) style = r(1) < 0.65 ? FACADE.glass : FACADE.office;
  else if (h >= 20) style = r(1) < 0.45 ? FACADE.apartment : r(1) < 0.8 ? FACADE.office : FACADE.glass;
  else style = r(1) < 0.6 ? FACADE.apartment : FACADE.office;
  const walls = { [FACADE.house]: HOUSE_WALLS, [FACADE.apartment]: APARTMENT_WALLS, [FACADE.office]: OFFICE_WALLS, [FACADE.glass]: GLASS_WALLS }[style];
  const wall = shade(pick(walls, 2), 3);
  const roof = style === FACADE.house ? pick(HOUSE_ROOFS, 4) : wall.map((v) => v * 0.78);
  return { style, wall, roof, gable: style === FACADE.house && r(5) < 0.8, rooftop: style !== FACADE.house && h >= 12 && area >= 120, seed: Math.floor(r(6) * 1000) };
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

// ---- 線路 ----
// 砂利（バラスト）にコンクリートのまくらぎが並ぶ道床と、2 本のレール（軌間 1067mm）、線路の脇の架線柱と架線
const TRACK_W = 3.0; // 道床の幅 m
const SLEEPER_TILE = 4; // 道床の画像 1 枚が線路の長さ何 m ぶんか（まくらぎ 7 本）
const RAIL_GAUGE = 1.067;
const RAIL_TOP = 0.2; // レールの高さ（道床の上）m
const RAIL_STEEL = [0.62, 0.63, 0.66];
const WIRE = [0.16, 0.17, 0.19];
const CATENARY_SPACING = 60; // 架線柱の間隔 m
const CATENARY_H = 6.2; // 架線柱の高さ m
const WIRE_H = 5.4; // 架線の高さ（レールの上）m

// 線路の道床：幅 w の帯に、横 0〜1・縦は線路の長さ（SLEEPER_TILE m で 1）のテクスチャ座標を付ける
function addTrackBed(b, p, w, y) {
  const hw = w / 2;
  let along = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = (-(z2 - z1) / len) * hw, nz = ((x2 - x1) / len) * hw;
    const v0 = along / SLEEPER_TILE, v1 = (along + len) / SLEEPER_TILE;
    const a = [x1 + nx, y, z1 + nz], bb = [x1 - nx, y, z1 - nz], c = [x2 - nx, y, z2 - nz], d = [x2 + nx, y, z2 + nz];
    b.tri(a, c, bb, UP, null, [[0, v0], [1, v1], [1, v0]]);
    b.tri(a, d, c, UP, null, [[0, v0], [0, v1], [1, v1]]);
    along += len;
  }
}

// 線から横に off m ずらした、幅 width・高さ y の細い帯（レール・架線）
function addOffsetStrip(b, p, off, width, y, color) {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
    const ox = nx * off, oz = nz * off, wx = (nx * width) / 2, wz = (nz * width) / 2;
    const a = [x1 + ox - wx, y, z1 + oz - wz], bb = [x1 + ox + wx, y, z1 + oz + wz], c = [x2 + ox + wx, y, z2 + oz + wz], d = [x2 + ox - wx, y, z2 + oz - wz];
    b.tri(a, c, bb, UP, color);
    b.tri(a, d, c, UP, color);
  }
}

// 架線柱の位置（線に沿って CATENARY_SPACING m おき）：[x, z, 線の向き]
function catenarySpots(p) {
  const spots = [];
  let next = CATENARY_SPACING / 3, walked = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
    const len = Math.hypot(x2 - x1, z2 - z1);
    while (next <= walked + len) {
      const t = (next - walked) / len;
      spots.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, Math.atan2(z2 - z1, x2 - x1)]);
      next += CATENARY_SPACING;
    }
    walked += len;
  }
  return spots;
}

// 道床の画像：砂利と、等間隔のコンクリートのまくらぎ
function trackBedTexture(maxAnisotropy) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256; // 縦が線路の向き（SLEEPER_TILE m）
  const ctx = c.getContext('2d');
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const img = ctx.createImageData(64, 256);
  for (let i = 0; i < 64 * 256; i++) {
    const v = 95 + rand() * 70;
    img.data[4 * i] = v;
    img.data[4 * i + 1] = v * 0.95;
    img.data[4 * i + 2] = v * 0.88;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const sleepers = 7;
  for (let k = 0; k < sleepers; k++) {
    const y = ((k + 0.5) * 256) / sleepers;
    ctx.fillStyle = '#a7a59f';
    ctx.fillRect(7, y - 6, 50, 12); // 幅 2.4m ほど
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(7, y + 5, 50, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- 駅のホーム ----
// 電車が発車・到着する位置（経路の始めと終わりの、編成の長さぶん）に沿ってホームを置く。
// 向かいに線路があれば線路にはさまれた島式、なければ片側の相対式。線路側の端に白線と点字ブロック、中央部に屋根、駅名標
const PLATFORM_TOP = 1.1; // ホームの高さ（レールの上）m
const PLATFORM_EDGE = 1.65; // 線路の中心からホームの端まで m
const CANOPY_H = 4.4; // 屋根の高さ（ホームの上）m

// 線路の点 at（経路の pointAt）から横（左が正）に、ほかの線路がどれだけ離れてあるか（左右それぞれ一番近いもの）
function nearbyTracks(map, at) {
  const nx = -Math.cos(at.angle), nz = -Math.sin(at.angle); // 進む向きの左（地図の座標で）。ホームの左右もこの向きを正とする
  const fx = Math.sin(at.angle), fz = -Math.cos(at.angle);
  let left = Infinity, right = Infinity;
  for (const l of map.lines) {
    if (l.k === 'river' || l.u) continue;
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      // 線分のうち、点 at の真横（前後 6m 以内）の所
      const ax = l.p[i] - at.x, az = l.p[i + 1] - at.y, bx = l.p[i + 2] - at.x, bz = l.p[i + 3] - at.y;
      const fa = ax * fx + az * fz, fb = bx * fx + bz * fz;
      if ((fa > 6 && fb > 6) || (fa < -6 && fb < -6)) continue;
      const t = Math.abs(fb - fa) < 1e-6 ? 0 : Math.max(0, Math.min(1, -fa / (fb - fa)));
      const lat = (ax + (bx - ax) * t) * nx + (az + (bz - az) * t) * nz;
      if (lat > 1.5) right = Math.min(right, lat);
      else if (lat < -1.5) left = Math.min(left, -lat);
    }
  }
  return { left, right };
}

// 駅名標の画像（JR東日本風：白地に黄緑の帯、駅名、山手線、隣の駅）
function stationSignTexture(name, prev, next) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f8f6';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = '#8cc63f';
  ctx.fillRect(0, 128, 512, 26);
  ctx.fillStyle = '#1b1d22';
  ctx.textAlign = 'center';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.fillText(name, 256, 100);
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('山手線', 256, 148);
  ctx.fillStyle = '#1b1d22';
  ctx.font = '22px system-ui, sans-serif';
  if (prev) (ctx.textAlign = 'left'), ctx.fillText(`← ${prev}`, 14, 180);
  if (next) (ctx.textAlign = 'right'), ctx.fillText(`${next} →`, 498, 180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addStations(group, map, textures) {
  const route = map.trainRoute;
  if (!route) return;
  const trainLen = carCount(route) * 20;
  const body = new GeometryBuilder(true);
  const GRAY = [0.62, 0.63, 0.64], SIDE = [0.42, 0.43, 0.46], WHITE = [0.92, 0.92, 0.9], YELLOW = [0.95, 0.78, 0.15];
  const ROOF = [0.55, 0.57, 0.6], COLUMN = [0.5, 0.52, 0.56];
  const signs = [];
  // 出発駅（経路の始め）と到着駅（終わり）
  for (const [s0, s1, name, prev, next] of [
    [0, trainLen, map.from, null, map.to],
    [route.length - trainLen, route.length, map.to, map.from, null],
  ]) {
    const mid = pointAt(route, (s0 + s1) / 2);
    const { left, right } = nearbyTracks(map, mid);
    // 島式：片側 6〜16m に線路があれば、そのあいだ。なければ広い方の側に幅 6m の相対式
    let side, width;
    const island = [[right, 1], [left, -1]].filter(([d]) => d >= 6 && d <= 16).sort((a, b) => a[0] - b[0])[0];
    if (island) (side = island[1]), (width = island[0] - 2 * PLATFORM_EDGE);
    else (side = right >= left ? 1 : -1), (width = Math.min(6, Math.max(3, (side > 0 ? right : left) - 2 * PLATFORM_EDGE)));
    const inner = PLATFORM_EDGE, outer = PLATFORM_EDGE + width; // 線路の中心からの横の距離
    const steps = Math.max(2, Math.ceil((s1 - s0) / 5));
    const P = (s, lat, up) => {
      const at = pointAt(route, s);
      const nx = -Math.cos(at.angle), nz = -Math.sin(at.angle);
      return [at.x + nx * lat * side, at.h + Y.rail + up, at.y + nz * lat * side];
    };
    const quad = (a, b, c, d, n, col) => {
      body.tri(a, b, c, n, col);
      body.tri(a, c, d, n, col);
    };
    for (let k = 0; k < steps; k++) {
      const sa = s0 + ((s1 - s0) * k) / steps, sb = s0 + ((s1 - s0) * (k + 1)) / steps;
      const top = PLATFORM_TOP;
      // 上面（灰色）・線路側の白線と点字ブロック・側面
      quad(P(sa, inner + 0.25, top), P(sb, inner + 0.25, top), P(sb, outer, top), P(sa, outer, top), UP, GRAY);
      quad(P(sa, inner, top + 0.005), P(sb, inner, top + 0.005), P(sb, inner + 0.12, top + 0.005), P(sa, inner + 0.12, top + 0.005), UP, WHITE);
      quad(P(sa, inner + 0.12, top), P(sb, inner + 0.12, top), P(sb, inner + 0.25, top), P(sa, inner + 0.25, top), UP, GRAY);
      quad(P(sa, inner + 0.75, top + 0.01), P(sb, inner + 0.75, top + 0.01), P(sb, inner + 1.05, top + 0.01), P(sa, inner + 1.05, top + 0.01), UP, YELLOW);
      if (!island) quad(P(sa, outer - 1.05, top + 0.01), P(sb, outer - 1.05, top + 0.01), P(sb, outer - 0.75, top + 0.01), P(sa, outer - 0.75, top + 0.01), UP, GRAY);
      // 側面の向き（線路側は線路へ、反対側は外へ）
      const am = pointAt(route, (sa + sb) / 2);
      const lx = -Math.cos(am.angle) * side, lz = -Math.sin(am.angle) * side;
      quad(P(sa, inner, 0), P(sb, inner, 0), P(sb, inner, top), P(sa, inner, top), [-lx, 0, -lz], SIDE);
      quad(P(sa, outer, 0), P(sb, outer, 0), P(sb, outer, top), P(sa, outer, top), [lx, 0, lz], SIDE);
      // 屋根（ホームの中央部 6 割）
      const f0 = (sa - s0) / (s1 - s0), f1 = (sb - s0) / (s1 - s0);
      if (f0 >= 0.2 && f1 <= 0.8) {
        const rh = top + CANOPY_H;
        quad(P(sa, inner + 0.3, rh), P(sb, inner + 0.3, rh), P(sb, outer - 0.3, rh), P(sa, outer - 0.3, rh), UP, ROOF);
        quad(P(sa, inner + 0.3, rh + 0.25), P(sb, inner + 0.3, rh + 0.25), P(sb, outer - 0.3, rh + 0.25), P(sa, outer - 0.3, rh + 0.25), UP, ROOF);
        if (k % 2 === 0) {
          // 柱（ホームの真ん中に 1 本）
          const c = P(sa, (inner + outer) / 2, 0);
          addBox(body, c[0] - 0.15, c[0] + 0.15, c[1] + top, c[1] + rh, c[2] - 0.15, c[2] + 0.15, COLUMN);
        }
      }
    }
    // 駅名標：ホームの 3 か所に、線路に向けて立てる
    for (const f of [0.25, 0.5, 0.75]) {
      const s = s0 + (s1 - s0) * f;
      const at = pointAt(route, s);
      const pos = P(s, inner + 2.2, PLATFORM_TOP + 2.2);
      signs.push({ pos, angle: at.angle, name, prev, next });
    }
  }
  const mesh = new THREE.Mesh(body.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  // 駅名標（板と、両側の柱）
  const texCache = new Map();
  for (const sg of signs) {
    const key = `${sg.name}|${sg.prev}|${sg.next}`;
    if (!texCache.has(key)) texCache.set(key, stationSignTexture(sg.name, sg.prev, sg.next));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: texCache.get(key), side: THREE.DoubleSide }));
    board.position.set(...sg.pos);
    board.rotation.y = -sg.angle + Math.PI / 2; // 板の面を線路に向ける（線路と平行に立てる）
    group.add(board);
  }
}

// ---- 道路の区画線・横断歩道・歩道 ----
const WHITE_LINE = [0.86, 0.87, 0.85];
const YELLOW_LINE = [0.9, 0.72, 0.2];
const SIDEWALK = [0.4, 0.42, 0.46];
const MAJOR_CENTER = new Set(['trunk', 'primary', 'trunk_link', 'primary_link']); // 中央線が黄色（追い越し禁止）の道
const INTERSECTION_GAP = 7; // 交差点の中心からこの距離 m までは線を引かない（線は交差点で途切れる）

// 道路 r の点ごとの、先頭からの距離 m と、交差点（ほかの車道とつながる点）までの距離
function roadMeasures(map, r, carRoad) {
  const n = r.p.length / 2;
  const cum = [0];
  for (let v = 1; v < n; v++) cum.push(cum[v - 1] + Math.hypot(r.p[2 * v] - r.p[2 * v - 2], r.p[2 * v + 1] - r.p[2 * v - 1]));
  const crossings = [];
  for (let v = 0; v < n; v++) {
    const others = (map.nodes.get(nodeKey(r.p[2 * v], r.p[2 * v + 1])) ?? []).filter((o) => o.road !== r && carRoad(o.road));
    if (others.length) crossings.push(cum[v]);
  }
  return { cum, crossings };
}

// 区間 [a, b]（先頭からの距離）から、交差点のまわりを除いた残り
function clipCrossings(a, b, crossings, gap) {
  let pieces = [[a, b]];
  for (const d of crossings) {
    const next = [];
    for (const [s0, s1] of pieces) {
      if (s1 <= d - gap || s0 >= d + gap) next.push([s0, s1]);
      else {
        if (s0 < d - gap) next.push([s0, d - gap]);
        if (s1 > d + gap) next.push([d + gap, s1]);
      }
    }
    pieces = next;
  }
  return pieces;
}

// 道の中心線から横に off m（進む向きの右が正）ずらした、幅 width の線。dash > 0 なら破線（dash m 引いて gap m あける）。
// y：高さ（道路の点 i から次の点への割合 t の関数）。交差点のまわりは引かない
function addLaneLine(b, r, meas, off, width, yAt, color, dash = 0, gap = 0, skip = INTERSECTION_GAP) {
  const { cum, crossings } = meas;
  const pattern = dash > 0 ? dash + gap : 0;
  for (let i = 0; i + 3 < r.p.length; i += 2) {
    const v = i / 2;
    const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
    const len = cum[v + 1] - cum[v];
    if (len < 1e-6) continue;
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const nx = -dz, nz = dx; // 進む向きの右（地図の座標で）
    // この線分で引く区間（先頭からの距離）
    let spans = [[cum[v], cum[v + 1]]];
    if (pattern) {
      spans = [];
      let s0 = Math.ceil(cum[v] / pattern) * pattern - pattern;
      for (; s0 < cum[v + 1]; s0 += pattern) {
        const a = Math.max(cum[v], s0), c = Math.min(cum[v + 1], s0 + dash);
        if (c > a) spans.push([a, c]);
      }
    }
    for (const [a0, a1] of spans) {
      for (const [s0, s1] of clipCrossings(a0, a1, crossings, skip)) {
        const t0 = (s0 - cum[v]) / len, t1 = (s1 - cum[v]) / len;
        const ya = yAt(v, t0), yb = yAt(v, t1);
        const ax = x1 + (x2 - x1) * t0 + nx * off, az = z1 + (z2 - z1) * t0 + nz * off;
        const bx = x1 + (x2 - x1) * t1 + nx * off, bz = z1 + (z2 - z1) * t1 + nz * off;
        const wx = nx * (width / 2), wz = nz * (width / 2);
        b.tri([ax - wx, ya, az - wz], [bx + wx, yb, bz + wz], [ax + wx, ya, az + wz], UP, color);
        b.tri([ax - wx, ya, az - wz], [bx - wx, yb, bz - wz], [bx + wx, yb, bz + wz], UP, color);
      }
    }
  }
}

// 長方形（中心 (x, z)、向き (dx, dz) に沿った長さ len、横幅 w）を高さ y に置く
function addRect(b, x, z, dx, dz, len, w, y, color) {
  const nx = -dz, nz = dx;
  const P = (u, s) => [x + dx * u + nx * s, y, z + dz * u + nz * s];
  b.tri(P(-len / 2, -w / 2), P(len / 2, w / 2), P(-len / 2, w / 2), UP, color);
  b.tri(P(-len / 2, -w / 2), P(len / 2, -w / 2), P(len / 2, w / 2), UP, color);
}

// 道路 r の区画線と歩道。hs：道路の点ごとの高さ（橋・坂。なければ地面）
function addRoadMarkings(markings, sidewalks, map, r, hs, lift) {
  const meas = roadMeasures(map, r, (o) => !o.path && o.t !== 'service');
  const yAt = (dy) => (v, t) => (hs ? hs[v] + (hs[Math.min(hs.length - 1, v + 1)] - hs[v]) * t : 0) + lift + dy;
  const hw = r.w / 2;
  const line = yAt(0.02);
  if (r.w >= 12) {
    // 幹線道路：両端の白線、中央は対面通行なら黄（国道・都道クラス）か白、一方通行なら車線の境の白の破線
    addLaneLine(markings, r, meas, hw - 0.5, 0.15, line, WHITE_LINE);
    addLaneLine(markings, r, meas, -(hw - 0.5), 0.15, line, WHITE_LINE);
    if (r.o) addLaneLine(markings, r, meas, 0, 0.15, line, WHITE_LINE, 5, 5);
    else {
      const center = MAJOR_CENTER.has(r.t) ? YELLOW_LINE : WHITE_LINE;
      addLaneLine(markings, r, meas, -0.12, 0.15, line, center);
      addLaneLine(markings, r, meas, 0.12, 0.15, line, center);
    }
  } else if (r.w >= 8) {
    // 中くらいの道：両端の白線と、中央の白の破線
    addLaneLine(markings, r, meas, hw - 0.4, 0.15, line, WHITE_LINE);
    addLaneLine(markings, r, meas, -(hw - 0.4), 0.15, line, WHITE_LINE);
    if (!r.o) addLaneLine(markings, r, meas, 0, 0.15, line, WHITE_LINE, 5, 5);
  } else {
    // 住宅街の道：両端の路側帯の白線
    addLaneLine(markings, r, meas, hw - 0.6, 0.12, line, WHITE_LINE, 0, 0, 4);
    addLaneLine(markings, r, meas, -(hw - 0.6), 0.12, line, WHITE_LINE, 0, 0, 4);
  }
  // 歩道（幅 8m 以上の道の両側。交差点では途切れる）
  if (r.w >= 8) {
    const walk = yAt(0.12);
    addLaneLine(sidewalks, r, meas, hw + 1.1, 2.2, walk, SIDEWALK, 0, 0, INTERSECTION_GAP + 2);
    addLaneLine(sidewalks, r, meas, -(hw + 1.1), 2.2, walk, SIDEWALK, 0, 0, INTERSECTION_GAP + 2);
  }
}

// 信号のある交差点の横断歩道（白いしま）と停止線。信号の位置を通る道の両側に引く
function addCrosswalks(markings, map, roadHeights) {
  for (const [x, z] of map.signals) {
    const pose = signalPose(map, x, z);
    if (pose.hw < 2.5) continue;
    const dx = Math.sin(pose.angle), dz = -Math.cos(pose.angle);
    const seg = surfaceAt(map, x, z).seg;
    const y = (seg ? segHeight(roadHeights, seg, x, z) : 0) + Y.arrow + 0.01;
    for (const side of [-1, 1]) {
      // しま：道の向きに長い白い帯を、道幅いっぱいに並べる
      const cx = x + dx * side * (INTERSECTION_GAP + 1.5), cz = z + dz * side * (INTERSECTION_GAP + 1.5);
      for (let o = -pose.hw + 0.5; o <= pose.hw - 0.4; o += 0.9) addRect(markings, cx - dz * o, cz + dx * o, dx, dz, 3, 0.45, y, WHITE_LINE);
      // 停止線：横断歩道の手前、交差点へ向かう車線（左側通行なので、交差点へ向かう向きの左）
      const sx = x + dx * side * (INTERSECTION_GAP + 4.5), sz = z + dz * side * (INTERSECTION_GAP + 4.5);
      const hx = -dx * side, hz = -dz * side; // 交差点へ向かう向き
      const lx = hz, lz = -hx; // その左
      addRect(markings, sx + lx * pose.hw * 0.5, sz + lz * pose.hw * 0.5, lx, lz, pose.hw, 0.45, y, WHITE_LINE);
    }
  }
}

// 路面の模様（アスファルトのざらつき・歩道の敷石）：地面の位置（ワールドの xz）で模様の画像を貼る
function groundPatterns() {
  const make = (draw, size = 256) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const asphalt = make((ctx, n) => {
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 200 + rand() * 55;
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // 補修のあと（少し暗い四角）
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.04 + rand() * 0.05})`;
      ctx.fillRect(rand() * n, rand() * n, 20 + rand() * 60, 10 + rand() * 30);
    }
  });
  const pavers = make((ctx, n) => {
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, n, n);
    const cell = n / 8;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const v = 215 + Math.floor(rand() * 40);
        ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
        ctx.fillRect(i * cell + 2 + (j % 2) * (cell / 2), j * cell + 2, cell - 4, cell - 4);
      }
    }
  });
  return { asphalt, pavers };
}
// 材質に、地面の位置で貼る模様を足す（scale：模様 1 枚が何 m 四方か）
function useGroundPattern(material, texture, scale, key) {
  material.customProgramCacheKey = () => `ground-${key}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundTex = { value: texture };
    shader.vertexShader = 'varying vec2 vGroundXZ;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = 'uniform sampler2D groundTex;\nvarying vec2 vGroundXZ;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n  diffuseColor.rgb *= texture2D(groundTex, vGroundXZ / ${scale.toFixed(1)}).rgb;`,
    );
  };
  return material;
}

// 区間の立体を作る。区間を選んだときに画面が止まらないよう、少しずつ作る（ジェネレーター）。
// yield する値は進み具合（0〜1）、最後に立体（THREE.Group）を返す。textures：窓のテクスチャ（windowTextures）
const BUILDINGS_PER_STEP = 150; // 1 回に作る建物の数
const ROADS_PER_STEP = 120; // 1 回に作る道路の数
const TILES_PER_STEP = 4; // 1 回に仕上げる建物のまとまりの数
function* buildWorldSteps(map, textures) {
  const patterns = textures.ground;
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
  const trackBed = new GeometryBuilder(false, true), rails = new GeometryBuilder(true);
  const catenary = []; // 架線柱：[x, z, 線の向き, 高さ]
  const deck = new GeometryBuilder();
  const pillars = [];
  for (let li = 0; li < map.lines.length; li++) {
    const l = map.lines[li];
    if (li > 0 && li % 150 === 0) yield 0.05 + (0.05 * li) / map.lines.length;
    if (l.u) continue;
    if (l.k === 'river') {
      addRibbon((lineBuilders.river ??= new GeometryBuilder()), l.p, l.w, Y.river);
      continue;
    }
    // 線路：道床・レール・架線（高架なら高架橋の上）
    const base = l.e ? ELEVATED_H + 0.05 : Y.rail;
    addTrackBed(trackBed, l.p, TRACK_W, base);
    for (const side of [-1, 1]) addOffsetStrip(rails, l.p, (side * RAIL_GAUGE) / 2, 0.08, base + RAIL_TOP, RAIL_STEEL);
    addOffsetStrip(rails, l.p, 0, 0.035, base + WIRE_H, WIRE);
    for (const [x, z, ang] of catenarySpots(l.p)) catenary.push([x, z, ang, base]);
    if (l.e) {
      addDeck(deck, l.p, l.w + DECK_EXTRA, ELEVATED_H);
      pillars.push(...pillarSpots(l.p));
    }
  }
  if (lineBuilders.river) group.add(new THREE.Mesh(lineBuilders.river.build(), mat(hex(LINE_STYLES.river.color))));
  const bedMesh = new THREE.Mesh(trackBed.build(), mat(0xffffff, { map: textures.trackBed }));
  bedMesh.receiveShadow = true;
  const railMesh = new THREE.Mesh(rails.build(), mat(0xffffff, { vertexColors: true }));
  group.add(bedMesh, railMesh);
  // 架線柱：線路の脇の柱と、線路の上へ伸びる腕
  if (catenary.length) {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, CATENARY_H, 6).translate(0, CATENARY_H / 2, 0);
    const armGeo = new THREE.BoxGeometry(0.1, 0.1, 3.2).translate(0, CATENARY_H - 0.4, -1.4);
    const metal = mat(0x6b7078);
    const poles = new THREE.InstancedMesh(poleGeo, metal, catenary.length);
    const arms = new THREE.InstancedMesh(armGeo, metal, catenary.length);
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    catenary.forEach(([x, z, ang, y], i) => {
      // 柱は線路の横 2.4m。腕は線路の上へ（ローカルの -z）
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      m.makeTranslation(x + nx * 2.4, y, z + nz * 2.4).multiply(r.makeRotationY(Math.atan2(nx, nz)));
      poles.setMatrixAt(i, m);
      arms.setMatrixAt(i, m);
    });
    poles.castShadow = arms.castShadow = true;
    group.add(poles, arms);
  }
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
  const markings = new GeometryBuilder(true); // 区画線・横断歩道・停止線（白・黄）
  const sidewalks = new GeometryBuilder(true); // 幅の広い道の両側の歩道（少し高い）
  const carRoad = (o) => !o.path && o.t !== 'service';
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
    if (carRoad(r) && r.w >= 6) addRoadMarkings(markings, sidewalks, map, r, hs, lift);
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
  addCrosswalks(markings, map, roadHeights);
  const markMesh = new THREE.Mesh(markings.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  markMesh.receiveShadow = true;
  const walkMesh = new THREE.Mesh(sidewalks.build(), useGroundPattern(mat(0xffffff, { vertexColors: true }), patterns.pavers, 2.4, 'pavers'));
  walkMesh.receiveShadow = true;
  group.add(markMesh, walkMesh);
  yield 0.26;
  const pathMat = useGroundPattern(mat(PATH), patterns.pavers, 2.4, 'pavers'), roadMat = useGroundPattern(mat(ROAD), patterns.asphalt, 7, 'asphalt');
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
    if (!tileBuilders.has(key)) tileBuilders.set(key, new GeometryBuilder(true, true, true));
    // 外観（一戸建て・マンション・オフィス・ガラス張り）と色は、高さと床面積と番号から決める
    addBuilding(tileBuilders.get(key), bd.p, h, buildingLook(h, area, i));
    heights.push(h);
    tileOf.push(key);
  }
  yield 0.9;
  const tiles = new Map();
  let ti = 0;
  for (const [key, b] of tileBuilders) {
    if (++ti % TILES_PER_STEP === 0) yield 0.9 + (0.08 * ti) / tileBuilders.size;
    const material = useFacades(
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        map: textures.color,
        emissiveMap: textures.glow,
        emissive: 0xffffff,
        emissiveIntensity: windowGlow,
      }),
    );
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.opacity = 1;
    tiles.set(key, mesh);
    group.add(mesh);
  }
  group.userData = { tiles, heights, tileOf, roadHeights };

  addStreetLights(group, map, roadHeights);
  yield 0.985;
  addStations(group, map, textures);

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

// ---- 電車（E235系の山手線） ----
// 丸みのある断面の銀色の車体、黄緑のドア（片側 4 つ）、灯る窓、台車と車輪、床下の機器、連結部（ほろ）、
// 先頭は黒い顔と前照灯と行き先表示、最後尾は尾灯、一部の車両はパンタグラフ。前は -z、高さはレールの上から
const CAR_LEN = 19.2, CAR_W = 2.95;
const STAINLESS = [0.78, 0.8, 0.83], SKIRT = [0.42, 0.44, 0.47], ROOF = [0.6, 0.62, 0.65];
const DOOR_GREEN = [0.42, 0.74, 0.22], DARK = [0.12, 0.13, 0.15], CAB_BLACK = [0.06, 0.07, 0.08];
// 断面（片側。下から屋根の真ん中まで）[x, y]
const CAR_PROFILE = [[1.38, 1.0], [1.47, 1.3], [1.48, 2.0], [1.47, 3.25], [1.4, 3.52], [1.16, 3.74], [0.62, 3.84], [0, 3.87]];
const DOORS_Z = [-6.9, -2.3, 2.3, 6.9]; // ドアの位置（前後）
const DOOR_W = 1.5;

function trainCarGeometry(kind, pantograph) {
  const body = new GeometryBuilder(true), glass = new GeometryBuilder(), lights = new GeometryBuilder(true);
  const hl = CAR_LEN / 2;
  const colorAt = (y) => (y < 1.32 ? SKIRT : y > 3.45 ? ROOF : STAINLESS);
  // 車体：断面を前後に伸ばす（左右）
  for (const side of [-1, 1]) {
    for (let k = 0; k + 1 < CAR_PROFILE.length; k++) {
      const [x0, y0] = CAR_PROFILE[k], [x1, y1] = CAR_PROFILE[k + 1];
      const ex = (x1 - x0) * side, ey = y1 - y0, el = Math.hypot(ex, ey) || 1;
      const n = [ey / el, -ex / el, 0];
      // 断面の中心（0, 2.4）から外へ向くようにそろえる
      const mx = ((x0 + x1) / 2) * side, my = (y0 + y1) / 2 - 2.4;
      if (n[0] * mx + n[1] * my < 0) (n[0] = -n[0]), (n[1] = -n[1]);
      const a = [x0 * side, y0, -hl], b = [x1 * side, y1, -hl], c = [x1 * side, y1, hl], d = [x0 * side, y0, hl];
      const col = colorAt((y0 + y1) / 2);
      body.tri(a, b, c, n, col);
      body.tri(a, c, d, n, col);
    }
  }
  // 車体の前後の面（断面の形）と床
  for (const z of [-hl, hl]) {
    const nz = [0, 0, Math.sign(z)];
    const center = [0, 2.4, z];
    const pts = [...CAR_PROFILE.map(([x, y]) => [x, y, z]), ...CAR_PROFILE.slice(0, -1).reverse().map(([x, y]) => [-x, y, z])];
    for (let k = 0; k + 1 < pts.length; k++) body.tri(center, pts[k], pts[k + 1], nz, STAINLESS);
    body.tri(center, pts[pts.length - 1], pts[0], nz, STAINLESS);
  }
  addBox(body, -1.38, 1.38, 0.98, 1.0, -hl, hl, SKIRT);
  // ドア（黄緑）とドアの窓、ドアのあいだの窓（夜は灯る）
  for (const side of [-1, 1]) {
    const xo = side * 1.49, xi = side * 1.485;
    for (const dz of DOORS_Z) {
      addBox(body, Math.min(xi, xo + side * 0.02), Math.max(xi, xo + side * 0.02), 1.15, 3.2, dz - DOOR_W / 2, dz + DOOR_W / 2, DOOR_GREEN);
      for (const pane of [-0.36, 0.36]) addBox(glass, Math.min(xo, xo + side * 0.03), Math.max(xo, xo + side * 0.03), 2.2, 3.0, dz + pane - 0.27, dz + pane + 0.27);
    }
    const gaps = [[-hl + 1.0, DOORS_Z[0] - DOOR_W / 2 - 0.3], ...DOORS_Z.slice(0, -1).map((z, k) => [z + DOOR_W / 2 + 0.3, DOORS_Z[k + 1] - DOOR_W / 2 - 0.3]), [DOORS_Z[3] + DOOR_W / 2 + 0.3, hl - 1.0]];
    for (const [z0, z1] of gaps) if (z1 - z0 > 0.5) addBox(glass, Math.min(xo, xo + side * 0.02), Math.max(xo, xo + side * 0.02), 2.05, 3.05, z0, z1);
  }
  // 台車と車輪、床下の機器
  for (const bz of [-hl + 2.6, hl - 2.6]) {
    addBox(body, -1.15, 1.15, 0.45, 0.95, bz - 1.4, bz + 1.4, DARK);
    for (const wz of [-0.9, 0.9]) for (const sx of [-1, 1]) addWheel(body, sx * 0.76, 0.43, bz + wz, 0.43, 0.14, DARK, 10);
  }
  addBox(body, -1.2, 1.2, 0.55, 1.0, -hl + 4.3, hl - 4.3, DARK);
  // 連結部（ほろ）：先頭以外の前の端
  if (kind !== 'lead') addBox(body, -0.62, 0.62, 1.05, 3.2, -hl - 0.42, -hl, DARK);
  // 運転台：先頭は前（-z）、最後尾は後ろ（+z）に黒い顔と黄緑の帯。先頭は前照灯と行き先表示、最後尾は尾灯
  const cab = (z0, z1, front) => {
    addBox(body, -1.42, 1.42, 1.3, 3.55, z0, z1, CAB_BLACK);
    addBox(body, -1.43, 1.43, 1.3, 1.55, z0 - 0.005, z1 + 0.005, DOOR_GREEN);
    const ez = front ? z0 - 0.01 : z1 + 0.01, ez2 = front ? z0 + 0.02 : z1 - 0.02;
    const [lz0, lz1] = [Math.min(ez, ez2), Math.max(ez, ez2)];
    for (const sx of [-1, 1]) addBox(lights, sx * 0.95 - 0.2, sx * 0.95 + 0.2, 1.65, 1.85, lz0, lz1, front ? [1, 0.97, 0.85] : [1, 0.15, 0.12]);
    if (front) addBox(lights, -0.6, 0.6, 3.15, 3.4, lz0, lz1, [1, 0.6, 0.15]); // 行き先表示
  };
  if (kind === 'lead') cab(-hl - 0.12, -hl + 0.01, true);
  if (kind === 'tail') cab(hl - 0.01, hl + 0.12, false);
  // 屋根の冷房装置
  for (const az of [-4.5, 4.5]) addBox(body, -0.85, 0.85, 3.85, 4.15, az - 1.2, az + 1.2, ROOF.map((v) => v * 0.9));
  // パンタグラフ（ひし形の枠と、上の集電の板）
  if (pantograph) {
    const pz = -hl + 3.2, top = 4.75;
    addBox(body, -0.7, 0.7, 3.87, 3.95, pz - 0.7, pz + 0.7, DARK);
    for (const [y0, y1, z0, z1] of [[3.95, 4.38, pz - 0.6, pz - 0.05], [4.38, top, pz - 0.05, pz + 0.4]]) {
      for (const sx of [-0.45, 0.45]) {
        const dy = y1 - y0, dz = z1 - z0, steps = 6;
        for (let k = 0; k < steps; k++) {
          const ya = y0 + (dy * k) / steps, za = z0 + (dz * k) / steps;
          addBox(body, sx - 0.025, sx + 0.025, ya, ya + dy / steps + 0.02, za, za + dz / steps + 0.02, DARK);
        }
      }
    }
    addBox(body, -0.85, 0.85, top, top + 0.06, pz + 0.3, pz + 0.5, DARK);
  }
  return { body: body.build(), glass: glass.build(), lights: lights.build() };
}

const trainGeometries = new Map(); // 種類 → 形（使い回す）
function makeTrainCar(kind, pantograph) {
  const key = `${kind}:${pantograph}`;
  if (!trainGeometries.has(key)) trainGeometries.set(key, trainCarGeometry(kind, pantograph));
  const g = trainGeometries.get(key);
  const car = new THREE.Group();
  // 材質は車両ごと（トンネルの中の車両だけ薄くするため）
  const body = new THREE.Mesh(g.body, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const glass = new THREE.Mesh(g.glass, new THREE.MeshLambertMaterial({ color: 0x1d242d, emissive: 0xfff1d0, emissiveIntensity: windowGlow * 0.7, side: THREE.DoubleSide }));
  glass.userData.trainGlass = true; // 時間帯で灯りの強さを変える
  const lights = new THREE.Mesh(g.lights, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  car.add(body, glass, lights);
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
const CAR_LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); // ライトは光って見える（明るさが光の当たり方によらない）

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
  textures.ground = groundPatterns(); // 路面の模様
  textures.trackBed = trackBedTexture(renderer.capabilities.getMaxAnisotropy()); // 線路の道床
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
    // 両数が変わったら作り直す（先頭・最後尾・パンタグラフの位置が変わるため）
    if (train.length !== n) {
      for (const car of train) {
        trainGroup.remove(car);
        car.traverse((m) => m.material?.dispose());
      }
      train.length = 0;
      for (let i = 0; i < n; i++) {
        const kind = i === 0 ? 'lead' : i === n - 1 ? 'tail' : 'middle';
        const car = makeTrainCar(kind, i % 4 === 2); // パンタグラフは 4 両に 1 両
        train.push(car);
        trainGroup.add(car);
      }
    }
    const front = frontDistance(route, game.trainProgress);
    train.forEach((car, i) => {
      car.visible = i < n;
      if (i >= n) return;
      // 車両の前後の位置から向きを決める（曲線でも線路に沿う）
      const head = pointAt(route, front - 20 * i - 0.4);
      const tail = pointAt(route, front - 20 * (i + 1) + 0.4);
      // 車輪がレールの上に乗るよう、道床とレールの高さぶん上げる
      car.position.set((head.x + tail.x) / 2, (head.h + tail.h) / 2 + Y.rail + RAIL_TOP, (head.y + tail.y) / 2);
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
      for (const car of train) car.traverse((m) => m.userData?.trainGlass && (m.material.emissiveIntensity = t.glow * 0.7)); // 電車の窓
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
