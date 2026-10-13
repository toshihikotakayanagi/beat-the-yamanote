# 原宿駅（2020 年にできた線路の上をまたぐ新しい駅舎、ホームとその屋根、竹下口、明治神宮側の臨時口）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-harajuku-station.py -- <保存先の .blend>
#
# 新しい駅舎は表参道口（東）から線路の上を通って明治神宮側（西）へ渡る 2 階建て。地図の建物の箱（高さ 6m）は線路を
# ふさいでいるので、線路が通る帯（Y ≒ 10.5〜34）を地上 6.5m まであけ、その上を 2 階のコンコースにする。
#   ・駅舎：OSM の輪郭（way 823006849。表参道口の前の斜めの辺は、正面を平らにするため四角くした）を高さ 11.5m で立ち上げる。
#     ホームの南の部分の上は駅舎のコンコースになる
#   ・ホーム：OSM の 1 番線・2 番線（way 144430695 / 366845929）。駅舎より北には屋根（way 504640327 など）を付ける
#   ・竹下口（way 542472441）と明治神宮側の臨時口（way 542472442）の小さな建物
# 形と色は写真の雰囲気をもとにした簡略化（白い柱とガラスの駅舎）。
# 座標（m）：X は線路の向き（北が +。方位 8°）、Y は西が +（正面は表参道口の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.6702、経度 139.7027）。線路は Y ≒ 12〜30 を通る。
# 書き出すものはコレクション「HJ_Export」、下見用の地面・カメラ・光は「HJ_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("harajuku_station.blend")

# ---- 寸法 ----
CORRIDOR = (10.5, 34.0)  # 線路が通る帯（Y）
STATION = [(38.5, 21.1), (49.0, 20.8), (54.8, 20.5), (92.3, 19.3), (92.4, 21.3), (96.0, 21.3), (96.0, 24.3), (92.4, 24.4),
           (92.4, 26.5), (59.3, 27.3), (58.2, 37.8), (41.2, 39.4), (20.5, 38.9), (3.5, 37.6), (-27.3, 34.3), (-35.0, 33.8),
           (-33.2, -1.7), (-8.7, -1.7), (0.6, 27.6), (7.4, 28.0), (7.3, 22.1)]
STATION_H, STATION_PORTAL = 11.5, 6.5
TAKESHITA = [(177.6, 2.6), (146.9, 4.3), (146.8, 1.0), (161.3, 0.2), (163.0, 0.1), (165.4, 1.0), (167.6, 1.4), (170.2, 1.5),
             (174.7, 1.2), (175.7, 0.4), (176.0, -0.6), (177.4, -0.7)]
TAKESHITA_H = 6.0
JINGU = [(93.5, 43.6), (97.2, 43.4), (103.9, 43.1), (103.4, 34.0), (93.0, 34.0)]  # 臨時口（ホームにかからないよう南の辺を Y = 34 にそろえた）
JINGU_H = 5.0
PLATFORMS = [  # OSM のホームの輪郭（高さ 1m）
    [(227.8, 14.4), (209.7, 17.6), (192.1, 20.0), (166.9, 23.0), (136.5, 24.6), (111.1, 25.7), (85.0, 26.5), (34.0, 27.6),
     (20.7, 27.6), (-10.8, 26.7), (-22.7, 25.5), (-22.6, 23.6), (-22.5, 22.4), (-10.7, 22.4), (20.6, 22.2), (35.0, 21.7),
     (71.7, 19.9), (98.6, 19.1), (136.1, 18.1), (153.2, 17.3), (171.2, 16.3), (190.9, 14.6), (211.9, 12.7), (227.4, 10.9)],
    [(45.4, 30.8), (8.5, 30.9), (8.6, 32.9), (45.5, 33.7), (90.4, 32.2), (107.7, 31.6), (142.0, 30.4), (193.7, 25.3),
     (228.4, 20.3), (228.1, 17.9), (193.3, 22.6), (141.7, 27.2)],
]
ROOF_X0 = 92.0  # これより北のホームに屋根を付ける（南は駅舎の下）
ROOF_Z = 5.6
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 0 は -Y（東）向き、180 は +Y（西）向き、-90 は -X（南）向き
    ("原宿駅", (-21.0, -1.9, 7.4), 0, 2.6),
    ("原宿駅", (-35.2, 22.0, 7.6), -90, 2.4),
    ("原宿駅　竹下口", (162.0, -1.0, 3.6), 0, 1.0),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "harajuku_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(105)

WHITE = np.array([0.9, 0.9, 0.88])
GLASS = np.array([0.16, 0.2, 0.24])
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


def facade(name, h, floor=None, px=96):
    """白い柱と大きなガラスの壁（floor の高さに床の白い帯）"""
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, GLASS, LIGHT * 0.5)
    rect(BAY / 2 - 0.04, BAY / 2 + 0.04, 0, h, FRAME)
    if floor:
        rect(0, BAY, floor - 0.4, floor + 0.5, WHITE)
    rect(0, BAY, h - 1.2, h, WHITE)
    rect(0, 0.45, 0, h, WHITE)
    rect(BAY - 0.45, BAY, 0, h, WHITE)
    return save_images(name, col, glow)


TEX = {
    "station": facade("hj_station", STATION_H, floor=STATION_PORTAL),
    "small": facade("hj_small", TAKESHITA_H),
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
    "station": material("HJ_Station", tex=TEX["station"], rough=0.3),
    "small": material("HJ_Small", tex=TEX["small"], rough=0.3),
    "roof": material("HJ_Roof", (0.78, 0.79, 0.8), rough=0.6),
    "tunnel": material("HJ_Tunnel", (0.55, 0.56, 0.57), rough=0.8),  # 線路の上のコンコースの床下と、両わきの壁
    "platform": material("HJ_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "canopy": material("HJ_Canopy", (0.9, 0.9, 0.9), rough=0.5),
    "post": material("HJ_Post", (0.85, 0.86, 0.87), rough=0.5),
    "signboard": material("HJ_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("HJ_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("HJ_Export")
preview_col = bpy.data.collections.new("HJ_Preview")
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
portal_building(STATION, STATION_H, STATION_PORTAL, "station", STATION_H)
prism(TAKESHITA, 0, TAKESHITA_H, "small", TAKESHITA_H)
prism(JINGU, 0, JINGU_H, "small", TAKESHITA_H)

# ホームと、駅舎より北のホームの屋根
for poly in PLATFORMS:
    prism(poly, 0.0, 1.0, "platform", 1.0)
    part = clip(poly, ('ge', ROOF_X0), axis=0)
    if len(part) >= 3:
        prism(part, ROOF_Z, ROOF_Z + 0.3, "canopy", 0.3)
        xs = [p[0] for p in part]
        for x in np.arange(min(xs) + 4, max(xs) - 2, 12.0):  # 柱：ホームの幅のまん中に 12m おき
            sl = clip(clip(part, ('ge', x - 0.2), axis=0), ('le', x + 0.2), axis=0)
            if len(sl) < 3:
                continue
            ym = (min(p[1] for p in sl) + max(p[1] for p in sl)) / 2
            box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, 1.0, ROOF_Z, "post", top=False)

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

me = bpy.data.meshes.new("HJ_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("HJ_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("HJ_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("HJ_Sign", cu)
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
gm = bpy.data.meshes.new("HJ_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("HJ_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("HJ_PreviewGround", gm))
sun = bpy.data.objects.new("HJ_Sun", bpy.data.lights.new("HJ_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("HJ_Camera", bpy.data.cameras.new("HJ_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-120, -110, 60)
cam.rotation_euler = (mathutils.Vector((20, 20, 5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("HJ_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "harajuku_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
