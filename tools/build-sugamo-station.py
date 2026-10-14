# 巣鴨駅（線路の上に建つ駅舎とアトレヴィ巣鴨、島式ホームと屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-sugamo-station.py -- <保存先の .blend>
#
# 実物の線路は掘割（地面より低い）を通り、駅舎は白山通りの高さで線路の上に建つ。ゲームの線路は地面の高さなので、
# 地図の駅の箱（高さ 31m）が線路をふさいでいた。そこで次のように置きかえる。
#   ・駅舎：OSM の輪郭（way 760741034）を、線路が通る帯（Y ≒ -8〜8.5）だけ地上 6m まであけ、線路の上の部分
#     （改札のあるコンコース）は高さ 11m、北側のアトレヴィ巣鴨の部分（way 760741033。5 階）は 22m まで立ち上げる。
#     白山通りの側（西）に駅名と正面口、北側にアトレヴィの看板
#   ・島式ホーム：地面の高さ（上面 1m）。ゲームの線路の中心から 1.6m あけて形を決め、長さは OSM（way 144131730）に合わせた。
#     駅舎より東には屋根と柱を付ける
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（東北東の駒込側が +。方位 63.1°）、Y は北北西が +（正面は南南東の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.73341、経度 139.73943）。
# 書き出すものはコレクション「SG_Export」、下見用の地面・カメラ・光は「SG_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("sugamo_station.blend")

# ---- 寸法 ----
CORRIDOR = (-8.0, 8.5)  # 線路が通る帯（Y）
STATION = [(-23.7, 17.7), (-31.0, 17.5), (-31.0, 3.6), (-31.2, -3.3), (-20.8, -3.6), (-12.1, -4.1), (7.3, -3.9), (29.8, -3.8),
           (29.6, 10.5), (23.3, 16.9), (13.4, 27.2), (-8.4, 27.5), (-12.0, 27.3), (-21.7, 26.6), (-23.7, 26.7)]
STATION_H, STATION_PORTAL = 11.0, 6.0
ATRE_Y = 10.7  # これより北（+Y）がアトレヴィ巣鴨（5 階）
ATRE_H = 22.0
PLATFORM_LO = [(-30, -4.0), (-20, -4.2), (-10, -4.4), (0, -4.7), (10, -4.9), (20, -5.1), (30, -5.3), (40, -5.6), (50, -5.8),
               (60, -5.8), (70, -5.8), (80, -5.7), (90, -5.7), (110, -5.6), (130, -5.5), (161, -5.4)]
PLATFORM_HI = [(-30, 3.0), (-20, 3.6), (-10, 3.9), (0, 4.3), (10, 4.6), (20, 5.0), (30, 5.3), (40, 5.1), (50, 4.9),
               (60, 4.7), (70, 4.4), (80, 4.2), (90, 4.0), (100, 3.8), (110, 3.6), (120, 3.4), (130, 3.1), (140, 2.9),
               (150, 2.7), (160, 2.5), (161, 2.5)]
ROOF = (32, 150, 1.0 + 3.6)  # 駅舎より東のホームの屋根（X の範囲と高さ）
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、180 は +Y、-90 は -X）
    ("巣鴨駅", (-31.3, 9.0, 7.6), -90, 2.0),
    ("巣鴨駅　正面口", (-31.3, 16.0, 3.4), -90, 0.8),
    ("アトレヴィ巣鴨", (2.0, 27.6, 17.0), 180, 1.6),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "sugamo_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(111)

WHITE = np.array([0.86, 0.86, 0.84])
BEIGE = np.array([0.8, 0.74, 0.64])
FIN = np.array([0.62, 0.6, 0.56])
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


def facade(name, h, px=96):
    """駅舎とアトレヴィの壁：1 階のガラスの入口、コンコースの大きなガラス、上の階の窓"""
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, BEIGE)
    rect(0.3, BAY - 0.3, 0.2, 4.2, GLASS, LIGHT)
    rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.2, 4.2, FRAME)
    rect(0, BAY, STATION_PORTAL - 0.5, STATION_PORTAL + 0.3, WHITE)
    rect(0.3, BAY - 0.3, STATION_PORTAL + 0.6, STATION_H - 1.2, GLASS, LIGHT * 0.8)
    rect(0, BAY, STATION_H - 1.0, STATION_H - 0.4, WHITE)
    for z in np.arange(STATION_H + 0.4, h - 1.5, 3.8):
        rect(0.5, BAY - 0.5, z + 0.8, z + 2.8, GLASS, LIGHT * rng.uniform(0.3, 0.9))
    rect(0, 0.3, 0, h, FIN)
    rect(0, BAY, h - 0.8, h, WHITE)
    return save_images(name, col, glow)


TEX = {"station": facade("sg_station", ATRE_H)}


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
    "station": material("SG_Station", tex=TEX["station"], rough=0.5),
    "roof": material("SG_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("SG_Tunnel", (0.4, 0.4, 0.41), rough=0.9),  # 線路の上の天井と両わきの壁
    "platform": material("SG_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("SG_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("SG_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("SG_Post", (0.3, 0.32, 0.34), rough=0.5),
    "signboard": material("SG_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("SG_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SG_Export")
preview_col = bpy.data.collections.new("SG_Preview")
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


# 線路の上の駅舎と、北側のアトレヴィ巣鴨
portal_building(STATION, STATION_H, STATION_PORTAL, "station", ATRE_H)
prism(clip(STATION, ('ge', ATRE_Y)), STATION_H, ATRE_H, "station", ATRE_H)
box(-16.0, 4.0, 14.0, 23.0, ATRE_H, ATRE_H + 2.5, "roof")  # 屋上の機械室

# 地面の高さの島式ホーム
xs = sorted(set([p[0] for p in PLATFORM_LO] + [p[0] for p in PLATFORM_HI]))
lo, hi = [(x, interp(PLATFORM_LO, x)) for x in xs], [(x, interp(PLATFORM_HI, x)) for x in xs]
prism(lo + hi[::-1], 0.0, 1.0, "platform", 1.0)
for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        face([(xa, ya + d - 0.15, 1.01), (xb, yb + d - 0.15, 1.01), (xb, yb + d + 0.15, 1.01), (xa, ya + d + 0.15, 1.01)], "edge")

# 駅舎より東のホームの屋根（低い切妻。ホームより左右に 0.5m 張り出す）と柱
rx0, rx1, rz = ROOF
rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
for xa, xb in zip(rxs, rxs[1:]):
    la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
    ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
    ma, mb = (la + ha) / 2, (lb + hb) / 2
    face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.5), (xa, ma, rz + 0.5)], "canopy", tile=3)
    face([(xa, ma, rz + 0.5), (xb, mb, rz + 0.5), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
    ym = (interp(lo, x) + interp(hi, x)) / 2
    box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, 1.0, rz + 0.5, "post", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("SG_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("SG_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("SG_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("SG_Sign", cu)
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
gm = bpy.data.meshes.new("SG_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SG_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("SG_PreviewGround", gm))
sun = bpy.data.objects.new("SG_Sun", bpy.data.lights.new("SG_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SG_Camera", bpy.data.cameras.new("SG_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-90, -80, 45)
cam.rotation_euler = (mathutils.Vector((10, 8, 6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SG_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "sugamo_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
