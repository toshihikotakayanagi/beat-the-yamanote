// ゴースト：ベストタイムの走りを記録し、次のレースで半透明の自転車として再生する。
// 記録は 0.1 秒ごとの位置と向き。200 秒の走りで数十 KB なので、ブラウザの保存領域に置ける。

const INTERVAL = 0.1; // 記録の間隔 秒
const FORMAT_VERSION = 1;

export function createRecorder() {
  return { samples: [], nextTime: 0 };
}

// レース中に毎フレーム呼ぶ。INTERVAL ごとに 1 点だけ記録する
export function record(rec, time, player) {
  while (time >= rec.nextTime) {
    rec.samples.push(
      Math.round(player.x * 10) / 10,
      Math.round(player.y * 10) / 10,
      Math.round(player.angle * 100) / 100,
    );
    rec.nextTime += INTERVAL;
  }
}

// 保存用のデータ（JSON にそのまま入れられる形）
export function finishRecording(rec, time) {
  return { v: FORMAT_VERSION, dt: INTERVAL, time, p: rec.samples };
}

// 読み込んだデータを確かめる。形が違えば null（古い形式や壊れたデータは使わない）
export function parseGhost(json) {
  try {
    const g = JSON.parse(json);
    if (g?.v !== FORMAT_VERSION || !Array.isArray(g.p) || g.p.length < 6 || !(g.dt > 0)) return null;
    return g;
  } catch {
    return null;
  }
}

// time 秒の時点のゴーストの位置。記録のあいだは直線でつなぐ。ゴール後は最後の位置にとどまる
export function ghostPose(ghost, time) {
  const n = ghost.p.length / 3;
  const f = Math.max(0, time / ghost.dt);
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const t = Math.min(1, f - i);
  const p = ghost.p;
  // 向きは -π と π の境目で回り込まないように差をとって補間する
  let da = p[3 * j + 2] - p[3 * i + 2];
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return {
    x: p[3 * i] + (p[3 * j] - p[3 * i]) * t,
    y: p[3 * i + 1] + (p[3 * j + 1] - p[3 * i + 1]) * t,
    angle: p[3 * i + 2] + da * t,
    finished: time >= ghost.time,
  };
}

// 記録した走りの長さ m（samples は x, y, 向きの並び）
export function trackLength(samples) {
  let len = 0;
  for (let i = 3; i + 1 < samples.length; i += 3) len += Math.hypot(samples[i] - samples[i - 3], samples[i + 1] - samples[i - 2]);
  return len;
}
