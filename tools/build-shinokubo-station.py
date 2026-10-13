# 新大久保駅（高架の下と西側に建つ 4 階建ての駅舎、高架の上の島式ホームと屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-shinokubo-station.py -- <保存先の .blend>
#
# ゲームの山手線はこの駅で高架（高さ 6m。橋げたの下は 4.9m）になっていて、駅舎のすぐ北を大久保通りが線路の下をくぐる。
# 地図の駅の箱（高さ 22m）は高架の線路にかぶさっていたので、駅舎を次のように分ける。
#   ・駅舎：OSM の輪郭（way 155240584。4 階建て・高さ 21.7m）。線路の下（Y < 7.5）は高さ 4.8m の 1 階（改札のあるコンコース）、
#     線路の西側（Y ≧ 7.5）は 21.7m まで立ち上げる。大久保通りの側と西側に駅名の看板
#   ・ホーム：高架の上の島式ホーム（上面 7m）。ゲームの線路の中心から 1.6m あけて形を決め、長さは OSM（way 155240591）に合わせた。
#     大久保通りをふさがないよう、ホームは高架の高さ（5〜7m）だけに置く。屋根と柱も付ける
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北が +。方位 3°）、Y は西が +（正面は東の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.7013、経度 139.70024）。
# 書き出すものはコレクション「OK_Export」、下見用の地面・カメラ・光は「OK_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("shinokubo_station.blend")

# ---- 寸法 ----
STATION = [(9.7, 26.4), (9.3, 17.6), (8.3, -7.0), (-8.8, -6.4), (-8.0, 12.9), (-13.2, 13.2), (-13.1, 20.7), (-10.4, 20.9),
           (-10.4, 23.1), (-8.1, 23.0), (-7.8, 26.8)]
LOW_H = 4.8  # 線路の下の 1 階
TRACK_Y = 7.5  # これより西（+Y）を 4 階建てにする
STATION_H = 21.7
PLATFORM_LO = [(-168, 1.1), (-160, 0.9), (-150, 0.6), (-140, 0.3), (-130, 0.1), (-120, -0.2), (-110, -0.5), (-100, -0.8),
               (-90, -1.0), (-80, -1.3), (-70, -1.6), (-60, -1.8), (-50, -2.1), (-40, -2.4), (-30, -2.6), (-20, -2.9),
               (-10, -3.2), (0, -3.4), (10, -3.7), (20, -3.9), (30, -4.2), (40, -4.5), (50, -4.8), (59, -5.1)]
PLATFORM_HI = [(-168, 4.2), (-160, 4.3), (-150, 4.5), (-140, 4.7), (-130, 4.9), (-120, 5.1), (-110, 5.2), (-100, 5.4),
               (-90, 5.6), (-80, 5.5), (-70, 5.2), (-60, 4.9), (-50, 4.6), (-40, 4.3), (-30, 4.0), (-20, 3.7), (-10, 3.4),
               (0, 3.1), (10, 2.9), (20, 2.6), (30, 2.1), (40, 1.3), (50, 0.6), (59, -0.1)]
PLATFORM_Z = (5.0, 7.0)  # ホームの下面と上面
ROOF = (-150, 55, 7.0 + 3.4)  # 屋根の X の範囲と高さ
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 0 は -Y（東）向き、90 は +X（北）向き、180 は +Y（西）向き
    ("新大久保駅", (9.8, 17.0, 15.5), 92.0, 2.2),
    ("新大久保駅", (8.8, 0.0, 2.9), 92.0, 0.9),
    ("新大久保駅", (0.9, 26.7, 15.5), 180, 2.2),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "shinokubo_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(107)

WHITE = np.array([0.88, 0.88, 0.86])
GRAY = np.array([0.55, 0.56, 0.57])
GLASS = np.array([0.15, 0.19, 0.23])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.9, 0.74])


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


def facade(name, h, px=96):
    """駅舎の壁：1 階はガラスの入口、上の階は白い床の帯と、縦の細いルーバーのあるガラス"""
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, WHITE)
    rect(0.2, BAY - 0.2, 0.2, 3.8, GLASS, LIGHT)
    rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.2, 3.8, FRAME)
    for z in np.arange(LOW_H + 0.6, h - 1.5, 4.2):
        rect(0.3, BAY - 0.3, z, z + 3.0, GLASS, LIGHT * rng.uniform(0.3, 0.8))
        for x in np.arange(0.6, BAY - 0.3, 0.75):
            rect(x, x + 0.12, z, z + 3.0, GRAY)
    rect(0, BAY, h - 1.0, h, WHITE)
    return save_images(name, col, glow)


TEX = {"station": facade("ok_station", STATION_H)}


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
    "station": material("OK_Station", tex=TEX["station"], rough=0.4),
    "roof": material("OK_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "platform": material("OK_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "tunnel": material("OK_Under", (0.42, 0.42, 0.41), rough=0.9),  # ホームの下面
    "edge": material("OK_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("OK_Canopy", (0.82, 0.83, 0.84), rough=0.5),
    "post": material("OK_Post", (0.3, 0.32, 0.34), rough=0.5),
    "signboard": material("OK_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("OK_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("OK_Export")
preview_col = bpy.data.collections.new("OK_Preview")
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


# 駅舎：線路の下は 1 階だけ、線路の西側は 4 階建て
prism(STATION, 0, LOW_H, "station", STATION_H)
west = clip(STATION, ('ge', TRACK_Y))
prism(west, LOW_H, STATION_H, "station", STATION_H)
box(-5.0, 5.0, 12.0, 22.0, STATION_H, STATION_H + 2.0, "roof")  # 屋上の機械室

# 高架の上の島式ホームと屋根
lo, hi = PLATFORM_LO, PLATFORM_HI
z0, z1 = PLATFORM_Z
prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=True)
for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
rx0, rx1, rz = ROOF
xs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
for xa, xb in zip(xs, xs[1:]):  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）
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

me = bpy.data.meshes.new("OK_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("OK_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("OK_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("OK_Sign", cu)
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
gm = bpy.data.meshes.new("OK_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("OK_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("OK_PreviewGround", gm))
sun = bpy.data.objects.new("OK_Sun", bpy.data.lights.new("OK_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("OK_Camera", bpy.data.cameras.new("OK_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-70, -60, 35)
cam.rotation_euler = (mathutils.Vector((0, 10, 6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("OK_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "shinokubo_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
