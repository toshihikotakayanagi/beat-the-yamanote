// 区間の最速ルート（ゴール後の「自分のルートとの比較」と、基準タイムの計測ツールで使う）。
// 一方通行を守り、歩道は速度上限が半分なので距離 2 倍として、時間が最短になる道順を選ぶ。

const key = (x, y) => `${x},${y}`;

// 小さい順に取り出せる二分ヒープ（[コスト, 頂点] の組）
function pushHeap(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent][0] <= heap[i][0]) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}
function popHeap(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

// スタートからゴールまでの最速ルートの点列 [[x, y], ...]。つながっていなければ空の配列
export function fastestPath(map) {
  const adj = new Map();
  const pos = new Map();
  const add = (a, b, l) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push([b, l]);
  };
  for (const r of map.roads) {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const a = key(r.p[i], r.p[i + 1]), b = key(r.p[i + 2], r.p[i + 3]);
      pos.set(a, [r.p[i], r.p[i + 1]]);
      pos.set(b, [r.p[i + 2], r.p[i + 3]]);
      const l = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]) * (r.path ? 2 : 1);
      if (r.o !== -1) add(a, b, l);
      if (r.o !== 1) add(b, a, l);
    }
  }
  const s = key(map.start.x, map.start.y), g = key(map.goal.x, map.goal.y);
  const dist = new Map([[s, 0]]);
  const prev = new Map();
  const heap = [[0, s]];
  while (heap.length) {
    const [du, u] = popHeap(heap);
    if (u === g) break;
    if (du > dist.get(u)) continue;
    for (const [v, l] of adj.get(u) ?? []) {
      const nd = du + l;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        pushHeap(heap, [nd, v]);
      }
    }
  }
  if (!dist.has(g)) return [];
  const path = [];
  for (let c = g; c; c = prev.get(c)) path.unshift(pos.get(c));
  return path;
}

// 点列 [[x, y], ...] の長さ m
export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return len;
}

// 区間の最速ルートとその長さ（地図ごとに一度だけ計算する）
export function fastestRoute(map) {
  if (!map.fastest) {
    const path = fastestPath(map);
    map.fastest = { path, length: pathLength(path) };
  }
  return map.fastest;
}
