# 街の物 その 10：病院・郵便局・銀行の入口・縁日の夜の電球・コンビニの自動ドア・はとバスとガイドさん・宅配便の車と荷物を運ぶ人・
# 稲光・音符を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city9.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C9_Export」。
#   窓口       C9_Hospital・C9_PostOffice・C9_Bank（建物の壁に付ける入口。+Y が外。置く場所は tools/fetch-osm.mjs の services）
#   縁日       C9_FairBulbs（夜に灯る電球の列。X の向きに 8m。ちょうちんの列と同じ形）
#   コンビニ   C9_AutoDoor（自動ドア 1 枚。ゲームで左右に開く）
#   観光       C9_HatoBus（黄色い二階建てのバス）・C9_TourGroup（旗を上げるガイドさんと観光客の列）
#   宅配       C9_DeliveryVan（止まっている白い軽バン。ハザードが光る）・C9_ParcelWalker（荷物を抱えて歩く人）
#   空         C9_Bolt（稲光。高さ 1）
#   自転車     C9_Note（ベルを鳴らすと出る音符。高さ 1）
# 光る部品の材質の名前は「Light」で始める。下見用は「C9_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city9.blend")
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


export_col = bpy.data.collections.new("C9_Export")
preview_col = bpy.data.collections.new("C9_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C9_Skin", 0xe0b896), M("C9_Hair", 0x231c18), M("C9_Shoe", 0x2b2c31), M("C9_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C9_White", 0xf2f2ee), M("C9_Black", 0x17181b), M("C9_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C9_Wood", 0x8a6440), M("C9_Red", 0xd8322a), M("C9_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C9_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C9_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C9_TextTmp", cu)
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



# ================= 病院・郵便局・銀行の入口（壁に付ける。+Y が外。幅 6m） =================
def front_base(p, wall, glass_mat, w=3.0, h=3.4):
    p.box(-w, w, -0.05, 0.12, 0, h, wall)
    p.box(-1.1, 1.1, 0.12, 0.14, 0, 2.3, glass_mat)  # 入口のガラス（中が明るい）
    p.box(-0.03, 0.03, 0.14, 0.15, 0, 2.3, M("C9_DoorLine", 0x8a8e94))


HWALL = M("C9_HospitalWall", 0xeef0ee)
p = Part()  # 病院（赤い十字の看板と、救急の入口のひさし）
front_base(p, HWALL, M("Light_HospitalDoor", 0xe8f4ff, emit=True))
p.box(-3.2, 3.2, 0.0, 2.6, 2.6, 2.8, M("C9_Canopy", 0xd8dce2))  # 車寄せのひさし
for x in (-3.0, 3.0):
    p.tube((x, 2.5, 0), (x, 2.5, 2.6), 0.08, mat=METAL, seg=6)
p.box(-1.8, 1.8, 2.6, 2.65, 2.6, 3.2, M("Light_ERSign", 0xd8202a, emit=True))
p.text("救急", 0.42, (0, 2.655, 2.9), -X, Z, WHITE)
p.box(-0.6, 0.6, 0.12, 0.16, 3.6, 4.8, WHITE)  # 赤い十字（白い板に）
p.box(-0.45, 0.45, 0.16, 0.18, 4.05, 4.35, M("Light_RedCross", 0xff2a2a, emit=True))
p.box(-0.15, 0.15, 0.16, 0.18, 3.75, 4.65, M("Light_RedCross", 0xff2a2a, emit=True))
p.box(-3.0, 3.0, 0.12, 0.16, 5.0, 5.7, WHITE)
p.text("病院", 0.55, (0, 0.165, 5.35), -X, Z, M("C9_HospitalText", 0x1f4a8a))
p.finish("C9_Hospital")

PRED = M("C9_PostRed", 0xd8202a)
p = Part()  # 郵便局（〒の看板と、入口の横の郵便ポスト）
front_base(p, M("C9_PostWall", 0xe8e2d6), M("Light_PostDoor", 0xfff0d8, emit=True))
p.box(-3.0, 3.0, 0.12, 0.2, 2.6, 3.3, PRED)
p.text("〒 郵便局", 0.5, (0, 0.205, 2.95), -X, Z, WHITE)
p.box(1.5, 1.95, 0.4, 0.85, 0, 1.15, PRED)  # 郵便ポスト（四角い形）
p.box(1.45, 2.0, 0.35, 0.9, 1.15, 1.25, PRED)
p.box(1.55, 1.9, 0.86, 0.87, 0.85, 0.95, BLACK)
p.text("〒", 0.18, (1.725, 0.871, 0.62), -X, Z, WHITE)
p.finish("C9_PostOffice")

p = Part()  # 銀行（青い看板と ATM のコーナー）
BBLUE = M("C9_BankBlue", 0x1f4aa8)
front_base(p, M("C9_BankWall", 0xc8c4bc), M("Light_BankDoor", 0xfff6e8, emit=True))
p.box(-3.0, 3.0, 0.12, 0.2, 2.6, 3.3, BBLUE)
p.text("BANK 銀行", 0.42, (0, 0.205, 2.95), -X, Z, WHITE)
p.box(1.4, 2.8, 0.12, 0.2, 1.9, 2.4, M("Light_ATMSign", 0xf2c230, emit=True))
p.text("ATM", 0.32, (2.1, 0.205, 2.15), -X, Z, M("C9_ATMText", 0x1f2a4a))
for x in (1.6, 2.1, 2.6):
    p.box(x - 0.2, x + 0.2, 0.12, 0.4, 0, 1.35, M("C9_ATM", 0xd8dce2))
    p.box(x - 0.15, x + 0.15, 0.4, 0.41, 0.95, 1.25, M("Light_ATMScreen", 0x5ab0ff, emit=True))
p.finish("C9_Bank")

# ================= 縁日の夜の電球の列（X の向きに 8m。ちょうちんの列と同じ形で、少し下に） =================
p = Part()
BULB9 = M("Light_FairBulb", 0xffe8a0, emit=True)
for k in range(33):
    t = k / 32
    x = t * 8
    z = -0.25 - 0.35 * math.sin(math.pi * t)
    if k < 32:
        t2 = (k + 1) / 32
        p.tube((x, 0, z + 0.03), (t2 * 8, 0, -0.25 - 0.35 * math.sin(math.pi * t2) + 0.03), 0.004, mat=DARK, seg=3)
    p.ellipsoid((x, 0, z), 0.045, 0.045, 0.06, BULB9, seg=5, rows=3)
p.finish("C9_FairBulbs")

# ================= コンビニの自動ドア 1 枚（幅 0.8m・高さ 2.15m。原点は下の真ん中。ゲームで左右に開く） =================
p = Part()
FR9 = M("C9_DoorFrame", 0xb8bcc2, metal=0.5)
p.box(-0.4, 0.4, -0.015, 0.015, 0.0, 0.06, FR9)
p.box(-0.4, 0.4, -0.015, 0.015, 2.09, 2.15, FR9)
for x in (-0.4, 0.37):
    p.box(x, x + 0.03, -0.015, 0.015, 0, 2.15, FR9)
p.box(-0.37, 0.37, -0.005, 0.005, 0.06, 2.09, M("C9_DoorGlass", 0x9ac8e0, rough=0.05, metal=0.2))
p.finish("C9_AutoDoor")

# ================= はとバス（黄色い二階建て。長さ 12m）とガイドさん・観光客の列 =================
HATO = M("C9_HatoYellow", 0xf2c020, rough=0.4)
p = Part()
p.box(-1.25, 1.25, -6, 6, 0.5, 3.7, HATO)
for z0, z1 in ((1.3, 2.1), (2.55, 3.35)):
    for s in (-1, 1):
        p.box(s * 1.25 - 0.01, s * 1.25 + 0.01, -5.6, 5.0, z0, z1, M("C9_BusGlass", 0x2a3a4a, rough=0.1))
p.box(-1.2, 1.2, 5.99, 6.01, 1.2, 3.4, M("C9_BusGlass", 0x2a3a4a, rough=0.1))
p.box(-1.26, 1.26, -6, 6, 0.9, 1.1, M("C9_HatoStripe", 0x8a5a2a))
p.box(-1.0, 1.0, -5, 5, 3.7, 3.8, M("C9_HatoRoof", 0xe8e8e0))
p.box(1.255, 1.27, 3.2, 4.4, 0.5, 2.2, M("C9_BusDoor", 0x2a3a4a))  # 前の乗り口（+X の側）
p.text("はとバス", 0.38, (1.272, -1.0, 2.35), Y, Z, M("C9_HatoText", 0x6a3a1a))
p.text("はとバス", 0.38, (-1.272, -1.0, 2.35), -Y, Z, M("C9_HatoText", 0x6a3a1a))
for x in (-1.05, 1.05):
    for y in (-4.0, 4.0):
        p.tube((x - 0.15, y, 0.48), (x + 0.15, y, 0.48), 0.48, mat=M("C9_Tire", 0x141416), seg=12)
for s in (-1, 1):
    p.cbox((s * 0.95, 6.01, 0.9), 0.15, 0.02, 0.08, M("Light_BusHead", 0xfff6dc, emit=True))
p.finish("C9_HatoBus")
p = Part()  # ガイドさん（旗を上げる。+Y を向く）と観光客 6 人の列（ガイドさんの後ろ、-Y へ並ぶ）
GUIDE = M("C9_Guide", 0x2a6aa8)
person(p, 0, 0, GUIDE, pants=GUIDE, arms=False)
p.ellipsoid((0, 0, 1.69), 0.12, 0.13, 0.05, GUIDE, rows=3)
p.tube((-0.21, 0, 1.42), (-0.25, 0.05, 1.0), 0.045, mat=GUIDE)
p.tube((0.21, 0, 1.42), (0.3, 0.05, 1.95), 0.045, mat=GUIDE)
p.tube((0.3, 0.05, 1.9), (0.32, 0.05, 2.6), 0.012, mat=METAL, seg=4)
p.box(0.33, 0.8, 0.04, 0.06, 2.25, 2.58, M("C9_GuideFlag", 0xf2c020))
TOUR = [M(f"C9_Tourist{k}", h) for k, h in enumerate((0xd84a5a, 0x5a8ad8, 0xe8e0c8, 0x4a9a5a, 0x8a5aa8, 0xf08a3a))]
r = random.Random(11)
for k in range(6):
    y = -1.1 - k * 0.75
    x = r.uniform(-0.25, 0.25)
    person(p, x, y, TOUR[k], h=r.uniform(0.9, 1.05))
    if k % 2 == 0:  # カメラや帽子
        p.ellipsoid((x, y, 1.66), 0.14, 0.15, 0.05, M("C9_Hat", 0xf4f0e0), rows=3)
p.finish("C9_TourGroup")

# ================= 宅配便の車（白い箱の軽バン。長さ 3.4m）と荷物を運ぶ人 =================
p = Part()
VAN = M("C9_VanWhite", 0xf2f2ee, rough=0.4)
p.box(-0.74, 0.74, -1.7, 1.7, 0.35, 1.9, VAN)
p.face([(-0.74, 1.7, 1.9), (0.74, 1.7, 1.9), (0.74, 1.95, 1.2), (-0.74, 1.95, 1.2)], VAN)
p.box(-0.74, 0.74, 1.7, 1.95, 0.35, 1.2, VAN)
p.box(-0.7, 0.7, 1.72, 1.9, 1.25, 1.85, M("C9_BusGlass", 0x2a3a4a, rough=0.1))
for s in (-1, 1):
    p.box(s * 0.74 - 0.005, s * 0.74 + 0.005, 0.7, 1.6, 1.1, 1.75, M("C9_BusGlass", 0x2a3a4a, rough=0.1))
    p.box(s * 0.745 - 0.003, s * 0.745 + 0.003, -1.5, 0.4, 0.55, 1.0, M("C9_VanStripe", 0x2f9a4a))
p.box(-0.6, 0.6, -1.71, -1.7, 0.5, 1.75, M("C9_VanDoor", 0xd8d8d0))
for x in (-0.66, 0.66):
    for y in (-1.15, 1.2):
        p.tube((x - 0.08, y, 0.28), (x + 0.08, y, 0.28), 0.28, mat=M("C9_Tire", 0x141416), seg=10)
for s in (-1, 1):
    p.cbox((s * 0.55, -1.72, 0.7), 0.08, 0.01, 0.06, M("Light_HazardL", 0xffa020, emit=True))  # ハザード（止まっている）
p.finish("C9_DeliveryVan")
p = Part()  # 荷物を両手で抱えて歩く人（+Y を向く）
UNI9 = M("C9_DeliUniform", 0x2a5a3a)
person(p, 0, 0, UNI9, pants=UNI9, arms=False)
p.ellipsoid((0, 0, 1.69), 0.12, 0.13, 0.06, UNI9, rows=3)
for s in (-1, 1):
    p.tube((s * 0.21, 0, 1.42), (s * 0.2, 0.25, 1.15), 0.045, mat=UNI9)
p.box(-0.22, 0.22, 0.12, 0.45, 1.0, 1.3, M("C9_Parcel", 0xc8965a))
p.box(-0.222, 0.222, 0.27, 0.3, 1.0, 1.3, M("C9_Tape", 0xe8e0c8))
p.finish("C9_ParcelWalker")

# ================= 稲光（高さ 1 の折れ線。ゲームで空の遠くに大きく出す） =================
p = Part()
BOLT = M("Light_Bolt", 0xe8f0ff, emit=True)
r = random.Random(21)
pts = [Vector((0, 0, 1.0))]
for k in range(10):
    pts.append(pts[-1] + Vector((r.uniform(-0.09, 0.09), 0, -0.1)))
for a, b in zip(pts, pts[1:]):
    p.tube(a, b, 0.012, 0.01, mat=BOLT, seg=4)
for start in (3, 6):  # 枝分かれ
    q = pts[start]
    for k in range(3):
        nq = q + Vector((r.uniform(0.03, 0.09) * (1 if start == 3 else -1), 0, -0.08))
        p.tube(q, nq, 0.007, 0.004, mat=BOLT, seg=3)
        q = nq
p.finish("C9_Bolt")

# ================= 音符（ベルを鳴らすと出る。♪ の形。高さ 1） =================
p = Part()
NOTE = M("Light_Note", 0xffe040, emit=True)
p.ellipsoid((0, 0, 0.12), 0.16, 0.05, 0.11, NOTE, seg=10, rows=5)
p.box(0.12, 0.17, -0.025, 0.025, 0.12, 0.95, NOTE)
p.face([(0.17, 0, 0.95), (0.42, 0, 0.75), (0.42, 0, 0.62), (0.17, 0, 0.8)], NOTE)
p.face([(0.17, 0, 0.95), (0.17, 0, 0.8), (0.42, 0, 0.62), (0.42, 0, 0.75)], NOTE)
p.finish("C9_Note")

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
gm = bpy.data.meshes.new("C9_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C9_PreviewGroundMat"))
gp = bpy.data.objects.new("C9_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C9_Sun", bpy.data.lights.new("C9_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C9_Camera", bpy.data.cameras.new("C9_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C9_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city9_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
