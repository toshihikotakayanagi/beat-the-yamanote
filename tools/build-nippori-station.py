# 日暮里駅（JR の線路の上の橋上駅舎、JR の 3 つの島式ホーム、京成線のホーム）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-nippori-station.py -- <保存先の .blend>
#
# 地図には JR の駅舎（OSM way 182119141）と京成の駅（way 253844168）が高さのわからない建物として入っていて、推定の高さで
# 線路と高架をふさぐ箱になっていたので、それらは描かずに、このモデルに置きかえる。
# ゲームの線路は、JR が地面の高さ（山手線・京浜東北線は tools/fetch-osm.mjs の FORCED_LINE_LEVELS で地面にそろえた）、
# 京成線の片方が高架（高さ 6m。橋げたの下は 4.9m）。
#   ・JR の橋上駅舎：OSM の輪郭。線路の上の地上 7.5m から高さ 14m まで。ホームの上に柱を立てる。
#     西（西日暮里側）と東（鶯谷側）に駅名の看板
#   ・JR のホーム：11・12 番線と 9・10 番線（山手線・京浜東北線）、3・4 番線（常磐線）。地面の高さ（上面 1m）。ゲームの線路の中心から 1.6m あけて形を決め、長さは OSM（way 182119159 / 182119158 / 182119152）に
#     合わせた。駅舎より東に屋根と柱
#   ・京成線のホーム：高架の線路の両側のホーム（上面 7m）と、地面の高さの線路の北のホーム（上面 1m）（OSM way 777104557 /
#     777104556 / 777104555）。屋根と柱、京成線の看板
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（南東の鶯谷側が +。方位 136.4°）、Y は北東が +（正面は南西の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.72815、経度 139.77066）。
# 書き出すものはコレクション「NP_Export」、下見用の地面・カメラ・光は「NP_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("nippori_station.blend")

# ---- 寸法 ----
CORRIDOR = (-60.0, 60.0)  # 線路が通る帯（Y）。駅舎はまるごと線路の上
JR = [(28.3, 27.3), (30.5, -40.3), (-2.2, -39.8), (-17.9, -39.5), (-18.2, -45.8), (-24.0, -45.7), (-24.0, -47.0),
      (-34.4, -47.1), (-36.6, -47.1), (-36.2, -22.1), (-34.5, -21.6), (-34.0, 21.1), (-34.0, 22.5), (-34.5, 24.0),
      (-34.6, 28.6), (-4.5, 28.0)]
JR_H, JR_PORTAL = 14.0, 7.5
HIGH, LOW = (5.0, 7.0), (0.0, 1.0)  # ホームの下面・上面（高架の高さ／地面の高さ）
PLATFORMS = [  # （南西の端, 北東の端, 高さ, 屋根の X の範囲 or None）
    ([(-30, -38.2), (0, -38.7), (30, -39.2), (60, -39.8), (90, -40.3), (110, -40.5), (120, -40.6), (130, -40.5), (140, -39.8),
      (150, -39.0), (160, -38.3)],
     [(-30, -32.6), (0, -32.8), (30, -33.0), (60, -33.1), (100, -33.3), (110, -33.1), (120, -32.9), (130, -32.8), (140, -32.6),
      (150, -32.5), (160, -32.0)], LOW, (33, 150)),
    ([(-28, -24.9), (0, -25.2), (30, -25.6), (60, -25.9), (90, -26.3), (120, -26.2), (130, -26.1), (140, -25.7), (150, -24.9),
      (160, -24.1)],
     [(-28, -18.2), (0, -18.4), (30, -18.6), (60, -18.7), (90, -18.9), (130, -19.1), (150, -19.1), (160, -18.9)], LOW, (33, 150)),
    ([(-50, 18.1), (10, 18.1), (20, 18.0), (40, 17.8), (60, 17.7), (80, 17.5), (100, 17.4), (130, 17.3), (150, 17.2)],
     [(-50, 24.6), (-20, 24.7), (0, 24.8), (10, 24.7), (30, 24.6), (50, 24.4), (70, 24.3), (90, 24.2), (110, 24.0),
      (130, 23.8), (150, 23.7)], LOW, (33, 140)),
    ([(-18, 29.0), (67, 29.0)], [(-18, 33.6), (0, 33.5), (20, 33.4), (40, 33.2), (67, 33.1)], HIGH, (-16, 65)),  # 京成（高架）
    ([(-18, 36.8), (0, 36.7), (20, 36.6), (40, 36.4), (67, 36.3)], [(-18, 40.5), (67, 40.5)], HIGH, (-16, 65)),  # 京成（高架）
    ([(-18, 42.5), (-10, 42.7), (0, 43.0), (10, 43.3), (20, 43.6), (30, 43.9), (40, 44.2), (50, 44.3), (60, 43.6), (67, 43.0)],
     [(-18, 46.5), (-10, 46.7), (0, 47.0), (10, 47.3), (20, 47.6), (30, 47.9), (40, 48.2), (50, 48.3), (60, 47.6), (67, 47.0)],
     LOW, (-16, 65)),  # 京成（地面）
]
ROOF_RISE = 3.6  # ホームの上面から屋根まで
PILLAR_X = (-25.0, -5.0, 15.0)  # 橋上駅舎を支える柱（JR のホームのまん中に立てる）の X
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、90 は +X、-90 は -X）
    ("日暮里駅", (-37.0, -12.0, 9.6), -90, 2.6),
    ("日暮里駅", (31.0, -10.0, 9.6), 90, 2.6),
    ("京成線 日暮里駅", (-18.2, 31.2, 7.9), -90, 0.7),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "nippori_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(115)

WHITE = np.array([0.88, 0.88, 0.86])
GRAY = np.array([0.6, 0.61, 0.62])
GLASS = np.array([0.15, 0.18, 0.21])
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
    """橋上駅舎：白い壁と、2 つの階の横長の窓（高さは地面から。下の 11.5m は線路の上の空き）"""
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
    rect(0, BAY, JR_PORTAL, JR_PORTAL + 0.6, GRAY)
    rect(0.3, BAY - 0.3, JR_PORTAL + 1.0, JR_PORTAL + 3.4, GLASS, LIGHT * rng.uniform(0.6, 1.0))
    rect(0.6, BAY - 0.6, JR_PORTAL + 4.0, h - 0.9, GLASS, LIGHT * 0.5)
    rect(0, BAY, h - 0.6, h, GRAY)
    return save_images(name, col, glow)


TEX = {"jr": facade("np_jr", JR_H)}


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
    "jr": material("NP_JR", tex=TEX["jr"], rough=0.4),
    "roof": material("NP_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("NP_Under", (0.45, 0.45, 0.46), rough=0.9),  # 橋上駅舎の床下と、高架のホームの下面
    "platform": material("NP_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("NP_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("NP_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("NP_Post", (0.3, 0.32, 0.34), rough=0.5),
    "pillar": material("NP_Pillar", (0.7, 0.7, 0.69), rough=0.8),
    "signboard": material("NP_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("NP_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("NP_Export")
preview_col = bpy.data.collections.new("NP_Preview")
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


# JR の橋上駅舎
portal_building(JR, JR_H, JR_PORTAL, "jr", JR_H)
box(-25.0, 15.0, -30.0, 15.0, JR_H, JR_H + 2.0, "roof")  # 屋上の機械室

# ホームと屋根、橋上駅舎の柱
for i, (lo_, hi_, (z0, z1), roof) in enumerate(PLATFORMS):
    xs = sorted(set([p[0] for p in lo_] + [p[0] for p in hi_]))
    lo, hi = [(x, interp(lo_, x)) for x in xs], [(x, interp(hi_, x)) for x in xs]
    prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=z0 > 0)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
    if roof:  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）と柱
        rx0, rx1 = roof
        rz = z1 + ROOF_RISE
        rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
        for xa, xb in zip(rxs, rxs[1:]):
            la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
            ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
            ma, mb = (la + ha) / 2, (lb + hb) / 2
            face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.5), (xa, ma, rz + 0.5)], "canopy", tile=3)
            face([(xa, ma, rz + 0.5), (xb, mb, rz + 0.5), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
        for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
            ym = (interp(lo, x) + interp(hi, x)) / 2
            box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, z1, rz + 0.5, "post", top=False)
    if i < 3:  # JR のホームの上に、橋上駅舎の柱
        for x in PILLAR_X:
            ym = (interp(lo, x) + interp(hi, x)) / 2
            box(x - 0.6, x + 0.6, ym - 0.6, ym + 0.6, z1, JR_PORTAL, "pillar", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")
box(-18.3, -18.1, 31.1, 31.3, 7.0, 7.55, "post", top=False)  # 京成線の看板の柱

me = bpy.data.meshes.new("NP_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("NP_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("NP_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("NP_Sign", cu)
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
gm = bpy.data.meshes.new("NP_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("NP_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("NP_PreviewGround", gm))
sun = bpy.data.objects.new("NP_Sun", bpy.data.lights.new("NP_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("NP_Camera", bpy.data.cameras.new("NP_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-130, -110, 70)
cam.rotation_euler = (mathutils.Vector((10, 0, 6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("NP_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "nippori_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
