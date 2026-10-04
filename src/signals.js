// 信号機の見た目の置き方（2D版・3D版で共通）。信号の位置（地図データの signals。道路の点と同じ座標）を通る
// 道路から、道の向きと道幅を求める。見た目だけで、信号無視の判定（obstacles.js）には使わない。
import { nodeKey, surfaceAt } from './map.js';

const cache = new WeakMap(); // 地図 → Map（信号の位置 → 置き方）

// 信号 (x, y) の置き方：angle は道の向き（北が 0、時計回り）、hw は道幅の半分 m
export function signalPose(map, x, y) {
  let byMap = cache.get(map);
  if (!byMap) cache.set(map, (byMap = new Map()));
  const key = nodeKey(x, y);
  let pose = byMap.get(key);
  if (pose) return pose;
  // その点を通る道路（車道を優先）。なければ、その地点に重なる道路
  const at = (map.nodes.get(key) ?? []).slice().sort((a, b) => a.road.path - b.road.path);
  let x1, y1, x2, y2, w = 8;
  if (at.length) {
    const { road, v } = at[0];
    const u = Math.min(road.p.length / 2 - 1, v + 1), t = u === v ? v - 1 : v;
    [x1, y1, x2, y2] = [road.p[2 * t], road.p[2 * t + 1], road.p[2 * u], road.p[2 * u + 1]];
    if (u === v) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    w = road.w;
  } else {
    const seg = surfaceAt(map, x, y).seg;
    if (seg) ({ x1, y1, x2, y2 } = seg), (w = seg.road.w);
    else (x1 = x), (y1 = y), (x2 = x), (y2 = y - 1);
  }
  pose = { angle: Math.atan2(x2 - x1, -(y2 - y1)), hw: w / 2 };
  byMap.set(key, pose);
  return pose;
}

// 日本の信号の灯の色（点いているとき・消えているとき）。左から青・黄・赤
export const LAMPS = [
  { state: 'green', on: '#2bd9a6', off: '#123a32' },
  { state: 'yellow', on: '#ffc93c', off: '#3d3418' },
  { state: 'red', on: '#ff4d4d', off: '#3d1818' },
];
