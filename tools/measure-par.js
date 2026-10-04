// 基準タイム（stations.json の parSeconds）を計る開発用ツール。ゲーム本体は読み込まない。
//
// 使い方（ゲームを開いたブラウザのコンソールで）:
//   const { measurePar } = await import('/tools/measure-par.js');
//   await measurePar('ueno-okachimachi');   // → 結果の文字列
//
// 時間が最短のルート（一方通行を守り、歩道は速度上限が半分なので距離 2 倍として選ぶ）を、
// 信号無視ありの自動運転で 5 回（歩行者・車の乱数を変えて）走り、所要時間の中央値を返す。
// あわせて、スタート・ゴールの路面と、駅の構内らしい名前の道を表示する（区間追加時の確認用）。
// 計測のために全区間を解放するので、終わったらページを読み込み直すこと（保存データは変えない）。
import { surfaceAt } from '../src/map.js';
import { fastestPath, pathLength } from '../src/route.js';

export { fastestPath };

const SEEDS = [1, 2, 3, 4, 5];
const SUSPICIOUS = /駅|番線|改札|ホーム|コンコース|連絡通路/;

// 経路の点に 3m まで近づいたら次の点へ。2 秒動けなければ 1 秒バックする（建物の角に引っかかったとき用）
export function drive(game, path) {
  const inp = game.input;
  let wi = 0, stuckFor = 0, reverseFor = 0;
  for (let t = 0; t < 600 && game.state === 'racing'; t += 1 / 60) {
    const p = game.player;
    while (wi < path.length - 1 && Math.hypot(path[wi][0] - p.x, path[wi][1] - p.y) < 3) wi++;
    const [tx, ty] = path[wi];
    let da = Math.atan2(tx - p.x, -(ty - p.y)) - p.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    stuckFor = game.stopped <= 0 && Math.abs(p.speed) < 0.5 ? stuckFor + 1 / 60 : 0;
    if (stuckFor > 2) (reverseFor = 1), (stuckFor = 0);
    if (reverseFor > 0) {
      reverseFor -= 1 / 60;
      Object.assign(inp, { up: false, down: true, left: da > 0, right: da < 0 });
    } else {
      Object.assign(inp, {
        left: da < -0.05,
        right: da > 0.05,
        up: Math.abs(da) < 0.6 || p.speed < 3,
        down: Math.abs(da) > 1.0 && p.speed > 4,
      });
    }
    game.step(1 / 60, false);
  }
  Object.assign(inp, { up: false, down: false, left: false, right: false });
  return game.result;
}

export async function measurePar(id) {
  const game = window.game;
  const index = game.sections.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`区間がありません: ${id}`);
  await fetch(`data/${id}.json`, { cache: 'reload' }); // 作り直したデータを確実に使う
  game.cleared = new Set(game.sections.map((s) => s.id)); // 計測のため全区間を解放（保存はしない）
  await game.selectSection(index);
  const map = game.map;
  const path = fastestPath(map);
  const len = pathLength(path);

  const times = [];
  for (const seed of SEEDS) {
    game.seed = seed;
    game.start();
    game.step(3.1, false); // カウントダウン
    game.train.limit = 9999; // 時間切れにしない
    const r = drive(game, path);
    times.push(r?.win ? r.time : Infinity);
  }
  game.seed = null;
  times.sort((a, b) => a - b);

  const at = (pt) => {
    const s = surfaceAt(map, pt.x, pt.y);
    return `${s.kind}・${s.road?.n ?? s.road?.t ?? ''}`;
  };
  const suspicious = [...new Set(map.roads.filter((r) => SUSPICIOUS.test(r.n ?? '')).map((r) => `${r.n}(${r.t})`))];
  const median = times[Math.floor(times.length / 2)];
  return (
    `${id}: 時間最短ルート ${Math.round(len)}m、中央値 ${median}秒（${times[0]}〜${times.at(-1)}）、` +
    `未到着 ${times.filter((t) => t === Infinity).length}回 ／ スタート=${at(map.start)} ゴール=${at(map.goal)} ／ ` +
    `駅らしい名前の道=${suspicious.slice(0, 8).join(' / ') || 'なし'}`
  );
}
