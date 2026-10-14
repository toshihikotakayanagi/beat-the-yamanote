# 田端駅（線路の上の北口の駅舎とアトレヴィ田端、南口の駅舎、2 つの島式ホームと屋根）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-tabata-station.py -- <保存先の .blend>
#
# 地図には駅全体の輪郭（OSM way 157576294。長さ約 260m・幅約 78m）が高さのわからない建物として入っていて、推定の高さで
# 線路をまるごと覆う箱になっていたので、その箱は描かずに、このモデルに置きかえる。線路は地面の高さ。
#   ・北口の駅舎：線路の上に渡した橋上駅舎（OSM の輪郭の北西の部分）。線路の上の地上 7.5m から高さ 15m まで。
#     ホームの上に柱を立てる。西の田端の台地の側に駅名とアトレヴィ田端、ホームの側に駅名の看板
#   ・南口の駅舎：線路の南の小さな駅舎（高さ 5m）と看板
#   ・島式ホーム 2 つ（京浜東北線と山手線、山手線と京浜東北線）：地面の高さ（上面 1m）。ゲームの線路の中心から 1.6m あけて
#     形を決め、長さは OSM（way 751433105 / 751433106）に合わせた。北口の駅舎より南東に屋根と柱
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（南東の西日暮里側が +。方位 128.6°）、Y は北東が +（正面は南西の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.73737、経度 139.76171）。線路は X とおよそ 7° ずれている。
# 書き出すものはコレクション「TA_Export」、下見用の地面・カメラ・光は「TA_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("tabata_station.blend")

# ---- 寸法 ----
CORRIDOR = (-12.0, 62.0)  # 線路が通る帯（Y）。北口の駅舎はまるごと線路の上
NORTH = [(-138.9, 2.9), (-112.0, 0.4), (-112.0, 24.4), (-94.9, 24.7), (-94.0, 32.8), (-116.3, 35.7), (-114.9, 48.3),
         (-137.3, 51.1), (-141.4, 32.3), (-138.5, 32.0), (-139.0, 28.0)]
NORTH_H, NORTH_PORTAL = 15.0, 7.5
SOUTH = [(29.4, -14.1), (27.1, -26.1), (35.9, -27.5), (36.4, -24.8), (37.1, -21.1), (31.9, -20.2), (32.6, -15.2)]
SOUTH_Y = -21.5  # 南口の駅舎はこれより南（線路から離れた側）だけ
SOUTH_H = 5.0
PLATFORMS = [  # （東の端, 西の端）。X ごとの Y
    ([(-133, 4.9), (-130, 4.4), (-120, 2.9), (-110, 1.4), (-100, -0.0), (-90, -1.4), (-80, -2.7), (-70, -4.0), (-60, -5.3),
      (-50, -6.6), (-40, -7.9), (-30, -9.2), (-20, -10.5), (-10, -11.8), (0, -13.1), (10, -14.4), (20, -15.7), (30, -16.9),
      (40, -18.1), (50, -19.3), (60, -20.5), (70, -21.8), (80, -23.0), (90, -24.2), (100, -24.7), (110, -25.3), (116, -25.7)],
     [(-133, 13.6), (-130, 13.2), (-120, 11.9), (-110, 10.6), (-100, 9.3), (-90, 8.0), (-80, 6.7), (-70, 5.4), (-60, 4.1),
      (-50, 2.8), (-40, 1.5), (-30, 0.2), (-20, -1.1), (-10, -2.4), (0, -3.7), (10, -5.0), (20, -6.3), (30, -7.7), (40, -9.0),
      (50, -10.3), (60, -11.6), (70, -12.9), (80, -14.2), (90, -15.5), (100, -17.5), (110, -19.6), (116, -20.9)]),
    ([(-130, 21.4), (-120, 20.1), (-110, 18.8), (-100, 17.5), (-90, 16.2), (-80, 14.9), (-70, 13.6), (-60, 12.3), (-50, 11.0),
      (-40, 9.6), (-30, 8.3), (-20, 7.0), (-10, 5.7), (0, 4.4), (10, 3.1), (20, 1.8), (30, 0.5), (40, -0.8), (50, -2.2),
      (60, -3.5), (70, -4.8), (80, -6.1), (90, -7.4), (100, -8.7), (110, -10.0), (120, -11.3), (121, -11.5)],
     [(-130, 28.6), (-120, 27.3), (-110, 25.9), (-100, 24.6), (-90, 23.3), (-80, 21.9), (-70, 20.6), (-60, 19.3), (-50, 17.9),
      (-40, 16.6), (-30, 15.3), (-20, 14.0), (-10, 12.6), (0, 11.3), (10, 10.0), (20, 8.6), (30, 7.3), (40, 6.0), (50, 4.6),
      (60, 3.3), (70, 1.7), (80, -0.4), (90, -2.4), (100, -4.5), (110, -6.6), (120, -8.6), (121, -8.8)]),
]
ROOF = (-108, 112, 1.0 + 3.6)  # ホームの屋根（X の範囲と高さ）
PILLAR_X = (-136.0, -124.0)  # 北口の駅舎を支える柱（ホームのまん中に立てる）の X
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、90 は +X、-90 は -X）
    ("田端駅", (-139.3, 12.0, 10.4), -90, 2.4),
    ("アトレヴィ田端", (-139.3, 22.0, 10.8), -90, 1.2),
    ("田端", (-111.8, 12.0, 10.6), 90, 2.0),
    ("田端駅　南口", (31.5, -26.9, 3.0), -9.0, 0.7),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "tabata_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(113)

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

    if kind == "north":  # 橋上駅舎：白い壁と、2 つの階の横長の窓（高さは地面から。下の 7.5m は線路の上の空き）
        rect(0, BAY, 0, h, WHITE)
        rect(0, BAY, NORTH_PORTAL, NORTH_PORTAL + 0.6, GRAY)
        for z in (NORTH_PORTAL + 1.0, NORTH_PORTAL + 4.2):
            rect(0.3, BAY - 0.3, z, z + 2.4, GLASS, LIGHT * rng.uniform(0.6, 1.0))
        rect(0, BAY, h - 0.6, h, GRAY)
    else:  # 南口の駅舎：タイルの壁とガラスの入口
        rect(0, BAY, 0, h, TILE)
        rect(0.4, BAY - 0.4, 0.2, 3.2, GLASS, LIGHT)
        rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.2, 3.2, FRAME)
        rect(0, BAY, h - 0.6, h, WHITE)
    return save_images(name, col, glow)


TEX = {"north": facade("ta_north", NORTH_H, "north"), "south": facade("ta_south", SOUTH_H, "south")}


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
    "north": material("TA_North", tex=TEX["north"], rough=0.4),
    "south": material("TA_South", tex=TEX["south"], rough=0.6),
    "roof": material("TA_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("TA_Under", (0.45, 0.45, 0.46), rough=0.9),  # 橋上駅舎の床下
    "platform": material("TA_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("TA_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("TA_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("TA_Post", (0.3, 0.32, 0.34), rough=0.5),
    "pillar": material("TA_Pillar", (0.7, 0.7, 0.69), rough=0.8),
    "signboard": material("TA_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("TA_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("TA_Export")
preview_col = bpy.data.collections.new("TA_Preview")
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


# 線路の上の北口の駅舎と、南口の駅舎
portal_building(NORTH, NORTH_H, NORTH_PORTAL, "north", NORTH_H)
box(-134.0, -120.0, 8.0, 44.0, NORTH_H, NORTH_H + 2.0, "roof")  # 屋上の機械室
prism(clip(SOUTH, ('le', SOUTH_Y)), 0, SOUTH_H, "south", SOUTH_H)

# 地面の高さの島式ホーム 2 つと屋根、北口の駅舎の柱
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
    for x in PILLAR_X:  # 北口の駅舎の柱
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

me = bpy.data.meshes.new("TA_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("TA_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("TA_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("TA_Sign", cu)
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
gm = bpy.data.meshes.new("TA_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TA_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("TA_PreviewGround", gm))
sun = bpy.data.objects.new("TA_Sun", bpy.data.lights.new("TA_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TA_Camera", bpy.data.cameras.new("TA_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-220, -80, 70)
cam.rotation_euler = (mathutils.Vector((-60, 10, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TA_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "tabata_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
