// 自転車の動き。単位はメートルと秒。
// 向き angle は 0 が画面の上方向（北）、時計回りが正。

export const PLAYER_CONFIG = {
  maxSpeed: 12, // m/s（約43km/h。ゲームなので少し速め）
  maxReverse: 2, // 後退の最高速度 m/s
  accel: 5, // 加速 m/s²
  brake: 12, // ブレーキ m/s²
  drag: 1.5, // ペダルを離したときの減速 m/s²
  turnRate: 2.6, // 最大旋回速度 rad/s
  length: 1.8, // 車体の長さ m
  width: 0.6, // 車体の幅 m
};

export function createPlayer(x = 0, y = 0, angle = 0) {
  return { x, y, angle, speed: 0 };
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

  // 旋回は動いているときだけ。低速ほど曲がりにくく、後退時はハンドルが逆になる。
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const grip = Math.min(1, Math.abs(p.speed) / 3);
  p.angle += steer * cfg.turnRate * grip * Math.sign(p.speed) * dt;

  p.x += Math.sin(p.angle) * p.speed * dt;
  p.y -= Math.cos(p.angle) * p.speed * dt;
}

// 実寸だと地図上で小さすぎるので、見た目だけ DRAW_SCALE 倍で描く（当たり判定は中心点のみ）
const DRAW_SCALE = 1.6;

const PLAYER_STYLE = { body: '#ffcc33', nose: '#e8443a', alpha: 1 };
export const GHOST_STYLE = { body: '#e8ecf4', nose: '#9aa0aa', alpha: 0.6 }; // ゴースト（ベストの走り）

export function drawPlayer(ctx, p, style = PLAYER_STYLE, cfg = PLAYER_CONFIG) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  // 車体
  ctx.fillStyle = style.body;
  ctx.fillRect(-cfg.width / 2, -cfg.length / 2, cfg.width, cfg.length);
  // 前輪側の目印
  ctx.fillStyle = style.nose;
  ctx.fillRect(-cfg.width / 2, -cfg.length / 2, cfg.width, cfg.length * 0.25);
  ctx.restore();
}
