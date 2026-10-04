import { drawAreas, drawLines } from './map.js';
import { pointAt, frontDistance } from './trainpath.js';
import { trainProgress } from './train.js';

// ミニマップ：画面右上に、自転車の周り WINDOW_M 四方を北が上で縮小表示する。
// 区間全体の道路を最初に 1 枚の画像に描いておき、毎フレームはその一部を切り出して貼るだけにする。

const WINDOW_M = 700; // ミニマップに映す範囲（一辺）m
export const IMAGE_SCALE = 0.6; // 下描き画像の解像度 px/m（表示は約 0.2 px/m なので十分）
const TOP = 92; // レースバー（高さ 84px）の下

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link']);

// 画面上のミニマップの位置と大きさ（CSS px）。hud.js が他の表示を避けるのにも使う
export function minimapRect(view) {
  const size = Math.round(Math.min(160, view.w * 0.32, view.h * 0.3));
  return { x: view.w - size - 10, y: TOP, size };
}

// 区間全体の道路を描いた画像（地図ごとに一度だけ作る。結果画面のルート比較でも使う）
export function minimapImage(map) {
  if (map.minimap) return map.minimap;
  const { minX, minY, maxX, maxY } = map.bounds;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX) * IMAGE_SCALE);
  canvas.height = Math.ceil((maxY - minY) * IMAGE_SCALE);
  const c = canvas.getContext('2d');
  c.fillStyle = '#1f2228';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.setTransform(IMAGE_SCALE, 0, 0, IMAGE_SCALE, -minX * IMAGE_SCALE, -minY * IMAGE_SCALE);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // 公園・水域・線路を道路の下に（縮小しても見えるよう線は太めに）
  drawAreas(c, map.areas);
  drawLines(c, map.lines, true, 1.5);
  drawLines(c, map.lines, false, 2.5);
  // 細い道から順に描き、大通りが上に来るようにする（線の太さは縮小後に見える太さで決めた m）
  const layers = [
    { pick: (r) => r.path, color: '#353a43', width: 6 },
    { pick: (r) => !r.path && !MAJOR.has(r.t) && r.t !== 'tertiary', color: '#5a606b', width: 9 },
    { pick: (r) => r.t === 'tertiary', color: '#767c88', width: 14 },
    { pick: (r) => MAJOR.has(r.t), color: '#a3a9b5', width: 20 },
  ];
  for (const layer of layers) {
    c.strokeStyle = layer.color;
    c.lineWidth = layer.width;
    c.beginPath();
    for (const r of map.roads) {
      if (!layer.pick(r)) continue;
      c.moveTo(r.p[0], r.p[1]);
      for (let k = 2; k < r.p.length; k += 2) c.lineTo(r.p[k], r.p[k + 1]);
    }
    c.stroke();
  }
  map.minimap = canvas;
  return canvas;
}

export function drawMinimap(ctx, game, view) {
  const map = game.map;
  const img = minimapImage(map);
  const { x, y, size } = minimapRect(view);
  const k = size / WINDOW_M; // CSS px / m
  const { minX, minY, maxX, maxY } = map.bounds;
  const p = game.player;
  // 映す範囲の中心。地図の端では範囲が外にはみ出さないよう寄せる
  const half = WINDOW_M / 2;
  const cx = Math.max(minX + half, Math.min(maxX - half, p.x));
  const cy = Math.max(minY + half, Math.min(maxY - half, p.y));
  const toScreen = (wx, wy) => [x + size / 2 + (wx - cx) * k, y + size / 2 + (wy - cy) * k];

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 8);
  ctx.fillStyle = '#1f2228';
  ctx.fill();
  ctx.clip();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(
    img,
    (cx - half - minX) * IMAGE_SCALE,
    (cy - half - minY) * IMAGE_SCALE,
    WINDOW_M * IMAGE_SCALE,
    WINDOW_M * IMAGE_SCALE,
    x,
    y,
    size,
    size,
  );
  ctx.globalAlpha = 1;

  // ゴール：範囲内なら緑の円、範囲外なら枠の内側に方向の矢印
  const [gx, gy] = toScreen(map.goal.x, map.goal.y);
  const inside = gx >= x && gx <= x + size && gy >= y && gy <= y + size;
  ctx.fillStyle = '#50c878';
  if (inside) {
    ctx.beginPath();
    ctx.arc(gx, gy, Math.max(4, map.goal.radius * k), 0, Math.PI * 2);
    ctx.fill();
  } else {
    const [px, py] = toScreen(p.x, p.y);
    const a = Math.atan2(gy - py, gx - px);
    const r = size / 2 - 9;
    ctx.save();
    ctx.translate(x + size / 2 + Math.cos(a) * r, y + size / 2 + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ライバルの電車：先頭の位置に銀色・黄緑のふちの四角（範囲外なら出さない）
  if (map.trainRoute) {
    const t = pointAt(map.trainRoute, frontDistance(map.trainRoute, trainProgress(game.train, game.time)));
    const [tx, ty] = toScreen(t.x, t.y);
    if (tx >= x && tx <= x + size && ty >= y && ty <= y + size) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(t.angle);
      ctx.fillStyle = '#e8ebef';
      ctx.strokeStyle = '#8cc63f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-3, -7, 6, 14, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ゴースト
  if (game.ghostPose) {
    const [hx, hy] = toScreen(game.ghostPose.x, game.ghostPose.y);
    ctx.fillStyle = 'rgba(232, 236, 244, 0.8)';
    ctx.beginPath();
    ctx.arc(hx, hy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 自転車：進行方向を向いた三角
  const [px, py] = toScreen(p.x, p.y);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#ffcc33';
  ctx.strokeStyle = '#1b1d22';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // 枠と方角
  ctx.strokeStyle = '#5a606b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 8);
  ctx.stroke();
  ctx.fillStyle = '#9aa0aa';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('N', x + 6, y + 14);
}
