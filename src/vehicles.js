// 車の見た目（2D版・3D版で共通）：車種と大きさ。車体の色は obstacles.js が決めた色（a.color）を使い、
// 車種は見た目だけなのでゲームの乱数を使わずに決める（車や歩行者の動きは変わらない）。
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
};
const TYPE_WEIGHTS = [['sedan', 4], ['kei', 3], ['minivan', 2], ['taxi', 2]];

const looks = new WeakMap(); // 車 → 見た目

export function carLook(a) {
  let look = looks.get(a);
  if (!look) {
    const total = TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    const [type] = TYPE_WEIGHTS.find(([, w]) => (r -= w) < 0) ?? TYPE_WEIGHTS[0];
    const t = CAR_TYPES[type];
    look = { type, ...t, color: t.color ?? a.color };
    looks.set(a, look);
  }
  return look;
}
