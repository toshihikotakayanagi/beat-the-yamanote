// 電車の進み方と制限時間。
//
// 実際の駅間所要時間（stations.json の trainSeconds、どの区間も約2分）をそのまま使うと、
// 最短ルートを全力で走っても間に合わない。また駅間の道のりは区間ごとに大きく違う
// （代々木→新宿は約0.9km、原宿→代々木は約1.7km）。
// そこで制限時間は「基準タイム（parSeconds）× 難易度の倍率」で決める。
// 基準タイムは、時間が最短のルート（歩道は速度上限が半分なので距離 2 倍として選ぶ）を
// 信号無視ありで走る自動運転の、乱数 5 通りでの中央値（ブラウザで計測）。
// 道を知らない人は距離最短ルートを選びがちで、渋谷→原宿なら約 30 秒、原宿→代々木（明治神宮を抜ける）なら約 45 秒遅くなる。
export const DIFFICULTIES = [
  { id: 'easy', name: 'かんたん', scale: 1.65 },
  { id: 'normal', name: 'ふつう', scale: 1.4 },
  { id: 'hard', name: 'むずかしい', scale: 1.15 }, // 速いルートを知っていて、信号運も必要
];

// 基準タイムを計測していない区間の仮の値（実際の所要時間の 1.4 倍）
const FALLBACK_PAR_SCALE = 1.4;

export async function loadSections() {
  const res = await fetch('data/stations.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('駅データを読み込めません');
  const { stations, sections } = await res.json();
  // fromStation / toStation：駅の緯度経度（地図の上を走る電車の出発・到着の位置に使う）
  return sections.map((s) => ({
    ...s,
    fromName: stations[s.from].name,
    toName: stations[s.to].name,
    fromStation: stations[s.from],
    toStation: stations[s.to],
  }));
}

export function createTrain(section, difficulty) {
  const par = section.parSeconds ?? section.trainSeconds * FALLBACK_PAR_SCALE;
  return { realSeconds: section.trainSeconds, limit: Math.round(par * difficulty.scale) };
}

// 加速・減速にかける時間の割合（制限時間のうち最初と最後のそれぞれ）。
// 実物の山手線は駅間約2分のうち、発車後と到着前の各20〜30秒ほどで加速・減速する
const ACCEL_SHARE = 0.2;

// 0（発車）〜 1（到着）。一定の加速で発車し、一定の速さで走り、一定の減速で止まる（台形の速度）。
// 到着はちょうど制限時間なので、勝ち負けは変わらない。上のバー・地図・ミニマップの電車はすべてこれで動く
export function trainProgress(train, time) {
  const t = Math.max(0, Math.min(1, time / train.limit));
  const f = ACCEL_SHARE;
  const vmax = 1 / (1 - f); // 全体で 1 進むための最高速度
  if (t < f) return (0.5 * vmax * t * t) / f;
  if (t > 1 - f) return 1 - (0.5 * vmax * (1 - t) ** 2) / f;
  return 0.5 * vmax * f + vmax * (t - f);
}

export function timeLeft(train, time) {
  return Math.max(0, train.limit - time);
}
