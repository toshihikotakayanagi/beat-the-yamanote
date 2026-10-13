# 恵比寿駅（線路の上に建つ JR恵比寿ビル＝アトレ恵比寿、北側の駅舎、アトレ恵比寿西館、南の立体駐車場）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-ebisu-station.py -- <保存先の .blend>
#
# 実物のホームは JR恵比寿ビルの下にあり、地図の建物の箱をそのまま置くと電車が箱の中を通り抜ける。ゲームの線路は
# ホームの中ほど（X = 0）から北が高架（高さ 6m）になるので、線路が通る帯（Y ≒ -14〜13.5）を地上 12m まであけた建物にする。
#   ・JR恵比寿ビル：OSM の輪郭（way 539439487。12 階）。全体を高さ 24m（アトレ恵比寿）とし、東口側の半分に高さ 46m の上の階を載せる
#   ・駅舎の北側：OSM の駅の輪郭（way 142545704）の X ≧ 39 の部分を高さ 15m で立ち上げる（西口の改札がある）
#   ・アトレ恵比寿西館：OSM の輪郭（way 237103298。高さ 45.7m）
#   ・南の立体駐車場：OSM の輪郭（way 233408547。高さ 18.1m）が線路にかぶさるので、線路の帯を地上 7m まであける
#   ・ホーム（山手線・埼京線）と、建物の外の南のホームの屋根
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北西が +。方位 -24.2°）、Y は西南西が +（正面は東口の -Y）、Z は高さ。
# 原点はホームの中心（緯度 35.64644、経度 139.71021）。
# 書き出すものはコレクション「EB_Export」、下見用の地面・カメラ・光は「EB_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("ebisu_station.blend")

# ---- 寸法 ----
CORRIDOR = (-14.0, 13.5)  # 線路が通る帯（Y）
ELEVATED = 6.0  # ゲームの高架の高さ（X ≧ 0 の線路）
JR_BLDG = [(39.1, 18.5), (0.3, 16.6), (0.2, 12.0), (-64.2, 13.6), (-65.8, -16.8), (-52.6, -16.9), (-52.8, -20.2),
           (-52.5, -31.7), (39.3, -31.0)]
JR_H, JR_PORTAL = 24.0, 12.0
UPPER = (-52.0, 39.0, -31.0, -1.0, 46.0)  # 上の階（X0, X1, Y0, Y1, 高さ）
STATION = [(99.2, 35.0), (99.0, 31.3), (98.8, 27.9), (101.0, 26.9), (104.5, 25.3), (106.4, 24.5), (119.6, 18.5),
           (119.7, 11.5), (128.0, 11.2), (127.9, -12.0), (127.9, -18.1), (98.0, -19.2), (58.6, -18.2), (38.8, -19.9),
           (39.1, 18.5), (58.0, 19.3), (68.1, 19.2), (68.7, 35.2), (84.0, 35.1)]
STATION_H, STATION_PORTAL = 15.0, 12.0
WEST = [(48.5, 61.9), (47.8, 26.2), (36.9, 26.3), (11.9, 26.7), (12.2, 45.8), (12.6, 62.4), (17.6, 62.4)]
WEST_H = 45.7
PARKING = [(-261.9, 12.5), (-261.9, 8.9), (-260.8, -21.8), (-237.1, -20.7), (-236.8, -15.9), (-190.0, -16.2), (-189.1, 13.0)]
PARKING_H, PARKING_PORTAL = 18.1, 7.0
PLATFORMS = [  # （X0, X1, Y0, Y1）。線路の中心から 1.6m あける
    (-99.0, 75.0, 3.5, 8.8),    # 山手線
    (-183.0, 72.0, -9.7, -3.1),  # 埼京線・湘南新宿ライン
]
CANOPY_X1 = -64.0  # 建物の外（南）のホームにだけ屋根を付ける
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 0 は -Y（東）向き、180 は +Y（西）向き、-90 は -X（南）向き
    ("恵比寿駅", (-6.0, -31.4, 15.0), 0, 4.5),
    ("atre", (-6.0, -31.4, 37.0), 0, 4.5),
    ("恵比寿駅", (-65.8, 0.0, 15.5), -90, 3.6),
    ("恵比寿駅　西口", (84.0, 35.2, 12.2), 180, 1.3),
    ("アトレ恵比寿 西館", (30.0, 62.3, 40.0), 180, 1.8),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "ebisu_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(104)

BEIGE = np.array([0.8, 0.74, 0.64])
STONE = np.array([0.7, 0.64, 0.55])
PALE = np.array([0.84, 0.84, 0.82])
FIN = np.array([0.62, 0.6, 0.57])
GLASS = np.array([0.12, 0.15, 0.19])
TGLASS = np.array([0.2, 0.27, 0.34])
FRAME = np.array([0.33, 0.34, 0.36])
CONC = np.array([0.66, 0.66, 0.64])
DARK = np.array([0.16, 0.16, 0.17])
LIGHT = np.array([1.0, 0.87, 0.68])


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


def facade(name, h, kind="shop", panel=BEIGE, px=96):
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    if kind == "tower":  # オフィスの階：ガラスの横の帯と縦の線
        rect(0, BAY, 0, h, TGLASS)
        for z in np.arange(0, h, 4.0):
            rect(0, BAY, z, z + 0.9, panel)
            rect(0.4, BAY - 0.4, z + 1.0, z + 3.5, TGLASS, LIGHT * rng.uniform(0.2, 0.9))
        for x in (0.0, BAY / 2):
            rect(x, x + 0.3, 0, h, panel)
    elif kind == "parking":  # 立体駐車場：コンクリートの床の帯と、暗い開口
        rect(0, BAY, 0, h, CONC)
        for z in np.arange(1.0, h - 1.0, 3.0):
            rect(0.3, BAY - 0.3, z, z + 1.7, DARK, LIGHT * 0.2)
    else:  # 店の入る階：1 階のガラスと、上の階の窓
        rect(0, BAY, 0, h, panel)
        if kind == "shop":
            rect(0.2, BAY - 0.2, 0.3, 4.0, GLASS, LIGHT)
            rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.3, 4.0, FRAME)
        for z in np.arange(5.0, h - 1.4, 4.2):
            rect(0.6, BAY - 0.6, z, z + 2.0, GLASS, LIGHT * rng.uniform(0.4, 1.0))
        rect(0, 0.3, 0, h, FIN)
        rect(BAY - 0.3, BAY, 0, h, FIN)
        rect(0, BAY, h - 0.6, h, FIN)
    return save_images(name, col, glow)


TEX = {
    "atre": facade("eb_atre", JR_H),
    "upper": facade("eb_upper", UPPER[4] - JR_H, kind="tower", panel=STONE),
    "station": facade("eb_station", STATION_H, panel=PALE),
    "west": facade("eb_west", WEST_H, panel=BEIGE),
    "parking": facade("eb_parking", PARKING_H, kind="parking"),
}


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
    "atre": material("EB_Atre", tex=TEX["atre"]),
    "upper": material("EB_Upper", tex=TEX["upper"], rough=0.2),
    "station": material("EB_Station", tex=TEX["station"]),
    "west": material("EB_West", tex=TEX["west"]),
    "parking": material("EB_Parking", tex=TEX["parking"], rough=0.9),
    "roof": material("EB_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("EB_Tunnel", (0.3, 0.3, 0.31), rough=0.9),  # 線路の上の天井と、両わきの壁
    "platform": material("EB_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("EB_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("EB_Canopy", (0.78, 0.79, 0.8), rough=0.5),
    "post": material("EB_Post", (0.35, 0.37, 0.4), rough=0.5),
    "trim": material("EB_Trim", (0.7, 0.71, 0.72), rough=0.5),
    "signboard": material("EB_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("EB_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("EB_Export")
preview_col = bpy.data.collections.new("EB_Preview")
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


# 建物
portal_building(JR_BLDG, JR_H, JR_PORTAL, "atre", JR_H)
ux0, ux1, uy0, uy1, uh = UPPER
box(ux0, ux1, uy0, uy1, JR_H, uh, "upper")
box(ux0 + 0.6, ux1 - 0.6, uy0 + 0.6, uy1 - 0.6, uh, uh + 2.5, "trim")
portal_building(clip(STATION, ('ge', 39.1), axis=0), STATION_H, STATION_PORTAL, "station", STATION_H)
prism(WEST, 0, WEST_H, "west", WEST_H)
portal_building(PARKING, PARKING_H, PARKING_PORTAL, "parking", PARKING_H)

# ホーム（X < 0 は地面の高さ、X ≧ 0 は高架の上）と、南のホームの屋根
for x0, x1, y0, y1 in PLATFORMS:
    for a, b, base in ((x0, min(x1, 0.0), 0.0), (0.0, x1, ELEVATED)):
        if b - a < 1:
            continue
        box(a, b, y0, y1, base - (1.1 if base else 0.0), base + 1.0, "platform")
        for yy in (y0 + 0.25, y1 - 0.25):  # 黄色い線
            face([(a, yy - 0.15, base + 1.01), (b, yy - 0.15, base + 1.01), (b, yy + 0.15, base + 1.01), (a, yy + 0.15, base + 1.01)], "edge")
    c1 = min(x1, CANOPY_X1)
    if c1 - x0 > 5:
        ym = (y0 + y1) / 2
        box(x0 + 2, c1, y0 - 0.3, y1 + 0.3, 4.8, 5.1, "canopy")
        for x in np.arange(x0 + 6, c1, 10.0):
            box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, 1.0, 4.8, "post", top=False)

# 駅名の板
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * (0.55 if text.isascii() is False else 0.35) + 1.5
    if rotz == -90:  # 南向き（-X）
        face([(x - 0.05, y + w / 2, z - 0.4), (x - 0.05, y - w / 2, z - 0.4), (x - 0.05, y - w / 2, z + size + 0.4), (x - 0.05, y + w / 2, z + size + 0.4)], "signboard")
    else:
        s = 1 if rotz == 0 else -1
        yy = y + (0.05 if s > 0 else -0.05)
        pts = [(x - w / 2 * s, yy, z - 0.4), (x + w / 2 * s, yy, z - 0.4), (x + w / 2 * s, yy, z + size + 0.4), (x - w / 2 * s, yy, z + size + 0.4)]
        face(pts, "signboard")

me = bpy.data.meshes.new("EB_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("EB_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("EB_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("EB_Sign", cu)
    off = {-90: (-0.15, 0), 0: (0, -0.15), 180: (0, 0.15)}[rotz]
    sign.location = (x + off[0], y + off[1], z)
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
gm = bpy.data.meshes.new("EB_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("EB_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("EB_PreviewGround", gm))
sun = bpy.data.objects.new("EB_Sun", bpy.data.lights.new("EB_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("EB_Camera", bpy.data.cameras.new("EB_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-150, -150, 70)
cam.rotation_euler = (mathutils.Vector((-40, 10, 10)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("EB_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "ebisu_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
