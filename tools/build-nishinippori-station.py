# 西日暮里駅（線路の上に渡した駅舎、2 つの島式ホームと屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-nishinippori-station.py -- <保存先の .blend>
#
# 実物の駅舎は、道灌山通りのすぐ東で線路の上に渡した橋上駅舎。OSM には駅舎の輪郭がないので、改札口の位置
# （線路の上、道灌山通りから約 10〜30m 東）に合わせて置いた。ゲームの線路は地面の高さで、駅の北東には高架の線路
# （高さ 6m）があるので、駅舎はそこにかからない範囲（Y ≦ 15）にした。
#   ・駅舎：線路の上の地上 7.5m から高さ 13m まで。ホームの上に柱を立てる。道灌山通りの側（北西）と南東に駅名の看板
#   ・島式ホーム 2 つ（3・4 番線と 1・2 番線。京浜東北線と山手線）：地面の高さ（上面 1m）。ゲームの線路の中心から 1.6m あけて
#     形を決め、長さは OSM（way 146645018 / 146645017）に合わせた。屋根と柱
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（南東の日暮里側が +。方位 142.1°）、Y は北東が +（正面は南西の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.7322、経度 139.76667）。
# 書き出すものはコレクション「NN_Export」、下見用の地面・カメラ・光は「NN_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("nishinippori_station.blend")

# ---- 寸法 ----
CORRIDOR = (-30.0, 30.0)  # 線路が通る帯（Y）。駅舎はまるごと線路の上
NORTH = [(8.0, -21.0), (30.0, -21.0), (30.0, 15.0), (8.0, 15.0)]  # 線路の上の駅舎
NORTH_H, NORTH_PORTAL = 13.0, 7.5
PLATFORMS = [  # （南西の端, 北東の端）。X ごとの Y
    ([(-85, 2.2), (-80, 1.3), (-70, -0.5), (-60, -2.3), (-50, -4.1), (-40, -5.9), (-30, -7.7), (-20, -9.5), (-10, -11.3),
      (0, -13.1), (10, -14.9), (20, -16.7), (30, -18.5), (40, -20.3), (50, -22.1), (60, -23.2), (70, -23.7), (80, -24.3),
      (90, -24.8), (100, -25.4), (110, -25.9), (113, -26.1)],
     [(-85, 7.8), (-80, 7.1), (-70, 5.6), (-60, 4.2), (-50, 2.7), (-40, 1.2), (-30, -0.2), (-20, -1.7), (-10, -3.1),
      (0, -4.6), (10, -6.1), (20, -7.4), (30, -8.7), (40, -9.9), (50, -11.1), (60, -12.4), (70, -13.6), (80, -14.8),
      (90, -16.0), (100, -17.3), (110, -18.5), (113, -18.9)]),
    ([(-84, 15.8), (-80, 15.2), (-70, 13.9), (-60, 12.6), (-50, 11.2), (-40, 9.9), (-30, 8.5), (-20, 7.2), (-10, 5.9),
      (0, 4.5), (10, 2.9), (20, 1.2), (30, -0.4), (40, -2.0), (50, -3.7), (60, -5.2), (70, -6.4), (80, -7.5), (90, -8.7),
      (100, -9.9), (110, -11.1), (114, -11.6)],
     [(-84, 22.5), (-80, 22.1), (-70, 21.0), (-60, 19.9), (-50, 18.9), (-40, 17.8), (-30, 16.7), (-20, 15.7), (-10, 14.6),
      (0, 13.5), (10, 12.0), (20, 10.3), (30, 8.7), (40, 7.1), (50, 5.4), (60, 3.8), (70, 2.2), (80, 0.5), (90, -1.1),
      (100, -2.8), (110, -4.4), (114, -5.0)]),
]
ROOF = (-80, 110, 1.0 + 3.6)  # ホームの屋根（X の範囲と高さ）
PILLAR_X = (12.0, 26.0)  # 駅舎を支える柱（ホームのまん中に立てる）の X
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、90 は +X、-90 は -X）
    ("西日暮里駅", (7.8, -3.0, 9.2), -90, 2.0),
    ("西日暮里駅", (30.2, -3.0, 9.2), 90, 2.0),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "nishinippori_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(114)

WHITE = np.array([0.88, 0.88, 0.86])
GRAY = np.array([0.62, 0.63, 0.64])
TILE = np.array([0.7, 0.62, 0.52])
GLASS = np.array([0.15, 0.18, 0.21])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.9, 0.72])


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

    if kind == "north":  # 橋上駅舎：白い壁と、横長の窓（高さは地面から。下の 7.5m は線路の上の空き）
        rect(0, BAY, 0, h, WHITE)
        rect(0, BAY, NORTH_PORTAL, NORTH_PORTAL + 0.6, GRAY)
        rect(0.3, BAY - 0.3, NORTH_PORTAL + 1.2, h - 1.2, GLASS, LIGHT * 0.8)
        rect(0, BAY, h - 0.6, h, GRAY)
    return save_images(name, col, glow)


TEX = {"north": facade("nn_north", NORTH_H, "north")}


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
    "north": material("NN_North", tex=TEX["north"], rough=0.4),
    "roof": material("NN_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("NN_Under", (0.45, 0.45, 0.46), rough=0.9),  # 橋上駅舎の床下
    "platform": material("NN_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("NN_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("NN_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("NN_Post", (0.3, 0.32, 0.34), rough=0.5),
    "pillar": material("NN_Pillar", (0.7, 0.7, 0.69), rough=0.8),
    "signboard": material("NN_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("NN_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("NN_Export")
preview_col = bpy.data.collections.new("NN_Preview")
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


def portal_building(poly, h, portal, mat, tex_h):
    """線路の帯だけ地上 portal m まであけた建物"""
    y0, y1 = CORRIDOR
    for keep, cut in ((('ge', y1), y1), (('le', y0), y0)):
        part = clip(poly, keep)
        if len(part) >= 3:
            prism(part, 0, portal, mat, tex_h, top=False, cut_y=cut)
    prism(poly, portal, h, mat, tex_h, top=True)
    mid = clip(clip(poly, ('ge', y0)), ('le', y1))  # 線路の上の天井
    if len(mid) >= 3:
        face([(x, y, portal) for x, y in ccw(mid)[::-1]], "tunnel", tile=6)


def box(x0, x1, y0, y1, z0, z1, mat, top=True):
    prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat, max(z1 - z0, 0.1), top=top)


def interp(edge, x):
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return edge[0][1] if x < edge[0][0] else edge[-1][1]


# 線路の上の駅舎
portal_building(NORTH, NORTH_H, NORTH_PORTAL, "north", NORTH_H)
box(13.0, 25.0, -12.0, 8.0, NORTH_H, NORTH_H + 1.5, "roof")  # 屋上の機械室

# 地面の高さの島式ホーム 2 つと屋根、駅舎の柱
rx0, rx1, rz = ROOF
for lo_, hi_ in PLATFORMS:
    xs = sorted(set([p[0] for p in lo_] + [p[0] for p in hi_]))
    lo, hi = [(x, interp(lo_, x)) for x in xs], [(x, interp(hi_, x)) for x in xs]
    prism(lo + hi[::-1], 0.0, 1.0, "platform", 1.0)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, 1.01), (xb, yb + d - 0.15, 1.01), (xb, yb + d + 0.15, 1.01), (xa, ya + d + 0.15, 1.01)], "edge")
    rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
    for xa, xb in zip(rxs, rxs[1:]):  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）
        la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
        ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
        ma, mb = (la + ha) / 2, (lb + hb) / 2
        face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.5), (xa, ma, rz + 0.5)], "canopy", tile=3)
        face([(xa, ma, rz + 0.5), (xb, mb, rz + 0.5), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
    for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
        ym = (interp(lo, x) + interp(hi, x)) / 2
        box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, 1.0, rz + 0.5, "post", top=False)
    for x in PILLAR_X:  # 駅舎の柱
        ym = (interp(lo, x) + interp(hi, x)) / 2
        box(x - 0.6, x + 0.6, ym - 0.6, ym + 0.6, 1.0, NORTH_PORTAL, "pillar", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("NN_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("NN_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("NN_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("NN_Sign", cu)
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
gm = bpy.data.meshes.new("NN_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("NN_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("NN_PreviewGround", gm))
sun = bpy.data.objects.new("NN_Sun", bpy.data.lights.new("NN_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("NN_Camera", bpy.data.cameras.new("NN_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-60, -90, 45)
cam.rotation_euler = (mathutils.Vector((20, 0, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("NN_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "nishinippori_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
