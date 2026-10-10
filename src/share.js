// 結果のシェア：結果画面の内容を短い文にし、スマホなら共有メニュー、PC ならクリップボードへ。
import { formatTime } from './hud.js';
import { DIFFICULTIES } from './train.js';

const MEDAL_EMOJI = { gold: '🥇', silver: '🥈', bronze: '🥉' };

// 例：
//   山手線に勝て！ 渋谷→原宿（ふつう）
//   🥈 2:34.7 電車に 27.3 秒差で勝ち
//   信号無視・衝突なし
//   #山手線に勝て
export function shareText(game) {
  const r = game.result;
  const s = game.section;
  const conditions = [DIFFICULTIES[game.difficulty].name];
  if (game.effect) conditions.push(game.effect.name); // 天気の影響ありで雨・雪のとき（記録は別）
  const lines = [`山手線に勝て！ ${s.fromName}→${s.toName}（${conditions.join('・')}）`];
  if (r.win) {
    const medal = r.medal?.medal;
    lines.push(`${medal ? `${MEDAL_EMOJI[medal.id]} ` : ''}${formatTime(r.time)} 電車に ${(game.train.limit - r.time).toFixed(1)} 秒差で勝ち${r.newBest ? '（ベスト更新）' : ''}`);
  } else {
    lines.push(`🚃 電車に負けた… ゴールまであと ${r.distance.toFixed(0)} m`);
  }
  const st = r.stats;
  const stops = [st.red && `信号無視 ${st.red}回`, st.car && `車 ${st.car}回`, st.ped && `歩行者 ${st.ped}回`].filter(Boolean);
  lines.push(stops.length ? stops.join('・') : '信号無視・衝突なし');
  if (r.lapComplete) lines.push(`🎉 山手線1周達成！`);
  // 公開したページ（https）ならアドレスも付ける。手元のサーバー（http://localhost）のアドレスは他の人が開けない
  if (location.protocol === 'https:') lines.push(location.origin + location.pathname);
  lines.push('#山手線に勝て');
  return lines.join('\n');
}

// 共有メニュー（スマホなど navigator.share がある端末）か、クリップボードへのコピー。
// 結果は 'shared' | 'copied' | 'cancelled' | 'failed'。キーやタップの処理の中から呼ぶ（ブラウザはユーザー操作中しか許さない）
export async function share(text, { touch }) {
  // PC の共有メニューは使いにくいので、タッチ端末だけ共有メニューを使う
  if (touch && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // 共有できなければコピーに切り替える
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // 安全でない接続（https でない、localhost 以外）ではクリップボードの API が使えないので、古い方法で
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'copied' : 'failed';
  }
}
