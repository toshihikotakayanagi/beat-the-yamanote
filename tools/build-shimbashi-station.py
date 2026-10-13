# 新橋駅（赤レンガの高架橋の上の駅と、西口の SL 広場の蒸気機関車 C11 292）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-shimbashi-station.py -- <保存先の .blend>
#
# ・高架の下：tools/build-kanda-station.py と同じく、高架の両側に赤レンガのアーチが並ぶ壁（高さは床板の下面 4.9m）と
#   改札口の看板。高架の下を横切る道路（南の烏森通り X ≦ -93、北の外堀通り X ≧ 99）のあいだだけに置き、改札口は壁をあける。
#   ゲームの地図では駅（way 181032491）が高架全体を覆う高い箱になっていたので、それは描かない（ゲーム側の clear）
# ・SL 広場の C11 292：OpenStreetMap の位置と向き（way 1434671683）に、実物の大きさ（長さ約 12.65m）で置く。
#   C11 はタンク機関車（炭水車がない）：先輪 1 軸・動輪 3 軸・従輪 2 軸、ボイラーの両わきに水タンク、後ろに石炭庫
# 位置は OpenStreetMap のホーム（way 128199235 / 7 / 8）と改札口（train_station_entrance）に合わせた。
# 赤レンガのアーチと機関車の形は、写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北西が +。方位 -5.3°）、Y は西（日比谷・SL 広場側）が +（正面は東の汐留側 -Y）、Z は高さ。
# 原点は 3 本のホームの中心（緯度 35.666506、経度 139.758171）。
# 書き出すものはコレクション「SH_Export」、下見用の地面・カメラ・光は「SH_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("shimbashi_station.blend")

# ---- 寸法 ----
H = 4.9  # 壁の高さ（高架の床板の下面）
BAY = 6.0  # アーチ 1 つぶんの幅
# 壁の折れ線（X, Y）：東は北へ向かって（外から見て左から右）、西は南へ向かって
EAST_WALL = [(-90.0, -38.0), (-80.0, -38.2), (-40.0, -39.2), (0.0, -37.2), (40.0, -35.2), (80.0, -33.2), (97.0, -33.0)]
WEST_WALL = [(97.0, 21.6), (80.0, 23.2), (40.0, 26.2), (0.0, 26.2), (-40.0, 23.2), (-80.0, 19.2), (-90.0, 18.4)]
GAPS = {"east": [(-80.0, -70.0), (10.0, 20.0), (67.0, 78.0)],  # 汐留口（南）・汐留口・銀座口
        "west": [(-73.0, -63.0), (62.0, 74.0)]}  # 烏森口・日比谷口（SL 広場）
# 看板（壁, X の中心, 本文）
SIGNS = [("east", -75.0, "新橋駅　汐留口"), ("east", 15.0, "新橋駅　汐留口"), ("east", 72.5, "新橋駅　銀座口"),
         ("west", -68.0, "新橋駅　烏森口"), ("west", 68.0, "新橋駅　日比谷口")]
# SL 広場の C11 292（OSM の形の中心と、長手の向き）
SL = dict(x=71.9, y=64.1, angle=math.degrees(math.atan2(61.3 - 65.1, 75.2 - 67.9)))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "shimbashi_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(71)

BRICK = np.array([0.62, 0.26, 0.19])
BRICK2 = np.array([0.53, 0.2, 0.14])
MORTAR = np.array([0.66, 0.6, 0.55])
STONE = np.array([0.82, 0.8, 0.74])
GLASS = np.array([0.12, 0.14, 0.17])
FRAME = np.array([0.25, 0.25, 0.26])
LIGHT = np.array([1.0, 0.8, 0.52])


def arch_texture(name, px=192):
    """アーチ 1 つぶん（6m × 4.9m）：赤レンガの柱と、アーチの中の店先のガラス（夜は灯る）"""
    ppm = px / BAY
    Hp = int(round(H * ppm))
    ys, xs = np.mgrid[0:Hp, 0:px]
    x, z = (xs + 0.5) / ppm, (ys + 0.5) / ppm
    # レンガ（1 段ごとに半分ずらす）
    bw, bh = 0.5, 0.15
    row = np.floor(z / bh).astype(int)
    xx = x + (row % 2) * bw / 2
    t = ((row * 73 + np.floor(xx / bw).astype(int) * 151) % 17)[..., None] / 16.0
    col = BRICK * (1 - t) + BRICK2 * t
    joint = ((xx % bw) < 1.2 / ppm) | ((z % bh) < 1.2 / ppm)
    col = np.where(joint[..., None], MORTAR, col)
    glow = np.zeros_like(col)
    # アーチの開口：幅 3.6m、2.6m から上は半円
    cx, r, spring = BAY / 2, 1.8, 2.6
    inside = (np.abs(x - cx) <= r) & ((z <= spring) | ((x - cx) ** 2 + (z - spring) ** 2 <= r * r))
    rim = (np.abs(x - cx) <= r + 0.25) & ((z <= spring) | ((x - cx) ** 2 + (z - spring) ** 2 <= (r + 0.25) ** 2)) & ~inside
    col = np.where(rim[..., None], STONE * 0.9, col)  # アーチの縁の石
    lit = rng.uniform(0.5, 1.0)
    col = np.where(inside[..., None], GLASS, col)
    glow = np.where(inside[..., None], LIGHT * lit, glow)
    for fx in (cx - 0.04, cx + 0.04):  # 店先の桟
        m = inside & (np.abs(x - fx) < 0.04)
        col[m] = FRAME
    m = inside & (np.abs(z - 2.3) < 0.05)
    col[m] = FRAME
    key = (np.abs(x - cx) < 0.25) & (z > spring + r - 0.1) & (z < spring + r + 0.35)  # 要石
    col[key] = STONE
    col[(z > H - 0.35)] = STONE  # 上の石の帯
    col[(z < 0.3)] = STONE * 0.8  # 足元
    imgs = []
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, px, Hp, alpha=False)
        rgba = np.ones((Hp, px, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.015, (Hp, px, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


TEX = {"arch": arch_texture("sh_arch")}


def material(name, color=None, tex=None, rough=0.7, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex[0]
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
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
    "arch": material("SH_Arch", tex=TEX["arch"]),
    "brick": material("SH_Brick", (0.36, 0.1, 0.06)),
    "stone": material("SH_Stone", (0.62, 0.6, 0.55)),
    "signboard": material("SH_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("SH_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
    "sl_black": material("SH_SLBlack", (0.025, 0.025, 0.028), rough=0.35),  # 機関車の黒
    "sl_red": material("SH_SLRed", (0.55, 0.04, 0.03), rough=0.5),  # 緩衝梁・動輪の中心
    "sl_metal": material("SH_SLMetal", (0.55, 0.56, 0.58), rough=0.3),  # 連結棒
    "sl_glass": material("SH_SLGlass", (0.08, 0.1, 0.12), rough=0.1, emit=(1.0, 0.85, 0.6), strength=0.6),  # 運転台の窓
    "sl_lamp": material("SH_SLLamp", (0.9, 0.9, 0.85), emit=(1.0, 0.95, 0.8), strength=1.5),  # 前照灯
    "base": material("SH_Base", (0.45, 0.44, 0.42)),  # 展示の台
    "rail": material("SH_Rail", (0.4, 0.38, 0.36), rough=0.4),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SH_Export")
preview_col = bpy.data.collections.new("SH_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def face(pts, mat, uvs=None, tile=2.0):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = MI[mat]
    if uvs is None:
        f.normal_update()
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uvs = [((p[1], p[2]) if ax == 0 else (p[0], p[2]) if ax == 1 else (p[0], p[1])) for p in pts]
        uvs = [(u / tile, v / tile) for u, v in uvs]
    for l, uv in zip(f.loops, uvs):
        l[uvl].uv = uv
    return f


def y_at(line, x):
    for (xa, ya), (xb, yb) in zip(line[:-1], line[1:]):
        lo, hi = min(xa, xb), max(xa, xb)
        if lo <= x <= hi:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    raise ValueError(x)


def wall(line, gaps):
    """折れ線に沿ってアーチの壁を立てる。gaps の X の範囲はあけ、開口の両わきに厚みを付ける"""
    xs = sorted({line[0][0], line[-1][0]} | {x for g in gaps for x in g} | {p[0] for p in line})
    rev = line[0][0] > line[-1][0]  # 西の壁は X の大きい方から（外から見て左から右）
    pieces = list(zip(xs[:-1], xs[1:]))
    u = 0.0
    for xa, xb in (reversed(pieces) if rev else pieces):
        if any(g0 <= (xa + xb) / 2 <= g1 for g0, g1 in gaps):
            for xg in (xa, xb):  # 開口のわきの厚み（レンガ）
                y = y_at(line, xg)
                d = 1.2 if y > 0 else -1.2
                face([(xg, y, 0), (xg, y - d, 0), (xg, y - d, H), (xg, y, H)], "brick")
            continue
        a, b = (xb, xa) if rev else (xa, xb)
        ya, yb = y_at(line, a), y_at(line, b)
        L = math.hypot(b - a, yb - ya)
        face([(a, ya, 0), (b, yb, 0), (b, yb, H), (a, ya, H)], "arch", [(u, 0), (u + L / BAY, 0), (u + L / BAY, 1), (u, 1)])
        u += L / BAY
        # 上の石の帯を少し張り出す
        d = 0.25 if ya > 0 else -0.25
        face([(a, ya + d, H - 0.35), (b, yb + d, H - 0.35), (b, yb + d, H), (a, ya + d, H)], "stone")


wall(EAST_WALL, GAPS["east"])
wall(WEST_WALL, GAPS["west"])
# 両端の小口（壁の端の厚み）
for line in (EAST_WALL, WEST_WALL):
    for x, y in (line[0], line[-1]):
        d = 1.2 if y > 0 else -1.2
        face([(x, y, 0), (x, y - d, 0), (x, y - d, H), (x, y, H)], "brick")
# 看板の板（壁から少し出す）
for side, x, _ in SIGNS:
    line = EAST_WALL if side == "east" else WEST_WALL
    y = y_at(line, x)
    d = -0.3 if side == "east" else 0.3
    pts = [(x - 4.5, y + d, 3.1), (x + 4.5, y + d, 3.1), (x + 4.5, y + d, 4.5), (x - 4.5, y + d, 4.5)]
    face(pts if side == "east" else [(p[0], p[1], p[2]) for p in reversed(pts)], "signboard")

# ---- SL 広場の C11 292（機関車の座標：x は前が +、y は左が +、z は高さ。最後に広場の位置と向きへ移す） ----
SL_START = len(bm.faces)


def sl_box(x0, x1, y0, y1, z0, z1, mat):
    for a_, b_ in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a_[0], a_[1], z0), (b_[0], b_[1], z0), (b_[0], b_[1], z1), (a_[0], a_[1], z1)], mat)
    face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


def sl_cyl(axis, c, r, length, mat, n=12, cap=True):
    """axis：'x'（前後に寝た円柱）・'y'（車輪）・'z'（立った円柱）。c は片方の端の中心"""
    ring = []
    for k in range(n):
        t = 2 * math.pi * k / n
        a_, b_ = r * math.cos(t), r * math.sin(t)
        ring.append({"x": (0, a_, b_), "y": (a_, 0, b_), "z": (a_, b_, 0)}[axis])
    d = {"x": (length, 0, 0), "y": (0, length, 0), "z": (0, 0, length)}[axis]
    p0 = [(c[0] + q[0], c[1] + q[1], c[2] + q[2]) for q in ring]
    p1 = [(p[0] + d[0], p[1] + d[1], p[2] + d[2]) for p in p0]
    for k in range(n):
        face([p0[k], p0[(k + 1) % n], p1[(k + 1) % n], p1[k]], mat)
    if cap:
        face(p0[::-1], mat)
        face(p1, mat)


# 展示の台と線路
sl_box(-7.2, 7.2, -1.7, 1.7, 0.0, 0.35, "base")
for y in (-0.55, 0.55):
    sl_box(-7.0, 7.0, y - 0.04, y + 0.04, 0.35, 0.5, "rail")
# 台枠と前後の緩衝梁（赤）
sl_box(-6.1, 5.9, -1.3, 1.3, 1.55, 1.78, "sl_black")
sl_box(5.9, 6.25, -1.35, 1.35, 1.05, 1.6, "sl_red")
sl_box(-6.45, -6.1, -1.35, 1.35, 1.05, 1.6, "sl_red")
# 車輪（片側ずつ）：動輪 3 軸（直径 1.52m）、先輪 1 軸・従輪 2 軸（直径 0.86m）
WHEELS = [(-0.9, 0.76), (0.75, 0.76), (2.4, 0.76), (4.6, 0.43), (-3.4, 0.43), (-4.6, 0.43)]
for x, r in WHEELS:
    for side in (-1, 1):
        y0 = side * 0.62 - (0.14 if side < 0 else 0)
        sl_cyl("y", (x, y0, r + 0.5), r, 0.14, "sl_black")
        sl_cyl("y", (x, y0 + (-0.01 if side < 0 else 0.13), r + 0.5), r * 0.3, 0.02, "sl_red", n=8)  # 中心の赤
for side in (-1, 1):  # 動輪をつなぐ連結棒・シリンダーへの棒・シリンダー
    y = side * 0.8
    sl_box(-0.9, 2.4, y - 0.04, y + 0.04, 1.2, 1.32, "sl_metal")
    sl_box(2.4, 3.5, y - 0.05, y + 0.05, 1.18, 1.34, "sl_metal")
    sl_cyl("x", (3.6, y + side * 0.15, 1.4), 0.32, 1.3, "sl_black", n=10)
# ボイラー・煙室の扉・煙突・ドーム・前照灯
sl_cyl("x", (-0.4, 0, 2.55), 0.78, 5.9, "sl_black")
sl_cyl("x", (5.5, 0, 2.55), 0.8, 0.02, "sl_black", n=12)
sl_cyl("z", (5.0, 0, 3.2), 0.28, 0.75, "sl_black", n=10)  # 煙突
sl_cyl("z", (3.0, 0, 3.2), 0.36, 0.5, "sl_black", n=10)  # 蒸気ドーム
sl_cyl("z", (1.6, 0, 3.2), 0.32, 0.42, "sl_black", n=10)  # 砂箱
sl_cyl("x", (5.52, 0, 3.25), 0.17, 0.25, "sl_lamp", n=8)  # 前照灯
# 水タンク（両わき）・運転台・石炭庫
for side in (-1, 1):
    y0, y1 = (0.82, 1.35) if side > 0 else (-1.35, -0.82)
    sl_box(0.2, 4.1, y0, y1, 1.78, 3.0, "sl_black")
sl_box(-3.4, -0.3, -1.4, 1.4, 1.78, 3.65, "sl_black")
sl_box(-3.55, -0.15, -1.45, 1.45, 3.65, 3.85, "sl_black")  # 運転台の屋根
for side in (-1, 1):  # 運転台の窓（左右と前）
    y = side * 1.41
    pts = [(-2.9, y, 2.6), (-1.2, y, 2.6), (-1.2, y, 3.35), (-2.9, y, 3.35)]
    face(pts if side < 0 else pts[::-1], "sl_glass")
face([(-0.29, -1.2, 2.75), (-0.29, -0.6, 2.75), (-0.29, -0.6, 3.4), (-0.29, -1.2, 3.4)], "sl_glass")
face([(-0.29, 0.6, 2.75), (-0.29, 1.2, 2.75), (-0.29, 1.2, 3.4), (-0.29, 0.6, 3.4)], "sl_glass")
sl_box(-6.0, -3.4, -1.25, 1.25, 1.78, 3.0, "sl_black")  # 石炭庫
# 機関車の座標 → 駅の座標（広場の位置と向き）
ca, sa = math.cos(math.radians(SL["angle"])), math.sin(math.radians(SL["angle"]))
for v in {v for f in bm.faces[SL_START:] for v in f.verts}:
    x, y, z = v.co
    v.co = (SL["x"] + x * ca - y * sa, SL["y"] + x * sa + y * ca, z)

me = bpy.data.meshes.new("SH_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("SH_Station", me)
export_col.objects.link(ob)

# ---- 看板の文字（東の壁は東向き、西の壁は西向き） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for side, x, text in SIGNS:
    line = EAST_WALL if side == "east" else WEST_WALL
    y = y_at(line, x) + (-0.35 if side == "east" else 0.35)
    cu = bpy.data.curves.new("SH_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = 0.8
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("SH_Sign", cu)
    sign.location = (x, y, 3.45)
    sign.rotation_euler = (math.radians(90), 0, math.radians(0 if side == "east" else 180))
    export_col.objects.link(sign)
    cu.materials.append(MAT["sign"])
    for o2 in bpy.context.view_layer.objects:
        o2.select_set(False)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target='MESH')

# ---- 下見用（高架の床板の代わりの板も置く） ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=150)
gm = bpy.data.meshes.new("SH_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SH_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("SH_PreviewGround", gm))
d = bmesh.new()
bmesh.ops.create_cube(d, size=1.0)
dm = bpy.data.meshes.new("SH_PreviewDeck")
d.to_mesh(dm)
d.free()
dm.materials.append(material("SH_PreviewDeckMat", (0.42, 0.43, 0.47)))
deck = bpy.data.objects.new("SH_PreviewDeck", dm)
deck.location = (3, -7, 5.45)
deck.scale = (187, 62, 1.1)
preview_col.objects.link(deck)
sun = bpy.data.objects.new("SH_Sun", bpy.data.lights.new("SH_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SH_Camera", bpy.data.cameras.new("SH_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (55, 82, 8)
cam.rotation_euler = (mathutils.Vector((72, 64, 2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SH_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
for img in bpy.data.images:
    if img.filepath_raw.startswith(TEX_DIR):
        img.pack()
bpy.ops.wm.save_as_mainfile(filepath=out)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "shimbashi_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
