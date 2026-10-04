// ゲームの仕組み：ゲームループと画面遷移（タイトル → 区間選択 → カウントダウン → レース → 結果）、
// 操作・保存・音・画面上の表示（HUD）。2D版と3D版で共通。
// 地図・自転車・電車など「世界」の描き方だけを renderer として受け取る（2D：render2d.js、3D：render3d.js）。
//
// renderer の形：
//   resize(w, h, dpr)   画面の大きさが変わったとき（CSS px と devicePixelRatio）
//   drawWorld(game, hudCtx)   世界を描く。hudCtx（HUD 用の 2D の描画先）を描ける状態にしておく
//   hud                 drawHud に渡す設定（ppm：1m あたりの CSS px、landmarks / goalPointer：出すか）
import { createInput, bindTouchButtons } from './input.js';
import * as audio from './audio.js';
import { createPlayer, updatePlayer, PLAYER_CONFIG } from './player.js';
import { createRecorder, record, finishRecording, parseGhost, ghostPose, trackLength } from './ghost.js';
import { loadMap, surfaceAt } from './map.js';
import { loadSections, createTrain, trainProgress, DIFFICULTIES } from './train.js';
import { createObstacles, updateObstacles, markInsideSignals } from './obstacles.js';
import { drawHud, sectionPages } from './hud.js';
import { trainPath, trainDistance, frontDistance } from './trainpath.js';

const STEP = 1 / 60; // 物理更新の間隔（固定）
const COUNTDOWN = 3; // 秒
const STORAGE_PREFIX = 'yamanote-race:';

// 路面ごとの速度上限 m/s
const SPEED_LIMIT = {
  road: PLAYER_CONFIG.maxSpeed,
  path: 6, // 歩道は歩行者がいるので控えめに
  ground: 3, // 道路外（空き地・広場など）
};
const WRONG_WAY_LIMIT = 4; // 一方通行を逆走しているときの速度上限 m/s

// ぶつかったときなどのペナルティ（その場で停止する秒数）
const PENALTY = {
  red: { stop: 5, text: '信号無視！ 5秒ストップ' },
  car: { stop: 2, text: '車にぶつかった！' },
  ped: { stop: 1, text: '歩行者にぶつかった！' },
};
const INVINCIBLE_AFTER_STOP = 1; // 停止明けに連続でぶつからないための猶予 秒

// HUD を描くキャンバス（2D版では世界も同じキャンバスに描く）。タップの判定もこのキャンバスで受ける
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let renderer = null;
const input = createInput();
const touchPanel = document.getElementById('touch');
const soundButton = document.getElementById('sound');
const quitButton = document.getElementById('quit');
bindTouchButtons(input, touchPanel);

const game = {
  state: 'loading', // loading | title | howto | ready（区間選択） | countdown | racing | result
  touch: window.matchMedia('(pointer: coarse)').matches, // タッチ操作の端末（画面ボタンを出す）
  muted: false,
  hits: [], // 画面上でタップできる行（hud.js が描くたびに登録する）
  sections: [], // stations.json の区間一覧
  sectionIndex: 0, // 選んでいる区間
  cleared: new Set(), // 一度でも勝った区間の id（次の区間が遊べるようになる）
  bests: {}, // 区間 id → 今の難易度でのベストタイム
  loadingMap: false,
  map: null, // 今の区間の地図（読み込み中は直前の区間のまま）
  section: null,
  train: null,
  difficulty: 1, // DIFFICULTIES の番号
  obstacles: null,
  seed: null, // 歩行者・車の乱数の種。null なら毎回変わる（テストでは固定する）
  player: createPlayer(),
  surface: { kind: 'road' },
  input,
  time: 0, // レース開始からの秒数
  countdown: 0,
  distance: 0, // ゴールまでの直線距離 m
  startDistance: 1,
  stopped: 0, // ペナルティで止まっている残り秒数
  invincible: 0,
  wrongWay: false,
  message: null, // { text, timer }
  stats: { red: 0, car: 0, ped: 0 },
  best: null,
  result: null,
  ghost: null, // 今の区間・難易度のベストの走り（ghost.js の形式）。なければ null
  ghostPose: null, // 今の時点のゴーストの位置（表示しないときは null）
  showGhost: true,
  recorder: null, // 今のレースの走りの記録
  paused: false,
};
window.game = game; // デバッグ・自動テスト用

// ブラウザへの保存。プライベートモードなどで使えなくても遊べるようにする
function load(key) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(value));
  } catch {
    // 保存できなくてもゲームは続ける
  }
}
function remove(key) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // 消せなくてもゲームは続ける
  }
}
const bestKey = (sectionId) => `best:${sectionId}:${DIFFICULTIES[game.difficulty].id}`;
const ghostKey = (sectionId) => `ghost:${sectionId}:${DIFFICULTIES[game.difficulty].id}`;

// コースが変わった区間の古い記録（ベストとゴースト）を消す。
// スタート・ゴールや道路データを作り直すと基準タイムを計り直すので、記録を作ったときの基準タイムを
// 一緒に保存しておき、今の基準タイムと違えば別のコースの記録とみなす（基準タイムを持たない記録も古いもの）。
// 勝って遊べるようになった区間（cleared）はそのまま残す。消した区間の数を返す
function dropStaleRecords() {
  let dropped = 0;
  for (const s of game.sections) {
    const course = String(s.parSeconds);
    if (load(`course:${s.id}`) === course) continue;
    const keys = DIFFICULTIES.flatMap((d) => [`best:${s.id}:${d.id}`, `ghost:${s.id}:${d.id}`]);
    if (keys.some((k) => load(k) != null)) dropped++;
    for (const k of keys) remove(k);
    save(`course:${s.id}`, course);
  }
  return dropped;
}
function loadGhost() {
  game.ghost = game.section ? parseGhost(load(ghostKey(game.section.id))) : null;
}
function loadBests() {
  game.bests = {};
  for (const s of game.sections) {
    const v = Number(load(bestKey(s.id)));
    game.bests[s.id] = v > 0 ? v : null;
  }
  game.best = game.section ? game.bests[game.section.id] : null;
}
function loadCleared() {
  try {
    game.cleared = new Set(JSON.parse(load('cleared') ?? '[]'));
  } catch {
    game.cleared = new Set();
  }
}

// 最初の区間と、前の区間に勝った区間が遊べる
const isUnlocked = (i) => i === 0 || game.cleared.has(game.sections[i - 1].id);
game.isUnlocked = isUnlocked;
// まだ勝っていない区間のうち、遊べる最初の区間（i より前で探す）。
// 未解放の区間を選んだとき、そこへ近づくために次に遊ぶ区間として案内する
function nextToPlay(i) {
  let j = i;
  while (j > 0 && !isUnlocked(j)) j--;
  return j;
}
game.nextToPlay = nextToPlay;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}

function distanceToGoal() {
  const g = game.map.goal;
  return Math.hypot(g.x - game.player.x, g.y - game.player.y);
}

function setDifficulty(i) {
  game.difficulty = (i + DIFFICULTIES.length) % DIFFICULTIES.length;
  if (game.section) game.train = createTrain(game.section, DIFFICULTIES[game.difficulty]);
  loadBests();
  loadGhost();
  save('difficulty', game.difficulty);
}

// 区間を選ぶ。遊べる区間なら地図を読み込んでスタート前の画面にする。
// 地図は一度読み込んだら覚えておく。
const mapCache = new Map();
async function selectSection(i) {
  i = Math.max(0, Math.min(game.sections.length - 1, i));
  game.sectionIndex = i;
  save('section', i);
  if (!isUnlocked(i)) return false;
  const section = game.sections[i];
  if (!mapCache.has(section.id)) {
    game.loadingMap = true;
    mapCache.set(section.id, loadMap(`data/${section.id}.json`));
  }
  let map;
  try {
    map = await mapCache.get(section.id);
  } catch (err) {
    mapCache.delete(section.id); // 次に選んだときに読み込み直す
    throw err;
  } finally {
    if (game.sectionIndex === i) game.loadingMap = false;
  }
  if (game.sectionIndex !== i) return false; // 読み込み中に別の区間が選ばれた
  game.section = section;
  game.map = map;
  // 地図の上を走る電車の道筋（地図ごとに一度だけ作る。線路がなければ null で、電車は描かない）
  if (map.trainRoute === undefined) map.trainRoute = trainPath(map, section.fromStation, section.toStation);
  game.train = createTrain(section, DIFFICULTIES[game.difficulty]);
  game.best = game.bests[section.id];
  loadGhost();
  reset();
  return true;
}
game.selectSection = selectSection;

// 選んでいる区間がまだ準備できていない（未解放・読み込み中・3D の街を作っている途中）ときは始められない
const worldReady = () => (renderer.progress?.(game.map) ?? null) === null;
const sectionReady = () =>
  isUnlocked(game.sectionIndex) && !game.loadingMap && game.section === game.sections[game.sectionIndex] && worldReady();

// 次の区間の地図を読み込み、3D の街を先に作っておく（結果画面のうちに。2D版では読み込むだけ）
function prefetchSection(i) {
  const section = game.sections[i];
  if (!section) return;
  if (!mapCache.has(section.id)) mapCache.set(section.id, loadMap(`data/${section.id}.json`));
  mapCache
    .get(section.id)
    .then((map) => renderer.prepare?.(map))
    .catch(() => mapCache.delete(section.id));
}

// スタート位置に戻してスタート前の画面にする
function reset() {
  const s = game.map.start;
  game.player = createPlayer(s.x, s.y, s.angle);
  game.surface = surfaceAt(game.map, s.x, s.y);
  game.obstacles = createObstacles(game.map, game.seed ?? Math.floor(Math.random() * 2 ** 31));
  markInsideSignals(game.obstacles, game.player);
  game.time = 0;
  game.result = null;
  game.stopped = 0;
  game.invincible = 0;
  game.wrongWay = false;
  game.message = null;
  game.stats = { red: 0, car: 0, ped: 0 };
  game.incidents = []; // 止まった場所（結果画面のルート地図に印を付ける）：{ type, x, y, stop }
  game.startDistance = distanceToGoal();
  game.distance = game.startDistance;
  game.recorder = createRecorder();
  game.state = 'ready';
  audio.stopBgm();
}

function startCountdown() {
  reset();
  game.countdown = COUNTDOWN;
  game.state = 'countdown';
  audio.departure(); // カウントダウンの間に発車メロディ
}

function finish(win) {
  const time = Math.round(game.time * 100) / 100;
  const next = game.sections[game.sectionIndex + 1];
  const r = { win, time, distance: game.distance, newBest: false, stats: { ...game.stats }, unlocked: null };
  // 結果画面で最速ルートと重ねて見せる、今回の走り（ghost.js の記録と同じ x, y, 向きの並び）
  r.track = game.recorder.samples;
  r.trackLength = trackLength(r.track);
  r.incidents = game.incidents;
  // ゴーストとの差（マイナスならゴーストより速い）。負けたときは比べない
  r.ghostDiff = win && game.ghost ? Math.round((time - game.ghost.time) * 10) / 10 : null;
  if (win && (game.best == null || time < game.best)) {
    game.best = time;
    game.bests[game.section.id] = time;
    r.newBest = true;
    save(bestKey(game.section.id), time);
    // ベストを更新した走りを次回のゴーストにする
    game.ghost = finishRecording(game.recorder, time);
    save(ghostKey(game.section.id), JSON.stringify(game.ghost));
  }
  if (win && !game.cleared.has(game.section.id)) {
    game.cleared.add(game.section.id);
    save('cleared', JSON.stringify([...game.cleared]));
    if (next) r.unlocked = next; // この勝利で新しく遊べるようになった区間
  }
  // 山手線は環状線なので、最後の区間（恵比寿→渋谷）の次は最初の区間（渋谷→原宿）
  const last = game.sectionIndex === game.sections.length - 1;
  r.next = win ? next ?? (last ? game.sections[0] : null) : null;
  // 最後の区間に勝ち、全区間をクリアしていれば 1 周達成
  r.lapComplete = win && last && game.sections.every((s) => game.cleared.has(s.id));
  game.result = r;
  game.state = 'result';
  if (r.next) prefetchSection(game.sections.indexOf(r.next));
  if (win) audio.win();
  else audio.lose();
}

function penalize(type) {
  const pen = PENALTY[type];
  game.stats[type]++;
  game.incidents.push({ type, x: game.player.x, y: game.player.y, stop: pen.stop });
  game.stopped = pen.stop;
  game.player.speed = 0;
  game.message = { text: pen.text, timer: Math.max(1.5, pen.stop) };
  audio.penalty(type);
}

// 一方通行の道を、矢印と逆向きに進んでいるか。
// 重なっている道路のうち 1 本でも正しく走れる道（両方向の道・順方向の一方通行・交差する道）があれば逆走ではない。
function isWrongWay() {
  const { segs } = game.surface;
  const p = game.player;
  if (!segs?.length || Math.abs(p.speed) < 1) return false;
  const s = Math.sign(p.speed);
  const hx = Math.sin(p.angle) * s, hy = -Math.cos(p.angle) * s;
  return segs.every((seg) => {
    if (!seg.road.o) return false;
    const dx = (seg.x2 - seg.x1) * seg.road.o, dy = (seg.y2 - seg.y1) * seg.road.o;
    const dot = (hx * dx + hy * dy) / (Math.hypot(dx, dy) || 1);
    return dot < -0.7; // 交差する道路（ほぼ直角）は逆走扱いしない
  });
}

function updatePhysics(dt) {
  const p = game.player;
  if (game.stopped > 0) {
    game.stopped -= dt;
    p.speed = 0;
    if (game.stopped <= 0) game.invincible = INVINCIBLE_AFTER_STOP;
    return;
  }
  game.invincible = Math.max(0, game.invincible - dt);

  const prevX = p.x, prevY = p.y;
  let limit = SPEED_LIMIT[game.surface.kind] ?? SPEED_LIMIT.ground;
  const wasWrongWay = game.wrongWay;
  game.wrongWay = isWrongWay();
  if (game.wrongWay) limit = Math.min(limit, WRONG_WAY_LIMIT);
  if (game.wrongWay && !wasWrongWay) audio.warn();
  updatePlayer(p, input, dt, limit);

  const next = surfaceAt(game.map, p.x, p.y);
  if (next.kind === 'building') {
    // 建物にぶつかったら元の位置に戻して軽く跳ね返す
    p.x = prevX;
    p.y = prevY;
    p.speed *= -0.2;
  } else {
    game.surface = next;
  }
  game.distance = distanceToGoal();
}

function update(dt) {
  if (!game.map) return;
  if (game.message && (game.message.timer -= dt) <= 0) game.message = null;

  if (game.state === 'countdown') {
    game.countdown -= dt;
    if (game.countdown <= 0) {
      game.state = 'racing';
      game.time = 0;
      audio.go();
      audio.startBgm();
    }
  } else if (game.state === 'racing') {
    updatePhysics(dt);
    game.time += dt;
    record(game.recorder, game.time, game.player);
    audio.setTension(game.train.limit - game.time < 20); // 残り 20 秒で音楽のテンポを上げる
  }

  updateTrainSound();

  const racing = game.state === 'racing';
  const events = updateObstacles(game.obstacles, game.map, game.player, dt, racing);
  if (racing && game.stopped <= 0) {
    // 信号無視は止まりたての猶予中でも判定する（猶予は衝突の連続判定を防ぐためのもの）
    const ev = events.find((e) => e.type === 'red') ?? (game.invincible > 0 ? null : events[0]);
    if (ev) penalize(ev.type);
  }

  if (racing) {
    if (game.distance <= game.map.goal.radius) finish(true);
    else if (game.time >= game.train.limit) finish(false);
  }
}

// 電車が近くを通ると音が鳴る（TRAIN_HEAR_M より遠いと聞こえない。トンネルの中はこもって小さく）
const TRAIN_HEAR_M = 160;
function updateTrainSound() {
  const route = game.map.trainRoute;
  if (!route || !game.train || game.state !== 'racing') {
    audio.trainSound(0, 0);
    return;
  }
  const progress = trainProgress(game.train, game.time);
  const { dist, under } = trainDistance(route, progress, game.player.x, game.player.y);
  const near = Math.max(0, 1 - dist / TRAIN_HEAR_M) ** 2;
  // 速さ m/s：0.1 秒後との位置の差から
  const speed = (frontDistance(route, trainProgress(game.train, game.time + 0.1)) - frontDistance(route, progress)) / 0.1;
  game.trainNear = near; // デバッグ・自動テスト用
  audio.trainSound(near * (under ? 0.4 : 1), speed);
}

// 自動テスト用：描画ループを待たずに指定秒数だけ時間を進める
game.step = (seconds, redraw = true) => {
  for (let t = 0; t < seconds; t += STEP) update(STEP);
  if (redraw) draw();
};
game.reset = reset;
game.start = startCountdown;
game.setDifficulty = setDifficulty;

function draw() {
  const dpr = window.devicePixelRatio || 1;
  // レースの間（カウントダウン〜結果）だけ電車とゴーストを出す
  game.inRace = game.state === 'countdown' || game.state === 'racing' || game.state === 'result';
  game.trainProgress = game.train ? trainProgress(game.train, game.time) : 0;
  game.ghostPose = game.showGhost && game.ghost && game.inRace ? ghostPose(game.ghost, game.time) : null;
  renderer.drawWorld(game, ctx);
  game.preparing = renderer.progress?.(game.map) ?? null; // 3D の街を作っている途中なら 0〜1
  if (!game.map) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHud(ctx, game, { w: canvas.width / dpr, h: canvas.height / dpr, ...renderer.hud });
  syncDom();
}


// 次の区間を読み込んで、そのままカウントダウンに入る（3D の街ができていなければ、できてから）
async function startNextSection() {
  if (await selectSection((game.sectionIndex + 1) % game.sections.length)) {
    if (sectionReady()) startCountdown();
    else game.startWhenReady = true;
  }
}

function goTitle() {
  reset(); // レースの途中なら片付ける
  game.state = 'title';
}

function setShowGhost(show) {
  game.showGhost = show;
  save('showGhost', show ? 1 : 0);
}

// 時間帯と天気（見た目と音だけ。記録には影響しない）
const TIMES_OF_DAY = ['day', 'evening', 'night'];
const WEATHERS = ['clear', 'rain', 'snow'];
function setAtmosphere(time, weather) {
  game.timeOfDay = TIMES_OF_DAY.includes(time) ? time : 'evening';
  game.weather = WEATHERS.includes(weather) ? weather : 'clear';
  renderer.setAtmosphere?.(game.timeOfDay, game.weather);
  audio.setRain(game.weather === 'rain');
  save('timeOfDay', game.timeOfDay);
  save('weather', game.weather);
}
const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length];

function setMuted(muted) {
  game.muted = muted;
  audio.setMuted(muted);
  save('muted', muted ? 1 : 0);
  soundButton.textContent = muted ? '音 OFF' : '音 ON';
}

// 画面の動作（キー・タップ共通）
function act(action, x = null) {
  const s = game.state;
  game.startWhenReady = false; // ほかの操作をしたら、自動で始めるのはやめる
  if (action === 'start') {
    if (s === 'title' || s === 'howto') game.state = 'ready';
    else if (s === 'ready' && sectionReady()) startCountdown();
    // 未解放の区間を選んでいるときは、次に遊ぶべき区間へ移る
    else if (s === 'ready' && !isUnlocked(game.sectionIndex)) selectSection(nextToPlay(game.sectionIndex));
  } else if (action === 'howto') {
    game.state = 'howto';
  } else if (action === 'time') {
    setAtmosphere(cycle(TIMES_OF_DAY, game.timeOfDay), game.weather);
  } else if (action === 'weather') {
    setAtmosphere(game.timeOfDay, cycle(WEATHERS, game.weather));
  } else if (action === 'switch') {
    // 2D版と3D版の切り替え（記録はブラウザに保存してあるので、どちらでも同じ）
    location.href = renderer.mode === '3d' ? 'index.html' : '3d.html';
  } else if (action === 'ghost') {
    setShowGhost(!game.showGhost);
  } else if (action === 'title') {
    goTitle();
  } else if (action === 'next') {
    startNextSection();
  } else if (action === 'retry') {
    if (sectionReady()) startCountdown();
  } else if (action === 'menu') {
    if (sectionReady()) reset();
  } else if (action === 'difficulty') {
    // 行の左半分をタップで前、右半分で次の難易度
    const w = canvas.clientWidth;
    setDifficulty(game.difficulty + (x != null && x < w / 2 ? -1 : 1));
  } else if (action.startsWith('page:')) {
    // ページを切り替えたら、そのページの最初の区間を選ぶ
    selectSection(sectionPages(game.sections)[Number(action.slice('page:'.length))][0]);
  } else if (action.startsWith('section:')) {
    const i = Number(action.slice('section:'.length));
    // 選んでいる区間をもう一度タップしたらスタート
    if (i === game.sectionIndex) act('start');
    else selectSection(i);
  }
  audio.select();
}

// スペース / Enter / タップ（行以外）：画面ごとの「次へ」
function onPrimary() {
  const s = game.state;
  if (s === 'title' || s === 'howto') act('start');
  else if (s === 'ready') act('start');
  else if (s === 'result') act(game.result.next ? 'next' : 'retry');
}

window.addEventListener('keydown', (e) => {
  audio.unlock(); // 音はユーザーの操作があってから鳴らせる
  if (game.state === 'loading') return;
  const s = game.state;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (!e.repeat) onPrimary();
  } else if (e.code === 'KeyM') {
    setMuted(!game.muted);
  } else if (e.code === 'KeyG') {
    setShowGhost(!game.showGhost);
  } else if (e.code === 'KeyT') {
    act('time');
  } else if (e.code === 'KeyY') {
    act('weather');
  } else if (e.code === 'KeyC' && renderer.nextCamera) {
    switchCamera();
  } else if (e.code === 'KeyH' && s === 'title') {
    act('howto');
  } else if (e.code === 'KeyR') {
    if (s !== 'title' && s !== 'howto') act('retry');
  } else if (e.code === 'Escape') {
    // 一段戻る：レース・結果 → 区間選択 → タイトル
    if (s === 'ready' || s === 'howto') act('title');
    else if (s !== 'title') act('menu');
  } else if (s === 'ready' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    setDifficulty(game.difficulty + (e.code === 'ArrowRight' ? 1 : -1));
    audio.select();
  } else if (s === 'ready' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
    selectSection(game.sectionIndex + (e.code === 'ArrowDown' ? 1 : -1));
    audio.select();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (e.pointerType === 'touch') game.touch = true;
  if (game.state === 'loading') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  // 升目（2 列の区間一覧）は横の範囲も見る。1 行の文字は横幅いっぱいが対象
  const hit = game.hits.find((h) => y >= h.y0 && y < h.y1 && (h.x0 == null || (x >= h.x0 && x < h.x1)));
  if (hit) act(hit.action, x);
  // 区間選択では、升目のすき間などを押し損ねてレースが始まらないよう、スタートの行でだけ始める
  else if (game.state !== 'ready') onPrimary();
});
// タッチ端末で操作ボタンを使ったときも、画面ボタン表示に切り替える
window.addEventListener('touchstart', () => (game.touch = true), { passive: true });

// 3D版の視点の切り替え（C キー・右上の「視点」ボタン）。切り替えたら名前を少しのあいだ出す
const cameraButton = document.getElementById('camera');
function switchCamera() {
  const name = renderer.nextCamera();
  game.message = { text: `視点：${name}`, timer: 1.5, info: true };
  if (cameraButton) cameraButton.textContent = `視点：${name}`;
}
cameraButton?.addEventListener('click', () => {
  audio.unlock();
  switchCamera();
});

soundButton.addEventListener('click', () => {
  audio.unlock();
  setMuted(!game.muted);
});
quitButton.addEventListener('click', () => act('menu'));

// レース中だけ画面ボタンと中止ボタンを出す（タッチ端末のみ）
let domState = '';
function syncDom() {
  const racing = game.state === 'countdown' || game.state === 'racing';
  const key = `${game.touch}:${racing}`;
  if (key === domState) return;
  domState = key;
  touchPanel.hidden = !(game.touch && racing);
  quitButton.hidden = !(game.touch && racing);
  if (touchPanel.hidden) for (const k of ['up', 'down', 'left', 'right']) input[k] = false;
}

let last = performance.now();
let acc = 0;
function frame(now) {
  // 次の区間の街ができるのを待っていたら、できしだいカウントダウン
  if (game.startWhenReady && game.state === 'ready' && sectionReady()) {
    game.startWhenReady = false;
    startCountdown();
  }
  // タブ切り替え後などの大きな飛びは 0.25 秒で打ち切る
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!game.paused) {
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
  } else {
    acc = 0;
  }
  draw();
  requestAnimationFrame(frame);
}

// ゲームを始める。renderer は世界の描き方（上の説明）
export async function startGame(r) {
  renderer = r;
  window.addEventListener('resize', resize);
  resize();
  setMuted(load('muted') === '1');
  setAtmosphere(load('timeOfDay'), load('weather'));
  game.showGhost = load('showGhost') !== '0';
  game.mode = renderer.mode ?? '2d';
  if (cameraButton && renderer.cameraName) cameraButton.textContent = `視点：${renderer.cameraName}`;
  game.sections = await loadSections();
  game.droppedRecords = dropStaleRecords();
  loadCleared();
  const savedDifficulty = Number(load('difficulty') ?? 1);
  setDifficulty(Number.isInteger(savedDifficulty) ? savedDifficulty : 1);
  // 前回選んでいた区間から。まだ遊べない区間なら最初の区間
  const savedSection = Number(load('section') ?? 0);
  const validSection = Number.isInteger(savedSection) && savedSection < game.sections.length && isUnlocked(savedSection);
  await selectSection(validSection ? savedSection : 0);
  game.state = 'title';
  requestAnimationFrame(frame);
}
