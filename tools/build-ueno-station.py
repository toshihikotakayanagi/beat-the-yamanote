# 上野駅の駅舎（1932 年の二代目駅舎。正面玄関口）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-ueno-station.py -- <保存先の .blend>
#
# 輪郭は OpenStreetMap の駅舎（way 175223851、高さ 20m）。砕石入りモルタルの外壁の、昭和初期の
# 落ち着いた建物で、正面は東（低地の側。南東、方位 137.4°）を向き、車寄せがある。
# 窓・帯は画像（テクスチャ）に描いて壁に貼り、夜の窓は明かりの画像（放射のテクスチャ）で灯す。
# 細部（窓の割り付け・中央の大窓・車寄せの形）は、写真の雰囲気をもとにした簡略化。
# 座標（m）：X は正面の辺に沿う向き（北東が +）、Y は奥行き（正面が -Y）、Z は高さ。
# 原点は駅舎の輪郭の中心（緯度 35.712253、経度 139.776149）。
# 書き出すものはコレクション「UE_Export」、下見用の地面・カメラ・光は「UE_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("ueno_station.blend")

# ---- 寸法 ----
# OSM の輪郭（上から見て反時計回り。正面は Y = -27.5 の辺。この向きだと wall() の画像が外から正しく見える）
FOOTPRINT = [(-22.6, -27.5), (39.3, -27.5), (60.3, -20.5), (52.0, 3.6), (45.9, 1.7), (41.5, 14.9), (37.0, 28.0),
             (12.5, 21.3), (-10.8, 18.0), (-11.6, 21.2), (-37.5, 13.2), (-53.4, 6.8), (-52.0, 3.2), (-49.9, -2.3),
             (-41.5, -23.7), (-22.7, -23.6)]
MAIN_H = 14.5  # 建物の高さ
HALL = dict(x=(-14.0, 26.0), y=(-28.3, 6.0), h=20.0)  # 中央の大窓の棟（正面から 0.8m 出す）
CANOPY = dict(x=(-10.0, 22.0), y=(-34.0, -28.3), z=5.6)  # 車寄せのひさし
BAY = 4.5  # 窓の間隔

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "ueno_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(11)

# ---- テクスチャ（m 単位で描き、行 0 が下。色は sRGB のまま） ----
WALL = np.array([0.78, 0.74, 0.66])  # 砕石入りモルタル
WALL_DARK = np.array([0.6, 0.57, 0.51])
TRIM = np.array([0.86, 0.83, 0.76])
GLASS = np.array([0.1, 0.13, 0.17])
FRAME = np.array([0.3, 0.3, 0.3])
LIGHT = np.array([1.0, 0.8, 0.55])


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

    def speckle(self, z0, z1, base):
        """砕石入りモルタルのざらつき"""
        a, b = int(z0 * self.ppm), int(z1 * self.ppm)
        n = rng.normal(0, 0.035, (b - a, self.w, 1)) + rng.normal(0, 0.02, (b - a, 1, 1))
        self.col[a:b] = base + n

    def window(self, cx, z0, z1, w, rows=2, lit=None):
        lit = rng.uniform(0.3, 1.0) if lit is None else lit
        self.rect(cx - w / 2 - 0.12, cx + w / 2 + 0.12, z0 - 0.12, z1 + 0.12, TRIM)
        self.rect(cx - w / 2, cx + w / 2, z0, z1, GLASS, LIGHT * lit)
        self.rect(cx - 0.035, cx + 0.035, z0, z1, FRAME)
        for r in range(1, rows):
            z = z0 + (z1 - z0) * r / rows
            self.rect(cx - w / 2, cx + w / 2, z - 0.035, z + 0.035, FRAME)

    def save(self, name):
        imgs = []
        for arr, n in ((self.col, name), (self.glow, name + "_glow")):
            img = bpy.data.images.new(n, self.w, self.h, alpha=False)
            rgba = np.ones((self.h, self.w, 4), np.float32)
            rgba[..., :3] = np.clip(arr, 0, 1)
            img.pixels.foreach_set(rgba.ravel())
            img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
            img.file_format = 'PNG'
            img.save()
            imgs.append(img)
        return imgs


# 両わきの棟：3 段の縦長の窓、1 階の上に帯、上に軒の帯
c = Canvas(BAY, MAIN_H, 192)
c.speckle(0, MAIN_H, WALL)
c.rect(0, BAY, 0, 1.0, WALL_DARK)
c.rect(0, BAY, 5.7, 6.1, TRIM)
c.rect(0, BAY, MAIN_H - 1.2, MAIN_H, TRIM)
c.rect(0, BAY, MAIN_H - 1.2, MAIN_H - 1.1, WALL_DARK)
c.window(BAY / 2, 1.6, 4.9, 1.6, rows=3)
c.window(BAY / 2, 7.0, 9.6, 1.4, rows=2)
c.window(BAY / 2, 10.6, 12.6, 1.4, rows=2)
TEX = {"wing": c.save("ue_wing")}
# 中央の棟：柱のあいだの大きなガラス窓（障子のような格子）と、1 階の入口
c = Canvas(4.0, HALL["h"], 160)
c.speckle(0, HALL["h"], WALL)
c.rect(0, 4.0, 0, 0.6, WALL_DARK)
lit = rng.uniform(0.7, 1.0)
c.rect(0.45, 3.55, 0.6, 3.6, GLASS, LIGHT)  # 入口
c.rect(1.97, 2.03, 0.6, 3.6, FRAME)
c.rect(0.45, 3.55, 3.6, 4.2, TRIM)
c.rect(0.45, 3.55, 4.6, 17.4, GLASS, LIGHT * lit)  # 大窓
for z in np.arange(4.6, 17.4, 1.6):
    c.rect(0.45, 3.55, z - 0.05, z + 0.05, FRAME)
for x in (1.48, 2.52):
    c.rect(x - 0.05, x + 0.05, 4.6, 17.4, FRAME)
c.rect(0, 0.45, 0, HALL["h"], TRIM)  # 柱
c.rect(3.55, 4.0, 0, HALL["h"], TRIM)
c.rect(0, 4.0, HALL["h"] - 1.6, HALL["h"], TRIM)
c.rect(0, 4.0, HALL["h"] - 1.6, HALL["h"] - 1.45, WALL_DARK)
TEX["hall"] = c.save("ue_hall")
# 中央の棟の横・裏：窓の少ない壁
c = Canvas(4.0, HALL["h"], 128)
c.speckle(0, HALL["h"], WALL)
c.rect(0, 4.0, 0, 0.6, WALL_DARK)
c.rect(0, 4.0, HALL["h"] - 1.6, HALL["h"], TRIM)
c.window(2.0, 15.0, 17.6, 1.2, rows=2)
TEX["hallside"] = c.save("ue_hallside")


def material(name, color=None, tex=None, rough=0.8, emit=None, strength=0.0):
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
    "wing": material("UE_Wing", tex=TEX["wing"]),
    "hall": material("UE_Hall", tex=TEX["hall"]),
    "hallside": material("UE_HallSide", tex=TEX["hallside"]),
    "roof": material("UE_Roof", (0.36, 0.35, 0.33)),
    "trim": material("UE_Trim", (0.6, 0.57, 0.5)),
    "canopy": material("UE_Canopy", (0.42, 0.42, 0.42)),
    "sign": material("UE_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("UE_Export")
preview_col = bpy.data.collections.new("UE_Preview")
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


def wall(a, b, z0, z1, mat, tex_h, bay):
    """a → b の壁（外から見て左から右）。横は bay ごとに繰り返し、縦は tex_h（m）で画像 1 枚"""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / bay))
    face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat,
         [(0, z0 / tex_h), (n, z0 / tex_h), (n, z1 / tex_h), (0, z1 / tex_h)])


def box_walls(x0, x1, y0, y1, h, mats, tex_h, bay):
    """箱の 4 面（正面・右・裏・左の順に mats）と屋上"""
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(4):
        wall(pts[k], pts[(k + 1) % 4], 0, h, mats[k], tex_h, bay)
    face([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], "roof", tile=6)


# 本体：輪郭を立ち上げた壁と、平らな屋上・屋上の縁
n = len(FOOTPRINT)
for k in range(n):
    a, b = FOOTPRINT[k], FOOTPRINT[(k + 1) % n]
    wall(a, b, 0, MAIN_H, "wing", MAIN_H, BAY)
face([(x, y, MAIN_H) for x, y in FOOTPRINT[::-1]], "roof", tile=6)
for k in range(n):  # 屋上のパラペット（低い立ち上がり）
    a, b = FOOTPRINT[k], FOOTPRINT[(k + 1) % n]
    face([(a[0], a[1], MAIN_H), (b[0], b[1], MAIN_H), (b[0], b[1], MAIN_H + 0.9), (a[0], a[1], MAIN_H + 0.9)], "trim", tile=4)
# 中央の大窓の棟
x0, x1 = HALL["x"]
y0, y1 = HALL["y"]
box_walls(x0, x1, y0, y1, HALL["h"], ["hall", "hallside", "hallside", "hallside"], HALL["h"], 4.0)
for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
    face([(a[0], a[1], HALL["h"]), (b[0], b[1], HALL["h"]), (b[0], b[1], HALL["h"] + 1.0), (a[0], a[1], HALL["h"] + 1.0)], "trim", tile=4)
# 車寄せのひさし（薄い板と細い柱）
cx0, cx1 = CANOPY["x"]
cy0, cy1 = CANOPY["y"]
z = CANOPY["z"]
for zz, rev in ((z, True), (z + 0.6, False)):
    pts = [(cx0, cy0, zz), (cx1, cy0, zz), (cx1, cy1, zz), (cx0, cy1, zz)]
    face(pts[::-1] if rev else pts, "canopy", tile=4)
for a, b in [((cx0, cy0), (cx1, cy0)), ((cx1, cy0), (cx1, cy1)), ((cx0, cy1), (cx0, cy0))]:
    face([(a[0], a[1], z), (b[0], b[1], z), (b[0], b[1], z + 0.6), (a[0], a[1], z + 0.6)], "trim", tile=4)
for px in np.linspace(cx0 + 0.6, cx1 - 0.6, 5):
    s = 0.25
    for a, b in [((px - s, cy0 + 0.4), (px + s, cy0 + 0.4)), ((px + s, cy0 + 0.4), (px + s, cy0 + 0.9)),
                 ((px + s, cy0 + 0.9), (px - s, cy0 + 0.9)), ((px - s, cy0 + 0.9), (px - s, cy0 + 0.4))]:
        face([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], z), (a[0], a[1], z)], "trim", tile=4)

me = bpy.data.meshes.new("UE_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("UE_Station", me)
export_col.objects.link(ob)
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

# ---- 駅名（中央の棟の上） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
cu = bpy.data.curves.new("UE_SignText", 'FONT')
cu.body = "上野駅"
if font:
    cu.font = font
cu.size = 2.6
cu.extrude = 0.08
cu.resolution_u = 2  # 文字の曲線を粗く分ける（細かいと文字だけで数千ポリゴンになる）
cu.align_x = 'CENTER'
sign = bpy.data.objects.new("UE_Sign", cu)
sign.location = ((x0 + x1) / 2, y0 - 0.12, HALL["h"] - 1.35)
sign.rotation_euler = (math.radians(90), 0, 0)  # 立てて、正面（-Y）に向ける
export_col.objects.link(sign)
cu.materials.append(MAT["sign"])
bpy.context.view_layer.objects.active = sign
sign.select_set(True)
bpy.ops.object.convert(target='MESH')

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=150)
gm = bpy.data.meshes.new("UE_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("UE_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("UE_PreviewGround", gm))
sun = bpy.data.objects.new("UE_Sun", bpy.data.lights.new("UE_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("UE_Camera", bpy.data.cameras.new("UE_Camera"))
cam.data.lens = 30
preview_col.objects.link(cam)
cam.location = (40, -110, 22)
cam.rotation_euler = (mathutils.Vector((5, 0, 9)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("UE_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "ueno_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in export_col.objects)
print(f"BUILT {out} tris={tris}")
