# 浜松町駅（JR の北口・南口のコンコースと、東京モノレールの浜松町駅とその車両）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-hamamatsucho-station.py -- <保存先の .blend>
#
# ・東京モノレールの浜松町駅：OSM の駅舎（way 210374585、5 階建て）の輪郭を高さ 16m で立ち上げる。ゲームはモノレールの
#   軌道を高さ 6m の高架の線路として描くので、駅舎はそれを包み、線路側（東）と南の端はホームの高さ（6〜11.5m）を柱だけに
#   して、ホームと、停まっている車両（6 両、白に青とオレンジの帯）が見えるようにする
# ・JR の北口・南口：ゲームの地図では駅（way 128195825 / 1222654212）がホームと線路を覆う高い箱になっていたので描かず、
#   線路をまたぐコンコースの橋（下面 11m。ゲームの山手線はここでは高さ 6m の高架）を北口と南口に架ける。
#   東の端は地上からの階段の塔と駅名、西の端は線路と歩道のあいだの細い橋脚で支える。南口の橋脚はホームの上にも立てる
# 位置は OpenStreetMap のホーム（way 128195173 / 128195824、モノレールは 670546029 / 670547885）と改札口に合わせた。
# 形と色は、写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北東が +。方位 11.7°）、Y は西が +（正面は東の -Y）、Z は高さ。
# 原点は JR の 2 本のホームの中心（緯度 35.655527、経度 139.757173）。
# 書き出すものはコレクション「HM_Export」、下見用の地面・カメラ・光は「HM_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("hamamatsucho_station.blend")

# ---- 寸法 ----
# モノレールの駅舎の輪郭（OSM。上から見て時計回りなので、下で反時計回りに直す）
MONO = [(22.7, 51.6), (23.6, 41.3), (59.4, 43.7), (60.6, 28.0), (24.9, 26.4), (-6.7, 25.9), (-13.1, 25.8), (-27.9, 25.6),
        (-35.6, 25.5), (-41.7, 25.4), (-62.4, 25.1), (-63.7, 27.0), (-50.3, 30.7), (-51.0, 37.5), (-66.6, 32.7),
        (-71.4, 39.6), (-68.1, 41.3), (-55.6, 42.5), (-55.7, 44.6), (-29.0, 47.2), (-29.1, 48.4), (-2.1, 51.1),
        (8.0, 51.8), (8.1, 50.5)]
MONO_H = 16.0
OPEN = (6.0, 11.5)  # 柱だけにする高さ（ホームの階）
MONO_PLATFORMS = [(-49.0, 54.0, 28.8, 33.1), (-50.0, 54.0, 35.6, 40.4)]  # モノレールのホーム（X0, X1, Y0, Y1）
TRAIN = dict(x0=-47.0, y=34.6, cars=6, car=15.2, gap=0.6)  # 停まっている車両（線路の真上）
RAIL_Z = 6.1  # ゲームの高架の線路の高さ
# JR のコンコースの橋（X の中心, 幅）。Y は東の塔から西の橋脚まで
BRIDGES = [dict(x=85.0, w=14.0, name="浜松町駅　北口", piers_y=[]), dict(x=-85.0, w=14.0, name="浜松町駅　南口", piers_y=[-6.0, 8.0])]
BRIDGE_Y = (-36.0, 16.8)
BRIDGE_Z = (11.0, 17.5)  # 床の下面と屋根
TOWER_Y = (-42.0, -36.0)  # 東の階段の塔
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "hamamatsucho_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(83)

PANEL = np.array([0.83, 0.84, 0.85])
FIN = np.array([0.66, 0.68, 0.7])
GLASS = np.array([0.12, 0.16, 0.2])
FRAME = np.array([0.32, 0.34, 0.36])
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
    """1 間（6m）：明るい外壁に、階ごとの横長のガラス（夜は灯る）"""
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
    for z in np.arange(1.0, h - 1.5, 3.6):
        rect(0.4, BAY - 0.4, z, z + 2.2, GLASS, LIGHT * rng.uniform(0.4, 1.0))
        rect(BAY / 2 - 0.05, BAY / 2 + 0.05, z, z + 2.2, FRAME)
    rect(0, 0.3, 0, h, FIN)
    rect(BAY - 0.3, BAY, 0, h, FIN)
    rect(0, BAY, h - 0.8, h, FIN)
    return save_images(name, col, glow)


TEX = {"mono": facade("hm_mono", MONO_H), "tower": facade("hm_tower", BRIDGE_Z[1]), "bridge": facade("hm_bridge", BRIDGE_Z[1] - BRIDGE_Z[0])}


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
    "mono": material("HM_Mono", tex=TEX["mono"]),
    "tower": material("HM_Tower", tex=TEX["tower"]),
    "bridge": material("HM_Bridge", tex=TEX["bridge"]),
    "roof": material("HM_Roof", (0.5, 0.51, 0.53), rough=0.7),
    "column": material("HM_Column", (0.78, 0.79, 0.8), rough=0.5, metal=0.2),
    "deck": material("HM_Deck", (0.5, 0.5, 0.5), rough=0.8),
    "under": material("HM_Under", (0.8, 0.8, 0.78), rough=0.6, emit=(1.0, 0.95, 0.85), strength=0.35),
    "platform": material("HM_Platform", (0.6, 0.6, 0.6), rough=0.8),
    "car": material("HM_Car", (0.9, 0.91, 0.92), rough=0.3),  # モノレールの白
    "car_blue": material("HM_CarBlue", (0.02, 0.12, 0.45), rough=0.4),
    "car_orange": material("HM_CarOrange", (0.95, 0.35, 0.02), rough=0.4),
    "car_window": material("HM_CarWindow", (0.05, 0.07, 0.09), rough=0.1, emit=(1.0, 0.92, 0.78), strength=0.7),
    "car_under": material("HM_CarUnder", (0.25, 0.26, 0.28), rough=0.6),
    "signboard": material("HM_Signboard", (0.12, 0.13, 0.15), rough=0.5),
    "sign": material("HM_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("HM_Export")
preview_col = bpy.data.collections.new("HM_Preview")
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


# ---- モノレールの駅舎 ----
ring = MONO[::-1]  # 反時計回り（外から見て左から右に壁を貼る）
n = len(ring)
for k in range(n):
    a, b = ring[k], ring[(k + 1) % n]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L  # 外向きの法線
    open_band = ny < -0.7 or (a[0] + b[0]) / 2 < -50  # 線路側（東）の長い面と、軌道が出ていく南の端
    if open_band and L > 3:
        wall(a, b, 0, OPEN[0], "mono", MONO_H)
        wall(a, b, OPEN[1], MONO_H, "mono", MONO_H)
        face([(a[0], a[1], OPEN[0]), (b[0], b[1], OPEN[0]), (b[0] - nx * 0.6, b[1] - ny * 0.6, OPEN[0]), (a[0] - nx * 0.6, a[1] - ny * 0.6, OPEN[0])][::-1], "deck")
        for t in np.arange(0, 1.0001, 8.0 / L if L > 8 else 1.0):  # 柱
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, OPEN[0], OPEN[1], "column", top=False, bottom=False)
    else:
        wall(a, b, 0, MONO_H, "mono", MONO_H)
face([(x, y, MONO_H) for x, y in ring], "roof", tile=6)
face([(x, y, OPEN[1] - 0.01) for x, y in MONO], "under", tile=6)  # ホームの階の天井（夜は明るい）
for k in range(n):  # 屋上の縁
    a, b = ring[k], ring[(k + 1) % n]
    face([(a[0], a[1], MONO_H), (b[0], b[1], MONO_H), (b[0], b[1], MONO_H + 0.8), (a[0], a[1], MONO_H + 0.8)], "column")
for x0, x1, y0, y1 in MONO_PLATFORMS:
    box(x0, x1, y0, y1, OPEN[0] - 0.3, OPEN[0] + 0.9, "platform", bottom=False)

# ---- 停まっているモノレールの車両（白に青とオレンジの帯、窓） ----
def car(x0, x1, y, z0, front=None):
    """八角形に近い断面の箱。front は先頭の向き（-1 か 1）。先頭は前を斜めに絞る"""
    hw, zb, zt = 1.5, z0, z0 + 3.0
    sec = [(-hw, zb + 0.3), (hw, zb + 0.3), (hw, zt - 0.45), (hw - 0.35, zt), (-hw + 0.35, zt), (-hw, zt - 0.45)]
    xa, xb = x0, x1
    nose = 1.6

    def ring_at(x, s=1.0, dz=0.0):
        return [(x, y + q[0] * s, zb + (q[1] - zb) * s + dz) for q in sec]

    ra, rb = ring_at(xa), ring_at(xb)
    if front == -1:
        ra = ring_at(xa - nose, 0.72, 0.15)
    if front == 1:
        rb = ring_at(xb + nose, 0.72, 0.15)
    for k in range(len(sec)):
        face([ra[k], rb[k], rb[(k + 1) % len(sec)], ra[(k + 1) % len(sec)]], "car")
    face(ra[::-1], "car_window" if front == -1 else "car")
    face(rb, "car_window" if front == 1 else "car")
    for side in (-1, 1):  # 帯と窓（側面に少し浮かせる）
        yy = y + side * (hw + 0.02)
        for z0b, z1b, mat in ((zb + 0.75, zb + 1.15, "car_blue"), (zb + 1.2, zb + 1.32, "car_orange"), (zb + 1.6, zb + 2.35, "car_window")):
            pts = [(xa + 0.6, yy, z0b), (xb - 0.6, yy, z0b), (xb - 0.6, yy, z1b), (xa + 0.6, yy, z1b)]
            face(pts if side < 0 else pts[::-1], mat)
    box(xa + 0.8, xb - 0.8, y - 1.2, y + 1.2, z0 - 0.25, zb + 0.3, "car_under", top=False)  # 台車のスカート


x = TRAIN["x0"]
for i in range(TRAIN["cars"]):
    front = -1 if i == 0 else (1 if i == TRAIN["cars"] - 1 else None)
    car(x, x + TRAIN["car"], TRAIN["y"], RAIL_Z + 0.25, front)
    x += TRAIN["car"] + TRAIN["gap"]

# ---- JR のコンコースの橋（北口・南口） ----
y0, y1 = BRIDGE_Y
zb, zt = BRIDGE_Z
for br in BRIDGES:
    bx0, bx1 = br["x"] - br["w"] / 2, br["x"] + br["w"] / 2
    box(bx0, bx1, y0, y1, zb, zb + 1.2, "deck")  # 床
    face([(bx0, y1, zb - 0.01), (bx1, y1, zb - 0.01), (bx1, y0, zb - 0.01), (bx0, y0, zb - 0.01)], "under")
    wall((bx0, y1), (bx0, y0), zb + 1.2, zt, "bridge", zt - zb)  # 南の面（外から見て左から右）
    wall((bx1, y0), (bx1, y1), zb + 1.2, zt, "bridge", zt - zb)  # 北の面
    face([(bx0 - 0.5, y0, zt), (bx1 + 0.5, y0, zt), (bx1 + 0.5, y1 + 0.5, zt), (bx0 - 0.5, y1 + 0.5, zt)], "roof")
    wall((bx1, y1), (bx0, y1), zb + 1.2, zt, "bridge", zt - zb)  # 西の端
    # 東の階段の塔（地上から屋根まで）
    t0, t1 = TOWER_Y
    for a, b in [((bx0, t0), (bx1, t0)), ((bx1, t0), (bx1, t1)), ((bx0, t1), (bx0, t0))]:
        wall(a, b, 0, zt, "tower", zt)
    face([(bx0, t0, zt), (bx1, t0, zt), (bx1, t1, zt), (bx0, t1, zt)], "roof")
    box(bx0 + 1.0, bx1 - 1.0, t0 - 0.45, t0 - 0.05, zt - 3.6, zt - 1.0, "signboard")  # 駅名の板（東向き）
    # 西の端の橋脚と、ホームの上の橋脚
    for py in [y1 - 0.6] + br["piers_y"]:
        for px in (bx0 + 1.5, bx1 - 1.5):
            box(px - 0.45, px + 0.45, py - 0.45, py + 0.45, 0, zb, "column", top=False, bottom=False)

me = bpy.data.meshes.new("HM_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("HM_Station", me)
export_col.objects.link(ob)

# ---- 文字 ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
TEXTS = [(br["name"], (br["x"], TOWER_Y[0] - 0.5, zt - 2.95), 0, 1.0) for br in BRIDGES]  # 東向き
TEXTS += [("モノレール浜松町", (-2.0, 25.6, MONO_H - 2.6), 0, 1.6)]  # 駅舎の線路側（東向き）
for text, loc, rotz, size in TEXTS:
    cu = bpy.data.curves.new("HM_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("HM_Sign", cu)
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
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=160)
gm = bpy.data.meshes.new("HM_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("HM_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("HM_PreviewGround", gm))
sun = bpy.data.objects.new("HM_Sun", bpy.data.lights.new("HM_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("HM_Camera", bpy.data.cameras.new("HM_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (-20, -110, 30)
cam.rotation_euler = (mathutils.Vector((0, 5, 8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("HM_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "hamamatsucho_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
