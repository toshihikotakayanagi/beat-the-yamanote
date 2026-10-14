# 鶯谷駅（昭和初期からの小さな北口駅舎、南口、2 つの島式ホームと屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-uguisudani-station.py -- <保存先の .blend>
#
# ゲームの線路は、山手線の外回りと京浜東北線が高架（高さ 6m。橋げたの下は 4.9m）、山手線の内回りとそのほかは地面の高さ。
#   ・北口の駅舎：OSM の輪郭（way 517681252。高さ 6.4m）の、クリーム色の壁と瓦の寄棟屋根の小さな駅舎と看板
#   ・南口：言問通りの橋のたもとの小さな駅舎と看板
#   ・島式ホーム 2 つ（1・2 番線と 3・4 番線。京浜東北線と山手線）：高架の高さ（上面 7m、下面 5m）。ゲームの線路の中心から
#     1.6m あけて形を決め、長さは OSM（way 182119154 / 182119156）に合わせた。屋根と柱
# 地図の北口の駅舎の箱と、駅の南東で線路にかぶさっていた大きな箱は描かない。
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（南東の上野側が +。方位 139°）、Y は北東が +（正面は南西の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.7217、経度 139.77792）。
# 書き出すものはコレクション「UG_Export」、下見用の地面・カメラ・光は「UG_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("uguisudani_station.blend")

# ---- 寸法 ----
NORTH = (-89.5, -64.9, 33.3, 43.0)  # 北口の駅舎（X0, X1, Y0, Y1）
NORTH_WALL, NORTH_RIDGE = 4.2, 6.4  # 壁の高さ、屋根のいちばん上
SOUTH = (94.0, 104.0, -26.0, -19.5, 6.0)  # 南口の駅舎（X0, X1, Y0, Y1, 高さ）
HIGH = (5.0, 7.0)  # ホームの下面と上面
PLATFORMS = [  # （南西の端, 北東の端）。X ごとの Y
    ([(-75, -12.0), (-40, -12.3), (0, -12.7), (40, -13.1), (80, -13.5), (128, -14.0)],
     [(-75, -6.6), (-70, -6.4), (-60, -5.9), (-50, -5.4), (-40, -4.9), (-30, -4.4), (-20, -4.0), (-10, -3.5), (0, -3.0),
      (10, -3.4), (20, -3.8), (30, -4.2), (40, -4.6), (50, -5.0), (60, -5.4), (70, -5.8), (80, -6.2), (90, -6.6),
      (100, -7.0), (110, -7.4), (120, -7.8), (128, -8.1)]),
    ([(-62, 0.9), (-50, 1.3), (-40, 1.7), (-30, 2.0), (-20, 2.4), (-10, 2.7), (0, 3.1), (10, 2.8), (20, 2.6), (30, 2.3),
      (40, 2.1), (50, 1.9), (60, 1.6), (70, 1.4), (80, 1.1), (90, 0.9), (100, 0.6), (110, 0.4), (120, 0.1), (126, 0.0)],
     [(-62, 6.4), (-60, 6.6), (-50, 7.8), (-40, 8.7), (-30, 9.3), (-20, 10.0), (-10, 10.6), (0, 11.3), (10, 11.1), (20, 10.9),
      (30, 10.7), (40, 10.5), (50, 10.3), (60, 10.1), (70, 9.9), (80, 9.5), (90, 8.7), (100, 8.0), (110, 7.2), (120, 6.5),
      (126, 5.8)]),
]
ROOF = (-60, 120, 7.0 + 3.4)  # ホームの屋根（X の範囲と高さ）
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、180 は +Y、-90 は -X）
    ("鶯谷駅", (-77.0, 43.0, 2.9), 180, 0.8),
    ("鶯谷駅　南口", (99.0, -26.0, 4.0), 0, 0.7),
    ("鶯谷", (-75.2, -9.3, 7.4), -90, 0.9),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "uguisudani_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(116)

CREAM = np.array([0.86, 0.82, 0.7])
WOOD = np.array([0.42, 0.3, 0.2])
WHITE = np.array([0.88, 0.88, 0.86])
GLASS = np.array([0.15, 0.18, 0.21])
LIGHT = np.array([1.0, 0.88, 0.66])
TILE = np.array([0.3, 0.31, 0.33])


def save_images(name, col, glow):
    imgs = []
    H, W = col.shape[:2]
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, W, H, alpha=False)
        rgba = np.ones((H, W, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.01, (H, W, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


def facade(name, h, kind, px=96):
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    if kind == "north":  # 北口：クリーム色のしっくいの壁、木の腰板、格子の窓と入口
        rect(0, BAY, 0, h, CREAM)
        rect(0, BAY, 0, 0.9, WOOD)
        rect(1.0, BAY - 1.0, 0.9, 3.0, GLASS, LIGHT)
        for x in np.arange(1.0, BAY - 1.0, 0.5):
            rect(x, x + 0.06, 0.9, 3.0, WOOD)
        rect(1.0, BAY - 1.0, 1.9, 1.96, WOOD)
        rect(0, 0.2, 0, h, WOOD)
        rect(0, BAY, h - 0.25, h, WOOD)
    else:  # 南口：白い壁とガラスの入口
        rect(0, BAY, 0, h, WHITE)
        rect(0.4, BAY - 0.4, 0.2, 3.2, GLASS, LIGHT)
        rect(0, BAY, h - 0.6, h, np.array([0.6, 0.61, 0.62]))
    return save_images(name, col, glow)


def roof_tiles(name, px=64):
    """瓦の屋根：横の段の模様"""
    col = np.zeros((px, px, 3)) + TILE
    for r0 in range(0, px, 8):
        col[r0:r0 + 2] *= 0.7
    col *= rng.uniform(0.92, 1.06, (px, px, 1))
    return save_images(name, col, np.zeros((px, px, 3)))


TEX = {"north": facade("ug_north", NORTH_WALL, "north"), "south": facade("ug_south", SOUTH[4], "south"),
       "tiles": roof_tiles("ug_tiles")}


def material(name, color=None, tex=None, rough=0.6, metal=0.0, emit=None, strength=0.0):
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
    "north": material("UG_North", tex=TEX["north"], rough=0.7),
    "south": material("UG_South", tex=TEX["south"], rough=0.5),
    "tiles": material("UG_Tiles", tex=TEX["tiles"], rough=0.8),
    "roof": material("UG_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("UG_Under", (0.45, 0.45, 0.46), rough=0.9),  # 高架のホームの下面
    "platform": material("UG_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("UG_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("UG_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("UG_Post", (0.3, 0.32, 0.34), rough=0.5),
    "signboard": material("UG_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("UG_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("UG_Export")
preview_col = bpy.data.collections.new("UG_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def face(pts, mat, uvs=None, tile=4.0):
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


def ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]


def clip(poly, keep, axis=1):
    """半平面で多角形を切る（keep：('ge', v) は座標 ≧ v を残す、('le', v) は ≦ v を残す。axis 0 は X、1 は Y）"""
    kind, v = keep
    inside = (lambda p: p[axis] >= v) if kind == 'ge' else (lambda p: p[axis] <= v)
    out_ = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if inside(a):
            out_.append(a)
        if inside(a) != inside(b):
            t = (v - a[axis]) / (b[axis] - a[axis])
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out_.append((v, p[1]) if axis == 0 else (p[0], v))
    return out_


def prism(poly, z0, z1, mat, tex_h, top=True, bottom=False, cut_y=None):
    """多角形を z0〜z1 に立ち上げる。cut_y の線の上の辺（線路側に切った面）はトンネルの壁にする"""
    poly = ccw(poly)
    n = len(poly)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05:
            continue
        on_cut = cut_y is not None and abs(a[1] - cut_y) < 1e-6 and abs(b[1] - cut_y) < 1e-6
        m = max(1, round(L / BAY))
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], "tunnel" if on_cut else mat,
             None if on_cut else [(0, z0 / tex_h), (m, z0 / tex_h), (m, z1 / tex_h), (0, z1 / tex_h)])
    if top:
        face([(x, y, z1) for x, y in poly], "roof", tile=6)
    if bottom:
        face([(x, y, z0) for x, y in poly[::-1]], "tunnel", tile=6)


def box(x0, x1, y0, y1, z0, z1, mat, top=True):
    prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat, max(z1 - z0, 0.1), top=top)


def interp(edge, x):
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return edge[0][1] if x < edge[0][0] else edge[-1][1]


# 北口の駅舎：壁と、瓦の寄棟屋根（軒を 0.6m 出す）
x0, x1, y0, y1 = NORTH
box(x0, x1, y0, y1, 0, NORTH_WALL, "north", top=False)
o = 0.6
ex0, ex1, ey0, ey1 = x0 - o, x1 + o, y0 - o, y1 + o
ym = (y0 + y1) / 2
rx0, rx1 = ex0 + (ey1 - ey0) / 2, ex1 - (ey1 - ey0) / 2  # 棟（むね）の両端
zw, zr = NORTH_WALL, NORTH_RIDGE
face([(ex0, ey0, zw), (ex1, ey0, zw), (rx1, ym, zr), (rx0, ym, zr)], "tiles", tile=2)
face([(ex1, ey1, zw), (ex0, ey1, zw), (rx0, ym, zr), (rx1, ym, zr)], "tiles", tile=2)
face([(ex1, ey0, zw), (ex1, ey1, zw), (rx1, ym, zr)], "tiles", tile=2)
face([(ex0, ey1, zw), (ex0, ey0, zw), (rx0, ym, zr)], "tiles", tile=2)
face([(ex0, ey0, zw), (ex0, ey1, zw), (ex1, ey1, zw), (ex1, ey0, zw)], "tunnel", tile=4)  # 軒の裏

# 南口の駅舎
sx0, sx1, sy0, sy1, sh = SOUTH
box(sx0, sx1, sy0, sy1, 0, sh, "south")

# 高架の高さの島式ホーム 2 つと屋根
z0, z1 = HIGH
rx0, rx1, rz = ROOF
for lo_, hi_ in PLATFORMS:
    xs = sorted(set([p[0] for p in lo_] + [p[0] for p in hi_]))
    lo, hi = [(x, interp(lo_, x)) for x in xs], [(x, interp(hi_, x)) for x in xs]
    prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=True)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
    rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
    for xa, xb in zip(rxs, rxs[1:]):  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）
        la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
        ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
        ma, mb = (la + ha) / 2, (lb + hb) / 2
        face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.5), (xa, ma, rz + 0.5)], "canopy", tile=3)
        face([(xa, ma, rz + 0.5), (xb, mb, rz + 0.5), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
    for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
        ym = (interp(lo, x) + interp(hi, x)) / 2
        box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, z1, rz + 0.5, "post", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("UG_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("UG_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("UG_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("UG_Sign", cu)
    sign.location = (x + math.sin(math.radians(rotz)) * 0.15, y - math.cos(math.radians(rotz)) * 0.15, z)
    sign.rotation_euler = (math.radians(90), 0, math.radians(rotz))
    export_col.objects.link(sign)
    cu.materials.append(MAT["sign"])
    for o2 in bpy.context.view_layer.objects:
        o2.select_set(False)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target='MESH')

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=320)
gm = bpy.data.meshes.new("UG_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("UG_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("UG_PreviewGround", gm))
sun = bpy.data.objects.new("UG_Sun", bpy.data.lights.new("UG_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("UG_Camera", bpy.data.cameras.new("UG_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-130, 70, 35)
cam.rotation_euler = (mathutils.Vector((-50, 10, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("UG_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "uguisudani_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
