// 2D版の入口（index.html）。ゲームの仕組みは game.js、世界の描き方は render2d.js。
import { startGame } from './game.js';
import { createRenderer2D } from './render2d.js';

await startGame(createRenderer2D());
