# 秋葉原駅（山手線の高架と、その上を東西に渡る総武線のホーム）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-akihabara-station.py -- <保存先の .blend>
#
# 実物は 2 階の山手線・京浜東北線（南北）の上を、3 階の総武線（東西）が渡る。ゲームは高架の線路をみな
# 同じ高さ（6m）で描くので、総武線のホームの床は作らず、電車より上（14m〜）の大屋根と、その下の駅の建物を作る。
#   ・西の建物（アトレ秋葉原 1 のあたり。電気街口）と東の建物（中央改札口）：山手線の高架（X ≒ -32〜24）と、
#     東の道路（X ≒ 70〜96）をあけて置く
#   ・総武線のホームの大屋根：両方の建物と東の端の柱で支え、山手線の上は柱なしで渡す。軒に総武線の黄色の帯
# 位置は OpenStreetMap の総武線のホーム（way 60538892 / 89028742）・駅の建物（way 89028748 / 686402038）に合わせた。
# 外観は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は総武線の向き（東が +。方位 95.6°）、Y は北が +（正面は南の -Y）、Z は高さ。
# 原点は総武線の 2 本のホームの中心（緯度 35.698339、経度 139.773213）。
# 書き出すものはコレクション「AK_Export」、下見用の地面・カメラ・光は「AK_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("akihabara_station.blend")

# ---- 寸法 ----
WEST = dict(x=(-112.0, -34.0), y=(-19.0, 20.0), h=13.0)  # 電気街口の建物
EAST = dict(x=(26.0, 68.0), y=(-22.0, -3.0), h=13.0)  # 中央改札口の建物
ROOF_X = (-118.0, 116.0)  # 総武線のホームの屋根
ROOF_Y = (-10.5, 13.5)
ROOF_LOW, ROOF_EAVE, ROOF_RIDGE = 14.0, 14.8, 16.6  # 屋根の下面・軒・棟
FASCIA = 1.6  # 軒の帯の高さ（山手線の上では梁を兼ねる）
END_COLUMNS = [(110.0, -8.0), (110.0, 11.0), (100.0, -8.0), (100.0, 11.0)]  # 東の端の柱（道路の東）
BAY = 5.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "akihabara_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(53)

PANEL = np.array([0.85, 0.84, 0.8])
FIN = np.array([0.7, 0.7, 0.68])
FASCIA_C = np.array([0.22, 0.23, 0.25])
GLASS = np.array([0.12, 0.15, 0.19])
FRAME = np.array([0.35, 0.36, 0.38])
LIGHT = np.array([1.0, 0.86, 0.66])


def facade(name, h, px=96):
    """駅ビルの 1 間（5m）：1 階はガラス、上は 3 段の横長の窓"""
    ppm = px / BAY
    H = int(round(h * ppm))
    col = np.zeros((H, px, 3))
    glow = np.zeros((H, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, PANEL)
    rect(0, BAY, 0, 3.6, GLASS, LIGHT)
    rect(BAY / 2 - 0.06, BAY / 2 + 0.06, 0, 3.6, FRAME)
    rect(0, BAY, 3.6, 4.4, FASCIA_C)
    for z in (5.2, 7.8, 10.4):
        rect(0.3, BAY - 0.3, z, z + 1.7, GLASS, LIGHT * rng.uniform(0.3, 1.0))
    rect(0, 0.3, 4.4, h, FIN)
    rect(BAY - 0.3, BAY, 4.4, h, FIN)
    rect(0, BAY, h - 0.6, h, FIN)
    imgs = []
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, px, H, alpha=False)
        rgba = np.ones((H, px, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.012, (H, px, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


TEX = {"wall": facade("ak_wall", 13.0)}


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
    "wall": material("AK_Wall", tex=TEX["wall"]),
    "roof": material("AK_Roof", (0.7, 0.72, 0.74), rough=0.4, metal=0.4),
    "under": material("AK_Under", (0.82, 0.83, 0.84), rough=0.6, emit=(1.0, 0.95, 0.85), strength=0.3),  # 屋根の裏（夜は明るい）
    "fascia": material("AK_Fascia", (0.86, 0.87, 0.88), rough=0.5),
    "sobu": material("AK_Sobu", (0.98, 0.78, 0.0), rough=0.5),  # 総武線の黄色
    "column": material("AK_Column", (0.75, 0.76, 0.77), rough=0.5, metal=0.3),
    "top": material("AK_Top", (0.45, 0.46, 0.47), rough=0.8),
    "signboard": material("AK_Signboard", (0.12, 0.13, 0.15), rough=0.5),
    "sign": material("AK_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("AK_Export")
preview_col = bpy.data.collections.new("AK_Preview")
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


# 駅の建物（上から見て反時計回りに壁を貼る：外から見て左から右）
for b in (WEST, EAST):
    (x0, x1), (y0, y1), h = b["x"], b["y"], b["h"]
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(4):
        wall(pts[k], pts[(k + 1) % 4], 0, h, "wall", 13.0)
    face([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], "top")
    # 建物の上から屋根の下までの短い柱
    for x in np.linspace(x0 + 2, x1 - 2, max(2, int((x1 - x0) // 14) + 1)):
        for y in (ROOF_Y[0] + 1.0, ROOF_Y[1] - 1.0):
            if y0 < y < y1:
                box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, h, ROOF_LOW, "column", top=False, bottom=False)
# 東の端の柱（地面から）
for x, y in END_COLUMNS:
    box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, 0, ROOF_LOW, "column", top=False, bottom=False)

# 総武線のホームの大屋根：下面・軒の帯（黄色の線入り）・切妻の上面
rx0, rx1 = ROOF_X
ry0, ry1 = ROOF_Y
ym = (ry0 + ry1) / 2
face([(rx0, ry1, ROOF_LOW), (rx1, ry1, ROOF_LOW), (rx1, ry0, ROOF_LOW), (rx0, ry0, ROOF_LOW)], "under", tile=6)
for a, b in [((rx0, ry0), (rx1, ry0)), ((rx1, ry0), (rx1, ry1)), ((rx1, ry1), (rx0, ry1)), ((rx0, ry1), (rx0, ry0))]:
    face([(a[0], a[1], ROOF_LOW - FASCIA + 0.8), (b[0], b[1], ROOF_LOW - FASCIA + 0.8), (b[0], b[1], ROOF_EAVE), (a[0], a[1], ROOF_EAVE)], "fascia")
    # 軒の帯の下に、山手線の上を渡る梁（帯を下へ伸ばす）と黄色の線
    face([(a[0], a[1], ROOF_LOW - FASCIA), (b[0], b[1], ROOF_LOW - FASCIA), (b[0], b[1], ROOF_LOW - FASCIA + 0.8), (a[0], a[1], ROOF_LOW - FASCIA + 0.8)], "fascia")
for y, s in ((ry0 - 0.05, 1), (ry1 + 0.05, -1)):
    face([(rx0, y, ROOF_LOW - 0.25), (rx1, y, ROOF_LOW - 0.25), (rx1, y, ROOF_LOW + 0.2), (rx0, y, ROOF_LOW + 0.2)][::s], "sobu")
face([(rx0, ry0, ROOF_EAVE), (rx1, ry0, ROOF_EAVE), (rx1, ym, ROOF_RIDGE), (rx0, ym, ROOF_RIDGE)], "roof", tile=6)
face([(rx1, ry1, ROOF_EAVE), (rx0, ry1, ROOF_EAVE), (rx0, ym, ROOF_RIDGE), (rx1, ym, ROOF_RIDGE)], "roof", tile=6)
face([(rx0, ry1, ROOF_EAVE), (rx0, ry0, ROOF_EAVE), (rx0, ym, ROOF_RIDGE)], "fascia")
face([(rx1, ry0, ROOF_EAVE), (rx1, ry1, ROOF_EAVE), (rx1, ym, ROOF_RIDGE)], "fascia")

# 駅名の板：電気街口（西の建物の西の面）・中央改札口（東の建物の東の面）・屋根の軒（南と北）
wx0 = WEST["x"][0]
box(wx0 - 0.4, wx0 - 0.05, -9.0, 9.0, 4.4, 6.8, "signboard")
ex1 = EAST["x"][1]
box(ex1 + 0.05, ex1 + 0.4, EAST["y"][0] + 2.0, EAST["y"][1] - 2.0, 4.4, 6.8, "signboard")
# 電気街口のひさし
for zz, rev in ((3.8, True), (4.3, False)):
    pts = [(wx0 - 5, -10, zz), (wx0, -10, zz), (wx0, 10, zz), (wx0 - 5, 10, zz)]
    face(pts[::-1] if rev else pts, "fascia")

me = bpy.data.meshes.new("AK_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("AK_Station", me)
export_col.objects.link(ob)
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

# ---- 文字 ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
# （本文, 位置, Z の回転：0 は南（-Y）向き、-90 は西向き、90 は東向き、180 は北向き, 大きさ）
TEXTS = [
    ("秋葉原駅　電気街口", (wx0 - 0.45, 0.0, 5.0), -90, 1.6),
    ("秋葉原駅　中央改札口", (ex1 + 0.45, (EAST["y"][0] + EAST["y"][1]) / 2, 5.0), 90, 1.2),
    ("秋葉原駅", (-4.0, ry0 - 0.1, ROOF_LOW - FASCIA + 0.25), 0, 1.3),
    ("秋葉原駅", (-4.0, ry1 + 0.1, ROOF_LOW - FASCIA + 0.25), 180, 1.3),
]
for text, loc, rotz, size in TEXTS:
    cu = bpy.data.curves.new("AK_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描くので、板の文字で足りる。厚みがあると側面で何倍も重くなる）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("AK_Sign", cu)
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
gm = bpy.data.meshes.new("AK_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("AK_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("AK_PreviewGround", gm))
sun = bpy.data.objects.new("AK_Sun", bpy.data.lights.new("AK_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("AK_Camera", bpy.data.cameras.new("AK_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (-150, -110, 40)
cam.rotation_euler = (mathutils.Vector((-20, 0, 8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("AK_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "akihabara_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
