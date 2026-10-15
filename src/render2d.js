// 2D版の世界の描き方：自転車を中心に、北が上の地図を真上から見る。
// HUD（メニュー・レースバー・ミニマップなど）は game.js が同じキャンバスの上に描く。
import { drawPlayer, GHOST_STYLE, PLAYER_STYLE } from './player.js';
import { bikeTypeOf } from './outfits.js';

// ゴーストの見た目（game.ghostLook）：白い半透明・光る水色・山手線の黄緑・自分と同じ色
const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
function ghostStyle(game) {
  const c = game.riderColors;
  switch (game.ghostLook) {
    case 'glow':
      return { ...GHOST_STYLE, body: '#6ad0ff', nose: '#bff0ff', tire: '#3a8ac8', alpha: 0.75 };
    case 'green':
      return { ...GHOST_STYLE, body: '#9acd32', nose: '#c8f080', tire: '#5a8a20', alpha: 0.6 };
    case 'mine':
      return c ? { ...GHOST_STYLE, body: hex(c.jersey), nose: hex(c.helmet), alpha: 0.5 } : GHOST_STYLE;
    default:
      return GHOST_STYLE;
  }
}
import { drawMap } from './map.js';
import { drawObstacles } from './obstacles.js';
import { drawTrain } from './trainpath.js';

const VIEW_METERS = 160; // 画面の短い辺に映す距離 m（画面サイズによらず見える範囲をそろえる）
const BACKGROUND = '#1b1d22';

export function createRenderer2D() {
  return {
    mode: '2d',
    hud: { ppm: 1, landmarks: true, goalPointer: true, tint: true }, // tint：時間帯で画面全体に色を重ねる（hud.js）

    resize(w, h) {
      this.hud.ppm = Math.min(w, h) / VIEW_METERS; // CSS ピクセル / m
    },

    // 世界は HUD と同じキャンバス（ctx）に描く
    drawWorld(game, ctx) {
      const canvas = ctx.canvas;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!game.map) return;

      // カメラは自転車を画面中央に置く
      const scale = this.hud.ppm * dpr;
      const p = game.player;
      ctx.setTransform(scale, 0, 0, scale, canvas.width / 2 - p.x * scale, canvas.height / 2 - p.y * scale);
      const halfW = canvas.width / 2 / scale;
      const halfH = canvas.height / 2 / scale;
      const view = { left: p.x - halfW, top: p.y - halfH, right: p.x + halfW, bottom: p.y + halfH };
      drawMap(ctx, game.map, view);
      drawObstacles(ctx, game.obstacles, view, { weather: game.weather, map: game.map });
      // ライバルの電車：カウントダウン〜結果のあいだ、線路の上を走る（自転車やゴーストより下）
      if (game.inRace && game.map.trainRoute) drawTrain(ctx, game.map.trainRoute, game.trainProgress);
      // ゴーストは自転車の下に描く
      if (game.ghostPose) drawPlayer(ctx, game.ghostPose, ghostStyle(game));
      // 選んだ服とヘルメットの色・自転車の種類（かご）で描く
      const c = game.riderColors;
      drawPlayer(ctx, p, c ? { ...PLAYER_STYLE, body: hex(c.jersey), nose: hex(c.helmet), basket: bikeTypeOf(game.bikeType).basket } : PLAYER_STYLE);
    },
  };
}
