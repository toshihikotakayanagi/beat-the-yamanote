// 車の見た目（2D版・3D版で共通）：車種と大きさ。車体の色は obstacles.js が決めた色（a.color）を使う。
// 車種はゲームの乱数を使わず、車ごとに決まっている速さ（a.speed）と、出てきた道の幅（a.spawnW）から決める
// （乱数の並びが変わらないので車や歩行者の動きは変わらず、同じ車はいつも同じ車種になる）。
// 路線バスとトラック（long）は長いので、自転車とぶつかる範囲と止まる位置を車体の長さに合わせる（obstacles.js）。
// 寸法は m。L：長さ、W：幅、H：高さ。前は -y（3D では -z）

export const CAR_TYPES = {
  // セダン：低く長い。窓の部分は前後が斜め
  sedan: { L: 4.6, W: 1.76, body: [0.32, 0.92], cabin: [0.92, 1.42], cabinBottom: [-1.15, 1.35], cabinTop: [-0.55, 0.9] },
  // 軽自動車：短く背が高い箱形
  kei: { L: 3.4, W: 1.48, body: [0.3, 0.88], cabin: [0.88, 1.68], cabinBottom: [-0.75, 1.55], cabinTop: [-0.45, 1.5] },
  // ミニバン：長く背が高い
  minivan: { L: 4.7, W: 1.78, body: [0.32, 1.0], cabin: [1.0, 1.86], cabinBottom: [-1.35, 2.25], cabinTop: [-0.95, 2.2] },
  // タクシー（JPN TAXI のような背の高い車。濃紺に屋根の行灯）
  taxi: { L: 4.4, W: 1.7, body: [0.32, 0.98], cabin: [0.98, 1.72], cabinBottom: [-1.0, 1.95], cabinTop: [-0.65, 1.9], color: '#1f2a44', sign: true },
  // 路線バス（都営バスのような白い車体に緑の帯）
  bus: { L: 10.5, W: 2.49, body: [0.32, 1.3], cabin: [1.3, 3.05], cabinBottom: [-5.1, 5.0], cabinTop: [-5.1, 5.0], color: '#e4e6e2', long: true },
  // アルミの箱のトラック（運転台は車ごとの色）
  truck: { L: 7.0, W: 2.2, body: [0.45, 1.4], cabin: [1.4, 2.42], cabinBottom: [-3.4, -1.7], cabinTop: [-3.3, -1.7], long: true },
};
const TYPE_WEIGHTS = [['sedan', 4], ['kei', 3], ['minivan', 2], ['taxi', 2]];
// 広い道（幹線道路）で出てきた車は、路線バスとトラックにもなる
const WIDE_ROAD_W = 9;
const WIDE_TYPE_WEIGHTS = [...TYPE_WEIGHTS, ['bus', 1.5], ['truck', 1.5]];

const looks = new WeakMap(); // 車 → 見た目

export function carLook(a) {
  let look = looks.get(a);
  if (!look) {
    const weights = (a.spawnW ?? 0) >= WIDE_ROAD_W ? WIDE_TYPE_WEIGHTS : TYPE_WEIGHTS;
    const total = weights.reduce((s, [, w]) => s + w, 0);
    // 速さの細かい桁から決まる 0〜1 の値（速さは乱数で決まっているので、車ごとにばらばら）
    const v = Math.sin((a.speed ?? 0) * 12345.678) * 43758.5453;
    let r = (v - Math.floor(v)) * total;
    const [type] = weights.find(([, w]) => (r -= w) < 0) ?? weights[0];
    const t = CAR_TYPES[type];
    look = { type, ...t, color: t.color ?? a.color };
    looks.set(a, look);
  }
  return look;
}
