# 品川駅の、線路の上を東西に渡るコンコース（高輪口〜港南口の自由通路）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-shinagawa-station.py -- <保存先の .blend>
#
# OSM の駅（relation 2106999、layer 3）は線路の上に広く広がるが、全部をふさぐとホームや電車が隠れるので、
# 高輪口と港南口を結ぶ東西の通路（地図の歩行者道）に沿った幅 30m の部分だけを作る。
# 西の端は高輪口（第一京浜に面した、地上から立ち上がるガラスの正面と駅名）、東の端は港南口の入口。
# 線路の上は床の下面を 11.5m にして、京急や新幹線の高架の線路の電車にもかからないようにし、橋脚はホームの上だけに立てる。
# 外観（ガラスのカーテンウォール、天窓の筋、駅名）は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は通路の向き（東が +。方位 86.3°）、Y は通路と直角（北が +。正面は南の -Y）、Z は高さ。
# 原点は通路の線の上（緯度 35.628864、経度 139.739046）。
# 書き出すものはコレクション「SG_Export」、下見用の地面・カメラ・光は「SG_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("shinagawa_station.blend")

# ---- 寸法 ----
X0, X1 = -121.0, 124.0  # 西の端（第一京浜の東の縁）〜東の端（港南口）
Y0, Y1 = -13.0, 17.0  # 幅（東寄りで通路が北へ 15m ほど曲がるぶんを含む）
DECK_BOTTOM, FLOOR = 11.5, 13.0  # 床の下面と床面（線路の上）
ROOF = 22.0  # 屋根の高さ
WEST = (-121.0, -100.0)  # 高輪口の建物（地上から）
EAST = (116.0, 124.0)  # 港南口の建物（地上から）
PIERS_X = [-56.7, -41.6, -24.5, -9.1, 10.3, 33.5, 52.4, 68.3, 90.3, 105.7]  # ホームの中央（線路を避ける）
PIERS_Y = [-6.0, 10.0]
MULLION = 3.0  # ガラスの方立ての間隔

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "shinagawa_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(41)

# ---- ガラスのカーテンウォールの画像（3m 幅・高さ 1 枚ぶん。行 0 が下、色は sRGB のまま） ----
GLASS = np.array([0.16, 0.22, 0.28])
MULL = np.array([0.78, 0.8, 0.82])
LIGHT = np.array([1.0, 0.88, 0.7])


def curtain(name, h, px=64, floors=()):
    ppm = px / MULLION
    H = int(round(h * ppm))
    col = np.zeros((H, px, 3))
    glow = np.zeros((H, px, 3))
    col[:] = GLASS
    glow[:] = LIGHT * 0.8
    col[:, :3] = MULL  # 方立て
    col[:, -3:] = MULL
    for z in floors:  # 床の線（不透明な帯）
        a, b = int(z * ppm), int((z + 0.9) * ppm)
        col[a:b] = MULL * 0.85
        glow[a:b] = 0
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


TEX = {
    "concourse": curtain("sg_concourse", ROOF - FLOOR, floors=[0.0]),  # 床から屋根まで
    "entrance": curtain("sg_entrance", ROOF, floors=[0.0, 6.0, 12.6]),  # 地上から屋根まで（高輪口・港南口）
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
    "concourse": material("SG_Concourse", tex=TEX["concourse"], rough=0.1),
    "entrance": material("SG_Entrance", tex=TEX["entrance"], rough=0.1),
    "roof": material("SG_Roof", (0.62, 0.64, 0.66), rough=0.5, metal=0.3),
    "skylight": material("SG_Skylight", (0.2, 0.28, 0.34), rough=0.1, emit=(1.0, 0.92, 0.8), strength=0.6),
    "deck": material("SG_Deck", (0.5, 0.51, 0.52), rough=0.8),
    "under": material("SG_Under", (0.36, 0.37, 0.38), rough=0.8),
    "fascia": material("SG_Fascia", (0.14, 0.15, 0.17), rough=0.5),
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


def glass_wall(a, b, z0, z1, mat):
    """a → b（上から見て反時計回りの向き＝外から見て左から右）のガラスの壁。方立ては MULLION ごと"""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / MULLION))
    face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat, [(0, 0), (n, 0), (n, 1), (0, 1)])


def box(x0, x1, y0, y1, z0, z1, mat, top=True, bottom=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    if bottom:
        face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


def rect_walls(x0, x1, y0, y1, z0, z1, mat, skip=()):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(4):
        if k not in skip:
            glass_wall(pts[k], pts[(k + 1) % 4], z0, z1, mat)


# 線路の上のコンコース：床板・ガラスの壁（南北）・屋根と天窓
w0, w1 = WEST[1], EAST[0]
box(w0, w1, Y0, Y1, DECK_BOTTOM, FLOOR, "deck")
face([(w0, Y1, DECK_BOTTOM - 0.01), (w1, Y1, DECK_BOTTOM - 0.01), (w1, Y0, DECK_BOTTOM - 0.01), (w0, Y0, DECK_BOTTOM - 0.01)], "under")
glass_wall((w0, Y0), (w1, Y0), FLOOR, ROOF, "concourse")
glass_wall((w1, Y1), (w0, Y1), FLOOR, ROOF, "concourse")
# 高輪口・港南口：地上から屋根までのガラスの建物（コンコースにつながる側の壁は作らない）
rect_walls(WEST[0], WEST[1], Y0, Y1, 0, ROOF, "entrance", skip=(1,))
rect_walls(EAST[0], EAST[1], Y0, Y1, 0, ROOF, "entrance", skip=(3,))
# 屋根（縁は少し張り出す）と、真ん中の天窓の筋
o = 0.8
for x0, x1 in ((X0, X1),):
    face([(x0 - o, Y0 - o, ROOF), (x1 + o, Y0 - o, ROOF), (x1 + o, Y1 + o, ROOF), (x0 - o, Y1 + o, ROOF)], "roof", tile=6)
    for a, b in [((x0 - o, Y0 - o), (x1 + o, Y0 - o)), ((x1 + o, Y0 - o), (x1 + o, Y1 + o)), ((x1 + o, Y1 + o), (x0 - o, Y1 + o)), ((x0 - o, Y1 + o), (x0 - o, Y0 - o))]:
        face([(a[0], a[1], ROOF - 1.0), (b[0], b[1], ROOF - 1.0), (b[0], b[1], ROOF), (a[0], a[1], ROOF)], "roof", tile=6)
ym = (Y0 + Y1) / 2
face([(X0 + 4, ym - 4, ROOF), (X1 - 4, ym - 4, ROOF), (X1 - 4, ym, ROOF + 2.0), (X0 + 4, ym, ROOF + 2.0)], "skylight")
face([(X1 - 4, ym + 4, ROOF), (X0 + 4, ym + 4, ROOF), (X0 + 4, ym, ROOF + 2.0), (X1 - 4, ym, ROOF + 2.0)], "skylight")
face([(X0 + 4, ym - 4, ROOF), (X0 + 4, ym, ROOF + 2.0), (X0 + 4, ym + 4, ROOF)], "roof")
face([(X1 - 4, ym + 4, ROOF), (X1 - 4, ym, ROOF + 2.0), (X1 - 4, ym - 4, ROOF)], "roof")
# 橋脚（ホームの上）と、その上の梁
for x in PIERS_X:
    for y in PIERS_Y:
        box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 0, DECK_BOTTOM, "deck", top=False, bottom=False)
    box(x - 0.6, x + 0.6, Y0 + 1, Y1 - 1, DECK_BOTTOM - 1.0, DECK_BOTTOM, "under", top=False)
# 高輪口のひさしと駅名の帯
cz = 4.6
for zz, rev in ((cz, True), (cz + 0.5, False)):
    pts = [(X0 - 5, Y0 + 4, zz), (X0, Y0 + 4, zz), (X0, Y1 - 4, zz), (X0 - 5, Y1 - 4, zz)]
    face(pts[::-1] if rev else pts, "roof")
box(X0 - 0.5, X0 - 0.05, Y0 + 3, Y1 - 3, ROOF - 4.2, ROOF - 1.0, "fascia")
box(X1 + 0.05, X1 + 0.5, Y0 + 5, Y1 - 5, ROOF - 4.2, ROOF - 1.0, "fascia")

me = bpy.data.meshes.new("SG_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("SG_Station", me)
export_col.objects.link(ob)
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

# ---- 駅名（高輪口は西向き、港南口は東向き） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, x, rotz in (("品川駅　高輪口", X0 - 0.55, -90), ("品川駅　港南口", X1 + 0.55, 90)):
    cu = bpy.data.curves.new("SG_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = 2.0
    cu.extrude = 0.05
    cu.resolution_u = 2
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("SG_Sign", cu)
    sign.location = (x, (Y0 + Y1) / 2, ROOF - 3.3)
    sign.rotation_euler = (math.radians(90), 0, math.radians(rotz))  # 立てて、外（西 / 東）に向ける
    export_col.objects.link(sign)
    cu.materials.append(MAT["sign"])
    bpy.context.view_layer.objects.active = sign
    for o2 in bpy.context.view_layer.objects:
        o2.select_set(False)
    sign.select_set(True)
    bpy.ops.object.convert(target='MESH')

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=180)
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
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (-190, -100, 35)
cam.rotation_euler = (mathutils.Vector((-40, 0, 12)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
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
scene.render.filepath = os.path.join(os.path.dirname(out), "shinagawa_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
