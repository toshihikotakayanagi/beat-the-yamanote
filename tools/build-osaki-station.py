# 大崎駅（線路の上の橋上駅舎）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-osaki-station.py -- <保存先の .blend>
#
# OSM の駅（relation 18199254、building=train_station、layer 2）は線路の上の橋上駅舎で、地図データ（multipolygon）には
# 入っていない。その輪郭を、床の下面 11m（ゲームが高さ 6m の高架として描く線路の電車より上）から屋根 18m まで立ち上げ、
# ガラスの壁で包み、4 本のホーム（way 146060233 / 146060234 / 70705027 / 726566375）の上の橋脚だけで支える。
# 東西の端の面に駅名を付ける。地上からの入口の塔は、まわりの道路・歩道にかかるので作らない。
# 外観は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路と直角（東のゲートシティ側が +）、Y は線路の向き（北北西が +。正面は南南東の -Y）、Z は高さ。
# 原点は山手線の 2 本のホームの中心（緯度 35.620257、経度 139.728063）。
# 書き出すものはコレクション「OS_Export」、下見用の地面・カメラ・光は「OS_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("osaki_station.blend")

# ---- 寸法 ----
# 橋上駅舎の輪郭（OSM。上から見て時計回り）
OUTLINE = [(-50.4, -33.9), (-52.8, -80.9), (-30.2, -81.8), (-29.6, -51.6), (-9.2, -52.2), (-9.0, -109.5), (-14.9, -109.5),
           (-15.5, -124.0), (-15.8, -152.1), (-3.4, -152.3), (9.4, -152.8), (10.7, -91.3), (10.7, -88.8), (13.6, -33.7),
           (19.5, -34.0), (24.4, -34.2), (24.7, -28.6), (25.2, 0.5), (-9.5, 0.3), (-9.6, -5.0), (-12.7, -4.9),
           (-32.2, -4.3), (-32.5, -12.5), (-32.6, -16.4), (-30.9, -16.5), (-31.3, -27.5), (-45.4, -26.9), (-45.5, -34.3)]
BOTTOM, FLOOR, ROOF = 11.0, 12.3, 18.0  # 床の下面・床面・屋根
PLATFORM_X = [7.5, -6.6, -33.8, -45.9]  # ホームの中央（橋脚を立てる）
PIER_STEP = 24.0  # 橋脚の間隔（Y 方向）
SIGNS = [((25.25, -14.0), 90), ((-45.6, -30.6), -90)]  # 駅名（位置, Z の回転：90 は東向き、-90 は西向き）
MULLION = 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "osaki_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(97)

GLASS = np.array([0.16, 0.22, 0.28])
MULL = np.array([0.8, 0.81, 0.83])
LIGHT = np.array([1.0, 0.88, 0.7])


def curtain(name, h, px=64):
    """ガラスのカーテンウォール（3m 幅・高さ 1 枚ぶん）。下に床の帯"""
    ppm = px / MULLION
    H = int(round(h * ppm))
    col = np.zeros((H, px, 3))
    glow = np.zeros((H, px, 3))
    col[:] = GLASS
    glow[:] = LIGHT * 0.8
    col[:, :3] = MULL
    col[:, -3:] = MULL
    a = int(1.0 * ppm)
    col[:a] = MULL * 0.85
    glow[:a] = 0
    col[-int(0.6 * ppm):] = MULL
    glow[-int(0.6 * ppm):] = 0
    imgs = []
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, px, H, alpha=False)
        rgba = np.ones((H, px, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.01, (H, px, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


TEX = {"glass": curtain("os_glass", ROOF - BOTTOM)}


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
    "glass": material("OS_Glass", tex=TEX["glass"], rough=0.1),
    "roof": material("OS_Roof", (0.62, 0.64, 0.66), rough=0.5, metal=0.3),
    "under": material("OS_Under", (0.5, 0.51, 0.52), rough=0.8),
    "column": material("OS_Column", (0.78, 0.79, 0.8), rough=0.5, metal=0.2),
    "signboard": material("OS_Signboard", (0.12, 0.13, 0.15), rough=0.5),
    "sign": material("OS_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("OS_Export")
preview_col = bpy.data.collections.new("OS_Preview")
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


def box(x0, x1, y0, y1, z0, z1, mat, top=True, bottom=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    if bottom:
        face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


def inside(x, y, poly):
    c = False
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
    return c


ring = OUTLINE[::-1]  # 反時計回り（外から見て左から右に壁を貼る）
n = len(ring)
for k in range(n):
    a, b = ring[k], ring[(k + 1) % n]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    m = max(1, round(L / MULLION))
    face([(a[0], a[1], BOTTOM), (b[0], b[1], BOTTOM), (b[0], b[1], ROOF), (a[0], a[1], ROOF)], "glass", [(0, 0), (m, 0), (m, 1), (0, 1)])
    face([(a[0], a[1], ROOF), (b[0], b[1], ROOF), (b[0], b[1], ROOF + 0.9), (a[0], a[1], ROOF + 0.9)], "column")  # 屋上の縁
face([(x, y, BOTTOM) for x, y in OUTLINE], "under", tile=6)  # 床の下面（上から見て時計回り＝下向き）
face([(x, y, ROOF) for x, y in ring], "roof", tile=6)
# 橋脚（ホームの中央に、PIER_STEP ごと。輪郭の内側だけ）
ys = [p[1] for p in OUTLINE]
for x in PLATFORM_X:
    for y in np.arange(max(ys) - 4.0, min(ys), -PIER_STEP):
        if inside(x, y, OUTLINE) and inside(x, y - 1.5, OUTLINE) and inside(x, y + 1.5, OUTLINE):
            box(x - 0.55, x + 0.55, y - 0.55, y + 0.55, 0, BOTTOM, "column", top=False, bottom=False)
# 駅名の板
for (x, y), rotz in SIGNS:
    d = 0.3 if rotz > 0 else -0.3
    box(min(x, x + d), max(x, x + d), y - 6.0, y + 6.0, ROOF - 4.4, ROOF - 1.4, "signboard")

me = bpy.data.meshes.new("OS_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("OS_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for (x, y), rotz in SIGNS:
    cu = bpy.data.curves.new("OS_SignText", 'FONT')
    cu.body = "大崎駅"
    if font:
        cu.font = font
    cu.size = 2.2
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("OS_Sign", cu)
    sign.location = (x + (0.36 if rotz > 0 else -0.36), y, ROOF - 3.7)
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
gm = bpy.data.meshes.new("OS_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("OS_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("OS_PreviewGround", gm))
sun = bpy.data.objects.new("OS_Sun", bpy.data.lights.new("OS_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("OS_Camera", bpy.data.cameras.new("OS_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (90, 40, 35)
cam.rotation_euler = (mathutils.Vector((-10, -60, 8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("OS_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "osaki_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
