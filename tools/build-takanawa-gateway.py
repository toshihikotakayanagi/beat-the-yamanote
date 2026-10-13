# 高輪ゲートウェイ駅の駅舎を Blender で組み立てる（隈研吾さん設計の、折り紙のような白い大屋根の駅）
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-takanawa-gateway.py -- <保存先の .blend>
#
# 寸法は OpenStreetMap の駅舎（way 781446220）とホーム・線路の位置に合わせた、簡略化したモデル。
# 座標（m）：X は線路の向き（南南西が +）、Y は線路と直角（東が +。正面の西口は -Y 側）、Z は高さ。
# 原点は駅舎の輪郭の中心（緯度 35.635739、経度 139.740657）。
# 組み立てるあいだは u = -X（北北東が +）で考え、最後に X を反転する（u と Y と Z のままだと左手系で、
# ゲームに置くと鏡に映したように南北が入れ替わる）。下の寸法の「X」はすべて u のこと
#   線路：山手線 Y = 0 / 11、京浜東北線 Y = 15 / 27.5、その東に東海道線など（Y = 33〜）
#   ホーム：山手線 Y = 1〜10（ゲームが描く）、京浜東北線 Y = 17〜26（このモデルに入れる）
# 書き出すもの（駅舎）はコレクション「TG_Export」に、下見用の地面・カメラ・光は「TG_Preview」に入れる。
# 保存先の隣に、下見の画像（takanawa_gateway_preview.png）も書き出す
import bpy, bmesh, math, os, sys

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("takanawa_gateway.blend")

# ---- 寸法 ----
# 大屋根の折り目（X 方向の区切り）。X = -14〜50 は 2 階のコンコース（線路の上の改札階）
U_SOUTH = [-108 + 11.75 * i for i in range(9)]  # -108〜-14（ホームの上だけの屋根）
U_NORTH = [-14 + 12.8 * i for i in range(6)]  # -14〜50（コンコースの上）
U = U_SOUTH + U_NORTH[1:]
V_IN = [5.5, 13.0, 21.5]  # 屋根の折り目（Y 方向）。5.5 と 21.5 はホームの中央（柱が立つ）
EAST = 30.5  # 東の端（京浜東北線 27.5 と東海道線 33 のあいだ）
WEST_SOUTH, WEST_NORTH = -7.2, -13.0  # 西の端（コンコースの部分は西口のぶん張り出す）
ROOF_LOW, ROOF_FOLD, ROOF_TILT = 17.0, 3.5, 1.5  # 屋根の低い所の高さ・折り目の高低差・西を高くする量
ROOF_T = 0.6  # 屋根の厚さ
FLOOR_Z = 8.6  # コンコースの床の下面（架線 6.2m より上）
FLOOR_T = 1.0
CONC_U0, CONC_U1 = -14.0, 50.0
ATRIUM_V = -3.0  # これより西は、地上から屋根までの吹き抜け（西口）
KT_PLATFORM = (-142.0, 67.0, 17.0, 26.0)  # 京浜東北線のホーム（X0, X1, Y0, Y1）
PLATFORM_TOP = 1.1

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'


def material(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


MAT = {
    "membrane": material("TG_Membrane", (0.9, 0.9, 0.87), 0.5, emit=(1.0, 0.93, 0.8), strength=0.35),  # 白い膜屋根（夜はほんのり光る）
    "wood": material("TG_Wood", (0.42, 0.26, 0.13), 0.7),  # 屋根の裏の木（秋田杉）
    "steel": material("TG_Steel", (0.82, 0.83, 0.83), 0.4, 0.3),  # 白い鉄骨・柱・方立て
    "glass": material("TG_Glass", (0.04, 0.07, 0.1), 0.1, emit=(1.0, 0.82, 0.55), strength=0.8),  # ガラス（夜は中の明かり）
    "concrete": material("TG_Concrete", (0.5, 0.5, 0.5), 0.8),
    "platform": material("TG_Platform", (0.46, 0.47, 0.49), 0.8),
    "tactile": material("TG_Tactile", (0.85, 0.62, 0.08), 0.7),  # 点字ブロック
    "sign": material("TG_Sign", (0.95, 0.95, 0.95), 0.5, emit=(1, 1, 1), strength=1.0),
}
export_col = bpy.data.collections.new("TG_Export")
preview_col = bpy.data.collections.new("TG_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


def new_object(name, bm, mats, col=export_col):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def quad(bm, pts, mi):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = mi
    return f


def box(bm, x0, x1, y0, y1, z0, z1, mi):
    v = [bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                     (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    for idx in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        bm.faces.new([v[i] for i in idx]).material_index = mi


def beam(bm, a, b, r, mi, sides=6):
    """a から b への細い角柱（柱・枝）"""
    import mathutils
    a, b = mathutils.Vector(a), mathutils.Vector(b)
    d = (b - a).normalized()
    side = d.orthogonal().normalized()
    up = d.cross(side)
    ring = lambda c: [bm.verts.new(c + (side * math.cos(t) + up * math.sin(t)) * r)
                      for t in (2 * math.pi * k / sides for k in range(sides))]
    ra, rb = ring(a), ring(b)
    for k in range(sides):
        bm.faces.new([ra[k], ra[(k + 1) % sides], rb[(k + 1) % sides], rb[k]]).material_index = mi
    bm.faces.new(ra[::-1]).material_index = mi
    bm.faces.new(rb).material_index = mi


# ---- 大屋根：格子の点の高さを互い違いにして、三角形に折る ----
def west_at(i):
    return WEST_NORTH if U[i] >= CONC_U0 else WEST_SOUTH


def grid_v(i):
    return [west_at(i)] + V_IN + [EAST]


def roof_z(i, j, y):
    """格子の点 (i, j)（Y = y）の屋根の上面の高さ。i + j が偶数の点を高くする"""
    return ROOF_LOW + (ROOF_FOLD if (i + j) % 2 == 0 else 0) + ROOF_TILT * (EAST - y) / (EAST - WEST_NORTH)


def roof_edge_z(i, v):
    """X = U[i] の線の上で、Y = v の所の屋根（上面）の高さ（格子の点のあいだは直線）"""
    vs = grid_v(i)
    for j in range(len(vs) - 1):
        if vs[j] <= v <= vs[j + 1]:
            t = (v - vs[j]) / (vs[j + 1] - vs[j])
            return roof_z(i, j, vs[j]) * (1 - t) + roof_z(i, j + 1, vs[j + 1]) * t
    raise ValueError(v)


bm = bmesh.new()
nj = len(V_IN) + 2
# 南（ホームの上）と北（コンコースの上）で西の端が違うので、2 枚に分けて作る（X = -14 の列は両方にある）
for i0, i1 in ((0, len(U_SOUTH)), (len(U_SOUTH) - 1, len(U))):
    west = WEST_SOUTH if i0 == 0 else WEST_NORTH
    top, bot = {}, {}
    for i in range(i0, i1):
        for j in range(nj):
            x, y = U[i], ([west] + V_IN + [EAST])[j]
            z = roof_z(i, j, y)
            top[i, j] = bm.verts.new((x, y, z))
            bot[i, j] = bm.verts.new((x, y, z - ROOF_T))
    for i in range(i0, i1 - 1):
        for j in range(nj - 1):
            a, b, c, d = (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
            tris = [(a, b, c), (a, c, d)] if (i + j) % 2 == 0 else [(a, b, d), (b, c, d)]  # 高い点どうし／低い点どうしを結ぶ折り目
            for t in tris:
                bm.faces.new([top[k] for k in t]).material_index = 0
                bm.faces.new([bot[k] for k in t[::-1]]).material_index = 1
    # 屋根の縁（白い鉄骨の鼻先）
    rim = [(i, 0) for i in range(i0, i1)] + [(i1 - 1, j) for j in range(1, nj)] + \
          [(i, nj - 1) for i in range(i1 - 2, i0 - 1, -1)] + [(i0, j) for j in range(nj - 2, 0, -1)]
    for k in range(len(rim)):
        p, q = rim[k], rim[(k + 1) % len(rim)]
        bm.faces.new([top[p], bot[p], bot[q], top[q]]).material_index = 2
roof = new_object("TG_Roof", bm, ["membrane", "wood", "steel"])

# ---- 柱：枝分かれした白い柱（木のように屋根を支える） ----
bm = bmesh.new()
for i in range(1, len(U) - 1):
    for v in [west_at(i) + 1.0, 5.5, 21.5, EAST - 1.0]:
        top = roof_edge_z(i, v) - ROOF_T
        base = PLATFORM_TOP if v in (5.5, 21.5) else 0.0
        fork = top - 3.5
        beam(bm, (U[i], v, base), (U[i], v, fork), 0.32, 0, 8)
        for du, dv in [(-2.6, -1.2), (-2.6, 1.2), (2.6, -1.2), (2.6, 1.2)]:  # 4 本の枝
            beam(bm, (U[i], v, fork), (U[i] + du, v + dv, top + 0.1), 0.14, 0, 6)
new_object("TG_Columns", bm, ["steel"])

# ---- コンコース（2 階の改札階）：床、ガラスの壁、方立て ----
bm = bmesh.new()
box(bm, CONC_U0, CONC_U1, ATRIUM_V, EAST, FLOOR_Z, FLOOR_Z + FLOOR_T, 0)  # 床
box(bm, CONC_U0, CONC_U1, WEST_NORTH, ATRIUM_V, -0.05, 0.15, 0)  # 西口の 1 階の床
for i in range(len(U_SOUTH) - 1, len(U)):  # 床を支える梁（屋根の柱の列）
    box(bm, U[i] - 0.5, U[i] + 0.5, ATRIUM_V, EAST, FLOOR_Z - 1.2, FLOOR_Z, 0)
slab = new_object("TG_Concourse", bm, ["concrete"])

bm = bmesh.new()
glass, steel = 0, 1
iN = range(len(U_SOUTH) - 1, len(U))
inset = ROOF_T + 0.05
for a, b in zip(list(iN)[:-1], list(iN)[1:]):
    # 西の正面（地上から屋根まで）と東の壁（床から屋根まで）
    za, zb = roof_edge_z(a, WEST_NORTH) - inset, roof_edge_z(b, WEST_NORTH) - inset
    quad(bm, [(U[a], WEST_NORTH, 0), (U[b], WEST_NORTH, 0), (U[b], WEST_NORTH, zb), (U[a], WEST_NORTH, za)], glass)
    za, zb = roof_edge_z(a, EAST) - inset, roof_edge_z(b, EAST) - inset
    quad(bm, [(U[b], EAST, FLOOR_Z + FLOOR_T), (U[a], EAST, FLOOR_Z + FLOOR_T), (U[a], EAST, za), (U[b], EAST, zb)], glass)
    # 方立て（縦の白い線）と無目（横の線）：障子のような格子
    n = 4
    for k in range(n):
        t = k / n
        x = U[a] + (U[b] - U[a]) * t
        zt = (roof_edge_z(a, WEST_NORTH) * (1 - t) + roof_edge_z(b, WEST_NORTH) * t) - inset
        box(bm, x - 0.12, x + 0.12, WEST_NORTH - 0.35, WEST_NORTH, 0, zt, steel)
    for h in range(3, 30, 3):
        lo = min(roof_edge_z(a, WEST_NORTH), roof_edge_z(b, WEST_NORTH)) - inset
        if h < lo - 0.3:
            box(bm, U[a], U[b], WEST_NORTH - 0.3, WEST_NORTH, h - 0.08, h + 0.08, steel)
# 北と南の妻側の壁（西口の吹き抜けは地上から、ほかは床から）
for i in (iN[0], iN[-1]):
    x = U[i]
    vs = [WEST_NORTH, ATRIUM_V] + [v for v in V_IN] + [EAST]
    for va, vb in zip(vs[:-1], vs[1:]):
        z0 = 0 if vb <= ATRIUM_V else FLOOR_Z + FLOOR_T
        quad(bm, [(x, va, z0), (x, vb, z0), (x, vb, roof_edge_z(i, vb) - inset), (x, va, roof_edge_z(i, va) - inset)], glass)
        box(bm, x - 0.12, x + 0.12, vb - 0.12, vb + 0.12, z0, roof_edge_z(i, vb) - inset, steel)
new_object("TG_Glass", bm, ["glass", "steel"])

# ---- 西口のひさし（地上の入口の上） ----
bm = bmesh.new()
box(bm, -4, 40, WEST_NORTH - 4.5, WEST_NORTH, 4.2, 4.6, 0)
for x in (-2, 12, 26, 38):
    beam(bm, (x, WEST_NORTH - 4.0, 0), (x, WEST_NORTH - 4.0, 4.2), 0.12, 0, 6)
new_object("TG_Canopy", bm, ["steel"])

# ---- 京浜東北線のホーム ----
x0, x1, y0, y1 = KT_PLATFORM
bm = bmesh.new()
box(bm, x0, x1, y0, y1, 0, PLATFORM_TOP, 0)
for yy in (y0 + 0.8, y1 - 1.1):
    box(bm, x0 + 1, x1 - 1, yy, yy + 0.3, PLATFORM_TOP, PLATFORM_TOP + 0.01, 1)
new_object("TG_Platform", bm, ["platform", "tactile"])

# ---- ここまでの部品の南北を反転して X = -u にする（右手系にする） ----
import mathutils
for ob in export_col.objects:
    ob.data.transform(mathutils.Matrix.Scale(-1, 4, (1, 0, 0)))
    ob.data.flip_normals()

# ---- 駅名（西の正面のガラスの上。反転のあとに作るので、文字は裏返らない） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, size, z in (("高輪ゲートウェイ駅", 2.4, 12.2), ("TAKANAWA GATEWAY STATION", 1.0, 10.6)):
    cu = bpy.data.curves.new("TG_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.extrude = 0.06
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new("TG_Sign", cu)
    ob.location = (-18.0, WEST_NORTH - 0.45, z)  # u = 18
    ob.rotation_euler = (math.radians(90), 0, 0)  # 立てて、西（-Y）に向ける
    export_col.objects.link(ob)
    ob.data.materials.append(MAT["sign"])
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob.select_set(False)

# ---- 下見用：地面・光・カメラ（書き出さない） ----
bm = bmesh.new()
box(bm, -200, 120, -90, 90, -0.2, 0, 0)
new_object("TG_PreviewGround", bm, ["concrete"], preview_col)
sun = bpy.data.objects.new("TG_Sun", bpy.data.lights.new("TG_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-130))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TG_Camera", bpy.data.cameras.new("TG_Camera"))
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (95, -95, 32)  # 南西から
target = (20, 8, 10)
import mathutils
cam.rotation_euler = (mathutils.Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TG_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world

bpy.ops.wm.save_as_mainfile(filepath=out)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "takanawa_gateway_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in export_col.objects)
print(f"BUILT {out} objects={len(export_col.objects)} tris={tris} font={font.name if font else None}")
