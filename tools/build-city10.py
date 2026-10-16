# 街の物 その 11：墓地（墓石・石の塀）・屋上の広告看板と給水塔・立体駐車場・ペットショップと花屋・消防署・保育園のお散歩カート・
# 落ち葉を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city10.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C10_Export」。
#   墓地       C10_Grave（墓石 1 基）・C10_StoneWall（石の塀 1 区切り。X の向きに 4m）
#   屋上       C10_Billboard（広告看板。画はゲームで貼る）・C10_WaterTank（給水塔）
#   駐車場     C10_ParkTower（タワーパーキング。前の出入口は開いている）
#   店         C10_PetShop・C10_Florist（壁に付ける店先。+Y が外）
#   消防       C10_FireStation（壁に付ける車庫と望楼。置く場所は tools/fetch-osm.mjs の services.fireStations）
#   人         C10_DaycareCart（お散歩カートの子ども 4 人と押す先生。歩く）
#   季節       C10_Leaf（落ち葉 1 枚。ゲームで色を付けて舞わせる）
# 光る部品の材質の名前は「Light」で始める。下見用は「C10_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city10.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # BIZ UDゴシック Bold（SIL Open Font License。字の形だけをモデルに入れる）
font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None
rng = random.Random(55)


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {}  # 名前 → 材質（使うときに作る）
MI = {}


def M(name, h, rough=0.6, metal=0.0, emit=False):
    """材質の名前（なければ作る）。emit=True は光る材質（名前は Light_ で始める）"""
    if name in MAT:
        return name
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(h), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(h), 1)
        b.inputs["Emission Strength"].default_value = 2.0
    MI[name] = len(MAT)
    MAT[name] = m
    return name


export_col = bpy.data.collections.new("C10_Export")
preview_col = bpy.data.collections.new("C10_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C10_Skin", 0xe0b896), M("C10_Hair", 0x231c18), M("C10_Shoe", 0x2b2c31), M("C10_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C10_White", 0xf2f2ee), M("C10_Black", 0x17181b), M("C10_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C10_Wood", 0x8a6440), M("C10_Red", 0xd8322a), M("C10_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C10_Glass", 0x3a5a78, rough=0.1, metal=0.3)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, skip=()):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for name, q in (("-z", (0, 3, 2, 1)), ("+z", (4, 5, 6, 7)), ("+y", (3, 7, 6, 2)), ("-y", (0, 1, 5, 4)), ("-x", (0, 4, 7, 3)), ("+x", (1, 2, 6, 5))):
            if name not in skip:
                self.face([v[i] for i in q], mat)

    def cbox(self, c, sx, sy, sz, mat):
        """真ん中 c・各向きの半分の長さの箱"""
        self.box(c[0] - sx, c[0] + sx, c[1] - sy, c[1] + sy, c[2] - sz, c[2] + sz, mat)

    def tube(self, a, b, r0, r1=None, mat=None, seg=6, caps=True):
        a, b = Vector(a), Vector(b)
        r1 = r0 if r1 is None else r1
        d = (b - a).normalized()
        up = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
        u = d.cross(up).normalized()
        v = d.cross(u).normalized()
        ring = lambda c, r: [c + u * (math.cos(2 * math.pi * k / seg) * r) + v * (math.sin(2 * math.pi * k / seg) * r) for k in range(seg)]
        A, B = ring(a, r0), ring(b, r1)
        for k in range(seg):
            self.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], mat)
        if caps:
            if r0 > 0:
                self.face(A[::-1], mat)
            if r1 > 0:
                self.face(B, mat)

    def ellipsoid(self, c, rx, ry, rz, mat, seg=8, rows=5, top=1.0):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * top * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def cone(self, c, r, h, mat, seg=10):
        c = Vector(c)
        tip = c + Vector((0, 0, h))
        ring = [c + Vector((math.cos(2 * math.pi * k / seg) * r, math.sin(2 * math.pi * k / seg) * r, 0)) for k in range(seg)]
        for k in range(seg):
            self.face([ring[k], ring[(k + 1) % seg], tip], mat)
        self.face(ring[::-1], mat)

    def text(self, body, size, center, right, up, mat, res=3):
        """字（center を真ん中に、right の向きへ読み、up が字の上）"""
        cu = bpy.data.curves.new("C10_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C10_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        c, rt, u = Vector(center), Vector(right), Vector(up)
        for poly in me.polygons:
            self.face([c + rt * me.vertices[i].co.x + u * me.vertices[i].co.y for i in poly.vertices], mat)
        ob.to_mesh_clear()
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)

    def vtext(self, body, size, top, right, up, mat, gap=1.1):
        """縦書き（1 字ずつ上から下へ）"""
        for k, ch in enumerate(body):
            self.text(ch, size, Vector(top) - Vector(up) * (k + 0.5) * size * gap, right, up, mat)

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        export_col.objects.link(ob)
        objs.append(ob)
        return ob


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def person(p, x, y, shirt, pants=PANTS, hair=HAIR, h=1.0, arms=True, sx=1.0):
    """立っている人（+Y を向く。h は背の高さの倍率）"""
    for s in (-1, 1):
        p.tube((x + s * 0.09 * sx, y, 0.84 * h), (x + s * 0.09 * sx, y, 0.06), 0.068 * h, 0.052 * h, mat=pants)
        p.ellipsoid((x + s * 0.09 * sx, y + 0.04, 0.04), 0.05, 0.11, 0.04, SHOE, seg=6, rows=3)
    p.ellipsoid((x, y, 1.16 * h), 0.19 * sx, 0.12, 0.33 * h, shirt)
    p.ellipsoid((x, y + 0.01, 1.6 * h), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((x, y - 0.01, 1.66 * h), 0.105, 0.115, 0.085, hair, rows=3)
    if arms:
        for s in (-1, 1):
            p.tube((x + s * 0.21 * sx, y, 1.42 * h), (x + s * 0.25 * sx, y + 0.05, 1.0 * h), 0.045, mat=shirt)



# ================= 墓地（墓石 1 基と、石の塀 1 区切り） =================
GSTONE, GSTONE2, GBASE = M("C10_Grave", 0x9a9c9e, rough=0.4), M("C10_GraveDark", 0x5a5c60, rough=0.4), M("C10_GraveBase", 0xb8b4aa, rough=0.9)
p = Part()  # 墓石（台 1.2m 四方。+Y が前。花立てと線香立て）
p.box(-0.6, 0.6, -0.6, 0.6, 0, 0.18, GBASE)
p.box(-0.42, 0.42, -0.4, 0.3, 0.18, 0.42, GSTONE)
p.box(-0.32, 0.32, -0.3, 0.2, 0.42, 0.6, GSTONE)
p.box(-0.22, 0.22, -0.2, 0.1, 0.6, 1.45, GSTONE2)  # 竿石
p.box(-0.06, 0.06, 0.1, 0.11, 0.8, 1.35, M("C10_GraveText", 0x2a2c30))  # 刻んだ字の代わりの帯
for x in (-0.33, 0.33):
    p.tube((x, 0.35, 0.18), (x, 0.35, 0.5), 0.05, mat=GSTONE, seg=6)
    for k in range(3):
        p.ellipsoid((x + (k - 1) * 0.03, 0.35, 0.56), 0.035, 0.035, 0.04, M(f"C10_Flower{k}", (0xd84a5a, 0xf2c230, 0xf4f4f0)[k]), seg=5, rows=3)
p.box(-0.12, 0.12, 0.35, 0.5, 0.18, 0.3, GSTONE2)  # 線香立て
p.finish("C10_Grave")
p = Part()  # 石の塀（長さ 4m・高さ 1.6m。X の向き。上に瓦）
WALLS = M("C10_StoneWall", 0xa89c88, rough=0.95)
p.box(-2, 2, -0.15, 0.15, 0, 1.45, WALLS)
for k in range(5):  # 石の目地
    p.box(-2, 2, 0.151, 0.153, 0.28 * k + 0.26, 0.28 * k + 0.28, M("C10_Joint", 0x7a7062))
p.face([(-2.05, -0.3, 1.45), (2.05, -0.3, 1.45), (2.05, 0, 1.62), (-2.05, 0, 1.62)], M("C10_Kawara", 0x3a3e46))
p.face([(2.05, 0.3, 1.45), (-2.05, 0.3, 1.45), (-2.05, 0, 1.62), (2.05, 0, 1.62)], M("C10_Kawara", 0x3a3e46))
p.finish("C10_StoneWall")

# ================= 屋上の広告看板と給水塔 =================
p = Part()  # 広告看板（幅 10m・高さ 4m。鉄骨の脚の上。画はゲームで貼る：+Y の面、x -4.8〜4.8、高さ 2.2〜5.8）
for x in (-4, 0, 4):
    p.box(x - 0.1, x + 0.1, -0.1, 0.1, 0, 6.0, METAL)
    p.tube((x, -1.8, 0), (x, 0, 4.5), 0.06, mat=METAL, seg=4)
for z in (1.0, 3.0):
    p.box(-4.2, 4.2, -0.12, 0.12, z, z + 0.12, METAL)
p.box(-5, 5, 0.1, 0.25, 2.0, 6.0, M("C10_BoardFrame", 0x30343c))
for x in (-3.5, 0, 3.5):  # 照明
    p.tube((x, 0.25, 1.9), (x, 1.2, 1.7), 0.03, mat=METAL, seg=4)
    p.box(x - 0.2, x + 0.2, 1.1, 1.3, 1.6, 1.75, M("Light_BoardLamp", 0xfff6dc, emit=True))
p.finish("C10_Billboard")
p = Part()  # 給水塔（鉄骨の台の上に丸いタンク。高さ 7m）
TANK = M("C10_Tank", 0xc8ccd0, rough=0.4, metal=0.3)
for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
    p.tube((x, y, 0), (x * 0.9, y * 0.9, 3.5), 0.08, mat=METAL, seg=5)
p.box(-1.1, 1.1, -1.1, 1.1, 3.5, 3.65, METAL)
p.tube((0, 0, 3.65), (0, 0, 6.3), 1.35, 1.35, mat=TANK, seg=16)
p.cone((0, 0, 6.3), 1.4, 0.6, TANK, seg=16)
for z in (4.3, 5.3):
    p.tube((0, 0, z), (0, 0, z + 0.08), 1.37, 1.37, mat=M("C10_TankBand", 0x8a8e94), seg=16, caps=False)
p.tube((1.35, 0, 3.65), (1.35, 0, 6.3), 0.03, mat=METAL, seg=4)  # はしご
p.finish("C10_WaterTank")

# ================= 立体駐車場（タワーパーキング。幅 6m・奥行き 7m・高さ 22m。+Y が道の側。前の出入口は開いている） =================
PT = M("C10_TowerWall", 0xd8d4cc)
p = Part()
p.box(-3, 3, -3.5, 3.5, 2.6, 22, PT, skip=("-z",))
p.box(-3, -2.4, -3.5, 3.5, 0, 2.6, PT)
p.box(2.4, 3, -3.5, 3.5, 0, 2.6, PT)
p.box(-3, 3, -3.5, -2.9, 0, 2.6, PT)
p.box(-2.4, 2.4, -2.9, 3.5, 0, 0.05, M("C10_TurnTable", 0x5a5e66))  # 出入口の床（ターンテーブル）
for k in range(8):  # 縦長の窓（中の車が見える細い窓）
    z = 3.2 + k * 2.3
    p.box(-1.2, 1.2, 3.5, 3.52, z, z + 1.4, M("C10_TowerGlass", 0x3a4a5a, rough=0.1))
p.box(-3.1, 3.1, -3.6, 3.6, 22, 22.4, M("C10_TowerRoof", 0x8a8e94))
p.box(-2.4, 2.4, 3.5, 3.6, 2.6, 3.4, M("C10_TowerSign", 0x1f4aa8))
p.text("P 立体駐車場", 0.42, (0, 3.61, 3.0), -X, Z, WHITE)
p.box(2.5, 2.9, 3.6, 3.62, 0.9, 1.6, M("Light_TowerSignal", 0x40ff60, emit=True))  # 入庫できます の灯
p.finish("C10_ParkTower")

# ================= ペットショップと花屋（壁に付ける店先。+Y が外。幅 6m） =================
def shop_front(p, wall, awning, label, label_mat):
    p.box(-3, 3, -0.05, 0.12, 0, 3.4, wall)
    p.box(-2.6, 2.6, 0.12, 0.14, 0.4, 2.3, M("Light_ShopInside", 0xfff2dc, emit=True))
    for x in (-2.6, -0.9, 0.9, 2.6):
        p.box(x - 0.04, x + 0.04, 0.13, 0.16, 0.4, 2.3, METAL)
    for k in range(6):  # 縞のひさし
        x0 = -3 + k
        p.face([(x0, 0.1, 2.9), (x0 + 1, 0.1, 2.9), (x0 + 1, 1.2, 2.45), (x0, 1.2, 2.45)], awning if k % 2 == 0 else WHITE)
    p.box(-2.4, 2.4, 0.12, 0.16, 2.95, 3.35, WHITE)
    p.text(label, 0.34, (0, 0.165, 3.15), -X, Z, label_mat)


p = Part()  # ペットショップ（窓ごしの子犬と子猫）
shop_front(p, M("C10_PetWall", 0xe8e0d0), M("C10_PetAwning", 0x3a8ae0), "ペットショップ", M("C10_PetText", 0x1f5fb0))
for k, (x, coat) in enumerate(((-1.8, 0xc8783a), (-0.3, 0xf2eee6), (1.6, 0x2a2624))):
    c = M(f"C10_Pup{k}", coat)
    p.box(x - 0.55, x + 0.55, 0.15, 0.17, 0.4, 0.45, WHITE)  # 窓の中の台
    p.ellipsoid((x, 0.2, 0.62), 0.16, 0.1, 0.12, c, seg=8, rows=4)
    p.ellipsoid((x + 0.12, 0.22, 0.8), 0.11, 0.09, 0.1, c, seg=8, rows=4)
    for s in (-1, 1):
        p.face([(x + 0.12 + s * 0.04, 0.24, 0.86), (x + 0.12 + s * 0.11, 0.24, 0.85), (x + 0.12 + s * 0.08, 0.24, 0.96)], c)
    p.cbox((x + 0.12, 0.31, 0.79), 0.02, 0.005, 0.015, BLACK)
p.finish("C10_PetShop")
p = Part()  # 花屋（店の前に鉢植えの棚）
shop_front(p, M("C10_FloristWall", 0xf0ebe0), M("C10_FloristAwning", 0x3a9a4a), "フラワーショップ", M("C10_FloristText", 0x2a7a3a))
FLOWER = [M(f"C10_Bloom{k}", h) for k, h in enumerate((0xe84a7a, 0xf2c230, 0xf4f4f0, 0xb05ad0, 0xff7a3a, 0xd82a3a))]
POT = M("C10_Pot", 0xb8603a)
LEAF = M("C10_Leaf", 0x3a8a3a)
for tier, (y, z) in enumerate(((0.55, 0.0), (0.85, 0.3), (1.15, 0.6))):
    p.box(-2.6, 2.6, 0.3, y + 0.15, z, z + 0.05, WOOD)
    for k in range(9):
        x = -2.3 + k * 0.58
        p.tube((x, y, z + 0.05), (x, y, z + 0.25), 0.1, 0.13, mat=POT, seg=8)
        p.ellipsoid((x, y, z + 0.32), 0.14, 0.14, 0.1, LEAF, seg=7, rows=3)
        for j in range(3):
            a = j * 2.1 + k
            p.ellipsoid((x + math.cos(a) * 0.07, y + math.sin(a) * 0.07, z + 0.4), 0.05, 0.05, 0.04, FLOWER[(k + j + tier) % len(FLOWER)], seg=5, rows=3)
for x in (-2.75, 2.75):
    p.box(x - 0.05, x + 0.05, 0.3, 1.3, 0, 0.7, WOOD)
p.finish("C10_Florist")

# ================= 消防署（壁に付ける。+Y が外。幅 12m。赤い車庫の扉 2 つと望楼） =================
FIRE_R = M("C10_FireRed", 0xd8202a)
p = Part()
p.box(-6, 6, -0.05, 0.12, 0, 8, M("C10_FireWall", 0xe8e4dc))
for x0 in (-5.4, 0.4):  # 車庫（1 つは開いていて中が見える）
    p.box(x0, x0 + 5.0, 0.12, 0.14, 0, 4.2, FIRE_R if x0 > 0 else M("C10_GarageInside", 0x3a3e46))
    for k in range(1, 8):
        if x0 > 0:
            p.box(x0, x0 + 5.0, 0.14, 0.15, k * 0.52, k * 0.52 + 0.04, M("C10_ShutterLine", 0xa81818))
    p.box(x0 - 0.1, x0 + 5.1, 0.12, 0.2, 4.2, 4.4, M("C10_GarageFrame", 0xb8bcc2))
p.box(-6, 6, 0.12, 0.2, 5.0, 5.8, WHITE)
p.text("消防署", 0.62, (0, 0.205, 5.4), -X, Z, FIRE_R)
p.box(-1.6, 1.6, -1.6, 1.6, 8, 14, M("C10_FireWall", 0xe8e4dc))  # 望楼
p.box(-1.8, 1.8, -1.8, 1.8, 14, 14.3, FIRE_R)
p.box(-1.55, 1.55, 1.59, 1.62, 11, 13.5, M("C10_TowerGlass", 0x3a4a5a, rough=0.1))
p.ellipsoid((5.5, 0.3, 4.9), 0.18, 0.18, 0.18, M("Light_FireLamp", 0xff2020, emit=True), seg=8, rows=5)
p.finish("C10_FireStation")

# ================= 保育園のお散歩カート（子ども 4 人と、押す先生。前は +Y） =================
CART = M("C10_Cart", 0xf2c230)
p = Part()
p.box(-0.45, 0.45, -0.7, 0.7, 0.35, 0.42, CART)
for s in (-1, 1):
    p.box(s * 0.45 - 0.03, s * 0.45 + 0.03, -0.7, 0.7, 0.42, 0.95, CART)
for y in (-0.7, 0.7):
    p.box(-0.45, 0.45, y - 0.03, y + 0.03, 0.42, 0.95, CART)
for x in (-0.38, 0.38):
    for y in (-0.6, 0.6):
        p.tube((x - 0.03, y, 0.15), (x + 0.03, y, 0.15), 0.15, mat=BLACK, seg=8)
p.tube((-0.45, -0.95, 1.05), (0.45, -0.95, 1.05), 0.025, mat=METAL, seg=5)  # 押し手
for x in (-0.45, 0.45):
    p.tube((x, -0.95, 1.05), (x, -0.7, 0.9), 0.02, mat=METAL, seg=4)
KCAP = [M(f"C10_KidCap{k}", h) for k, h in enumerate((0xf2d020, 0xe84a7a, 0x3a8ae0, 0x4ab84a))]
for k, (x, y) in enumerate(((-0.2, -0.35), (0.2, -0.35), (-0.2, 0.35), (0.2, 0.35))):
    p.ellipsoid((x, y, 0.75), 0.11, 0.09, 0.17, M(f"C10_KidShirt{k}", (0xf4f4f0, 0x9ad0f0, 0xf6b4d4, 0xd8e8a0)[k]))
    p.ellipsoid((x, y + 0.01, 0.98), 0.08, 0.08, 0.09, SKIN)
    p.ellipsoid((x, y, 1.02), 0.09, 0.09, 0.06, KCAP[k], rows=3)
person(p, 0, -1.4, M("C10_Teacher", 0xe88a8a), arms=False)
for s in (-1, 1):
    p.tube((s * 0.21, -1.4, 1.42), (s * 0.35, -0.97, 1.06), 0.045, mat=M("C10_Teacher", 0xe88a8a))
p.finish("C10_DaycareCart")

# ================= 落ち葉 1 枚（ゲームで色を付けて舞わせる） =================
p = Part()
pts = [Vector((math.sin(a) * 0.05 * (1 - 0.3 * math.cos(a)), math.cos(a) * 0.07, 0)) for a in [k * math.tau / 10 for k in range(10)]]
p.face(pts, M("C10_FallenLeaf", 0xffffff))
p.finish("C10_Leaf")

# ---- 下見（並べて 1 枚の絵にする） ----
for ob in objs:
    ob.hide_render = True
x = 0.0
for k, ob in enumerate(objs):
    pv = ob.copy()
    w = max(ob.dimensions.x, 0.5)
    row = k % 4
    pv.location = (x, row * 6.0 - 9.0, 1.0 if ob.name.endswith(("FlyA", "FlyB")) else 0.0)
    if row == 3:
        x += 4.5
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=60)
gm = bpy.data.meshes.new("C10_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C10_PreviewGroundMat"))
gp = bpy.data.objects.new("C10_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C10_Sun", bpy.data.lights.new("C10_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C10_Camera", bpy.data.cameras.new("C10_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C10_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city10_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
