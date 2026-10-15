// 歩行者の見た目（2D版・3D版で共通）。服・髪・肌の色と背の高さを一人ずつ決め、歩いた距離から足の振りを求める。
// 見た目だけなので、ゲームの乱数（obstacles.js の rng。車や歩行者の動きを再現できるようにしている）は使わない。

const SKINS = ['#f1d3b3', '#e8c39e', '#d9a87e', '#c18a63', '#8d5b3e'];
const SHIRTS = ['#e8eaef', '#2f3a4f', '#c94f4f', '#4f7fc9', '#e0b84a', '#5aa36b', '#8e6cc4', '#d9824a', '#3c3f46', '#b8c2cc'];
const PANTS = ['#2a2f3a', '#3b4a63', '#1f2228', '#5a5148', '#6b7280', '#33415c'];
const HAIRS = ['#1b1714', '#2e2620', '#4a3527', '#6b5a4a', '#9a9a9a'];
const UMBRELLAS = ['#2f3a4f', '#c94f4f', '#e8eaef', '#4f7fc9', '#1f2228', '#5aa36b', '#e0b84a'];

const STRIDE_M = 0.75; // 1 歩の長さ m（足の振りの 1 往復で 2 歩）

// 歩行者の種類（見た目だけ）：ふつう・スーツの会社員（かばん・ネクタイ）・制服の学生（背中のかばん）・
// 旅行者（スーツケース）・犬の散歩。[種類, 割合]
const ROLES = [['casual', 45], ['suit', 22], ['student', 13], ['tourist', 10], ['dog', 10]];
const SUITS = ['#252b38', '#2f3542', '#3a3f46', '#1f2430'];
const UNIFORMS = ['#1f2a44', '#2a2f3a'];

const looks = new WeakMap(); // 歩行者 → 見た目
const strides = new WeakMap(); // 歩行者 → { phase, x, y }

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// 歩行者 a の見た目（初めて見たときに決めて覚えておく）
export function pedLook(a) {
  let look = looks.get(a);
  if (!look) {
    let r = Math.random() * ROLES.reduce((s, [, w]) => s + w, 0);
    const [role] = ROLES.find(([, w]) => (r -= w) < 0) ?? ROLES[0];
    look = {
      role,
      skin: pick(SKINS),
      shirt: pick(SHIRTS),
      pants: pick(PANTS),
      hair: pick(HAIRS),
      umbrella: pick(UMBRELLAS),
      scale: 0.9 + Math.random() * 0.18, // 背の高さ（1.0 で約 1.65m）
    };
    // スーツは上下そろいの暗い色、学生は紺の制服（学生は少し小さく）
    if (role === 'suit') look.shirt = look.pants = pick(SUITS);
    if (role === 'student') (look.shirt = pick(UNIFORMS)), (look.pants = '#2a2f3a'), (look.scale *= 0.94);
    looks.set(a, look);
  }
  return look;
}

// 足の振り：-1〜1（sin）。止まっていれば 0 に戻る。歩いた距離で進める
export function pedSwing(a) {
  let st = strides.get(a);
  if (!st) {
    st = { phase: Math.random() * Math.PI * 2, x: a.x, y: a.y, amp: 0 };
    strides.set(a, st);
  }
  const d = Math.hypot(a.x - st.x, a.y - st.y);
  st.x = a.x;
  st.y = a.y;
  // 1 往復（2 歩）で 2π。瞬間移動（区間の切り替えなど）は数えない
  if (d < 2) st.phase += (d / (STRIDE_M * 2)) * Math.PI * 2;
  // 振りの大きさ：歩いていれば 1、止まったら少しずつ 0 に
  st.amp = d > 0.001 ? Math.min(1, st.amp + 0.2) : Math.max(0, st.amp - 0.1);
  return Math.sin(st.phase) * st.amp;
}
