// 自転車の動き。単位はメートルと秒。
// 向き angle は 0 が画面の上方向（北）、時計回りが正。

export const PLAYER_CONFIG = {
  maxSpeed: 12, // m/s（約43km/h。ゲームなので少し速め）
  maxReverse: 2, // 後退の最高速度 m/s
  accel: 5, // 加速 m/s²
  brake: 12, // ブレーキ m/s²
  drag: 1.5, // ペダルを離したときの減速 m/s²
  turnRate: 2.3, // 最大旋回速度 rad/s
  steerIn: 1.6, // ハンドルを切る速さ（1 秒あたり。約 0.6 秒でいっぱいまで切れる）
  steerOut: 3, // ハンドルを離したときに戻る速さ
  highSpeedTurn: 0.65, // 最高速度のときの旋回の強さ（速いほど大回りになる）
  length: 1.8, // 車体の長さ m
  width: 0.6, // 車体の幅 m
};

export function createPlayer(x = 0, y = 0, angle = 0) {
  return { x, y, angle, speed: 0, steer: 0 };
}

// limit: 路面による速度上限 m/s（歩道や道路外では遅くなる）
export function updatePlayer(p, input, dt, limit = PLAYER_CONFIG.maxSpeed, cfg = PLAYER_CONFIG) {
  // 前後の加減速
  if (input.up) {
    p.speed += (p.speed < 0 ? cfg.brake : cfg.accel) * dt;
  } else if (input.down) {
    p.speed -= (p.speed > 0 ? cfg.brake : cfg.accel) * dt;
  } else {
    const d = cfg.drag * dt;
    p.speed = Math.abs(p.speed) <= d ? 0 : p.speed - Math.sign(p.speed) * d;
  }
  const max = Math.min(cfg.maxSpeed, limit);
  // 上限を超えていたら急にではなくブレーキ相当で落とす
  if (p.speed > max) p.speed = Math.max(max, p.speed - cfg.brake * dt);
  p.speed = Math.max(-cfg.maxReverse, Math.min(cfg.maxSpeed, p.speed));

  // ハンドルはキーを押すと少しずつ切れ、離すと少しずつ戻る（急に曲がらないように）
  const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steer = p.steer ?? 0;
  const rate = want !== 0 && Math.sign(want) !== -Math.sign(steer) ? cfg.steerIn : cfg.steerOut;
  p.steer = want > steer ? Math.min(want, steer + rate * dt) : Math.max(want, steer - rate * dt);

  // 旋回は動いているときだけ。ごく低速では曲がりにくく、速いほど大回りになる。後退時はハンドルが逆になる。
  const fast = Math.max(0, Math.min(1, (Math.abs(p.speed) - 3) / (PLAYER_CONFIG.maxSpeed - 3)));
  const grip = Math.min(1, Math.abs(p.speed) / 3) * (1 - (1 - cfg.highSpeedTurn) * fast);
  p.angle += p.steer * cfg.turnRate * grip * Math.sign(p.speed) * dt;

  p.x += Math.sin(p.angle) * p.speed * dt;
  p.y -= Math.cos(p.angle) * p.speed * dt;
}

// 実寸だと地図上で小さすぎるので、見た目だけ DRAW_SCALE 倍で描く（当たり判定は中心点のみ）
const DRAW_SCALE = 3.2;

// body：ジャージとフレームの色、nose：ヘルメットの色、tire：タイヤとハンドルの色
// halo：足もとに光る輪を描く（暗い地図や信号の印の中でも自分の位置がすぐ分かるように。ゴーストには付けない）
// basket：前かご（ママチャリ・電動アシスト自転車）
export const PLAYER_STYLE = { body: '#ffcc33', nose: '#e8443a', tire: '#15171b', alpha: 1, halo: true, basket: false };
const HALO_R = 4.2; // 光る輪の半径 m
export const GHOST_STYLE = { body: '#e8ecf4', nose: '#c9ced8', tire: '#9aa0aa', alpha: 0.6 }; // ゴースト（ベストの走り）

// 自転車を真上から見た形で描く：前後の車輪・フレーム・ハンドル、乗っている人（肩・ハンドルを握る腕・ヘルメット）。前が -y
export function drawPlayer(ctx, p, style = PLAYER_STYLE) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.translate(p.x, p.y);
  if (style.halo) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, HALO_R);
    glow.addColorStop(0, 'rgba(255, 204, 51, 0.38)');
    glow.addColorStop(0.7, 'rgba(255, 204, 51, 0.14)');
    glow.addColorStop(1, 'rgba(255, 204, 51, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, HALO_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; // 輪は白（黄色だと黄信号の丸と紛れる）
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, HALO_R * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(p.angle);
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  ctx.lineCap = 'round';
  // 縁取り（暗い地図の上でも形が分かるように）
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.6)';
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.moveTo(0, -0.86);
  ctx.lineTo(0, 0.86);
  ctx.stroke();
  // 車輪（前後）
  ctx.strokeStyle = style.tire;
  ctx.lineWidth = 0.08;
  for (const y of [-0.53, 0.52]) {
    ctx.beginPath();
    ctx.moveTo(0, y - 0.33);
    ctx.lineTo(0, y + 0.33);
    ctx.stroke();
  }
  // 前かご
  if (style.basket) {
    ctx.strokeStyle = '#c8ccd4';
    ctx.lineWidth = 0.04;
    ctx.strokeRect(-0.18, -0.78, 0.36, 0.28);
  }
  // フレーム
  ctx.strokeStyle = style.body;
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(0, -0.42);
  ctx.lineTo(0, 0.5);
  ctx.stroke();
  // ハンドル
  ctx.strokeStyle = style.tire;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-0.26, -0.36);
  ctx.lineTo(0.26, -0.36);
  ctx.stroke();
  // 腕（肩からハンドルへ）
  ctx.strokeStyle = style.body;
  ctx.lineWidth = 0.07;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 0.17, -0.06);
    ctx.lineTo(side * 0.24, -0.34);
    ctx.stroke();
  }
  // 背中と肩
  ctx.fillStyle = style.body;
  ctx.beginPath();
  ctx.ellipse(0, 0.08, 0.17, 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -0.04, 0.21, 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  // ヘルメット（前に少し長い）
  ctx.fillStyle = style.nose;
  ctx.beginPath();
  ctx.ellipse(0, -0.17, 0.1, 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
