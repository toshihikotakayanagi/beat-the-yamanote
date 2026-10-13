# 池袋駅東口の駅ビル（西武池袋本店。2026 年からは「ヨドバシ池袋」との複合施設）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-ikebukuro-station.py -- <保存先の .blend>
#
# 輪郭は OpenStreetMap の way 715271280（building=train_station。線路の東に沿った、北ほど細いくさび形と、
# 南の西武池袋線のホームの上の部分）をそのまま立ち上げる。高さは OSM にないので、地上 12 階から 48m とする。
# 正面は東（明治通り側の東口。方位 94°）。地図の歩道が正面にぶつかる X = -23 と -5 のあいだに東口の入口を置く。
# 外観は百貨店らしい簡略化：1 階はガラスの店先、上は窓の少ない外壁パネル、最上階の近くだけ窓の帯。
# 店名やロゴは入れない（看板は文字のない色の板）。
# 座標（m）：X は正面の辺に沿う向き（北が +）、Y は奥行き（正面が -Y、線路側が +Y）、Z は高さ。
# 原点は輪郭の範囲の中心（緯度 35.728955、経度 139.711663）。
# 書き出すものはコレクション「IK_Export」、下見用の地面・カメラ・光は「IK_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("ikebukuro_station.blend")

# ---- 寸法 ----
# 輪郭（上から見て反時計回り。OSM の 47 点）
FOOTPRINT = [(155.3, -49.3), (156.2, -46.6), (157.6, -42.5), (164.8, -21), (4.1, 32.6), (-53.3, 47.7), (-59.6, 49.3),
             (-64, 32.4), (-66.8, 21.5), (-69.6, 12.6), (-106.2, 12.4), (-106.3, 28.2), (-128.9, 28.2), (-128.9, 40.5),
             (-163.2, 40.4), (-163.5, 28), (-163.8, -3.2), (-163.9, -6.4), (-161.7, -6.5), (-162.9, -13.8), (-164.8, -26),
             (-145.5, -28.3), (-118.2, -28.6), (-118.3, -25.2), (-117.6, -25.2), (-117.5, -29.3), (-110.5, -29.3),
             (-106.2, -24.1), (-106.1, -14.1), (-107.3, -14), (-107.3, -13.6), (-106.1, -13.6), (-106.1, 6.6), (-69.5, 6.7),
             (-69.4, 4.8), (-75.5, 4.8), (-83.2, 4.8), (-82.9, -7.6), (-82.9, -13.6), (-88.3, -15.2), (-93.2, -15.2),
             (-93.2, -28.7), (-90.3, -28.5), (-90.3, -31.7), (-69.2, -31.9), (-22.1, -31.9), (103.3, -31.4)]
H = 48.0  # 高さ（地上 12 階）
FLOOR1 = 6.0  # 1 階の高さ
FLOOR = 4.2  # 2 階より上の 1 階ぶん
ENTRANCE = dict(x=(-24.0, -4.0), depth=5.0, z=4.8)  # 東口の入口
SIGNS = [  # 文字のない看板の板（X0, X1, Z0, Z1, 色）
    (20.0, 44.0, 26.0, 40.0, (0.75, 0.1, 0.12)),
    (-60.0, -40.0, 18.0, 36.0, (0.1, 0.35, 0.6)),
]
BAY = 6.0


def front_y(x):
    """正面の辺（Y が小さい側）の、X での Y"""
    pts = [(-69.2, -31.9), (-22.1, -31.9), (103.3, -31.4), (155.3, -49.3)]
    for (xa, ya), (xb, yb) in zip(pts[:-1], pts[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return pts[0][1]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "ikebukuro_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(31)

PANEL = np.array([0.8, 0.78, 0.74])  # 薄いベージュの外壁パネル
FIN = np.array([0.72, 0.72, 0.7])
FASCIA = np.array([0.22, 0.23, 0.25])
GLASS = np.array([0.12, 0.15, 0.19])
FRAME = np.array([0.35, 0.36, 0.38])
LIGHT = np.array([1.0, 0.86, 0.66])


class Canvas:
    def __init__(self, w_m, h_m, px_w):
        self.ppm = px_w / w_m
        self.w, self.h = px_w, int(round(h_m * self.ppm))
        self.col = np.zeros((self.h, self.w, 3))
        self.glow = np.zeros((self.h, self.w, 3))

    def rect(self, x0, x1, z0, z1, color, glow=None):
        a, b, c, d = (int(round(v * self.ppm)) for v in (x0, z0, x1, z1))
        self.col[max(b, 0):max(d, 0), max(a, 0):max(c, 0)] = color
        if glow is not None:
            self.glow[max(b, 0):max(d, 0), max(a, 0):max(c, 0)] = glow

    def save(self, name):
        imgs = []
        for arr, n in ((self.col, name), (self.glow, name + "_glow")):
            img = bpy.data.images.new(n, self.w, self.h, alpha=False)
            rgba = np.ones((self.h, self.w, 4), np.float32)
            noise = rng.normal(0, 0.012, (self.h, self.w, 1)) if n == name else 0
            rgba[..., :3] = np.clip(arr + noise, 0, 1)
            img.pixels.foreach_set(rgba.ravel())
            img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
            img.file_format = 'PNG'
            img.save()
            imgs.append(img)
        return imgs


def facade(name, windows=True, shop=True):
    """1 間（6m）ぶんの壁。1 階は店先のガラス（shop）、上は窓の少ない外壁（windows で窓を入れる）と縦のフィン"""
    c = Canvas(BAY, H, 96)
    c.rect(0, BAY, 0, H, PANEL)
    if shop:
        c.rect(0, BAY, 0, FLOOR1 - 1.0, GLASS, LIGHT)
        for x in (0.1, BAY / 2, BAY - 0.1):
            c.rect(x - 0.08, x + 0.08, 0, FLOOR1 - 1.0, FRAME)
    else:
        c.rect(0, BAY, 0, 0.8, FIN)
    c.rect(0, BAY, FLOOR1 - 1.0, FLOOR1, FASCIA)
    floors = int((H - 2.4 - FLOOR1) // FLOOR)
    for f in range(floors):
        z = FLOOR1 + f * FLOOR
        if windows and f >= floors - 3:  # 上の 3 階（レストラン街）は横長の窓
            lit = LIGHT * rng.uniform(0.4, 1.0)
            c.rect(0.3, BAY - 0.3, z + 1.0, z + 3.2, GLASS, lit)
            c.rect(BAY / 2 - 0.05, BAY / 2 + 0.05, z + 1.0, z + 3.2, FRAME)
        elif windows and f % 3 == 1:  # ところどころに細い縦の窓
            lit = LIGHT * rng.uniform(0.2, 0.8)
            c.rect(BAY / 2 - 0.35, BAY / 2 + 0.35, z + 0.8, z + 3.4, GLASS, lit)
        if f % 3 == 2:
            c.rect(0, BAY, z + FLOOR - 0.25, z + FLOOR, FIN)  # 3 階ごとの横の帯
    c.rect(0, 0.35, FLOOR1, H - 2.4, FIN)  # 縦のフィン
    c.rect(BAY - 0.35, BAY, FLOOR1, H - 2.4, FIN)
    c.rect(0, BAY, H - 2.4, H, FIN)  # 屋上の縁
    c.rect(0, BAY, H - 2.4, H - 2.25, FASCIA)
    return c.save(name)


TEX = {"front": facade("ik_front"), "back": facade("ik_back", windows=False, shop=False)}


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
    "front": material("IK_Front", tex=TEX["front"]),
    "back": material("IK_Back", tex=TEX["back"]),
    "roof": material("IK_Roof", (0.4, 0.4, 0.41)),
    "trim": material("IK_Trim", (0.6, 0.6, 0.6)),
    "fascia": material("IK_Fascia", (0.12, 0.13, 0.15)),
    "entrance": material("IK_Entrance", (0.1, 0.12, 0.15), emit=(1.0, 0.9, 0.75), strength=1.0),
    "sign": material("IK_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
for k, (_, _, _, _, col) in enumerate(SIGNS):
    MAT[f"board{k}"] = material(f"IK_Board{k}", col, emit=col, strength=0.8)
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("IK_Export")
preview_col = bpy.data.collections.new("IK_Preview")
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


def wall(a, b, z0, z1, mat):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / BAY))
    face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat,
         [(0, z0 / H), (n, z0 / H), (n, z1 / H), (0, z1 / H)])


def box(x0, x1, y0, y1, z0, z1, mat, top=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)


# 本体：正面と南北の端は店先と窓の壁、線路側（裏）は窓の少ない壁
n = len(FOOTPRINT)
for k in range(n):
    a, b = FOOTPRINT[k], FOOTPRINT[(k + 1) % n]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    back = (a[0] - b[0]) / L > 0.5  # 外向きの法線が +Y（線路側）を向く辺
    wall(a, b, 0, H, "back" if back else "front")
face([(x, y, H) for x, y in FOOTPRINT[::-1]], "roof", tile=6)
for k in range(n):  # 屋上のパラペット
    a, b = FOOTPRINT[k], FOOTPRINT[(k + 1) % n]
    face([(a[0], a[1], H), (b[0], b[1], H), (b[0], b[1], H + 1.2), (a[0], a[1], H + 1.2)], "trim")
# 屋上の設備（箱）
box(-40, -10, -20, 0, H, H + 4.5, "trim")
box(40, 70, -24, -6, H, H + 3.0, "trim")
box(-150, -125, -15, 5, H, H + 3.5, "trim")
# 東口の入口：奥まった明るい開口、ひさし、駅名の帯
ex0, ex1 = ENTRANCE["x"]
fy = front_y((ex0 + ex1) / 2)  # 正面の辺の、入口のあたりの Y
d, ez = ENTRANCE["depth"], ENTRANCE["z"]
face([(ex0, fy - 0.05, 0), (ex1, fy - 0.05, 0), (ex1, fy - 0.05, ez), (ex0, fy - 0.05, ez)], "entrance")
for zz, rev in ((ez, True), (ez + 0.5, False)):  # ひさし
    pts = [(ex0 - 1, fy - d, zz), (ex1 + 1, fy - d, zz), (ex1 + 1, fy, zz), (ex0 - 1, fy, zz)]
    face(pts[::-1] if rev else pts, "trim")
for a, b in [((ex0 - 1, fy - d), (ex1 + 1, fy - d)), ((ex1 + 1, fy - d), (ex1 + 1, fy)), ((ex0 - 1, fy), (ex0 - 1, fy - d))]:
    face([(a[0], a[1], ez), (b[0], b[1], ez), (b[0], b[1], ez + 0.5), (a[0], a[1], ez + 0.5)], "trim")
box(ex0 - 3, ex1 + 3, fy - 0.4, fy - 0.05, ez + 0.5, ez + 3.6, "fascia")  # 駅名の帯
# 文字のない看板の板（壁から少し浮かせる）
for k, (x0, x1, z0, z1, _) in enumerate(SIGNS):
    y = min(front_y(x0), front_y(x1)) - 0.25
    face([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], f"board{k}")

me = bpy.data.meshes.new("IK_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("IK_Station", me)
export_col.objects.link(ob)
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

# ---- 駅名（東口の上の帯） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
cu = bpy.data.curves.new("IK_SignText", 'FONT')
cu.body = "池袋駅　東口"
if font:
    cu.font = font
cu.size = 2.2
cu.extrude = 0.05
cu.resolution_u = 2  # 文字の曲線を粗く分ける
cu.align_x = 'CENTER'
sign = bpy.data.objects.new("IK_Sign", cu)
sign.location = ((ex0 + ex1) / 2, fy - 0.5, ez + 1.25)
sign.rotation_euler = (math.radians(90), 0, 0)
export_col.objects.link(sign)
cu.materials.append(MAT["sign"])
bpy.context.view_layer.objects.active = sign
sign.select_set(True)
bpy.ops.object.convert(target='MESH')

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=220)
gm = bpy.data.meshes.new("IK_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("IK_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("IK_PreviewGround", gm))
sun = bpy.data.objects.new("IK_Sun", bpy.data.lights.new("IK_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("IK_Camera", bpy.data.cameras.new("IK_Camera"))
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (-120, -170, 40)
cam.rotation_euler = (mathutils.Vector((0, 0, 20)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("IK_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "ikebukuro_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in export_col.objects)
print(f"BUILT {out} tris={tris}")
