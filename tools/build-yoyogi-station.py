# 代々木駅（山手線・総武線のホームとその屋根、西口の駅舎、東口の屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-yoyogi-station.py -- <保存先の .blend>
#
# ゲームの線路は、山手線と総武線（中央緩行線）がこの駅で高架（高さ 6m）、中央線快速が地面の高さになっている
# （総武線は tools/fetch-osm.mjs の FORCED_LINE_LEVELS で山手線と同じ高さにそろえた）。
# ホームはそれぞれの線路の高さに合わせ、ゲームの線路の中心から 1.6m あけて形を決めた（OSM のホームの輪郭は
# 線路と少しずれているため）。
#   ・1 番線（山手線外回り）、2・3 番線（山手線内回り・総武線）、4 番線（総武線）のホームは高架の高さ（上面 7m）
#   ・ホームの屋根：低い切妻の屋根と柱（OSM の屋根 way 153182233 / 153182217 / 153182214 の範囲）
#   ・西口の駅舎：OSM の輪郭（way 1429476335。高さ 8.5m）と駅名の看板
#   ・東口の入口の屋根（way 759380553）と看板
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北西が +。方位 -14.3°）、Y は西南西が +（正面は東の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.68395、経度 139.70208）。
# 書き出すものはコレクション「YY_Export」、下見用の地面・カメラ・光は「YY_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("yoyogi_station.blend")

# ---- 寸法 ----
HIGH = 7.0  # ホームの上面（高架の高さ）
PLATFORMS = [  # （輪郭, 上面の高さ, 屋根の X の範囲, 屋根の高さ）。輪郭は X ごとに「東の端 → 西の端」を並べたもの
    ([(-104, 10.5), (-100, 10.7), (-90, 11.1), (-80, 11.5), (-70, 12.0), (-60, 12.4), (-50, 12.5), (-40, 12.0), (-30, 11.6),
      (-20, 11.2), (-10, 10.7), (0, 10.3), (10, 9.8), (20, 9.4), (30, 8.9), (40, 8.5), (50, 8.1), (60, 7.6), (70, 7.2),
      (80, 6.8), (90, 6.4), (100, 6.8), (110, 7.2), (113, 7.3)],
     [(-104, 14.5), (-100, 14.7), (-90, 15.1), (-80, 15.5), (-70, 16.0), (-60, 16.4), (-50, 16.5), (-40, 16.0), (-30, 15.6),
      (-20, 15.2), (-10, 14.7), (0, 14.3), (10, 13.8), (20, 13.4), (30, 12.9), (40, 12.5), (50, 12.1), (60, 11.6), (70, 11.2),
      (80, 10.8), (90, 10.4), (100, 10.8), (110, 11.2), (113, 11.3)], HIGH, (-100, 110), HIGH + 3.6),
    ([(-137, -7.7), (-130, -6.8), (-120, -5.6), (-110, -4.3), (-100, -3.5), (-90, -2.1), (-80, -1.4), (-70, -0.8), (-60, -0.8),
      (-50, -1.2), (-40, -1.5), (-30, -1.9), (-20, -2.3), (-10, -2.7), (0, -3.1), (10, -3.5), (20, -3.8), (30, -4.2),
      (40, -4.6), (50, -5.0), (60, -5.4), (70, -5.2), (80, -5.0), (90, -4.8), (100, -4.6), (110, -4.4), (120, -4.2),
      (130, -4.0), (140, -3.8), (150, -3.6)],
     [(-137, -1.7), (-130, -0.8), (-120, 0.4), (-110, 1.7), (-100, 2.4), (-90, 3.1), (-80, 3.7), (-70, 4.4), (-60, 5.0),
      (-50, 4.7), (-40, 4.3), (-30, 3.9), (-20, 3.6), (-10, 3.2), (0, 2.8), (10, 2.4), (20, 2.1), (30, 1.7), (40, 1.3),
      (50, 1.0), (60, 0.6), (70, 0.2), (80, -0.2), (90, -0.5), (100, -0.9), (110, -1.0), (120, -0.4), (130, 0.1),
      (140, 0.7), (150, 1.2)], HIGH, (-130, 140), HIGH + 3.6),
    ([(-64, -12.4), (-60, -12.3), (-50, -12.4), (-40, -12.8), (-30, -13.3), (-20, -13.8), (-10, -14.2), (0, -14.6),
      (10, -15.0), (20, -15.3), (30, -15.7), (40, -16.1), (50, -16.4), (60, -16.8), (70, -17.2), (80, -17.5), (90, -16.9),
      (100, -16.4), (110, -15.8), (120, -15.2), (130, -14.7), (140, -14.1), (150, -13.5)],
     [(-64, -7.9), (-60, -7.8), (-50, -7.9), (-40, -8.3), (-30, -8.8), (-20, -9.3), (-10, -9.8), (0, -10.3), (10, -10.8),
      (20, -11.3), (30, -11.8), (40, -12.2), (50, -12.7), (60, -13.2), (70, -13.3), (80, -13.4), (90, -13.4), (100, -13.5),
      (110, -13.3), (120, -12.8), (130, -12.3), (140, -11.8), (150, -11.3)], HIGH, (-60, 140), HIGH + 3.6),
]
WEST = [(-81.8, 18.5), (-81.5, 21.2), (-89.9, 40.6), (-102.0, 35.2), (-108.8, 32.3), (-108.0, 24.7), (-107.2, 15.4)]
WEST_H = 8.5
EAST = [(-75.7, -51.6), (-79.9, -51.4), (-83.2, -51.2), (-83.2, -50.4), (-81.8, -48.9), (-77.6, -49.2)]
EAST_H = 3.2
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 0 は -Y（東）向き、180 は +Y（西）向き、-90 は -X（南）向き
    ("代々木駅", (-96.0, 38.0, 5.2), 204.0, 1.8),
    ("代々木駅", (-108.9, 25.0, 5.2), -90, 1.6),
    ("代々木駅　東口", (-79.5, -51.7, 2.3), 0, 0.55),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "yoyogi_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(106)

PANEL = np.array([0.82, 0.8, 0.74])
FIN = np.array([0.66, 0.64, 0.6])
GLASS = np.array([0.14, 0.17, 0.2])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.88, 0.7])


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
    """駅舎の壁：1 階のガラスの入口と、2 階の窓"""
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, PANEL)
    rect(0.3, BAY - 0.3, 0.2, 3.4, GLASS, LIGHT)
    rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.2, 3.4, FRAME)
    rect(0.7, BAY - 0.7, 4.6, 6.6, GLASS, LIGHT * 0.7)
    rect(0, 0.3, 0, h, FIN)
    rect(BAY - 0.3, BAY, 0, h, FIN)
    rect(0, BAY, h - 0.7, h, FIN)
    return save_images(name, col, glow)


TEX = {"west": facade("yy_west", WEST_H)}


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
    "west": material("YY_West", tex=TEX["west"]),
    "roof": material("YY_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "platform": material("YY_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "wall": material("YY_Wall", (0.5, 0.49, 0.47), rough=0.9),  # 高架の高さのホームの側面
    "edge": material("YY_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("YY_Canopy", (0.4, 0.44, 0.43), rough=0.6),  # 古いレールを使った屋根の色
    "post": material("YY_Post", (0.24, 0.26, 0.27), rough=0.5),
    "signboard": material("YY_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("YY_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("YY_Export")
preview_col = bpy.data.collections.new("YY_Preview")
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


# 建物
prism(WEST, 0, WEST_H, "west", WEST_H)
prism(EAST, EAST_H, EAST_H + 0.25, "roof", 0.25)
for x, y in ((-82.6, -50.6), (-76.6, -50.0)):
    box(x - 0.1, x + 0.1, y - 0.1, y + 0.1, 0, EAST_H, "post", top=False)

# ホームと屋根
for lo, hi, top, (rx0, rx1), rz in PLATFORMS:
    prism(lo + hi[::-1], 0.0, top, "wall" if top > 2 else "platform", top)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, top + 0.01), (xb, yb + d - 0.15, top + 0.01), (xb, yb + d + 0.15, top + 0.01), (xa, ya + d + 0.15, top + 0.01)], "edge")
    # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）と、まん中の柱
    xs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
    for xa, xb in zip(xs, xs[1:]):
        la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
        ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
        ma, mb = (la + ha) / 2, (lb + hb) / 2
        face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.6), (xa, ma, rz + 0.6)], "canopy", tile=3)
        face([(xa, ma, rz + 0.6), (xb, mb, rz + 0.6), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
    for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
        ym = (interp(lo, x) + interp(hi, x)) / 2
        box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, top, rz + 0.6, "post", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("YY_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("YY_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("YY_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("YY_Sign", cu)
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
gm = bpy.data.meshes.new("YY_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("YY_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("YY_PreviewGround", gm))
sun = bpy.data.objects.new("YY_Sun", bpy.data.lights.new("YY_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("YY_Camera", bpy.data.cameras.new("YY_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-170, -90, 50)
cam.rotation_euler = (mathutils.Vector((-40, 5, 5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("YY_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "yoyogi_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
