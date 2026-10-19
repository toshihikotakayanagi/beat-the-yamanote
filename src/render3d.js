// 3D版の世界の描き方（Three.js）。地図データ（道路・建物・公園・水域・線路）を立体にし、
// 自転車の後ろ上から追いかける視点で描く。HUD（メニュー・レースバー・ミニマップ）は game.js が
// 上に重ねた透明なキャンバスに描く。
//
// 座標：地図の (x, y)（m。x は東、y は南が正）を Three.js の (x, 高さ, y) に置く（y が上）。
// 向き：自転車などの angle（北が 0、時計回り）は rotation.y = -angle（前が -z 方向のモデル）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { signalState, waitsAtSignal } from './obstacles.js';
import { pointAt, frontDistance, carCount, routeOf, ELEVATED_H } from './trainpath.js';
import { AREA_COLORS, LINE_STYLES, CELL, cellKey, nodeKey, surfaceAt } from './map.js';
import { PLAYER_CONFIG } from './player.js';
import { pedLook, pedSwing } from './pedestrians.js';
import { carLook } from './vehicles.js';
import { signalPose, LAMPS } from './signals.js';
// 街の物 その 6〜15（src/town3d.js。こちらの共通の部品を使うので、お互いに読み込み合う）
import {
  STEAM_TEX,
  addCity14Props,
  syncCity14,
  city14,
  addCity13Props,
  city13,
  BEAM_MAT,
  YAKATA_NIGHT_MAT,
  REFLECT_MAT,
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
} from './town3d.js';

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

// 地点 (x, z) が線路（と高架の橋げた）の上か。線路をまたぐ道路の橋の柱を、線路の上に立てないために使う
const TRACK_CLEAR = 3; // 線路の中心からこの距離 m までは柱を立てない（電車の幅・高架の橋げたの幅の半分より少し広く）
function onTrack(map, x, z, clear = TRACK_CLEAR) {
  for (const l of map.lines) {
    if (l.k === 'river' || l.u) continue;
    const p = l.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) < clear) return true;
    }
  }
  return false;
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
  const sm = streetModel.geos;
  if (sm) {
    // Blender の街灯（柱・腕・灯具をまとめた形と、光る面）と足もとの明かり
    const pole = new THREE.InstancedMesh(sm.lightPole, STREET_MAT, n);
    const lens = new THREE.InstancedMesh(sm.lightLens, LAMP_MAT, n); // 時間帯で明るさが変わる（setAtmosphere）
    const tipX = STREETLIGHT_ARM * Math.cos(STREETLIGHT_TILT);
    const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(5.5, 24).rotateX(-Math.PI / 2).translate(tipX + 0.25, 0, 0), POOL_MAT, n);
    const m = new THREE.Matrix4(), rot = new THREE.Matrix4();
    spots.forEach(([x, z, h, angle], i) => {
      const base = new THREE.Matrix4().makeTranslation(x, h, z).multiply(rot.makeRotationY(angle));
      pole.setMatrixAt(i, base);
      lens.setMatrixAt(i, base);
      pool.setMatrixAt(i, m.copy(base).multiply(rot.makeTranslation(0, Y.signal - 0.01, 0)));
    });
    pole.castShadow = true;
    group.add(pole, lens, pool);
    return;
  }
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

// ---- 木 ----
// Blender で作った木 4 種類（tools/build-trees.py）を、地図データの木の位置（map.trees：[x, y, 種類, ...]。OpenStreetMap の
// 街路樹・公園の木）に、種類ごとに 1 つの InstancedMesh で立てる。1 本ずつ向き・大きさ・色の明るさを位置から決めて変える。
// 建物・車道の中、橋や高架の道の下、線路の近く（枝が電車にかからないように）の木は立てない
const TREE_MODEL_URL = 'data/models/trees.glb';
const TREE_MODEL_NAMES = { 0: 'TREE_Round', 1: 'TREE_Ginkgo', 2: 'TREE_Sakura', 3: 'TREE_Conifer' };
const TREE_TRACK_CLEAR = 5; // 線路の中心からこの距離 m までは木を立てない
const treeModel = { geos: null, done: false };
// 葉の材質（季節で色を変える。頂点の色は葉の明るさだけ）。並びは TREE_MODEL_NAMES と同じ
const TREE_LEAF_SHADE = { TREE_Leaf: 1, TREE_LeafDark: 0.8, TREE_Ginkgo: 1, TREE_Blossom: 1, TREE_Blossom2: 0.9, TREE_Needle: 1 };
const TREE_LEAF_MATS = Object.keys(TREE_MODEL_NAMES).map(() => new THREE.MeshLambertMaterial({ vertexColors: true }));
// 季節ごとの葉の色（丸い木・イチョウ・桜・針葉樹）。null は葉を落とす
const SEASON_LEAVES = {
  spring: [0x78b04e, 0x9cc85a, 0xf4bccb, 0x2f5a34],
  summer: [0x4f8a3c, 0x6f9e3a, 0x4f8f3e, 0x2f5a34],
  autumn: [0xc46a2c, 0xf2c62e, 0xd0502e, 0x2f5a34],
  winter: [0x8a7650, null, null, 0x2f5a34],
};
function applySeasonLeaves(season) {
  (SEASON_LEAVES[season] ?? SEASON_LEAVES.summer).forEach((hex, k) => {
    TREE_LEAF_MATS[k].visible = hex !== null;
    if (hex !== null) TREE_LEAF_MATS[k].color.setHex(hex);
  });
}
applySeasonLeaves('summer');
loadModelParts(TREE_MODEL_URL, TREE_MODEL_NAMES)
  .then((parts) => {
    const leafShade = (part) => TREE_LEAF_SHADE[part.material];
    treeModel.geos = Object.keys(TREE_MODEL_NAMES).map((k) => ({
      trunk: addModelParts(new GeometryBuilder(true), parts[k], (part) => (leafShade(part) ? null : part.color)).build(),
      leaf: addModelParts(new GeometryBuilder(true), parts[k], (part) => (leafShade(part) ? [leafShade(part), leafShade(part), leafShade(part)] : null)).build(),
    }));
  })
  .catch((e) => console.warn(`木のモデルを読み込めませんでした: ${TREE_MODEL_URL}`, e))
  .finally(() => (treeModel.done = true));
const TREE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

function addTrees(group, map, heights) {
  const t = map.trees;
  if (!t?.length || !treeModel.geos) return;
  const byKind = treeModel.geos.map(() => []);
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], z = t[i + 1];
    const s = surfaceAt(map, x, z);
    if (s.kind === 'building' || s.kind === 'road') continue;
    if ((s.segs ?? []).some((sg) => segHeight(heights, sg, x, z) > 0.5)) continue;
    if (onTrack(map, x, z, TREE_TRACK_CLEAR)) continue;
    byKind[t[i + 2]]?.push([x, z]);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color();
  const Y_UP = new THREE.Vector3(0, 1, 0);
  // 位置から決まる 0〜1 の値（同じ木は毎回同じ見た目）
  const hash = (x, z, k) => {
    const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const round = []; // 丸い木の置き方（冬のイルミネーション。addCity5Props）
  byKind.forEach((spots, k) => {
    if (!spots.length) return;
    // 幹と葉は別の立体（葉の色は季節で変える）
    for (const [geo, material] of [[treeModel.geos[k].trunk, TREE_MAT], [treeModel.geos[k].leaf, TREE_LEAF_MATS[k]]]) {
      const mesh = new THREE.InstancedMesh(geo, material, spots.length);
      spots.forEach(([x, z], i) => {
        const s = 0.8 + 0.4 * hash(x, z, 1);
        q.setFromAxisAngle(Y_UP, hash(x, z, 2) * Math.PI * 2);
        mesh.setMatrixAt(i, m.compose(pos.set(x, 0, z), q, scale.set(s, s * (0.9 + 0.2 * hash(x, z, 3)), s)));
        mesh.setColorAt(i, color.setScalar(0.85 + 0.25 * hash(x, z, 4)));
        if (k === 0 && material === TREE_MAT) round.push(m.clone());
      });
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  });
  group.userData.roundTrees = round;
}

// ---- 道ばたの物（Blender で作った街灯・自動販売機・電柱・ガードパイプ・バス停と、スタート・ゴールの門。tools/build-street.py） ----
const STREET_MODEL_URL = 'data/models/street.glb';
const STREET_MODEL_NAMES = {
  lightPole: 'SL_Pole', lightLens: 'SL_Lens', vending: 'VM_Body', vendingLight: 'VM_Light', utilityPole: 'UP_Pole', guard: 'GR_Pipe',
  busSign: 'BS_Sign', busShelter: 'BS_Shelter', gatePost: 'GT_Post', gateBeam: 'GT_Beam', gateStart: 'GT_Start', gateGoal: 'GT_Goal',
};
const streetModel = { geos: null, done: false };
loadModelParts(STREET_MODEL_URL, STREET_MODEL_NAMES)
  .then((parts) => {
    const geos = {};
    for (const [key, list] of Object.entries(parts)) geos[key] = addModelParts(new GeometryBuilder(true), list).build();
    streetModel.geos = geos;
  })
  .catch((e) => console.warn(`道ばたの物のモデルを読み込めませんでした: ${STREET_MODEL_URL}`, e))
  .finally(() => (streetModel.done = true));
const STREET_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const STREET_GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // 自動販売機の光る前の面

// ---- 歩く人の足：1 つの形にまとめた人のモデル（Blender の person など）から足を見つけ、腰を軸に前後に振る ----
// 足は「腰から下へ伸びる細い部品（もも・すね・靴）が続いていて、上に胴体がある」もの。台車やベビーカーの車輪、犬は振らない。
// 足の頂点に aLeg（左右 -1/+1・腰の高さ・腰の前後の位置・まっすぐ下へ戻す角度）を付け、頂点シェーダーで回す（ほかの頂点は aLeg.x = 0）。
// 走る形で作ったモデル（足を開いている）も、いったん足をまっすぐにしてから振る。
// 振る角度 rad は、1 つの物なら材質の uSwing（walkMaterial(false)）、InstancedMesh なら 1 人ごとの aSwing（walkMaterial(true)）
const walkGeos = new WeakMap(); // 元の形 → 足の印を付けた形（数と使い道ごと）
function findLegs(geo) {
  const P = geo.attributes.position.array, n = P.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a, b) => {
    (a = find(a)), (b = find(b));
    if (a !== b) parent[a] = b;
  };
  // 同じ位置の頂点と同じ三角形の頂点をつなぎ、ばらばらの部品（筒・楕円体など）に分ける
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(P[3 * i] * 1000)},${Math.round(P[3 * i + 1] * 1000)},${Math.round(P[3 * i + 2] * 1000)}`;
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i);
    else join(i, j);
    if (i % 3 === 2) join(i, i - 1), join(i, i - 2);
  }
  const comps = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], verts: [] }));
    c.verts.push(i);
    for (let k = 0; k < 3; k++) (c.min[k] = Math.min(c.min[k], P[3 * i + k])), (c.max[k] = Math.max(c.max[k], P[3 * i + k]));
  }
  const list = [...comps.values()];
  const size = (c, k) => c.max[k] - c.min[k];
  const limb = (c) => c.max[1] < 1.05 && size(c, 0) < 0.2 && size(c, 2) < 0.55;
  const limbs = list.filter(limb), others = list.filter((c) => !limb(c));
  // 重なる細い部品を 1 本の足にまとめる（もも＋すね＋靴）
  const touch = (a, b) => [0, 1, 2].every((k) => a.min[k] <= b.max[k] + 0.01 && b.min[k] <= a.max[k] + 0.01);
  const chains = [];
  for (const c of limbs) {
    const hit = chains.filter((ch) => ch.parts.some((d) => touch(c, d)));
    const merged = { parts: [c, ...hit.flatMap((ch) => ch.parts)] };
    for (const ch of hit) chains.splice(chains.indexOf(ch), 1);
    chains.push(merged);
  }
  const aLeg = new Float32Array(n * 4);
  let legs = 0;
  for (const ch of chains) {
    const top = Math.max(...ch.parts.map((c) => c.max[1])), bottom = Math.min(...ch.parts.map((c) => c.min[1]));
    if (bottom > 0.15 || top < 0.45 || top - bottom < 0.3) continue; // 子どもの腰より高くから地面まで届くものだけ（車輪や台車の柱は外す）
    let tx = 0, tz = 0, tn = 0;
    for (const c of ch.parts) for (const i of c.verts) if (P[3 * i + 1] > top - 0.05) (tx += P[3 * i]), (tz += P[3 * i + 2]), tn++;
    (tx /= tn), (tz /= tn);
    // 腰の上に胴体（幅のある部品）があること
    const torso = others.find((c) => size(c, 0) >= 0.2 && c.min[1] > top - 0.25 && c.min[1] < top + 0.4 &&
      tx > c.min[0] - 0.03 && tx < c.max[0] + 0.03 && tz > c.min[2] - 0.03 && tz < c.max[2] + 0.03);
    if (!torso) continue;
    const side = tx < (torso.min[0] + torso.max[0]) / 2 ? -1 : 1;
    // 足先（いちばん低い頂点）が腰の真下からどれだけ前後に出ているか（回す向きはシェーダーと同じ）
    let foot = ch.parts[0].verts[0];
    for (const c of ch.parts) for (const i of c.verts) if (P[3 * i + 1] < P[3 * foot + 1]) foot = i;
    const straighten = Math.atan2(P[3 * foot + 2] - tz, top - P[3 * foot + 1]);
    for (const c of ch.parts) for (const i of c.verts) aLeg.set([side, top, tz, straighten], 4 * i);
    legs++;
  }
  return { aLeg, legs };
}
// instances：InstancedMesh の数（0 なら 1 つの物）。aSwing は InstancedMesh ごとに別にするので、同じ形を使うときは use を変える
function walkingGeometry(geo, instances = 0, use = '') {
  let byCount = walkGeos.get(geo);
  if (!byCount) walkGeos.set(geo, (byCount = new Map()));
  const key = `${instances}:${use}`;
  let g = byCount.get(key);
  if (g) return g;
  g = geo.clone();
  g.setAttribute('aLeg', new THREE.BufferAttribute(findLegs(geo).aLeg, 4));
  if (instances) g.setAttribute('aSwing', new THREE.InstancedBufferAttribute(new Float32Array(instances), 1));
  byCount.set(key, g);
  return g;
}
function walkMaterial(instanced) {
  const m = STREET_MAT.clone();
  m.userData.swing = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSwing = m.userData.swing;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aLeg;\n${instanced ? 'attribute float aSwing;' : 'uniform float uSwing;'}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        if (aLeg.x != 0.0) {
          float a = aLeg.x * ${instanced ? 'aSwing' : 'uSwing'} + aLeg.w;
          vec2 d = transformed.yz - aLeg.yz;
          transformed.yz = aLeg.yz + vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
        }`,
      );
  };
  m.customProgramCacheKey = () => (instanced ? 'walk-instanced' : 'walk');
  return m;
}
// 足の振りを進める：歩いた距離 dist m で 2 歩（1 往復）が stride * 2 m。止まると少しずつ足をそろえる
function stepSwing(st, dist, stride = 0.7, angle = 0.45) {
  st.phase = (st.phase ?? Math.random() * 6) + (dist / (stride * 2)) * Math.PI * 2;
  st.amp = dist > 0.0005 ? Math.min(1, (st.amp ?? 0) + 0.15) : Math.max(0, (st.amp ?? 0) - 0.08);
  return Math.sin(st.phase) * st.amp * angle;
}

// 電柱：幅 POLE_ROAD_W の範囲の車道（住宅地の細い道）に、POLE_SPACING m おきに道の片側に立て、柱どうしを電線で結ぶ
const POLE_ROAD_W = [4, 8];
const POLE_SPACING = 30;
const POLE_WIRES = [[-0.92, 11.42], [0.3, 11.42], [0.92, 11.42], [-0.72, 10.62], [0.72, 10.62]]; // 碍子の上（柱からの横の位置・高さ）
const WIRE_SAG = 0.45; // 電線のたるみ m
// ガードパイプ：幅 GUARD_ROAD_W m 以上の車道の、交差点の手前 GUARD_FROM〜GUARD_TO m の両側に 4m ずつ
const GUARD_ROAD_W = 8;
const GUARD_FROM = 6;
const GUARD_TO = 22;
const GUARD_LEN = 4;
// 門：スタートとゴールの道をまたぐ。梁の高さは tools/build-street.py の GATE_H、幕の真ん中はその下
const GATE_BEAM_Y = 0;
const GATE_BANNER_Y = 5.2;

// 地点 (x, z) に物を置けるか：建物・車道の中、橋や高架の道の下、線路の近く、スタート・ゴールのまわりには置かない。
// onPath が false なら歩道や遊歩道の上にも置かない（自転車が走る所に、ぶつからない物が立たないように）
const FURNITURE_CLEAR_START = 15; // スタート・ゴールからこの距離 m までは置かない
function freeSpot(map, heights, x, z, onPath = true) {
  const s = surfaceAt(map, x, z);
  if (s.kind === 'building' || s.kind === 'road' || (!onPath && s.kind === 'path')) return false;
  if ((s.segs ?? []).some((sg) => segHeight(heights, sg, x, z) > 0.5)) return false;
  for (const pt of [map.start, map.goal]) if (Math.hypot(pt.x - x, pt.y - z) < FURNITURE_CLEAR_START) return false;
  return !onTrack(map, x, z, 4);
}

// 地点 (x, z) にいちばん近い道の中心線上の点（carOnly なら車道だけ）：{ x, z, d, road }
function nearestRoadPoint(map, x, z, carOnly) {
  let best = null;
  for (const r of map.roads) {
    if (carOnly && r.path) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], dx = r.p[i + 2] - ax, dz = r.p[i + 3] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { x: px, z: pz, d, road: r };
    }
  }
  return best;
}

// ローカルの +x を (tx, tz) の向きに向ける回転（rotation.y）
const faceTo = (tx, tz) => Math.atan2(-tz, tx);

function addStreetFurniture(group, map, heights) {
  const sm = streetModel.geos;
  if (!sm) return;
  const put = (list, x, z, h, angle) => list.push(new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(angle)));
  const poles = [], guards = [], vendings = [], signs = [], shelters = [];
  const wire = []; // 電線の線分の端 [x, y, z, ...]
  const isCrossing = (r, v) => (map.nodes.get(nodeKey(r.p[2 * v], r.p[2 * v + 1])) ?? []).some((n) => n.road !== r && !n.road.path);
  for (const r of map.roads) {
    if (r.path || r.e) continue;
    const n = r.p.length / 2;
    // 電柱と電線（道の左側。腕金は道を横切る向き）
    if (r.w >= POLE_ROAD_W[0] && r.w < POLE_ROAD_W[1]) {
      let next = POLE_SPACING / 2, walked = 0, prev = null;
      for (let i = 0; i + 1 < n; i++) {
        const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1e-6) continue;
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len, nx = -uz, nz = ux;
        while (next <= walked + len) {
          const t = (next - walked) / len, off = r.w / 2 + 0.4;
          const x = x1 + (x2 - x1) * t + nx * off, z = z1 + (z2 - z1) * t + nz * off;
          next += POLE_SPACING;
          if (!freeSpot(map, heights, x, z, false)) {
            prev = null;
            continue;
          }
          const angle = faceTo(-nx, -nz); // +x を道路の側へ
          put(poles, x, z, 0, angle);
          // 前の柱と電線で結ぶ（碍子の横の位置は道路の側が +）
          const here = POLE_WIRES.map(([ox, oy]) => [x - nx * ox, oy, z - nz * ox]);
          if (prev && Math.hypot(prev[0][0] - x, prev[0][2] - z) < POLE_SPACING * 1.6) {
            here.forEach((b, k) => {
              const a = prev[k];
              for (let q = 0; q < 6; q++) {
                const t0 = q / 6, t1 = (q + 1) / 6, sag = (t) => -4 * WIRE_SAG * t * (1 - t);
                wire.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 + sag(t0), a[2] + (b[2] - a[2]) * t0);
                wire.push(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 + sag(t1), a[2] + (b[2] - a[2]) * t1);
              }
            });
          }
          prev = here;
        }
        walked += len;
      }
    }
    // ガードパイプ：交差点（ほかの車道とつながる点）の手前の両側
    if (r.w >= GUARD_ROAD_W) {
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(r.p[2 * i] - r.p[2 * i - 2], r.p[2 * i + 1] - r.p[2 * i - 1]));
      const at = (d) => {
        let i = 1;
        while (i < n - 1 && cum[i] < d) i++;
        const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const ax = r.p[2 * i - 2], az = r.p[2 * i - 1], bx = r.p[2 * i], bz = r.p[2 * i + 1];
        const l = Math.hypot(bx - ax, bz - az) || 1;
        return [ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / l, (bz - az) / l];
      };
      for (let v = 0; v < n; v++) {
        if (!isCrossing(r, v)) continue;
        for (const dir of [1, -1]) {
          for (let d = GUARD_FROM + GUARD_LEN / 2; d <= GUARD_TO; d += GUARD_LEN) {
            const dd = cum[v] + dir * d;
            if (dd < 0 || dd > cum[n - 1]) break;
            const [cx, cz, ux, uz] = at(dd);
            for (const side of [-1, 1]) {
              const off = r.w / 2 + 0.25;
              const x = cx - uz * off * side, z = cz + ux * off * side;
              if (!freeSpot(map, heights, x, z)) continue;
              put(guards, x, z, 0, faceTo(uz * side, -ux * side)); // +x を道路の側へ。ガードパイプは Y（ローカルの z）に沿う
            }
          }
        }
      }
    }
  }
  // 自動販売機：近くの道に前を向ける（道の上の点は道の端まで下げる）
  const vend = map.vending ?? [];
  for (let i = 0; i < vend.length; i += 2) {
    let x = vend[i], z = vend[i + 1];
    const near = nearestRoadPoint(map, x, z, false);
    if (!near) continue;
    let vx = x - near.x, vz = z - near.z;
    const l = Math.hypot(vx, vz) || 1;
    if (near.d < near.road.w / 2 + 0.5) (x = near.x + (vx / l) * (near.road.w / 2 + 0.5)), (z = near.z + (vz / l) * (near.road.w / 2 + 0.5));
    if (!freeSpot(map, heights, x, z, false)) continue;
    put(vendings, x, z, 0, faceTo(-vx / l, -vz / l));
  }
  // バス停：近くの車道の端に標識を立て、広い道なら後ろに屋根とベンチ
  const stops = map.stops ?? [];
  for (let i = 0; i < stops.length; i += 2) {
    const near = nearestRoadPoint(map, stops[i], stops[i + 1], true);
    if (!near || near.d > near.road.w / 2 + 15) continue;
    let vx = stops[i] - near.x, vz = stops[i + 1] - near.z;
    const l = Math.hypot(vx, vz);
    if (l < 0.01) continue; // 道の真ん中の点は、どちら側か分からない
    (vx /= l), (vz /= l);
    // 道の端から外へ、歩道の外側の空いている所を探す
    const off = [0.6, 1.5, 2.5, 3.5, 4.5].map((d) => near.road.w / 2 + d).find((d) => freeSpot(map, heights, near.x + vx * d, near.z + vz * d, false));
    if (off == null) continue;
    const sx = near.x + vx * off, sz = near.z + vz * off;
    const angle = faceTo(-vx, -vz);
    put(signs, sx, sz, 0, angle);
    const hx = sx + vx * 1.4, hz = sz + vz * 1.4;
    if (near.road.w >= GUARD_ROAD_W && freeSpot(map, heights, hx, hz, false) && freeSpot(map, heights, hx + vx * 0.8, hz + vz * 0.8, false)) put(shelters, hx, hz, 0, angle);
  }
  const instanced = (geo, material, list, shadow = true) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = shadow;
    group.add(mesh);
  };
  instanced(sm.utilityPole, STREET_MAT, poles);
  instanced(sm.guard, STREET_MAT, guards, false);
  instanced(sm.vending, STREET_MAT, vendings);
  instanced(sm.vendingLight, STREET_GLOW_MAT, vendings, false);
  instanced(sm.busSign, STREET_MAT, signs);
  instanced(sm.busShelter, STREET_MAT, shelters);
  if (wire.length) {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1c1d21 })));
  }
  group.userData.wireSegs = wire; // 電線にとまるカラス（addCity5Props）
}

// 門を置く道の向きと道幅の半分：地点 (x, y) を通る道（交差点ならつながる道すべて）のうち、進む向き heading にいちばん沿う道
function gatePose(map, x, y, heading) {
  const segs = [];
  for (const { road, v } of map.nodes.get(nodeKey(x, y)) ?? []) {
    for (const u of [v - 1, v + 1]) if (u >= 0 && u < road.p.length / 2) segs.push([road.p[2 * u] - x, road.p[2 * u + 1] - y, road]);
  }
  for (const sg of surfaceAt(map, x, y).segs ?? []) segs.push([sg.x2 - sg.x1, sg.y2 - sg.y1, sg.road]);
  let best = null, bestDot = -1;
  for (const [dx, dy, road] of segs) {
    const dot = Math.abs(Math.cos(Math.atan2(dx, -dy) - heading));
    if (dot > bestDot) (bestDot = dot), (best = { angle: Math.atan2(dx, -dy), hw: road.w / 2 });
  }
  return best ?? { angle: heading, hw: 4 };
}

// ---- コンビニの店先（Blender で作った店先と看板。tools/build-shops.py） ----
// 地図データのコンビニ（map.shops：[x, y, 店の種類, ...]。OpenStreetMap）の建物の、道にいちばん近い壁の 1 階に付ける。
// 看板は店の種類ごとの色の帯だけ（店の名前やロゴは描かない）。店の中と看板は光って見える
const SHOP_MODEL_URL = 'data/models/shops.glb';
const SHOP_MODEL_NAMES = { front: 'SF_Front', sign0: 'SF_Sign0', sign1: 'SF_Sign1', sign2: 'SF_Sign2', sign3: 'SF_Sign3', sign4: 'SF_Sign4' };
const SHOP_W = 8; // 店先の幅 m（tools/build-shops.py の W）
const SHOP_MIN_H = 3.8; // これより低い建物には付けない
const shopModel = { geos: null, done: false };
loadModelParts(SHOP_MODEL_URL, SHOP_MODEL_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {
      front: addModelParts(new GeometryBuilder(true), parts.front, (part) => (isLight(part) ? null : part.color)).build(),
      frontGlow: addModelParts(new GeometryBuilder(true), parts.front, (part) => (isLight(part) ? part.color : null)).build(),
    };
    for (let k = 0; k <= 4; k++) geos[`sign${k}`] = addModelParts(new GeometryBuilder(true), parts[`sign${k}`]).build();
    shopModel.geos = geos;
  })
  .catch((e) => console.warn(`コンビニのモデルを読み込めませんでした: ${SHOP_MODEL_URL}`, e))
  .finally(() => (shopModel.done = true));

function addShops(group, map, buildingHeights) {
  const sm = shopModel.geos;
  const shops = map.shops ?? [];
  if (!sm || !shops.length) return;
  const fronts = [], signs = [[], [], [], [], []];
  const used = new Set(); // 店先を付けた壁（建物の番号:辺の番号）
  for (let i = 0; i < shops.length; i += 3) {
    const x = shops[i], z = shops[i + 1], kind = shops[i + 2];
    // 店のある建物：点を含む建物、なければ 12m 以内でいちばん近い壁の建物
    const cands = new Set();
    for (const dx of [-CELL, 0, CELL]) for (const dz of [-CELL, 0, CELL]) for (const b of map.cells.get(cellKey(x + dx, z + dz))?.buildings ?? []) cands.add(b);
    let bd = null, bdD = 12;
    for (const b of cands) {
      if (insidePolygon(x, z, b.p)) {
        bd = b;
        break;
      }
      const ring = openRing(b.p);
      for (let k = 0; k < ring.length; k += 2) {
        const ax = ring[k], az = ring[k + 1], bx = ring[(k + 2) % ring.length], bz = ring[(k + 3) % ring.length];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < bdD) (bdD = d), (bd = b);
      }
    }
    if (!bd || !(buildingHeights[bd.id] >= SHOP_MIN_H)) continue;
    // 道にいちばん近い壁（長さ 4.5m 以上）。外向きは、壁の真ん中から少し外が建物の外になる向き
    const ring = openRing(bd.p);
    let best = null;
    for (let k = 0; k < ring.length; k += 2) {
      const ax = ring[k], az = ring[k + 1], bx = ring[(k + 2) % ring.length], bz = ring[(k + 3) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 4.5 || used.has(`${bd.id}:${k}`)) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      let nx = uz, nz = -ux;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (insidePolygon(mx + nx * 0.3, mz + nz * 0.3, bd.p)) (nx = -nx), (nz = -nz);
      const road = nearestRoadPoint(map, mx + nx * 3, mz + nz * 3, false);
      const score = (road ? road.d : 50) + 0.3 * Math.hypot(x - mx, z - mz);
      if (!best || score < best.score) best = { score, k, ax, az, ux, uz, nx, nz, len };
    }
    if (!best) continue;
    used.add(`${bd.id}:${best.k}`);
    const w = Math.min(SHOP_W, best.len - 0.4);
    const t = Math.max(w / 2, Math.min(best.len - w / 2, (x - best.ax) * best.ux + (z - best.az) * best.uz));
    const m = new THREE.Matrix4()
      .makeTranslation(best.ax + best.ux * t + best.nx * 0.04, 0, best.az + best.uz * t + best.nz * 0.04)
      .multiply(new THREE.Matrix4().makeRotationY(faceTo(best.nx, best.nz)))
      .multiply(new THREE.Matrix4().makeScale(1, 1, w / SHOP_W));
    fronts.push(m);
    signs[kind in signs ? kind : 0].push(m);
  }
  const instanced = (geo, material, list, name = '') => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.name = name; // デバッグ・自動テスト用
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
  };
  instanced(sm.front, STREET_MAT, fronts, 'shopFronts');
  instanced(sm.frontGlow, STREET_GLOW_MAT, fronts);
  signs.forEach((list, k) => instanced(sm[`sign${k}`], STREET_GLOW_MAT, list));
}

// ---- 街の小物・名物・踏切（Blender で作ったモデル。tools/build-town.py） ----
// 道路標識とカーブミラー・郵便ポスト・消火栓の標識・駐輪場・工事中の所のコーンとバリケード・屋上の物・歩道橋の手すりと橋げた・
// 踏切（山手線でただ 1 つの第二中里踏切）・駅の近くの名物。どれも見た目だけ（自転車とはぶつからない）
const TOWN_MODEL_URL = 'data/models/town.glb';
const TOWN_MODEL_NAMES = {
  stop: 'TS_Stop', speed30: 'TS_Speed30', speed40: 'TS_Speed40', oneWay: 'TS_OneWay', mirror: 'TS_Mirror',
  post: 'PB_Post', hydrant: 'HY_Sign', bikeRack: 'BP_Rack', cone: 'CN_Cone', barricade: 'BR_Barricade',
  tank: 'RT_Tank', ac: 'RT_AC', antenna: 'RT_Antenna', billboard: 'RT_Billboard', rail: 'FB_Rail', girder: 'FB_Girder',
  lcPost: 'LC_Post', lcLampL: 'LC_LampL', lcLampR: 'LC_LampR', lcArm: 'LC_Arm',
  hachiko: 'LM_Hachiko', torii: 'LM_Torii', takeshita: 'LM_Takeshita', ameyoko: 'LM_Ameyoko', sugamo: 'LM_Sugamo',
  scooter: 'MB_Scooter', motorbike: 'MB_Motorbike',
};
const townModel = { geos: null, done: false }; // 名前 → { body, glow }（glow は光る部品。なければ null）
loadModelParts(TOWN_MODEL_URL, TOWN_MODEL_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    townModel.geos = geos;
  })
  .catch((e) => console.warn(`街の小物のモデルを読み込めませんでした: ${TOWN_MODEL_URL}`, e))
  .finally(() => (townModel.done = true));

// 緯度・経度 → 区間の地図の座標（tools/fetch-osm.mjs の toXY と同じ）
function latLonXY(map, lat, lon) {
  const o = map.origin;
  return [(lon - o.lon) * 111320 * Math.cos((o.lat * Math.PI) / 180), -(lat - o.lat) * 110540];
}
const inBounds = (map, x, y) => x >= map.bounds.minX && x <= map.bounds.maxX && y >= map.bounds.minY && y <= map.bounds.maxY;

// 駅の近くの名物（OpenStreetMap の位置）。kind：'gate' は道をまたぐ（門の通る向きを道に合わせる）、'face' は向き（北が 0、時計回り）
const TOWN_LANDMARKS = [
  { key: 'hachiko', lat: 35.6590597, lon: 139.7006279, face: 0.9 }, // 忠犬ハチ公像（駅のハチ公口の方を向く）
  { key: 'torii', lat: 35.6740966, lon: 139.7013085, gate: true }, // 明治神宮の大鳥居（南参道）
  { key: 'takeshita', lat: 35.67138, lon: 139.70335, gate: true }, // 竹下通りの入口（原宿駅竹下口の前）
  { key: 'ameyoko', lat: 35.709991, lon: 139.7746022, gate: true }, // アメ横の門（時計付き）
  { key: 'ameyoko', lat: 35.7080314, lon: 139.7746438, gate: true },
  { key: 'sugamo', lat: 35.7355301, lon: 139.7351714, gate: true }, // 巣鴨地蔵通り商店街の入口
];
// 踏切：山手線でただ 1 つの第二中里踏切（駒込〜田端）
const LEVEL_CROSSINGS = [{ lat: 35.739117, lon: 139.752603 }];
const CROSSING_NEAR_M = 160; // 電車がこの距離まで来たら遮断機を下ろす
const ARM_UP = 1.45; // 上げた遮断機の角度 rad

// ローカルの +x を向き a（北が 0、時計回り。angle と同じ）に向ける回転（rotation.y）
const turnTo = (a) => faceTo(Math.sin(a), -Math.cos(a));

function addTownProps(group, map, roadHeights, buildingHeights) {
  const tm = townModel.geos;
  if (!tm) return;
  const lists = {}; // 名前 → 置く行列
  const put = (key, x, h, z, rotY, sz = 1, sy = 1) => {
    const m = new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(rotY));
    if (sz !== 1 || sy !== 1) m.multiply(new THREE.Matrix4().makeScale(1, sy, sz));
    (lists[key] ??= []).push(m);
  };
  const carRoad = (r) => !r.path && !r.e;
  // ---- 交差点：止まれ（細い道から広い道に出る所）・カーブミラー（細い道どうし） ----
  const seen = new Set();
  for (const [key, list] of map.nodes) {
    const cars = list.filter((n) => carRoad(n.road));
    const roads = new Set(cars.map((n) => n.road));
    if (roads.size < 2 || seen.has(key)) continue;
    seen.add(key);
    const [x, z] = key.split(',').map(Number);
    const arms = []; // この点から出る道の向き
    for (const { road, v } of cars) {
      for (const u of [v - 1, v + 1]) {
        if (u < 0 || u >= road.p.length / 2) continue;
        const dx = road.p[2 * u] - road.p[2 * v], dz = road.p[2 * u + 1] - road.p[2 * v + 1], l = Math.hypot(dx, dz) || 1;
        arms.push({ road, ux: dx / l, uz: dz / l, len: l, incoming: !road.o || (road.o === 1) === (u < v) });
      }
    }
    const widest = Math.max(...arms.map((a) => a.road.w));
    for (const a of arms) {
      if (a.road.w >= 8 || a.road.w + 2 > widest || !a.incoming || a.len < 8) continue;
      // 止まれ：交差点の 4m 手前、道の左端（入ってくる車から見て左）。看板は入ってくる車の方を向く
      const sx = x + a.ux * 4 - a.uz * (a.road.w / 2 + 0.5), sz = z + a.uz * 4 + a.ux * (a.road.w / 2 + 0.5);
      if (freeSpot(map, roadHeights, sx, sz, false)) put('stop', sx, 0, sz, faceTo(a.ux, a.uz));
    }
    // カーブミラー：細い道どうしの交差点の角に 1 本（2 本の道のあいだの外側から、交差点の方を向く）
    if (widest < 6 && arms.length >= 3) {
      const [a, b] = arms;
      let cx = a.ux + b.ux, cz = a.uz + b.uz;
      const l = Math.hypot(cx, cz);
      if (l > 0.3) {
        (cx /= l), (cz /= l);
        const d = widest / 2 + 1.5;
        if (freeSpot(map, roadHeights, x + cx * d, z + cz * d, false)) put('mirror', x + cx * d, 0, z + cz * d, faceTo(-cx, -cz));
      }
    }
  }
  // ---- 道に沿う標識：最高速度（広い道は 40、細い道は 30。道の左端に、進む向きの車の方を向く）と一方通行 ----
  for (const r of map.roads) {
    if (!carRoad(r) || r.w < 4) continue;
    const spacing = r.w >= 8 ? 260 : 320;
    let next = spacing / 2, walked = 0;
    const n = r.p.length / 2;
    for (let i = 0; i + 1 < n; i++) {
      const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      while (next <= walked + len) {
        const t = (next - walked) / len;
        next += spacing;
        for (const dir of r.o ? [r.o] : [1, -1]) {
          const dx = ux * dir, dz = uz * dir, off = r.w / 2 + 0.5;
          const sx = x1 + (x2 - x1) * t + dz * off, sz = z1 + (z2 - z1) * t - dx * off; // 進む向きの左
          if (freeSpot(map, roadHeights, sx, sz, false)) put(r.w >= 8 ? 'speed40' : 'speed30', sx, 0, sz, faceTo(-dx, -dz));
        }
        if (r.o) {
          // 一方通行：道に平行な板で、矢印は進む向き。道の左の端（最高速度の標識の 6m 先）に、道の方を向けて立てる
          const dx = ux * r.o, dz = uz * r.o, off = r.w / 2 + 0.5;
          const sx = x1 + (x2 - x1) * t + dz * off + dx * 6, sz = z1 + (z2 - z1) * t - dx * off + dz * 6;
          if (freeSpot(map, roadHeights, sx, sz, false)) put('oneWay', sx, 0, sz, faceTo(-dz, dx));
        }
      }
      walked += len;
    }
  }
  // ---- 地図データの小物：道の端の外側の空いている所に、道の方を向けて置く ----
  const atRoadSide = (x, z, key, carOnly = false) => {
    const near = nearestRoadPoint(map, x, z, carOnly);
    if (!near || near.d > near.road.w / 2 + 20) return;
    let vx = x - near.x, vz = z - near.z;
    const l = Math.hypot(vx, vz);
    if (l < 0.01) return;
    (vx /= l), (vz /= l);
    const off = [0.6, 1.5, 2.5, 3.5].map((d) => near.road.w / 2 + d).find((d) => freeSpot(map, roadHeights, near.x + vx * d, near.z + vz * d, false));
    if (off == null) return;
    put(key, near.x + vx * off, 0, near.z + vz * off, faceTo(-vx, -vz));
  };
  const pairs = (a, fn) => {
    for (let i = 0; i + 1 < (a?.length ?? 0); i += 2) fn(a[i], a[i + 1]);
  };
  pairs(map.posts, (x, z) => atRoadSide(x, z, 'post'));
  pairs(map.hydrants, (x, z) => atRoadSide(x, z, 'hydrant'));
  pairs(map.bikeParks, (x, z) => atRoadSide(x, z, 'bikeRack'));
  // 工事中の所：近くの道の端にコーンを並べ、両端にバリケード
  pairs(map.works, (x, z) => {
    const near = nearestRoadPoint(map, x, z, false);
    if (!near || near.d > near.road.w / 2 + 25) return;
    const r = near.road;
    let vx = x - near.x, vz = z - near.z;
    const l = Math.hypot(vx, vz) || 1;
    (vx /= l), (vz /= l);
    const ux = -vz, uz = vx; // 道に沿う向き
    const off = r.w / 2 - 0.3;
    for (let k = -3; k <= 3; k++) {
      const cx = near.x + vx * off + ux * k * 1.6, cz = near.z + vz * off + uz * k * 1.6;
      const s = surfaceAt(map, cx, cz);
      if (s.kind === 'building' || (s.segs ?? []).some((sg) => segHeight(roadHeights, sg, cx, cz) > 0.5) || onTrack(map, cx, cz, 4)) continue;
      if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - cx, pt.y - cz) < FURNITURE_CLEAR_START)) continue;
      put(Math.abs(k) === 3 ? 'barricade' : 'cone', cx, 0, cz, faceTo(-vx, -vz));
    }
  });
  // ---- 屋上の物：高さ 10m 以上・広さ 200m² 以上の建物に、建物ごとに決まった物を 0〜2 個 ----
  map.buildings.forEach((bd, i) => {
    const h = buildingHeights[i];
    if (!(h >= 10)) return;
    const ring = openRing(bd.p);
    const area = Math.abs(polygonArea(ring));
    if (area < 200) return;
    let cx = 0, cz = 0;
    for (let k = 0; k < ring.length; k += 2) (cx += ring[k]), (cz += ring[k + 1]);
    (cx /= ring.length / 2), (cz /= ring.length / 2);
    // いちばん長い辺の向きにそろえる
    let best = 0, ang = 0;
    for (let k = 0; k < ring.length; k += 2) {
      const dx = ring[(k + 2) % ring.length] - ring[k], dz = ring[(k + 3) % ring.length] - ring[k + 1];
      if (Math.hypot(dx, dz) > best) (best = Math.hypot(dx, dz)), (ang = faceTo(dx, dz));
    }
    const hash = (k) => {
      const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const spots = [[cx, cz]];
    const off = Math.min(6, Math.sqrt(area) / 4);
    spots.push([cx + Math.cos(-ang) * off, cz + Math.sin(-ang) * off]);
    const items = [];
    if (hash(1) < 0.35) items.push('tank');
    if (hash(2) < 0.55) items.push('ac');
    if (h >= 35 && hash(3) < 0.3) items.push('antenna');
    if (hash(4) < 0.08 && area > 300) items.push('billboard');
    items.slice(0, 2).forEach((key, k) => {
      const [x, z] = spots[k];
      if (!insidePolygon(x, z, bd.p)) return;
      if (key === 'billboard') {
        const near = nearestRoadPoint(map, x, z, true);
        put(key, x, h, z, near ? faceTo(near.x - x, near.z - z) : ang);
      } else put(key, x, h, z, ang);
    });
  });
  // ---- 歩道橋：高い歩道の橋（高さ 3m 以上）の両側に手すり、外側に橋げたの板 ----
  for (const r of map.roads) {
    if (!r.path || !(r.e >= 3)) continue;
    const n = r.p.length / 2;
    for (let i = 0; i + 1 < n; i++) {
      const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const steps = Math.ceil(len / 2);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const h = roadHeightAt(roadHeights, r, i, t);
        if (h < 3) continue;
        const mx = x1 + (x2 - x1) * t, mz = z1 + (z2 - z1) * t;
        for (const side of [-1, 1]) {
          const nx = -uz * side, nz = ux * side; // 外向き
          const ex = mx + nx * (r.w / 2), ez = mz + nz * (r.w / 2);
          put('rail', ex - nx * 0.05, h + Y.path, ez - nz * 0.05, faceTo(nx, nz), len / steps);
          put('girder', ex + nx * 0.02, h + Y.path, ez + nz * 0.02, faceTo(nx, nz), len / steps);
        }
      }
    }
  }
  // ---- 駅の近くの名物 ----
  for (const lm of TOWN_LANDMARKS) {
    const [x, z] = latLonXY(map, lm.lat, lm.lon);
    if (!inBounds(map, x, z)) continue;
    let rot = lm.face != null ? turnTo(lm.face) - Math.PI / 2 : 0; // 名物の前（Blender の +Y）を向き face へ
    if (lm.gate) {
      // 門は、いちばん近い道（歩道を含む）を通る向きにまたぐ
      const near = nearestRoadPoint(map, x, z, false);
      if (near) {
        const r = near.road;
        let bi = 0, bd = Infinity;
        for (let k = 0; k + 3 < r.p.length; k += 2) {
          const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - near.x, (r.p[k + 1] + r.p[k + 3]) / 2 - near.z);
          if (d < bd) (bd = d), (bi = k);
        }
        rot = faceTo(r.p[bi + 2] - r.p[bi], r.p[bi + 3] - r.p[bi + 1]) - Math.PI / 2;
      }
    }
    const geo = tm[lm.key];
    const mesh = new THREE.Mesh(geo.body, STREET_MAT);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rot;
    mesh.castShadow = true;
    group.add(mesh);
  }
  // まとめて描く
  for (const [key, list] of Object.entries(lists)) {
    const g = tm[key];
    for (const [geo, material] of [[g.body, STREET_MAT], [g.glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && !['rail', 'girder'].includes(key);
      group.add(mesh);
    }
  }
  // ---- 踏切（遮断機と灯は、電車が近づくと動かす。group.userData.crossings） ----
  group.userData.crossings = [];
  for (const lc of LEVEL_CROSSINGS) {
    const [x, z] = latLonXY(map, lc.lat, lc.lon);
    if (!inBounds(map, x, z)) continue;
    const near = nearestRoadPoint(map, x, z, true);
    if (!near || near.d > 15) continue;
    const r = near.road;
    let bi = 0, bd = Infinity;
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - near.x, (r.p[k + 1] + r.p[k + 3]) / 2 - near.z);
      if (d < bd) (bd = d), (bi = k);
    }
    let ux = r.p[bi + 2] - r.p[bi], uz = r.p[bi + 3] - r.p[bi + 1];
    const ul = Math.hypot(ux, uz) || 1;
    (ux /= ul), (uz /= ul);
    // 線路の幅：踏切のまわり 25m の線路の点を、道の向きに測った範囲
    let lo = -4, hi = 4;
    for (const l of map.lines) {
      if (l.k === 'river') continue;
      for (let k = 0; k < l.p.length; k += 2) {
        const dx = l.p[k] - near.x, dz = l.p[k + 1] - near.z;
        if (Math.hypot(dx, dz) > 25) continue;
        const along = dx * ux + dz * uz, side = Math.abs(-dx * uz + dz * ux);
        if (side < 12) (lo = Math.min(lo, along)), (hi = Math.max(hi, along));
      }
    }
    const units = [];
    for (const [along, dir] of [[lo - 3, -1], [hi + 3, 1]]) {
      // 警報機は、線路から離れる向き（dir）を前にして道の端に立ち、遮断機の棒は道を横切る
      const fx = ux * dir, fz = uz * dir;
      const ax = fz, az = -fx; // ローカルの -z（棒の伸びる向き）
      const px = near.x + ux * along - ax * (r.w / 2 + 0.4), pz = near.z + uz * along - az * (r.w / 2 + 0.4);
      const unit = new THREE.Group();
      unit.position.set(px, 0, pz);
      unit.rotation.y = faceTo(fx, fz);
      const mk = (geo, material) => {
        const m = new THREE.Mesh(geo, material);
        unit.add(m);
        return m;
      };
      mk(tm.lcPost.body, STREET_MAT).castShadow = true;
      const lamps = [mk(tm.lcLampL.glow, STREET_GLOW_MAT), mk(tm.lcLampR.glow, STREET_GLOW_MAT)];
      const arm = new THREE.Group();
      arm.position.set(0, 0.95, -0.35);
      const stick = new THREE.Mesh(tm.lcArm.body, STREET_MAT);
      stick.scale.set(1, 1, r.w - 0.6); // 棒は道幅に合わせる（Blender の +Y＝ローカルの -z へ伸びる）
      arm.add(stick);
      arm.rotation.x = ARM_UP;
      unit.add(arm);
      group.add(unit);
      units.push({ lamps, arm });
    }
    group.userData.crossings.push({ x: near.x, z: near.z, units, closed: 0 });
  }
}

// ---- 線路のまわり・川と橋・空を飛ぶ物（Blender で作ったモデル。tools/build-scenery.py） ----
// 線路の柵（地面の高さの線路の外側）と信号機（山手線の線路の左）、橋の欄干（車道の橋の両側）、川に浮かぶ船、
// 空の飛行機・ヘリコプター・鳥。どれも見た目だけ（自転車とはぶつからない）
const SCENERY_URL = 'data/models/scenery.glb';
const SCENERY_NAMES = {
  fence: 'RF_Fence', signal: 'RS_Signal', signalLamp: 'RS_Lamp', bridgeRail: 'BR_Rail', boat: 'BT_Boat', yakata: 'BT_Yakata',
  plane: 'SK_Plane', heli: 'SK_Heli', rotor: 'SK_Rotor', birdBody: 'BD_Body', birdWingL: 'BD_WingL', birdWingR: 'BD_WingR',
};
const scenery = { geos: null, done: false }; // 名前 → { body, glow }
loadModelParts(SCENERY_URL, SCENERY_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    scenery.geos = geos;
  })
  .catch((e) => console.warn(`線路のまわり・川・空の物のモデルを読み込めませんでした: ${SCENERY_URL}`, e))
  .finally(() => (scenery.done = true));
const FENCE_OFF = 3.2; // 線路の中心から柵までの距離 m
const FENCE_STATION_CLEAR = 140; // 駅のまわりこの距離 m には柵を立てない（ホームがあるので）
const SIGNAL_SPACING = 450;
const BOAT_SPACING = 220;

function addRailsideAndRivers(group, map, roadHeights) {
  const g = scenery.geos;
  if (!g) return;
  const lists = {};
  const put = (key, x, h, z, rotY, sz = 1) => {
    const m = new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(rotY));
    if (sz !== 1) m.multiply(new THREE.Matrix4().makeScale(1, 1, sz));
    (lists[key] ??= []).push(m);
  };
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station');
  const nearStation = (x, z, d) => stations.some((st) => Math.hypot(st.x - x, st.y - z) < d);
  // 線路の線分の空間の索引（20m 四方）
  const tracks = map.lines.filter((l) => l.k !== 'river' && !l.u);
  const grid = new Map();
  const G = 20;
  for (const l of tracks) {
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const sg = [l.p[i], l.p[i + 1], l.p[i + 2], l.p[i + 3], l];
      for (let gx = Math.floor(Math.min(sg[0], sg[2]) / G) - 1; gx <= Math.floor(Math.max(sg[0], sg[2]) / G) + 1; gx++) {
        for (let gz = Math.floor(Math.min(sg[1], sg[3]) / G) - 1; gz <= Math.floor(Math.max(sg[1], sg[3]) / G) + 1; gz++) {
          const k = `${gx},${gz}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(sg);
        }
      }
    }
  }
  const nearTrack = (x, z, d, except) =>
    (grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []).some(([ax, az, bx, bz, l]) => {
      if (l === except) return false;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      return Math.hypot(x - ax - dx * t, z - az - dz * t) < d;
    });
  // ---- 線路の柵：地面の高さの線路の両側。となりにほかの線路があれば、その側は内側なので立てない ----
  for (const l of tracks) {
    if (l.e) continue;
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const steps = Math.ceil(len / 3);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const mx = x1 + (x2 - x1) * t, mz = z1 + (z2 - z1) * t;
        if (nearStation(mx, mz, FENCE_STATION_CLEAR)) continue;
        for (const side of [-1, 1]) {
          const nx = -uz * side, nz = ux * side;
          const fx = mx + nx * FENCE_OFF, fz = mz + nz * FENCE_OFF;
          if (nearTrack(fx, fz, FENCE_OFF - 0.4, l)) continue; // 外側だけ
          const sf = surfaceAt(map, fx, fz);
          if (sf.kind !== 'ground') continue; // 道（踏切・線路をくぐる道）や建物の中には立てない
          put('fence', fx, 0, fz, faceTo(-nx, -nz), len / steps);
        }
      }
    }
  }
  // ---- 線路の信号機：山手線の線路の左に、SIGNAL_SPACING m おき（駅のまわりは除く） ----
  for (const l of tracks) {
    if (l.k !== 'yamanote') continue;
    let next = SIGNAL_SPACING / 2, walked = 0;
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      while (next <= walked + len) {
        const t = (next - walked) / len;
        next += SIGNAL_SPACING;
        const sx = x1 + (x2 - x1) * t + uz * 2.4, sz = z1 + (z2 - z1) * t - ux * 2.4; // 進む向きの左
        if (nearStation(sx, sz, 80) || nearTrack(sx, sz, 1.8, l)) continue;
        put('signal', sx, (l.e ? ELEVATED_H : 0) + Y.rail, sz, faceTo(-ux, -uz));
      }
      walked += len;
    }
  }
  // ---- 橋の欄干：車道の橋（高さ 0.5m 以上の所）の両側 ----
  for (const r of map.roads) {
    if (!r.e || r.path) continue;
    for (let i = 0; i + 1 < r.p.length / 2; i++) {
      const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const steps = Math.ceil(len / 2);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const h = roadHeightAt(roadHeights, r, i, t);
        if (h < 0.5) continue;
        const mx = x1 + (x2 - x1) * t, mz = z1 + (z2 - z1) * t;
        for (const side of [-1, 1]) {
          const nx = -uz * side, nz = ux * side;
          const ex = mx + nx * (r.w / 2 - 0.1), ez = mz + nz * (r.w / 2 - 0.1);
          // となりに同じ高さの道（歩道の橋など）が続いていれば、そちらの外に立つので立てない
          const seg = surfaceAt(map, ex + nx * 0.6, ez + nz * 0.6).segs ?? [];
          if (seg.some((sg) => sg.road !== r && Math.abs(segHeight(roadHeights, sg, ex, ez) - h) < 0.6)) continue;
          put('bridgeRail', ex, h + Y.road, ez, faceTo(nx, nz), len / steps);
        }
      }
    }
  }
  // ---- 川の船：川の線に沿って BOAT_SPACING m おき、岸寄りに（小さな船と屋形船を交互に） ----
  let boatNo = 0;
  for (const l of map.lines) {
    if (l.k !== 'river' || l.w < 8) continue;
    let next = BOAT_SPACING / 2, walked = 0;
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      while (next <= walked + len) {
        const t = (next - walked) / len;
        next += BOAT_SPACING;
        const side = boatNo % 2 ? 1 : -1;
        const bx = x1 + (x2 - x1) * t - uz * side * (l.w / 2 - 2.2), bz = z1 + (z2 - z1) * t + ux * side * (l.w / 2 - 2.2);
        if ((surfaceAt(map, bx, bz).segs ?? []).length) continue; // 橋の下には置かない
        put(boatNo % 2 ? 'yakata' : 'boat', bx, Y.river, bz, faceTo(ux, uz) - Math.PI / 2);
        boatNo++;
      }
      walked += len;
    }
  }
  for (const [key, list] of Object.entries(lists)) {
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && key !== 'fence';
      group.add(mesh);
    }
  }
  // 信号機の灯（灯の板は信号機と同じ置き方）
  if (lists.signal && g.signalLamp.glow) {
    const mesh = new THREE.InstancedMesh(g.signalLamp.glow, STREET_GLOW_MAT, lists.signal.length);
    lists.signal.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
  }
}

// ---- 街の小物 その 2（Blender で作ったモデル。tools/build-city.py） ----
// 歌舞伎町一番街のアーチ、ガード下の店（有楽町・新橋・神田・御徒町の高架の下）、繁華街の夜のネオン、公園の物、歩行者の持ち物。
// どれも見た目だけ（自転車とはぶつからない）
const CITY_URL = 'data/models/city.glb';
const CITY_NAMES = {
  kabukicho: 'CT_Kabukicho', guard0: 'CT_Guard0', guard1: 'CT_Guard1', guard2: 'CT_Guard2', neonV: 'CT_NeonV', neonBand: 'CT_NeonBand',
  bench: 'CT_Bench', play: 'CT_Play', fountain: 'CT_Fountain', toilet: 'CT_Toilet',
  briefcase: 'CT_Briefcase', backpack: 'CT_Backpack', suitcase: 'CT_Suitcase', dog: 'CT_Dog', tie: 'CT_Tie',
};
const cityModel = { geos: null, done: false }; // 名前 → { body, glow }
loadModelParts(CITY_URL, CITY_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    cityModel.geos = geos;
  })
  .catch((e) => console.warn(`街の小物（その 2）のモデルを読み込めませんでした: ${CITY_URL}`, e))
  .finally(() => (cityModel.done = true));
// 夜のネオン（時間帯で明るさを変える。昼は少し暗く）
const NEON_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const NEON_COLORS = [0xff3fa4, 0x3fe0ff, 0xffe03f, 0xff8a3f, 0x6aff6a, 0xb06bff, 0xff3a3a, 0xf4f4f4];
// 繁華街（この中の高さ 12m 以上の建物に、縦の看板と光る帯を付ける）：緯度・経度と半径 m
const NEON_DISTRICTS = [
  { lat: 35.6945, lon: 139.7025, r: 230 }, // 新宿・歌舞伎町
  { lat: 35.6994, lon: 139.771, r: 200 }, // 秋葉原の電気街
  { lat: 35.731, lon: 139.7145, r: 200 }, // 池袋の東口
  { lat: 35.661, lon: 139.6985, r: 170 }, // 渋谷のセンター街
  { lat: 35.6665, lon: 139.757, r: 150 }, // 新橋
  { lat: 35.7095, lon: 139.7745, r: 150 }, // 上野・アメ横
];
const GUARD_STATIONS = /^(有楽町|新橋|神田|御徒町)駅$/; // ガード下の店を並べる駅（のまわり GUARD_RADIUS m）
const GUARD_RADIUS = 380;
const KABUKICHO_ARCH = { lat: 35.6938, lon: 139.70102 }; // 歌舞伎町一番街のアーチ（靖国通りの入口）

function addCityProps(group, map, roadHeights, buildingHeights) {
  const g = cityModel.geos;
  if (!g) return;
  const lists = {}; // 名前 → [行列, 色]
  const put = (key, x, h, z, rotY, sz = 1, color = null) => {
    const m = new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(rotY));
    if (sz !== 1) m.multiply(new THREE.Matrix4().makeScale(1, 1, sz));
    (lists[key] ??= []).push([m, color]);
  };
  const hashOf = (a, b) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  // ---- 歌舞伎町一番街のアーチ（いちばん近い道をまたぐ） ----
  {
    const [x, z] = latLonXY(map, KABUKICHO_ARCH.lat, KABUKICHO_ARCH.lon);
    const near = inBounds(map, x, z) && nearestRoadPoint(map, x, z, false);
    if (near) {
      const r = near.road;
      let bi = 0, bd = Infinity;
      for (let k = 0; k + 3 < r.p.length; k += 2) {
        const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - near.x, (r.p[k + 1] + r.p[k + 3]) / 2 - near.z);
        if (d < bd) (bd = d), (bi = k);
      }
      const rot = faceTo(r.p[bi + 2] - r.p[bi], r.p[bi + 3] - r.p[bi + 1]) - Math.PI / 2;
      for (const [geo, material] of [[g.kabukicho.body, STREET_MAT], [g.kabukicho.glow, STREET_GLOW_MAT]]) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = 'kabukicho'; // デバッグ・自動テスト用
        mesh.position.set(near.x, 0, near.z);
        mesh.rotation.y = rot;
        mesh.castShadow = material === STREET_MAT;
        group.add(mesh);
      }
    }
  }
  // ---- ガード下の店：決めた駅のまわりの高架の線路の外側に、4m ずつ ----
  const guardStations = (map.landmarks ?? []).filter((l) => l.k === 'station' && GUARD_STATIONS.test(l.n));
  if (guardStations.length) {
    const elevated = map.lines.filter((l) => l.e && !l.u && l.k !== 'river');
    const nearOther = (x, z, d, self) =>
      elevated.some((l) => {
        if (l === self) return false;
        for (let i = 0; i + 3 < l.p.length; i += 2) {
          const ax = l.p[i], az = l.p[i + 1], dx = l.p[i + 2] - ax, dz = l.p[i + 3] - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) < d) return true;
        }
        return false;
      });
    let n = 0;
    for (const l of elevated) {
      for (let i = 0; i + 3 < l.p.length; i += 2) {
        const x1 = l.p[i], z1 = l.p[i + 1], x2 = l.p[i + 2], z2 = l.p[i + 3];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1) continue;
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        const steps = Math.floor(len / 4);
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          const mx = x1 + (x2 - x1) * t, mz = z1 + (z2 - z1) * t;
          if (!guardStations.some((st) => Math.hypot(st.x - mx, st.y - mz) < GUARD_RADIUS)) continue;
          for (const side of [-1, 1]) {
            const nx = -uz * side, nz = ux * side;
            const fx = mx + nx * 3.4, fz = mz + nz * 3.4;
            if (nearOther(fx, fz, 3.0, l) || surfaceAt(map, fx, fz).kind !== 'ground') continue;
            put(`guard${n++ % 3}`, fx, 0, fz, faceTo(nx, nz), len / steps / 4);
          }
        }
      }
    }
  }
  // ---- 夜のネオン：繁華街の建物の、道に近い壁に縦の看板と光る帯 ----
  const districts = NEON_DISTRICTS.map((d) => [...latLonXY(map, d.lat, d.lon), d.r]);
  map.buildings.forEach((bd, i) => {
    const h = buildingHeights[i];
    if (!(h >= 12)) return;
    const cx = (bd.minX + bd.maxX) / 2, cz = (bd.minY + bd.maxY) / 2;
    if (!districts.some(([x, z, r]) => Math.hypot(x - cx, z - cz) < r)) return;
    const ring = openRing(bd.p);
    let best = null;
    for (let k = 0; k < ring.length; k += 2) {
      const ax = ring[k], az = ring[k + 1], bx = ring[(k + 2) % ring.length], bz = ring[(k + 3) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      let nx = uz, nz = -ux;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (insidePolygon(mx + nx * 0.3, mz + nz * 0.3, bd.p)) (nx = -nx), (nz = -nz);
      const road = nearestRoadPoint(map, mx + nx * 3, mz + nz * 3, false);
      const score = road ? road.d : 99;
      if (!best || score < best.score) best = { score, ax, az, ux, uz, nx, nz, len };
    }
    if (!best || best.score > 12) return;
    const color = (k) => NEON_COLORS[Math.floor(hashOf(i, k) * NEON_COLORS.length)];
    const rot = faceTo(best.nx, best.nz);
    const at = (t, d = 0.05) => [best.ax + best.ux * best.len * t + best.nx * d, best.az + best.uz * best.len * t + best.nz * d];
    for (const [t, k] of best.len > 12 ? [[0.15, 1], [0.85, 2]] : [[0.2, 1]]) {
      const [x, z] = at(t);
      put('neonV', x, Math.min(4, h - 7.5), z, rot, 1, color(k));
    }
    if (h >= 15) {
      const [x, z] = at(0.5, 0.06);
      for (let j = 1; j <= Math.min(4, Math.floor(h / 3.6) - 1); j++) {
        if (hashOf(i, j + 10) < 0.45) continue;
        put('neonBand', x, 3.0 + 3.6 * j, z, rot, best.len * 0.8, color(j + 3));
      }
    }
  });
  // ---- 公園の物：公園の中の空いている所に、ベンチ・遊具・噴水・トイレ ----
  (map.areas ?? []).forEach((a, ai) => {
    if (a.k !== 'park') return;
    const ring = a.r[0];
    const area = Math.abs(polygonArea(openRing(ring)));
    if (area < 1200) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) (x0 = Math.min(x0, ring[k])), (x1 = Math.max(x1, ring[k])), (z0 = Math.min(z0, ring[k + 1])), (z1 = Math.max(z1, ring[k + 1]));
    const placed = [];
    let tries = 0;
    const spot = (clear) => {
      for (; tries < 400; tries++) {
        const x = x0 + (x1 - x0) * hashOf(ai, tries * 2 + 1), z = z0 + (z1 - z0) * hashOf(ai + 0.5, tries * 2 + 2);
        if (!insidePolygon(x, z, ring) || onTrack(map, x, z, 6)) continue;
        // 物の真ん中とまわり（clear m 先の 4 点）が、公園の中の空いている地面（道や建物でない）
        const around = [[0, 0], [clear, 0], [-clear, 0], [0, clear], [0, -clear]];
        if (around.some(([dx, dz]) => !insidePolygon(x + dx, z + dz, ring) || surfaceAt(map, x + dx, z + dz).kind !== 'ground')) continue;
        if (placed.some(([px, pz, pc]) => Math.hypot(px - x, pz - z) < pc + clear)) continue;
        if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < FURNITURE_CLEAR_START)) continue;
        placed.push([x, z, clear]);
        tries++;
        return [x, z];
      }
      return null;
    };
    const want = [];
    if (area > 9000) want.push(['fountain', 4]);
    if (area > 2500) want.push(['play', 4]);
    if (area > 4000) want.push(['toilet', 4]);
    for (let k = 0; k < Math.min(8, Math.floor(area / 900)); k++) want.push(['bench', 1.5]);
    for (const [key, clear] of want) {
      const sp = spot(clear);
      if (!sp) break;
      // ベンチとトイレは近くの道（園内の道）の方を向ける
      const near = key === 'bench' || key === 'toilet' ? nearestRoadPoint(map, sp[0], sp[1], false) : null;
      const rot = near ? faceTo(near.x - sp[0], near.z - sp[1]) : hashOf(ai, placed.length) * Math.PI * 2;
      put(key, sp[0], 0, sp[1], rot);
    }
  });
  for (const [key, list] of Object.entries(lists)) {
    const parts = key.startsWith('neon') ? [[g[key].glow, NEON_MAT]] : [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]];
    for (const [geo, material] of parts) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([m, c], i) => {
        mesh.setMatrixAt(i, m);
        if (c != null) mesh.setColorAt(i, new THREE.Color(c));
      });
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      group.add(mesh);
    }
  }
}

// ---- 街の物 その 3（Blender で作ったモデル。tools/build-city2.py） ----
// 走る路面電車・モノレール・新交通の車両、緊急車両、駅前の名物 その 2、店の前の物（商店街）、工事現場の重機。どれも見た目だけ
const CITY2_URL = 'data/models/city2.glb';
const CITY2_NAMES = {
  toden: 'C2_Toden', mono: 'C2_Mono', yuri: 'C2_Yuri', police: 'C2_Police', policeLamp: 'C2_PoliceLamp', ambulance: 'C2_Ambulance',
  ambLamp: 'C2_AmbLamp', fire: 'C2_Fire', fireLamp: 'C2_FireLamp', saigo: 'C2_Saigo', cat: 'C2_Cat', clock: 'C2_Clock', sunshine: 'C2_Sunshine',
  noboriPole: 'C2_NoboriPole', noboriCloth: 'C2_NoboriCloth', aboard: 'C2_ABoard', bike: 'C2_Bike', yatai: 'C2_Yatai',
  excavator: 'C2_Excavator', crane: 'C2_Crane', scaffold: 'C2_Scaffold',
};
const city2 = { geos: null, done: false }; // 名前 → { body, glow }
loadModelParts(CITY2_URL, CITY2_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city2.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 3）のモデルを読み込めませんでした: ${CITY2_URL}`, e))
  .finally(() => (city2.done = true));
// 駅前の名物 その 2（OpenStreetMap の位置）。face は名物の前が向く方角（北が 0、時計回り rad）、gate は道をまたぐ、
// corner は建物の角の大きな画面（画面の 2 面が西と南を向く）
const CITY2_LANDMARKS = [
  { key: 'saigo', lat: 35.7118569, lon: 139.7741721, face: Math.PI }, // 上野の西郷隆盛像（南を向く）
  { key: 'cat', lat: 35.6926184, lon: 139.7007975, corner: true }, // 新宿東口の角の大きな画面と三毛猫
  { key: 'clock', lat: 35.6432, lon: 139.71330, face: 0 }, // 恵比寿ガーデンプレイスの時計台
  { key: 'sunshine', lat: 35.7302794, lon: 139.7167724, gate: true }, // サンシャイン60通りの入口
];
// 店の前の物を並べる商店街（道の名前）
const SHOP_STREETS = /商店街|銀座|アメ横|地蔵通|一番街|センター街|竹下通|サンシャイン60通|サンシャイン通|横丁|小路|仲通/;
const NOBORI_COLORS = [0xd8282e, 0x1f5fb0, 0xf2c200, 0x2a9a4a, 0xf08a2a, 0xe85a9a, 0xf4f4f0];

function addCity2Props(group, map, roadHeights) {
  const g = city2.geos;
  if (!g) return;
  const lists = {};
  const put = (key, x, h, z, rotY, color = null) => {
    const m = new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(rotY));
    (lists[key] ??= []).push([m, color]);
  };
  const hashOf = (a, b) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const roadDir = (near) => {
    const r = near.road;
    let bi = 0, bd = Infinity;
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - near.x, (r.p[k + 1] + r.p[k + 3]) / 2 - near.z);
      if (d < bd) (bd = d), (bi = k);
    }
    return [r.p[bi + 2] - r.p[bi], r.p[bi + 3] - r.p[bi + 1]];
  };
  // ---- 駅前の名物 その 2 ----
  for (const lm of CITY2_LANDMARKS) {
    let [x, z] = latLonXY(map, lm.lat, lm.lon);
    if (!inBounds(map, x, z)) continue;
    let rot = lm.face != null ? turnTo(lm.face) - Math.PI / 2 : 0;
    if (lm.gate) {
      const near = nearestRoadPoint(map, x, z, false);
      if (!near) continue;
      [x, z] = [near.x, near.z];
      rot = faceTo(...roadDir(near)) - Math.PI / 2;
    } else if (lm.corner) rot = Math.PI; // 画面の 2 面（Blender の +X・+Y）を西と南に
    else if (surfaceAt(map, x, z).kind === 'building') continue; // 建物の中には置かない
    for (const [geo, material] of [[g[lm.key].body, STREET_MAT], [g[lm.key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = lm.key; // デバッグ・自動テスト用
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rot;
      mesh.castShadow = material === STREET_MAT;
      group.add(mesh);
    }
  }
  // ---- 店の前の物：商店街の道の両端に、のぼり旗・立て看板・とめた自転車、ときどき屋台 ----
  map.roads.forEach((r, ri) => {
    if (!r.n || !SHOP_STREETS.test(r.n) || r.e) return;
    let walked = 0, slot = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      for (let d = (7 - (walked % 7)) % 7; d < len; d += 7, slot++) {
        const side = slot % 2 ? 1 : -1;
        const nx = -uz * side, nz = ux * side; // 道の外向き
        const off = r.w / 2 + 0.3;
        const x = x1 + ux * d + nx * off, z = z1 + uz * d + nz * off;
        const sf = surfaceAt(map, x, z);
        if (sf.kind === 'building' || (sf.segs ?? []).some((sg) => !sg.road.path && sg.road !== r)) continue; // 車道や建物の中には置かない
        if ([map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < FURNITURE_CLEAR_START)) continue;
        const face = faceTo(-nx, -nz); // 道の方を向く
        const h = hashOf(ri, slot);
        if (slot % 37 === 18) put('yatai', x + nx * 0.8, 0, z + nz * 0.8, faceTo(ux, uz) - Math.PI / 2);
        else if (h < 0.55) {
          put('noboriPole', x, 0, z, faceTo(ux, uz) - Math.PI / 2);
          put('noboriCloth', x, 0, z, faceTo(ux, uz) - Math.PI / 2, NOBORI_COLORS[Math.floor(hashOf(ri, slot + 0.5) * NOBORI_COLORS.length)]);
        } else if (h < 0.75) put('aboard', x, 0, z, face);
        else put('bike', x, 0, z, faceTo(ux, uz) - Math.PI / 2 + (h - 0.85));
      }
      walked += len;
    }
  });
  // ---- 工事現場の重機：工事中の所の空いている地面に、ショベルカー・クレーン車・足場のどれか ----
  for (let i = 0; i + 1 < (map.works?.length ?? 0); i += 2) {
    const x = map.works[i], z = map.works[i + 1];
    if (!freeSpot(map, roadHeights, x, z, false) || !freeSpot(map, roadHeights, x + 3, z, false) || !freeSpot(map, roadHeights, x - 3, z, false)) continue;
    const near = nearestRoadPoint(map, x, z, true);
    const face = near ? faceTo(near.x - x, near.z - z) : 0;
    const h = hashOf(x, z);
    put(h < 0.45 ? 'excavator' : h < 0.65 ? 'crane' : 'scaffold', x, 0, z, face - Math.PI / 2);
  }
  for (const [key, list] of Object.entries(lists)) {
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([m, c], i) => {
        mesh.setMatrixAt(i, m);
        if (c != null) mesh.setColorAt(i, new THREE.Color(c));
      });
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT;
      group.add(mesh);
    }
  }
  // ---- 路面電車の線路（見た目だけ。道の上は道に埋めた形で、少し浮かせて描く） ----
  const tramPieces = [];
  for (const t of map.trams ?? []) {
    for (let i = 0; i + 3 < t.p.length; i += 2) {
      const x1 = t.p[i], z1 = t.p[i + 1], x2 = t.p[i + 2], z2 = t.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const steps = Math.ceil(len / 4);
      for (let k = 0; k < steps; k++) {
        const tt = (k + 0.5) / steps;
        const m = new THREE.Matrix4()
          .makeTranslation(x1 + (x2 - x1) * tt, Y.rail, z1 + (z2 - z1) * tt)
          .multiply(new THREE.Matrix4().makeRotationY(faceTo(x2 - x1, z2 - z1)))
          .multiply(new THREE.Matrix4().makeScale(len / steps, 1, 1));
        tramPieces.push(m);
      }
    }
  }
  if (tramPieces.length) {
    const piece = new THREE.BoxGeometry(1, 0.03, 2.3).translate(0, 0.015, 0);
    const rails = new THREE.BoxGeometry(1, 0.06, 0.07);
    const railL = rails.clone().translate(0, 0.05, -0.53), railR = rails.clone().translate(0, 0.05, 0.53);
    const bed = new THREE.InstancedMesh(piece, mat(0x3a3a3c), tramPieces.length);
    const rl = new THREE.InstancedMesh(railL, mat(0x8a9098), tramPieces.length), rr = new THREE.InstancedMesh(railR, mat(0x8a9098), tramPieces.length);
    tramPieces.forEach((m, i) => [bed, rl, rr].forEach((mesh) => mesh.setMatrixAt(i, m)));
    group.add(bed, rl, rr);
  }
}

// ---- 街の物 その 4（Blender で作ったモデル。tools/build-city3.py） ----
// ホームで電車を待つ人（出発駅と到着駅）、道路の路面の物（「止まれ」の字・自転車の通る所の印・マンホール・点字ブロック）、
// 止まって作業するゴミの収集車と宅配の車、駅前の屋根付きの自転車置き場。どれも見た目だけ
const CITY3_URL = 'data/models/city3.glb';
const CITY3_NAMES = {
  stand0: 'C3_Stand0', stand1: 'C3_Stand1', stand2: 'C3_Stand2', stand3: 'C3_Stand3', bench: 'C3_Bench',
  tomare: 'C3_Tomare', bikeMark: 'C3_BikeMark', manhole: 'C3_Manhole', tactile: 'C3_Tactile',
  garbage: 'C3_Garbage', delivery: 'C3_Delivery', bikePark: 'C3_BikePark',
};
const city3 = { geos: null, done: false };
loadModelParts(CITY3_URL, CITY3_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city3.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 4）のモデルを読み込めませんでした: ${CITY3_URL}`, e))
  .finally(() => (city3.done = true));
const TACTILE_RADIUS = 300; // 駅のまわりこの距離 m の歩道に点字ブロック
const WORK_SPACING = 280; // 作業する車を置く間隔の目安 m

function addCity3Props(group, map, roadHeights) {
  const g = city3.geos;
  if (!g) return;
  const lists = {};
  const put = (key, x, h, z, rotY, sz = 1) => {
    const m = new THREE.Matrix4().makeTranslation(x, h, z).multiply(new THREE.Matrix4().makeRotationY(rotY));
    if (sz !== 1) m.multiply(new THREE.Matrix4().makeScale(1, 1, sz));
    (lists[key] ??= []).push(m);
  };
  const hashOf = (a, b) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const along = (dx, dz) => Math.atan2(-dx, -dz); // モデルの前（ローカルの -z）を (dx, dz) の向きに
  const clearOfStart = (x, z) => ![map.start, map.goal].some((pt) => Math.hypot(pt.x - x, pt.y - z) < FURNITURE_CLEAR_START);
  // ---- ホームで電車を待つ人（出発駅と到着駅の、ゲームのホームの上） ----
  const route = map.trainRoute;
  if (route) {
    const trainLen = carCount(route) * 20;
    for (const [s0, s1] of [[0, trainLen], [route.length - trainLen, route.length]]) {
      const mid = pointAt(route, (s0 + s1) / 2);
      const { left, right } = nearbyTracks(map, mid);
      const island = [[right, 1], [left, -1]].filter(([d]) => d >= 6 && d <= 16).sort((a, b) => a[0] - b[0])[0];
      const side = island ? island[1] : right >= left ? 1 : -1;
      const width = island ? island[0] - 2 * PLATFORM_EDGE : Math.min(6, Math.max(3, (side > 0 ? right : left) - 2 * PLATFORM_EDGE));
      if (width < 2.6) continue;
      for (let s = s0 + 3, k = 0; s < s1 - 3; s += 3.2, k++) {
        const at = pointAt(route, s);
        const nx = -Math.cos(at.angle) * side, nz = -Math.sin(at.angle) * side; // 線路から外へ
        const h = at.h + Y.rail + PLATFORM_TOP;
        const r = hashOf(s, s0);
        if (k % 7 === 3) {
          // ベンチ（ホームの真ん中、線路の方を向く）
          const lat = PLATFORM_EDGE + width / 2;
          put('bench', at.x + nx * lat, h, at.y + nz * lat, along(-nx, -nz));
        } else if (r < 0.6) {
          const lat = PLATFORM_EDGE + 1.6 + (width - 2.2) * hashOf(s0, s);
          put(`stand${Math.floor(hashOf(s, 7) * 4)}`, at.x + nx * lat, h, at.y + nz * lat, along(-nx, -nz) + (hashOf(s, 9) - 0.5) * 0.8);
        }
      }
    }
  }
  // ---- 路面の「止まれ」：止まれの標識と同じ所（細い道から広い道に出る手前）の、車線の真ん中 ----
  const seen = new Set();
  for (const [key, list] of map.nodes) {
    const cars = list.filter((n) => !n.road.path && !n.road.e);
    if (new Set(cars.map((n) => n.road)).size < 2 || seen.has(key)) continue;
    seen.add(key);
    const [x, z] = key.split(',').map(Number);
    const arms = [];
    for (const { road, v } of cars) {
      for (const u of [v - 1, v + 1]) {
        if (u < 0 || u >= road.p.length / 2) continue;
        const dx = road.p[2 * u] - road.p[2 * v], dz = road.p[2 * u + 1] - road.p[2 * v + 1], l = Math.hypot(dx, dz) || 1;
        arms.push({ road, ux: dx / l, uz: dz / l, len: l, incoming: !road.o || (road.o === 1) === (u < v) });
      }
    }
    const widest = Math.max(...arms.map((a) => a.road.w));
    for (const a of arms) {
      if (a.road.w >= 8 || a.road.w + 2 > widest || !a.incoming || a.len < 8) continue;
      const lane = a.road.o ? 0 : a.road.w / 4;
      const tx = x + a.ux * 3.5 - a.uz * lane, tz = z + a.uz * 3.5 + a.ux * lane;
      if (clearOfStart(tx, tz)) put('tomare', tx, Y.arrow, tz, along(-a.ux, -a.uz));
    }
  }
  // ---- 道に沿う路面の物：自転車の通る所の印（広い道の左端）・マンホール（車道）・点字ブロック（駅のまわりの歩道） ----
  const stations = (map.landmarks ?? []).filter((l) => l.k === 'station');
  map.roads.forEach((r, ri) => {
    const n = r.p.length / 2;
    const bike = !r.path && !r.e && r.w >= 9, manhole = !r.path && r.w >= 5;
    const tactile = r.path && r.w >= 2.5 && stations.some((st) => Math.hypot(st.x - r.p[0], st.y - r.p[1]) < TACTILE_RADIUS + 200);
    if (!bike && !manhole && !tactile) return;
    let walked = 0;
    for (let i = 0; i + 1 < n; i++) {
      const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const at = (d) => [x1 + ux * d, z1 + uz * d, roadHeightAt(roadHeights, r, i, d / len)];
      if (bike) {
        for (let d = (30 - (walked % 30)) % 30; d < len; d += 30) {
          const [cx, cz, h] = at(d);
          for (const dir of r.o ? [r.o] : [1, -1]) {
            const dx = ux * dir, dz = uz * dir, off = r.w / 2 - 0.9;
            const bx = cx + dz * off, bz = cz - dx * off; // 進む向きの左
            if (clearOfStart(bx, bz)) put('bikeMark', bx, h + Y.arrow, bz, along(dx, dz));
          }
        }
      }
      if (manhole) {
        for (let d = (45 - (walked % 45)) % 45; d < len; d += 45) {
          const [cx, cz, h] = at(d);
          const off = (hashOf(ri, d + walked) - 0.5) * r.w * 0.5;
          put('manhole', cx - uz * off, h + Y.arrow, cz + ux * off, 0);
        }
      }
      if (tactile) {
        const steps = Math.ceil(len / 2);
        for (let k = 0; k < steps; k++) {
          const [cx, cz, h] = at(((k + 0.5) * len) / steps);
          if (!stations.some((st) => Math.hypot(st.x - cx, st.y - cz) < TACTILE_RADIUS)) continue;
          if ((surfaceAt(map, cx, cz).segs ?? []).some((sg) => !sg.road.path)) continue; // 車道を渡る所（横断歩道）には敷かない
          put('tactile', cx, h + Y.arrow, cz, along(ux, uz), len / steps);
        }
      }
      walked += len;
    }
  });
  // ---- 止まって作業する車：細い車道の左端に、ゴミの収集車と宅配の車をときどき ----
  let works = 0;
  map.roads.forEach((r, ri) => {
    if (r.path || r.e || r.w < 4 || r.w >= 9 || works >= 24) return;
    let walked = 0;
    for (let i = 0; i + 1 < r.p.length / 2; i++) {
      const x1 = r.p[2 * i], z1 = r.p[2 * i + 1], x2 = r.p[2 * i + 2], z2 = r.p[2 * i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      // 線分の真ん中（交差点から 12m 以上離れた長い線分だけ）
      if (len >= 30 && Math.floor((walked + len / 2) / WORK_SPACING) !== Math.floor(walked / WORK_SPACING) && hashOf(ri, i) < 0.6) {
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        const dir = r.o || (hashOf(i, ri) < 0.5 ? 1 : -1);
        const dx = ux * dir, dz = uz * dir, off = r.w / 2 - 1.1;
        const cx = (x1 + x2) / 2 + dz * off, cz = (z1 + z2) / 2 - dx * off;
        if (clearOfStart(cx, cz)) {
          put(hashOf(ri, i + 1) < 0.5 ? 'garbage' : 'delivery', cx, 0, cz, along(dx, dz));
          works++;
        }
      }
      walked += len;
    }
  });
  // ---- 駅前の屋根付きの自転車置き場（駅のまわりの空いている地面に、1 駅に 2 つまで） ----
  stations.forEach((st, si) => {
    let n = 0;
    for (const dist of [45, 70, 95]) {
      for (let k = 0; k < 8 && n < 2; k++) {
        const a = (k / 8) * Math.PI * 2 + hashOf(si, dist);
        const x = st.x + Math.cos(a) * dist, z = st.y + Math.sin(a) * dist;
        const near = nearestRoadPoint(map, x, z, false);
        if (!near) continue;
        const [rdx, rdz] = (() => {
          const rr = near.road;
          let bi = 0, bd = Infinity;
          for (let q = 0; q + 3 < rr.p.length; q += 2) {
            const d = Math.hypot((rr.p[q] + rr.p[q + 2]) / 2 - near.x, (rr.p[q + 1] + rr.p[q + 3]) / 2 - near.z);
            if (d < bd) (bd = d), (bi = q);
          }
          const l = Math.hypot(rr.p[bi + 2] - rr.p[bi], rr.p[bi + 3] - rr.p[bi + 1]) || 1;
          return [(rr.p[bi + 2] - rr.p[bi]) / l, (rr.p[bi + 3] - rr.p[bi + 1]) / l];
        })();
        // 置き場の長さ 14m・幅 4.4m が、すべて空いている地面に入るか
        const pts = [[0, 0], [7, 0], [-7, 0], [7, 2.2], [-7, 2.2], [7, -2.2], [-7, -2.2]].map(([t, w]) => [x + rdx * t - rdz * w, z + rdz * t + rdx * w]);
        if (!pts.every(([px, pz]) => freeSpot(map, roadHeights, px, pz, false))) continue;
        put('bikePark', x, 0, z, along(rdx, rdz));
        n++;
      }
    }
  });
  for (const [key, list] of Object.entries(lists)) {
    for (const [geo, material] of [[g[key].body, STREET_MAT], [g[key].glow, STREET_GLOW_MAT]]) {
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key; // デバッグ・自動テスト用
      mesh.castShadow = material === STREET_MAT && !['tomare', 'bikeMark', 'manhole', 'tactile'].includes(key);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---- 街の物 その 5（Blender で作ったモデル。tools/build-city4.py） ----
// スタートの演出（門の横で旗を振る人と、3・2・1 の灯の柱）、渋谷スクランブル交差点の人の波、駅の入口。どれも見た目だけ
const CITY4_URL = 'data/models/city4.glb';
const CITY4_NAMES = {
  starter: 'C4_Starter', starterArm: 'C4_StarterArm', lampPole: 'C4_LampPole',
  lamp1: 'C4_Lamp1', lamp2: 'C4_Lamp2', lamp3: 'C4_Lamp3', lampGo: 'C4_LampGo', entrance: 'C4_Entrance',
};
const city4 = { geos: null, done: false };
loadModelParts(CITY4_URL, CITY4_NAMES)
  .then((parts) => {
    const isLight = (part) => part.material.startsWith('Light');
    const geos = {};
    for (const [key, list] of Object.entries(parts)) {
      const glow = list.some(isLight) ? addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build() : null;
      geos[key] = { body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : part.color)).build(), glow };
    }
    city4.geos = geos;
  })
  .catch((e) => console.warn(`街の物（その 5）のモデルを読み込めませんでした: ${CITY4_URL}`, e))
  .finally(() => (city4.done = true));
const STARTER_SHOULDER = [0, 1.42, 0.21]; // 旗を振る人の右肩（体の原点から。tools/build-city4.py の SH）
const PERSON_HIT_R = 0.9; // ランニング大会・スクランブル交差点の人とぶつかる距離 m（歩行者の 1.0 m より少し小さく）
const SCRAMBLE = { lat: 35.6595, lon: 139.7006, half: 21, people: 48 }; // 渋谷スクランブル交差点の真ん中と、横断歩道の四隅までの半分 m

// 駅名の板の絵（濃い紺に白い駅名、上に緑の帯）
function entranceSignTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f2a44';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#2a9a4a';
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.fillText(name, 256, 74);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// スタートの門の横に、旗を振る人（門の右の柱の外）と灯の柱（門の左の手前。走り出す自転車の方を向く）
function addStartShow(group) {
  const g = city4.geos, sg = group.userData.startGate;
  if (!g || !sg) return;
  const { gate, reach } = sg;
  const mk = (geo, material) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = material === STREET_MAT;
    return m;
  };
  const starter = new THREE.Group();
  starter.position.set(reach + 1.3, 0, -0.8);
  starter.rotation.y = Math.PI; // 道の真ん中の方を向く
  starter.add(mk(g.starter.body, STREET_MAT));
  const arm = mk(g.starterArm.body, STREET_MAT);
  arm.position.set(...STARTER_SHOULDER);
  starter.add(arm);
  const pole = new THREE.Group();
  pole.position.set(-reach - 2.2, 0, -3.5);
  pole.rotation.y = -Math.PI / 2; // 灯を、門の手前（スタートの自転車）に向ける
  pole.add(mk(g.lampPole.body, STREET_MAT));
  const lamps = ['lamp1', 'lamp2', 'lamp3', 'lampGo'].map((k) => {
    const m = mk(g[k].glow, STREET_GLOW_MAT);
    m.visible = false;
    pole.add(m);
    return m;
  });
  gate.add(starter, pole);
  group.userData.startShow = { arm, lamps };
}

// ---- ゴールの演出（Blender で作ったモデル。tools/build-goal.py） ----
// ゴールの門の梁から下がるくす玉。勝ってゴールすると左右に割れ、「祝 ゴール」のたれ幕が下り、紙吹雪が舞う。
// 門の両側では法被の人が小旗を振って応援する（ゴールすると跳びはねる）。どれも見た目だけ
const GOAL_URL = 'data/models/goal.glb';
const GOAL_NAMES = {
  cord: 'GL_Cord', ballL: 'GL_BallL', ballR: 'GL_BallR', streamer: 'GL_Streamer',
  fan0: 'GL_Fan0', fan1: 'GL_Fan1', fan2: 'GL_Fan2', fanArm: 'GL_FanArm',
};
const goalModel = { geos: null, done: false };
loadModelParts(GOAL_URL, GOAL_NAMES)
  .then((parts) => {
    const geos = {};
    for (const [key, list] of Object.entries(parts)) geos[key] = addModelParts(new GeometryBuilder(true), list).build();
    goalModel.geos = geos;
  })
  .catch((e) => console.warn(`ゴールの演出のモデルを読み込めませんでした: ${GOAL_URL}`, e))
  .finally(() => (goalModel.done = true));
const GOAL_HINGE = [0, 3.9, -0.45]; // くす玉のてっぺん（門の真ん中。横断幕の少し先の、横断幕より下に吊るす）
const GOAL_BEAM_BOTTOM = 5.85; // 門の梁の下の高さ（ひもをここまで伸ばす。tools/build-street.py の GATE_H - 0.15）
const GOAL_CORD_LEN = 1.6; // tools/build-goal.py の CORD_LEN
const GOAL_BALL_R = 0.6; // tools/build-goal.py の BALL_R
const FAN_SHOULDER = [0, 1.42, 0.21]; // 応援する人の右肩（tools/build-goal.py の SH）
const CONFETTI_N = 320; // 紙吹雪の枚数
const CONFETTI_COLORS = [0xe8443a, 0xffcc33, 0x80c241, 0x3b82f0, 0xf48cbc, 0xffffff, 0xff8a1c];

function addGoalShow(group) {
  const g = goalModel.geos, gg = group.userData.goalGate;
  if (!g || !gg) return;
  const { gate, reach } = gg;
  const mk = (geo) => {
    const m = new THREE.Mesh(geo, STREET_MAT);
    m.castShadow = true;
    return m;
  };
  const ball = new THREE.Group();
  ball.position.set(...GOAL_HINGE);
  const left = mk(g.ballL), right = mk(g.ballR), streamer = mk(g.streamer);
  streamer.visible = false;
  const cord = mk(g.cord);
  cord.scale.y = (GOAL_BEAM_BOTTOM - GOAL_HINGE[1]) / GOAL_CORD_LEN;
  ball.add(cord, left, right, streamer);
  // 応援する人：門の左右に 4 人ずつ、道の方（と、走ってくる自転車の方）を向く
  const fans = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const fan = new THREE.Group();
      fan.position.set(side * (reach + 1.3 + (k % 2) * 0.8), 0, 2.6 - k * 1.3);
      fan.rotation.y = (side < 0 ? 0 : Math.PI) + side * 0.35; // +x（体の前）を道の真ん中へ。少し手前へ向ける
      fan.add(mk(g[`fan${(k + (side > 0 ? 1 : 0)) % 3}`]));
      const arm = mk(g.fanArm);
      arm.position.set(...FAN_SHOULDER);
      fan.add(arm);
      gate.add(fan);
      fans.push({ fan, arm, phase: k * 1.7 + (side > 0 ? 0.9 : 0) });
    }
  }
  // 紙吹雪（くす玉が割れたら、中から舞い落ちる。1 枚ずつ色が違う）
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.09), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CONFETTI_N);
  const col = new THREE.Color();
  for (let i = 0; i < CONFETTI_N; i++) confetti.setColorAt(i, col.setHex(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
  confetti.frustumCulled = false;
  confetti.userData.keepUnculled = true;
  confetti.visible = false;
  confetti.name = 'goalConfetti'; // デバッグ・自動テスト用
  gate.add(ball, confetti);
  group.userData.goalShow = {
    ball, left, right, streamer, fans, confetti,
    bits: { pos: new Float32Array(CONFETTI_N * 3), vel: new Float32Array(CONFETTI_N * 3), spin: new Float32Array(CONFETTI_N * 3), rot: new Float32Array(CONFETTI_N * 3) },
  };
}

// 駅の入口：駅のまわりの空いている地面に、近くの道の方を向けて 1 つ（駅名の板付き）
function addStationEntrances(group, map, roadHeights) {
  const g = city4.geos;
  if (!g) return;
  for (const st of (map.landmarks ?? []).filter((l) => l.k === 'station')) {
    let placed = false;
    for (const dist of [18, 30, 45, 60]) {
      for (let k = 0; k < 12 && !placed; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = st.x + Math.cos(a) * dist, z = st.y + Math.sin(a) * dist;
        const near = nearestRoadPoint(map, x, z, false);
        if (!near || near.d > 12) continue;
        const fx = (near.x - x) / (near.d || 1), fz = (near.z - z) / (near.d || 1); // 道の方
        const corners = [[0.4, 3.2], [0.4, -3.2], [-3.0, 3.2], [-3.0, -3.2], [-1.3, 0]];
        if (!corners.every(([u, w]) => freeSpot(map, roadHeights, x + fx * u - fz * w, z + fz * u + fx * w, false))) continue;
        const ent = new THREE.Group();
        ent.position.set(x, 0, z);
        ent.rotation.y = faceTo(fx, fz);
        const body = new THREE.Mesh(g.entrance.body, STREET_MAT);
        body.castShadow = true;
        ent.add(body);
        if (g.entrance.glow) ent.add(new THREE.Mesh(g.entrance.glow, STREET_GLOW_MAT));
        const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.8), new THREE.MeshBasicMaterial({ map: entranceSignTexture(st.n) }));
        board.position.set(0.43, 3.7, 0);
        board.rotation.y = Math.PI / 2; // 板の面を +x（道の方）へ
        ent.add(board);
        ent.name = 'entrance'; // デバッグ・自動テスト用
        group.add(ent);
        placed = true;
      }
      if (placed) break;
    }
  }
}

// スタートとゴールの門：道をまたぐ 2 本の柱と梁、「START」「GOAL」の横断幕（道の向きに、前後どちらからも読める）。
// スタートはスタートの向き、ゴールはスタートからゴールへの向きに沿う道をまたぐ
function addGates(group, map, heights) {
  const sm = streetModel.geos;
  if (!sm) return;
  const toGoal = Math.atan2(map.goal.x - map.start.x, -(map.goal.y - map.start.y));
  for (const [pt, banner, heading] of [[map.start, sm.gateStart, map.start.angle], [map.goal, sm.gateGoal, toGoal]]) {
    const pose = gatePose(map, pt.x, pt.y, heading);
    const segs = surfaceAt(map, pt.x, pt.y).segs ?? [];
    const h = Math.max(0, ...segs.map((sg) => segHeight(heights, sg, pt.x, pt.y)));
    const gate = new THREE.Group();
    gate.position.set(pt.x, h, pt.y);
    gate.rotation.y = -pose.angle;
    const reach = pose.hw + 0.8;
    const mesh = (geo, x, y, sx = 1) => {
      const m = new THREE.Mesh(geo, STREET_MAT);
      m.position.set(x, y, 0);
      m.scale.x = sx;
      m.castShadow = true;
      gate.add(m);
    };
    mesh(sm.gatePost, -reach, 0);
    mesh(sm.gatePost, reach, 0);
    mesh(sm.gateBeam, 0, GATE_BEAM_Y, reach * 2);
    mesh(banner, 0, GATE_BANNER_Y);
    group.add(gate);
    if (pt === map.start) group.userData.startGate = { gate, reach }; // スタートの演出を足す（addStartShow）
    else group.userData.goalGate = { gate, reach }; // ゴールの演出を足す（addGoalShow）
  }
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
const YAMANOTE_MARK = [0.55, 0.8, 0.2]; // 山手線の目印の黄緑
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
    // 表と裏の 2 枚（1 枚の両面だと、裏から見ると字が左右反対になる）
    for (const back of [0, Math.PI]) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: texCache.get(key) }));
      board.position.set(...sg.pos);
      board.rotation.y = -sg.angle + Math.PI / 2 + back; // 板の面を線路に向ける（線路と平行に立てる）
      group.add(board);
    }
  }
}

// ---- Blender で作った建物のモデル（glb） ----
// lat / lon は建物の中心、heading はモデルの正面（Blender の -Y、glb の +z）が向く方角（北が 0、時計回りの度）。
// clear：地図データに同じ建物が箱で入っているときに、描かないようにする範囲（Blender の座標で [X0, X1, Y0, Y1]。
//   いくつかあるときは、その配列）。中心がこの範囲に入る建物を描かない（走るときの「建物」の判定には残す）
// 東京駅丸の内駅舎は地図データ（OSM の multipolygon）に入っていないので、箱の建物と重ならない。
// 作り方：tools/build-<駅>-station.py（東京駅・高輪ゲートウェイ駅・上野駅・新宿駅・渋谷駅・池袋駅・品川駅・秋葉原駅・神田駅・有楽町駅・
// 新橋駅・浜松町駅・田町駅・大崎駅・五反田駅・目黒駅・恵比寿駅・原宿駅・代々木駅・新大久保駅・高田馬場駅・目白駅・大塚駅・巣鴨駅・駒込駅・田端駅・西日暮里駅・日暮里駅・鶯谷駅・御徒町駅）で .blend を作り、tools/export-glb.py で書き出す。
// 窓の灯りは放射のテクスチャ（emissiveMap）で、時間帯で明るさを変える
const MODELS = [
  // 有名な建物（tools/build-famous-buildings.py）：地図データの同じ建物の箱は描かない
  { url: 'data/models/shibuya109.glb', lat: 35.6596063, lon: 139.6988671, heading: 180, clear: [-11.8, -7.8, -2.7, 1.3] }, // SHIBUYA109
  { url: 'data/models/qfront.glb', lat: 35.6598686, lon: 139.7003755, heading: 180, clear: [-3.3, 0.7, -0.3, 3.7] }, // QFRONT（大きな画面）
  { url: 'data/models/radio_kaikan.glb', lat: 35.6979554, lon: 139.7719352, heading: 180, clear: [-0.7, 3.3, -10.1, -6.1] }, // 秋葉原ラジオ会館
  // tools/build-city.py
  { url: 'data/models/laforet.glb', lat: 35.6690199, lon: 139.7054851, heading: 180, clear: [-8.8, -4.8, 8.3, 12.3] }, // ラフォーレ原宿
  { url: 'data/models/bigbox.glb', lat: 35.7126811, lon: 139.7042381, heading: 180, clear: [3.0, 7.0, -10.9, -6.9] }, // 高田馬場 BIG BOX
  { url: 'data/models/kotsu_kaikan.glb', lat: 35.6749559, lon: 139.7642788, heading: 180, clear: [2.8, 6.8, -0.4, 3.6] }, // 東京交通会館
  { url: 'data/models/tokyo_station.glb', lat: 35.681367, lon: 139.766054, heading: 287.14 },
  { url: 'data/models/takanawa_gateway.glb', lat: 35.635739, lon: 139.740657, heading: 289.2, clear: [-52, 110, -15, 32] },
  { url: 'data/models/ueno_station.glb', lat: 35.712253, lon: 139.776149, heading: 137.4, clear: [-56, 56, -30, 30] },
  { url: 'data/models/shinjuku_station.glb', lat: 35.691258, lon: 139.701096, heading: 83.4 }, // 新宿駅東口の駅ビル（地図データにない）
  { url: 'data/models/shibuya_station.glb', lat: 35.659003, lon: 139.70242, heading: 160.5, clear: [-60, 40, -12, 12] }, // 渋谷駅（銀座線）
  { url: 'data/models/ikebukuro_station.glb', lat: 35.728955, lon: 139.711663, heading: 94, clear: [-20, 20, -10, 10] }, // 池袋駅東口の駅ビル
  { url: 'data/models/shinagawa_station.glb', lat: 35.628864, lon: 139.739046, heading: 176.27, clear: [45, 58, -24, 3] }, // 品川駅（線路の上のコンコース）
  // 秋葉原駅：アトレ 1・総武線の階の駅・2 階の駅（山手線の高架をふさいでいた箱）と、屋根の東端の下の箱
  { url: 'data/models/akihabara_station.glb', lat: 35.698339, lon: 139.773213, heading: 185.63,
    clear: [[-81, -77, -2, 2], [30.5, 32.5, 27, 28.8], [26, 29, -10, -7], [106, 110, -2, 1]] },
  // 神田駅：高架の下の赤レンガのアーチの壁と改札口の看板。東の縁にかかる箱（transportation）は描かない
  { url: 'data/models/kanda_station.glb', lat: 35.691941, lon: 139.770994, heading: 109.66, clear: [-80, -75, -27, -23] },
  // 有楽町駅：高架の下の赤レンガのアーチの壁と改札口の看板（ゲームの地図のホームの箱はガード下の建物として残す）
  { url: 'data/models/yurakucho_station.glb', lat: 35.675017, lon: 139.763121, heading: 137.84 },
  // 新橋駅：高架の下の赤レンガのアーチ・改札口の看板と、SL 広場の C11 292。高架全体を覆っていた駅の高い箱は描かない
  { url: 'data/models/shimbashi_station.glb', lat: 35.666506, lon: 139.758171, heading: 84.74, clear: [-3, 1, -12.5, -8.5] },
  // 浜松町駅：東京モノレールの駅舎と車両、JR の北口・南口のコンコースの橋。線路を覆っていた JR の駅の高い箱と、モノレールの駅の箱は描かない
  { url: 'data/models/hamamatsucho_station.glb', lat: 35.655527, lon: 139.757173, heading: 101.7,
    clear: [[-6, -3, 33, 36], [-42, -39, 0, 3], [45, 48, 0, 3]] },
  // 田町駅：三田口と芝浦口を結ぶ、線路の上のコンコース。ホームと線路を覆う箱になっていた駅は描かない
  { url: 'data/models/tamachi_station.glb', lat: 35.645662, lon: 139.747553, heading: 238.82, clear: [1, 5, 1.5, 5.5] },
  // 大崎駅：線路の上の橋上駅舎（地図データにない）。地上の線路にかかっていた箱は描かない
  { url: 'data/models/osaki_station.glb', lat: 35.620257, lon: 139.728063, heading: 147.06, clear: [-52, -48, -16, -12] },
  // 五反田駅：JR の東口の駅舎・西口と、東急池上線のホームと車両。山手線の高架を覆う箱になっていた JR の駅は描かない
  { url: 'data/models/gotanda_station.glb', lat: 35.626646, lon: 139.723245, heading: 53.38, clear: [-74, -70, -2, 2] },
  // 目黒駅：掘割の山手線の上のアトレ目黒 1 と JR東急目黒ビル（線路の帯だけ地上 6m まであける）。線路にかぶさる箱は描かない
  { url: 'data/models/meguro_station.glb', lat: 35.633929, lon: 139.715756, heading: 77.87,
    clear: [[-214, -212, 10.8, 12.8], [15, 17, -6.6, -4.6], [52, 54, -26.4, -24.4], [-142, -140, 14.8, 16.8], [-88, -86, 20.7, 22.7]] },
  // 恵比寿駅：線路の上に建つ JR恵比寿ビル（アトレ恵比寿）と北側の駅舎（線路の帯を地上 12m まであける）、アトレ恵比寿西館、南の立体駐車場。
  // 線路にかぶさる箱と、モデルに置きかわる箱は描かない
  { url: 'data/models/ebisu_station.glb', lat: 35.64644, lon: 139.71021, heading: 65.8,
    clear: [[30, 34, -4, 0], [-12.6, -8.6, -6.8, -2.8], [28, 32, 42, 46], [-229, -224, -6, -1]] },
  // 原宿駅：線路の上をまたぐ 2020 年の駅舎（線路の帯を地上 6.5m まであける）とホーム、竹下口・臨時口。線路をふさぐ駅の箱と竹下口・臨時口の箱は描かない
  { url: 'data/models/harajuku_station.glb', lat: 35.6702, lon: 139.7027, heading: 98.0, clear: [[28, 32, 21, 25], [96, 100, 36, 40], [160, 164, 0, 4]] },
  // 代々木駅：山手線（高架）・総武線（地面）の高さに合わせたホームと屋根、西口の駅舎、東口の屋根。西口の駅舎の箱は描かない
  { url: 'data/models/yoyogi_station.glb', lat: 35.68395, lon: 139.70208, heading: 75.7, clear: [-97, -93, 25, 29] },
  // 新大久保駅：高架の下と西側に建つ 4 階建ての駅舎と、高架の上の島式ホーム・屋根。高架の線路にかぶさる駅の箱は描かない
  { url: 'data/models/shinokubo_station.glb', lat: 35.7013, lon: 139.70024, heading: 93.0, clear: [-3, 1, 8, 12] },
  // 高田馬場駅：高架の上の JR・西武のホームと屋根、高架の下の改札口と西武の駅の建物。線路をまるごと覆っていた駅全体の箱
  // （高さがわからず推定で 20〜30m になっていた）と、西武の駅の箱、西武のホームの細い箱は描かない
  { url: 'data/models/takadanobaba_station.glb', lat: 35.71268, lon: 139.70364, heading: 106.0,
    clear: [[6.7, 10.7, -11.4, -7.4], [87.5, 91.5, -33.7, -29.7], [-169, -165, -22.3, -18.3]] },
  // 目白駅：線路の上に建つ駅舎（線路の帯を地上 6m まであける）、ホテルメッツ目白、島式ホームと屋根。線路をふさいでいた
  // 駅の箱（高さがわからず推定 20〜30m）と、ホテルの箱は描かない
  { url: 'data/models/mejiro_station.glb', lat: 35.72119, lon: 139.70646, heading: 105.3,
    clear: [[-18, -14, -11.4, -7.4], [-16.2, -12.2, -36.7, -32.7]] },
  // 大塚駅：高架の上の島式ホームと屋根、アトレヴィ大塚、北口、高架の下をくぐる都電荒川線の大塚駅前停留場と車両。
  // アトレヴィの箱は描かない
  { url: 'data/models/otsuka_station.glb', lat: 35.73169, lon: 139.72859, heading: 197.6, clear: [-10.3, -6.3, -36.2, -32.2] },
  // 巣鴨駅：線路の上に建つ駅舎とアトレヴィ巣鴨（線路の帯を地上 6m まであける）、島式ホームと屋根。線路をふさいでいた駅の箱は描かない
  { url: 'data/models/sugamo_station.glb', lat: 35.73341, lon: 139.73943, heading: 153.1, clear: [-2.3, 1.7, 5.6, 9.6] },
  // 駒込駅：北口の駅舎（北側の線路の上を地上 6m まであける）、南口の入口、島式ホームと屋根、線路わきのつつじ。
  // 線路にかぶさっていた駅の箱は描かない
  { url: 'data/models/komagome_station.glb', lat: 35.73658, lon: 139.74724, heading: 152.9, clear: [-16.8, -12.8, 7.0, 11.0] },
  // 田端駅：線路の上の北口の駅舎とアトレヴィ田端、南口の駅舎、2 つの島式ホームと屋根。線路をまるごと覆っていた駅全体の箱
  // （高さがわからず推定 20〜30m）と、駅の南東で線路にかぶさっていた 3 つの箱は描かない
  { url: 'data/models/tabata_station.glb', lat: 35.73737, lon: 139.76171, heading: 218.6,
    clear: [[-19.7, -15.7, 5.6, 9.6], [113.8, 117.8, -2.7, 1.3], [134.5, 138.5, -7.3, -3.3], [203.4, 207.4, -5.1, -1.1]] },
  // 西日暮里駅：道灌山通りのすぐ東で線路の上に渡した駅舎、2 つの島式ホームと屋根（線路にかぶさる地図の箱はない）
  { url: 'data/models/nishinippori_station.glb', lat: 35.7322, lon: 139.76667, heading: 232.1 },
  // 日暮里駅：JR の橋上駅舎、JR の 3 つの島式ホーム、京成線のホームと屋根。高さがわからず推定で線路と高架をふさいでいた
  // JR の駅舎の箱と京成の駅の箱、駅の南の線路のあいだの鉄道の建物の箱（地面の高さの京浜東北線にかぶさる）は描かない
  { url: 'data/models/nippori_station.glb', lat: 35.72815, lon: 139.77066, heading: 226.4,
    clear: [[-7.1, -3.1, -11.0, -7.0], [54.9, 58.9, 30.9, 34.9], [103.1, 107.1, -11.4, -7.4]] },
  // 鶯谷駅：昭和初期からの小さな北口駅舎（瓦の寄棟屋根）、南口、2 つの島式ホームと屋根。
  // 北口の駅舎の箱と、駅の南東で線路にかぶさっていた大きな箱は描かない
  { url: 'data/models/uguisudani_station.glb', lat: 35.7217, lon: 139.77792, heading: 229.0,
    clear: [[-79.1, -75.1, 36.3, 40.3], [137.6, 141.6, -15.5, -11.5]] },
  // 御徒町駅：高架の上の 2 つの島式ホームと屋根、高架下の北口・南口の改札口と店。高架をふさいでいたホームの屋根の箱（高さ 13m）と、
  // 高架の床を突き抜けていた高架下の店の箱（ケンタッキー、ローソン、南の 6 つ）は描かない
  { url: 'data/models/okachimachi_station.glb', lat: 35.70695, lon: 139.77463, heading: 277.0,
    clear: [[-34, -30, 5.5, 9.5], [-26.7, -22.7, -6.4, -2.4], [-5.8, -2.8, -8.9, -5.9], [-2.1, 0.9, 3.4, 6.4],
      [92.7, 95.7, -2.5, 0.5], [85.8, 88.8, -2.4, 0.6], [78.9, 81.9, -3.1, -0.1], [72.3, 75.3, -3.6, -0.6],
      [65.7, 68.7, -4.2, -1.2], [59, 62, -4.6, -1.6]] },
];
const M_PER_DEG_LAT = 110540; // tools/fetch-osm.mjs と同じ座標の換算
const MODEL_GLOW_MAX = 1.5; // 光る材質の明るさの上限（Blender の放射の強さは 30 などもある）
const modelGlows = []; // { material, base }：時間帯で明るさを変える材質
// url → { model（読めなければ null）, box（モデルの範囲）, materials, fade（透かす割合。材質と同じく区間をまたいで共有）, done }
const loadedModels = new Map();

// 読み込みは 1 回だけ。材質はほかの建物に合わせて MeshLambertMaterial にし、どの区間でも同じものを使う
function loadModel(url) {
  let entry = loadedModels.get(url);
  if (entry) return entry;
  entry = { model: null, box: null, materials: [], fade: { opacity: 1 }, done: false };
  loadedModels.set(url, entry);
  const mats = new Map();
  const lambert = (src) => {
    if (!mats.has(src)) {
      const m = new THREE.MeshLambertMaterial({ color: src.color, map: src.map, emissiveMap: src.emissiveMap, flatShading: true, side: THREE.DoubleSide });
      if (src.emissiveIntensity > 0 && src.emissive.getHex() !== 0) {
        const base = Math.min(src.emissiveIntensity, MODEL_GLOW_MAX);
        m.emissive.copy(src.emissive);
        m.emissiveIntensity = base * windowGlow;
        modelGlows.push({ material: m, base });
      }
      mats.set(src, m);
    }
    return mats.get(src);
  };
  new GLTFLoader()
    .loadAsync(url)
    .then((gltf) => {
      gltf.scene.traverse((m) => {
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(lambert) : lambert(m.material);
        m.castShadow = m.receiveShadow = true;
        m.userData.shared = true; // 区間の立体を捨てるときも、形と材質は捨てない
      });
      entry.model = gltf.scene;
      entry.box = new THREE.Box3().setFromObject(gltf.scene);
      entry.materials = [...mats.values()];
    })
    .catch((e) => console.warn(`モデルを読み込めませんでした: ${url}`, e))
    .finally(() => (entry.done = true));
  return entry;
}

// 区間の範囲（と少しの余白）に入るモデルを読み込み始める
function modelsFor(map) {
  const o = map.origin, b = map.bounds;
  if (!o) return [];
  const mPerDegLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
  const out = [];
  for (const md of MODELS) {
    const x = (md.lon - o.lon) * mPerDegLon, y = -(md.lat - o.lat) * M_PER_DEG_LAT;
    if (x < b.minX - 300 || x > b.maxX + 300 || y < b.minY - 300 || y > b.maxY + 300) continue;
    const angle = md.heading * (Math.PI / 180);
    out.push({ x, y, angle, clear: md.clear, entry: loadModel(md.url) });
  }
  return out;
}

// 地図データの建物 bd が、モデルに置きかわる（描かない）か
function replacedByModel(models, bd) {
  const cx = (bd.minX + bd.maxX) / 2, cy = (bd.minY + bd.maxY) / 2;
  return models.some(({ x, y, angle, clear }) => {
    if (!clear) return false;
    // 地図の座標 → モデルの座標（rotation.y = π - angle の逆。Blender の Y は glb の -z）
    const dx = cx - x, dz = cy - y, r = Math.PI - angle;
    const lx = dx * Math.cos(r) - dz * Math.sin(r), ly = -(dx * Math.sin(r) + dz * Math.cos(r));
    const rects = Array.isArray(clear[0]) ? clear : [clear];
    return rects.some((c) => lx >= c[0] && lx <= c[1] && ly >= c[2] && ly <= c[3]);
  });
}

// 置いたモデルは group.userData.models に入れる（カメラとのあいだに入ったら透かすため）
function addModels(group, models) {
  group.userData.models = [];
  for (const { x, y, angle, entry } of models) {
    if (!entry.model) continue;
    const m = entry.model.clone(); // 形と材質は共有する
    m.position.set(x, 0, y);
    m.rotation.y = Math.PI - angle; // 正面が +z のモデル
    m.updateMatrixWorld();
    m.userData = { box: entry.box, materials: entry.materials, fade: entry.fade };
    group.add(m);
    group.userData.models.push(m);
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
  const models = modelsFor(map); // glb は作っているあいだに読み込む

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
    // 山手線の目印：道床の両端の細い黄緑の帯（遠くからも黄緑の線に見える）
    if (l.k === 'yamanote') for (const side of [-1, 1]) addOffsetStrip(rails, l.p, (side * TRACK_W) / 2, 0.4, base + 0.02, YAMANOTE_MARK);
    for (const side of [-1, 1]) addOffsetStrip(rails, l.p, (side * RAIL_GAUGE) / 2, 0.08, base + RAIL_TOP, RAIL_STEEL);
    addOffsetStrip(rails, l.p, 0, 0.035, base + WIRE_H, WIRE);
    for (const [x, z, ang] of catenarySpots(l.p)) catenary.push([x, z, ang, base, l.k === 'yamanote']);
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
    // 山手線の架線柱には黄緑の帯（高さ 2〜3m）
    const yp = catenary.filter((c) => c[4]);
    if (yp.length) {
      const bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.9, 8).translate(0, 2.5, 0), mat(0x8cc63f), yp.length);
      yp.forEach(([x, z, ang, y], i) => {
        const nx = -Math.sin(ang), nz = Math.cos(ang);
        bands.setMatrixAt(i, m.makeTranslation(x + nx * 2.4, y, z + nz * 2.4));
      });
      group.add(bands);
    }
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
      if (h > 2.5 && !onTrack(map, x, z)) roadPillars.push([x, z, h - ROAD_DECK_T]);
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
    if (replacedByModel(models, bd)) {
      heights.push(0); // 透かす判定にもかからない
      tileOf.push(null);
      continue;
    }
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

  // 街の物は 1 種類ずつ足し、あいだで次の画面に譲る（まとめて足すと、そのあいだ画面が止まる）。かかった時間 ms を記録する
  const buildTimes = (group.userData.buildTimes = {});
  const timed = (name, fn) => {
    const t0 = performance.now();
    fn();
    buildTimes[name] = Math.round((performance.now() - t0) * 10) / 10;
  };
  while (!streetModel.done || !treeModel.done) yield 0.985; // まだ読み込み中なら待つ（ふつうはもう読めている）
  timed('addStreetLights', () => addStreetLights(group, map, roadHeights));
  yield 0.985;
  timed('addTrees', () => addTrees(group, map, roadHeights));
  yield 0.985;
  timed('addStreetFurniture', () => addStreetFurniture(group, map, roadHeights));
  yield 0.985;
  timed('addGates', () => addGates(group, map, roadHeights));
  yield 0.985;
  while (!shopModel.done) yield 0.985;
  timed('addShops', () => addShops(group, map, heights));
  yield 0.985;
  while (!townModel.done) yield 0.985;
  timed('addTownProps', () => addTownProps(group, map, roadHeights, heights));
  yield 0.985;
  while (!scenery.done) yield 0.985;
  timed('addRailsideAndRivers', () => addRailsideAndRivers(group, map, roadHeights));
  yield 0.985;
  while (!cityModel.done) yield 0.985;
  timed('addCityProps', () => addCityProps(group, map, roadHeights, heights));
  yield 0.985;
  while (!city2.done) yield 0.985;
  timed('addCity2Props', () => addCity2Props(group, map, roadHeights));
  yield 0.985;
  while (!city3.done) yield 0.985;
  timed('addCity3Props', () => addCity3Props(group, map, roadHeights));
  yield 0.985;
  while (!city4.done) yield 0.985;
  timed('addStartShow', () => addStartShow(group));
  yield 0.985;
  while (!goalModel.done) yield 0.985;
  timed('addGoalShow', () => addGoalShow(group));
  yield 0.985;
  while (!city5.done) yield 0.985;
  timed('addCity5Props', () => addCity5Props(group, map, roadHeights));
  yield 0.985;
  timed('addStationEntrances', () => addStationEntrances(group, map, roadHeights));
  yield 0.985;
  while (!city6.done) yield 0.985;
  timed('addCity6Props', () => addCity6Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city7.done) yield 0.985;
  timed('addCity7Props', () => addCity7Props(group, map, roadHeights, heights));
  yield 0.985;
  timed('addGoalStaff', () => addGoalStaff(group));
  yield 0.985;
  while (!city8.done) yield 0.985;
  timed('addCity8Props', () => addCity8Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city9.done) yield 0.985;
  timed('addCity9Props', () => addCity9Props(group, map, roadHeights));
  yield 0.985;
  while (!city10.done) yield 0.985;
  timed('addCity10Props', () => addCity10Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city11.done) yield 0.985;
  timed('addCity11Props', () => addCity11Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city12.done) yield 0.985;
  timed('addCity12Props', () => addCity12Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city13.done) yield 0.985;
  timed('addCity13Props', () => addCity13Props(group, map, roadHeights, heights));
  yield 0.985;
  while (!city14.done) yield 0.985;
  timed('addCity14Props', () => addCity14Props(group, map, roadHeights, heights));
  yield 0.985;
  timed('addStations', () => addStations(group, map, textures));
  while (models.some((md) => !md.entry.done)) yield 0.985; // まだ読み込み中なら待つ（ふつうはもう読めている）
  timed('addModels', () => addModels(group, models));

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
  group.userData.goalBeam = beam; // ゴールの演出のあいだは消す（syncGoalShow）

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

// Blender で作った自転車と乗っている人（tools/build-bicycle.py）。読み込めるまでは下のプログラムで組み立てた形を出し、
// 読み込めたら作った自転車の中身を入れ替える。材質の名前で色を決める（ゴーストは白くする）
const BIKE_MODEL_URL = 'data/models/bicycle.glb';
const BIKE_MODEL_NAMES = {
  frame: 'BK_Frame', rider: 'BK_Rider', wheel: 'BK_Wheel', crank: 'BK_Crank', thigh: 'BK_Thigh', shin: 'BK_Shin', shoe: 'BK_Shoe',
  frameCity: 'BK_FrameCity', frameEbike: 'BK_FrameEbike', riderUp: 'BK_RiderUp', poncho: 'BK_Poncho', ponchoUp: 'BK_PonchoUp',
};
// 自転車の種類（src/outfits.js の BIKE_TYPES）ごとのフレームと乗る人のモデル、腰の位置（脚を置く起点）。
// ママチャリと電動アシスト自転車は背すじを立てて乗る（tools/build-bicycle.py の UP_HIP と同じ）。見た目だけで速さは同じ
// lampF・lampR は前と後ろのライトの位置（夕方と夜に灯す）、poncho は雨の日の合羽
const BIKE_KINDS = {
  road: { frame: 'frame', rider: 'rider', poncho: 'poncho', hip: BIKE.hip, lampF: [0, 0.97, -0.43], lampR: [0, 0.8, 0.31] },
  city: { frame: 'frameCity', rider: 'riderUp', poncho: 'ponchoUp', hip: [0, 0.98, 0.25], lampF: [0, 0.72, -0.56], lampR: [0, 0.44, 0.93] },
  ebike: { frame: 'frameEbike', rider: 'riderUp', poncho: 'ponchoUp', hip: [0, 0.98, 0.25], lampF: [0, 0.72, -0.56], lampR: [0, 0.44, 0.93] },
};
const bikeLook = { rain: false, lights: true }; // 雨の日は合羽を着る・夕方と夜はライトを灯す（setAtmosphere）
const BIKE_LAMP_GEO = new THREE.BoxGeometry(0.07, 0.06, 0.04);
const BIKE_HEAD_MAT = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
const BIKE_TAIL_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const kindOf = (bike) => BIKE_KINDS[bike.userData.type] ?? BIKE_KINDS.road;
const BIKE_MAT_COLORS = { BK_Frame: 'frame', BK_Metal: 'metal', BK_Saddle: 'saddle', BK_Tire: 'tire', BK_Jersey: 'jersey', BK_Shorts: 'shorts', BK_Skin: 'skin', BK_Helmet: 'helmet' };
let bikeModel = null;
const bikes = []; // 作った自転車（モデルが読み込めたら中身を入れ替える）

function loadBikeModel() {
  new GLTFLoader()
    .loadAsync(BIKE_MODEL_URL)
    .then((gltf) => {
      const parts = {};
      for (const [key, name] of Object.entries(BIKE_MODEL_NAMES)) {
        const ob = gltf.scene.getObjectByName(name);
        if (!ob) throw new Error(`${name} がありません`);
        ob.position.set(0, 0, 0);
        parts[key] = ob;
      }
      bikeModel = parts;
      for (const bike of bikes) fillBike(bike);
    })
    .catch((e) => console.warn(`自転車のモデルを読み込めませんでした: ${BIKE_MODEL_URL}`, e));
}
loadBikeModel();

function makeBike(colors = {}, opacity = 1, type = 'road') {
  const bike = new THREE.Group();
  bike.rotation.order = 'YXZ'; // 向き（y）のあとに傾き（z）
  const body = new THREE.Group(); // 傾く部分
  bike.add(body);
  bike.userData = { colors, opacity, type, body, phase: 0, lean: 0, prevAngle: null };
  fillBike(bike);
  bikes.push(bike);
  return bike;
}

// 自転車の中身（傾く部分 body の下）を、Blender のモデルか、プログラムで組み立てた形で作り直す
function fillBike(bike) {
  const s = bike.userData;
  const c = { frame: 0xffcc33, jersey: 0xffcc33, shorts: 0x22324f, helmet: 0xe8443a, skin: 0xf2d0a9, tire: 0x1b1d22, metal: 0x9aa0aa, saddle: 0x15171b, ...s.colors };
  const transparent = s.opacity < 1;
  const o = { transparent, opacity: s.opacity, depthWrite: !transparent };
  if (s.glow) o.blending = THREE.AdditiveBlending; // 光るゴースト
  s.body.clear();
  Object.assign(s, bikeModel ? fillBikeFromModel(s.body, c, o, kindOf(bike)) : fillBikeProcedural(s.body, c, o));
  attachAccessory(bike);
  if (!transparent) bike.traverse((m) => m.isMesh && (m.castShadow = true)); // ゴーストは影を落とさない
}

function fillBikeFromModel(body, c, o, kind) {
  const mats = new Map();
  const convert = (src) => {
    if (!mats.has(src)) {
      const key = BIKE_MAT_COLORS[src.name];
      mats.set(src, new THREE.MeshLambertMaterial({ color: key ? c[key] : src.color, flatShading: true, side: THREE.DoubleSide, ...o }));
    }
    return mats.get(src);
  };
  const part = (key) => {
    const ob = bikeModel[key].clone();
    ob.traverse((m) => m.isMesh && (m.material = convert(m.material)));
    body.add(ob);
    return ob;
  };
  const B = BIKE;
  part(kind.frame);
  const rider = part(kind.rider);
  const wheels = [B.rearAxle, B.frontAxle].map((axle) => {
    const w = part('wheel');
    w.position.set(...axle);
    return w;
  });
  const crank = part('crank');
  crank.position.set(...B.bb);
  const legs = [-1, 1].map((side) => ({ side, thigh: part('thigh'), shin: part('shin'), shoe: part('shoe') }));
  // 雨の日の合羽（半透明）と、前後のライト（ゴーストには付けない）
  const poncho = bikeModel[kind.poncho] ? part(kind.poncho) : null;
  if (poncho) {
    poncho.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      Object.assign(m.material, { transparent: true, opacity: 0.6 * o.opacity, depthWrite: false });
    });
    poncho.visible = bikeLook.rain;
  }
  const lamps = o.transparent
    ? []
    : [[kind.lampF, BIKE_HEAD_MAT], [kind.lampR, BIKE_TAIL_MAT]].map(([at, material]) => {
        const lamp = new THREE.Mesh(BIKE_LAMP_GEO, material);
        lamp.position.set(...at);
        lamp.visible = bikeLook.lights;
        body.add(lamp);
        return lamp;
      });
  return { wheels, crank, legs, poncho, lamps, rider };
}

function fillBikeProcedural(body, c, o) {
  const m = (color) => mat(color, o);
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
  return { wheels, crank, legs };
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
    const kh = kindOf(bike).hip;
    const hip = [leg.side * 0.1, kh[1], kh[2]];
    const knee = kneeOf(hip, foot);
    knee[0] = leg.side * 0.12;
    placeTube(leg.thigh, hip, knee, 0.06);
    placeTube(leg.shin, knee, foot, 0.045);
    if (leg.shoe) leg.shoe.position.set(...foot);
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

// Blender で作った電車（tools/build-yamanote-train.py で作り、data/models/yamanote_train.glb に書き出す）。
// 先頭車・中間車・パンタグラフ付きの中間車・最後尾車の 4 種類で、寸法と向きは上の組み立てと同じ。
// 読み込めるまで（と、読み込めなかったとき）は、上のプログラムで組み立てた電車を使う
const TRAIN_MODEL_URL = 'data/models/yamanote_train.glb';
const TRAIN_MODEL_NAMES = { lead: 'TR_Lead', middle: 'TR_Middle', panto: 'TR_Panto', tail: 'TR_Tail' };
let trainModel = null; // 種類 → 車両のひな形
function loadTrainModel() {
  const mats = new Map();
  const convert = (src) => {
    if (!mats.has(src)) {
      let m;
      if (src.name.startsWith('Light')) {
        m = new THREE.MeshBasicMaterial({ color: src.color, side: THREE.DoubleSide }); // 前照灯・尾灯・行き先表示は光って見える
      } else {
        m = new THREE.MeshLambertMaterial({ color: src.color, map: src.map, flatShading: true, side: THREE.DoubleSide });
        if (src.emissiveMap) {
          // 側面の窓：夜に灯る（時間帯で明るさを変える。上の組み立ての窓と同じ色と強さ）
          m.emissiveMap = src.emissiveMap;
          m.emissive.set(0xfff1d0);
        }
      }
      mats.set(src, m);
    }
    return mats.get(src);
  };
  new GLTFLoader()
    .loadAsync(TRAIN_MODEL_URL)
    .then((gltf) => {
      const cars = {};
      for (const [kind, name] of Object.entries(TRAIN_MODEL_NAMES)) {
        const ob = gltf.scene.getObjectByName(name);
        if (!ob) throw new Error(`${name} がありません`);
        ob.position.set(0, 0, 0);
        ob.traverse((m) => m.isMesh && (m.material = convert(m.material)));
        cars[kind] = ob;
      }
      trainModel = cars;
    })
    .catch((e) => console.warn(`電車のモデルを読み込めませんでした: ${TRAIN_MODEL_URL}`, e));
}
loadTrainModel();

const trainGeometries = new Map(); // 種類 → 形（使い回す）
function makeTrainCar(kind, pantograph) {
  if (trainModel) {
    // Blender のモデル：形は共有し、材質は車両ごとに分ける（トンネルの中の車両だけ薄くするため）
    const car = trainModel[kind === 'middle' && pantograph ? 'panto' : kind].clone();
    car.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.material.transparent = true;
      m.castShadow = true;
      if (m.material.emissiveMap) {
        m.userData.trainGlass = true; // 時間帯で灯りの強さを変える
        m.material.emissiveIntensity = windowGlow * 0.7;
      }
    });
    car.userData.fromModel = true;
    return car;
  }
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

// ---- 山手線と並んで走るほかの電車（Blender で作った通勤電車と新幹線。tools/build-other-trains.py） ----
// 地図データの線路のうち路線の名前 n のある線路（tools/fetch-osm.mjs）を路線ごとにつないで 1 本ずつの線にし、
// その線を路線の色の電車が行ったり来たりする（見た目だけ。勝ち負けや自転車には関わらない）。帯の色は路線の名前から決める
const OTHER_TRAIN_URL = 'data/models/other_trains.glb';
const OTHER_TRAIN_NAMES = { lead: 'OT_Lead', middle: 'OT_Middle', skLead: 'OT_SkLead', skMiddle: 'OT_SkMiddle' };
// [路線の名前, 帯の色, 2 本目の帯の色（新幹線は車体の上の色）, 新幹線か]。上から順に調べる
const LINE_LOOKS = [
  // 新交通・モノレール・路面電車は専用のモデル（[名前, 0, 0, false, モデル, 1 両の長さ m, 両数, 速さ m/s]。tools/build-city2.py）
  [/ゆりかもめ|舎人ライナー/, 0, 0, false, 'yuri', 9.2, 6, 11],
  [/モノレール/, 0, 0, false, 'mono', 16.2, 6, 15],
  [/都電|荒川線|さくらトラム/, 0, 0, false, 'toden', 13.2, 1, 7],
  [/東海道新幹線/, 0x1d4fa0, 0xdcdee2, true],
  [/新幹線/, 0xe0679a, 0x1f8a5e, true], // 東北新幹線（E5 系のような緑と桃色の帯）
  [/京浜東北/, 0x00a7db, 0x00a7db],
  [/山手貨物|埼京|湘南新宿|赤羽/, 0x00ac9a, 0x00ac9a],
  [/中央緩行|総武緩行/, 0xffd400, 0xffd400],
  [/中央/, 0xf15a22, 0xf15a22],
  [/総武本線|横須賀/, 0x1a4b9b, 0xd9c99a],
  [/常磐/, 0x00a14b, 0x1e5bb0],
  [/東海道|東北本線|品鶴|大崎支線/, 0xf68b1e, 0x2a9a4a],
  [/京葉/, 0xc9242f, 0xc9242f],
  [/りんかい/, 0x1e6ab3, 0x1e6ab3],
  [/京急|京浜急行/, 0xd7262a, 0xd7262a],
  [/京成/, 0x1f3d8f, 0xd7262a],
  [/小田急/, 0x1f58b3, 0x1f58b3],
  [/京王/, 0xd5287b, 0x26346d],
  [/西武/, 0x2f5aa8, 0x2f5aa8],
  [/東武/, 0x1a4b9b, 0xf68b1e],
  [/東急|つくば/, 0xd7262a, 0xd7262a],
];
const OTHER_TRAIN_MIN_M = 400; // これより短い線には走らせない
const OTHER_TRAIN_DRAW_M = 650; // カメラからこの距離より遠い電車は描かない
let otherTrainParts = null;
loadModelParts(OTHER_TRAIN_URL, OTHER_TRAIN_NAMES)
  .then((parts) => (otherTrainParts = parts))
  .catch((e) => console.warn(`ほかの電車のモデルを読み込めませんでした: ${OTHER_TRAIN_URL}`, e));
const OTHER_TRAIN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const OTHER_TRAIN_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true }); // 窓・前照灯・行き先表示（時間帯で明るさを変える）
const otherTrainGeos = new Map(); // 車両の種類と帯の色 → { body, glow }

function otherTrainGeometry(key, band, band2) {
  const id = `${key}:${band}:${band2}`;
  let g = otherTrainGeos.get(id);
  if (g) return g;
  const list = otherTrainParts[key];
  const b1 = rgb(band), b2 = rgb(band2);
  const isLight = (part) => part.material.startsWith('Light');
  const color = (part) => (part.material === 'OT_Band' ? b1 : part.material === 'OT_Band2' ? b2 : part.color);
  g = {
    body: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? null : color(part))).build(),
    glow: addModelParts(new GeometryBuilder(true), list, (part) => (isLight(part) ? part.color : null)).build(),
  };
  otherTrainGeos.set(id, g);
  return g;
}

// 区間の地図の、ほかの路線の線（路線ごとに線路をつないだもの）：[{ route, look, name }]
function otherTrainLines(map) {
  const byName = new Map();
  // 路面電車の線路（map.trams。地面の高さ）も、同じように路線ごとにつなぐ
  for (const l of [...(map.lines ?? []), ...(map.trams ?? []).map((t) => ({ ...t, n: t.n || '都電荒川線' }))]) {
    if (!l.n || l.u) continue;
    const look = LINE_LOOKS.find(([re]) => re.test(l.n));
    if (!look) continue;
    if (!byName.has(l.n)) byName.set(l.n, { look, lines: [] });
    byName.get(l.n).lines.push(l);
  }
  const key = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const out = [];
  for (const [name, { look, lines }] of byName) {
    // 端の点 → その点で終わる線路
    const ends = new Map();
    lines.forEach((l, i) => {
      for (const [x, y] of [[l.p[0], l.p[1]], [l.p.at(-2), l.p.at(-1)]]) {
        const k = key(x, y);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push(i);
      }
    });
    const used = new Set();
    const pointsOf = (l, forward) => {
      const pts = [];
      for (let i = 0; i < l.p.length; i += 2) pts.push([l.p[i], l.p[i + 1], 0, l.e ? 1 : 0]);
      return forward ? pts : pts.reverse();
    };
    const free = (k) => (ends.get(k) ?? []).filter((i) => !used.has(i));
    for (;;) {
      // 行き止まりの端から始める（なければ残りのどれか）
      let start = lines.findIndex((l, i) => !used.has(i) && (free(key(l.p[0], l.p[1])).length === 1 || free(key(l.p.at(-2), l.p.at(-1))).length === 1));
      if (start < 0) start = lines.findIndex((_, i) => !used.has(i));
      if (start < 0) break;
      const l0 = lines[start];
      used.add(start);
      const forward = free(key(l0.p[0], l0.p[1])).length === 0; // 始めの端に続きがなければ、そこから進む
      const path = pointsOf(l0, forward);
      // 先の端から、向きがいちばんまっすぐに続く線路をつないでいく
      for (;;) {
        const [x, y] = path.at(-1), [px, py] = path.at(-2);
        const dir = Math.atan2(x - px, y - py);
        let next = null, turn = 1;
        for (const i of free(key(x, y))) {
          const l = lines[i];
          const fwd = key(l.p[0], l.p[1]) === key(x, y);
          const pts = pointsOf(l, fwd);
          const t = Math.abs(Math.atan2(Math.sin(Math.atan2(pts[1][0] - x, pts[1][1] - y) - dir), Math.cos(Math.atan2(pts[1][0] - x, pts[1][1] - y) - dir)));
          if (t < turn) (turn = t), (next = [i, pts]);
        }
        if (!next) break;
        used.add(next[0]);
        path.push(...next[1].slice(1));
      }
      const route = routeOf(path);
      if (route.length >= OTHER_TRAIN_MIN_M) out.push({ route, look, name });
    }
  }
  return out;
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
// Blender で作った歩行者の部品（tools/build-pedestrian.py）。読み込めたら drawCrowd が部品の形を入れ替え、
// 腰まわり（ズボンの色）・靴・手の部品を足す。部品の色は今までどおり 1 人ずつ（setColorAt）で、目や口は形の頂点の色で暗くする
const PED_MODEL_URL = 'data/models/pedestrian.glb';
const PED_MODEL_NAMES = {
  head: 'PD_Head', hair: 'PD_Hair', torso: 'PD_Torso', hips: 'PD_Hips', leg: 'PD_Leg', shoe: 'PD_Shoe',
  arm: 'PD_Arm', hand: 'PD_Hand', canopy: 'PD_Canopy', stick: 'PD_Stick',
};
const PED_SHOES = '#2b2c31';
let pedModel = null; // 部品 → 形
loadModelParts(PED_MODEL_URL, PED_MODEL_NAMES)
  .then((parts) => {
    const geos = {};
    for (const [key, list] of Object.entries(parts)) geos[key] = addModelParts(new GeometryBuilder(true), list).build();
    pedModel = geos;
  })
  .catch((e) => console.warn(`歩行者のモデルを読み込めませんでした: ${PED_MODEL_URL}`, e));

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

// ---- Blender で作った小物のモデル（車・信号機） ----
// glb の物 names（キー → 物の名前）を読み、物ごとに部品（材質ごとの三角形の座標と材質の色）の並びにする。座標は物の原点から
function loadModelParts(url, names) {
  return new GLTFLoader().loadAsync(url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const parts = {};
    for (const [key, name] of Object.entries(names)) {
      const ob = gltf.scene.getObjectByName(name);
      if (!ob) throw new Error(`${name} がありません`);
      const inv = new THREE.Matrix4().copy(ob.matrixWorld).invert();
      const list = [];
      ob.traverse((m) => {
        if (!m.isMesh) return;
        let geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        if (geo.index) geo = geo.toNonIndexed();
        const { name: material, color } = m.material;
        list.push({ pos: geo.attributes.position.array, color: [color.r, color.g, color.b], material });
      });
      parts[key] = list;
    }
    return parts;
  });
}

// 部品の並び list の三角形を、頂点の色付きで b に足す。colorOf(部品) が部品の色（null ならその部品は足さない）
function addModelParts(b, list, colorOf = (part) => part.color) {
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (const part of list) {
    const color = colorOf(part), P = part.pos;
    if (!color) continue;
    for (let i = 0; i < P.length; i += 9) {
      va.fromArray(P, i);
      vb.fromArray(P, i + 3);
      vc.fromArray(P, i + 6);
      n.subVectors(vb, va).cross(e.subVectors(vc, va)).normalize(); // 面の向き（頂点の回る向きから）
      b.tri(va.toArray(), vb.toArray(), vc.toArray(), n.toArray(), color);
    }
  }
  return b;
}

// Blender で作った車 6 種類（セダン・軽自動車・ミニバン・タクシー・路線バス・トラック。tools/build-cars.py）。読み込めたら、車種と色ごとの形をモデルから作り直す
// （読み込めるまでは下のプログラムで組み立てた形）。1 台を 2 つの立体（車体・ライト）にまとめ、
// 材質の色は頂点の色にする（車が多いので、部品ごとに分けると描く回数が増える）。車体の色の材質は「CV_Paint」
const CAR_MODEL_URL = 'data/models/cars.glb';
const CAR_MODEL_NAMES = { sedan: 'CV_Sedan', kei: 'CV_Kei', minivan: 'CV_Minivan', taxi: 'CV_Taxi', bus: 'CV_Bus', truck: 'CV_Truck' };
let carModel = null; // 車種 → 部品の並び
let carModelGen = 0; // 形を作り直した回数（作り直す前の形の車を入れ替える）
loadModelParts(CAR_MODEL_URL, CAR_MODEL_NAMES)
  .then((parts) => {
    carModel = parts;
    carGeometries.clear();
    carModelGen++;
  })
  .catch((e) => console.warn(`車のモデルを読み込めませんでした: ${CAR_MODEL_URL}`, e));

const carGeometries = new Map(); // 車種と色 → { body, lights }
function carGeometry(look) {
  const key = `${look.type}:${look.color}`;
  let g = carGeometries.get(key);
  if (g) return g;
  const body = new GeometryBuilder(true), lights = new GeometryBuilder(true);
  if (carModel) {
    const paint = rgb(look.color), list = carModel[look.type];
    const isLight = (part) => part.material.startsWith('Light');
    addModelParts(body, list, (part) => (isLight(part) ? null : part.material === 'CV_Paint' ? paint : part.color));
    addModelParts(lights, list, (part) => (isLight(part) ? part.color : null));
    g = { body: body.build(), lights: lights.build(), gen: carModelGen };
    carGeometries.set(key, g);
    return g;
  }
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
  g = { body: body.build(), lights: lights.build(), gen: carModelGen };
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
  car.userData.gen = g.gen;
  return car;
}

// Blender で作った信号機（tools/build-signal.py）。部品ごとの形（頂点の色付き）にして、syncSignals で部品ごとの InstancedMesh にする
// （読み込めるまでは下の syncSignals のプログラムで組み立てた形）。歩行者用の灯は、車用の信号が赤のとき青
const SIGNAL_MODEL_URL = 'data/models/signal.glb';
const SIGNAL_MODEL_NAMES = { pole: 'SG_Pole', arm: 'SG_Arm', head: 'SG_Head', lamp: 'SG_Lamp', pedStop: 'SG_PedStop', pedGo: 'SG_PedGo' };
let signalModel = null; // 部品 → 形
loadModelParts(SIGNAL_MODEL_URL, SIGNAL_MODEL_NAMES)
  .then((parts) => {
    const geos = {};
    for (const [key, list] of Object.entries(parts)) geos[key] = addModelParts(new GeometryBuilder(true), list).build();
    signalModel = geos;
  })
  .catch((e) => console.warn(`信号機のモデルを読み込めませんでした: ${SIGNAL_MODEL_URL}`, e));

// ---- 遠くの目印（Blender で作った東京スカイツリー・レインボーブリッジなど。tools/build-landmarks.py） ----
// 実物の位置（緯度・経度）を区間の地図の座標にし、カメラから実物への向きに、霧の外側・空の球の内側（FAR_TOWER_RADIUS m）まで
// 縮めて置く（カメラを中心に縮めるので、見える向きと大きさの比は実物と同じ。目印として見つけやすいよう FAR_TOWER_SCALE 倍）。
// 遠いほど霧の色にかすませ、夕方・夜はライトアップの色で光らせる。近い（区間の中の）ときは区間の建物があるので出さない
const FAR_TOWER_URL = 'data/models/landmarks.glb';
const FAR_TOWERS = [
  { name: 'LM_Skytree', lat: 35.71006, lon: 139.8107, light: 0x8fd0ff }, // 東京スカイツリー（「粋」の水色）
  { name: 'LM_TokyoTower', lat: 35.65858, lon: 139.74543, light: 0xff8a3c }, // 東京タワー（オレンジのライトアップ）
  { name: 'LM_Sunshine60', lat: 35.72935, lon: 139.71795, light: 0x6a5a40 }, // サンシャイン60
  { name: 'LM_Tocho', lat: 35.68963, lon: 139.69172, light: 0x6a5a40 }, // 東京都庁第一本庁舎
  { name: 'LM_Docomo', lat: 35.68383, lon: 139.70236, light: 0x6a5a40 }, // NTTドコモ代々木ビル
  { name: 'LM_Rainbow', lat: 35.6365, lon: 139.7634, light: 0xdde8ff }, // レインボーブリッジ
  { name: 'LM_Mori', lat: 35.66049, lon: 139.72923, light: 0x7a8aa8 }, // 六本木ヒルズ森タワー
  { name: 'LM_Dome', lat: 35.70564, lon: 139.75189, light: 0xf0f0e0 }, // 東京ドーム
  { name: 'LM_ParkTower', lat: 35.68568, lon: 139.6906, light: 0x6a5a40 }, // 新宿パークタワー
];
const FAR_TOWER_RADIUS = 432; // FOG_FAR より遠く、SKY_RADIUS より近く
const FAR_TOWER_NEAR = 700; // これより近いときは出さない m
const FAR_TOWER_SCALE = 1.5;
let farTowerGeos = null; // 名前 → 形
loadModelParts(FAR_TOWER_URL, Object.fromEntries(FAR_TOWERS.map((t) => [t.name, t.name])))
  .then((parts) => {
    farTowerGeos = {};
    for (const [name, list] of Object.entries(parts)) farTowerGeos[name] = addModelParts(new GeometryBuilder(true), list).build();
  })
  .catch((e) => console.warn(`目印の建物のモデルを読み込めませんでした: ${FAR_TOWER_URL}`, e));

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
  const farTowers = new THREE.Group(); // 遠くの目印の高い建物（placeFarTowers で毎回置き直す）
  scene.add(farTowers);
  const textures = windowTextures(renderer.capabilities.getMaxAnisotropy());
  textures.ground = groundPatterns(); // 路面の模様
  textures.trackBed = trackBedTexture(renderer.capabilities.getMaxAnisotropy()); // 線路の道床
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, FOG_FAR + 50);

  let world = null; // 今の区間の動かない物
  let worldMap = null;
  const player = makeBike();
  const headPool = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: 0x9a8a68, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 8.5), mat);
    m.rotation.order = 'YXZ';
    m.renderOrder = 1;
    return m;
  })();
  // ゴースト：同じ形の半透明の白
  const GHOST_WHITE = { frame: 0xe8ecf4, jersey: 0xe8ecf4, shorts: 0xc9ced8, helmet: 0xffffff, skin: 0xe8ecf4, tire: 0x9aa0aa, metal: 0xd0d4dc, saddle: 0xb0b5bf };
  const ghost = makeBike(GHOST_WHITE, 0.45);
  // ゴーストの見た目（setGhostLook）と、軽さの設定（setQuality）
  const GHOST_LOOKS = { white: { color: 'white', opacity: 0.45 }, glow: { color: 0x3aa8ff, opacity: 0.7, glow: true }, green: { color: 0x9acd32, opacity: 0.5 }, mine: { color: 'mine', opacity: 0.45 } };
  let ghostLook = 'white';
  // hide：隠す飾り（数が多くて、なくても遊ぶのに困らない物の名前）、far：描く距離 m、particles：舞う物の割合
  // 光を重ねる飾り（足し算で重ねるので、重なると描く量が増える）は「軽い」から隠す
  const DECOR_MID = ['upBeam', 'uplight', 'lightArch', 'umbrella0', 'umbrella1', 'grave', 'stoneWall', 'electionBoard', 'noticeBoard', 'parkStall', 'waterTank', 'obstLight', 'cat0', 'cat1', 'cat2', 'benchSitter', 'treeLights', 'fairBulbs', 'pumpkins', 'koinobori', 'tetsubo', 'jungleGym', 'soccerGoal'];
  const DECOR_LOW = [...DECOR_MID, 'adBillboard', 'adBoard', 'crow', 'crowFlyA', 'crowFlyB', 'pigeon', 'pigeonFlyA', 'pigeonFlyB', 'cyclePort', 'arcadeRoof', 'arcadePost', 'izakaya', 'parkedCars', 'taxiQueue', 'hwyPier', 'autoDoors', 'petShop', 'florist', 'tanabata', 'furin'];
  const QUALITY = {
    // cullSmall・cullMedium：小物・中くらいの物を描く距離 m（遠くの小物を描かない）
    high: { pixel: 1, maxPixel: 3, shadows: true, riders: 1, hide: [], far: FOG_FAR + 50, particles: 1, cullSmall: 170, cullMedium: 330 },
    mid: { pixel: 1, maxPixel: 1, shadows: false, riders: 0.5, hide: DECOR_MID, far: FOG_FAR + 50, particles: 0.5, cullSmall: 120, cullMedium: 260 },
    low: { pixel: 0.7, maxPixel: 1, shadows: false, riders: 0.25, hide: DECOR_LOW, far: 300, particles: 0.25, cullSmall: 80, cullMedium: 200 },
  };
  // 遠くの小物を描かない：区間全体に散らばる小物（電柱・ガードパイプ・点字ブロック・墓石など）は、1 つの InstancedMesh に
  // 区間のぶん全部が入っているので、画面の外でも遠くでも描いてしまう。カメラから一定の距離の物だけを並べ直して描く。
  // 大きさ（形の半径）で距離を変える。動かす物（鳥・自動ドア）は対象外。カメラが CULL_MOVE m 動くたびに並べ直す
  const CULL_SKIP = new Set(['crow', 'crowFlyA', 'crowFlyB', 'pigeon', 'pigeonFlyA', 'pigeonFlyB', 'autoDoors', 'goalConfetti']);
  const CULL_MOVE = 15;
  const cull = { list: [], group: null, at: null, far: 0 };
  function setupDistanceCull(group) {
    cull.list = [];
    cull.group = group;
    cull.at = null;
    if (!group) return;
    group.traverse((o) => {
      if (!o.isInstancedMesh || o.count < 30 || CULL_SKIP.has(o.name) || o.userData.cull) return;
      const geo = o.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const size = geo.boundingSphere.radius;
      if (size > 14) return; // 大きな物（建物のまとまりなど）は対象外
      const n = o.count, mats = o.instanceMatrix.array.slice(0, n * 16), cols = o.instanceColor ? o.instanceColor.array.slice(0, n * 3) : null;
      const centers = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) (centers[2 * i] = mats[16 * i + 12]), (centers[2 * i + 1] = mats[16 * i + 14]);
      o.userData.cull = { n, mats, cols, centers, small: size < 2.5 };
      cull.list.push(o);
    });
  }
  function updateDistanceCull(force) {
    if (!cull.list.length) return;
    const c = camera.position;
    if (!force && cull.at && Math.hypot(c.x - cull.at[0], c.z - cull.at[1]) < CULL_MOVE) return;
    cull.at = [c.x, c.z];
    for (const o of cull.list) {
      const d = o.userData.cull, R = d.small ? quality.cullSmall : quality.cullMedium, R2 = R * R;
      const M = o.instanceMatrix.array, C = o.instanceColor?.array;
      let k = 0;
      for (let i = 0; i < d.n; i++) {
        const dx = d.centers[2 * i] - c.x, dz = d.centers[2 * i + 1] - c.z;
        if (dx * dx + dz * dz > R2) continue;
        if (k !== i) {
          M.set(d.mats.subarray(16 * i, 16 * i + 16), 16 * k);
          if (C && d.cols) C.set(d.cols.subarray(3 * i, 3 * i + 3), 3 * k);
        }
        k++;
      }
      o.count = k;
      o.instanceMatrix.needsUpdate = true;
      if (o.instanceColor) o.instanceColor.needsUpdate = true;
      o.boundingSphere = null; // 画面の外かどうかの判定用の球を、並べ直した物で作り直させる
    }
  }

  // 区間の立体に、軽さの設定の「隠す飾り」を当てる（作り終えたときと、設定を変えたとき）。
  // visible は少しずつ見せる仕組み（reveal）と季節・天気の出し分けが使うので、隠すのは描く層（layers）を 1 にして行う
  const HIDDEN_LAYER = 1;
  function applyQualityTo(group) {
    if (!group) return;
    const hide = new Set(quality.hide);
    group.traverse((o) => {
      if (!o.name || o === group) return;
      const hidden = hide.has(o.name);
      if (o.userData.qualityHidden === hidden || (o.userData.qualityHidden === undefined && !hidden)) return;
      o.userData.qualityHidden = hidden;
      o.traverse((c) => c.layers.set(hidden ? HIDDEN_LAYER : 0));
    });
  }

  let quality = QUALITY.high;
  // 影：「ふつう」の晴れた昼と夕方だけ。夜や雨・雪の日は影がほとんど見えないので、影を描く手間（毎回もう 1 回描く）を省く。
  // 夜や雨では castShadow は変えず（変えるとすべての材質を作り直すので、そのあいだ画面が止まる）、影の地図を描き直すのをやめて、
  // 影の濃さを 0 にする。castShadow を変えるのは、軽さの設定を変えたときだけ
  let shadowAtmosphere = true;
  function updateShadows() {
    if (!shadows) return;
    sun.castShadow = quality.shadows;
    renderer.shadowMap.autoUpdate = shadowAtmosphere;
    sun.shadow.intensity = shadowAtmosphere ? 1 : 0;
  }
  let fogFarBase = FOG_FAR; // 天気で決まる霧の遠さ（軽さの設定で、これより近くにすることがある）
  let lastDpr = window.devicePixelRatio || 1;
  let fps = 60; // 画面の滑らかさ（1 秒に描く回数。なめらかにした値）
  scene.add(player, ghost, headPool);
  let ghostPrev = null; // ゴーストの速さを求めるための前回の位置
  let bikeH = 0, ghostH = 0; // 自転車・ゴーストの高さ m（橋の上で上がる）
  const train = [];
  const trainGroup = new THREE.Group();
  scene.add(trainGroup);
  const otherTrains = { map: null, list: [], group: new THREE.Group() }; // ほかの路線の電車
  scene.add(otherTrains.group);
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
  // レース中はなめらかさを優先し、メニュー（タイトル・区間選択・結果）では待ち時間を短くするのを優先する
  const BUILD_BUDGET_MS = { race: 10, menu: 30 }; // 1 回の描画で作るのに使う時間（今の区間）
  const BACKGROUND_BUDGET_MS = { race: 0, menu: 12 }; // 先に作っておく区間に使う時間（レース中は使わない）
  // 1 回の描画で見せる（GPU へ送る）部品の数。送るのは描くときなので重さは前もって測れない。
  // メニューでは、前の描画が軽ければ増やし、重ければ減らす（1 回 1/15 秒くらいまで）
  const REVEAL_PER_FRAME = 6;
  const REVEAL_MAX = 80;
  const REVEAL_FRAME_S = 1 / 15;
  let revealCount = REVEAL_PER_FRAME;
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
          if (m.userData.shared) return;
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
    applyQualityTo(world);
    setupDistanceCull(world);
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

  // 見せる前に、区間の材質の描き方（シェーダー）を裏で作っておく。初めて描くときに作ると、
  // その 1 回の描画で数秒止まる（初めての区間でいちばん重い）。できていれば true
  function compiled(w) {
    if (!w.compiling) {
      w.compiling = renderer
        .compileAsync(w.group, camera, scene)
        .catch(() => {}) // 作れなくても、描くときに作られるので先へ進む
        .then(() => (w.compiled = true));
    }
    return Boolean(w.compiled);
  }

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

  // 毎回の描画で：今の区間を作り進め、できたら少しずつ見せる。手が空いていれば先の区間も作る。
  // dt は前の描画からの秒数（見せる部品の数を決める）
  function advanceWorlds(game, dt) {
    const mode = game.state === 'racing' || game.state === 'countdown' ? 'race' : 'menu';
    revealCount =
      mode === 'race' ? REVEAL_PER_FRAME
      : dt < REVEAL_FRAME_S ? Math.min(REVEAL_MAX, Math.ceil(revealCount * 1.5))
      : Math.max(REVEAL_PER_FRAME, Math.floor(revealCount / 2));
    const w = worldFor(worldMap);
    if (!w.group) {
      build(w, BUILD_BUDGET_MS[mode]);
      if (w.group) {
        world = w.group;
        scene.add(world);
        applyQualityTo(world);
        setupDistanceCull(world);
        signalMeshes.obs = null;
      }
    }
    if (w.group && w.revealed < w.group.children.length) {
      if (compiled(w)) reveal(w, revealCount, true);
    }
    // 手が空いていれば（今の区間ができていて、レース中でなければ）先の区間を作り、GPU へ送っておく
    else if (progressOf(worldMap) === null && mode === 'menu') {
      const next = [...worlds.values()].find((o) => o !== w && (!o.group || o.revealed < o.group.children.length));
      if (next && !next.group) build(next, BACKGROUND_BUDGET_MS[mode]);
      else if (next && compiled(next)) reveal(next, revealCount, false);
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
    model: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), // Blender の信号機（色は頂点の色）
  };
  const sigTmp = { base: new THREE.Matrix4(), local: new THREE.Matrix4(), out: new THREE.Matrix4(), color: new THREE.Color() };

  // 遠くの目印の高い建物を、今の区間の地図の座標でカメラから見える向きに置く
  const farTowerHaze = new THREE.Color();
  function placeFarTowers() {
    const origin = worldMap?.origin;
    if (!farTowerGeos || !origin) {
      farTowers.visible = false;
      return;
    }
    farTowers.visible = true;
    if (!farTowers.children.length) {
      for (const t of FAR_TOWERS) {
        const mesh = new THREE.Mesh(farTowerGeos[t.name], new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
        mesh.userData.tower = t;
        farTowers.add(mesh);
      }
    }
    const cam = camera.position, fog = scene.fog;
    const mPerDegLon = 111320 * Math.cos((origin.lat * Math.PI) / 180); // tools/fetch-osm.mjs の toXY と同じ
    for (const mesh of farTowers.children) {
      const t = mesh.userData.tower;
      const dx = (t.lon - origin.lon) * mPerDegLon - cam.x, dz = -(t.lat - origin.lat) * 110540 - cam.z;
      const dist = Math.hypot(dx, dz);
      mesh.visible = dist > FAR_TOWER_NEAR;
      if (!mesh.visible) continue;
      const k = FAR_TOWER_RADIUS / dist;
      mesh.position.set(cam.x + dx * k, cam.y * (1 - k), cam.z + dz * k);
      mesh.scale.setScalar(k * FAR_TOWER_SCALE);
      // かすみ：遠いほど、霧が濃い（雨・雪）ほど霧の色に寄せる。夕方・夜はライトアップ
      const haze = Math.min(0.9, (0.25 + dist / 30000) * (FOG_FAR / fog.far));
      mesh.material.color.setScalar(1 - haze);
      mesh.material.emissive.copy(fog.color).multiplyScalar(haze).add(farTowerHaze.set(t.light).multiplyScalar(windowGlow * 0.45));
    }
  }

  function syncSignals(obs) {
    if ((signalMeshes.obs === obs && signalMeshes.model === signalModel) || !world) return;
    for (const m of Object.values(signalParts)) {
      signalGroup.remove(m);
      m.dispose();
    }
    for (const key of Object.keys(signalParts)) delete signalParts[key];
    signalMeshes = [];
    signalMeshes.obs = obs;
    signalMeshes.model = signalModel;
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
    const sm = signalModel;
    const pad = make('pad', sigGeo.pad, sigMat.pad);
    const pole = sm ? make('pole', sm.pole, sigMat.model, true) : make('pole', sigGeo.pole, sigMat.pole, true);
    const arm = sm ? make('arm', sm.arm, sigMat.model, true) : make('arm', sigGeo.arm, sigMat.pole, true);
    const box = sm ? make('box', sm.head, sigMat.model, true) : make('box', sigGeo.box, sigMat.box, true);
    const lamps = LAMPS.map((l, i) => make(`lamp${i}`, sm ? sm.lamp : sigGeo.lamp, sigMat.lamp));
    const peds = sm ? [make('pedStop', sm.pedStop, sigMat.lamp), make('pedGo', sm.pedGo, sigMat.lamp)] : []; // 歩行者用の灯（柱に付く）
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
      for (const ped of peds) put(ped, -reach, 0, 0);
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
      // 歩行者用：車用が赤のときだけ青（歩く人）、それ以外は赤（立ち止まる人）
      const [go, , stop] = LAMPS;
      signalParts.pedStop?.setColorAt(i, color.set(st !== 'red' ? stop.on : stop.off));
      signalParts.pedGo?.setColorAt(i, color.set(st === 'red' ? go.on : go.off));
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
      if (m && m.userData.gen !== carModelGen) {
        // 車のモデルが読み込めたら、それまでの形の車を入れ替える
        agentGroup.remove(m);
        m = null;
      }
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
  // 歩行者の部品の形を Blender のモデルに入れ替え、足りない部品（腰まわり・靴・手）を足す
  function usePedModel() {
    const g = pedModel;
    const swap = (key, geo) => {
      crowd[key].geometry = geo;
      crowd[key].material.vertexColors = true;
      crowd[key].material.needsUpdate = true;
    };
    swap('head', g.head);
    swap('hair', g.hair);
    swap('torso', g.torso);
    swap('legL', g.leg);
    swap('legR', g.leg);
    swap('armL', g.arm);
    swap('armR', g.arm);
    swap('canopy', g.canopy);
    swap('stick', g.stick);
    for (const [key, geo] of [['hips', g.hips], ['shoeL', g.shoe], ['shoeR', g.shoe], ['handL', g.hand], ['handR', g.hand]]) {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), MAX_PEDS);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      crowd[key] = m;
      scene.add(m);
    }
  }

  // 歩行者の持ち物（スーツのかばんとネクタイ・学生の背中のかばん・旅行者のスーツケース・散歩の犬）を足す
  const PED_ITEMS = { briefcase: 'suit', tie: 'suit', backpack: 'student', suitcase: 'tourist', dog: 'dog' };
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  function usePedItems() {
    for (const key of Object.keys(PED_ITEMS)) {
      const m = new THREE.InstancedMesh(cityModel.geos[key].body, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_PEDS);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      crowd[key] = m;
      scene.add(m);
    }
  }

  function drawCrowd(peds) {
    if (pedModel && !crowd.hips) usePedModel();
    if (crowd.hips && cityModel.geos && !crowd.dog) usePedItems();
    const model = Boolean(crowd.hips);
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
      if (model) put(crowd.hair, i, 0, 1.56, 0); // Blender の髪は頭と同じ原点
      else put(crowd.hair, i, 0, 1.585, 0.015);
      if (model) {
        put(crowd.hips, i, 0, PED.hip + 0.3, 0);
        put(crowd.shoeL, i, -0.1, PED.hip, 0, swing * PED.legSwing);
        put(crowd.shoeR, i, 0.1, PED.hip, 0, -swing * PED.legSwing);
        put(crowd.handL, i, -0.25, PED.shoulder, 0, -swing * PED.armSwing);
        put(crowd.handR, i, 0.25, PED.shoulder, 0, rain ? 0.9 : swing * PED.armSwing);
        color(crowd.hips, i, look.pants);
        color(crowd.shoeL, i, PED_SHOES);
        color(crowd.shoeR, i, PED_SHOES);
        color(crowd.handL, i, look.skin);
        color(crowd.handR, i, look.skin);
      }
      if (crowd.dog) {
        // 持ち物：その種類の人だけ（ほかの人は大きさ 0 で隠す）。かばんは左手（右手は雨の日の傘）
        for (const [key, role] of Object.entries(PED_ITEMS)) {
          if (look.role !== role) {
            crowd[key].setMatrixAt(i, HIDE);
            continue;
          }
          if (key === 'briefcase') put(crowd[key], i, -0.25, PED.shoulder, 0, -swing * PED.armSwing);
          else if (key === 'tie' || key === 'backpack') put(crowd[key], i, 0, PED.hip + 0.3, 0);
          else put(crowd[key], i, 0, 0, 0);
        }
      }
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

  // ほかの路線の電車を進める。線の端から入って反対の端へ抜け、しばらく待って逆向きに走る
  function syncOtherTrains(dt) {
    if (!otherTrainParts || !worldMap || !city2.done) return;
    if (otherTrains.map !== worldMap) {
      otherTrains.group.clear();
      otherTrains.map = worldMap;
      otherTrains.list = otherTrainLines(worldMap).map(({ route, look, name }, i) => {
        const [, band, band2, shinkansen, special, specialLen, specialCars, specialSpeed] = look;
        const own = special && city2.geos?.[special]; // 新交通・モノレール・路面電車
        const carLen = own ? specialLen : shinkansen ? 25 : 20;
        const n = own ? Math.max(1, Math.min(specialCars, Math.floor(route.length / 2 / carLen))) : Math.max(3, Math.min(shinkansen ? 8 : 10, Math.floor(route.length / 2 / carLen)));
        const speed = own ? specialSpeed : shinkansen ? 28 : 17; // m/s（街の中なので実物よりゆっくり）
        const lead = own || otherTrainGeometry(shinkansen ? 'skLead' : 'lead', band, band2);
        const middle = own || otherTrainGeometry(shinkansen ? 'skMiddle' : 'middle', band, band2);
        const cars = [];
        for (let k = 0; k < n; k++) {
          const g = k === 0 || k === n - 1 ? lead : middle;
          const car = new THREE.Group();
          const body = new THREE.Mesh(g.body, OTHER_TRAIN_MAT);
          body.castShadow = true;
          car.add(body);
          if (g.glow) car.add(new THREE.Mesh(g.glow, OTHER_TRAIN_GLOW));
          car.userData.back = !own && k === n - 1; // 最後尾は先頭車を後ろ向きに
          car.userData.commuter = !own && !shinkansen; // 窓に乗客の影を付ける（syncPassengers）
          cars.push(car);
          otherTrains.group.add(car);
        }
        // 走り始めの位置は線ごとにずらす（いっせいに走り出さないように）
        const total = route.length + n * carLen;
        const v = Math.sin(i * 91.7 + route.length) * 43758.5453;
        return { name, route, cars, carLen, speed, d: (v - Math.floor(v)) * total * 1.5 - total * 0.3, dir: i % 2 ? 1 : -1, total };
      });
    }
    const cam = camera.position;
    for (const t of otherTrains.list) {
      t.d += t.speed * dt;
      if (t.d > t.total) {
        t.d = -t.speed * (15 + 25 * Math.random()); // 15〜40 秒待って、逆向きに走る
        t.dir = -t.dir;
      }
      const at = (s) => pointAt(t.route, t.dir > 0 ? s : t.route.length - s);
      const mid = at(Math.max(0, Math.min(t.route.length, t.d - (t.cars.length * t.carLen) / 2)));
      const near = Math.hypot(mid.x - cam.x, mid.y - cam.z) < OTHER_TRAIN_DRAW_M + t.cars.length * t.carLen;
      t.cars.forEach((car, k) => {
        const s0 = t.d - t.carLen * k, s1 = t.d - t.carLen * (k + 1);
        car.visible = near && s1 >= 0 && s0 <= t.route.length;
        if (!car.visible) return;
        const head = at(s0 - 0.4), tail = at(s1 + 0.4);
        car.position.set((head.x + tail.x) / 2, (head.h + tail.h) / 2 + Y.rail + RAIL_TOP, (head.y + tail.y) / 2);
        car.rotation.order = 'YXZ';
        car.rotation.y = -Math.atan2(head.x - tail.x, -(head.y - tail.y)) + (car.userData.back ? Math.PI : 0);
        car.rotation.x = Math.atan2(head.h - tail.h, t.carLen) * (car.userData.back ? -1 : 1);
      });
    }
  }

  // ---- 自転車とぶつかる動く物：毎フレーム、自転車の近く（MOVER_NEAR 以内）の物を置き直す。game.js が hitTest で調べる ----
  // { type: 'car' | 'moto' | 'cycle' | 'ped', x, z, h, hx, hz, r, extra }：向き (hx, hz) に ±extra 伸ばした線から r 以内でぶつかる
  const movers = [];
  const MOVER_NEAR = 15;
  const MOVER_PAD = 0.5; // 自転車の幅の半分くらい m
  function addMover(type, x, z, h, hx, hz, r, extra = 0) {
    if (Math.abs(x - lastPlayer.x) > MOVER_NEAR || Math.abs(z - lastPlayer.y) > MOVER_NEAR) return;
    movers.push({ type, x, z, h, hx, hz, r, extra });
  }
  let lastPlayer = { x: 0, y: 0 };

  // ---- 道を走るほかの自転車・バイク・配達のスクーター（ゲームの乱数を使わない。ぶつかるとペナルティ：RIDER_HIT） ----
  // 自転車は歩道と細い道、バイクとスクーターは車道を、道のつながりに沿って走る。自転車のまわりに出し、離れたら消す
  // 同時に走らせる数（緊急車両はときどき 1 台）。dog は犬の散歩、vendor は石焼いも・古紙回収の軽トラ、mikoshi は縁日の近くのおみこし
  // big は観光バス・タンクローリー・引っ越し・ゴミ収集車・宣伝トラック、jogger・stroller・courier は歩道の人、cargo は自転車便
  // pupil は学校の近くの下校する子ども、bather は銭湯の近くの湯おけを持つ人
  // police は白い自転車で見回りをするおまわりさん、daycare は保育園のお散歩カート
  // election は手を振る人を乗せてゆっくり走る選挙カー
  // plow は雪の日だけ走る除雪車
  const RIDERS = { cycle: 8, motor: 5, emergency: 1, dog: 3, vendor: 1, mikoshi: 1, big: 2, jogger: 2, stroller: 1, courier: 1, cargo: 1, pupil: 2, bather: 1, police: 1, daycare: 1, election: 1, plow: 2 };
  const ON_FOOT = new Set(['cycle', 'dog', 'mikoshi', 'jogger', 'stroller', 'courier', 'cargo', 'pupil', 'bather', 'police', 'daycare']); // 一方通行を気にしない
  const BIKERS = new Set(['cycle', 'police']); // 自転車の形で、ペダルをこぐ
  const BIG_CARS = ['openBus', 'tanker', 'mover', 'garbage', 'adTruck'];
  const WALKERS = new Set(['dog', 'jogger', 'stroller', 'courier', 'pupil', 'bather', 'daycare']); // 歩道の端を歩く
  // 施設の近くにだけ出す人（自転車から 300m 以内の施設のまわり 60m）
  const NEAR_PLACE = { pupil: 'schools', bather: 'baths' };
  const EMERGENCY = [['police', 'policeLamp'], ['ambulance', 'ambLamp'], ['fire', 'fireLamp']];
  // ぶつかったときのペナルティの種類
  const RIDER_HIT = {
    cycle: 'cycle', police: 'cycle', cargo: 'cycle', motor: 'moto',
    emergency: 'car', vendor: 'car', big: 'car', election: 'car', plow: 'car',
    dog: 'ped', jogger: 'ped', stroller: 'ped', courier: 'ped', pupil: 'ped', bather: 'ped', daycare: 'ped', mikoshi: 'ped',
  };
  const RIDER_SPAWN = [50, 170]; // 出す距離 m（自転車からの）
  const RIDER_DESPAWN = 230;
  const riders = { list: [], pool: Object.fromEntries(Object.keys(RIDERS).map((k) => [k, []])), emWait: 20, clock: 0 };
  const CYCLE_COLORS = [0x2f6fd0, 0xe0e0e0, 0x1b1d22, 0xd03a3a, 0x3aa060, 0xe8b830, 0xd070a0];
  function riderObject(kind) {
    const pool = riders.pool[kind];
    const free = pool.find((o) => !o.userData.used);
    if (free) return free;
    let o;
    if (kind === 'police') {
      o = makeBike({ frame: 0xf4f4f4, jersey: 0x24345a, shorts: 0x24345a, helmet: 0xf4f4f4 }, 1, 'city'); // 白い自転車・紺の制服・白いヘルメット
    } else if (kind === 'plow') {
      const g = city12.geos;
      if (!g) return null;
      o = new THREE.Group();
      const body = new THREE.Mesh(g.snowPlow.body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      o.userData.lamp = new THREE.Mesh(g.snowPlow.glow, STREET_GLOW_MAT); // 回転灯（点滅）
      o.add(o.userData.lamp);
      o.userData.body = body;
    } else if (kind === 'election') {
      const g = city11.geos;
      if (!g) return null;
      o = new THREE.Group();
      const body = new THREE.Mesh(g.electionVan.body, STREET_MAT);
      body.castShadow = true;
      const waver = new THREE.Mesh(g.waver.body, STREET_MAT);
      waver.position.set(-0.95, 1.55, 0.4); // 左の窓から（歩道の側）
      waver.rotation.y = Math.PI / 2;
      o.add(body, waver);
      o.userData.waver = waver;
      o.userData.body = body;
    } else if (kind === 'daycare') {
      const g = city10.geos;
      if (!g) return null;
      o = new THREE.Group();
      const body = new THREE.Mesh(g.daycareCart.body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      o.userData.bob = 0.012;
      o.userData.body = body;
    } else if (kind === 'cycle') {
      const c = CYCLE_COLORS[pool.length % CYCLE_COLORS.length], j = CYCLE_COLORS[(pool.length * 3 + 2) % CYCLE_COLORS.length];
      o = makeBike({ frame: c, jersey: j, helmet: CYCLE_COLORS[(pool.length + 4) % CYCLE_COLORS.length], shorts: 0x2a2f3a });
    } else if (kind === 'pupil' || kind === 'bather') {
      const g = city8.geos;
      if (!g) return null;
      const key = kind === 'pupil' ? 'pupils' : 'bather';
      o = new THREE.Group();
      const body = new THREE.Mesh(g[key].body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      o.userData.bob = 0.03;
      o.userData.body = body;
    } else if (['big', 'jogger', 'stroller', 'courier', 'cargo'].includes(kind)) {
      const g = city6.geos;
      if (!g) return null;
      const key = kind === 'big' ? BIG_CARS[pool.length % BIG_CARS.length] : kind === 'cargo' ? 'cargoBike' : kind;
      o = new THREE.Group();
      const body = new THREE.Mesh(g[key].body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      if (g[key].glow) o.add(new THREE.Mesh(g[key].glow, STREET_GLOW_MAT));
      if (key === 'adTruck') {
        // 荷台の両側の光る看板（大型ビジョンと同じ画）
        for (const s of [-1, 1]) {
          const ad = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.0), VISION_MAT);
          ad.position.set(s * 1.275, 2.2, 1.5);
          ad.rotation.y = (s * Math.PI) / 2;
          o.add(ad);
        }
      }
      o.userData.bob = { jogger: 0.07, stroller: 0.015, courier: 0.015 }[kind] ?? 0;
      o.userData.body = body;
    } else if (kind === 'dog' || kind === 'vendor' || kind === 'mikoshi') {
      const g = city5.geos;
      if (!g) return null;
      const key = kind === 'dog' ? `dogWalk${pool.length % 2}` : kind === 'vendor' ? (pool.length % 2 ? 'chirigami' : 'yakiimo') : 'mikoshi';
      o = new THREE.Group();
      const body = new THREE.Mesh(g[key].body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      if (g[key].glow) o.add(new THREE.Mesh(g[key].glow, STREET_GLOW_MAT));
      o.userData.bob = { dog: 0.025, vendor: 0, mikoshi: 0.12 }[kind]; // 歩く・担ぐ上下の揺れ m
      o.userData.body = body;
    } else if (kind === 'emergency') {
      // パトカー・救急車・消防車（回転灯は点滅させる）
      const [bodyKey, lampKey] = EMERGENCY[pool.length % EMERGENCY.length];
      const g = city2.geos;
      if (!g) return null;
      o = new THREE.Group();
      const body = new THREE.Mesh(g[bodyKey].body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      if (g[bodyKey].glow) o.add(new THREE.Mesh(g[bodyKey].glow, STREET_GLOW_MAT));
      o.userData.lamp = new THREE.Mesh(g[lampKey].glow, STREET_GLOW_MAT);
      o.add(o.userData.lamp);
    } else {
      const g = townModel.geos?.[pool.length % 2 ? 'motorbike' : 'scooter'];
      if (!g) return null;
      o = new THREE.Group();
      const body = new THREE.Mesh(g.body, STREET_MAT);
      body.castShadow = true;
      o.add(body);
      if (g.glow) o.add(new THREE.Mesh(g.glow, STREET_GLOW_MAT));
    }
    // 歩く人は足を振る（syncRiders で進んだ距離に合わせる）
    if ((WALKERS.has(kind) || kind === 'mikoshi') && o.userData.body) {
      o.userData.body.geometry = walkingGeometry(o.userData.body.geometry);
      o.userData.body.material = walkMaterial(false);
    }
    // ぶつかる範囲：作ったときの大きさ（前は -z）から。長い物は前後に伸ばす
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), w = box.max.x - box.min.x, l = box.max.z - box.min.z;
    // 自転車の形はライトなどの部品で大きさが広く出るので、ふつうの自転車の大きさ（長さ 1.7m・幅 0.6m）にする
    o.userData.hitR = BIKERS.has(kind) ? 0.3 + MOVER_PAD : w / 2 + MOVER_PAD;
    o.userData.hitExtra = BIKERS.has(kind) ? 0.55 : Math.max(0, l / 2 - w / 2);
    scene.add(o);
    pool.push(o);
    return o;
  }
  const riderRoad = (kind, r) =>
    BIKERS.has(kind) || kind === 'cargo' || WALKERS.has(kind)
      ? r.path || r.w < 8
      : kind === 'big'
        ? !r.path && r.w >= 7
      : kind === 'vendor'
        ? !r.path && r.w >= 4 && r.w < 9
        : kind === 'mikoshi'
          ? r.w <= 12
          : !r.path && r.w >= (kind === 'emergency' ? 6 : 5);
  function spawnRider(kind, map, p) {
    // おみこしは、自転車から 300m 以内の縁日のそばにだけ出す
    let cx = p.x, cy = p.y, ring = RIDER_SPAWN;
    if (kind === 'mikoshi') {
      const f = (world?.userData.festivals ?? []).find((f) => Math.hypot(f.x - p.x, f.z - p.y) < 300);
      if (!f) return;
      (cx = f.x), (cy = f.z), (ring = [0, 30]);
    }
    if (NEAR_PLACE[kind]) {
      const at = (world?.userData[NEAR_PLACE[kind]] ?? []).find(([x, z]) => Math.hypot(x - p.x, z - p.y) < 300);
      if (!at) return;
      [cx, cy] = at;
      ring = [5, 60];
    }
    for (let tries = 0; tries < 15; tries++) {
      const a = Math.random() * Math.PI * 2, d = ring[0] + Math.random() * (ring[1] - ring[0]);
      const cell = map.cells.get(cellKey(cx + Math.sin(a) * d, cy - Math.cos(a) * d));
      const segs = cell?.segs.filter((sg) => riderRoad(kind, sg.road) && !sg.road.e) ?? [];
      if (!segs.length) continue;
      const sg = segs[Math.floor(Math.random() * segs.length)];
      const r = sg.road, dir = r.o && !ON_FOOT.has(kind) ? r.o : Math.random() < 0.5 ? 1 : -1;
      const o = riderObject(kind);
      if (!o) return;
      o.userData.used = true;
      o.visible = true;
      const len = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
      const speed = {
        cycle: 3.5 + Math.random() * 2.5, police: 3.2, daycare: 0.7, emergency: 12 + Math.random() * 2, dog: 1.1 + Math.random() * 0.3, vendor: 2.2 + Math.random() * 0.6, mikoshi: 0.7,
        big: 7 + Math.random() * 2, election: 3.5, plow: 4.5, jogger: 2.6 + Math.random() * 0.6, stroller: 1.0, courier: 1.2, cargo: 4 + Math.random(), pupil: 1.0, bather: 0.9,
      }[kind] ?? 8 + Math.random() * 4;
      riders.list.push({ kind, o, road: r, v: dir > 0 ? sg.v : sg.v + 1, dir, s: Math.random() * len, speed, side: Math.random(), life: kind === 'emergency' ? 30 : Infinity });
      return;
    }
  }
  function syncRiders(game, dt) {
    const map = worldMap;
    if (!map || !game.map || game.map !== map) return;
    const p = game.player;
    riders.clock += dt;
    riders.emWait -= dt;
    riders.list = riders.list.filter((rd) => {
      rd.life -= dt;
      const far = Math.hypot(rd.o.position.x - p.x, rd.o.position.z - p.y) > RIDER_DESPAWN || rd.life < 0;
      if (far) (rd.o.userData.used = false), (rd.o.visible = false);
      if (far && rd.o.userData.dispose) scene.remove(rd.o); // 出動した消防車は使い回さない
      if (!far && rd.kind === 'plow' && currentWeather !== 'snow') (rd.o.userData.used = false), (rd.o.visible = false), (rd.life = -1); // 雪がやんだら除雪車は帰る
      return !far;
    });
    for (const kind of Object.keys(RIDERS)) {
      const n = riders.list.filter((rd) => rd.kind === kind).length;
      if (n >= Math.round(RIDERS[kind] * quality.riders) || (kind === 'emergency' && riders.emWait > 0)) continue;
      if (kind === 'plow' && currentWeather !== 'snow') continue; // 除雪車は雪の日だけ
      spawnRider(kind, map, p);
      if (kind === 'emergency') riders.emWait = 45 + Math.random() * 45; // 次の緊急車両まで
    }
    for (const rd of riders.list) {
      // 信号を守る：自転車・バイク・車は赤と黄で、歩く人は青と黄で手前に止まる（緊急車両は止まらない）
      rd.waiting = rd.hx !== undefined && rd.kind !== 'emergency' && game.obstacles &&
        waitsAtSignal(game.obstacles, rd.x, rd.z, rd.hx, rd.hz, rd.road.w / 2 + 2, rd.o.userData.hitExtra, WALKERS.has(rd.kind) || rd.kind === 'mikoshi');
      // 道に沿って進む。道の端の点に着いたら、つながる道（同じ種類）へ。なければ引き返す
      let dist = rd.waiting ? 0 : rd.speed * dt;
      for (let guard = 0; dist > 0 && guard < 10; guard++) {
        const r = rd.road, n = r.p.length / 2, nv = rd.v + rd.dir;
        if (nv < 0 || nv >= n) {
          const key = nodeKey(r.p[2 * rd.v], r.p[2 * rd.v + 1]);
          const opts = [];
          for (const nd of map.nodes.get(key) ?? []) {
            if (nd.road === r || !riderRoad(rd.kind, nd.road) || nd.road.e) continue;
            for (const d of [1, -1]) {
              const u = nd.v + d;
              if (u >= 0 && u < nd.road.p.length / 2 && !(!ON_FOOT.has(rd.kind) && nd.road.o && nd.road.o !== d)) opts.push([nd.road, nd.v, d]);
            }
          }
          if (opts.length) [rd.road, rd.v, rd.dir] = opts[Math.floor(Math.random() * opts.length)];
          else rd.dir = -rd.dir;
          rd.s = 0;
          continue;
        }
        const len = Math.hypot(r.p[2 * nv] - r.p[2 * rd.v], r.p[2 * nv + 1] - r.p[2 * rd.v + 1]);
        if (rd.s + dist < len) (rd.s += dist), (dist = 0);
        else (dist -= len - rd.s), (rd.v = nv), (rd.s = 0);
      }
      const r = rd.road, nv = Math.max(0, Math.min(r.p.length / 2 - 1, rd.v + rd.dir));
      const x1 = r.p[2 * rd.v], z1 = r.p[2 * rd.v + 1], x2 = r.p[2 * nv], z2 = r.p[2 * nv + 1];
      const len = Math.hypot(x2 - x1, z2 - z1) || 1;
      const hx = (x2 - x1) / len, hz = (z2 - z1) / len;
      // 左側通行：進む向きの左に寄る（自転車は道の端、バイクは車線の真ん中）
      const off = r.path ? (rd.side - 0.5) * r.w * 0.5 : BIKERS.has(rd.kind) || rd.kind === 'cargo' || WALKERS.has(rd.kind) ? r.w * 0.4 : rd.kind === 'mikoshi' ? 0 : r.w * 0.28;
      const x = x1 + hx * rd.s + hz * off, z = z1 + hz * rd.s - hx * off;
      const t = rd.s / len;
      const h = rd.dir > 0 ? roadHeightAt(roadH(), r, rd.v, t) : roadHeightAt(roadH(), r, nv, 1 - t);
      const angle = Math.atan2(hx, -hz);
      Object.assign(rd, { x, z, hx, hz });
      addMover(RIDER_HIT[rd.kind] ?? 'car', x, z, h, hx, hz, rd.o.userData.hitR, rd.o.userData.hitExtra);
      if (BIKERS.has(rd.kind)) animateBike(rd.o, { x, y: z, angle }, rd.waiting ? 0 : rd.speed, dt, h);
      else {
        const step = rd.kind === 'mikoshi' ? 3.2 : rd.kind === 'jogger' ? 9 : 7; // 上下に揺れる速さ（歩く・走る・担ぐ）
        const bob = rd.o.userData.bob && !rd.waiting ? Math.abs(Math.sin(riders.clock * step + rd.side * 10)) * rd.o.userData.bob : 0;
        rd.o.position.set(x, h + bob, z);
        rd.o.rotation.y = -angle;
        const swing = rd.o.userData.body?.material.userData.swing;
        if (swing) swing.value = stepSwing((rd.stride ??= {}), rd.waiting ? 0 : rd.speed * dt, rd.kind === 'jogger' ? 1.0 : 0.7, rd.kind === 'jogger' ? 0.55 : 0.4);
        if (rd.kind === 'mikoshi') rd.o.userData.body.rotation.z = Math.sin(riders.clock * 1.6) * 0.06; // わっしょいと左右に揺らす
        if (rd.o.userData.waver) rd.o.userData.waver.rotation.z = Math.sin(riders.clock * 5) * 0.35; // 手を振る
        if (rd.o.userData.lamp) rd.o.userData.lamp.visible = Math.floor(riders.clock * 4) % 2 === 0; // 回転灯の点滅
      }
    }
  }

  // ---- 空を飛ぶ物：飛行機・ヘリコプター（遠く。霧の外側に向きと大きさの比を保って置く）と、鳥の群れ（近く） ----
  // 飛行機とヘリは、空の高さ elev の所を、方角 from から to へ横切る。しばらく待って次が飛ぶ。見た目だけ
  const sky2 = { group: new THREE.Group(), flyers: [], birds: [], t: 0 };
  scene.add(sky2.group);
  const FLYER_R = 425; // 置く距離（霧の外側・空の球の内側）
  function newFlight(f) {
    const heli = f.kind === 'heli';
    const from = Math.random() * Math.PI * 2;
    const turn = (heli ? 0.6 : 1.4) + Math.random() * 0.8;
    f.from = from;
    f.to = from + (Math.random() < 0.5 ? turn : -turn);
    f.elev = heli ? 0.07 + Math.random() * 0.08 : 0.2 + Math.random() * 0.25; // 仰ぎ見る角度 rad
    f.dur = heli ? 70 + Math.random() * 30 : 40 + Math.random() * 25; // 横切る秒数
    f.t = -(heli ? 30 + Math.random() * 60 : 10 + Math.random() * 30); // 負の間は待つ
    // 見かけの大きさ：飛行機は長さ 40m が約 3km 先、ヘリは長さ 10m が約 1km 先
    f.scale = heli ? (FLYER_R / 1000) * 1.5 : (FLYER_R / 3000) * 2.5; // 見つけやすいよう実物より少し大きく
  }
  function syncSky(game, dt) {
    const g = scenery.geos;
    if (!g) return;
    if (!sky2.flyers.length) {
      for (const kind of ['plane', 'plane', 'heli']) {
        const o = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
        o.add(new THREE.Mesh(g[kind].body, mat));
        let rotor = null;
        if (kind === 'heli') {
          rotor = new THREE.Mesh(g.rotor.body, mat);
          rotor.position.set(0, 2.9, -0.2);
          o.add(rotor);
        }
        const f = { kind, o, rotor };
        newFlight(f);
        f.t = -Math.random() * 20;
        sky2.flyers.push(f);
        sky2.group.add(o);
      }
      // 鳥の群れ：カラス 7 羽とハト 9 羽（白い形に色を付ける）
      for (const [n, color, r0, h0, speed] of [[7, 0x1a1a1e, 18, 20, 0.32], [9, 0x8a8f99, 12, 10, 0.45]]) {
        for (let i = 0; i < n; i++) {
          const mat = new THREE.MeshLambertMaterial({ color, vertexColors: true });
          const b = new THREE.Group();
          b.add(new THREE.Mesh(g.birdBody.body, mat));
          const wl = new THREE.Mesh(g.birdWingL.body, mat), wr = new THREE.Mesh(g.birdWingR.body, mat);
          b.add(wl, wr);
          sky2.group.add(b);
          sky2.birds.push({ b, wl, wr, r: r0 + Math.random() * 6, h: h0 + Math.random() * 4, a: (i / n) * Math.PI * 2 + Math.random() * 0.4, speed, phase: Math.random() * 6, center: null });
        }
      }
    }
    sky2.t += dt;
    const cam = camera.position;
    for (const f of sky2.flyers) {
      f.t += dt;
      if (f.t > f.dur) newFlight(f);
      f.o.visible = f.t >= 0;
      if (!f.o.visible) continue;
      const k = f.t / f.dur;
      const az = f.from + (f.to - f.from) * k;
      const el = f.elev * (1 - 0.3 * Math.abs(k - 0.5)); // 真ん中で少し高く
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      f.o.position.copy(cam).addScaledVector(dir, FLYER_R);
      f.o.scale.setScalar(f.scale);
      // 進む向き（方角が増える向きの接線）に機首を向ける
      const s = Math.sign(f.to - f.from);
      const heading = az + (s * Math.PI) / 2;
      f.o.rotation.set(0, -heading, 0);
      if (f.rotor) f.rotor.rotation.y += dt * 25;
    }
    // 鳥：自転車の前（カメラの向く方）の上空を回る（群れの真ん中はゆっくり付いてくる）
    const p = game.player;
    const fwd = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    for (const bd of sky2.birds) {
      const target = new THREE.Vector3(p.x + fwd.x * 45, 0, p.y + fwd.z * 45);
      if (!bd.center) bd.center = target.clone();
      bd.center.lerp(target, Math.min(1, dt * 0.15));
      bd.a += bd.speed * dt;
      const x = bd.center.x + Math.cos(bd.a) * bd.r, z = bd.center.z + Math.sin(bd.a) * bd.r;
      bd.b.position.set(x, bd.h + Math.sin(sky2.t * 0.7 + bd.phase) * 1.2, z);
      bd.b.rotation.y = Math.PI - bd.a; // 円の接線の向き
      const flap = Math.sin(sky2.t * 9 + bd.phase) * 0.6;
      bd.wr.rotation.z = flap;
      bd.wl.rotation.z = -flap;
    }
  }

  // スタートの演出：カウントダウンの 3・2・1 で赤い灯が 1 つずつ点き、スタートで緑。旗はスタートから数秒振る
  const startShow = { raceAt: null, t: 0 };
  function syncStartShow(game, dt) {
    const show = world?.userData.startShow;
    startShow.t += dt;
    if (game.state === 'racing' && startShow.raceAt === null) startShow.raceAt = startShow.t;
    if (game.state !== 'racing') startShow.raceAt = null;
    if (!show) return;
    const cd = game.state === 'countdown' ? game.countdown : null;
    const since = startShow.raceAt === null ? Infinity : startShow.t - startShow.raceAt;
    show.lamps[0].visible = cd !== null; // 3
    show.lamps[1].visible = cd !== null && cd <= 2; // 2
    show.lamps[2].visible = cd !== null && cd <= 1; // 1
    show.lamps[3].visible = since < 4; // GO
    // 旗：カウントダウン中は高く掲げて小さくゆらし、スタートから 4 秒は大きく振る
    const wave = since < 4 ? Math.sin(startShow.t * 9) * 0.9 : cd !== null ? Math.sin(startShow.t * 3) * 0.15 : 0;
    show.arm.rotation.x = wave;
  }

  // ゴールの演出：勝ってゴールしたら、くす玉が割れてたれ幕が下り、紙吹雪が舞い、応援の人が跳びはねる。
  // それまでは、応援の人がゆっくり小旗を振る。結果画面から次へ進むか、やり直すと元に戻す
  const goalShow = { openAt: null, t: 0 };
  const cfDummy = new THREE.Object3D();
  function syncGoalShow(game, dt) {
    const show = world?.userData.goalShow;
    goalShow.t += dt;
    const won = game.state === 'result' && game.result?.win;
    if (!won) goalShow.openAt = null;
    if (!show) return;
    const { bits, confetti } = show;
    if (won && goalShow.openAt === null) {
      goalShow.openAt = goalShow.t;
      // 紙吹雪：くす玉の中から、上と横へ散らす
      for (let i = 0; i < CONFETTI_N; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.3;
        bits.pos.set([GOAL_HINGE[0] + Math.cos(a) * r, GOAL_HINGE[1] - GOAL_BALL_R + (Math.random() - 0.5) * 0.4, GOAL_HINGE[2] + Math.sin(a) * r], i * 3);
        const sp = 1 + Math.random() * 3;
        bits.vel.set([Math.cos(a) * sp, Math.random() * 2.5, Math.sin(a) * sp], i * 3);
        bits.spin.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12], i * 3);
        bits.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      }
    }
    const since = goalShow.openAt === null ? -1 : goalShow.t - goalShow.openAt;
    if (world.userData.goalBeam) world.userData.goalBeam.visible = since < 0; // 光の柱はくす玉の前をふさぐので消す
    // くす玉：0.6 秒で開き、少し行き過ぎて戻る
    const k = since < 0 ? 0 : Math.min(1, since / 0.6);
    const back = 1.70158;
    const open = (1 + (back + 1) * (k - 1) ** 3 + back * (k - 1) ** 2) * 1.9;
    show.left.rotation.z = -open;
    show.right.rotation.z = open;
    show.streamer.visible = since > 0.15;
    show.streamer.scale.y = Math.max(0.001, Math.min(1, (since - 0.15) / 0.5));
    // 応援の人：ゴール前はゆっくり、ゴールしたら速く振って跳ねる
    for (const f of show.fans) {
      const fast = since >= 0;
      f.arm.rotation.x = Math.sin(goalShow.t * (fast ? 10 : 3) + f.phase) * (fast ? 0.6 : 0.35) + 0.15;
      f.fan.position.y = fast ? Math.max(0, Math.sin(goalShow.t * 7 + f.phase)) * 0.18 : 0;
    }
    // 紙吹雪：空気でゆっくりになり、ひらひら揺れながら落ちて、地面で止まる
    confetti.visible = since >= 0;
    if (since < 0 || dt <= 0) return;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < CONFETTI_N; i++) {
      const j = i * 3, P = bits.pos, V = bits.vel, S = bits.spin, R = bits.rot;
      if (P[j + 1] > 0.02) {
        V[j] *= drag;
        V[j + 2] *= drag;
        V[j + 1] = Math.max(-0.9, (V[j + 1] - 9.8 * dt) * drag);
        const flutter = Math.sin(goalShow.t * 5 + i) * 0.5;
        P[j] += (V[j] + flutter) * dt;
        P[j + 1] = Math.max(0.02, P[j + 1] + V[j + 1] * dt);
        P[j + 2] += (V[j + 2] + Math.cos(goalShow.t * 4 + i) * 0.4) * dt;
        R[j] += S[j] * dt;
        R[j + 1] += S[j + 1] * dt;
        R[j + 2] += S[j + 2] * dt;
      } else {
        R[j] = -Math.PI / 2; // 地面に寝かせる
        R[j + 2] = 0;
      }
      cfDummy.position.set(P[j], P[j + 1], P[j + 2]);
      cfDummy.rotation.set(R[j], R[j + 1], R[j + 2]);
      cfDummy.updateMatrix();
      confetti.setMatrixAt(i, cfDummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
  }

  // ---- 街の物 その 6 の動き（addCity5Props で置いた物）：季節と天気の飾りの出し分け・鳥・船・桜の花びら ----
  let currentSeason = 'summer';
  const c5 = { t: 0 };
  function syncCity5(game, dt) {
    c5.t += dt;
    syncPetals(game, dt);
    if (!world) return;
    const ud = world.userData;
    if (ud.seasonal) for (const [k, grp] of Object.entries(ud.seasonal)) grp.visible = k === currentSeason;
    if (ud.weatherProps) for (const [k, grp] of Object.entries(ud.weatherProps)) grp.visible = k === currentWeather;
    syncBirds(game, dt, ud.birds);
    syncBoats(dt, ud.boats);
  }

  // 鳥：止まっている（カラスは電線、ハトは地面）。自転車が近づくと、自転車から離れる向きへ飛び立ち、遠くで消える。
  // 自転車が離れたら元の所に戻る
  const bm4 = new THREE.Matrix4(), bq = new THREE.Quaternion(), bEuler = new THREE.Euler(0, 0, 0, 'YXZ'), bPos = new THREE.Vector3(), bOne = new THREE.Vector3(1, 1, 1);
  function syncBirds(game, dt, B) {
    if (!B) return;
    const p = game.player;
    const counts = {};
    for (const kind of Object.keys(B.meshes)) counts[kind] = [0, 0, 0];
    for (const b of B.list) {
      const dx = b.pos[0] - p.x, dz = b.pos[2] - p.y;
      const d = Math.hypot(dx, dz);
      if (b.state === 'sit' && d < (b.kind === 'crow' ? 11 : 7) && game.state === 'racing') {
        const l = d || 1, sp = b.kind === 'crow' ? 5 : 4;
        b.state = 'fly';
        b.t = 0;
        b.vel = [(dx / l) * sp + (Math.random() - 0.5) * 2, b.kind === 'crow' ? 1.5 : 3, (dz / l) * sp + (Math.random() - 0.5) * 2];
        b.flap = Math.random() * 6;
      } else if (b.state === 'fly') {
        b.t += dt;
        b.vel[1] = 0.6 + 2.4 * Math.exp(-b.t * 0.4);
        for (let k = 0; k < 3; k++) b.pos[k] += b.vel[k] * dt;
        if (b.t > 10) b.state = 'gone';
      } else if (b.state === 'gone' && Math.hypot(b.home[0] - p.x, b.home[2] - p.y) > 60) {
        b.state = 'sit';
        b.pos = [...b.home];
      }
      if (b.state === 'gone') continue;
      let pose = 0;
      if (b.state === 'fly') {
        pose = Math.floor(c5.t * 9 + b.flap) % 2 ? 1 : 2;
        bEuler.set(-0.15, Math.atan2(-b.vel[0], -b.vel[2]), 0);
        bPos.set(b.pos[0], b.pos[1] + (b.kind === 'crow' ? 0.15 : 0.12), b.pos[2]);
      } else {
        // 止まっている間：ハトは首を振って歩くように少し向きを変える
        const peck = b.kind === 'pigeon' ? Math.sin(c5.t * 2 + b.home[0]) * 0.4 : 0;
        bEuler.set(0, b.rot + peck, 0);
        bPos.set(...b.pos);
      }
      bq.setFromEuler(bEuler);
      B.meshes[b.kind][pose].setMatrixAt(counts[b.kind][pose]++, bm4.compose(bPos, bq, bOne));
    }
    for (const [kind, meshes] of Object.entries(B.meshes)) {
      meshes.forEach((m, k) => {
        m.count = counts[kind][k];
        m.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // 船：川の線に沿って行き来する（端に着いたら向きを変える）。少し上下に揺れる
  function syncBoats(dt, boats) {
    if (!boats) return;
    for (const b of boats) {
      b.s += b.speed * b.dir * dt;
      if (b.s > b.len - 15 || b.s < 15) {
        b.dir = b.s > b.len / 2 ? -1 : 1;
        b.s = Math.max(15, Math.min(b.len - 15, b.s));
      }
      let i = 0;
      while (i + 2 < b.cum.length && b.cum[i + 1] < b.s) i++;
      const segLen = b.cum[i + 1] - b.cum[i] || 1, t = (b.s - b.cum[i]) / segLen;
      const x1 = b.p[2 * i], z1 = b.p[2 * i + 1], x2 = b.p[2 * i + 2], z2 = b.p[2 * i + 3];
      const hx = ((x2 - x1) / segLen) * b.dir, hz = ((z2 - z1) / segLen) * b.dir;
      const side = b.dir > 0 ? 1 : -1; // 進む向きの左に寄る（向きを変えても同じ岸にいる）
      const x = x1 + (x2 - x1) * t + hz * b.lat * side, z = z1 + (z2 - z1) * t - hx * b.lat * side;
      b.o.position.set(x, Y.river + Math.sin(c5.t * 1.3 + b.bob) * 0.04, z);
      b.o.rotation.y = Math.atan2(-hx, -hz);
      b.o.rotation.z = Math.sin(c5.t * 0.9 + b.bob) * 0.015;
    }
  }

  // 桜の花びら：春だけ、カメラのまわりにひらひら舞う（カメラについて回る箱の中で、下に出たら上へ戻す）
  const PETALS = 420, PETAL_BOX = 16;
  const petals = { mesh: null, data: null };
  function syncPetals(game, dt) {
    if (!petals.mesh) {
      if (!city5.geos) return;
      petals.mesh = new THREE.InstancedMesh(city5.geos.petal.body, STREET_MAT, PETALS);
      petals.mesh.frustumCulled = false;
      petals.mesh.name = 'petals'; // デバッグ・自動テスト用
      scene.add(petals.mesh);
      petals.data = new Float32Array(PETALS * 4);
      const c = camera.position;
      for (let i = 0; i < PETALS; i++) {
        petals.data.set([c.x + (Math.random() - 0.5) * 2 * PETAL_BOX, c.y - 4 + Math.random() * 12, c.z + (Math.random() - 0.5) * 2 * PETAL_BOX, Math.random() * 6.28], i * 4);
      }
    }
    petals.mesh.visible = currentSeason === 'spring' && currentWeather !== 'snow';
    petals.mesh.count = Math.round(PETALS * quality.particles); // 軽さの設定で減らす
    if (!petals.mesh.visible) return;
    const c = camera.position, D = petals.data;
    for (let i = 0; i < PETALS; i++) {
      const j = i * 4, ph = D[j + 3];
      D[j] += (Math.sin(c5.t * 1.4 + ph) * 0.6 + 0.4) * dt;
      D[j + 1] -= (0.55 + 0.25 * Math.sin(ph * 3)) * dt;
      D[j + 2] += Math.cos(c5.t * 1.1 + ph) * 0.4 * dt;
      // 箱の外に出たら反対側へ（カメラが大きく動いても、すぐ箱の中に戻る）
      const wrap = (v, cc, half) => cc + ((((v - cc + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
      D[j] = wrap(D[j], c.x, PETAL_BOX);
      D[j + 1] = wrap(D[j + 1], c.y + 2, 6);
      D[j + 2] = wrap(D[j + 2], c.z, PETAL_BOX);
      bEuler.set(c5.t * 2.1 + ph, c5.t * 1.3 + ph * 2, ph);
      bq.setFromEuler(bEuler);
      petals.mesh.setMatrixAt(i, bm4.compose(bPos.set(D[j], D[j + 1], D[j + 2]), bq, bOne.set(5, 5, 5)));
    }
    bOne.set(1, 1, 1);
    petals.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 街の物 その 7 の動き：大型ビジョンの画・警備員の誘導灯・子どものボール・自転車のマフラー・花火・富士山 ----
  let currentTime = 'evening';
  let prevWeather = null; // 虹を出すため（雨から晴れ）
  const c6 = { t: 0, visionAt: 0 };
  function syncCity6(game, dt) {
    c6.t += dt;
    if (c6.t - c6.visionAt > 0.15) {
      c6.visionAt = c6.t;
      drawVision(c6.t);
    }
    const ud = world?.userData;
    for (const gd of ud?.guards ?? []) gd.arm.rotation.z = Math.sin(c6.t * 3.2 + gd.phase) * 0.9; // 誘導灯を左右に振る
    for (const kd of ud?.kids ?? []) {
      // ボール：2 人のあいだを、弧を描いて行き来する（片道 1.4 秒）
      const u = ((c6.t + kd.phase) / 1.4) % 2;
      const f = u < 1 ? u : 2 - u;
      kd.ball.position.set(-1.3 + 2.6 * f, Math.sin(Math.PI * (u % 1)) * 1.1 + 0.5, 0);
    }
    // マフラーのたれ：速いほど後ろへなびき、ぱたぱた揺れる
    const tail = player.userData.scarfTail;
    if (tail) {
      const k = Math.min(1, Math.abs(game.player.speed) / 8);
      tail.rotation.x = -(0.2 + 1.15 * k) + Math.sin(c6.t * 14) * 0.15 * k;
    }
    syncFireworks(game, dt);
    syncFuji();
  }

  // 花火：夏の夕方と夜（晴れ）に、遠く（隅田川の方角）の空で開く。遠くの目印と同じく、霧の外の決まった距離に置く
  const FIREWORK_R = 420, FIREWORK_N = 4;
  const FIREWORK_COLORS = [0xff5a5a, 0xffd04a, 0x6aff8a, 0x6ac8ff, 0xff8af0, 0xffffff, 0xff9a3a];
  const fireworks = [];
  function syncFireworks(game, dt) {
    const on = currentSeason === 'summer' && currentTime !== 'day' && currentWeather === 'clear' && city6.geos;
    if (on && !fireworks.length) {
      for (let i = 0; i < FIREWORK_N; i++) {
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const o = new THREE.Mesh(city6.geos.burst.glow, mat);
        o.frustumCulled = false;
        o.name = 'firework'; // デバッグ・自動テスト用
        scene.add(o);
        fireworks.push({ o, t: 2.61 + i * 0.01, az: 0, el: 0, r: 1 }); // すぐに次の打ち上げを決める
      }
    }
    for (const fw of fireworks) fw.o.visible = false;
    if (!on) return;
    // 隅田川の花火の方角（今の区間の原点から）
    const origin = worldMap?.origin;
    const base = origin ? Math.atan2((139.802 - origin.lon) * 90400, (35.712 - origin.lat) * 110950) : 1.0; // 北が 0、時計回り
    const cam = camera.position;
    for (const fw of fireworks) {
      fw.t += dt;
      if (fw.t > 2.6) {
        fw.t = -(0.4 + Math.random() * 1.8);
        fw.az = base + (Math.random() - 0.5) * 0.5;
        fw.el = 0.1 + Math.random() * 0.14;
        fw.r = 12 + Math.random() * 8;
        fw.o.material.color.setHex(FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]);
      }
      if (fw.t < 0) continue;
      const t = fw.t;
      const dir = new THREE.Vector3(Math.sin(fw.az) * Math.cos(fw.el), Math.sin(fw.el), -Math.cos(fw.az) * Math.cos(fw.el));
      fw.o.position.copy(cam).addScaledVector(dir, FIREWORK_R);
      fw.o.position.y -= t * t * 1.2; // 開いたあと、少し垂れる
      fw.o.scale.setScalar(fw.r * (1 - Math.exp(-t * 3)));
      fw.o.material.opacity = t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 2.2);
      fw.o.visible = true;
    }
  }

  // 富士山：晴れた昼と夕方に、西南西の遠く（約 100km）。遠くの目印と同じく、向きと見かけの大きさを保って霧の外に置く。
  // 雪の帽子は夏以外
  const FUJI = { lat: 35.3606, lon: 138.7274 };
  const fuji = { o: null };
  function syncFuji() {
    const origin = worldMap?.origin;
    if (!fuji.o) {
      if (!city6.geos) return;
      fuji.o = new THREE.Group();
      fuji.body = new THREE.Mesh(city6.geos.fuji.body, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
      fuji.snow = new THREE.Mesh(city6.geos.fujiSnow.body, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
      fuji.o.add(fuji.body, fuji.snow);
      fuji.o.name = 'fuji'; // デバッグ・自動テスト用
      scene.add(fuji.o);
    }
    fuji.o.visible = Boolean(origin) && currentWeather === 'clear' && currentTime !== 'night';
    if (!fuji.o.visible) return;
    const cam = camera.position;
    const mPerDegLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
    const dx = (FUJI.lon - origin.lon) * mPerDegLon - cam.x, dz = -(FUJI.lat - origin.lat) * 110540 - cam.z;
    const k = FAR_TOWER_RADIUS / Math.hypot(dx, dz);
    fuji.o.position.set(cam.x + dx * k, cam.y * (1 - k), cam.z + dz * k);
    fuji.o.scale.setScalar(k);
    fuji.snow.visible = currentSeason !== 'summer';
    // かすみ：遠いので空の色に寄せる（夕方は暗い影絵）
    const haze = currentTime === 'evening' ? 0.75 : 0.55;
    for (const m of [fuji.body, fuji.snow]) {
      m.material.color.setScalar(1 - haze);
      m.material.emissive.copy(scene.fog.color).multiplyScalar(haze * 0.9);
    }
  }

  // ---- 街の物 その 8 の動き：夜だけの物・首都高の車・ゴールの駅員さん・電車の乗客・雲と虹・東京湾の船 ----
  const c7 = { t: 0 };
  const rainbow = { at: null, mesh: null };
  function syncCity7(game, dt) {
    c7.t += dt;
    const ud = world?.userData;
    const lit = currentTime !== 'day';
    if (ud?.nightProps) ud.nightProps.visible = lit;
    NIGHT_MAT.visible = lit;
    // 首都高の車：高架の上を道に沿って走り、端に着いたら折り返す（左側通行）
    for (const c of ud?.hwyCars ?? []) {
      const P = c.path;
      c.s += c.speed * c.dir * dt;
      if (c.s > P.len - 5 || c.s < 5) {
        c.dir = c.s > P.len / 2 ? -1 : 1;
        c.s = Math.max(5, Math.min(P.len - 5, c.s));
      }
      let i = 0;
      while (i + 2 < P.cum.length && P.cum[i + 1] < c.s) i++;
      const segLen = P.cum[i + 1] - P.cum[i] || 1, t = (c.s - P.cum[i]) / segLen;
      const x1 = P.p[2 * i], z1 = P.p[2 * i + 1], x2 = P.p[2 * i + 2], z2 = P.p[2 * i + 3];
      const hx = ((x2 - x1) / segLen) * c.dir, hz = ((z2 - z1) / segLen) * c.dir;
      c.o.position.set(x1 + (x2 - x1) * t + hz * c.lane, HWY_Y, z1 + (z2 - z1) * t - hx * c.lane);
      c.o.rotation.y = -Math.atan2(hx, -hz);
    }
    // ゴールの駅員さん：勝ったら右手を挙げて振る
    for (const s of ud?.goalStaff ?? []) {
      if (goalShow.openAt === null) s.arm.rotation.set(0, 0, 0);
      else {
        const k = Math.min(1, (goalShow.t - goalShow.openAt) / 0.5);
        s.arm.rotation.set(2.7 * k, 0, Math.sin(c7.t * 8 + s.side) * 0.45 * k);
      }
    }
    syncPassengers();
    syncClouds();
    syncRainbow();
    syncBayShips();
  }

  // 電車の乗客：山手線の車両と、ほかの路線の通勤電車（新幹線と新交通などは除く）の窓に、人の影を付ける
  function syncPassengers() {
    const g = city7.geos;
    if (!g) return;
    train.forEach((car, i) => {
      if (car.userData.pax) return;
      const m = new THREE.Mesh(g.paxYamanote.body, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true }));
      if (i % 2) m.scale.z = -1; // 車両ごとに並びを変える
      car.add(m);
      car.userData.pax = m;
    });
    for (const t of otherTrains.list) {
      t.cars.forEach((car, i) => {
        if (car.userData.pax || !car.userData.commuter) return;
        const m = new THREE.Mesh(g.paxCommuter.body, OTHER_TRAIN_MAT);
        if (i % 2) m.scale.z = -1;
        car.add(m);
        car.userData.pax = m;
      });
    }
  }

  // 雲：晴れた昼と夕方に、空の遠くをゆっくり流れる（遠くの目印と同じく霧の外の決まった距離に置く）
  const clouds = [];
  const cloudTint = new THREE.Color();
  function syncClouds() {
    if (!clouds.length) {
      if (!city7.geos) return;
      for (let i = 0; i < 12; i++) {
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.95 });
        const o = new THREE.Mesh(city7.geos[`cloud${i % 3}`].body, mat);
        o.name = 'cloud'; // デバッグ・自動テスト用
        scene.add(o);
        clouds.push({ o, az: (i / 12) * Math.PI * 2 + Math.random() * 0.4, el: 0.09 + Math.random() * 0.22, s: 1 + Math.random() * 0.8, speed: 0.004 + Math.random() * 0.004 });
      }
    }
    const on = currentWeather === 'clear' && currentTime !== 'night';
    cloudTint.set(currentTime === 'evening' ? 0xffc0a8 : 0xffffff);
    const cam = camera.position;
    for (const c of clouds) {
      c.o.visible = on;
      if (!on) continue;
      c.az += c.speed * (1 / 60);
      const dir = new THREE.Vector3(Math.sin(c.az) * Math.cos(c.el), Math.sin(c.el), -Math.cos(c.az) * Math.cos(c.el));
      c.o.position.copy(cam).addScaledVector(dir, 415);
      c.o.rotation.set(0, -c.az, 0); // 長い向きを、見る向きに直角に
      c.o.scale.setScalar(c.s);
      c.o.material.color.copy(cloudTint);
      c.o.material.emissive.copy(cloudTint).multiplyScalar(0.35);
    }
  }

  // 虹：雨や雪から晴れに切り替えたとき（夜は除く）、太陽と反対の空に出て、40 秒ほどで消える
  function syncRainbow() {
    if (!rainbow.mesh) {
      if (!city7.geos) return;
      rainbow.mesh = new THREE.Mesh(city7.geos.rainbow.glow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      rainbow.mesh.name = 'rainbow'; // デバッグ・自動テスト用
      rainbow.mesh.renderOrder = -1;
      scene.add(rainbow.mesh);
    }
    const since = rainbow.at === null ? Infinity : c7.t - rainbow.at;
    const on = since < 45 && currentWeather === 'clear' && currentTime !== 'night';
    rainbow.mesh.visible = on;
    if (!on) return;
    const a = Math.min(1, since / 4) * Math.min(1, (45 - since) / 8);
    rainbow.mesh.material.opacity = 0.5 * a;
    const dx = -SUN_DIR.x, dz = -SUN_DIR.z, l = Math.hypot(dx, dz) || 1;
    const cam = camera.position;
    rainbow.mesh.position.set(cam.x + (dx / l) * 410, cam.y - 40, cam.z + (dz / l) * 410);
    rainbow.mesh.rotation.set(0, Math.atan2(dx, dz), 0);
    rainbow.mesh.scale.setScalar(300);
  }

  // 東京湾の船：コンテナ船（ほぼ止まっている）とフェリー（ゆっくり行き来する）。遠くの目印と同じく、向きと見かけの大きさを保って置く
  const BAY_SHIPS = [
    { key: 'containerShip', from: [35.6125, 139.7795], to: [35.6118, 139.7805], heading: 0.5, period: 900 },
    { key: 'ferry', from: [35.6455, 139.7735], to: [35.6185, 139.7925], heading: 2.6, period: 420 },
  ];
  const bay = { ships: null };
  const shipHaze = new THREE.Color();
  function syncBayShips() {
    const origin = worldMap?.origin;
    if (!bay.ships) {
      if (!city7.geos) return;
      bay.ships = BAY_SHIPS.map((s) => {
        const o = new THREE.Mesh(city7.geos[s.key].body, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
        o.name = s.key; // デバッグ・自動テスト用
        scene.add(o);
        return { ...s, o };
      });
    }
    const cam = camera.position, fog = scene.fog;
    for (const s of bay.ships) {
      s.o.visible = false;
      if (!origin) continue;
      const u = (Math.sin((c7.t / s.period) * Math.PI * 2) + 1) / 2;
      const lat = s.from[0] + (s.to[0] - s.from[0]) * u, lon = s.from[1] + (s.to[1] - s.from[1]) * u;
      const mPerDegLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
      const dx = (lon - origin.lon) * mPerDegLon - cam.x, dz = -(lat - origin.lat) * 110540 - cam.z;
      const dist = Math.hypot(dx, dz);
      if (dist < FAR_TOWER_NEAR || dist > 9000) continue;
      const k = FAR_TOWER_RADIUS / dist;
      s.o.position.set(cam.x + dx * k, cam.y * (1 - k), cam.z + dz * k);
      s.o.scale.setScalar(k * 3); // 街の中からも見つけやすいよう、実物より大きく
      s.o.rotation.y = s.heading;
      const haze = Math.min(0.85, (0.3 + dist / 25000) * (FOG_FAR / fog.far));
      s.o.material.color.setScalar(1 - haze);
      s.o.material.emissive.copy(fog.color).multiplyScalar(haze).add(shipHaze.setScalar(windowGlow * 0.12));
      s.o.visible = true;
    }
  }

  // ---- 街の物 その 9 の動き：航空障害灯の点滅・噴水の水・撮り鉄 ----
  const c8 = { t: 0 };
  function syncCity8(game, dt) {
    c8.t += dt;
    // 航空障害灯：夕方と夜だけ、ゆっくり明るくなったり暗くなったり
    OBST_MAT.visible = currentTime !== 'day';
    OBST_MAT.color.setScalar(0.15 + 0.85 * Math.max(0, Math.sin(c8.t * Math.PI * 0.75)));
    const ud = world?.userData;
    for (const w of ud?.fountains ?? []) {
      const k = 1 + 0.18 * Math.sin(c8.t * 2.2) + 0.06 * Math.sin(c8.t * 5.3);
      w.scale.set(1 + (k - 1) * 0.4, k, 1 + (k - 1) * 0.4);
    }
    // 撮り鉄：山手線の電車が 200m より近いとカメラを構える
    const cars = trainGroup.visible ? train.filter((c) => c.visible) : [];
    for (const rf of ud?.railfans ?? []) {
      const p = rf.o.position;
      const near = cars.some((c) => Math.hypot(c.position.x - p.x, c.position.z - p.z) < 200);
      rf.up.visible = near;
      rf.down.visible = !near;
    }
  }

  // ---- 街の物 その 10 の動き：自動ドア・宅配便の人・信号待ちの人・稲光・夕日と朝もや・ベルの音符 ----
  const c9 = { t: 0, boltWait: 6, flash: 0 };
  let hemiBase = 1.5; // 時間帯と天気で決まる空の光の強さ（稲光で一瞬強くする）
  const fogBase = new THREE.Color(), skyBase = { top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color() }; // 稲光の前の色
  function syncCity9(game, dt) {
    c9.t += dt;
    const ud = world?.userData;
    const p = game.player;
    // 自動ドア：近づくと開き、離れると閉まる
    const ad = ud?.autoDoors;
    if (ad) {
      const m = new THREE.Matrix4(), off = new THREE.Matrix4();
      ad.bases.forEach((b, k) => {
        const want = Math.hypot(b.x - p.x, b.z - p.y) < AUTO_DOOR_NEAR ? 1 : 0;
        b.open += (want - b.open) * Math.min(1, dt * 4);
        for (const s of [0, 1]) {
          const x = (s ? 0.4 : -0.4) + (s ? 1 : -1) * b.open * (AUTO_DOOR_OPEN / 2);
          ad.mesh.setMatrixAt(k * 2 + s, m.copy(b.m).multiply(off.makeTranslation(x, 0, s ? 0.02 : 0)));
        }
      });
      ad.mesh.instanceMatrix.needsUpdate = true;
    }
    // 宅配便の人：バンの後ろ → 建物の前（少し止まる）→ バンへ戻る（往復 14 秒）
    for (const d of ud?.deliveries ?? []) {
      const u = ((c9.t + d.phase) % 14) / 14;
      const k = u < 0.4 ? u / 0.4 : u < 0.5 ? 1 : u < 0.9 ? 1 - (u - 0.5) / 0.4 : 0;
      const going = u < 0.5;
      const x = d.sx + (d.wx - d.sx) * k, z = d.sz + (d.wz - d.sz) * k;
      const moving = (u > 0 && u < 0.4) || (u > 0.5 && u < 0.9);
      if (!d.walker.material.userData.swing) {
        d.walker.geometry = walkingGeometry(d.walker.geometry);
        d.walker.material = walkMaterial(false);
      }
      d.walker.material.userData.swing.value = stepSwing((d.stride ??= {}), d.last ? Math.hypot(x - d.last[0], z - d.last[1]) : 0);
      d.last = [x, z];
      d.walker.position.set(x, Y.area + (moving ? Math.abs(Math.sin(c9.t * 7)) * 0.03 : 0), z);
      d.walker.rotation.y = going ? Math.atan2(-(d.wx - d.sx), -(d.wz - d.sz)) : Math.atan2(d.wx - d.sx, d.wz - d.sz);
      d.walker.visible = !(u >= 0.45 && u < 0.5); // 建物の中に荷物を届けているあいだ
    }
    syncSignalQueues(game);
    syncLightning(dt);
    syncSunAndMist();
    syncNotes(dt);
  }

  // 信号待ちの人：自転車のまわりの信号の交差点の四隅に、歩行者用の信号が赤のあいだ人が並ぶ
  const queues = { obs: null, spots: [], meshes: null, at: 0 };
  function syncSignalQueues(game) {
    const obs = game.obstacles;
    if (!obs || !city3.geos || !worldMap) return;
    if (!queues.meshes) {
      queues.meshes = [0, 1, 2, 3].map((k) => {
        const m = new THREE.InstancedMesh(city3.geos[`stand${k}`].body, STREET_MAT, 80);
        m.frustumCulled = false;
        m.castShadow = true;
        m.count = 0;
        m.name = 'signalQueue'; // デバッグ・自動テスト用
        scene.add(m);
        return m;
      });
    }
    // 四隅の場所は、区間が変わったときに作る（交差点の道の向きに合わせた斜めの 4 か所。歩道の上だけ）
    if (queues.obs !== obs) {
      queues.obs = obs;
      queues.spots = [];
      const rh = roadH();
      for (const sg of obs.signals ?? []) {
        for (const [x, z] of sg.nodes) {
          const segs = (surfaceAt(worldMap, x, z).segs ?? []).filter((s) => !s.road.path);
          if (!segs.length) continue;
          const r = segs.reduce((a, s) => (s.road.w > a.road.w ? s : a)).road;
          const [ux, uz] = roadDirAt(r, x, z);
          const R = Math.max(...segs.map((sg) => sg.road.w)) / 2 + 2.4; // いちばん広い道の端の少し外
          for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const cx = x + ux * a * R - uz * b * R, cz = z + uz * a * R + ux * b * R;
            const sf = surfaceAt(worldMap, cx, cz);
            if (sf.kind === 'road' || sf.kind === 'building' || (sf.segs ?? []).some((s) => segHeight(rh, s, cx, cz) > 0.5)) continue;
            const v = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
            const n = 1 + Math.floor((v - Math.floor(v)) * 4); // 1〜4 人
            queues.spots.push({ group: sg, x: cx, z: cz, fx: -(a * ux - b * uz), fz: -(a * uz + b * ux), n, y: sf.kind === 'path' ? Y.path : Y.area });
          }
        }
      }
    }
    const p = game.player;
    const counts = [0, 0, 0, 0], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), m4 = new THREE.Matrix4();
    for (const s of queues.spots) {
      if (Math.abs(s.x - p.x) > 140 || Math.abs(s.z - p.y) > 140) continue;
      if (signalState(s.group, obs.clock) === 'red') continue; // 車が赤＝歩行者は青なので渡っている
      for (let k = 0; k < s.n; k++) {
        const v = (((k * 7 + Math.floor(s.x)) % 4) + 4) % 4; // 人の形 4 種類（座標が負でも 0〜3）
        if (counts[v] >= 80) continue;
        // 横断歩道の手前に、横に並ぶ
        const ox = -s.fz * (k - (s.n - 1) / 2) * 0.7, oz = s.fx * (k - (s.n - 1) / 2) * 0.7;
        q.setFromAxisAngle(up, Math.atan2(-s.fx, -s.fz));
        queues.meshes[v].setMatrixAt(counts[v]++, m4.compose(pos.set(s.x + ox, s.y, s.z + oz), q, one));
      }
    }
    queues.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
    });
  }

  // 稲光：雨のとき、ときどき空の遠くに光の筋が走り、街全体が一瞬明るくなる。少し遅れて雷の音（game.js が鳴らす）
  const bolt = { mesh: null, show: 0 };
  function syncLightning(dt) {
    if (!bolt.mesh) {
      if (!city9.geos) return;
      bolt.mesh = new THREE.Mesh(city9.geos.bolt.glow, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true }));
      bolt.mesh.name = 'bolt'; // デバッグ・自動テスト用
      bolt.mesh.visible = false;
      scene.add(bolt.mesh);
      c9.bolt = bolt; // デバッグ・自動テスト用
    }
    const rain = currentWeather === 'rain';
    if (rain) c9.boltWait -= dt;
    if (rain && c9.boltWait <= 0) {
      c9.boltWait = 9 + Math.random() * 14;
      c9.flash = 1;
      bolt.show = 0.35;
      const az = Math.random() * Math.PI * 2, cam = camera.position;
      bolt.mesh.position.set(cam.x + Math.sin(az) * 420, cam.y + 70, cam.z - Math.cos(az) * 420); // 屋上より上の空に
      bolt.mesh.rotation.set(0, -az, 0);
      bolt.mesh.scale.setScalar(230);
      setTimeout(() => window.dispatchEvent(new CustomEvent('thunder', { detail: { far: Math.random() } })), 700 + Math.random() * 1600);
    }
    bolt.show -= dt;
    bolt.mesh.visible = bolt.show > 0 && Math.floor(bolt.show * 20) % 3 !== 1; // ちらつく
    c9.flash = Math.max(0, c9.flash - dt * 5);
    const k = c9.flash > 0.6 || (c9.flash > 0.1 && c9.flash < 0.3) ? c9.flash : 0; // 2 回光る
    hemi.intensity = hemiBase * (1 + 2.5 * k);
    // 空と霧も一瞬白く
    scene.fog.color.copy(fogBase).lerp(FLASH_WHITE, k * 0.6);
    renderer.setClearColor(scene.fog.color);
    if (k > 0 || c9.wasFlash) {
      const u = sky.userData.uniforms;
      for (const key of ['top', 'mid', 'horizon']) u[key].value.copy(skyBase[key]).lerp(FLASH_WHITE, k * 0.5);
    }
    c9.wasFlash = k > 0;
  }
  const FLASH_WHITE = new THREE.Color(0xc8d0e8);

  // 夕日（夕方の晴れ：地平線の近くの大きな橙の円）と朝もや（昼の晴れ：遠くの地面の近くを白くかすませる帯）
  const sunset = { sprite: null, mist: null };
  function syncSunAndMist() {
    if (!sunset.sprite) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const x = cv.getContext('2d');
      const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,236,190,1)');
      gr.addColorStop(0.28, 'rgba(255,170,90,1)');
      gr.addColorStop(0.36, 'rgba(255,130,70,0.55)');
      gr.addColorStop(1, 'rgba(255,100,60,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 128, 128);
      sunset.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), fog: false, depthWrite: false, transparent: true }));
      sunset.sprite.name = 'sunsetSun'; // デバッグ・自動テスト用
      sunset.sprite.renderOrder = -1;
      scene.add(sunset.sprite);
      const mv = document.createElement('canvas');
      mv.width = 4;
      mv.height = 64;
      const y = mv.getContext('2d');
      const gm = y.createLinearGradient(0, 0, 0, 64);
      gm.addColorStop(0, 'rgba(255,255,255,0)');
      gm.addColorStop(0.7, 'rgba(240,244,250,0.35)');
      gm.addColorStop(1, 'rgba(240,244,250,0.55)');
      y.fillStyle = gm;
      y.fillRect(0, 0, 4, 64);
      const tex = new THREE.CanvasTexture(mv);
      sunset.mist = new THREE.Mesh(new THREE.CylinderGeometry(330, 330, 70, 40, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
      sunset.mist.name = 'morningMist'; // デバッグ・自動テスト用
      scene.add(sunset.mist);
    }
    const cam = camera.position;
    const clearSky = currentWeather === 'clear';
    sunset.sprite.visible = clearSky && currentTime === 'evening';
    if (sunset.sprite.visible) {
      const l = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
      sunset.sprite.position.set(cam.x + (SUN_DIR.x / l) * 420, cam.y + 22, cam.z + (SUN_DIR.z / l) * 420);
      sunset.sprite.scale.setScalar(150);
    }
    sunset.mist.visible = clearSky && currentTime === 'day';
    sunset.mist.position.set(cam.x, 30, cam.z);
  }

  // ベルの音符：ベルを鳴らすと、自転車の上に色の違う音符が 2 つ出て、ゆれながら上って消える
  const notes = [];
  const NOTE_COLORS = [0xffe040, 0xff7ab0, 0x7ad8ff, 0x9aff7a];
  function ringBellNotes() {
    if (!city9.geos) return;
    for (let k = 0; k < 2; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: NOTE_COLORS[(notes.length + k) % NOTE_COLORS.length], transparent: true, fog: false, depthWrite: false, side: THREE.DoubleSide });
      const o = new THREE.Mesh(city9.geos.note.glow, mat);
      o.name = 'bellNote'; // デバッグ・自動テスト用
      scene.add(o);
      notes.push({ o, t: -k * 0.18, side: k ? 1 : -1 });
    }
  }
  function syncNotes(dt) {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      n.t += dt;
      const t = Math.max(0, n.t);
      const p = player.position;
      n.o.visible = n.t >= 0;
      n.o.position.set(p.x + n.side * 0.45 + Math.sin(t * 6) * 0.12, p.y + 1.9 + t * 1.1, p.z);
      n.o.lookAt(camera.position.x, n.o.position.y, camera.position.z);
      n.o.scale.setScalar(0.42);
      n.o.material.opacity = Math.max(0, 1 - t / 1.4);
      if (t > 1.4) {
        scene.remove(n.o);
        n.o.material.dispose();
        notes.splice(i, 1);
      }
    }
  }

  // ---- 街の物 その 11 の動き：立体駐車場の車・消防車の出動・落ち葉・陽炎・水しぶきとタイヤの跡・リプレイ ----
  const c10 = { t: 0 };
  function syncCity10(game, dt) {
    c10.t += dt;
    const ud = world?.userData;
    // 立体駐車場：車が入口の前に来て止まり、中へ入って上がり（見えなくなり）、しばらくして別の車が来る（1 回 30 秒）
    for (const tw of ud?.towers ?? []) {
      const u = ((c10.t + tw.phase) % 30) / 30;
      const fx = -Math.sin(tw.rot), fz = -Math.cos(tw.rot); // 塔の前（道の方）
      let out = 0, up = 0;
      if (u < 0.25) out = 9 * (1 - u / 0.25); // 道から入口の前まで来る
      else if (u < 0.4) out = 0; // 止まる
      else if (u < 0.55) out = -3.2 * ((u - 0.4) / 0.15); // 中へ入る
      else (out = -3.2), (up = (u - 0.55) * 30);
      tw.car.visible = up < 3;
      tw.car.position.set(tw.x + fx * (3.6 + out), Y.area + up, tw.z + fz * (3.6 + out));
      tw.car.rotation.y = tw.rot + Math.PI; // 塔の方を向いて入る
    }
    // 消防車：自転車が 250m 以内の消防署から、40〜80 秒に 1 回、サイレンを鳴らして出る
    const p = game.player;
    for (const fs of ud?.fireStations ?? []) {
      if (game.state !== 'racing') continue;
      fs.wait -= dt;
      if (fs.wait > 0 || Math.hypot(fs.x - p.x, fs.z - p.y) > 250) continue;
      fs.wait = 40 + Math.random() * 40;
      if (dispatchFireTruck(fs)) window.dispatchEvent(new CustomEvent('siren', { detail: { d: Math.hypot(fs.x - p.x, fs.z - p.y) } }));
    }
    syncLeaves(game, dt);
    syncHeatHaze();
    syncSplash(game, dt);
    syncTireTracks(game, dt);
  }

  // 消防署の前のいちばん近い車道に、消防車を走らせる（自転車のまわりを走るほかの乗り物と同じ動き。syncRiders）
  function dispatchFireTruck(fs) {
    const g = city2.geos;
    if (!g?.fire || !worldMap) return false;
    const near = nearestRoadPoint(worldMap, fs.x, fs.z, true);
    if (!near || near.road.e || near.d > 20) return false;
    const r = near.road;
    let v = 0, bd = Infinity;
    for (let i = 0; i + 1 < r.p.length / 2; i++) {
      const d = Math.hypot(r.p[2 * i] - near.x, r.p[2 * i + 1] - near.z);
      if (d < bd) (bd = d), (v = i);
    }
    const o = new THREE.Group();
    const body = new THREE.Mesh(g.fire.body, STREET_MAT);
    body.castShadow = true;
    o.add(body);
    if (g.fire.glow) o.add(new THREE.Mesh(g.fire.glow, STREET_GLOW_MAT));
    o.userData.lamp = new THREE.Mesh(g.fireLamp.glow, STREET_GLOW_MAT);
    o.add(o.userData.lamp);
    o.userData.used = true;
    o.userData.dispose = true; // 消えたら捨てる（使い回さない）
    o.name = 'fireTruck'; // デバッグ・自動テスト用
    scene.add(o);
    const dir = r.o || (v + 1 < r.p.length / 2 ? 1 : -1);
    riders.list.push({ kind: 'fireOut', o, road: r, v: Math.max(0, Math.min(r.p.length / 2 - 2, v)), dir, s: 0, speed: 9, side: 0.5, life: 40 });
    return true;
  }

  // 落ち葉：秋だけ、カメラのまわりに舞い、地面に落ちると少し転がってから、また上から舞う（桜の花びらと同じ箱）
  const LEAVES = 260;
  const leaves = { mesh: null, data: null };
  const LEAF_COLORS = [0xc8642a, 0xe0a030, 0xb04a2a, 0xf2c62e, 0x8a5a2a];
  function syncLeaves(game, dt) {
    if (!leaves.mesh) {
      if (!city10.geos) return;
      leaves.mesh = new THREE.InstancedMesh(city10.geos.leaf.body, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), LEAVES);
      leaves.mesh.frustumCulled = false;
      leaves.mesh.name = 'leaves'; // デバッグ・自動テスト用
      const col = new THREE.Color();
      for (let i = 0; i < LEAVES; i++) leaves.mesh.setColorAt(i, col.setHex(LEAF_COLORS[i % LEAF_COLORS.length]));
      scene.add(leaves.mesh);
      leaves.data = new Float32Array(LEAVES * 5); // x, y, z, 揺れの位相, 地面にいる時間
      const c = camera.position;
      for (let i = 0; i < LEAVES; i++) leaves.data.set([c.x + (Math.random() - 0.5) * 2 * PETAL_BOX, Math.random() * 12, c.z + (Math.random() - 0.5) * 2 * PETAL_BOX, Math.random() * 6.28, 0], i * 5);
    }
    leaves.mesh.visible = currentSeason === 'autumn' && currentWeather !== 'snow';
    leaves.mesh.count = Math.round(LEAVES * quality.particles); // 軽さの設定で減らす
    if (!leaves.mesh.visible) return;
    const c = camera.position, D = leaves.data;
    const wrap = (v, cc, half) => cc + ((((v - cc + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
    for (let i = 0; i < LEAVES; i++) {
      const j = i * 5, ph = D[j + 3];
      const ground = bikeH + 0.12;
      if (D[j + 1] > ground) {
        D[j] += (Math.sin(c10.t * 1.2 + ph) * 0.7 + 0.5) * dt;
        D[j + 1] -= (0.9 + 0.4 * Math.sin(ph * 3)) * dt;
        D[j + 2] += Math.cos(c10.t * 0.9 + ph) * 0.5 * dt;
        bEuler.set(c10.t * 2.4 + ph, c10.t * 1.6 + ph * 2, ph);
      } else {
        // 地面：風で少し転がり、しばらくするとまた上から
        D[j + 1] = ground;
        D[j + 4] += dt;
        D[j] += 0.6 * dt * Math.max(0, 1 - D[j + 4] / 3);
        bEuler.set(-Math.PI / 2, ph, Math.sin(c10.t * 6 + ph) * 0.3 * Math.max(0, 1 - D[j + 4] / 3));
        if (D[j + 4] > 6 + (ph % 3)) (D[j + 1] = c.y + 8 + Math.random() * 4), (D[j + 4] = 0);
      }
      D[j] = wrap(D[j], c.x, PETAL_BOX);
      D[j + 2] = wrap(D[j + 2], c.z, PETAL_BOX);
      if (D[j + 1] > c.y + 14) D[j + 1] = c.y + 2;
      bq.setFromEuler(bEuler);
      leaves.mesh.setMatrixAt(i, bm4.compose(bPos.set(D[j], D[j + 1], D[j + 2]), bq, bOne.set(1.6, 1.6, 1.6)));
    }
    bOne.set(1, 1, 1);
    leaves.mesh.instanceMatrix.needsUpdate = true;
  }

  // 陽炎：夏の晴れた昼に、遠くの路面の近くがゆらゆら揺れて見える（カメラのまわりの低い輪に、揺れる縞の画）
  const haze = { mesh: null, tex: null };
  function syncHeatHaze() {
    if (!haze.mesh) {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 32;
      const x = cv.getContext('2d');
      for (let k = 0; k < 256; k++) {
        const a = 0.22 + 0.14 * Math.sin(k * 0.31) * Math.sin(k * 0.07);
        const gr = x.createLinearGradient(0, 0, 0, 32);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.6, `rgba(250,246,236,${a})`);
        gr.addColorStop(1, `rgba(250,246,236,${a * 1.6})`);
        x.fillStyle = gr;
        x.fillRect(k, 0, 1, 32);
      }
      haze.tex = new THREE.CanvasTexture(cv);
      haze.tex.wrapS = THREE.RepeatWrapping;
      haze.tex.repeat.set(6, 1);
      haze.mesh = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 3.5, 48, 1, true), new THREE.MeshBasicMaterial({ map: haze.tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
      haze.mesh.name = 'heatHaze'; // デバッグ・自動テスト用
      scene.add(haze.mesh);
    }
    haze.mesh.visible = currentSeason === 'summer' && currentTime === 'day' && currentWeather === 'clear';
    if (!haze.mesh.visible) return;
    haze.mesh.position.set(camera.position.x, bikeH + 1.4 + Math.sin(c10.t * 2.3) * 0.08, camera.position.z);
    haze.tex.offset.x = (c10.t * 0.03) % 1;
    haze.mesh.scale.set(1, 1 + 0.15 * Math.sin(c10.t * 3.1), 1);
  }

  // 水しぶき：雨の日に水たまりを走ると、車輪のまわりから水の粒が飛ぶ
  const SPLASH_N = 120;
  const splash = { mesh: null, data: null, next: 0, emitAt: 0 };
  function syncSplash(game, dt) {
    if (!splash.mesh) {
      splash.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshLambertMaterial({ color: 0xd8e8f8, transparent: true, opacity: 0.8 }), SPLASH_N);
      splash.mesh.frustumCulled = false;
      splash.mesh.count = SPLASH_N;
      splash.mesh.name = 'splash'; // デバッグ・自動テスト用
      scene.add(splash.mesh);
      splash.data = new Float32Array(SPLASH_N * 7); // 位置・速さ・残りの時間
    }
    const p = game.player, D = splash.data;
    const puddles = world?.userData.puddles ?? [];
    const inPuddle = currentWeather === 'rain' && p.speed > 2 && puddles.some(([x, z, r]) => Math.abs(x - p.x) < r && Math.abs(z - p.y) < r && Math.hypot(x - p.x, z - p.y) < r);
    if (inPuddle && c10.t > splash.emitAt) {
      splash.emitAt = c10.t + 0.08;
      const fx = Math.sin(p.angle), fz = -Math.cos(p.angle);
      for (let k = 0; k < 12; k++) {
        const j = splash.next * 7;
        splash.next = (splash.next + 1) % SPLASH_N;
        const s = Math.random() < 0.5 ? -1 : 1, back = Math.random() < 0.5 ? 0.52 : -0.53; // 前か後ろの車輪
        D.set([p.x - fx * back + fz * s * 0.05, bikeH + 0.15, p.y - fz * back - fx * s * 0.05, -fz * s * (0.8 + Math.random()) - fx * Math.random() * 0.6, 1.2 + Math.random() * 1.2, fx * s * (0.8 + Math.random()) - fz * Math.random() * 0.6, 0.7], j);
      }
    }
    for (let i = 0; i < SPLASH_N; i++) {
      const j = i * 7;
      if (D[j + 6] > 0) {
        D[j + 6] -= dt;
        D[j + 4] -= 9.8 * dt;
        D[j] += D[j + 3] * dt;
        D[j + 1] = Math.max(bikeH + 0.1, D[j + 1] + D[j + 4] * dt);
        D[j + 2] += D[j + 5] * dt;
      }
      bPos.set(D[j], D[j + 1], D[j + 2]);
      splash.mesh.setMatrixAt(i, bm4.compose(bPos, bq.identity(), D[j + 6] > 0 ? bOne.set(1, 1, 1) : bOne.set(0, 0, 0)));
    }
    bOne.set(1, 1, 1);
    splash.mesh.instanceMatrix.needsUpdate = true;
  }

  // タイヤの跡：雨の日、濡れた路面に自転車の通った跡が細く残り、8 秒ほどで消える
  const TRACKS = 320, TRACK_STEP = 0.35;
  const tracks = { mesh: null, data: null, next: 0, last: null };
  function syncTireTracks(game, dt) {
    if (!tracks.mesh) {
      const geo = new THREE.PlaneGeometry(0.11, TRACK_STEP + 0.04); // 実物より少し太く（遠くからも見えるよう）
      geo.rotateX(-Math.PI / 2);
      // 色は、濡れた路面の水が切れて明るく見える跡
      tracks.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x8a94a4, transparent: true, opacity: 0.45, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), TRACKS);
      tracks.mesh.frustumCulled = false;
      tracks.mesh.renderOrder = 1;
      tracks.mesh.name = 'tireTracks'; // デバッグ・自動テスト用
      scene.add(tracks.mesh);
      tracks.data = new Float32Array(TRACKS * 5); // x, y, z, 向き, 残りの時間
    }
    const p = game.player, D = tracks.data;
    const wet = currentWeather === 'rain' && game.state === 'racing';
    if (wet && Math.abs(p.speed) > 0.5) {
      if (!tracks.last || Math.hypot(p.x - tracks.last[0], p.y - tracks.last[1]) > TRACK_STEP) {
        const j = tracks.next * 5;
        tracks.next = (tracks.next + 1) % TRACKS;
        D.set([p.x, bikeH + Y.signal + 0.05, p.y, p.angle, 8], j); // 路面（歩道の敷石など）の少し上
        tracks.last = [p.x, p.y];
      }
    } else tracks.last = null;
    for (let i = 0; i < TRACKS; i++) {
      const j = i * 5;
      if (D[j + 4] > 0) D[j + 4] -= dt;
      const k = Math.max(0, Math.min(1, D[j + 4] / 3)); // 消える前の 3 秒で細くなる
      bEuler.set(0, -D[j + 3], 0);
      bq.setFromEuler(bEuler);
      tracks.mesh.setMatrixAt(i, bm4.compose(bPos.set(D[j], D[j + 1], D[j + 2]), bq, bOne.set(k, 1, k > 0 ? 1 : 0)));
    }
    bOne.set(1, 1, 1);
    tracks.mesh.instanceMatrix.needsUpdate = true;
  }

  // リプレイ：ゴールしたあと、今回の走り（ghost.js の記録：0.1 秒ごとの x, y, 向き）を 2 倍の速さで、
  // 横・上・前・ぐるっと回るカメラを 3.5 秒ごとに切り替えて見せる
  const REPLAY_SPEED = 2, REPLAY_SHOT = 3.5;
  const replayCam = new THREE.Vector3(), replayLook = new THREE.Vector3();
  function syncReplay(game, dt) {
    const rp = game.replay, track = game.result?.track;
    if (!rp || !track || track.length < 6) return false;
    rp.t += dt * REPLAY_SPEED;
    const n = track.length / 3, f = Math.min(n - 1, rp.t / 0.1), i = Math.floor(f), j = Math.min(n - 1, i + 1), u = f - i;
    if (i >= n - 1) rp.done = true;
    let da = track[3 * j + 2] - track[3 * i + 2];
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const pose = { x: track[3 * i] + (track[3 * j] - track[3 * i]) * u, y: track[3 * i + 1] + (track[3 * j + 1] - track[3 * i + 1]) * u, angle: track[3 * i + 2] + da * u };
    const speed = Math.hypot(track[3 * j] - track[3 * i], track[3 * j + 1] - track[3 * i + 1]) / 0.1;
    const h = groundHeight(roadH(), surfaceAt(worldMap, pose.x, pose.y).segs, pose.x, pose.y, bikeH);
    bikeH = h;
    animateBike(player, pose, speed, dt * REPLAY_SPEED, h);
    player.visible = true;
    ghost.visible = false;
    // カメラ
    const fx = Math.sin(pose.angle), fz = -Math.cos(pose.angle);
    const shot = Math.floor(rp.t / (REPLAY_SHOT * REPLAY_SPEED)) % 4, k = (rp.t / (REPLAY_SHOT * REPLAY_SPEED)) % 1;
    if (shot === 0) replayCam.set(pose.x - fz * 5 - fx * 2, h + 1.4, pose.y + fx * 5 - fz * 2); // 横
    else if (shot === 1) replayCam.set(pose.x - fx * 14, h + 18, pose.y - fz * 14); // 上
    else if (shot === 2) replayCam.set(pose.x + fx * 7 + fz * 1.5, h + 1.2, pose.y + fz * 7 - fx * 1.5); // 前から
    else {
      const a = k * Math.PI * 1.2; // ぐるっと回る
      replayCam.set(pose.x + Math.cos(a) * 7, h + 3, pose.y + Math.sin(a) * 7);
    }
    camera.position.copy(replayCam);
    camera.lookAt(replayLook.set(pose.x, h + 1.0, pose.y));
    return true;
  }

  // ---- 街の物 その 12 の動き：盆踊り・タワークレーン・ランニング大会・選挙カー・記念写真 ----
  const c11 = { t: 0 };
  const c11m = new THREE.Matrix4(), c11q = new THREE.Quaternion(), c11p = new THREE.Vector3(), c11one = new THREE.Vector3(1, 1, 1), c11up = new THREE.Vector3(0, 1, 0);
  function syncCity11(game, dt) {
    c11.t += dt;
    const ud = world?.userData;
    if (!ud) return;
    // 盆踊り：夏の夕方と夜だけ。輪になってゆっくり回り、ときどき手を上げる（2 つの形を交互に）
    if (ud.bonGroup) ud.bonGroup.visible = currentTime !== 'day';
    if (ud.springNight) ud.springNight.visible = currentTime !== 'day'; // ぼんぼり（夜桜）
    for (const b of ud.bon ?? []) {
      if (!ud.bonGroup.visible) break;
      const counts = [0, 0];
      for (let i = 0; i < BON_DANCERS; i++) {
        const a = (i / BON_DANCERS) * Math.PI * 2 + c11.t * 0.12;
        const step = Math.floor(c11.t * 1.2 + i * 0.5) % 2; // 手の形を交互に
        const x = Math.cos(a) * b.R, z = Math.sin(a) * b.R;
        c11q.setFromAxisAngle(c11up, -a); // 輪の進む向きを向く
        b.dancers[step].setMatrixAt(counts[step]++, c11m.compose(c11p.set(x, Math.abs(Math.sin(c11.t * 2.4 + i)) * 0.05, z), c11q, c11one));
      }
      b.dancers.forEach((m, k) => {
        m.count = counts[k];
        m.instanceMatrix.needsUpdate = true;
      });
    }
    // タワークレーン：腕がゆっくり行ったり来たり回る
    for (const c of ud.cranes ?? []) c.top.rotation.y = Math.sin(c11.t * 0.08 + c.phase) * 1.4 + c.phase;
    syncMarathon(game, dt, ud);
  }

  // ランニング大会：4 分に 1 回、40 人のランナーが列になって大きな車道を走る（列が通るあいだ、給水所が出る）
  function syncMarathon(game, dt, ud) {
    const mt = ud.marathon;
    if (!mt) return;
    mt.t += dt;
    const cycle = 240, active = mt.t % cycle < (mt.len / 3.6 + 30);
    ud.marathonGroup.visible = active;
    if (!mt.walking) {
      mt.walking = true;
      for (const m of mt.meshes) (m.geometry = walkingGeometry(m.geometry, MARATHON_RUNNERS)), (m.material = walkMaterial(true));
    }
    const counts = [0, 0, 0, 0];
    if (active) {
      const head = (mt.t % cycle) * 3.6;
      for (const r of mt.runners) {
        const s = head + r.off;
        if (s < 0 || s > mt.len || counts[r.v] >= MARATHON_RUNNERS) continue;
        let i = 0;
        while (i + 2 < mt.cum.length && mt.cum[i + 1] < s) i++;
        const segLen = mt.cum[i + 1] - mt.cum[i] || 1, t = (s - mt.cum[i]) / segLen;
        const x1 = mt.p[2 * i], z1 = mt.p[2 * i + 1], x2 = mt.p[2 * i + 2], z2 = mt.p[2 * i + 3];
        const hx = (x2 - x1) / segLen, hz = (z2 - z1) / segLen;
        const off = mt.w * 0.18 + r.lane; // 進む向きの左の車線
        c11q.setFromAxisAngle(c11up, Math.atan2(-hx, -hz));
        c11p.set(x1 + (x2 - x1) * t + hz * off, Y.road + Math.abs(Math.sin(c11.t * 9 + r.ph)) * 0.06, z1 + (z2 - z1) * t - hx * off);
        addMover('ped', c11p.x, c11p.z, Y.road, hx, hz, PERSON_HIT_R);
        mt.meshes[r.v].geometry.attributes.aSwing.array[counts[r.v]] = Math.sin((s * Math.PI) / 1.1 + r.ph) * 0.55; // 2 歩で 2.2m（走る）
        mt.meshes[r.v].setMatrixAt(counts[r.v]++, c11m.compose(c11p, c11q, c11one));
      }
    }
    mt.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aSwing.needsUpdate = true;
    });
  }

  // 記念写真：勝ってゴールした瞬間の画面（3D の世界だけ）を写真にして、結果画面に白い枠付きで出す（hud.photo）
  const photo = { canvas: null, taken: false };
  function takeGoalPhoto(game) {
    if (photo.taken || !game.result?.win) return;
    photo.taken = true;
    const src = renderer.domElement;
    const w = 320, h = Math.round((w * src.height) / src.width);
    const cv = photo.canvas ?? (photo.canvas = document.createElement('canvas'));
    cv.width = w + 16;
    cv.height = h + 40;
    const x = cv.getContext('2d');
    x.fillStyle = '#f8f6f0'; // 写真の白い枠（下を広く）
    x.fillRect(0, 0, cv.width, cv.height);
    try {
      x.drawImage(src, 8, 8, w, h);
    } catch {
      return;
    }
    x.fillStyle = '#3a3e46';
    x.font = 'bold 14px sans-serif';
    x.textAlign = 'center';
    x.fillText(`${game.map?.from ?? ''} → ${game.map?.to ?? ''}　ゴール！`, cv.width / 2, h + 28);
  }

  // ---- 街の物 その 13 の動き：屋台村の湯気・カモと白鳥・打ち水（夏の昼だけ）・窓ふきのゴンドラ ----
  const c12 = { t: 0 };
  const c12m = new THREE.Matrix4(), c12q = new THREE.Quaternion(), c12p = new THREE.Vector3(), c12one = new THREE.Vector3(1, 1, 1), c12up = new THREE.Vector3(0, 1, 0);
  function syncCity12(game, dt) {
    c12.t += dt;
    const ud = world?.userData;
    if (!ud) return;
    if (ud.summerDay) ud.summerDay.visible = currentTime === 'day' && currentWeather === 'clear'; // 打ち水は晴れた夏の昼
    // 湯気：ゆらゆら上って薄くなり、また下から
    for (const sp of ud.steam?.children ?? []) {
      const u = (c12.t * 0.35 + sp.userData.ph) % 1;
      sp.position.set(sp.userData.x + Math.sin(c12.t * 1.3 + sp.userData.ph * 9) * 0.2, 1.3 + u * 2.2, sp.userData.z);
      sp.scale.setScalar(0.5 + u * 1.3);
      sp.material.opacity = 0.7 * (1 - u);
    }
    // カモと白鳥：群れの真ん中のまわりを、ゆっくり円を描いて泳ぐ
    const sw = ud.swimmers;
    if (sw) {
      const counts = { duck: 0, swan: 0 };
      for (const s of sw.list) {
        const a = c12.t * (s.kind === 'swan' ? 0.05 : 0.09) + s.ph;
        const x = s.cx + Math.cos(a) * s.r, z = s.cz + Math.sin(a) * s.r * 0.5;
        // 進む向き（円の接線）
        const tx = -Math.sin(a) * s.r, tz = Math.cos(a) * s.r * 0.5;
        c12q.setFromAxisAngle(c12up, Math.atan2(-tx, -tz));
        sw.meshes[s.kind].setMatrixAt(counts[s.kind]++, c12m.compose(c12p.set(x, Y.river + Math.sin(c12.t * 2 + s.ph) * 0.02, z), c12q, c12one));
      }
      for (const m of Object.values(sw.meshes)) m.instanceMatrix.needsUpdate = true;
    }
    // ゴンドラ：上から下まで 3 分かけて降り、上に戻る。ケーブルは吊り元からゴンドラまで
    for (const gd of ud.gondolas ?? []) {
      const u = ((c12.t + gd.ph) % 180) / 180;
      const y = -2 - u * (gd.h - 8);
      gd.gon.position.y = y;
      for (const [k, c] of gd.cables.entries()) {
        c.position.set(k ? 1.8 : -1.8, y / 2, -0.65);
        c.scale.y = Math.max(0.01, -y);
      }
    }
  }

  // 白い息：冬（雪の日と、夕方・夜）は、自転車の人の口のあたりから白い息が出て、後ろへ流れて消える
  const BREATH_N = 10;
  const breath = { sprites: null, next: 0, at: 0 };
  function syncBreath(game, dt) {
    if (!breath.sprites) {
      breath.sprites = Array.from({ length: BREATH_N }, () => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: STEAM_TEX, transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false;
        sp.name = 'breath'; // デバッグ・自動テスト用
        scene.add(sp);
        return { sp, life: 0, vx: 0, vz: 0 };
      });
    }
    const cold = currentSeason === 'winter' && (currentWeather === 'snow' || currentTime !== 'day') && cameraMode !== 'first';
    breath.at -= dt;
    if (cold && breath.at <= 0 && game.state !== 'title') {
      breath.at = 0.9 + (game.player.speed > 4 ? -0.4 : 0); // こいでいると息が速い
      const b = breath.sprites[breath.next];
      breath.next = (breath.next + 1) % BREATH_N;
      const p = game.player, fx = Math.sin(p.angle), fz = -Math.cos(p.angle);
      // 口の前：前かがみのロードバイクは前寄りで低く、背すじを立てて乗る自転車は真上寄りで高い
      const [ahead, up] = player.userData.type === 'road' || !player.userData.type ? [0.45, 1.6] : [0.3, 1.72];
      b.sp.position.set(p.x + fx * ahead, bikeH + up, p.y + fz * ahead);
      b.life = 1.2;
      b.vx = -fx * Math.max(0.6, p.speed * 0.7); // 走ると後ろへ流れる
      b.vz = -fz * Math.max(0.6, p.speed * 0.7);
    }
    for (const b of breath.sprites) {
      if (b.life <= 0) {
        b.sp.visible = false;
        continue;
      }
      b.life -= dt;
      const k = 1 - b.life / 1.2;
      b.sp.visible = true;
      b.sp.position.x += b.vx * dt;
      b.sp.position.z += b.vz * dt;
      b.sp.position.y += 0.15 * dt;
      b.sp.scale.setScalar(0.45 + k * 0.9);
      b.sp.material.opacity = 0.95 * (1 - k);
    }
  }

  // ---- 負けたときの演出：先に着いた電車のドアが、ホームの側で開き、乗客が降りてくる。カメラはホームから電車を見る ----
  const loseShow = { at: null, t: 0, people: [], meshes: null, side: 1 };
  function syncLoseShow(game, dt) {
    loseShow.t += dt;
    const route = game.map?.trainRoute;
    const lost = game.state === 'result' && game.result && !game.result.win && route && train.length && city5.geos && city3.geos;
    if (!lost) {
      if (loseShow.at !== null) {
        for (const car of train) if (car.userData.doorHolder) car.userData.doorHolder.visible = false;
        if (loseShow.meshes) for (const m of loseShow.meshes) m.count = 0;
      }
      loseShow.at = null;
      return;
    }
    if (loseShow.at === null) {
      loseShow.at = loseShow.t;
      // ホームのある側（addStations と同じ決め方。+1 は進む向きの左）
      const trainLen = carCount(route) * 20;
      const mid = pointAt(route, route.length - trainLen / 2);
      const { left, right } = nearbyTracks(worldMap, mid);
      const island = [[right, 1], [left, -1]].filter(([d]) => d >= 6 && d <= 16).sort((a, b) => a[0] - b[0])[0];
      loseShow.side = island ? island[1] : right >= left ? 1 : -1;
      const lx = loseShow.side > 0 ? -1 : 1; // 車両のローカルの x（+x は進む向きの右）
      if (!loseShow.meshes) {
        loseShow.meshes = [0, 1, 2, 3].map((k) => {
          const m = new THREE.InstancedMesh(walkingGeometry(city3.geos[`stand${k}`].body, 48, 'passengers'), walkMaterial(true), 48);
          m.frustumCulled = false;
          m.castShadow = true;
          m.name = 'passengers'; // デバッグ・自動テスト用
          scene.add(m);
          return m;
        });
      }
      loseShow.people = [];
      const v = new THREE.Vector3();
      train.forEach((car, ci) => {
        // ドア（ホームの側の 4 か所）
        if (!car.userData.doorHolder) {
          const holder = new THREE.Group();
          for (const dz of DOORS_Z) {
            const d = new THREE.Group();
            d.position.set(0, 0, dz);
            d.add(new THREE.Mesh(city5.geos.doorOpen.body, STREET_MAT));
            if (city5.geos.doorOpen.glow) d.add(new THREE.Mesh(city5.geos.doorOpen.glow, STREET_GLOW_MAT));
            holder.add(d);
          }
          car.add(holder);
          car.userData.doorHolder = holder;
        }
        for (const d of car.userData.doorHolder.children) d.rotation.y = lx > 0 ? 0 : Math.PI;
        car.userData.doorHolder.visible = false;
        car.updateMatrixWorld(true);
        const out = v.set(lx, 0, 0).transformDirection(car.matrixWorld).clone().setY(0).normalize();
        const fwd = new THREE.Vector3(0, 0, -1).transformDirection(car.matrixWorld).setY(0).normalize();
        for (const dz of DOORS_Z) {
          const n = 1 + Math.floor(Math.random() * 2);
          for (let k = 0; k < n; k++) {
            const start = car.localToWorld(new THREE.Vector3(lx * 1.25, 0, dz + (k - 0.5) * 0.4));
            loseShow.people.push({
              x: start.x, z: start.z, y: car.position.y - RAIL_TOP + PLATFORM_TOP, out, fwd: fwd.clone().multiplyScalar(Math.random() < 0.5 ? 1 : -1),
              delay: 0.9 + Math.random() * 1.6 + ci * 0.05, outD: 1.2 + Math.random() * 1.6, speed: 1.1 + Math.random() * 0.4, v: Math.floor(Math.random() * 4),
            });
          }
        }
      });
    }
    const since = loseShow.t - loseShow.at;
    for (const car of train) if (car.userData.doorHolder) car.userData.doorHolder.visible = since > 0.6;
    const counts = [0, 0, 0, 0];
    for (const pp of loseShow.people) {
      const walked = (since - pp.delay) * pp.speed;
      if (walked < 0 || counts[pp.v] >= 48) continue;
      let x, z, fx, fz;
      if (walked < pp.outD) (x = pp.x + pp.out.x * walked), (z = pp.z + pp.out.z * walked), (fx = pp.out.x), (fz = pp.out.z);
      else {
        const w2 = walked - pp.outD;
        x = pp.x + pp.out.x * pp.outD + pp.fwd.x * w2;
        z = pp.z + pp.out.z * pp.outD + pp.fwd.z * w2;
        (fx = pp.fwd.x), (fz = pp.fwd.z);
      }
      bEuler.set(0, Math.atan2(-fx, -fz), 0);
      bq.setFromEuler(bEuler);
      loseShow.meshes[pp.v].geometry.attributes.aSwing.array[counts[pp.v]] = Math.sin(walked * Math.PI / 0.7 + pp.v) * 0.45; // 2 歩で 1.4m
      loseShow.meshes[pp.v].setMatrixAt(counts[pp.v]++, bm4.compose(bPos.set(x, pp.y + Math.abs(Math.sin(walked * 3)) * 0.04, z), bq, bOne));
    }
    loseShow.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aSwing.needsUpdate = true;
    });
  }

  // ---- 表彰台（結果画面に出す小さな絵）：自分の服とヘルメットの色の人が、メダルの色の段に立って跳ねる ----
  // 画面の外の板（WebGLRenderTarget）に描いて読み出し、HUD のキャンバスに貼る（hud.podium）
  const PODIUM_W = 360, PODIUM_H = 210;
  const PODIUM_STEPS = { gold: [0, 1.0], silver: [1.25, 0.7], bronze: [-1.25, 0.45] }; // tools/build-city5.py の C5_Podium（台の向きの座標）
  const podium = { scene: null, t: 0, key: '' };
  function podiumImage(game, dt) {
    const r = game.result, medal = r?.medal?.medal;
    if (!r?.win || !medal || !city5.parts) return null;
    if (!podium.scene) {
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xffffff, 0x50505a, 2.0));
      const dl = new THREE.DirectionalLight(0xfff6e8, 2.4);
      dl.position.set(-3, 6, 5);
      s.add(dl);
      podium.scene = s;
      podium.cam = new THREE.PerspectiveCamera(30, PODIUM_W / PODIUM_H, 0.1, 60);
      podium.rt = new THREE.WebGLRenderTarget(PODIUM_W, PODIUM_H);
      podium.rt.texture.colorSpace = THREE.SRGBColorSpace;
      podium.buf = new Uint8Array(PODIUM_W * PODIUM_H * 4);
      podium.canvas = document.createElement('canvas');
      podium.canvas.width = PODIUM_W;
      podium.canvas.height = PODIUM_H;
      podium.ctx = podium.canvas.getContext('2d');
      podium.img = podium.ctx.createImageData(PODIUM_W, PODIUM_H);
      // 台と立つ人は、前（glb の -z）をカメラ（+z の側）へ向けるため半回転した入れ物に入れる
      const stage = new THREE.Group();
      stage.rotation.y = Math.PI;
      stage.add(new THREE.Mesh(city5.geos.podium.body, STREET_MAT));
      podium.champ = new THREE.Mesh(new THREE.BufferGeometry(), STREET_MAT);
      podium.medal = new THREE.Mesh(new THREE.BufferGeometry(), STREET_MAT);
      stage.add(podium.champ, podium.medal);
      podium.bike = makeBike({}, 1, 'road');
      s.add(stage, podium.bike);
    }
    const colors = { frame: 0xffcc33, jersey: 0xffcc33, shorts: 0x22324f, helmet: 0xe8443a, ...player.userData.colors };
    const key = JSON.stringify([colors, player.userData.type, medal.id]);
    if (key !== podium.key) {
      podium.key = key;
      const lin = (hex) => {
        const c = new THREE.Color(hex);
        return [c.r, c.g, c.b];
      };
      const wear = { BK_Jersey: colors.jersey, BK_Shorts: colors.shorts, BK_Skin: 0xf2d0a9, BK_Helmet: colors.helmet, BK_Saddle: 0x15171b, C5_Medal: parseInt(medal.color.slice(1), 16) };
      const colorOf = (part) => (wear[part.material] != null ? lin(wear[part.material]) : part.color);
      podium.champ.geometry.dispose();
      podium.champ.geometry = addModelParts(new GeometryBuilder(true), city5.parts.champion, colorOf).build();
      podium.medal.geometry.dispose();
      podium.medal.geometry = addModelParts(new GeometryBuilder(true), city5.parts.medal, colorOf).build();
      Object.assign(podium.bike.userData, { colors, type: player.userData.type });
      fillBike(podium.bike);
      // 自転車は止めてあるだけ（乗る人と脚は出さない）
      const bs = podium.bike.userData;
      for (const o of [...(bs.lamps ?? []), bs.poncho, bs.rider, ...(bs.legs ?? []).flatMap((l) => [l.thigh, l.shin, l.shoe])]) if (o) o.visible = false;
      podium.bike.position.set(2.3, 0, -1.3); // 3 位の台の後ろに止める
      podium.bike.rotation.set(0, 0.5, 0);
    }
    podium.t += dt;
    const [sx, sy] = PODIUM_STEPS[medal.id] ?? PODIUM_STEPS.gold;
    const hop = Math.max(0, Math.sin(podium.t * 4)) * 0.08;
    podium.champ.position.set(sx, sy + hop, 0);
    podium.medal.position.copy(podium.champ.position);
    const a = Math.sin(podium.t * 0.5) * 0.3;
    podium.cam.position.set(Math.sin(a) * 6.2 + 0.4, 2.3, Math.cos(a) * 6.2);
    podium.cam.lookAt(0.4, 1.25, 0);
    const prevTarget = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(podium.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(podium.scene, podium.cam);
    renderer.readRenderTargetPixels(podium.rt, 0, 0, PODIUM_W, PODIUM_H, podium.buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    // 下から上の並びを、上から下へ
    const row = PODIUM_W * 4;
    for (let y = 0; y < PODIUM_H; y++) podium.img.data.set(podium.buf.subarray((PODIUM_H - 1 - y) * row, (PODIUM_H - y) * row), y * row);
    podium.ctx.putImageData(podium.img, 0, 0);
    return podium.canvas;
  }

  // ---- タイトル画面のミニチュア：山手線の 30 駅を結ぶ環状の線路を台の上に作り、小さな電車がぐるぐる回る ----
  // 駅の位置は data/stations.json（縮尺 1/150）。ビルと木、東京タワーとスカイツリー、主な駅の名前の札。カメラはゆっくり回る
  const DIO_SCALE = 1 / 150, DIO_TRAIN = 1 / 6; // 電車は見やすいよう大きく
  const dio = { scene: null, t: 0, stations: null };
  fetch('data/stations.json')
    .then((r) => r.json())
    .then((d) => (dio.stations = Object.values(d.stations)))
    .catch((e) => console.warn('駅の一覧を読み込めませんでした（タイトル画面のミニチュア）', e));
  function buildDiorama() {
    const g = city5.geos;
    const st = dio.stations;
    const lat0 = st.reduce((s, x) => s + x.lat, 0) / st.length, lon0 = st.reduce((s, x) => s + x.lon, 0) / st.length;
    const xz = (lat, lon) => [(lon - lon0) * 90400 * DIO_SCALE, -(lat - lat0) * 110950 * DIO_SCALE];
    const scn = new THREE.Scene();
    scn.background = new THREE.Color(0x9cc4e8);
    scn.add(new THREE.HemisphereLight(0xffffff, 0x5a5048, 1.7));
    const dl = new THREE.DirectionalLight(0xfff4e0, 2.2);
    dl.position.set(-30, 60, 40);
    scn.add(dl);
    const pts = st.map((s) => new THREE.Vector3(...((p) => [p[0], 0.25, p[1]])(xz(s.lat, s.lon))));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const L = curve.getLength();
    const tower = xz(35.6586, 139.7454), skytree = xz(35.7101, 139.8107);
    let minX = Math.min(...pts.map((p) => p.x), skytree[0]) - 10, maxX = Math.max(...pts.map((p) => p.x), skytree[0]) + 10;
    let minZ = Math.min(...pts.map((p) => p.z)) - 10, maxZ = Math.max(...pts.map((p) => p.z)) + 10;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    // 台（上は芝生の緑、横は木）
    const side = new THREE.MeshLambertMaterial({ color: 0x8a6440 }), top = new THREE.MeshLambertMaterial({ color: 0x7aa860 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 2, maxZ - minZ), [side, side, top, side, side, side]);
    base.position.set(cx, -1, cz);
    scn.add(base);
    // 線路（道床と 2 本のレール）
    const N = 700, sp = curve.getSpacedPoints(N);
    const b = new GeometryBuilder(true);
    for (const [off, w, y, col] of [[0, 1.6, 0.02, [0.5, 0.48, 0.45]], [-0.36, 0.1, 0.06, [0.66, 0.68, 0.72]], [0.36, 0.1, 0.06, [0.66, 0.68, 0.72]]]) {
      for (let i = 0; i < N; i++) {
        const a = sp[i], c = sp[i + 1];
        const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        const p = (q, s) => [q.x + nx * (off + (s * w) / 2), y, q.z + nz * (off + (s * w) / 2)];
        b.tri(p(a, -1), p(c, -1), p(c, 1), UP, col);
        b.tri(p(a, -1), p(c, 1), p(a, 1), UP, col);
      }
    }
    scn.add(new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    const nearTrack = (x, z, d) => sp.some((q) => Math.abs(q.x - x) < d && Math.abs(q.z - z) < d && Math.hypot(q.x - x, q.z - z) < d);
    // 駅のホーム（線路の横）と、主な駅の名前の札
    const rnd = seededRng('diorama');
    const placeMany = (geo, list) => {
      const m = new THREE.InstancedMesh(geo, STREET_MAT, list.length);
      list.forEach((mt, i) => m.setMatrixAt(i, mt));
      scn.add(m);
      return m;
    };
    const mt = (x, y, z, rot, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
    const stationMs = [];
    const BIG = new Set(['渋谷', '新宿', '池袋', '上野', '東京', '品川']);
    st.forEach((s, i) => {
      // 駅にいちばん近い曲線の点
      let best = 0, bd = Infinity;
      sp.forEach((q, k) => {
        const d = Math.hypot(q.x - pts[i].x, q.z - pts[i].z);
        if (d < bd) (bd = d), (best = k);
      });
      const a = sp[best], c = sp[(best + 1) % N];
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      stationMs.push(mt(a.x + nx * 1.25, 0.02, a.z + nz * 1.25, Math.atan2(-dx, -dz)));
      if (BIG.has(s.name)) {
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 96;
        const x2 = cv.getContext('2d');
        x2.fillStyle = 'rgba(20, 24, 30, 0.82)';
        x2.beginPath();
        x2.roundRect(8, 8, 240, 80, 16);
        x2.fill();
        x2.fillStyle = '#9acd32';
        x2.fillRect(8, 76, 240, 10);
        x2.fillStyle = '#ffffff';
        x2.font = 'bold 48px sans-serif';
        x2.textAlign = 'center';
        x2.textBaseline = 'middle';
        x2.fillText(s.name, 128, 44);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        label.scale.set(8, 3, 1);
        label.position.set(a.x + nx * 1.25, 6.5, a.z + nz * 1.25);
        label.renderOrder = 2;
        scn.add(label);
      }
    });
    placeMany(g.miniStation.body, stationMs);
    // ビル（駅の近くは高いビル）と木
    const bldg = [[], [], [], []], trees = [];
    for (let k = 0; k < 1400 && bldg.flat().length < 330; k++) {
      const x = minX + 2 + rnd() * (maxX - minX - 4), z = minZ + 2 + rnd() * (maxZ - minZ - 4);
      if (nearTrack(x, z, 2.6) || Math.hypot(x - tower[0], z - tower[1]) < 3 || Math.hypot(x - skytree[0], z - skytree[1]) < 3) continue;
      const dSt = Math.min(...pts.map((p) => Math.hypot(p.x - x, p.z - z)));
      const type = dSt < 7 ? (rnd() < 0.6 ? 2 : 1) : dSt < 15 ? (rnd() < 0.5 ? 1 : 0) : rnd() < 0.5 ? 0 : 3;
      if (dSt > 12 && rnd() < 0.35) {
        trees.push(mt(x, 0, z, rnd() * 6, 0.8 + rnd() * 0.6));
        continue;
      }
      bldg[type].push(mt(x, 0, z, Math.floor(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.2, 0.8 + rnd() * 0.5));
    }
    bldg.forEach((list, k) => list.length && placeMany(g[`miniBldg${k}`].body, list));
    const winGlow = [];
    bldg.forEach((list, k) => {
      if (!list.length || !g[`miniBldg${k}`].glow) return;
      const m = placeMany(g[`miniBldg${k}`].glow, list);
      m.material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffe0a0, emissiveIntensity: 0.25 });
      winGlow.push(m);
    });
    if (trees.length) placeMany(g.miniTree.body, trees);
    placeMany(g.miniTower.body, [mt(tower[0], 0, tower[1], 0.4, 1.3)]);
    placeMany(g.miniSkytree.body, [mt(skytree[0], 0, skytree[1], 0, 1.6)]);
    // 小さな電車（11 両）
    const cars = [];
    for (let i = 0; i < 11; i++) {
      const car = makeTrainCar(i === 0 ? 'lead' : i === 10 ? 'tail' : 'middle', i % 4 === 2);
      car.scale.setScalar(DIO_TRAIN);
      car.traverse((m) => m.material && (m.material.opacity = 1));
      scn.add(car);
      cars.push(car);
    }
    const cam = new THREE.PerspectiveCamera(42, viewW / viewH || 1.6, 1, 600);
    return { scene: scn, cam, curve, L, cars, center: [cx, cz], radius: Math.max(maxX - minX, maxZ - minZ) * 0.62 };
  }
  const dioA = new THREE.Vector3(), dioB = new THREE.Vector3();
  function renderDiorama(dt) {
    if (!dio.scene) {
      if (!city5.geos || !dio.stations) return false;
      Object.assign(dio, buildDiorama());
    }
    dio.t += dt;
    const s = dio.t * 7;
    const carL = CAR_LEN * DIO_TRAIN, gap = 20 * DIO_TRAIN;
    const at = (d, v) => dio.curve.getPointAt((((d / dio.L) % 1) + 1) % 1, v);
    dio.cars.forEach((car, i) => {
      at(s - i * gap, dioA);
      at(s - i * gap - carL, dioB);
      car.position.set((dioA.x + dioB.x) / 2, 0.12, (dioA.z + dioB.z) / 2);
      car.rotation.set(0, -Math.atan2(dioA.x - dioB.x, -(dioA.z - dioB.z)), 0);
    });
    const a = dio.t * 0.05 + 0.6, R = dio.radius;
    dio.cam.aspect = viewW / viewH || 1.6;
    dio.cam.updateProjectionMatrix();
    dio.cam.position.set(dio.center[0] + Math.sin(a) * R, R * 0.62, dio.center[1] + Math.cos(a) * R);
    dio.cam.lookAt(dio.center[0], 0, dio.center[1]);
    renderer.render(dio.scene, dio.cam);
    return true;
  }

  // 渋谷スクランブル交差点：交差点の信号が赤（車が止まる）のあいだ、四隅から人がいっせいに渡る（斜めにも）。
  // 青のあいだは四隅で待つ。見た目だけ（人の当たり判定はない）。人の形は tools/build-city3.py の待つ人
  const scramble = { map: null, people: [], meshes: null, group: null };
  function syncScramble(game, dt) {
    const g3 = city3.geos;
    if (!g3 || !worldMap || !worldMap.origin) return;
    if (scramble.map !== worldMap) {
      if (scramble.meshes) for (const m of scramble.meshes) scene.remove(m);
      scramble.map = worldMap;
      scramble.meshes = null;
      scramble.people = [];
      const [cx, cz] = latLonXY(worldMap, SCRAMBLE.lat, SCRAMBLE.lon);
      if (!inBounds(worldMap, cx, cz)) return;
      // 交差点の向き：いちばん近い車道の向き
      const near = nearestRoadPoint(worldMap, cx, cz, true);
      let ux = 1, uz = 0;
      if (near) {
        const r = near.road;
        let bi = 0, bd = Infinity;
        for (let k = 0; k + 3 < r.p.length; k += 2) {
          const d = Math.hypot((r.p[k] + r.p[k + 2]) / 2 - near.x, (r.p[k + 1] + r.p[k + 3]) / 2 - near.z);
          if (d < bd) (bd = d), (bi = k);
        }
        const l = Math.hypot(r.p[bi + 2] - r.p[bi], r.p[bi + 3] - r.p[bi + 1]) || 1;
        (ux = (r.p[bi + 2] - r.p[bi]) / l), (uz = (r.p[bi + 3] - r.p[bi + 1]) / l);
      }
      const hh = SCRAMBLE.half;
      const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [cx + ux * a * hh - uz * b * hh, cz + uz * a * hh + ux * b * hh]);
      scramble.corners = corners;
      scramble.center = [cx, cz];
      scramble.group = null;
      scramble.meshes = [0, 1, 2, 3].map((k) => {
        const m = new THREE.InstancedMesh(walkingGeometry(g3[`stand${k}`].body, SCRAMBLE.people), walkMaterial(true), SCRAMBLE.people);
        m.castShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        scene.add(m);
        return m;
      });
      for (let i = 0; i < SCRAMBLE.people; i++) {
        const c = i % 4;
        scramble.people.push({ from: c, to: c, t: 1, v: i % 4, jx: (Math.random() - 0.5) * 6, jz: (Math.random() - 0.5) * 6, speed: 1.1 + Math.random() * 0.5 });
      }
    }
    if (!scramble.meshes) return;
    const obs = game.obstacles;
    if (!scramble.group || scramble.obs !== obs) {
      // 交差点の信号（真ん中から 60m 以内のいちばん近い信号のまとまり。区間を読み直すと作り直されるので、そのたびに探す）
      scramble.obs = obs;
      scramble.group = null;
      let best = Infinity;
      for (const sg of obs?.signals ?? []) {
        for (const [x, y] of sg.nodes) {
          const d = Math.hypot(x - scramble.center[0], y - scramble.center[1]);
          if (d < best && d < 60) (best = d), (scramble.group = sg);
        }
      }
    }
    const walk = scramble.group && obs ? signalState(scramble.group, obs.clock) === 'red' : false;
    const counts = [0, 0, 0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const [cx, cz] = scramble.center;
    for (const p of scramble.people) {
      if (p.t >= 1 && walk && Math.random() < dt * 0.8) {
        // 赤のあいだに、別の隅（斜めも）へ渡り始める
        p.from = p.to;
        p.to = (p.from + 1 + Math.floor(Math.random() * 3)) % 4;
        p.t = 0;
      }
      const [ax, az] = scramble.corners[p.from], [bx, bz] = scramble.corners[p.to];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      if (p.t < 1) p.t = Math.min(1, p.t + (p.speed * dt) / len);
      // 隅では交差点の外側に少し下がって待つ
      const out = (k) => [scramble.corners[k][0] + (scramble.corners[k][0] - cx) * 0.12, scramble.corners[k][1] + (scramble.corners[k][1] - cz) * 0.12];
      const [sx, sz] = out(p.from), [ex, ez] = out(p.to);
      const x = sx + (ex - sx) * p.t + p.jx * 0.5, z = sz + (ez - sz) * p.t + p.jz * 0.5;
      const moving = p.t > 0 && p.t < 1;
      const face = moving ? Math.atan2(-(ex - sx), -(ez - sz)) : Math.atan2(-(cx - x), -(cz - z));
      q.setFromAxisAngle(up, face);
      pos.set(x, moving ? Math.abs(Math.sin(p.t * len * 3)) * 0.04 : 0, z);
      scramble.meshes[p.v].geometry.attributes.aSwing.array[counts[p.v]] = moving ? Math.sin((p.t * len * Math.PI) / 0.7 + p.jx) * 0.45 : 0;
      addMover('ped', x, z, 0, 0, 1, PERSON_HIT_R);
      scramble.meshes[p.v].setMatrixAt(counts[p.v]++, m4.compose(pos, q, one));
    }
    scramble.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aSwing.needsUpdate = true;
    });
  }

  // 踏切：電車（ライバルの山手線とほかの路線の電車）が近ければ遮断機を下ろして灯を交互に点ける
  let crossingClock = 0;
  function syncCrossings(game, dt) {
    const list = world?.userData.crossings;
    if (!list?.length) return;
    crossingClock += dt;
    const trainsNear = (c) => {
      const near = (o) => o.visible && Math.hypot(o.position.x - c.x, o.position.z - c.z) < CROSSING_NEAR_M;
      return (trainGroup.visible && train.some(near)) || otherTrains.list.some((t) => t.cars.some(near));
    };
    for (const c of list) {
      const closing = trainsNear(c);
      c.closed = Math.max(0, Math.min(1, c.closed + (closing ? dt / 4 : -dt / 3))); // 4 秒で下り、3 秒で上がる
      const blink = closing || c.closed > 0;
      const on = Math.floor(crossingClock * 2) % 2;
      for (const u of c.units) {
        u.arm.rotation.x = ARM_UP * (1 - c.closed);
        u.lamps[0].visible = blink && on === 0;
        u.lamps[1].visible = blink && on === 1;
      }
    }
  }

  function syncTrain(game) {
    const route = game.map.trainRoute;
    const show = game.inRace && route;
    trainGroup.visible = Boolean(show);
    if (!show) return;
    const n = carCount(route);
    // 両数が変わったら作り直す（先頭・最後尾・パンタグラフの位置が変わるため）。Blender の電車を読み込み終えたときも
    if (train.length !== n || (trainModel && !train[0]?.userData.fromModel)) {
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
    for (const [key, mesh] of tiles) mesh.renderOrder = fadeTo(mesh.userData, [mesh.material], fade.has(key) ? SEE_THROUGH : 1, dt) ? 1 : 0;
    // Blender のモデル：カメラ → 自転車の線が、モデルの面に当たれば透かす
    // （まずモデルの範囲の箱で絞り、当たりそうなときだけ面を調べる。正面の歩道を走っているだけでは透かさない）
    for (const m of world.userData.models ?? []) {
      occA.set(ax, ay, az);
      occB.set(bx, by, bz);
      const d = occA.distanceTo(occB);
      m.worldToLocal(occA);
      m.worldToLocal(occB);
      occRay.origin.copy(occA);
      occRay.direction.copy(occB).sub(occA).normalize();
      const hit = occRay.intersectBox(m.userData.box, occHit) !== null && occA.distanceTo(occHit) < d;
      let blocked = false;
      if (hit) {
        occCaster.set(camera.position, occB.set(bx - ax, by - ay, bz - az).normalize());
        occCaster.far = d;
        blocked = occCaster.intersectObject(m, true).length > 0;
      }
      m.renderOrder = fadeTo(m.userData.fade, m.userData.materials, blocked ? SEE_THROUGH : 1, dt) ? 1 : 0;
    }
  }
  const occA = new THREE.Vector3(), occB = new THREE.Vector3(), occHit = new THREE.Vector3(), occRay = new THREE.Ray();
  const occCaster = new THREE.Raycaster();

  // 透かす割合（state.opacity）を target へ少しずつ近づける。透けていれば true
  function fadeTo(state, materials, target, dt) {
    const o = state.opacity;
    if (o === target) return o < 1;
    const next = target < o ? Math.max(target, o - FADE_SPEED * dt) : Math.min(target, o + FADE_SPEED * dt);
    state.opacity = next;
    const transparent = next < 1;
    for (const mat of materials) {
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.depthWrite = !transparent; // 透かした建物の向こうも描く
        mat.needsUpdate = true;
      }
      mat.opacity = next;
    }
    return transparent;
  }

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = (from, to, dt) => from + (to - from) * Math.min(1, CAMERA_EASE * dt);

  const camLook = new THREE.Vector3(), camBall = new THREE.Vector3(), camTo = new THREE.Vector3();
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
    camLook.set(p.x + lx * cam.ahead, bikeH + (cameraMode === 'first' ? 1.5 : 1), p.y + lz * cam.ahead);
    // ゴールの演出のあいだは、ゴールの門の手前（自転車のいる側）へカメラを寄せ、割れるくす玉を見上げる
    // （ゴールの判定は門の 25 m 手前なので、そのままだとくす玉が小さい）
    const gs = world?.userData.goalShow;
    if (gs && goalShow.openAt !== null) {
      const w = Math.min(1, (goalShow.t - goalShow.openAt) / 1.2);
      const e = w * w * (3 - 2 * w);
      const gate = gs.ball.parent;
      camTo.set(p.x, bikeH, p.y);
      gate.worldToLocal(camTo);
      camTo.set(0, 2.4, (camTo.z >= 0 ? 1 : -1) * 12);
      gate.localToWorld(camTo);
      camera.position.lerp(camTo, e);
      gs.ball.getWorldPosition(camBall);
      camBall.y -= GOAL_BALL_R * 2.2;
      camLook.lerp(camBall, e);
    }
    // 負けたときは、ホームから、着いた電車（真ん中の車両）を見る
    if (loseShow.at !== null && train.length) {
      const w = Math.min(1, (loseShow.t - loseShow.at) / 1.0);
      const e = w * w * (3 - 2 * w);
      const car = train[Math.floor(train.length / 2)];
      camTo.set(loseShow.side > 0 ? -1 : 1, 0, 0).transformDirection(car.matrixWorld).setY(0).normalize();
      camBall.copy(car.position).addScaledVector(camTo, 1.5);
      camBall.y += 1.9;
      camTo.multiplyScalar(11).add(car.position);
      camTo.y = car.position.y + 3.0;
      camera.position.lerp(camTo, e);
      camLook.lerp(camBall, e);
    }
    camera.lookAt(camLook);
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
    // 自分の自転車の種類（road / city / ebike）と色（frame・jersey・shorts・helmet）。ゴーストも同じ種類にする
    setBike(type, colors) {
      player.userData.type = ghost.userData.type = type;
      player.userData.colors = colors;
      fillBike(player);
      this.setGhostLook(ghostLook);
    },

    // ゴーストの見た目（white：白い半透明 / glow：光る水色 / green：山手線の黄緑 / mine：自分と同じ色の半透明）
    setGhostLook(look) {
      ghostLook = GHOST_LOOKS[look] ? look : 'white';
      const L = GHOST_LOOKS[ghostLook];
      const one = (hex) => ({ frame: hex, jersey: hex, shorts: hex, helmet: hex, skin: hex, tire: hex, metal: hex, saddle: hex });
      Object.assign(ghost.userData, {
        colors: L.color === 'mine' ? { ...player.userData.colors } : L.color === 'white' ? GHOST_WHITE : one(L.color),
        opacity: L.opacity,
        glow: Boolean(L.glow),
      });
      fillBike(ghost);
    },

    // 軽さ（high：ふつう / mid：軽い / low：とても軽い）。画面の細かさ・影・道を行き来する人や車の数を減らす
    setQuality(q) {
      quality = QUALITY[q] ?? QUALITY.high;
      updateShadows();
      // 描く距離（霧もそれに合わせて近くに）
      camera.far = quality.far;
      camera.updateProjectionMatrix();
      if (scene.fog) scene.fog.far = Math.min(fogFarBase, quality.far - 30);
      for (const wd of worlds.values()) applyQualityTo(wd.group);
      updateDistanceCull(true);
      this.resize(viewW, viewH, lastDpr);
    },

    // 今の区間の立体を作るのにかかった時間 ms（街の物の種類ごと）と、今の画面を描いた回数・三角形の数（重さの見直し用）
    get stats() {
      return { build: world?.userData.buildTimes ?? null, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: Math.round(fps) };
    },

    setAtmosphere(time, weather) {
      const t = TIMES[time] ?? TIMES.evening, w = WEATHERS[weather] ?? WEATHERS.clear;
      currentWeather = weather; // 雨の日は歩行者が傘をさす
      currentTime = TIMES[time] ? time : 'evening'; // 夏の花火・富士山
      shadowAtmosphere = currentTime !== 'night' && weather === 'clear';
      updateShadows();
      if (prevWeather && prevWeather !== 'clear' && weather === 'clear') rainbow.at = c7.t; // 雨や雪がやんだら虹（天気の切り替えは 雨→雪→晴れ の順）
      prevWeather = weather;
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
      fogBase.copy(fog);
      for (const key of ['top', 'mid', 'horizon']) skyBase[key].copy(u[key].value);
      scene.fog.near = w.fogNear;
      fogFarBase = w.fogFar;
      scene.fog.far = Math.min(w.fogFar, quality.far - 30); // 軽さの設定で描く距離を短くしたときは、霧も近くに
      renderer.setClearColor(fog);
      hemi.color.set(t.hemi[0]);
      hemi.groundColor.set(t.hemi[1]);
      hemi.intensity = hemiBase = t.hemi[2] * w.light; // 稲光のときは syncLightning で一瞬強くする
      sun.color.set(t.sun[0]);
      sun.intensity = t.sun[1] * w.light * (weather === 'clear' ? 1 : 0.6);
      SUN_DIR.set(...t.sunDir).normalize();
      // 窓の灯り（今ある区間の立体すべてと、これから作る区間）
      windowGlow = t.glow;
      for (const wd of worlds.values()) for (const m of wd.group?.userData.tiles?.values() ?? []) m.material.emissiveIntensity = t.glow;
      for (const { material, base } of modelGlows) material.emissiveIntensity = base * t.glow; // Blender のモデルの窓・灯り
      for (const car of train) car.traverse((m) => m.userData?.trainGlass && (m.material.emissiveIntensity = t.glow * 0.7)); // 電車の窓
      OTHER_TRAIN_GLOW.color.setScalar(Math.min(1, 0.3 + t.glow * 0.55)); // ほかの路線の電車の窓（昼は暗いガラス）
      NEON_MAT.color.setScalar(t.lamps ? 1 : 0.5); // 繁華街のネオン（昼は少し暗く）
      // 街灯：昼は消す。夜は足もとをより明るく
      LAMP_MAT.color.set(t.lamps ? 0xffd9a0 : 0x6b6e75);
      POOL_MAT.visible = t.lamps;
      POOL_MAT.opacity = time === 'night' ? 0.6 : 0.35;
      TREE_LIGHT_MAT.visible = t.lamps; // 冬のイルミネーション
      // 自転車：雨の日は合羽、夕方と夜はライト
      bikeLook.rain = weather === 'rain';
      bikeLook.lights = t.lamps;
      for (const b of bikes) {
        const s = b.userData;
        if (s.poncho) s.poncho.visible = bikeLook.rain;
        for (const l of s.lamps ?? []) l.visible = bikeLook.lights;
      }
      for (const l of podium.bike?.userData.lamps ?? []) l.visible = false;
      if (podium.bike?.userData.poncho) podium.bike.userData.poncho.visible = false;
    },

    // ベルを鳴らしたとき（game.js から）：自転車の上に音符を出す
    ringBell() {
      ringBellNotes();
    },

    // 自分の自転車の飾り（none / scarf / bag / flowers）
    setAccessory(accessory) {
      player.userData.accessory = accessory;
      fillBike(player);
    },

    // 季節（spring / summer / autumn / winter）：木の葉の色、桜の花びら、七夕・クリスマスなどの飾り。見た目だけ
    setSeason(season) {
      currentSeason = SEASON_LEAVES[season] ? season : 'summer';
      applySeasonLeaves(currentSeason);
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
        applyQualityTo(world);
        setupDistanceCull(world);
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
      lastDpr = dpr;
      renderer.setPixelRatio(Math.min(dpr, quality.maxPixel) * quality.pixel);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    // 自転車が、道を走るほかの自転車・バイク・大きな車・歩道の人などにぶつかっているか。ぶつかった物の種類か null を返す
    // （位置は最後に描いたときのもの。橋の上と下のように高さが違えばぶつからない）
    hitTest(p) {
      for (const m of movers) {
        if (Math.abs(m.h - bikeH) > 2.5) continue;
        const dx = p.x - m.x, dz = p.y - m.z;
        const along = Math.max(-m.extra, Math.min(m.extra, dx * m.hx + dz * m.hz));
        if (Math.hypot(dx - m.hx * along, dz - m.hz * along) < m.r) return m.type;
      }
      return null;
    },

    drawWorld(game, hudCtx) {
      // HUD のキャンバスは毎回まっさらにする（3D の世界が透けて見える）
      hudCtx.setTransform(1, 0, 0, 1, 0, 0);
      hudCtx.clearRect(0, 0, hudCtx.canvas.width, hudCtx.canvas.height);
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      const dt = Math.min(0.1, rawDt);
      lastTime = now;
      if (rawDt > 0) fps += (1 / rawDt - fps) * 0.05;
      r3d.hud.fps = Math.round(fps);
      // タイトル画面と遊び方の画面は、山手線のミニチュア（区間の街はその間も少しずつ作る）
      if ((game.state === 'title' || game.state === 'howto') && renderDiorama(dt)) {
        if (game.map) {
          if (game.map !== worldMap) setMap(game.map);
          advanceWorlds(game, dt);
        }
        Object.assign(r3d.hud, { goal3d: null, landmarks3d: null, podium: null });
        return;
      }
      if (!game.map) return;
      if (game.map !== worldMap) setMap(game.map);
      advanceWorlds(game, dt);

      const p = game.player;
      // 自転車の高さ：今いる道路（橋の上なら橋の高さ）。急に変わらないよう少しなめらかにする
      const rh = roadH();
      const targetH = groundHeight(rh, game.surface.segs, p.x, p.y, bikeH);
      bikeH = game.state === 'racing' ? bikeH + (targetH - bikeH) * Math.min(1, 12 * dt) : targetH;
      animateBike(player, p, game.state === 'racing' ? p.speed : 0, dt, bikeH);
      // 夕方と夜は、自転車のライトが前の路面を照らす
      headPool.visible = bikeLook.lights;
      headPool.position.set(p.x + Math.sin(p.angle) * 4.6, bikeH + Y.signal + 0.03, p.y - Math.cos(p.angle) * 4.6);
      headPool.rotation.set(-Math.PI / 2, -p.angle, 0);
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
      movers.length = 0;
      lastPlayer = p;
      syncAgents(game.obstacles);
      syncTrain(game);
      syncOtherTrains(dt);
      syncRiders(game, dt);
      syncCrossings(game, dt);
      syncStartShow(game, dt);
      syncGoalShow(game, dt);
      syncLoseShow(game, dt);
      syncCity5(game, dt);
      syncCity6(game, dt);
      syncCity7(game, dt);
      syncCity8(game, dt);
      syncCity9(game, dt);
      syncCity10(game, dt);
      syncCity11(game, dt);
      syncCity12(game, dt);
      // 街の物 その 14：冬の夜のイルミネーション、ライトアップの光のゆらぎ、屋形船の灯と水面の光（夕方と夜だけ）
      const lit = currentTime !== 'day';
      if (world?.userData.winterNight) world.userData.winterNight.visible = lit;
      YAKATA_NIGHT_MAT.visible = lit;
      REFLECT_MAT.visible = lit && quality === QUALITY.high; // 水面の光は「ふつう」のときだけ
      REFLECT_MAT.opacity = 0.25 + 0.12 * Math.sin(c12.t * 2.3) + 0.05 * Math.sin(c12.t * 5.1); // 水面でゆらぐ
      BEAM_MAT.opacity = currentTime === 'night' ? 0.2 : 0.14;
      syncCity14(world?.userData, c12.t, currentTime, currentWeather);
      syncBreath(game, dt);
      syncScramble(game, dt);
      placeCamera(game, dt);
      // デバッグ・自動テスト用：window.render3d.debugCamera = { pos: [x, y, z], look: [x, y, z] } でカメラを固定する
      const dc = window.render3d?.debugCamera;
      if (dc) {
        camera.position.set(...dc.pos);
        camera.lookAt(...dc.look);
      }
      if (game.replay) syncReplay(game, dt); // ゴール後のリプレイ（自転車とカメラを上書き）
      updateDistanceCull(false); // 遠くの小物を描かない（カメラが動いたら並べ直す）
      sky.position.copy(camera.position);
      syncSky(game, dt);
      placeFarTowers();
      locateGoal(game);
      locateLandmarks(game);
      fadeOccluders(game, dt);
      renderer.render(scene, camera);
      // 記念写真：くす玉が割れて 1.2 秒のところで、描いたばかりの画面を写す
      if (game.state !== 'result') photo.taken = false;
      else if (goalShow.openAt !== null && goalShow.t - goalShow.openAt > 1.2) takeGoalPhoto(game);
      r3d.hud.photo = game.state === 'result' && photo.taken && game.result?.win ? photo.canvas : null;
      // 勝ったときの結果画面に出す表彰台の絵
      r3d.hud.podium = game.state === 'result' && game.result?.win ? podiumImage(game, dt) : null;
      // 今回だけ画面の外でも描いた区画を元に戻す
      for (const m of unculled) m.frustumCulled = !m.userData.keepUnculled; // 動かす物（鳥・自動ドアなど）は画面の外の判定をしないまま
      unculled = [];
    },
  };
  window.render3d = { renderer, scene, camera, r3d, otherTrains, riders, sky2, scramble, c9, movers }; // デバッグ・自動テスト用
  return r3d;
}

// src/town3d.js が使う共通の部品
export {
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
};
