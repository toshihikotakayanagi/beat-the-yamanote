// 2D版の世界の描き方：自転車を中心に、北が上の地図を真上から見る。
// HUD（メニュー・レースバー・ミニマップなど）は game.js が同じキャンバスの上に描く。
import { drawPlayer, GHOST_STYLE } from './player.js';
import { drawMap } from './map.js';
import { drawObstacles } from './obstacles.js';
import { drawTrain } from './trainpath.js';

const VIEW_METERS = 160; // 画面の短い辺に映す距離 m（画面サイズによらず見える範囲をそろえる）
const BACKGROUND = '#1b1d22';

export function createRenderer2D() {
  return {
    mode: '2d',
    hud: { ppm: 1, landmarks: true, goalPointer: true },

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
      drawObstacles(ctx, game.obstacles, view);
      // ライバルの電車：カウントダウン〜結果のあいだ、線路の上を走る（自転車やゴーストより下）
      if (game.inRace && game.map.trainRoute) drawTrain(ctx, game.map.trainRoute, game.trainProgress);
      // ゴーストは自転車の下に描く
      if (game.ghostPose) drawPlayer(ctx, game.ghostPose, GHOST_STYLE);
      drawPlayer(ctx, p);
    },
  };
}
