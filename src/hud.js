// 画面上の表示（電車との進み具合、速度、案内、各画面のオーバーレイ）。
// 座標はすべて CSS ピクセル。
import { trainProgress, timeLeft, DIFFICULTIES } from './train.js';
import { drawMinimap, minimapRect, minimapImage, IMAGE_SCALE } from './minimap.js';
import { fastestRoute } from './route.js';
import { drawLandmarks, drawLandmarks3D } from './landmarks.js';

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

  text(ctx, game.map.from, x0 - 10, y + 5, { size: 13, align: 'right' });
  text(ctx, game.map.to, x1 + 10, y + 5, { size: 13 });

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
  text(ctx, `電車到着まで ${formatTime(left)}`, view.w / 2, 24, {
    size: 16,
    weight: 'bold',
    color: left < 15 ? '#ff6b5e' : TEXT,
    align: 'center',
  });
}

function drawStatus(ctx, game) {
  const kmh = Math.abs(game.player.speed) * 3.6;
  const where = game.surface.road?.n ?? { road: '道路', path: '歩道', ground: '道路外' }[game.surface.kind];
  text(ctx, `速度 ${kmh.toFixed(0)} km/h　残り ${game.distance.toFixed(0)} m`, 16, 112);
  text(ctx, where, 16, 134, { size: 13, color: QUIET });
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

// 区間選択のページ分け：stations.json の各区間の page（0 から）。1 ページは 8 区間（2 列 × 4 段）まで。
// page がない区間は 8 区間ずつ自動で分ける。返り値はページごとの区間番号の配列
export function sectionPages(sections) {
  const pages = new Map();
  sections.forEach((s, i) => {
    const p = s.page ?? Math.floor(i / 8);
    if (!pages.has(p)) pages.set(p, []);
    pages.get(p).push(i);
  });
  return [...pages.keys()].sort((a, b) => a - b).map((p) => pages.get(p));
}
const GAP = 22; // 行と行のあいだ
const CELL_H = 48; // 2 列の升目 1 段の高さ（区間名＋注記）
const CELL_GAP = 8; // 升目どうしのすき間

const lineHeight = (item) => (Array.isArray(item) ? (item[1]?.size ?? 16) + GAP : item.cells ? CELL_H + CELL_GAP : item.height + GAP);

// 2 列の升目を 1 段描く。cells: [{ title, note, color, noteColor, selected, action }]（1〜2 個）
function drawCellRow(ctx, game, view, cells, y, k) {
  const h = CELL_H * k;
  const cw = Math.min(260, (view.w - 32 - CELL_GAP) / 2);
  cells.forEach((c, col) => {
    const cx = view.w / 2 + (col === 0 ? -1 : 1) * (cw + CELL_GAP) / 2;
    const x0 = cx - cw / 2;
    if (c.selected) {
      ctx.fillStyle = 'rgba(154, 205, 50, 0.14)';
      ctx.strokeStyle = YAMANOTE_GREEN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x0, y, cw, h, 8);
      ctx.fill();
      ctx.stroke();
    }
    const titleSize = 17 * k, noteSize = 12 * k;
    text(ctx, c.title, cx, y + h * 0.48, { size: titleSize, weight: c.selected ? 'bold' : 'normal', color: c.color, align: 'center', maxWidth: cw - 12 });
    if (c.note) text(ctx, c.note, cx, y + h * 0.84, { size: noteSize, color: c.noteColor, align: 'center', maxWidth: cw - 12 });
    if (c.action) game.hits.push({ y0: y, y1: y + h, x0, x1: x0 + cw, action: c.action });
  });
}

// 画面全体を暗くして、文字の行を中央に並べる。
// lines の要素は次のどちらか：
//   [文字列, 書式, タップしたときの動作（省略可）] … 1 行の文字
//   { cells: [...] } … 2 列の升目 1 段（drawCellRow）
//   { height, draw } … 高さ height の自由な描画。draw(y, h) に縮めたあとの位置と高さを渡す
// 動作のある行・升目は game.hits に登録する。
// 縦に収まらない（横向きのスマホなど）ときは、文字と行間をまとめて縮める。
function drawOverlay(ctx, game, view, lines) {
  ctx.fillStyle = 'rgba(15, 16, 20, 0.72)';
  ctx.fillRect(0, 0, view.w, view.h);
  const total = lines.reduce((sum, item) => sum + lineHeight(item), 0);
  const k = Math.min(1, (view.h - 32) / total);
  let y = (view.h - total * k) / 2;
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
    if (str) text(ctx, str, view.w / 2, baseline, { ...opts, size, align: 'center', maxWidth: view.w - 32 });
    if (action) game.hits.push({ y0: y, y1: y + lineH, action });
    y += lineH;
  }
}

const tapOrSpace = (game) => (game.touch ? 'タップ' : 'スペース / クリック');

function drawTitle(ctx, game, view) {
  drawOverlay(ctx, game, view, [
    ['山手線に勝て！', { size: 44, weight: 'bold', color: YAMANOTE_GREEN }],
    ['東京の本物の道を自転車で走り、山手線より先に次の駅へ', { size: 15, color: QUIET }],
    ['', { size: 8 }],
    [`${tapOrSpace(game)}ではじめる`, { size: 22, weight: 'bold' }, 'start'],
    [game.touch ? '遊び方' : '遊び方（H）', { size: 17, color: YAMANOTE_GREEN }, 'howto'],
    [game.mode === '3d' ? '2D版に切り替える' : '3D版で遊ぶ（試作）', { size: 15, color: QUIET }, 'switch'],
    ['', { size: 8 }],
    ...(game.droppedRecords
      ? [[`コースが変わった ${game.droppedRecords} 区間のベストとゴーストをリセットしました`, { size: 13, color: QUIET }]]
      : []),
    [`音：${game.muted ? 'オフ' : 'オン'}${game.touch ? '（右上のボタン）' : '（M キーで切り替え）'}`, { size: 13, color: QUIET }],
    ['地図データ © OpenStreetMap contributors（ODbL）', { size: 12, color: QUIET }],
    ['音楽・効果音：Web Audio による自作', { size: 12, color: QUIET }],
    ['JR東日本とは関係のない非公式のファンゲームです', { size: 12, color: QUIET }],
  ]);
}

function drawHowto(ctx, game, view) {
  const controls = game.touch
    ? '画面下のボタンで操作（左：ハンドル、右：ブレーキ／アクセル）'
    : `矢印キー / WASD で操作　R：やり直し　Esc：戻る　M：音　G：ゴースト${game.mode === '3d' ? '　C：視点' : ''}`;
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
    [controls, { size: 14, color: QUIET }],
    [`${tapOrSpace(game)}で戻る`, { size: 18, weight: 'bold' }, 'title'],
  ]);
}

function drawReady(ctx, game, view) {
  const pages = sectionPages(game.sections);
  const pageNo = pages.findIndex((p) => p.includes(game.sectionIndex));
  const pageCount = pages.length;
  const pageFirst = game.sections[pages[pageNo][0]];
  const pageLast = game.sections[pages[pageNo].at(-1)];
  const lines = [
    ['区間を選ぶ', { size: 28, weight: 'bold', color: YAMANOTE_GREEN }],
    [
      `${pageFirst.fromName} → ${pageLast.toName}${pageCount > 1 ? `（${pageNo + 1}/${pageCount}）` : ''}　${game.touch ? 'タップで選択' : '↑ ↓ で選択'}`,
      { size: 13, color: QUIET },
    ],
  ];
  // 区間の一覧を 2 列で。路線の順に、左の列を上から下へ、続きを右の列へ。
  // 選んでいる区間は緑の枠、まだ遊べない区間は暗く
  const cell = (s, i) => {
    const selected = i === game.sectionIndex;
    const unlocked = game.isUnlocked(i);
    const best = game.bests[s.id];
    // 未解放の区間のうち、前の区間に勝てばすぐ遊べるものはそう書く
    const lockedNote = i > 0 && game.isUnlocked(i - 1) ? '前の区間に勝つと解放' : '未解放';
    const note = !unlocked ? lockedNote : best != null ? `ベスト ${formatTime(best)}` : game.cleared.has(s.id) ? 'クリア済み' : '未クリア';
    return {
      title: `${s.fromName} → ${s.toName}`,
      note,
      color: !unlocked ? '#5f6570' : selected ? TEXT : '#c8ccd4',
      noteColor: best != null ? PLAYER_YELLOW : !unlocked ? (lockedNote === '未解放' ? '#5f6570' : '#b3953a') : QUIET,
      selected,
      action: `section:${i}`,
    };
  };
  // 選んでいる区間のページだけを出す
  const onPage = pages[pageNo];
  const rows = Math.ceil(onPage.length / 2);
  for (let r = 0; r < rows; r++) {
    const cells = [cell(game.sections[onPage[r]], onPage[r])];
    if (onPage[r + rows] != null) cells.push(cell(game.sections[onPage[r + rows]], onPage[r + rows]));
    lines.push({ cells });
  }
  if (pageCount > 1) {
    const pageCell = (dir, label) => {
      const target = pageNo + dir;
      const ok = target >= 0 && target < pageCount;
      const s = ok ? game.sections[pages[target][0]] : null;
      const e = ok ? game.sections[pages[target].at(-1)] : null;
      return {
        title: ok ? label : '',
        note: ok ? `${s.fromName} → ${e.toName}` : '',
        color: YAMANOTE_GREEN,
        noteColor: QUIET,
        selected: false,
        action: ok ? `page:${target}` : null,
      };
    };
    lines.push({ cells: [pageCell(-1, '◀ 前の区間'), pageCell(1, '次の区間 ▶')] });
  }

  const section = game.sections[game.sectionIndex];
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
  } else {
    lines.push([`電車より先に${section.toName}駅へ！ 制限時間 ${formatTime(game.train.limit)}`, { size: 15, color: QUIET }]);
    if (game.ghost) {
      const label = `ゴースト（ベスト ${formatTime(game.ghost.time)} の走り）：${game.showGhost ? '表示する' : '表示しない'}`;
      lines.push([game.touch ? label : `${label}（G）`, { size: 14, color: game.showGhost ? TEXT : QUIET }, 'ghost']);
    } else {
      lines.push(['ゴースト：勝つとベストの走りが記録されます', { size: 13, color: QUIET }]);
    }
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

function drawGo(ctx, game, view) {
  // スタート直後 0.8 秒だけ表示
  if (game.time > 0.8) return;
  ctx.globalAlpha = 1 - game.time / 0.8;
  text(ctx, 'GO!', view.w / 2, view.h / 2 - 40, { size: 96, weight: 'bold', color: YAMANOTE_GREEN, align: 'center' });
  ctx.globalAlpha = 1;
}

const km = (m) => `${(m / 1000).toFixed(2)} km`;

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

function drawResult(ctx, game, view) {
  const r = game.result;
  const lines = r.win
    ? [
        ['勝ち！', { size: 48, weight: 'bold', color: YAMANOTE_GREEN }],
        [`タイム ${formatTime(r.time)}　電車より ${(game.train.limit - r.time).toFixed(1)} 秒早く到着`, { size: 18 }],
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
  const s = r.stats;
  lines.push([`信号無視 ${s.red}回　車と衝突 ${s.car}回　歩行者と衝突 ${s.ped}回`, { size: 14, color: QUIET }]);
  lines.push({ height: Math.round(Math.max(110, Math.min(220, view.h * 0.3))), draw: (y, h) => drawRouteMap(ctx, game, view, y, h) });
  lines.push({ height: 14, draw: (y, h) => drawRouteLegend(ctx, game, view, y, h) });
  if (r.lapComplete) lines.push([`山手線1周達成！ 全${game.sections.length}区間クリア`, { size: 22, color: YAMANOTE_GREEN, weight: 'bold' }]);
  if (r.unlocked) lines.push([`新しい区間 ${r.unlocked.fromName} → ${r.unlocked.toName} が遊べるようになりました`, { size: 16, color: '#ffc93c', weight: 'bold' }]);
  if (r.next) {
    lines.push([`${tapOrSpace(game)}で次の区間へ（${r.next.fromName} → ${r.next.toName}）`, { size: 18, weight: 'bold' }, 'next']);
    lines.push([game.touch ? 'もう一度' : 'R もう一度', { size: 15, color: QUIET }, 'retry']);
  } else {
    lines.push([`${tapOrSpace(game)}でもう一度`, { size: 18, weight: 'bold' }, 'retry']);
  }
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
    avoid.push({ x0: 0, y0: 0, x1: view.w, y1: 84 }, { x0: mm.x - 4, y0: mm.y - 4, x1: mm.x + mm.size + 4, y1: mm.y + mm.size + 4 });
    // スマホのレース中は画面下の操作ボタン（高さ約 100px）の裏に隠れる
    if (game.touch) avoid.push({ x0: 0, y0: view.h - 104, x1: view.w, y1: view.h });
  }
  // メニュー画面では出さない（暗くした地図の上でも文字が読めてしまい、メニューの文字と紛れる）
  if (!menu && view.landmarks3d) drawLandmarks3D(ctx, game, view, avoid);
  else if (!menu && view.landmarks !== false) drawLandmarks(ctx, game, view, avoid);
  // メニュー画面ではレース情報を出さない
  if (!menu) {
    if (view.goal3d) drawGoalPointer3D(ctx, game, view);
    else if (view.goalPointer !== false) drawGoalPointer(ctx, game, view);
    drawRaceBar(ctx, game, view);
    drawStatus(ctx, game);
    drawMinimap(ctx, game, view);
  }
  if (game.state === 'racing') drawAlerts(ctx, game, view);

  if (game.state === 'title') drawTitle(ctx, game, view);
  else if (game.state === 'howto') drawHowto(ctx, game, view);
  else if (game.state === 'ready') drawReady(ctx, game, view);
  else if (game.state === 'countdown') drawCountdown(ctx, game, view);
  else if (game.state === 'racing') drawGo(ctx, game, view);
  else if (game.state === 'result') drawResult(ctx, game, view);

  // OpenStreetMap のクレジット（ODbL で表示が必要）
  text(ctx, '© OpenStreetMap contributors', view.w - 10, creditY, { size: 12, color: QUIET, align: 'right' });
  ctx.textAlign = 'left';
}
