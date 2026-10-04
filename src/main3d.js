// 3D版の入口（3d.html）。ゲームの仕組みは game.js（2D版と共通）、世界の描き方は render3d.js。
import { startGame } from './game.js';
import { createRenderer3D } from './render3d.js';

await startGame(createRenderer3D(document.getElementById('view3d')));
