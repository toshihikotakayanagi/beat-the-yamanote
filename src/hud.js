// 画面上の表示（電車との進み具合、速度、案内、各画面のオーバーレイ）。
// 座標はすべて CSS ピクセル。
import { trainProgress, timeLeft, DIFFICULTIES } from './train.js';
import { drawMinimap, minimapRect, minimapImage, IMAGE_SCALE } from './minimap.js';
import { fastestRoute } from './route.js';
import { drawLandmarks, drawLandmarks3D } from './landmarks.js';
import { bikeTypeOf, outfitOf, helmetOf } from './outfits.js';
import { PLAYER_CONFIG } from './player.js';

const YAMANOTE_GREEN = '#9acd32';
const PLAYER_YELLOW = '#ffcc33';
const GOAL_GREEN = '#50c878';
const TEXT = '#ffffff';
const QUIET = '#9aa0aa';
const FONT = 'system-ui, sans-serif';

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// maxWidth を超える文字列は、はみ出さないよう文字を小さくする
function text(ctx, str, x, y, { size = 16, color = TEXT, align = 'left', weight = 'normal', maxWidth = Infinity } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  const width = ctx.measureText(str).width;
  if (width > maxWidth) ctx.font = `${weight} ${Math.floor((size * maxWidth) / width)}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

// ゴールが画面外にあるとき、画面の端に方向の矢印を出す
function drawGoalPointer(ctx, game, view) {
  const p = game.player;
  const g = game.map.goal;
  const dx = g.x - p.x, dy = g.y - p.y;
  const sx = dx * view.ppm, sy = dy * view.ppm;
  const top = 96; // 上部の進み具合バーと重ならないように
  if (Math.abs(sx) < view.w / 2 - 20 && Math.abs(sy) < view.h / 2 - 20) return;

  const k = Math.min((view.w / 2 - 36) / Math.abs(sx || 1e-9), (view.h / 2 - 36) / Math.abs(sy || 1e-9));
  const ax = view.w / 2 + sx * k;
  const ay = Math.max(top, view.h / 2 + sy * k);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = GOAL_GREEN;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, -9);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 3D版：ゴールが画面に見えていれば光の柱の上に距離を、見えなければ画面の端に方向の矢印を出す。
// view.goal3d はゴールの画面上の位置（render3d.js が毎回求める。behind：カメラの後ろ）
function drawGoalPointer3D(ctx, game, view) {
  const g = view.goal3d;
  const top = 96, bottom = view.h - (game.touch ? 120 : 24), margin = 36;
  const onScreen = !g.behind && g.x > margin && g.x < view.w - margin && g.y > top && g.y < bottom;
  const dist = `${Math.round(game.distance)} m`;
  ctx.fillStyle = GOAL_GREEN;
  if (onScreen) {
    // 下向きの三角と、ゴールまでの距離
    const y = Math.max(top + 20, g.y - 26);
    ctx.beginPath();
    ctx.moveTo(g.x, y + 10);
    ctx.lineTo(g.x - 9, y - 4);
    ctx.lineTo(g.x + 9, y - 4);
    ctx.closePath();
    ctx.fill();
    text(ctx, `ゴール ${dist}`, g.x, y - 10, { size: 13, weight: 'bold', color: GOAL_GREEN, align: 'center' });
    return;
  }
  // 画面の中心からゴールの方向へ、画面の端（上下はバーと操作ボタンを避ける）まで伸ばした所に矢印
  const cx = view.w / 2, cy = (top + bottom) / 2;
  let dx = g.x - cx, dy = g.y - cy;
  if (g.behind && dy < 0) dy = -dy; // 真後ろのときは下向き（振り返る方向）に出す
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const k = Math.min((view.w / 2 - margin) / Math.abs(dx || 1e-9), ((bottom - top) / 2 - 10) / Math.abs(dy || 1e-9));
  const ax = cx + dx * k, ay = cy + dy * k;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-9, -11);
  ctx.lineTo(-9, 11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  text(ctx, dist, ax - dx * 26, ay - dy * 26 + 5, { size: 12, weight: 'bold', color: GOAL_GREEN, align: 'center' });
}

// ---- 時間帯と天気 ----
export const TIME_NAMES = { day: '昼', evening: '夕方', night: '夜' };
export const WEATHER_NAMES = { clear: '晴れ', rain: '雨', snow: '雪' };

// 2D版：時間帯で地図に色を重ねる（夕方が今までの見た目）
const TIME_TINT = { day: 'rgba(210, 225, 245, 0.10)', evening: null, night: 'rgba(5, 10, 35, 0.45)' };

// 雨・雪の粒を画面に描く（2D版・3D版とも）。粒の位置は番号と時刻から決まる（覚えておく必要がない）
const RAIN_DROPS = 260, SNOW_FLAKES = 170;
function drawWeather(ctx, game, view) {
  const t = performance.now() / 1000;
  const hash = (i, k) => {
    const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  if (game.weather === 'rain') {
    ctx.strokeStyle = 'rgba(190, 205, 230, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < RAIN_DROPS; i++) {
      const speed = 900 + hash(i, 1) * 500; // px/秒
      const x = (hash(i, 2) * (view.w + 200) + t * speed * 0.18) % (view.w + 200) - 100;
      const y = (hash(i, 3) * view.h + t * speed) % (view.h + 40) - 20;
      const len = 10 + hash(i, 4) * 12;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.18, y - len);
    }
    ctx.stroke();
  } else if (game.weather === 'snow') {
    ctx.fillStyle = 'rgba(245, 248, 255, 0.8)';
    ctx.beginPath();
    for (let i = 0; i < SNOW_FLAKES; i++) {
      const speed = 40 + hash(i, 1) * 50;
      const sway = Math.sin(t * (0.6 + hash(i, 5)) + i) * 18;
      const x = (hash(i, 2) * view.w + sway + view.w) % view.w;
      const y = (hash(i, 3) * view.h + t * speed) % (view.h + 10) - 5;
      const r = 1 + hash(i, 4) * 1.8;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

// 画面上部：駅から駅への線の上に、電車（上）と自転車（下）の進み具合を出す
function drawRaceBar(ctx, game, view) {
  const x0 = 56, x1 = view.w - 56, y = 52;
  const trainP = trainProgress(game.train, game.time);
  const playerP = 1 - Math.min(1, game.distance / game.startDistance);

  ctx.fillStyle = 'rgba(20, 22, 26, 0.75)';
  ctx.fillRect(0, 0, view.w, 84);

  ctx.strokeStyle = '#5a606b';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();

  text(ctx, game.map.from, x0 - 10, y + 5, { size: 14, weight: 'bold', align: 'right' });
  text(ctx, game.map.to, x1 + 10, y + 5, { size: 14, weight: 'bold' });

  const tx = x0 + (x1 - x0) * trainP;
  ctx.fillStyle = YAMANOTE_GREEN;
  ctx.fillRect(tx - 14, y - 16, 28, 10);
  // ゴースト（自転車と同じ段に、半透明の白で。自転車が上に重なる）
  if (game.ghostPose) {
    const g = game.map.goal;
    const ghostP = 1 - Math.min(1, Math.hypot(g.x - game.ghostPose.x, g.y - game.ghostPose.y) / game.startDistance);
    ctx.fillStyle = 'rgba(232, 236, 244, 0.55)';
    ctx.beginPath();
    ctx.arc(x0 + (x1 - x0) * ghostP, y + 12, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const px = x0 + (x1 - x0) * playerP;
  ctx.fillStyle = PLAYER_YELLOW;
  ctx.beginPath();
  ctx.arc(px, y + 12, 6, 0, Math.PI * 2);
  ctx.fill();

  const left = timeLeft(game.train, game.time);
  const label = `電車到着まで ${formatTime(left)}`;
  // ふつうは中央。狭い画面では右上のボタン（game.cornerLeft より右）に重ならないよう左へずらす
  ctx.font = `bold 20px ${FONT}`;
  const half = ctx.measureText(label).width / 2;
  const cx = Math.max(12 + half, Math.min(view.w / 2, (game.cornerLeft ?? view.w) - 10 - half));
  text(ctx, label, cx, 27, {
    size: 20,
    weight: 'bold',
    color: left < 15 ? '#ff6b5e' : TEXT,
    align: 'center',
  });
}

// 左上（レースバーの下）の板：速度を大きく、その下にゴールまでの残りと、今いる道の名前
const STATUS = { x: 10, y: 92, w: 146, h: 88 };
// 風の線：速さが最高の 6 割を超えると、画面の外側から真ん中へ向かう白い線を出す（速いほど多く濃く）
function drawSpeedLines(ctx, game, view) {
  const k = Math.max(0, Math.min(1, (game.player.speed / PLAYER_CONFIG.maxSpeed - 0.6) / 0.4));
  if (k <= 0) return;
  const cx = view.w / 2, cy = view.h * 0.45, R = Math.hypot(view.w, view.h) / 2;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.lineCap = 'round';
  const n = Math.round(10 + 22 * k);
  for (let i = 0; i < n; i++) {
    // 線ごとに決まった向きと、時間で流れる位置（同じ所にちらつかないよう、少しずつずらす）
    const v = Math.sin(i * 91.3) * 43758.5453;
    const a = (v - Math.floor(v)) * Math.PI * 2;
    const u = (t * (1.6 + (i % 5) * 0.25) + i * 0.37) % 1;
    const r0 = R * (0.62 + 0.38 * (1 - u)), r1 = r0 + R * (0.08 + 0.12 * k);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.08 + 0.22 * k) * Math.sin(u * Math.PI)})`;
    ctx.lineWidth = 1.5 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStatus(ctx, game) {
  const { x, y, w, h } = STATUS;
  const kmh = Math.abs(game.player.speed) * 3.6;
  const kind = game.surface.kind;
  const where = game.surface.road?.n ?? { road: '道路', path: '歩道', ground: '道路外' }[kind];
  ctx.fillStyle = 'rgba(20, 22, 26, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  const num = kmh.toFixed(0);
  ctx.font = `bold 34px ${FONT}`;
  const nw = ctx.measureText(num).width;
  text(ctx, num, x + 12, y + 38, { size: 34, weight: 'bold' });
  text(ctx, 'km/h', x + 16 + nw, y + 38, { size: 13, color: QUIET });
  text(ctx, `残り ${game.distance.toFixed(0)} m`, x + 12, y + 60, { size: 15, weight: 'bold', color: PLAYER_YELLOW, maxWidth: w - 20 });
  // 歩道・道路外は遅いので色で知らせる
  text(ctx, where, x + 12, y + 79, { size: 12, color: kind === 'road' ? QUIET : '#ffc93c', maxWidth: w - 20 });
}

// ペナルティや逆走の知らせ（画面の上寄り中央）
function drawAlerts(ctx, game, view) {
  const mm = minimapRect(view);
  const y = Math.max(150, view.h * 0.28, mm.y + mm.size + 30); // ミニマップより下に出す
  const maxWidth = view.w - 24;
  if (game.message) {
    const color = game.message.info ? TEXT : '#ff6b5e'; // info：お知らせ（視点の切り替えなど）は白
    text(ctx, game.message.text, view.w / 2, y, { size: game.message.info ? 20 : 26, weight: 'bold', color, align: 'center', maxWidth });
    if (game.stopped > 0) {
      text(ctx, `${game.stopped.toFixed(1)} 秒`, view.w / 2, y + 30, { size: 16, color: TEXT, align: 'center' });
    }
  } else if (game.wrongWay) {
    text(ctx, '逆走中！ 一方通行です', view.w / 2, y, { size: 22, weight: 'bold', color: '#ffc93c', align: 'center', maxWidth });
  }
}

// 区間選択の環状マップ：区間の出発駅を、角の丸い四角（超楕円）の上に路線の順に並べる。
// 区間は隣の駅との弧で、最後の区間の到着駅は最初の区間の出発駅（山手線は環状）とみなす。
// 駅の方角は実際の位置（路線全体の中心から見た向き。縦長の路線を縦横同じ大きさに均す）と、
// 等間隔の半々。実際の位置だけだと品川・高輪ゲートウェイなどが重なるため
const LOOP_POWER = 3; // 超楕円の指数（2 で楕円、大きいほど四角に近い）
const LOOP_COLORS = { cleared: YAMANOTE_GREEN, open: '#ffc93c', locked: '#3d424c' };
const loopAngleCache = new WeakMap();

function loopAngles(sections) {
  if (loopAngleCache.has(sections)) return loopAngleCache.get(sections);
  const st = sections.map((s) => s.fromStation);
  const lat0 = st.reduce((sum, p) => sum + p.lat, 0) / st.length;
  const xs = st.map((p) => p.lon * Math.cos((lat0 * Math.PI) / 180));
  const ys = st.map((p) => -p.lat); // 画面は下向きが正
  const mid = (v) => (Math.min(...v) + Math.max(...v)) / 2;
  const size = (v) => Math.max(...v) - Math.min(...v) || 1;
  const mx = mid(xs), my = mid(ys), w = size(xs), h = size(ys);
  // 路線の順に角度をつなげる（隣の駅との差を -π〜π にして足していく）
  const real = [];
  st.forEach((_, i) => {
    const t = Math.atan2((ys[i] - my) / h, (xs[i] - mx) / w);
    if (i === 0) return real.push(t);
    const d = t - real[i - 1];
    real.push(real[i - 1] + d - 2 * Math.PI * Math.round(d / (2 * Math.PI)));
  });
  const dir = Math.sign(real.at(-1) - real[0]) || 1; // 回る向き（山手線のデータでは時計回り）
  const angles = real.map((t, i) => (t + real[0] + (dir * 2 * Math.PI * i) / st.length) / 2);
  angles.push(angles[0] + dir * 2 * Math.PI); // 最後の区間の到着駅＝最初の駅
  loopAngleCache.set(sections, angles);
  return angles;
}

function loopPoint(cx, cy, a, b, t) {
  const c = Math.cos(t), s = Math.sin(t);
  const r = (Math.abs(c / a) ** LOOP_POWER + Math.abs(s / b) ** LOOP_POWER) ** (-1 / LOOP_POWER);
  return { x: cx + r * c, y: cy + r * s, c, s };
}

function loopSectionState(game, i) {
  if (game.cleared.has(game.sections[i].id)) return 'cleared';
  return game.isUnlocked(i) ? 'open' : 'locked';
}

// 選んでいる区間の注記（ベスト・クリア状況・解放の条件）と色
function sectionNote(game, i) {
  const best = game.bests[game.sections[i].id];
  if (!game.isUnlocked(i)) {
    // 未解放の区間のうち、前の区間に勝てばすぐ遊べるものはそう書く
    return game.isUnlocked(i - 1) ? ['前の区間に勝つと解放', '#c9a845'] : ['未解放', '#7a808b'];
  }
  if (best != null) return [`ベスト ${formatTime(best)}`, PLAYER_YELLOW];
  return [game.cleared.has(game.sections[i].id) ? 'クリア済み' : '未クリア', QUIET];
}

// 環状マップを (x, y, w, h) の枠に描き、区間を選ぶタップの判定を game.hits に登録する
function drawLoopMap(ctx, game, x, y, w, h, k) {
  const sections = game.sections;
  const n = sections.length;
  const angles = loopAngles(sections);
  const sel = game.sectionIndex;
  const cx = x + w / 2, cy = y + h / 2;
  const labelSize = 12 * k;
  const b = h / 2 - labelSize - 8 * k;
  // 左右は駅名の分を空ける。横向きのスマホで高さが縮んだときも、横に潰れすぎないよう縦の 2 倍までにする
  const a = Math.min(w / 2 - 58 * k, b * 2);
  if (!(a > 0 && b > 0)) return; // 画面がごく小さいとき（描くと半径が負になって描画が止まる）
  const at = (t) => loopPoint(cx, cy, a, b, t);
  const arc = (i) => {
    const pts = [];
    const steps = 12;
    for (let j = 0; j <= steps; j++) pts.push(at(angles[i] + ((angles[i + 1] - angles[i]) * j) / steps));
    return pts;
  };
  const strokeArc = (pts) => {
    ctx.beginPath();
    pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 選んでいる区間の下に、ゆっくり明滅する白い光
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + 0.35 * pulse})`;
  ctx.lineWidth = 14 * k;
  strokeArc(arc(sel));

  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = LOOP_COLORS[loopSectionState(game, i)];
    ctx.lineWidth = (i === sel ? 8 : 6) * k;
    strokeArc(arc(i));
  }

  // 駅の点（選んでいる区間の両端は大きく）
  for (let i = 0; i < n; i++) {
    const p = at(angles[i]);
    const big = i === sel || i === (sel + 1) % n;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (big ? 5 : 3.2) * k, 0, Math.PI * 2);
    ctx.fillStyle = TEXT;
    ctx.fill();
    ctx.lineWidth = 1.5 * k;
    ctx.strokeStyle = '#16181d';
    ctx.stroke();
  }

  // 駅名：選んでいる区間の両端を先に、そこから近い順に。重なる・枠からはみ出す駅名は省く
  const order = [...Array(n).keys()].sort((i, j) => {
    const d = (m) => Math.min(Math.abs(m - sel - 0.5), n - Math.abs(m - sel - 0.5));
    return d(i) - d(j);
  });
  const placed = [];
  for (const i of order) {
    const p = at(angles[i]);
    const big = i === sel || i === (sel + 1) % n;
    const size = big ? labelSize * 1.15 : labelSize;
    ctx.font = `${big ? 'bold' : 'normal'} ${size}px ${FONT}`;
    const name = sections[i].fromName;
    const tw = ctx.measureText(name).width;
    const off = 9 * k;
    let lx = p.x + p.c * off;
    const ly = p.y + p.s * off;
    let align = p.c > 0.35 ? 'left' : p.c < -0.35 ? 'right' : 'center';
    // 選んでいる区間が横向きのとき、両端の駅名は互いに離れる向きに寄せる（近い駅どうしで重ならないよう）
    if (big) {
      const other = at(angles[i === sel ? sel + 1 : sel]);
      if (Math.abs(other.x - p.x) > Math.abs(other.y - p.y)) {
        align = other.x > p.x ? 'right' : 'left';
        lx = p.x + (align === 'left' ? -4 : 4) * k;
      }
    }
    const left = align === 'left' ? lx : align === 'right' ? lx - tw : lx - tw / 2;
    const midY = ly + p.s * size * 0.45;
    const box = { x0: left - 2, x1: left + tw + 2, y0: midY - size / 2 - 1, y1: midY + size / 2 + 1 };
    if (box.x0 < x || box.x1 > x + w) continue;
    if (!big && placed.some((q) => box.x0 < q.x1 && q.x0 < box.x1 && box.y0 < q.y1 && q.y0 < box.y1)) continue;
    placed.push(box);
    ctx.fillStyle = big ? TEXT : loopSectionState(game, i) === 'locked' && loopSectionState(game, (i + n - 1) % n) === 'locked' ? '#7a808b' : '#c8ccd4';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, lx, midY);
  }
  ctx.textBaseline = 'alphabetic';

  // 輪の内側：選んでいる区間と、その記録
  const s = sections[sel];
  const [note, noteColor] = sectionNote(game, sel);
  const inner = a * 1.5;
  if (game.cleared.size >= n) text(ctx, '山手線1周達成！', cx, cy - 30 * k, { size: 13 * k, color: YAMANOTE_GREEN, weight: 'bold', align: 'center', maxWidth: inner });
  text(ctx, `${s.fromName} → ${s.toName}`, cx, cy + 2 * k, { size: 22 * k, weight: 'bold', align: 'center', maxWidth: inner });
  text(ctx, note, cx, cy + 24 * k, { size: 14 * k, color: noteColor, align: 'center', maxWidth: inner });

  // タップした場所にいちばん近い区間（弧の真ん中）を選ぶ
  const mids = [...Array(n).keys()].map((i) => at((angles[i] + angles[i + 1]) / 2));
  game.hits.push({
    y0: y,
    y1: y + h,
    x0: x,
    x1: x + w,
    pick: (px, py) => {
      let best = null, bestD = (40 * k) ** 2;
      mids.forEach((m, i) => {
        const d = (m.x - px) ** 2 + (m.y - py) ** 2;
        if (d < bestD) (best = i), (bestD = d);
      });
      return best == null ? null : `section:${best}`;
    },
  });
}

const LOOP_MAP_H = 250; // 環状マップの高さ（縮める前）
const GAP = 22; // 行と行のあいだ
const CELL_H = 48; // 2 列の升目 1 段の高さ（区間名＋注記）
const CELL_GAP = 8; // 升目どうしのすき間

const lineHeight = (item) => (Array.isArray(item) ? (item[1]?.size ?? 16) + GAP : item.cells ? CELL_H + CELL_GAP : item.height + GAP);

// 2〜3 列の升目を 1 段描く。cells: [{ title, note, color, noteColor, selected, outlined, action }]（1〜3 個。1〜2 個は 2 列で並べる）
function drawCellRow(ctx, game, view, cells, y, k) {
  const h = CELL_H * k;
  const n = Math.max(2, cells.length);
  const cw = Math.min(n === 2 ? 260 : 190, (view.w - 32 - CELL_GAP * (n - 1)) / n);
  cells.forEach((c, col) => {
    const cx = view.w / 2 + (col - (n - 1) / 2) * (cw + CELL_GAP);
    const x0 = cx - cw / 2;
    if (c.selected) {
      ctx.fillStyle = 'rgba(154, 205, 50, 0.14)';
      ctx.strokeStyle = YAMANOTE_GREEN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x0, y, cw, h, 8);
      ctx.fill();
      ctx.stroke();
    } else if (c.outlined) {
      // 押せることが分かるよう、薄い枠を付ける（タイトル画面のボタンなど）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.strokeStyle = '#454b57';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x0 + 4, y + 2, cw - 8, h - 4, 8);
      ctx.fill();
      ctx.stroke();
    }
    const titleSize = 17 * k, noteSize = 12 * k;
    text(ctx, c.title, cx, y + h * 0.48, { size: titleSize, weight: c.selected ? 'bold' : 'normal', color: c.color, align: 'center', maxWidth: cw - 12 });
    if (c.note) text(ctx, c.note, cx, y + h * 0.84, { size: noteSize, color: c.noteColor, align: 'center', maxWidth: cw - 12 });
    if (c.action) game.hits.push({ y0: y, y1: y + h, x0, x1: x0 + cw, action: c.action });
  });
}

const PANEL_MAX_W = 640; // 文字の後ろに敷く板の最大幅
const PANEL_PAD = 14; // 板の上下の余白

// 画面全体を暗くし、中央の板の上に文字の行を並べる（板があると後ろの地図が透けず、小さい文字も読める）。
// lines の要素は次のどちらか：
//   [文字列, 書式, タップしたときの動作（省略可）] … 1 行の文字
//   { cells: [...] } … 2 列の升目 1 段（drawCellRow）
//   { height, draw } … 高さ height の自由な描画。draw(y, h) に縮めたあとの位置と高さを渡す
// 動作のある行・升目は game.hits に登録する。
// 縦に収まらない（横向きのスマホなど）ときは、文字と行間をまとめて縮める。
function drawOverlay(ctx, game, view, lines, dim = 0.7) {
  ctx.fillStyle = `rgba(15, 16, 20, ${dim})`;
  ctx.fillRect(0, 0, view.w, view.h);
  const total = lines.reduce((sum, item) => sum + lineHeight(item), 0);
  const k = Math.min(1, (view.h - 32) / total);
  let y = (view.h - total * k) / 2;
  const panelW = Math.min(PANEL_MAX_W, view.w - 16);
  const panelH = Math.min(view.h - 8, total * k + PANEL_PAD * 2);
  ctx.fillStyle = 'rgba(22, 24, 29, 0.94)';
  ctx.strokeStyle = '#353a44';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect((view.w - panelW) / 2, (view.h - panelH) / 2, panelW, panelH, 14);
  ctx.fill();
  ctx.stroke();
  for (const item of lines) {
    if (item.cells) {
      drawCellRow(ctx, game, view, item.cells, y + (CELL_GAP * k) / 2, k);
      y += lineHeight(item) * k;
      continue;
    }
    if (item.draw) {
      item.draw(y + (GAP * k) / 2, item.height * k);
      y += lineHeight(item) * k;
      continue;
    }
    const [str, opts = {}, action] = item;
    const size = (opts.size ?? 16) * k;
    const lineH = size + GAP * k;
    const baseline = y + size + (GAP * k) / 2 - size * 0.15;
    if (str) text(ctx, str, view.w / 2, baseline, { ...opts, size, align: 'center', maxWidth: panelW - 24 });
    if (action) game.hits.push({ y0: y, y1: y + lineH, action });
    y += lineH;
  }
}

const tapOrSpace = (game) => (game.touch ? 'タップ' : 'スペース / クリック');

// 3D版：区間の街を作っているあいだの進み具合（文字と横長の棒）
function drawPrepareBar(ctx, game, view, y, h) {
  const k = h / 34;
  const w = Math.min(280, view.w - 80);
  const x = (view.w - w) / 2;
  const label = `街を準備中… ${Math.floor(game.preparing * 100)}%${game.startWhenReady ? '（できたらスタート）' : ''}`;
  text(ctx, label, view.w / 2, y + 14 * k, { size: 14 * k, color: QUIET, align: 'center' });
  ctx.fillStyle = '#353a44';
  ctx.beginPath();
  ctx.roundRect(x, y + 22 * k, w, 8 * k, 4 * k);
  ctx.fill();
  ctx.fillStyle = YAMANOTE_GREEN;
  ctx.beginPath();
  ctx.roundRect(x, y + 22 * k, Math.max(8 * k, w * game.preparing), 8 * k, 4 * k);
  ctx.fill();
}

// タイトルの文字と、その下の線路を走る山手線と自転車（追いかけっこを繰り返す）
const LOGO_H = 112;
function drawLogo(ctx, view, y, h) {
  const k = h / LOGO_H;
  const cx = view.w / 2;
  const panelW = Math.min(PANEL_MAX_W, view.w - 16);
  // 「山手線」は路線の黄緑、「に勝て！」は白
  const size = Math.min(48 * k, (panelW - 40) / 6.6);
  ctx.font = `bold ${size}px ${FONT}`;
  const a = '山手線', b = 'に勝て！';
  const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
  const base = y + 52 * k;
  text(ctx, a, cx - (wa + wb) / 2, base, { size, weight: 'bold', color: YAMANOTE_GREEN });
  text(ctx, b, cx - (wa + wb) / 2 + wa, base, { size, weight: 'bold' });

  // 線路（枕木とレール）
  const tw = Math.min(panelW - 48, 440);
  const x0 = cx - tw / 2;
  const ty = y + 94 * k;
  ctx.strokeStyle = '#4a4f5a';
  ctx.lineWidth = 1.5 * k;
  for (let x = x0 + 3 * k; x < x0 + tw; x += 9 * k) {
    ctx.beginPath();
    ctx.moveTo(x, ty - 2 * k);
    ctx.lineTo(x, ty + 5 * k);
    ctx.stroke();
  }
  ctx.strokeStyle = '#7a808b';
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(x0, ty + 1 * k);
  ctx.lineTo(x0 + tw, ty + 1 * k);
  ctx.stroke();

  // 6 秒で左から右へ。自転車は電車の少し前を、前に出たり追いつかれそうになったりしながら走る
  const now = performance.now();
  const carW = 46 * k, carH = 13 * k, cars = 3;
  const head = x0 - 50 * k + (tw + cars * carW + 100 * k) * ((now / 6000) % 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, ty - 30 * k, tw, 40 * k);
  ctx.clip();
  for (let c = 0; c < cars; c++) {
    const left = head - (c + 1) * carW - c * 2 * k;
    ctx.fillStyle = '#c9ced6';
    ctx.beginPath();
    ctx.roundRect(left, ty - carH - 1 * k, carW, carH, c === 0 ? [2 * k, 7 * k, 2 * k, 2 * k] : 2 * k);
    ctx.fill();
    ctx.fillStyle = YAMANOTE_GREEN; // 黄緑の帯
    ctx.fillRect(left, ty - 5 * k, carW, 2.5 * k);
    ctx.fillStyle = '#2b3038'; // 窓
    for (let j = 0; j < 4; j++) ctx.fillRect(left + 5 * k + j * 10 * k, ty - carH + 2 * k, 7 * k, 4 * k);
  }
  // 自転車：車輪 2 つと車体、乗る人の頭
  const bx = head + 30 * k + 14 * k * Math.sin(now / 700);
  ctx.strokeStyle = PLAYER_YELLOW;
  ctx.lineWidth = 1.6 * k;
  for (const wx of [-5, 5]) {
    ctx.beginPath();
    ctx.arc(bx + wx * k, ty - 4 * k, 3.4 * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(bx - 5 * k, ty - 4 * k);
  ctx.lineTo(bx, ty - 9 * k);
  ctx.lineTo(bx + 5 * k, ty - 4 * k);
  ctx.stroke();
  ctx.fillStyle = PLAYER_YELLOW;
  ctx.beginPath();
  ctx.arc(bx + 1 * k, ty - 13.5 * k, 2.6 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 押せる大きなボタン（枠の中がゆっくり明滅する）。action を game.hits に登録する
function drawButton(ctx, game, view, y, h, label, action) {
  const k = h / 54;
  const w = Math.min(320, view.w - 64);
  const x = (view.w - w) / 2;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
  ctx.fillStyle = `rgba(154, 205, 50, ${0.12 + 0.12 * pulse})`;
  ctx.strokeStyle = YAMANOTE_GREEN;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y + 4 * k, w, h - 8 * k, 12 * k);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'middle';
  text(ctx, label, view.w / 2, y + h / 2 + 1, { size: 20 * k, weight: 'bold', align: 'center', maxWidth: w - 24 });
  ctx.textBaseline = 'alphabetic';
  game.hits.push({ y0: y, y1: y + h, x0: x, x1: x + w, action });
}

function drawTitle(ctx, game, view) {
  const n = game.sections.length;
  const clearedCount = game.sections.filter((s) => game.cleared.has(s.id)).length;
  const progress =
    clearedCount >= n ? `山手線1周達成！ 全${n}区間クリア` : clearedCount ? `クリア ${clearedCount} / ${n} 区間` : `全${n}区間で山手線1周に挑戦`;
  drawOverlay(ctx, game, view, [
    { height: LOGO_H, draw: (y, h) => drawLogo(ctx, view, y, h) },
    ['東京の本物の道を自転車で走り、山手線より先に次の駅へ', { size: 15, color: '#c8ccd4' }],
    [progress, { size: 14, weight: 'bold', color: YAMANOTE_GREEN }],
    { height: 54, draw: (y, h) => drawButton(ctx, game, view, y, h, `${tapOrSpace(game)}ではじめる`, 'start') },
    {
      cells: [
        { title: '遊び方', note: game.touch ? 'ルールと操作' : 'H キー', color: TEXT, noteColor: QUIET, action: 'howto', outlined: true },
        game.mode === '3d'
          ? { title: '2D版に切り替える', note: '真上から見る', color: TEXT, noteColor: QUIET, action: 'switch', outlined: true }
          : { title: '3D版で遊ぶ', note: '試作・街を立体で走る', color: TEXT, noteColor: QUIET, action: 'switch', outlined: true },
      ],
    },
    ...(game.droppedRecords
      ? [[`コースが変わった ${game.droppedRecords} 区間のベストとゴーストをリセットしました`, { size: 13, color: '#ffc93c' }]]
      : []),
    [`音：${game.muted ? 'オフ' : 'オン'}${game.touch ? '（右上のボタン）' : '（M キーで切り替え）'}`, { size: 12, color: QUIET }],
    ['地図 © OpenStreetMap contributors（ODbL）・音楽と効果音は Web Audio で自作', { size: 12, color: QUIET }],
    ['JR東日本とは関係のない非公式のファンゲームです', { size: 12, color: QUIET }],
  ], game.mode === '3d' ? 0.3 : 0.7); // 3D版は後ろの山手線のミニチュアが見えるように
}

function drawHowto(ctx, game, view) {
  // キーの説明は 1 行だと板の幅に収まらないので 3 行に分ける
  const controls = game.touch
    ? ['画面下のボタンで操作（左：ハンドル、右：ブレーキ／アクセル）　右上の ❚❚ で一時停止']
    : [
        '矢印キー / WASD で操作　P：一時停止　R：やり直し　Esc：戻る',
        'M：音　G：ゴースト　T：時間帯　Y：天気　E：天気の影響',
        `V：自転車の種類　U：服　K：ヘルメット（区間選択で）　B：ベル${game.mode === '3d' ? '　C：視点　F：季節　J：飾り　Q：軽さ' : ''}　L：ゴーストの見た目`,
      ];
  drawOverlay(ctx, game, view, [
    ['遊び方', { size: 30, weight: 'bold', color: YAMANOTE_GREEN }],
    ['電車（上のバーの黄緑）より先に、緑の円のゴールへ', { size: 16 }],
    ['緑の矢印がゴールの方向。地図は本物の東京の道です', { size: 15, color: QUIET }],
    ['赤信号を無視すると5秒ストップ（黄色はセーフ）', { size: 15 }],
    ['車にぶつかると2秒、歩行者は1秒ストップ', { size: 15 }],
    ['一方通行（灰色の矢印）を逆走すると減速', { size: 15 }],
    ['歩道と道路の外は遅い。距離の近道が速いとは限らない', { size: 15 }],
    ['勝つと次の区間が遊べるようになります', { size: 15, color: PLAYER_YELLOW }],
    ['半透明の白い自転車は、あなたのベストの走り（ゴースト）', { size: 15, color: QUIET }],
    ['右上のミニマップで周り700mの道が見えます。駅や名所の名前が目印', { size: 15, color: QUIET }],
    ...controls.map((line) => [line, { size: 14, color: QUIET }]),
    [`${tapOrSpace(game)}で戻る`, { size: 18, weight: 'bold' }, 'title'],
  ]);
}

function drawReady(ctx, game, view) {
  const n = game.sections.length;
  const clearedCount = game.sections.filter((s) => game.cleared.has(s.id)).length;
  const panelW = Math.min(PANEL_MAX_W, view.w - 16);
  const lines = [
    ['区間を選ぶ', { size: 28, weight: 'bold', color: YAMANOTE_GREEN }],
    [`クリア ${clearedCount} / ${n} 区間　${game.touch ? '路線をタップで選択' : '↑ ↓ で選択'}`, { size: 13, color: QUIET }],
    // 山手線の環状マップ（クリア済みは黄緑、遊べる区間は黄、未解放は灰色）
    { height: LOOP_MAP_H, draw: (y, h) => drawLoopMap(ctx, game, (view.w - panelW) / 2 + 12, y, panelW - 24, h, h / LOOP_MAP_H) },
  ];

  const section = game.sections[game.sectionIndex];
  // 時間帯と天気（見た目と音だけ。タップかキーで切り替え）
  lines.push({
    cells: [
      { title: `時間帯：${TIME_NAMES[game.timeOfDay]}`, note: game.touch ? 'タップで切り替え' : 'T で切り替え', color: TEXT, noteColor: QUIET, action: 'time', outlined: true },
      { title: `天気：${WEATHER_NAMES[game.weather]}`, note: game.touch ? 'タップで切り替え' : 'Y で切り替え', color: TEXT, noteColor: QUIET, action: 'weather', outlined: true },
      ...(game.mode === '3d' ? [{ title: `季節：${SEASON_NAMES[game.season] ?? '夏'}`, note: game.touch ? 'タップで切り替え' : 'F で切り替え', color: TEXT, noteColor: QUIET, action: 'season', outlined: true }] : []),
    ],
  });
  // 自転車の種類・服・ヘルメット（見た目だけ。タップかキーで切り替え）
  // 文字をその色で書く（黒っぽい色は暗い板の上で読めないので、明るい灰色にする）
  const swatch = (hex) => ((hex >> 16) + ((hex >> 8) & 255) + (hex & 255) < 200 ? '#a8aeb8' : `#${hex.toString(16).padStart(6, '0')}`);
  const outfit = outfitOf(game.outfit), helmet = helmetOf(game.helmet);
  lines.push({
    cells: [
      { title: `自転車：${bikeTypeOf(game.bikeType).name}`, note: game.touch ? 'タップで切り替え' : 'V で切り替え', color: TEXT, noteColor: QUIET, action: 'bikeType', outlined: true },
      { title: `服：${outfit.name}`, note: game.touch ? 'タップで切り替え' : 'U で切り替え', color: swatch(outfit.jersey), noteColor: QUIET, action: 'outfit', outlined: true },
      { title: `ヘルメット：${helmet.name}`, note: game.touch ? 'タップで切り替え' : 'K で切り替え', color: swatch(helmet.color), noteColor: QUIET, action: 'helmet', outlined: true },
    ],
  });
  // 自転車の飾り（3D版）
  if (game.mode === '3d') {
    // 軽さ（今の画面の滑らかさ＝1 秒に描く回数も出す）
    const q = `軽さ：${QUALITY_NAMES[game.quality] ?? 'ふつう'}　いま ${view.fps ?? '-'} fps`;
    lines.push([game.touch ? q : `${q}（Q）`, { size: 13, color: (view.fps ?? 60) < 30 ? '#ffc93c' : QUIET }, 'quality']);
    const acc = `自転車の飾り：${ACCESSORY_NAMES[game.accessory] ?? 'なし'}`;
    lines.push([game.touch ? acc : `${acc}（J）`, { size: 13, color: game.accessory && game.accessory !== 'none' ? TEXT : QUIET }, 'accessory']);
  }
  // 天気の影響：あり／なし（雨・雪で走りやすさが変わる。記録は別）
  const eff = game.weatherEffects
    ? game.effect
      ? `天気の影響：あり（${game.effect.name}：${game.effect.note}。記録は別）`
      : '天気の影響：あり（晴れでは変わらない）'
    : '天気の影響：なし';
  lines.push([game.touch ? eff : `${eff}（E）`, { size: 13, color: game.effect ? '#7ec8ff' : QUIET }, 'weatherEffects']);
  lines.push([`◀  難易度：${DIFFICULTIES[game.difficulty].name}  ▶`, { size: 17, weight: 'bold', color: YAMANOTE_GREEN }, 'difficulty']);
  if (!game.isUnlocked(game.sectionIndex)) {
    // あと何区間勝てば遊べるかと、次に遊ぶ区間への移動
    const j = game.nextToPlay(game.sectionIndex);
    const prev = game.sections[game.sectionIndex - 1];
    const target = game.sections[j];
    const remaining = game.sectionIndex - j;
    lines.push([
      remaining === 1 ? `${prev.fromName} → ${prev.toName} で勝つと遊べます` : `あと ${remaining} 区間勝つと遊べます`,
      { size: 16, color: '#ffc93c' },
    ]);
    lines.push([`${tapOrSpace(game)}で ${target.fromName} → ${target.toName} へ`, { size: 18, weight: 'bold' }, 'start']);
  } else if (game.loadingMap || game.section !== section) {
    lines.push(['地図を読み込み中…', { size: 16, color: QUIET }]);
  } else if (game.preparing != null) {
    // 3D版：区間の街を少しずつ作っているあいだ
    lines.push({ height: 34, draw: (y, h) => drawPrepareBar(ctx, game, view, y, h) });
  } else {
    lines.push([`電車より先に${section.toName}駅へ！ 制限時間 ${formatTime(game.train.limit)}`, { size: 15, color: QUIET }]);
    if (game.ghost) {
      const label = `ゴースト（ベスト ${formatTime(game.ghost.time)} の走り）：${game.showGhost ? '表示する' : '表示しない'}`;
      lines.push([game.touch ? label : `${label}（G）`, { size: 14, color: game.showGhost ? TEXT : QUIET }, 'ghost']);
    } else {
      lines.push(['ゴースト：勝つとベストの走りが記録されます', { size: 13, color: QUIET }]);
    }
    const look = `ゴーストの見た目：${GHOST_LOOK_NAMES[game.ghostLook] ?? '白'}`;
    lines.push([game.touch ? look : `${look}（L）`, { size: 13, color: QUIET }, 'ghostLook']);
    lines.push([game.touch ? 'ここをタップでスタート' : 'スペース / クリックでスタート', { size: 20, weight: 'bold' }, 'start']);
  }
  if (game.touch) {
    lines.push(['難易度は ◀ ▶ の側をタップ', { size: 13, color: QUIET }]);
    lines.push(['タイトルへ戻る', { size: 15, color: QUIET }, 'title']);
  } else {
    lines.push(['← → 難易度　Esc タイトルへ', { size: 13, color: QUIET }]);
  }
  drawOverlay(ctx, game, view, lines);
}

function drawCountdown(ctx, game, view) {
  const n = Math.ceil(game.countdown);
  text(ctx, String(n), view.w / 2, view.h / 2 - 40, { size: 96, weight: 'bold', align: 'center' });
}

// 一時停止中：止めたレースの上に、再開・やり直し・区間選択へを出す
function drawPause(ctx, game, view) {
  drawOverlay(ctx, game, view, [
    ['一時停止', { size: 36, weight: 'bold', color: YAMANOTE_GREEN }],
    [`${game.map.from} → ${game.map.to}　電車到着まで ${formatTime(timeLeft(game.train, game.time))}`, { size: 15, color: QUIET }],
    ['', { size: 4 }],
    [game.touch ? 'タップで再開' : 'スペース / P / クリックで再開', { size: 22, weight: 'bold' }, 'resume'],
    [game.touch ? 'やり直す' : 'R やり直す', { size: 16, color: QUIET }, 'retry'],
    [game.touch ? '区間選択へ' : 'Esc 区間選択へ', { size: 16, color: QUIET }, 'menu'],
  ]);
}

function drawGo(ctx, game, view) {
  // スタート直後 0.8 秒だけ表示
  if (game.time > 0.8) return;
  ctx.globalAlpha = 1 - game.time / 0.8;
  text(ctx, 'GO!', view.w / 2, view.h / 2 - 40, { size: 96, weight: 'bold', color: YAMANOTE_GREEN, align: 'center' });
  ctx.globalAlpha = 1;
}

const km = (m) => `${(m / 1000).toFixed(2)} km`;

// 止まった場所の印（結果画面のルート地図）。信号無視は赤い四角、車は橙の丸、歩行者は紫の丸
const INCIDENT_STYLE = {
  red: { color: '#ff4d4d', shape: 'square', label: '信号無視' },
  car: { color: '#ff9f43', shape: 'circle', label: '車' },
  ped: { color: '#c9b8ff', shape: 'circle', label: '歩行者' },
};
function drawIncident(ctx, x, y, type, size = 5) {
  const st = INCIDENT_STYLE[type];
  ctx.fillStyle = st.color;
  ctx.strokeStyle = '#111317';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (st.shape === 'square') ctx.rect(x - size, y - size, size * 2, size * 2);
  else ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// 結果画面のルート比較：区間の地図に、今回の走り（黄）と最速ルート（緑）を重ねる。北が上
function drawRouteMap(ctx, game, view, y, h) {
  const map = game.map;
  const track = game.result.track;
  const route = fastestRoute(map).path;
  // 映す範囲：スタート・ゴール・両方のルートが収まる四角
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => {
    minX = Math.min(minX, x), maxX = Math.max(maxX, x);
    minY = Math.min(minY, y), maxY = Math.max(maxY, y);
  };
  include(map.start.x, map.start.y);
  include(map.goal.x, map.goal.y);
  for (const [x, y] of route) include(x, y);
  for (let i = 0; i + 1 < track.length; i += 3) include(track[i], track[i + 1]);
  const pad = 60; // m
  const rw = maxX - minX + 2 * pad, rh = maxY - minY + 2 * pad;
  const s = Math.min((view.w - 32) / rw, 480 / rw, h / rh); // CSS px / m
  const w = Math.max(rw * s, Math.min(view.w - 32, 160)); // 枠は地図の形に合わせる（細すぎるときは少し広げる）
  const x0 = (view.w - w) / 2;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const toScreen = (wx, wy) => [x0 + w / 2 + (wx - cx) * s, y + h / 2 + (wy - cy) * s];

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y, w, h, 8);
  ctx.fillStyle = '#1f2228';
  ctx.fill();
  ctx.clip();
  // 道路の下描き（ミニマップと同じ画像を縮小して貼る）
  const img = minimapImage(map);
  const [ix, iy] = toScreen(map.bounds.minX, map.bounds.minY);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(img, ix, iy, (img.width / IMAGE_SCALE) * s, (img.height / IMAGE_SCALE) * s);
  ctx.globalAlpha = 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const strokePath = (n, at, color, width) => {
    if (n < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(...toScreen(...at(i)));
    ctx.stroke();
  };
  // 最速ルートは太く下に、自分の走りは細く上に（重なったところも両方見えるように）
  strokePath(route.length, (i) => route[i], 'rgba(80, 200, 120, 0.75)', 6);
  strokePath(track.length / 3, (i) => [track[3 * i], track[3 * i + 1]], PLAYER_YELLOW, 2.5);

  // 止まった場所
  for (const inc of game.result.incidents ?? []) drawIncident(ctx, ...toScreen(inc.x, inc.y), inc.type);

  // スタート（白）とゴール（緑の輪）
  const [sx, sy] = toScreen(map.start.x, map.start.y);
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI * 2);
  ctx.fill();
  const [gx, gy] = toScreen(map.goal.x, map.goal.y);
  ctx.strokeStyle = GOAL_GREEN;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(gx, gy, Math.max(5, map.goal.radius * s), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#5a606b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x0, y, w, h, 8);
  ctx.stroke();
}

// ルート比較の凡例：色の線と、それぞれの道のり
function drawRouteLegend(ctx, game, view, y, h) {
  const r = game.result;
  const items = [[PLAYER_YELLOW, `あなた ${km(r.trackLength)}${r.win ? '' : '（途中まで）'}`]];
  const route = fastestRoute(game.map);
  if (route.path.length > 1) items.push([GOAL_GREEN, `最速ルート ${km(route.length)}`]);
  const size = Math.min(14, h);
  ctx.font = `${size}px ${FONT}`;
  const swatch = 18, space = 6, between = 24;
  const widths = items.map(([, label]) => swatch + space + ctx.measureText(label).width);
  let x = view.w / 2 - (widths.reduce((a, b) => a + b, 0) + between * (items.length - 1)) / 2;
  const mid = y + h / 2;
  items.forEach(([color, label], i) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x + swatch, mid);
    ctx.stroke();
    text(ctx, label, x + swatch + space, mid + size * 0.35, { size, color: QUIET });
    x += widths[i] + between;
  });
}

// 止まった場所の印の凡例：種類ごとの回数と、止まっていた秒数の合計
function drawIncidentLegend(ctx, game, view, y, h) {
  const incidents = game.result.incidents ?? [];
  const items = Object.keys(INCIDENT_STYLE)
    .map((type) => {
      const list = incidents.filter((i) => i.type === type);
      return list.length ? [type, `${INCIDENT_STYLE[type].label} ${list.length}回 −${list.reduce((s, i) => s + i.stop, 0)}秒`] : null;
    })
    .filter(Boolean);
  const size = Math.min(13, h);
  ctx.font = `${size}px ${FONT}`;
  const gap = 18, mark = 14;
  const widths = items.map(([, label]) => mark + ctx.measureText(label).width);
  let x = view.w / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)) / 2;
  const mid = y + h / 2;
  items.forEach(([type, label], i) => {
    drawIncident(ctx, x + 5, mid, type, 4.5);
    text(ctx, label, x + mark, mid + size * 0.35, { size, color: QUIET });
    x += widths[i] + gap;
  });
}

// メダル：リボンと円盤。中に「金」「銀」「銅」の字。r は円盤の半径
function drawMedal(ctx, x, y, r, medal) {
  // リボン（円盤の上に V の字）
  ctx.fillStyle = '#2f7d3a';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.15, y - r * 0.6);
    ctx.lineTo(x + side * r * 0.75, y - r * 1.75);
    ctx.lineTo(x + side * r * 0.25, y - r * 1.75);
    ctx.lineTo(x - side * r * 0.3, y - r * 0.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = YAMANOTE_GREEN;
  ctx.fillRect(x - r * 0.75, y - r * 1.85, r * 1.5, r * 0.22);
  // 円盤（左上が明るい）と縁
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, medal.color);
  g.addColorStop(1, medal.dark);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.strokeStyle = medal.dark;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.stroke();
  ctx.textBaseline = 'middle';
  text(ctx, medal.name, x, y + r * 0.04, { size: r * 0.95, weight: 'bold', color: medal.dark, align: 'center' });
  ctx.textBaseline = 'alphabetic';
}

// 「勝ち！」と、その左のメダル。メダルは結果画面が出たときに少し大きくなってから収まる
function drawWinTitle(ctx, game, view, y, h) {
  if (!(h > 0)) return; // 画面がごく小さいとき（描くと半径が負になって描画が止まる）
  const r = game.result;
  const size = h * 0.75;
  ctx.font = `bold ${size}px ${FONT}`;
  const tw = ctx.measureText('勝ち！').width;
  const medal = r.medal?.medal;
  const mr = h * 0.44;
  const gap = mr * 0.6;
  const total = tw + (medal ? mr * 2 + gap : 0);
  const x0 = view.w / 2 - total / 2;
  if (medal) {
    const t = Math.min(1, (performance.now() - r.shownAt) / 450);
    const pop = t < 1 ? 1 + 0.35 * Math.sin(Math.PI * t) : 1; // 0.45 秒で 1 → 1.35 → 1
    drawMedal(ctx, x0 + mr, y + h * 0.66, mr * pop * Math.min(1, t * 3 + 0.2), medal);
  }
  text(ctx, '勝ち！', x0 + total - tw, y + h * 0.88, { size, weight: 'bold', color: YAMANOTE_GREEN });
}

// メダルの名前と、ひとつ上のメダルまでの秒数
function medalLine(m) {
  if (!m.upper) return [`${m.medal.name}メダル！ いちばん上の評価です`, { size: 16, weight: 'bold', color: m.medal.color }];
  return [
    `${m.medal.name}メダル　${m.upper.name}メダルまで あと ${(Math.ceil(m.toUpper * 10) / 10).toFixed(1)} 秒`,
    { size: 16, color: m.medal.color },
  ];
}

// 結果をシェアする行。押したあとは、コピーできたかなどを出す
const SHARE_STATUS = {
  busy: ['シェアしています…', QUIET],
  copied: ['結果をコピーしました。SNS などに貼り付けてください', YAMANOTE_GREEN],
  shared: ['シェアしました', YAMANOTE_GREEN],
  cancelled: [null],
  failed: ['コピーできませんでした', '#ff6b5e'],
};
function shareLine(game) {
  const [msg, color] = SHARE_STATUS[game.result.shareStatus] ?? [null];
  if (msg) return [msg, { size: 15, color }, 'share'];
  return [game.touch ? '結果をシェア' : 'S 結果をシェア（コピー）', { size: 15, color: QUIET }, 'share'];
}

const GOAL_SHOW_MS = 2200; // src/game.js の GOAL_SHOW_MS と同じ
const SEASON_NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const GHOST_LOOK_NAMES = { white: '白', glow: '光る水色', green: '山手線の黄緑', mine: '自分と同じ色' };
const QUALITY_NAMES = { high: 'ふつう', mid: '軽い', low: 'とても軽い' };
const ACCESSORY_NAMES = { none: 'なし', scarf: 'マフラー', bag: '買い物袋', flowers: '花束', child: '子ども乗せの子ども' };
// 3D版：結果画面の前に、大きく「ゴール！」とタイム（後ろでくす玉が割れる）か、「電車が先に到着…」（後ろで電車のドアが開く）だけを出す
function drawGoalFlash(ctx, game, view) {
  const r = game.result;
  const elapsed = Math.max(0, Math.min(1, 1 - (r.shownAt - performance.now()) / GOAL_SHOW_MS)); // 0〜1
  const size = Math.min(96, view.w / 6) * (1 + 0.3 * Math.max(0, 1 - elapsed * 4)); // 大きく出て、すぐ落ち着く
  const y = view.h * 0.68; // 画面の下の方（上の方では、くす玉が割れる）
  ctx.save();
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.12;
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.85)';
  const title = r.win ? 'ゴール！' : '電車が先に到着…';
  if (!r.win) ctx.font = `bold ${Math.round(size * 0.62)}px sans-serif`;
  ctx.strokeText(title, view.w / 2, y);
  ctx.fillStyle = r.win ? PLAYER_YELLOW : '#ff8a7a';
  ctx.fillText(title, view.w / 2, y);
  const sub = r.win ? `${formatTime(r.time)}　電車より ${(game.train.limit - r.time).toFixed(1)} 秒早く到着` : `${game.map.to}駅まで あと ${r.distance.toFixed(0)} m`;
  ctx.font = `bold ${Math.round(size * 0.28)}px sans-serif`;
  ctx.lineWidth = size * 0.06;
  ctx.strokeText(sub, view.w / 2, y + size * 0.85);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sub, view.w / 2, y + size * 0.85);
  ctx.restore();
}

function drawResult(ctx, game, view) {
  const r = game.result;
  if (performance.now() < r.shownAt) return drawGoalFlash(ctx, game, view);
  const lines = r.win
    ? [
        { height: 64, draw: (y, h) => drawWinTitle(ctx, game, view, y, h) },
        [`タイム ${formatTime(r.time)}　電車より ${(game.train.limit - r.time).toFixed(1)} 秒早く到着`, { size: 18 }],
        medalLine(r.medal),
        ...(view.podium ? [{ height: 150, draw: (y, h) => ctx.drawImage(view.podium, view.w / 2 - (h * 360) / 210 / 2, y, (h * 360) / 210, h) }] : []),
        [
          r.newBest ? 'ベストタイム更新！' : `ベストタイム ${formatTime(game.best)}`,
          { size: 16, color: PLAYER_YELLOW, weight: r.newBest ? 'bold' : 'normal' },
        ],
      ]
    : [
        ['負け…', { size: 48, weight: 'bold', color: '#ff6b5e' }],
        [`電車が先に${game.map.to}駅に着きました`, { size: 18 }],
        [`ゴールまであと ${r.distance.toFixed(0)} m`, { size: 16, color: QUIET }],
      ];
  if (r.ghostDiff != null) {
    const d = r.ghostDiff;
    const msg = d < 0 ? `ゴーストより ${(-d).toFixed(1)} 秒速い！` : d > 0 ? `ゴーストより ${d.toFixed(1)} 秒遅い` : 'ゴーストと同着';
    lines.push([msg, { size: 15, color: d < 0 ? YAMANOTE_GREEN : QUIET }]);
  }
  // 止まった回数は、ルート地図の下の凡例（drawIncidentLegend）に出す。一度も止まらなければここで知らせる
  const s = r.stats;
  if (s.red + s.car + s.ped === 0) lines.push(['信号無視・衝突なし', { size: 14, color: YAMANOTE_GREEN }]);
  lines.push({ height: Math.round(Math.max(110, Math.min(220, view.h * 0.3))), draw: (y, h) => drawRouteMap(ctx, game, view, y, h) });
  lines.push({ height: 14, draw: (y, h) => drawRouteLegend(ctx, game, view, y, h) });
  if (r.incidents?.length) lines.push({ height: 13, draw: (y, h) => drawIncidentLegend(ctx, game, view, y, h) });
  if (r.lapComplete) lines.push([`山手線1周達成！ 全${game.sections.length}区間クリア`, { size: 22, color: YAMANOTE_GREEN, weight: 'bold' }]);
  if (r.unlocked) lines.push([`新しい区間 ${r.unlocked.fromName} → ${r.unlocked.toName} が遊べるようになりました`, { size: 16, color: '#ffc93c', weight: 'bold' }]);
  if (r.next) {
    lines.push([`${tapOrSpace(game)}で次の区間へ（${r.next.fromName} → ${r.next.toName}）`, { size: 18, weight: 'bold' }, 'next']);
    lines.push([game.touch ? 'もう一度' : 'R もう一度', { size: 15, color: QUIET }, 'retry']);
  } else {
    lines.push([`${tapOrSpace(game)}でもう一度`, { size: 18, weight: 'bold' }, 'retry']);
  }
  lines.push(shareLine(game));
  lines.push([game.touch ? '区間選択へ' : 'Esc 区間選択へ', { size: 15, color: QUIET }, 'menu']);
  drawOverlay(ctx, game, view, lines);
}

// view: { w, h, ppm, landmarks, goalPointer }（画面の幅・高さ CSS px、1m あたりの CSS px、
// ランドマークの名前とゴール方向の矢印を出すか。3D版は地図の真上からの見た目ではないので出さない）
export function drawHud(ctx, game, view) {
  game.hits = [];
  const menu = game.state === 'title' || game.state === 'howto' || game.state === 'ready';
  // OpenStreetMap のクレジットの位置（スマホのレース中は操作ボタンの上）
  const creditY = game.touch && !menu ? view.h - 112 : view.h - 10;
  // ランドマークの名前は地図の一部としていちばん下に。レースバー・ミニマップ・クレジットの上には出さない
  const mm = minimapRect(view);
  const avoid = [{ x0: view.w - 190, y0: creditY - 14, x1: view.w, y1: creditY + 4 }];
  if (!menu) {
    avoid.push({ x0: 0, y0: 0, x1: view.w, y1: 84 }, { x0: 0, y0: 84, x1: STATUS.x + STATUS.w + 4, y1: STATUS.y + STATUS.h + 4 }, { x0: mm.x - 4, y0: mm.y - 4, x1: mm.x + mm.size + 4, y1: mm.y + mm.size + 4 });
    // スマホのレース中は画面下の操作ボタン（高さ約 100px）の裏に隠れる
    if (game.touch) avoid.push({ x0: 0, y0: view.h - 104, x1: view.w, y1: view.h });
  }
  // 2D版：時間帯の色を地図の上に重ねる
  if (view.tint && TIME_TINT[game.timeOfDay]) {
    ctx.fillStyle = TIME_TINT[game.timeOfDay];
    ctx.fillRect(0, 0, view.w, view.h);
  }
  // 雨・雪（メニュー画面でも降らせる）
  drawWeather(ctx, game, view);
  // 3D版：速く走ると、画面の端に風の線が流れる
  if (game.mode === '3d' && game.state === 'racing' && !game.paused) drawSpeedLines(ctx, game, view);
  // メニュー画面では出さない（暗くした地図の上でも文字が読めてしまい、メニューの文字と紛れる）
  if (!menu && view.landmarks3d) drawLandmarks3D(ctx, game, view, avoid);
  else if (!menu && view.landmarks !== false) drawLandmarks(ctx, game, view, avoid);
  // メニュー画面ではレース情報を出さない
  if (!menu) {
    if (game.state === 'result') {
      // ゴールしたあとは、ゴールの方向や距離は出さない
    } else if (view.goal3d) drawGoalPointer3D(ctx, game, view);
    else if (view.goalPointer !== false) drawGoalPointer(ctx, game, view);
    drawRaceBar(ctx, game, view);
    drawStatus(ctx, game);
    drawMinimap(ctx, game, view);
  }
  if (game.state === 'racing' && !game.paused) drawAlerts(ctx, game, view);

  if (game.paused) drawPause(ctx, game, view);
  else if (game.state === 'title') drawTitle(ctx, game, view);
  else if (game.state === 'howto') drawHowto(ctx, game, view);
  else if (game.state === 'ready') drawReady(ctx, game, view);
  else if (game.state === 'countdown') drawCountdown(ctx, game, view);
  else if (game.state === 'racing') drawGo(ctx, game, view);
  else if (game.state === 'result') drawResult(ctx, game, view);

  // OpenStreetMap のクレジット（ODbL で表示が必要）
  text(ctx, '© OpenStreetMap contributors', view.w - 10, creditY, { size: 12, color: QUIET, align: 'right' });
  ctx.textAlign = 'left';
}
