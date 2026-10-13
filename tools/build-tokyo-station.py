# 東京駅丸の内駅舎を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-tokyo-station.py -- <保存先の .blend>
#
# 窓・白い石の帯・レンガは立体ではなく画像（テクスチャ）に描いて壁に貼る。夜に灯る窓は、明かりの画像
# （放射のテクスチャ）で光らせる。形と高さは元の細かいモデル（tokyo_station.blend）にならい、
# ドームの位置・大きさ・奥行きは OpenStreetMap の駅舎の部分（relation 4856157〜4856165）に合わせる：
#   ドーム：中心から ±98.6m、土台は幅 40m の八角形、上のドームは幅 22m（OSM の高さ 28m / 36m）
#   翼の奥行き 24m。全長は 292m（両端は ±146m）。実際の駅舎は約 335m だが、OSM の駅舎の部分は北端が 136m・
#   南端が 151m までで、両端のすぐ外を道路（丸の内室町線）が斜めに通るので、地図の道路と重ならない長さにする
# 座標（m）：X は駅舎の長手（左右対称）、Y は奥行き（正面の丸の内側が -Y）、Z は高さ。
# 原点は北と南のドームの中点（緯度 35.681367、経度 139.766054）。長手は北から 17.14° 傾く
# 書き出すものはコレクション「TS_Export」、下見用の地面・カメラ・光は「TS_Preview」。
# 保存先の隣に、下見の画像（tokyo_station_game_preview.png）も書き出す
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("tokyo_station_game.blend")
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "tokyo_station_game_textures")
os.makedirs(TEX_DIR, exist_ok=True)

# ---- 寸法（X は右半分。左半分は鏡に映して作る） ----
WING_Y = (-12.7, 11.3)  # 翼の奥行き
WING_H, WING_RIDGE = 17.8, 23.4  # 翼の壁の高さ、切妻屋根の棟の高さ
CENTER = dict(x=21.5, y=(-14.6, 12.6), h=20.8, apex=33.0, ridge=6.0)  # 中央棟（X = -21.5〜21.5）
PAVILIONS = [  # 寄棟屋根の塔屋（X0, X1, 壁の高さ, 頂点の高さ）
    (47.0, 63.0, 19.8, 27.8),  # 中央棟とドームのあいだ
    (129.0, 146.0, 19.3, 26.5),  # 端
]
PAV_Y = (-15.2, 12.6)
DOME = dict(x=98.6, y=0.0, r=20.0, h=22.0)  # ドームの土台（八角形。r は中心から辺までの距離）
# 土台の上の屋根の輪（高さ, 中心から角までの距離）：八角の屋根（OSM の高さ 28m の部分）→ 幅 22m のドーム
DOME_RINGS = [(22.0, 21.6), (27.5, 12.4), (30.0, 12.0), (33.0, 10.0), (35.0, 6.6), (36.2, 3.0)]
DOME_GOLD = 2  # 金の帯を巻く輪（DOME_RINGS の番号）
PORCH = dict(x=7.0, y=(-18.4, -14.6), h=7.4)  # 中央口の車寄せ（OSM の「車寄」）
BAY = 5.5  # 窓の間隔

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- テクスチャを描く（m 単位で描き、行 0 が下） ----
BRICK = np.array([0.62, 0.26, 0.19])
BRICK2 = np.array([0.55, 0.21, 0.15])
MORTAR = np.array([0.66, 0.6, 0.55])
STONE = np.array([0.86, 0.84, 0.78])
STONE_DARK = np.array([0.62, 0.6, 0.56])
GLASS = np.array([0.1, 0.12, 0.16])
LIGHT = np.array([1.0, 0.78, 0.5])  # 窓の灯り（夜）
rng = np.random.default_rng(7)


class Canvas:
    def __init__(self, w_m, h_m, px_w):
        self.ppm = px_w / w_m
        self.w, self.h = px_w, int(round(h_m * self.ppm))
        self.wm, self.hm = w_m, h_m
        self.col = np.zeros((self.h, self.w, 3))
        self.glow = np.zeros((self.h, self.w, 3))

    def px(self, x, z):
        return int(round(x * self.ppm)), int(round(z * self.ppm))

    def rect(self, x0, x1, z0, z1, color, glow=None):
        a, b = self.px(x0, z0)
        c, d = self.px(x1, z1)
        self.col[max(b, 0):max(d, 0), max(a, 0):max(c, 0)] = color
        if glow is not None:
            self.glow[max(b, 0):max(d, 0), max(a, 0):max(c, 0)] = glow

    def disc(self, cx, cz, r, color, glow=None, upper=False):
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        x, z = (xs + 0.5) / self.ppm, (ys + 0.5) / self.ppm
        m = (x - cx) ** 2 + (z - cz) ** 2 <= r * r
        if upper:
            m &= z >= cz
        self.col[m] = color
        if glow is not None:
            self.glow[m] = glow

    def bricks(self, z0, z1, bw=0.5, bh=0.15):
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        x, z = (xs + 0.5) / self.ppm, (ys + 0.5) / self.ppm
        row = np.floor(z / bh).astype(int)
        xx = x + (row % 2) * bw / 2
        col = np.floor(xx / bw).astype(int)
        t = ((row * 73 + col * 151) % 17) / 16.0
        c = BRICK[None, None] * (1 - t[..., None]) + BRICK2[None, None] * t[..., None]
        joint = ((xx % bw) < 1.2 / self.ppm) | ((z % bh) < 1.2 / self.ppm)
        c = np.where(joint[..., None], MORTAR, c)
        m = (z >= z0) & (z < z1)
        self.col[m] = c[m]

    def window(self, cx, z0, z1, w, arch=False, lit=None):
        lit = rng.uniform(0.35, 1.0) if lit is None else lit
        self.rect(cx - w / 2 - 0.2, cx + w / 2 + 0.2, z0 - 0.25, z1 + (0.2 if arch else 0.45), STONE)  # 石の枠と窓の上の飾り
        if arch:
            self.disc(cx, z1, w / 2 + 0.2, STONE, upper=True)
        self.rect(cx - w / 2, cx + w / 2, z0, z1, GLASS, LIGHT * lit)
        if arch:
            self.disc(cx, z1, w / 2, GLASS, LIGHT * lit, upper=True)
        self.rect(cx - 0.04, cx + 0.04, z0, z1, STONE_DARK)  # 縦の桟
        self.rect(cx - w / 2, cx + w / 2, z0 + (z1 - z0) * 0.62, z0 + (z1 - z0) * 0.62 + 0.08, STONE_DARK)

    def save(self, name):
        def write(arr, n):
            img = bpy.data.images.new(n, self.w, self.h, alpha=False)
            noise = rng.normal(0, 0.012, (self.h, self.w, 1)) if n == name else 0
            rgba = np.ones((self.h, self.w, 4), np.float32)
            rgba[..., :3] = np.clip(arr + noise, 0, 1)  # sRGB のまま書く
            img.pixels.foreach_set(rgba.ravel())
            img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
            img.file_format = 'PNG'
            img.save()
            return img
        return write(self.col, name), write(self.glow, name + "_glow")


def facade(name, h, floors, bands, cornice, plinth=1.2, bay=BAY, arch_floors=(), px_w=256):
    """1 間（窓 1 列）ぶんの壁。floors：窓の (下, 上)。bands：白い石の帯の (下, 上)"""
    c = Canvas(bay, h, px_w)
    c.bricks(0, h)
    c.rect(0, bay, 0, plinth, STONE)
    for z0, z1 in bands:
        c.rect(0, bay, z0, z1, STONE)
    c.rect(0, bay, h - cornice, h, STONE)
    c.rect(0, bay, h - cornice, h - cornice + 0.12, STONE_DARK)
    for k, (z0, z1) in enumerate(floors):
        c.window(bay / 2, z0, z1, 1.5 if k not in arch_floors else 2.0, arch=k in arch_floors)
    return c.save(name)


TEX = {
    # 翼：3 階建て（窓 3 段）
    "wing": facade("ts_wing", WING_H, [(1.8, 4.6), (7.0, 10.0), (12.4, 15.2)], [(5.8, 6.25), (11.2, 11.6)], 0.9),
    # 塔屋・中央棟：少し高く、帯を太く
    "pavilion": facade("ts_pavilion", 20.8, [(1.8, 4.6), (7.0, 10.0), (12.4, 15.4)], [(5.8, 6.4), (11.2, 11.8), (16.6, 17.1)], 1.4),
    # ドームの土台：1 階はアーチの大きな窓、上に 2 段と丸窓
    "drum": facade("ts_drum", DOME["h"], [(1.6, 6.0), (8.6, 12.2), (14.2, 17.4)], [(7.2, 7.8), (13.0, 13.5), (18.6, 19.2)], 1.6,
                   bay=6.0, arch_floors=(0,)),
}
# 車寄せの正面：アーチが 3 つ
c = Canvas(2 * PORCH["x"], PORCH["h"], 512)
c.rect(0, c.wm, 0, c.hm, STONE)
c.rect(0, c.wm, c.hm - 0.5, c.hm - 0.38, STONE_DARK)
sp = c.wm / 3.2  # アーチの間隔
for cx in (c.wm / 2 - sp, c.wm / 2, c.wm / 2 + sp):
    ro, ri = sp * 0.42, sp * 0.33  # 外の縁と、開口の半径
    c.rect(cx - ro, cx + ro, 0, 4.2, BRICK)
    c.disc(cx, 4.2, ro, BRICK, upper=True)
    c.rect(cx - ri, cx + ri, 0, 4.2, GLASS, LIGHT)
    c.disc(cx, 4.2, ri, GLASS, LIGHT, upper=True)
    c.rect(cx - 0.05, cx + 0.05, 0, 4.2 + ri, STONE_DARK)
TEX["porch"] = c.save("ts_porch")
# 屋根のスレート（1.8m 四方。端がつながる）
c = Canvas(1.8, 1.8, 128)
c.col[:] = [0.2, 0.22, 0.26]
for r in range(4):
    z0 = r * 0.45
    off = (r % 2) * 0.45
    for k in range(-1, 3):
        x0 = off + k * 0.9
        c.rect(x0 + 0.03, x0 + 0.87, z0 + 0.03, z0 + 0.45, [0.25, 0.27, 0.31] if (r + k) % 2 else [0.22, 0.24, 0.28])
TEX["slate"] = (c.save("ts_slate")[0], None)


def material(name, color=None, tex=None, rough=0.7, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex[0]
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if tex[1] is not None:  # 夜の窓の灯り
            g = nt.nodes.new("ShaderNodeTexImage")
            g.image = tex[1]
            nt.links.new(g.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = 1.0
    else:
        b.inputs["Base Color"].default_value = (*color, 1)
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


MAT = {
    "wing": material("TS_Wing", tex=TEX["wing"]),
    "pavilion": material("TS_Pavilion", tex=TEX["pavilion"]),
    "drum": material("TS_Drum", tex=TEX["drum"]),
    "porch": material("TS_Porch", tex=TEX["porch"]),
    "slate": material("TS_Slate", tex=TEX["slate"], rough=0.5),
    "stone": material("TS_Stone", (0.66, 0.63, 0.56)),
    "brick": material("TS_Brick", (0.36, 0.09, 0.05)),
    "gold": material("TS_Gold", (0.8, 0.6, 0.25), rough=0.3, metal=1.0, emit=(1.0, 0.75, 0.35), strength=1.2),
    "clock": material("TS_Clock", (0.02, 0.03, 0.05)),
}
MAT_ORDER = list(MAT)
MI = {k: i for i, k in enumerate(MAT_ORDER)}
export_col = bpy.data.collections.new("TS_Export")
preview_col = bpy.data.collections.new("TS_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)

bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def face(pts, mat, uvs=None, tile=2.0):
    """面を 1 枚。uvs がなければ、tile（m）ごとに繰り返す箱貼り"""
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = MI[mat]
    f.normal_update()
    if uvs is None:
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uvs = [((p[1], p[2]) if ax == 0 else (p[0], p[2]) if ax == 1 else (p[0], p[1])) for p in pts]
        uvs = [(u / tile, v / tile) for u, v in uvs]
    for l, uv in zip(f.loops, uvs):
        l[uvl].uv = uv
    return f


def wall(a, b, z0, z1, mat, tex_h, bay=BAY):
    """a → b（上から見て、外が左手）の壁。横は bay ごとに繰り返し、縦は tex_h（m）で画像 1 枚"""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / bay))  # 窓の数（端で切れないように、間隔を少し伸び縮みさせる）
    face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat,
         [(0, z0 / tex_h), (n, z0 / tex_h), (n, z1 / tex_h), (0, z1 / tex_h)])


def block(x0, x1, y0, y1, h, mat, tex_h):
    """箱の建物の 4 面の壁（上から見て反時計回り）"""
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(4):
        wall(pts[k], pts[(k + 1) % 4], 0, h, mat, tex_h)


def hip(x0, x1, y0, y1, z0, apex, ridge_half=0.0, over=0.5):
    """寄棟屋根（ridge_half：棟の半分の長さ。0 ならピラミッド）"""
    x0, x1, y0, y1 = x0 - over, x1 + over, y0 - over, y1 + over
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r0, r1 = (cx - ridge_half, cy, apex), (cx + ridge_half, cy, apex)
    face([(x0, y0, z0), (x1, y0, z0), r1, r0], "slate", tile=1.8)
    face([(x1, y1, z0), (x0, y1, z0), r0, r1], "slate", tile=1.8)
    face([(x1, y0, z0), (x1, y1, z0), r1], "slate", tile=1.8)
    face([(x0, y1, z0), (x0, y0, z0), r0], "slate", tile=1.8)
    # 軒の白い縁
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0 - 0.5), (b[0], b[1], z0 - 0.5), (b[0], b[1], z0), (a[0], a[1], z0)], "stone", tile=4)


def gable(x0, x1, y0, y1, z0, ridge, over=0.4):
    """切妻屋根（棟は X 方向）"""
    y0, y1 = y0 - over, y1 + over
    cy = (y0 + y1) / 2
    face([(x0, y0, z0), (x1, y0, z0), (x1, cy, ridge), (x0, cy, ridge)], "slate", tile=1.8)
    face([(x1, y1, z0), (x0, y1, z0), (x0, cy, ridge), (x1, cy, ridge)], "slate", tile=1.8)
    face([(x0, y1, z0), (x0, y0, z0), (x0, cy, ridge)], "brick")
    face([(x1, y0, z0), (x1, y1, z0), (x1, cy, ridge)], "brick")


def box(x0, x1, y0, y1, z0, z1, mat, tile=2.0, top=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat, tile=tile)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat, tile=tile)


def ring_pts(cx, cy, r, n=8, z=0.0, rot=math.pi / 8):
    """正 n 角形の頂点（r は中心から辺までの距離）"""
    R = r / math.cos(math.pi / n)
    return [(cx + R * math.cos(rot + 2 * math.pi * k / n), cy + R * math.sin(rot + 2 * math.pi * k / n), z) for k in range(n)]


def finial(x, y, z, h=2.2):
    """金色の飾り（玉と尖塔）"""
    s = 0.45
    face([(x - s, y, z), (x, y - s, z), (x, y, z + h)], "gold")
    face([(x, y - s, z), (x + s, y, z), (x, y, z + h)], "gold")
    face([(x + s, y, z), (x, y + s, z), (x, y, z + h)], "gold")
    face([(x, y + s, z), (x - s, y, z), (x, y, z + h)], "gold")


# ---- 右半分（あとで左に鏡写しする） ----
# 翼（中央棟〜塔屋〜ドーム〜端の塔屋のあいだをつなぐ）
wx = [CENTER["x"], PAVILIONS[0][0], PAVILIONS[0][1], PAVILIONS[1][0]]
for x0, x1 in [(wx[0], wx[1]), (wx[2], wx[3])]:
    wall((x0, WING_Y[0]), (x1, WING_Y[0]), 0, WING_H, "wing", WING_H)  # 正面
    wall((x1, WING_Y[1]), (x0, WING_Y[1]), 0, WING_H, "wing", WING_H)  # 裏（線路側）
    gable(x0, x1, *WING_Y, WING_H, WING_RIDGE)
# 塔屋
for x0, x1, h, apex in PAVILIONS:
    block(x0, x1, *PAV_Y, h, "pavilion", 20.8)
    hip(x0, x1, *PAV_Y, h, apex)
    finial((x0 + x1) / 2, (PAV_Y[0] + PAV_Y[1]) / 2, apex - 0.2)
    for qx in (x0, x1):  # 角の白い石（隅石）
        box(qx - 0.45, qx + 0.45, PAV_Y[0] - 0.15, PAV_Y[0] + 0.75, 0, h, "stone", top=False)
# ドーム：八角形の土台・屋根の輪・頂上の小さな塔
d = DOME
base = ring_pts(d["x"], d["y"], d["r"])
for k in range(8):
    a, b = base[k], base[(k + 1) % 8]
    wall(a, b, 0, d["h"], "drum", d["h"], bay=6.0)
rings = [ring_pts(d["x"], d["y"], r * math.cos(math.pi / 8), z=z) for z, r in DOME_RINGS]
for ra, rb in zip(rings[:-1], rings[1:]):
    for k in range(8):
        face([ra[k], ra[(k + 1) % 8], rb[(k + 1) % 8], rb[k]], "slate", tile=1.8)
top = DOME_RINGS[-1][0]
face(rings[-1], "slate", tile=1.8)
lantern = ring_pts(d["x"], d["y"], 2.2, z=top)
for k in range(8):
    a, b = lantern[k], lantern[(k + 1) % 8]
    wall(a, b, top, top + 2.8, "stone", 2.8, bay=1.0)
cap = ring_pts(d["x"], d["y"], 2.4, z=top + 2.8)
for k in range(8):
    face([cap[k], cap[(k + 1) % 8], (d["x"], d["y"], top + 4.2)], "slate", tile=1.8)
finial(d["x"], d["y"], top + 4.0, 2.4)
# ドームの金の帯（細い 8 角の輪）
z, r = DOME_RINGS[DOME_GOLD][0] + 0.2, DOME_RINGS[DOME_GOLD][1] * math.cos(math.pi / 8) - 0.02
gr0, gr1 = ring_pts(d["x"], d["y"], r, z=z), ring_pts(d["x"], d["y"], r, z=z + 0.35)
for k in range(8):
    face([gr0[k], gr0[(k + 1) % 8], gr1[(k + 1) % 8], gr1[k]], "gold")
# ドームの付け根の白い縁
e0, e1 = ring_pts(d["x"], d["y"], d["r"] + 0.4, z=d["h"] - 0.6), ring_pts(d["x"], d["y"], d["r"] + 0.4, z=d["h"])
for k in range(8):
    face([e0[k], e0[(k + 1) % 8], e1[(k + 1) % 8], e1[k]], "stone", tile=4)
    face([e1[k], e1[(k + 1) % 8], rings[0][(k + 1) % 8], rings[0][k]], "stone", tile=4)

# 中央棟（中心をまたぐので、鏡写しの前に半分だけ作る）
cx, (cy0, cy1), ch = CENTER["x"], CENTER["y"], CENTER["h"]
wall((0, cy0), (cx, cy0), 0, ch, "pavilion", 20.8)
wall((cx, cy0), (cx, cy1), 0, ch, "pavilion", 20.8)
wall((cx, cy1), (0, cy1), 0, ch, "pavilion", 20.8)
o = 0.6
face([(0, cy0 - o, ch), (cx + o, cy0 - o, ch), (CENTER["ridge"], (cy0 + cy1) / 2, CENTER["apex"]), (0, (cy0 + cy1) / 2, CENTER["apex"])], "slate", tile=1.8)
face([(cx + o, cy1 + o, ch), (0, cy1 + o, ch), (0, (cy0 + cy1) / 2, CENTER["apex"]), (CENTER["ridge"], (cy0 + cy1) / 2, CENTER["apex"])], "slate", tile=1.8)
face([(cx + o, cy0 - o, ch), (cx + o, cy1 + o, ch), (CENTER["ridge"], (cy0 + cy1) / 2, CENTER["apex"])], "slate", tile=1.8)
for a, b in [((0, cy0 - o), (cx + o, cy0 - o)), ((cx + o, cy0 - o), (cx + o, cy1 + o)), ((cx + o, cy1 + o), (0, cy1 + o))]:
    face([(a[0], a[1], ch - 0.6), (b[0], b[1], ch - 0.6), (b[0], b[1], ch), (a[0], a[1], ch)], "stone", tile=4)
box(cx - 0.5, cx + 0.5, cy0 - 0.2, cy0 + 0.8, 0, ch, "stone", top=False)  # 隅石
# 正面の三角の破風（時計の付いたペディメント）
py = cy0 - 0.6
face([(0, py, ch), (10.5, py, ch), (0, py, ch + 6.0)], "stone", tile=4)
face([(10.5, py, ch), (10.5, cy0, ch), (0, cy0, ch + 6.0), (0, py, ch + 6.0)], "slate", tile=1.8)
for k in range(6):  # 時計の文字盤（右半分。鏡写しで丸になる）
    t0, t1 = -math.pi / 2 + k * math.pi / 6, -math.pi / 2 + (k + 1) * math.pi / 6
    face([(0, py - 0.05, ch + 2.4), (1.25 * math.cos(t0), py - 0.05, ch + 2.4 + 1.25 * math.sin(t0)),
          (1.25 * math.cos(t1), py - 0.05, ch + 2.4 + 1.25 * math.sin(t1))][::-1], "clock")
# 中央の小さな塔（頂上）
lan = ring_pts(0, (cy0 + cy1) / 2, 2.0, z=CENTER["apex"] - 0.5)
for k in range(8):
    wall(lan[k], lan[(k + 1) % 8], CENTER["apex"] - 0.5, CENTER["apex"] + 2.0, "stone", 2.5, bay=1.0)
cap = ring_pts(0, (cy0 + cy1) / 2, 2.2, z=CENTER["apex"] + 2.0)
for k in range(8):
    face([cap[k], cap[(k + 1) % 8], (0, (cy0 + cy1) / 2, CENTER["apex"] + 4.4)], "slate", tile=1.8)
# 車寄せ：アーチの正面・側面・上の手すり
px, (py0, py1), ph = PORCH["x"], PORCH["y"], PORCH["h"]
face([(0, py0, 0), (px, py0, 0), (px, py0, ph), (0, py0, ph)], "porch", [(0.5, 0), (1, 0), (1, 1), (0.5, 1)])
face([(px, py0, 0), (px, py1, 0), (px, py1, ph), (px, py0, ph)], "stone", tile=4)
face([(0, py0, ph), (px, py0, ph), (px, py1, ph), (0, py1, ph)], "stone", tile=4)
box(0, px, py0, py0 + 0.3, ph, ph + 1.2, "stone", top=True)
box(px - 0.3, px, py0, py1, ph, ph + 1.2, "stone", top=True)
finial(px - 0.15, py0 + 0.15, ph + 1.2, 1.2)

# 右半分を左へ鏡写し（X = 0 の面は重ねてつなぐ）
geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
bmesh.ops.mirror(bm, geom=geom, axis='X', merge_dist=0.01)
# 鏡写しで UV も写るので、車寄せの正面の左半分は 0〜0.5 に直す
for f in bm.faces:
    if f.material_index == MI["porch"] and f.calc_center_median().x < 0:
        for l in f.loops:
            uv = l[uvl].uv
            if uv.x >= 0.5:
                l[uvl].uv = (1.0 - uv.x, uv.y)
me = bpy.data.meshes.new("TS_Station")
bm.to_mesh(me)
bm.free()
for k in MAT_ORDER:
    me.materials.append(MAT[k])
ob = bpy.data.objects.new("TS_Station", me)
export_col.objects.link(ob)
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=300)
gm = bpy.data.meshes.new("TS_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TS_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("TS_PreviewGround", gm))
sun = bpy.data.objects.new("TS_Sun", bpy.data.lights.new("TS_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TS_Camera", bpy.data.cameras.new("TS_Camera"))
cam.data.lens = 30
preview_col.objects.link(cam)
cam.location = (-70, -150, 35)
cam.rotation_euler = (mathutils.Vector((10, 0, 14)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TS_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
for img in bpy.data.images:  # 画像は .blend の中に入れる（別のフォルダが消えても開けるように）
    if img.filepath_raw.startswith(TEX_DIR):
        img.pack()
bpy.ops.wm.save_as_mainfile(filepath=out)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "tokyo_station_game_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f"BUILT {out} tris={tris} materials={[m.name for m in me.materials]}")
