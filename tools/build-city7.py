# 街の物 その 8：神社とお寺の入口・交番・首都高の橋脚と案内板・赤ちょうちんの居酒屋とラーメンの屋台・タクシー乗り場の案内・
# 電車の乗客・子ども乗せの子ども・雲と虹・東京湾の船・ゴールの駅員さんを、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city7.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C7_Export」。
#   寺社       C7_Torii（鳥居）・C7_Toro（石の灯籠。窓は夜に灯る）・C7_Komainu（狛犬）・C7_Sanmon（お寺の山門と大ちょうちん）
#   交番       C7_Koban（赤い丸い灯と、前に立つおまわりさん）
#   首都高     C7_HwyPier（T 形の橋脚。梁は X の向き、上は高さ 12.6m）・C7_HwySign（緑の案内板）。高架の板と壁はゲームで作る
#   夜の店     C7_Izakaya（壁に付ける赤ちょうちんの店先）・C7_Ramen（ラーメンの屋台）
#   タクシー   C7_TaxiSign（タクシーのりばの案内）
#   電車       C7_PaxYamanote・C7_PaxCommuter（窓に見える乗客の影。車両の側面のドアのあいだの窓。山手線とほかの通勤電車）
#   自転車     C7_Child（電動アシスト自転車の子ども乗せに座る子ども。原点は座る所）
#   空         C7_Cloud0〜2（雲）・C7_Rainbow（虹。半径 1 の半円の帯）
#   東京湾     C7_ContainerShip（コンテナ船）・C7_Ferry（フェリー。どちらも実物の大きさ）
#   ゴール     C7_Staff と C7_StaffArm（駅員さんと右腕。原点は右肩）
# 光る部品の材質の名前は「Light」で始める。下見用は「C7_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city7.blend")
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


export_col = bpy.data.collections.new("C7_Export")
preview_col = bpy.data.collections.new("C7_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C7_Skin", 0xe0b896), M("C7_Hair", 0x231c18), M("C7_Shoe", 0x2b2c31), M("C7_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C7_White", 0xf2f2ee), M("C7_Black", 0x17181b), M("C7_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C7_Wood", 0x8a6440), M("C7_Red", 0xd8322a), M("C7_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C7_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C7_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C7_TextTmp", cu)
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



# ================= 神社とお寺の入口（+Y が参道の外、道の側） =================
VERM, STONE, STONE2 = M("C7_Vermilion", 0xd8402a), M("C7_Stone", 0xa8a49a, rough=0.9), M("C7_StoneDark", 0x7a766e, rough=0.9)
p = Part()  # 鳥居（柱の間 4.4m・高さ 5.2m）
for x in (-2.2, 2.2):
    p.tube((x, 0, 0), (x * 0.96, 0, 4.7), 0.2, 0.18, mat=VERM, seg=10)
    p.tube((x, 0, 0), (x, 0, 0.5), 0.26, 0.26, mat=BLACK, seg=10)  # 根巻
p.box(-2.9, 2.9, -0.15, 0.15, 3.85, 4.15, VERM)  # 貫
p.box(-0.12, 0.12, -0.12, 0.12, 4.15, 4.75, VERM)  # 額束
p.box(-0.45, 0.45, 0.13, 0.17, 4.2, 4.7, BLACK)  # 額
for k in range(13):  # 反った笠木（上の黒）と島木（下の朱）
    x0, x1 = -3.6 + 7.2 * k / 13, -3.6 + 7.2 * (k + 1) / 13
    lift = lambda x: 0.18 * (abs(x) / 3.6) ** 2.2
    p.face([(x0, -0.3, 4.75 + lift(x0)), (x1, -0.3, 4.75 + lift(x1)), (x1, 0.3, 4.75 + lift(x1)), (x0, 0.3, 4.75 + lift(x0))], VERM)
    p.face([(x0, -0.32, 5.05 + lift(x0)), (x0, 0.32, 5.05 + lift(x0)), (x1, 0.32, 5.05 + lift(x1)), (x1, -0.32, 5.05 + lift(x1))], BLACK)
    for y in (-0.3, 0.3):
        p.face([(x0, y, 4.75 + lift(x0)), (x1, y, 4.75 + lift(x1)), (x1, y * 1.07, 5.05 + lift(x1)), (x0, y * 1.07, 5.05 + lift(x0))], VERM if y > 0 else VERM)
p.finish("C7_Torii")

p = Part()  # 石の灯籠（高さ 2m）
p.box(-0.35, 0.35, -0.35, 0.35, 0, 0.25, STONE2)
p.tube((0, 0, 0.25), (0, 0, 1.1), 0.13, 0.11, mat=STONE, seg=8)
p.box(-0.3, 0.3, -0.3, 0.3, 1.1, 1.22, STONE)
p.box(-0.22, 0.22, -0.22, 0.22, 1.22, 1.55, STONE)
p.box(-0.15, 0.15, -0.23, 0.23, 1.3, 1.48, M("Light_Toro", 0xffd890, emit=True))  # 火袋の窓（夜は灯る）
p.cone((0, 0, 1.55), 0.42, 0.3, STONE, seg=6)
p.ellipsoid((0, 0, 1.92), 0.07, 0.07, 0.09, STONE, seg=6, rows=4)
p.finish("C7_Toro")

p = Part()  # 狛犬（座って +Y を向く。台の上）
p.box(-0.32, 0.32, -0.42, 0.42, 0, 0.55, STONE2)
p.ellipsoid((0, -0.1, 0.85), 0.2, 0.26, 0.28, STONE, seg=8, rows=5)
p.ellipsoid((0, 0.1, 1.2), 0.2, 0.2, 0.2, STONE, seg=8, rows=5)
p.ellipsoid((0, 0.08, 1.33), 0.22, 0.18, 0.12, STONE2, seg=8, rows=4)  # たてがみ
p.ellipsoid((0, 0.26, 1.15), 0.1, 0.08, 0.07, STONE, seg=6, rows=3)  # 口
for s in (-1, 1):
    p.tube((s * 0.12, 0.12, 0.85), (s * 0.12, 0.2, 0.55), 0.06, mat=STONE, seg=6)
    p.cbox((s * 0.07, 0.28, 1.24), 0.03, 0.01, 0.025, STONE2)
p.ellipsoid((0, -0.32, 0.95), 0.08, 0.08, 0.14, STONE2, seg=6, rows=3)  # 尾
p.finish("C7_Komainu")

ROOF7, WOOD7, PAPER7 = M("C7_TempleRoof", 0x3a3e46, rough=0.6), M("C7_TempleWood", 0x7a3a28), M("C7_LanternRed", 0xc8202a)
p = Part()  # お寺の山門（幅 8m。真ん中に大きな赤いちょうちん）
for x in (-3.4, -1.3, 1.3, 3.4):
    for y in (-1.2, 1.2):
        p.tube((x, y, 0), (x, y, 4.4), 0.2, mat=WOOD7, seg=8)
p.box(-4.0, 4.0, -1.5, 1.5, 4.4, 4.9, WOOD7)
pts = [(5.3, 2.8, 4.85), (4.6, 2.1, 5.7), (3.6, 1.0, 6.5), (3.2, 0.15, 6.85)]  # 半分の長さ・半分の奥行き・高さ
for (a0, b0, z0), (a1, b1, z1) in zip(pts, pts[1:]):
    for sy in (-1, 1):
        p.face([(-a0, sy * b0, z0), (a0, sy * b0, z0), (a1, sy * b1, z1), (-a1, sy * b1, z1)] if sy < 0 else [(a0, sy * b0, z0), (-a0, sy * b0, z0), (-a1, sy * b1, z1), (a1, sy * b1, z1)], ROOF7)
    for sx in (-1, 1):
        p.face([(sx * a0, -b0, z0), (sx * a0, b0, z0), (sx * a1, b1, z1), (sx * a1, -b1, z1)], ROOF7)
p.box(-3.3, 3.3, -0.12, 0.12, 6.8, 7.0, ROOF7)  # 棟
p.tube((0, 0, 4.4), (0, 0, 4.2), 0.02, mat=DARK, seg=4)
p.tube((0, 0, 2.6), (0, 0, 4.2), 0.85, 0.85, mat=PAPER7, seg=14)  # 大ちょうちん
p.ellipsoid((0, 0, 4.2), 0.85, 0.85, 0.12, PAPER7, seg=14, rows=3, top=0.5)
for z in (2.55, 4.15):
    p.tube((0, 0, z), (0, 0, z + 0.12), 0.86, 0.86, mat=BLACK, seg=14)
p.text("山門", 0.55, (0, 0.86, 3.4), -X, Z, BLACK)
p.text("山門", 0.55, (0, -0.86, 3.4), X, Z, BLACK)
p.finish("C7_Sanmon")

# ================= 交番（+Y が前。幅 4.4m・奥行き 4m・高さ 6.4m） =================
KWALL, KROOF = M("C7_KobanWall", 0xe8e2d6), M("C7_KobanRoof", 0x4a5260)
RED_LAMP = M("Light_KobanLamp", 0xff2a2a, emit=True)
POLICE = M("C7_Police", 0x24345a)
p = Part()
p.box(-2.2, 2.2, -2.0, 2.0, 0, 5.6, KWALL)
p.box(-2.4, 2.4, -2.2, 2.2, 5.6, 6.0, KROOF)
p.box(-0.5, 0.5, -0.4, 0.4, 6.0, 6.4, KROOF)
p.box(-1.0, 1.0, 1.99, 2.02, 0.0, 2.4, M("C7_KobanDoor", 0x3a5a78, rough=0.1, metal=0.3))
p.box(-1.1, 1.1, 1.98, 2.03, 2.4, 2.5, KROOF)
p.box(1.3, 2.0, 1.99, 2.02, 1.0, 2.2, M("Light_KobanWindow", 0xfff0d0, emit=True))
p.box(-1.6, 1.6, 2.0, 2.06, 3.0, 3.8, WHITE)  # 名前の板
p.text("交番", 0.6, (0, 2.065, 3.48), -X, Z, M("C7_KobanText", 0x1f3a7a))
p.text("KOBAN", 0.26, (0, 2.065, 3.1), -X, Z, M("C7_KobanText", 0x1f3a7a))
p.tube((0, 2.0, 4.3), (0, 2.3, 4.3), 0.05, mat=METAL, seg=6)
p.ellipsoid((0, 2.35, 4.3), 0.2, 0.2, 0.2, RED_LAMP, seg=10, rows=6)  # 赤い丸い灯
for x in (-1.0, 1.0):  # 前のひさしの柱
    p.tube((x, 2.6, 0), (x, 2.6, 2.6), 0.05, mat=METAL, seg=6)
p.box(-1.3, 1.3, 1.9, 2.75, 2.55, 2.65, KROOF)
# 前に立つおまわりさん
person(p, 1.6, 2.8, POLICE, pants=POLICE, arms=False)
p.ellipsoid((1.6, 2.81, 1.69), 0.12, 0.13, 0.06, POLICE, rows=3)
p.box(1.52, 1.68, 2.88, 2.96, 1.65, 1.69, BLACK)  # 帽子のつば
p.cbox((1.6, 2.93, 1.2), 0.05, 0.005, 0.04, M("C7_Badge", 0xe0b030, metal=0.6))
for s in (-1, 1):
    p.tube((1.6 + s * 0.21, 2.8, 1.42), (1.6 + s * 0.23, 2.86, 1.0), 0.045, mat=POLICE)
p.finish("C7_Koban")

# ================= 首都高の橋脚（T 形。上の梁は X の向き 15m。高さ 12.4m まで） =================
CONC, CONC2 = M("C7_Concrete", 0xa8aaa6, rough=0.9), M("C7_ConcreteDark", 0x8a8c88, rough=0.9)
p = Part()
p.box(-0.9, 0.9, -0.9, 0.9, 0, 10.8, CONC)
p.box(-1.2, 1.2, -1.2, 1.2, 0, 0.5, CONC2)
p.face([(-0.9, -0.9, 10.0), (0.9, -0.9, 10.0), (3.5, -1.0, 10.8), (-3.5, -1.0, 10.8)], CONC)  # 梁の下のふくらみ
p.face([(0.9, 0.9, 10.0), (-0.9, 0.9, 10.0), (-3.5, 1.0, 10.8), (3.5, 1.0, 10.8)], CONC)
p.box(-7.5, 7.5, -1.0, 1.0, 10.8, 12.4, CONC)
for x in (-6.0, -2.0, 2.0, 6.0):
    p.box(x - 0.4, x + 0.4, -0.5, 0.5, 12.4, 12.6, CONC2)  # 支承
p.finish("C7_HwyPier")
p = Part()  # 首都高の案内板（緑の板。高架の縁に付ける。+Y が前）
p.box(-2.6, 2.6, -0.06, 0.06, 0, 1.6, M("C7_SignGreen", 0x1e7a46))
p.box(-2.5, 2.5, 0.06, 0.07, 0.08, 1.52, WHITE)
p.box(-2.44, 2.44, 0.07, 0.075, 0.14, 1.46, M("C7_SignGreen2", 0x1e7a46))
p.text("首都高", 0.75, (0, 0.08, 0.82), -X, Z, WHITE)
p.text("首都高", 0.75, (0, -0.065, 0.82), X, Z, WHITE)
p.finish("C7_HwySign")

# ================= 赤ちょうちんの居酒屋（壁に付ける店先。+Y が外。幅 4m） =================
AKA = M("Light_Akachochin", 0xff3a2a, emit=True)
NOREN = M("C7_Noren", 0x1f2a4a)
p = Part()
p.box(-2.0, 2.0, -0.05, 0.1, 0, 3.0, M("C7_Izakaya", 0x6a4a30))
p.box(-1.2, 1.2, 0.1, 0.12, 0.0, 2.2, M("Light_IzakayaDoor", 0xffd8a0, emit=True))  # 格子の引き戸（中が明るい）
for k in range(9):
    x = -1.2 + k * 0.3
    p.box(x - 0.02, x + 0.02, 0.12, 0.14, 0, 2.2, M("C7_IzakayaLattice", 0x4a3020))
for k in range(4):  # のれん
    x0 = -1.2 + k * 0.6
    p.box(x0 + 0.02, x0 + 0.58, 0.18, 0.2, 1.55, 2.2, NOREN)
p.text("酒", 0.36, (0.6, 0.205, 1.86), -X, Z, WHITE)  # 前（+Y）から見て左が +X
p.text("処", 0.36, (-0.6, 0.205, 1.86), -X, Z, WHITE)
p.box(-1.3, 1.3, 0.1, 0.25, 2.2, 2.26, M("C7_IzakayaBar", 0x4a3020))
for x in (-1.65, 1.65):  # 赤ちょうちん
    p.tube((x, 0.35, 2.75), (x, 0.35, 2.55), 0.008, mat=DARK, seg=3)
    p.ellipsoid((x, 0.35, 2.25), 0.2, 0.2, 0.32, AKA, seg=10, rows=6)
    for z in (1.95, 2.55):
        p.tube((x, 0.35, z - 0.03), (x, 0.35, z + 0.03), 0.12, mat=BLACK, seg=8)
p.box(-0.9, 0.9, 0.12, 0.16, 2.35, 2.95, M("C7_IzakayaSign", 0xf2ead8))  # 看板
p.text("居酒屋", 0.32, (0, 0.165, 2.65), -X, Z, M("C7_IzakayaText", 0x8a1a1a))
for k in range(3):  # ビールケース
    p.box(1.4, 1.85, 0.2 + k * 0.0, 0.55, k * 0.32, k * 0.32 + 0.3, M("C7_Crate", 0xc8902a if k % 2 else 0x2a6ac8))
p.finish("C7_Izakaya")

p = Part()  # ラーメンの屋台（夜だけ。+Y がお客さんの側）
p.box(-1.0, 1.0, -0.4, 0.45, 0.35, 1.0, WOOD)
p.box(-1.05, 1.05, 0.35, 0.6, 0.95, 1.0, WOOD)
for x in (-0.95, 0.95):
    for y in (-0.35, 0.45):
        p.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 1.0, 2.1, WOOD)
p.box(-1.15, 1.15, -0.55, 0.75, 2.1, 2.2, M("C7_RamenRoof", 0x3a2a20))
for k in range(4):  # 赤いのれん
    x0 = -0.95 + k * 0.475
    p.box(x0 + 0.02, x0 + 0.455, 0.72, 0.74, 1.62, 2.08, M("C7_RamenNoren", 0xc8202a))
p.text("ラーメン", 0.2, (0, 0.745, 1.85), -X, Z, M("Light_RamenText", 0xfff4e0, emit=True))  # 夜でも読めるよう光る字
for y in (-0.42, 0.42):
    p.tube((-0.9, y, 0.32), (-0.82, y, 0.32), 0.32, mat=DARK, seg=10)
p.tube((1.1, 0.1, 0.35), (1.6, 0.1, 0.35), 0.03, mat=WOOD, seg=4)  # 引く棒
p.tube((0.4, -0.1, 1.0), (0.4, -0.1, 1.3), 0.18, 0.18, mat=METAL, seg=10)  # 寸胴
p.ellipsoid((0.4, -0.1, 1.42), 0.14, 0.14, 0.1, M("C7_Steam", 0xf2f2f2), seg=8, rows=3)
p.ellipsoid((-0.75, 0.85, 1.9), 0.16, 0.16, 0.24, AKA, seg=10, rows=6)
p.tube((-0.75, 0.85, 2.2), (-0.75, 0.85, 2.14), 0.005, mat=DARK, seg=3)
p.box(-0.6, -0.3, 1.05, 1.3, 0, 0.45, WOOD)  # 丸いすの代わりの箱
p.finish("C7_Ramen")

# ================= タクシー乗り場の案内（+Y が前。両面） =================
p = Part()
p.tube((0, 0, 0), (0, 0, 2.6), 0.04, mat=METAL, seg=6)
p.box(-0.75, 0.75, -0.05, 0.05, 2.0, 2.6, M("C7_TaxiBoard", 0x1f4aa8))
for y, rt in ((0.055, -X), (-0.055, X)):
    p.text("タクシー", 0.2, (0, y, 2.4), rt, Z, WHITE)
    p.text("のりば", 0.17, (0, y, 2.14), rt, Z, WHITE)
p.finish("C7_TaxiSign")

# ================= 電車の乗客（窓に見える人の影。片側ずつ両側。ドアのあいだの窓だけ。前は +Y） =================
def passengers(name, x, wins, z0, z1, seed):
    r = random.Random(seed)
    p = Part()
    shades = [M(f"C7_Pax{k}", h) for k, h in enumerate((0x2a2e36, 0x3a3440, 0x30363e, 0x483c34, 0x262a30))]
    for s in (-1, 1):
        for y0, y1 in wins:
            y = y0 + 0.25
            while y < y1 - 0.2:
                if r.random() < 0.72:
                    sit = r.random() < 0.45
                    top = z0 + (0.45 if sit else 0.78) + r.uniform(-0.04, 0.06)
                    m = shades[r.randrange(len(shades))]
                    xx = s * x
                    hz = top - 0.13
                    # 頭（楕円）と肩（台形）。窓の外側の面に貼る
                    ring = [(y + math.cos(a) * 0.1, hz + math.sin(a) * 0.12) for a in [k * math.tau / 10 for k in range(10)]]
                    pts = [(xx, yy, zz) for yy, zz in ring]
                    p.face(pts if s > 0 else pts[::-1], m)
                    sh = [(xx, y - 0.24, z0), (xx, y + 0.24, z0), (xx, y + 0.2, hz - 0.14), (xx, y - 0.2, hz - 0.14)]
                    p.face(sh if s > 0 else sh[::-1], m)
                    if not sit and r.random() < 0.35:  # つり革をつかむ手
                        arm = [(xx, y + 0.12, hz - 0.12), (xx, y + 0.2, hz - 0.12), (xx, y + 0.2, min(z1, hz + 0.3)), (xx, y + 0.14, min(z1, hz + 0.3))]
                        p.face(arm if s > 0 else arm[::-1], m)
                y += r.uniform(0.5, 0.8)
    return p.finish(name)


# 山手線（E235系。窓は高さ 2.05〜3.05、ドアのあいだの窓）と、ほかの通勤電車（窓は 2.2〜3.0）
passengers("C7_PaxYamanote", 1.488, [(-5.85, -3.35), (-1.25, 1.25), (3.35, 5.85)], 2.05, 3.05, 7)
passengers("C7_PaxCommuter", 1.49, [(-6.45, -3.35), (-1.55, 1.55), (3.35, 6.45)], 2.2, 3.0, 8)

# ================= 子ども乗せの子ども（電動アシスト自転車の後ろ。原点は座る所。前は +Y） =================
p = Part()
KIDH, KIDS = M("C7_KidHelmet", 0xf2c230), M("C7_KidShirt", 0xd84a5a)
p.ellipsoid((0, 0, 0.22), 0.13, 0.11, 0.2, KIDS)
p.ellipsoid((0, 0.02, 0.5), 0.1, 0.1, 0.11, SKIN)
p.ellipsoid((0, 0.0, 0.55), 0.115, 0.125, 0.1, KIDH, rows=4, top=0.55)
for x in (-0.03, 0.03):
    p.cbox((x, 0.1, 0.5), 0.01, 0.005, 0.01, BLACK)
for s in (-1, 1):
    p.tube((s * 0.07, 0.05, 0.08), (s * 0.08, 0.28, 0.05), 0.04, mat=PANTS, seg=6)
    p.tube((s * 0.08, 0.28, 0.05), (s * 0.08, 0.32, -0.18), 0.032, mat=PANTS, seg=6)
    p.tube((s * 0.12, 0.0, 0.35), (s * 0.16, 0.2, 0.25), 0.032, mat=KIDS, seg=6)  # 前のバーをつかむ腕
p.finish("C7_Child")

# ================= 雲（白い玉を寄せた形。長さ約 60m）と虹 =================
CLOUD, CLOUD2 = M("C7_Cloud", 0xffffff, rough=1.0), M("C7_CloudShade", 0xd8dee8, rough=1.0)
for n, seed in ((0, 3), (1, 5), (2, 9)):
    r = random.Random(seed)
    p = Part()
    L = 40 + n * 12
    for k in range(9 + n * 2):
        x = r.uniform(-L / 2, L / 2)
        rr = r.uniform(7, 13) * (1 - abs(x) / L * 0.8)
        p.ellipsoid((x, r.uniform(-6, 6), rr * 0.4), rr, rr * 0.8, rr * 0.7, CLOUD, seg=10, rows=6)
    p.ellipsoid((0, 0, 0), L * 0.55, 10, 2.5, CLOUD2, seg=12, rows=4)  # 平らな底
    p.finish(f"C7_Cloud{n}")
p = Part()  # 虹（半径 1 の半円の帯。7 色、外が赤）
cols = (0xff3030, 0xff9030, 0xffe040, 0x40d040, 0x40a0ff, 0x4050e0, 0xa040d0)
N = 48
for b, h in enumerate(cols):
    r0, r1 = 1.0 - b * 0.012, 1.0 - (b + 1) * 0.012
    m = M(f"Light_Rainbow{b}", h, emit=True)
    for k in range(N):
        a0, a1 = math.pi * k / N, math.pi * (k + 1) / N
        p.face([(math.cos(a0) * r0, 0, math.sin(a0) * r0), (math.cos(a1) * r0, 0, math.sin(a1) * r0), (math.cos(a1) * r1, 0, math.sin(a1) * r1), (math.cos(a0) * r1, 0, math.sin(a0) * r1)], m)
p.finish("C7_Rainbow")

# ================= 東京湾の船（実物の大きさ。ゲームでは遠くの目印と同じように縮めて置く。前は +Y） =================
HULL, HULLR = M("C7_ShipHull", 0x1e2a44), M("C7_ShipHullRed", 0xa82a2a)
p = Part()  # コンテナ船（長さ 200m）
outline = [(0, 100), (12, 90), (16, 70), (16, -90), (14, -100)]
for (x0, y0), (x1, y1) in zip(outline, outline[1:]):
    for s in (-1, 1):
        p.face([(s * x0, y0, 0), (s * x1, y1, 0), (s * x1, y1, 14), (s * x0, y0, 14)][:: s], HULL)
        p.face([(s * x0, y0, -6), (s * x1, y1, -6), (s * x1, y1, 0), (s * x0, y0, 0)][:: s], HULLR)
p.box(-14, 14, -100, -99, -6, 14, HULL)
p.box(-15.5, 15.5, -88, 88, 13.8, 14, M("C7_Deck", 0x6a6e72))
CCOL = [M(f"C7_Box{k}", h) for k, h in enumerate((0xc8402a, 0x2a6ac8, 0x3a9a4a, 0xe0a030, 0xd8d8d0, 0x8a4a8a))]
r = random.Random(4)
for bay in range(14):
    y = -60 + bay * 10
    for row in range(5):
        for tier in range(r.randint(2, 4)):
            p.box(-13 + row * 5.2, -8.4 + row * 5.2, y, y + 9, 14 + tier * 2.6, 16.5 + tier * 2.6, CCOL[r.randrange(len(CCOL))])
p.box(-13, 13, -96, -78, 14, 34, WHITE)  # 船橋
p.box(-15, 15, -86, -82, 30, 32, WHITE)
p.box(-13.2, 13.2, -86, -85.5, 26, 31, M("C7_ShipGlass", 0x2a3a4a))
p.tube((0, -92, 34), (0, -92, 42), 2.2, 2.0, mat=M("C7_Funnel", 0x2a6ac8), seg=10)
p.finish("C7_ContainerShip")
p = Part()  # フェリー（長さ 140m。白い船体に青い帯）
outline = [(0, 70), (9, 60), (12, 45), (12, -65), (11, -70)]
for (x0, y0), (x1, y1) in zip(outline, outline[1:]):
    for s in (-1, 1):
        p.face([(s * x0, y0, -5), (s * x1, y1, -5), (s * x1, y1, 10), (s * x0, y0, 10)][:: s], WHITE)
    p.face([(-x0, y0, 10), (x0, y0, 10), (x1, y1, 10), (-x1, y1, 10)], WHITE)
p.box(-11, 11, -70, -69, -5, 10, WHITE)
for s in (-1, 1):
    p.box(s * 12 - 0.05, s * 12 + 0.05, -64, 44, 2, 4, M("C7_FerryBlue", 0x1f5fbf))
p.box(-10, 10, -55, 35, 10, 22, WHITE)
for z in (14, 18):
    for s in (-1, 1):
        p.box(s * 10 - 0.05, s * 10 + 0.05, -52, 32, z, z + 2, M("C7_ShipGlass", 0x2a3a4a))
p.box(-8, 8, 20, 32, 22, 27, WHITE)
p.box(-8.1, 8.1, 31.9, 32.1, 23.5, 26, M("C7_ShipGlass", 0x2a3a4a))
p.tube((0, -25, 22), (0, -28, 32), 3.4, 3.0, mat=M("C7_FerryFunnel", 0x1f5fbf), seg=10)
p.finish("C7_Ferry")

# ================= 駅員さん（ゴールの門の横。右腕は別。前は +Y） =================
STAFF = M("C7_Staff", 0x1e2a4a)
p = Part()
person(p, 0, 0, STAFF, pants=STAFF, arms=False)
p.tube((-0.21, 0, 1.42), (-0.25, 0.05, 1.0), 0.045, mat=STAFF)  # 左腕
p.ellipsoid((0, 0.0, 1.7), 0.125, 0.13, 0.05, STAFF, rows=3)
p.tube((0, 0.0, 1.67), (0, 0.0, 1.71), 0.126, mat=M("C7_StaffBand", 0xc8202a), seg=10, caps=False)  # 帽子の赤い帯
p.box(-0.08, 0.08, 0.1, 0.2, 1.64, 1.67, BLACK)  # つば
p.cbox((0.08, 0.11, 1.3), 0.04, 0.005, 0.015, M("C7_NameTag", 0xf2f2f2))
p.finish("C7_Staff")
p = Part()  # 右腕（原点は右肩。下へ垂らした形。白い手袋）
p.tube((0, 0, 0), (0.02, 0.02, -0.38), 0.045, mat=STAFF)
p.tube((0.02, 0.02, -0.38), (0.03, 0.04, -0.62), 0.036, mat=STAFF)
p.ellipsoid((0.03, 0.04, -0.67), 0.04, 0.035, 0.055, WHITE, seg=6, rows=3)
p.finish("C7_StaffArm")

# ---- 下見（並べて 1 枚の絵にする） ----
for ob in objs:
    ob.hide_render = True
x = 0.0
for k, ob in enumerate([o for o in objs if not o.name.startswith(('C7_Container', 'C7_Ferry', 'C7_Cloud', 'C7_Rainbow'))]):
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
gm = bpy.data.meshes.new("C7_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C7_PreviewGroundMat"))
gp = bpy.data.objects.new("C7_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C7_Sun", bpy.data.lights.new("C7_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C7_Camera", bpy.data.cameras.new("C7_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C7_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city7_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
