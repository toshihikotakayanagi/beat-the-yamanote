# 五反田駅（JR の東口・西口と、東急池上線の高架のホームと車両）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-gotanda-station.py -- <保存先の .blend>
#
# ・JR：ゲームの地図では駅（way 998623261）が山手線の高架を覆う高い箱になっていたので描かず（ゲーム側の clear）、
#   高架の外の東側に 3 階建ての駅舎（東口。高架沿いの歩道をよけ、東口の通路は地上をあけた門にして駅名を付ける）と、
#   高架の下の西側の壁（高さは床板の下面 4.9m、西口の通路をあけて駅名）を作る
# ・東急池上線：実物は山手線の上を越える高い高架の終点だが、ゲームは池上線も高さ 6m の高架として描くので、その高さに
#   合わせて、OSM のホーム（way 847473695）の床と屋根、停まっている車両（3 両、ステンレスに緑の帯）を作る
# 位置は OpenStreetMap の駅・ホーム・改札口・ゲームの地図の線路に合わせた。形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は山手線の向き（北西が +。方位 -36.6°）、Y は南西が +（正面は北東の -Y）、Z は高さ。
# 原点は JR のホームの中心（緯度 35.626646、経度 139.723245）。
# 書き出すものはコレクション「GT_Export」、下見用の地面・カメラ・光は「GT_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("gotanda_station.blend")

# ---- 寸法 ----
EAST_PARTS = [(-106.0, -86.0), (-74.0, -55.0)]  # 東の駅舎（X の範囲。あいだは東口の通路）
EAST_Y = (-27.0, -19.0)
EAST_H = 12.0
GATE = (-86.0, -74.0, 6.0)  # 東口の門（X0, X1, 下の高さ）
WEST_Y = 22.5  # 西の壁（高架の下）
WEST_X = (-88.0, -37.0)
WEST_GAP = (-79.0, -70.0)  # 西口の通路
UNDER = 4.9  # 高架の床板の下面
IKE_PLATFORM = [(-177.4, 11.5), (-167.5, 15.4), (-183.8, 47.9), (-191.8, 63.4), (-198.7, 60.4), (-191.9, 43.2)]
IKE_TOP = 7.2  # ホームの上面（ゲームのホームと同じ：高架 6m + 0.1 + 1.1）
IKE_ROOF = 10.6
IKE_TRACK = ((-159.8, -0.4), (-191.4, 64.7))  # 停める線路（ゲームの地図の池上線の東側の線）
IKE_CAR, IKE_CARS, IKE_GAP = 18.0, 3, 0.5
RAIL_Z = 6.1
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "gotanda_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(101)

PANEL = np.array([0.84, 0.84, 0.83])
FIN = np.array([0.68, 0.69, 0.7])
GLASS = np.array([0.12, 0.15, 0.19])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.87, 0.68])


def facade(name, h, shop=True, px=96):
    """1 間（6m）：1 階は店先のガラス、上は階ごとの横長の窓"""
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
    if shop:
        rect(0.2, BAY - 0.2, 0.2, 3.6, GLASS, LIGHT)
        rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.2, 3.6, FRAME)
    for z in np.arange(4.8, h - 1.2, 3.6):
        rect(0.4, BAY - 0.4, z, z + 2.0, GLASS, LIGHT * rng.uniform(0.4, 1.0))
    rect(0, 0.3, 0, h, FIN)
    rect(BAY - 0.3, BAY, 0, h, FIN)
    rect(0, BAY, h - 0.6, h, FIN)
    imgs = []
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, px, Hp, alpha=False)
        rgba = np.ones((Hp, px, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.01, (Hp, px, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


TEX = {"east": facade("gt_east", EAST_H), "under": facade("gt_under", UNDER)}


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
    "east": material("GT_East", tex=TEX["east"]),
    "under": material("GT_Under", tex=TEX["under"]),
    "roof": material("GT_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "trim": material("GT_Trim", (0.7, 0.71, 0.72), rough=0.5),
    "signboard": material("GT_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("GT_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
    "platform": material("GT_Platform", (0.58, 0.58, 0.58), rough=0.8),
    "tactile": material("GT_Tactile", (0.9, 0.7, 0.08), rough=0.7),
    "canopy": material("GT_Canopy", (0.75, 0.76, 0.77), rough=0.5, emit=(1.0, 0.95, 0.85), strength=0.25),
    "column": material("GT_Column", (0.55, 0.56, 0.58), rough=0.5, metal=0.3),
    "car": material("GT_Car", (0.72, 0.74, 0.76), rough=0.25, metal=0.6),  # ステンレス
    "car_green": material("GT_CarGreen", (0.05, 0.45, 0.2), rough=0.4),
    "car_window": material("GT_CarWindow", (0.05, 0.07, 0.09), rough=0.1, emit=(1.0, 0.92, 0.78), strength=0.7),
    "car_under": material("GT_CarUnder", (0.2, 0.21, 0.22), rough=0.6),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("GT_Export")
preview_col = bpy.data.collections.new("GT_Preview")
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


def wall(a, b, z0, z1, mat, tex_h):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / BAY))
    face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat,
         [(0, z0 / tex_h), (n, z0 / tex_h), (n, z1 / tex_h), (0, z1 / tex_h)])


def box(x0, x1, y0, y1, z0, z1, mat, top=True, bottom=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    if bottom:
        face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


def oriented_box(c, d, length, width, z0, z1, mat):
    """中心 c、向き d（単位ベクトル）、長さ・幅の箱"""
    px, py = -d[1], d[0]
    hl, hw = length / 2, width / 2
    pts = [(c[0] + d[0] * sx * hl + px * sy * hw, c[1] + d[1] * sx * hl + py * sy * hw) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        a, b = pts[k], pts[(k + 1) % 4]
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    face([(x, y, z1) for x, y in pts], mat)
    face([(x, y, z0) for x, y in pts[::-1]], mat)
    return pts


# ---- JR の東の駅舎（東口）と門 ----
ey0, ey1 = EAST_Y
for x0, x1 in EAST_PARTS:
    pts = [(x0, ey0), (x1, ey0), (x1, ey1), (x0, ey1)]
    for k in range(4):
        wall(pts[k], pts[(k + 1) % 4], 0, EAST_H, "east", EAST_H)
    face([(x0, ey0, EAST_H), (x1, ey0, EAST_H), (x1, ey1, EAST_H), (x0, ey1, EAST_H)], "roof")
gx0, gx1, gz = GATE
box(gx0, gx1, ey0, ey1, gz, EAST_H, "trim", bottom=True)  # 通路の上を渡す部分
box(gx0 + 1.0, gx1 - 1.0, ey0 - 0.4, ey0 - 0.05, gz + 1.0, gz + 3.4, "signboard")  # 東口の駅名の板（北東向き）
for zz, rev in ((gz - 1.4, True), (gz - 1.0, False)):  # ひさし
    pts = [(gx0, ey0 - 4.0, zz), (gx1, ey0 - 4.0, zz), (gx1, ey0, zz), (gx0, ey0, zz)]
    face(pts[::-1] if rev else pts, "trim")
# ---- 西の壁（高架の下）と西口 ----
wx0, wx1 = WEST_X
g0, g1 = WEST_GAP
for a, b in (((wx1, WEST_Y), (g1, WEST_Y)), ((g0, WEST_Y), (wx0, WEST_Y))):  # 外（南西）から見て左から右
    wall(a, b, 0, UNDER, "under", UNDER)
box(g0, g1, WEST_Y - 0.1, WEST_Y + 0.4, UNDER - 1.9, UNDER - 0.1, "signboard")  # 西口の駅名の板（通路の上）

# ---- 東急池上線のホーム（床・点字ブロック・屋根・柱）と車両 ----
plat = IKE_PLATFORM
n = len(plat)
for k in range(n):
    a, b = plat[k], plat[(k + 1) % n]
    face([(a[0], a[1], RAIL_Z - 0.2), (b[0], b[1], RAIL_Z - 0.2), (b[0], b[1], IKE_TOP), (a[0], a[1], IKE_TOP)], "platform")
face([(x, y, IKE_TOP) for x, y in plat[::-1]], "platform")
(ax, ay), (bx, by) = IKE_TRACK
L = math.hypot(bx - ax, by - ay)
d = ((bx - ax) / L, (by - ay) / L)
# ホームの中心線（両端の中点）と屋根
c0 = ((plat[0][0] + plat[1][0]) / 2, (plat[0][1] + plat[1][1]) / 2)
c1 = ((plat[3][0] + plat[4][0]) / 2, (plat[3][1] + plat[4][1]) / 2)
cl = math.hypot(c1[0] - c0[0], c1[1] - c0[1])
cd = ((c1[0] - c0[0]) / cl, (c1[1] - c0[1]) / cl)
mid = ((c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2)
oriented_box(mid, cd, cl * 0.85, 7.5, IKE_ROOF, IKE_ROOF + 0.35, "canopy")
for t in np.linspace(-cl * 0.38, cl * 0.38, 6):
    c = (mid[0] + cd[0] * t, mid[1] + cd[1] * t)
    oriented_box(c, cd, 0.4, 0.4, IKE_TOP, IKE_ROOF, "column")
# 車両（線路の上。ホームの南の端から北へ並べる）
start = 18.0  # 線路の始点（南）からの距離
for i in range(IKE_CARS):
    s = start + i * (IKE_CAR + IKE_GAP) + IKE_CAR / 2
    c = (ax + d[0] * s, ay + d[1] * s)
    oriented_box(c, d, IKE_CAR, 2.8, RAIL_Z + 0.9, RAIL_Z + 4.0, "car")
    oriented_box(c, d, IKE_CAR - 2.0, 2.4, RAIL_Z + 0.2, RAIL_Z + 0.9, "car_under")
    oriented_box(c, d, IKE_CAR - 0.6, 2.84, RAIL_Z + 2.0, RAIL_Z + 2.35, "car_green")  # 帯
    oriented_box(c, d, IKE_CAR - 1.6, 2.86, RAIL_Z + 2.55, RAIL_Z + 3.4, "car_window")  # 窓

me = bpy.data.meshes.new("GT_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("GT_Station", me)
export_col.objects.link(ob)

# ---- 文字 ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
# （本文, 位置, Z の回転：0 は -Y（北東）向き、180 は +Y（南西）向き, 大きさ）
TEXTS = [("五反田駅　東口", ((gx0 + gx1) / 2, ey0 - 0.45, gz + 1.7), 0, 1.0),
         ("五反田駅　西口", ((g0 + g1) / 2, WEST_Y + 0.45, UNDER - 1.55), 180, 0.75)]
for text, loc, rotz, size in TEXTS:
    cu = bpy.data.curves.new("GT_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("GT_Sign", cu)
    sign.location = loc
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
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=220)
gm = bpy.data.meshes.new("GT_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("GT_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("GT_PreviewGround", gm))
sun = bpy.data.objects.new("GT_Sun", bpy.data.lights.new("GT_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("GT_Camera", bpy.data.cameras.new("GT_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (-60, -110, 40)
cam.rotation_euler = (mathutils.Vector((-130, 10, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("GT_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "gotanda_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
