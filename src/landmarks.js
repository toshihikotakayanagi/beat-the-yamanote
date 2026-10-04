// ランドマーク（駅・名所・百貨店・高層ビル・公園・神社や寺）の名前を地図の上に出す。
// データは fetch-osm.mjs が重要度の高い順に並べてある。画面上で文字が重なるときは、後ろ（重要度の低い方）を出さない。

const KIND_STYLE = {
  station: { color: '#9acd32', shape: 'square', size: 13, weight: 'bold' },
  sight: { color: '#ffb347', shape: 'diamond', size: 12, weight: 'bold' },
  shop: { color: '#ff7eb6', shape: 'diamond', size: 12, weight: 'normal' },
  building: { color: '#7ec8ff', shape: 'diamond', size: 12, weight: 'normal' },
  park: { color: '#5fd38d', shape: 'circle', size: 12, weight: 'normal' },
  worship: { color: '#d9a066', shape: 'circle', size: 12, weight: 'normal' },
};
const FONT = 'system-ui, sans-serif';

function drawIcon(ctx, x, y, style) {
  ctx.fillStyle = style.color;
  ctx.strokeStyle = 'rgba(15, 16, 20, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (style.shape === 'square') ctx.rect(x - 5, y - 5, 10, 10);
  else if (style.shape === 'circle') ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  else {
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// 3D版：view.landmarks3d（render3d.js が求めた画面上の位置。重要度の高い順）に名前を出す。
// 近いほど濃く、重なるときは重要度の低い方を出さない
export function drawLandmarks3D(ctx, game, view, avoid = []) {
  const placed = [...avoid];
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const top = 100; // レースバーの下（遠くの名前がバーに隠れるときは、バーのすぐ下に出す）
  for (const { lm, x, y: rawY, dist } of view.landmarks3d) {
    if (rawY < -40) continue;
    const y = Math.max(top, rawY);
    const style = KIND_STYLE[lm.k] ?? KIND_STYLE.sight;
    const size = style.size + (dist < 120 ? 1 : 0);
    ctx.font = `${style.weight} ${size}px ${FONT}`;
    const w = ctx.measureText(lm.n).width;
    const box = { x0: x - w / 2 - 4, y0: y - size - 14, x1: x + w / 2 + 4, y1: y + 6 };
    if (box.x0 < 2 || box.x1 > view.w - 2 || placed.some((b) => overlaps(b, box))) continue;
    placed.push(box);
    ctx.globalAlpha = Math.max(0.45, Math.min(1, 1.25 - dist / 380));
    drawIcon(ctx, x, y, style);
    const tx = x - w / 2, ty = y - 10;
    ctx.strokeStyle = 'rgba(15, 16, 20, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(lm.n, tx, ty);
    ctx.fillStyle = '#f2f4f8';
    ctx.fillText(lm.n, tx, ty);
    ctx.globalAlpha = 1;
  }
}

// avoid：文字を置かない画面上の四角（レースバー、ミニマップなど）。CSS px
export function drawLandmarks(ctx, game, view, avoid = []) {
  const list = game.map.landmarks;
  if (!list?.length) return;
  const p = game.player;
  const placed = [...avoid];
  // 自転車の真上には出さない
  placed.push({ x0: view.w / 2 - 16, y0: view.h / 2 - 16, x1: view.w / 2 + 16, y1: view.h / 2 + 16 });

  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  for (const lm of list) {
    const sx = view.w / 2 + (lm.x - p.x) * view.ppm;
    const sy = view.h / 2 + (lm.y - p.y) * view.ppm;
    if (sx < -40 || sx > view.w + 40 || sy < -20 || sy > view.h + 20) continue;
    const style = KIND_STYLE[lm.k] ?? KIND_STYLE.sight;
    ctx.font = `${style.weight} ${style.size}px ${FONT}`;
    const w = ctx.measureText(lm.n).width;
    const icon = { x0: sx - 7, y0: sy - 7, x1: sx + 7, y1: sy + 7 };
    if (placed.some((b) => overlaps(b, icon))) continue;
    // 名前は印の右に。ふさがっていたら左に置く
    const y0 = sy - style.size / 2 - 3, y1 = sy + style.size / 2 + 3;
    const right = { x0: sx - 7, y0, x1: sx + 10 + w + 2, y1 };
    const left = { x0: sx - 10 - w - 2, y0, x1: sx + 7, y1 };
    // 名前が画面からはみ出す置き方はしない（途中で切れるため）。印は端に少しかかってもよい
    const free = (b) => !placed.some((p2) => overlaps(p2, b));
    const box = [right, left].find((b) => (b === right ? sx >= 4 && b.x1 <= view.w - 2 : sx <= view.w - 4 && b.x0 >= 2) && free(b));
    if (!box) continue;
    placed.push(box);

    drawIcon(ctx, sx, sy, style);
    const tx = box === right ? sx + 10 : sx - 10 - w, ty = sy + style.size * 0.36;
    ctx.strokeStyle = 'rgba(15, 16, 20, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(lm.n, tx, ty);
    ctx.fillStyle = '#f2f4f8';
    ctx.fillText(lm.n, tx, ty);
  }
}
