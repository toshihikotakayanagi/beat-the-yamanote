// 道路・建物の描画と当たり判定。
// 座標は区間中心を原点とするメートル（x は東、y は南が正）。

export const CELL = 25; // 空間インデックスのマス目 m
const ARROW_SPACING = 30; // 一方通行の矢印の間隔 m

// 道路は明るめ、建物は暗めにして、走れる所と壁をひと目で見分けられるようにする
const ROAD_COLOR = '#5f6572';
const PATH_COLOR = '#454b57'; // 歩道・小道
const ARROW_COLOR = '#959caa';
const BUILDING_FILL = '#25282f';
const BUILDING_STROKE = '#3a3f49';

// 背景（公園・水域・線路）の色。見た目だけで、走りやすさには関係しない。
// 描く順：緑の面 → 水の面 → 川 → 建物 → 線路 → 道路
export const AREA_COLORS = {
  park: '#25402d',
  grass: '#263d2c',
  wood: '#1f3b27',
  cemetery: '#2b3832',
  water: '#245a7d',
};
export const LINE_STYLES = {
  river: { color: AREA_COLORS.water, under: true },
  rail: { color: '#5c616b' },
  yamanote: { color: '#7fa82e' }, // 山手線（路線の黄緑を地図になじむよう暗く）
};

export const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
export const nodeKey = (x, y) => `${x},${y}`;

const isPath = (t) => t === 'footway' || t === 'path' || t === 'cycleway' || t === 'track' || t === 'pedestrian';

export async function loadMap(url) {
  // データを作り直したときに古いものが使われないよう、毎回サーバーに更新を確認する
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`地図データを読み込めません: ${url}`);
  return buildMap(await res.json());
}

export function buildMap(data) {
  const cells = new Map();
  const cellOf = (key) => {
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { segs: [], roads: [], buildings: [] }));
    return c;
  };
  // 四角い範囲にかかるマスすべてに登録する
  const addToCells = (minX, minY, maxX, maxY, fn) => {
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
      for (let j = Math.floor(minY / CELL); j <= Math.floor(maxY / CELL); j++) fn(cellOf(`${i},${j}`));
    }
  };

  const roads = data.roads.map((r, id) => ({ ...r, id, path: isPath(r.t), arrows: [] }));
  // 道路のつながり：頂点の座標 → その頂点を通る道路と頂点番号の一覧
  // （OSM では交差点で道路どうしが同じ点を共有している）
  const nodes = new Map();
  for (const r of roads) {
    for (let v = 0; v < r.p.length / 2; v++) {
      const key = nodeKey(r.p[2 * v], r.p[2 * v + 1]);
      let list = nodes.get(key);
      if (!list) nodes.set(key, (list = []));
      list.push({ road: r, v });
    }
  }

  for (const r of roads) {
    const hw = r.w / 2;
    let untilArrow = ARROW_SPACING / 2;
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      // v: 線分の始点の頂点番号
      const seg = { x1: r.p[k], y1: r.p[k + 1], x2: r.p[k + 2], y2: r.p[k + 3], hw, road: r, v: k / 2 };
      // 一方通行の矢印の位置（進行方向に向ける）
      if (r.o) {
        const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        const angle = Math.atan2((seg.x2 - seg.x1) * r.o, -(seg.y2 - seg.y1) * r.o);
        for (let d = untilArrow; d < len; d += ARROW_SPACING) {
          r.arrows.push([seg.x1 + ((seg.x2 - seg.x1) * d) / len, seg.y1 + ((seg.y2 - seg.y1) * d) / len, angle]);
          untilArrow = d + ARROW_SPACING;
        }
        untilArrow -= len;
      }
      addToCells(
        Math.min(seg.x1, seg.x2) - hw,
        Math.min(seg.y1, seg.y2) - hw,
        Math.max(seg.x1, seg.x2) + hw,
        Math.max(seg.y1, seg.y2) + hw,
        (c) => {
          c.segs.push(seg);
          if (c.roads.at(-1) !== r) c.roads.push(r);
        },
      );
    }
  }

  const buildings = data.buildings.map((p, id) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < p.length; k += 2) {
      minX = Math.min(minX, p[k]);
      maxX = Math.max(maxX, p[k]);
      minY = Math.min(minY, p[k + 1]);
      maxY = Math.max(maxY, p[k + 1]);
    }
    return { id, p, minX, minY, maxX, maxY };
  });
  for (const b of buildings) addToCells(b.minX, b.minY, b.maxX, b.maxY, (c) => c.buildings.push(b));

  // 背景の面と線は数が少ないので、外枠だけ持って画面に入るかを毎回調べる。形は Path2D にしておく
  const bbox = (rings) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of rings) {
      for (let k = 0; k < p.length; k += 2) {
        minX = Math.min(minX, p[k]), maxX = Math.max(maxX, p[k]);
        minY = Math.min(minY, p[k + 1]), maxY = Math.max(maxY, p[k + 1]);
      }
    }
    return { minX, minY, maxX, maxY };
  };
  const toPath = (rings, close) => {
    const path = new Path2D();
    for (const p of rings) {
      path.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) path.lineTo(p[k], p[k + 1]);
      if (close) path.closePath();
    }
    return path;
  };
  // 緑の面を先に、水の面を後に（公園の中の池が見えるように）
  const areas = (data.areas ?? [])
    .map((a) => ({ ...a, ...bbox(a.r), path: toPath(a.r, true) }))
    .sort((a, b) => (a.k === 'water') - (b.k === 'water'));
  const lines = (data.lines ?? []).map((l) => ({ ...l, ...bbox([l.p]), path: toPath([l.p], false) }));

  return { ...data, roads, buildings, areas, lines, cells, nodes, stamp: 0 };
}

function distToSegment(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

function insidePolygon(px, py, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// その地点の路面を調べる。道路の上なら建物と重なっていても走れる
// （駅ビルの下をくぐる道や、建物データと道路のずれを考慮）。
// seg は今いる道路の線分、segs はその地点に重なっている道路の線分すべて
// （上り・下りが別々の一方通行として並んでいる道では、道幅が重なることがある）。
// 車道を歩道より優先し、そのうえで中心線がいちばん近い線分を seg とする。
export function surfaceAt(map, x, y) {
  const cell = map.cells.get(cellKey(x, y));
  if (!cell) return { kind: 'ground' };
  let seg = null;
  let best = Infinity;
  const segs = [];
  for (const s of cell.segs) {
    const d = distToSegment(x, y, s);
    if (d > s.hw) continue;
    segs.push(s);
    const score = d + (s.road.path ? 1000 : 0);
    if (score < best) (best = score), (seg = s);
  }
  if (seg) return { kind: seg.road.path ? 'path' : 'road', road: seg.road, seg, segs };
  for (const b of cell.buildings) {
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && insidePolygon(x, y, b.p)) {
      return { kind: 'building' };
    }
  }
  return { kind: 'ground' };
}

function strokeRoads(ctx, roads, wantPath, color) {
  ctx.strokeStyle = color;
  for (const r of roads) {
    if (r.path !== wantPath) continue;
    ctx.lineWidth = r.w;
    ctx.beginPath();
    ctx.moveTo(r.p[0], r.p[1]);
    for (let k = 2; k < r.p.length; k += 2) ctx.lineTo(r.p[k], r.p[k + 1]);
    ctx.stroke();
  }
}

// 公園・水域の面（穴のある面もあるので偶奇規則で塗る）。ミニマップの下描きでも使う
export function drawAreas(ctx, areas) {
  for (const a of areas) {
    ctx.fillStyle = AREA_COLORS[a.k] ?? AREA_COLORS.grass;
    ctx.fill(a.path, 'evenodd');
  }
}

// 川（under: true、建物の下）と線路（建物の上・道路の下）。widthScale で太さを変えられる
export function drawLines(ctx, lines, under, widthScale = 1) {
  for (const l of lines) {
    const style = LINE_STYLES[l.k] ?? LINE_STYLES.rail;
    if (Boolean(style.under) !== under || l.u) continue; // u：トンネル（電車の道筋にだけ使う）
    ctx.strokeStyle = style.color;
    ctx.lineWidth = l.w * widthScale;
    ctx.stroke(l.path);
  }
}

// view: 画面に映る範囲 { left, top, right, bottom }（メートル）
export function drawMap(ctx, map, view) {
  // 画面内のマスから、重複なしで道路と建物を集める
  const stamp = ++map.stamp;
  const roads = [];
  const buildings = [];
  for (let i = Math.floor(view.left / CELL); i <= Math.floor(view.right / CELL); i++) {
    for (let j = Math.floor(view.top / CELL); j <= Math.floor(view.bottom / CELL); j++) {
      const c = map.cells.get(`${i},${j}`);
      if (!c) continue;
      for (const r of c.roads) if (r.seen !== stamp) (r.seen = stamp), roads.push(r);
      for (const b of c.buildings) if (b.seen !== stamp) (b.seen = stamp), buildings.push(b);
    }
  }

  const visible = (o) => o.maxX >= view.left && o.minX <= view.right && o.maxY >= view.top && o.minY <= view.bottom;
  drawAreas(ctx, map.areas.filter(visible));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lines = map.lines.filter(visible);
  drawLines(ctx, lines, true);

  ctx.fillStyle = BUILDING_FILL;
  ctx.strokeStyle = BUILDING_STROKE;
  ctx.lineWidth = 0.4;
  for (const b of buildings) {
    ctx.beginPath();
    ctx.moveTo(b.p[0], b.p[1]);
    for (let k = 2; k < b.p.length; k += 2) ctx.lineTo(b.p[k], b.p[k + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawLines(ctx, lines, false);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeRoads(ctx, roads, true, PATH_COLOR);
  strokeRoads(ctx, roads, false, ROAD_COLOR);

  // 一方通行の矢印
  ctx.fillStyle = ARROW_COLOR;
  for (const r of roads) {
    for (const [x, y, angle] of r.arrows) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -2.2);
      ctx.lineTo(1.6, 1.4);
      ctx.lineTo(0, 0.6);
      ctx.lineTo(-1.6, 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ゴール
  const g = map.goal;
  ctx.fillStyle = 'rgba(80, 200, 120, 0.25)';
  ctx.strokeStyle = '#50c878';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
