// 効果音と音楽。素材ファイルは使わず、すべて Web Audio でその場で合成する（権利の心配がない）。
// ブラウザは操作（キー・タップ）があるまで音を鳴らせないので、最初の操作で unlock() を呼ぶ。

let ctx = null;
let master = null;
let muted = false;
let bgm = null; // { timer, nextTime, step, tense }

const MASTER_VOLUME = 0.5;
const note = (semitonesFromA4) => 440 * 2 ** (semitonesFromA4 / 12);
// 音名 → A4 からの半音数（C5 = 3）
const N = { C4: -9, D4: -7, E4: -5, F4: -4, G4: -2, A4: 0, B4: 2, C5: 3, D5: 5, E5: 7, F5: 8, G5: 10, A5: 12, B5: 14, C6: 15, D6: 17, E6: 19 };

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    // タブを隠したら止め、戻ったら再開
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;
// デバッグ・自動テスト用：'none'（未作成）| 'suspended' | 'running'、音楽が流れているか
export const debugState = () => ({ context: ctx?.state ?? 'none', bgm: !!bgm, tense: !!bgm?.tense, trainVolume: rumble?.gain.gain.value ?? 0 });

const ready = () => ctx && ctx.state === 'running';

// 1 音。type は oscillator の波形、slideTo を指定すると音程を滑らせる
function tone(freq, start, dur, { type = 'triangle', vol = 0.3, attack = 0.01, slideTo = null } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

// ノイズ（ぶつかった音、ハイハット）
function noise(start, dur, { vol = 0.3, freq = 800, q = 1 } = {}) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(start);
}

// ベルのような音（発車メロディ用）：基音と 2 倍音・3 倍音を重ねる
function bell(freq, start, dur, vol = 0.18) {
  tone(freq, start, dur, { type: 'sine', vol, attack: 0.005 });
  tone(freq * 2, start, dur * 0.6, { type: 'sine', vol: vol * 0.35, attack: 0.005 });
  tone(freq * 3, start, dur * 0.3, { type: 'sine', vol: vol * 0.15, attack: 0.005 });
}

// 発車メロディ風のオリジナル曲（約 2.8 秒。カウントダウンの間に流れる）
export function departure() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.05;
  const beat = 0.18;
  const melody = [
    ['E5', 1], ['G5', 1], ['C6', 1], ['G5', 1], ['A5', 1], ['C6', 1], ['E6', 2],
    ['D6', 1], ['C6', 1], ['A5', 1], ['B5', 1], ['C6', 4],
  ];
  let at = t;
  for (const [n, len] of melody) {
    bell(note(N[n]), at, beat * len + 0.25);
    at += beat * len;
  }
  // 低音の支え
  tone(note(N.C4), t, beat * 8, { type: 'triangle', vol: 0.12 });
  tone(note(N.F4), t + beat * 8, beat * 4, { type: 'triangle', vol: 0.12 });
  tone(note(N.G4), t + beat * 12, beat * 4, { type: 'triangle', vol: 0.12 });
}

export function go() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(note(N.C6), t, 0.12, { type: 'square', vol: 0.12 });
  tone(note(N.G5) * 2, t + 0.1, 0.35, { type: 'square', vol: 0.12 });
}

export function penalty(type) {
  if (!ready()) return;
  const t = ctx.currentTime;
  if (type === 'red') {
    // ブザー（2 回）
    tone(220, t, 0.22, { type: 'square', vol: 0.15 });
    tone(220, t + 0.28, 0.22, { type: 'square', vol: 0.15 });
  } else if (type === 'car') {
    noise(t, 0.35, { vol: 0.6, freq: 300, q: 0.7 });
    tone(110, t, 0.3, { type: 'sawtooth', vol: 0.15, slideTo: 55 });
  } else {
    tone(700, t, 0.25, { type: 'sine', vol: 0.2, slideTo: 300 });
  }
}

export function warn() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(880, t, 0.08, { type: 'square', vol: 0.08 });
  tone(660, t + 0.1, 0.08, { type: 'square', vol: 0.08 });
}

export function win() {
  if (!ready()) return;
  stopBgm();
  const t = ctx.currentTime + 0.05;
  ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(note(N[n]), t + i * 0.11, 0.3, { type: 'square', vol: 0.1 }));
  for (const n of ['C5', 'E5', 'G5', 'C6']) tone(note(N[n]), t + 0.5, 0.9, { type: 'triangle', vol: 0.1 });
}

export function lose() {
  if (!ready()) return;
  stopBgm();
  const t = ctx.currentTime + 0.05;
  ['G4', 'E4', 'C4'].forEach((n, i) => tone(note(N[n]), t + i * 0.25, 0.35, { type: 'triangle', vol: 0.18 }));
  tone(note(N.C4) / 2, t + 0.75, 0.8, { type: 'triangle', vol: 0.15 });
}

export function select() {
  if (!ready()) return;
  tone(note(N.A5), ctx.currentTime, 0.06, { type: 'square', vol: 0.06 });
}

// 電車の走る音：低いうなり（ずっと鳴らして大きさだけ変える）と、レールの継ぎ目の「ガタン、ゴトン」。
// trainSound を毎フレーム呼ぶ。volume は 0〜1（近いほど大きい）、speed は電車の速さ m/s
// 継ぎ目の音の間隔 m。実物は 1 両（20m）ごとだが、ゲームの電車は制限時間に合わせて実物より遅い（約30km/h）ので、
// 間が空きすぎないよう短めにする
const JOINT_SPACING_M = 12;
let rumble = null; // { src, gain, filter }
let nextClick = 0;

function startRumble() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // 低い音が多いノイズ（ブラウンノイズ）
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  rumble = { src, gain, filter };
}

// レールの継ぎ目の音 1 回（低めの「コッ」）
function clack(start, vol) {
  noise(start, 0.06, { vol, freq: 350, q: 1.2 });
  tone(90, start, 0.08, { type: 'sine', vol: vol * 0.6 });
}

export function trainSound(volume, speed) {
  if (!ready()) return;
  if (!rumble) startRumble();
  const now = ctx.currentTime;
  const v = Math.max(0, Math.min(1, volume));
  // うなりは速いほど大きく、少し高く
  const speedK = Math.min(1, speed / 20);
  rumble.gain.gain.setTargetAtTime(v * (0.25 + 0.5 * speedK), now, 0.1);
  rumble.filter.frequency.setTargetAtTime(120 + 160 * speedK, now, 0.2);
  if (v < 0.02 || speed < 1) {
    nextClick = now;
    return;
  }
  // 継ぎ目を踏むたびに「ガタン、ゴトン」（前の車両の後ろの台車と、次の車両の前の台車）
  const interval = JOINT_SPACING_M / speed;
  const pair = Math.min(0.16, interval * 0.3);
  if (nextClick < now) nextClick = now + 0.02;
  while (nextClick < now + 0.15) {
    clack(nextClick, v * 0.5);
    clack(nextClick + pair, v * 0.4);
    nextClick += interval;
  }
}

// レース中の音楽：ベースとハイハットの 2 小節ループ。残り時間が少ないとテンポが上がる。
const BASS = ['C4', 'C4', 'G4', 'C4', 'A4', 'A4', 'E4', 'G4', 'F4', 'F4', 'C5', 'F4', 'G4', 'G4', 'D5', 'B4'];
const LEAD = { 0: 'E5', 4: 'G5', 6: 'A5', 8: 'C6', 12: 'B5', 14: 'G5' };

export function startBgm() {
  if (!ready() || bgm) return;
  bgm = { nextTime: ctx.currentTime + 0.1, step: 0, tense: false };
  bgm.timer = setInterval(scheduleBgm, 50);
}

export function stopBgm() {
  if (!bgm) return;
  clearInterval(bgm.timer);
  bgm = null;
}

export function setTension(tense) {
  if (bgm) bgm.tense = tense;
}

function scheduleBgm() {
  if (!bgm || !ready()) return;
  const stepDur = bgm.tense ? 0.13 : 0.18; // 16 分音符の長さ（秒）
  while (bgm.nextTime < ctx.currentTime + 0.25) {
    const i = bgm.step % BASS.length;
    const t = bgm.nextTime;
    tone(note(N[BASS[i]] - 12), t, stepDur * 0.9, { type: 'triangle', vol: 0.12 });
    noise(t, 0.04, { vol: i % 2 ? 0.05 : 0.09, freq: 7000, q: 0.5 });
    if (LEAD[i]) tone(note(N[LEAD[i]]), t, stepDur * 1.6, { type: 'square', vol: 0.035 });
    bgm.nextTime += stepDur;
    bgm.step++;
  }
}
