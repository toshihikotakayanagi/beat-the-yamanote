# 街の物 その 7：夏の夜の花火・季節の行事の飾り・富士山・道を走る大きな車・工事現場の警備員・公園の人・配達の人・
# 商店街のアーケード・大型ビジョン・自転車の飾りを、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city6.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z。動く物は +Y へ進む）。原点はどれも物の根元。書き出すものは「C6_Export」。
#   花火       C6_Burst（開いた形。半径 1。光る粒は白で、ゲームで色を付けて広げる）
#   行事       C6_Koinobori（鯉のぼり。+X へなびく）・C6_Pumpkins（ハロウィンのかぼちゃ）・C6_Kadomatsu（門松 1 対）・C6_Shimekazari（しめ飾り）
#   富士山     C6_Fuji・C6_FujiSnow（実物の大きさ。雪の帽子は別。ゲームで遠くの目印と同じように縮めて置く）
#   大きな車   C6_OpenBus（屋根なしの二階建てバス）・C6_Tanker（タンクローリー）・C6_Mover（引っ越し）・C6_Garbage（ゴミ収集車）・
#              C6_AdTruck（宣伝トラック。側面の看板の画はゲームで貼る）
#   人         C6_Guard と C6_GuardArm（警備員と、誘導灯を持つ右腕。原点は右肩）・C6_Jogger・C6_Stroller（ベビーカー）・
#              C6_BenchSitter（ベンチと 2 人）・C6_Kids と C6_PlayBall（ボール遊びの子ども 2 人とボール）・C6_Courier（台車の配達員）・C6_CargoBike（自転車便）
#   アーケード C6_ArcadeRoof（屋根 1 区切り。幅 1 をゲームで道幅に伸ばす）・C6_ArcadePost（柱）・C6_ArcadeGate（入口のアーチ。名前の板の字はゲームで貼る）
#   ビジョン   C6_Vision（大型ビジョンの枠。画はゲームで貼る）
#   自転車     C6_Bag（かごの買い物袋）・C6_Flowers（かごの花束）・C6_Backpack・C6_PackFlowers（背中のリュック）・C6_ScarfRing と C6_ScarfTail（マフラー）
# 光る部品の材質の名前は「Light」で始める。下見用は「C6_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city6.blend")
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


export_col = bpy.data.collections.new("C6_Export")
preview_col = bpy.data.collections.new("C6_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C6_Skin", 0xe0b896), M("C6_Hair", 0x231c18), M("C6_Shoe", 0x2b2c31), M("C6_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C6_White", 0xf2f2ee), M("C6_Black", 0x17181b), M("C6_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C6_Wood", 0x8a6440), M("C6_Red", 0xd8322a), M("C6_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C6_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C6_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C6_TextTmp", cu)
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



# ================= 夏の夜の花火 =================
p = Part()  # 花火の開いた形（半径 1。光の粒と、内側へ尾を引く小さな粒。ゲームで広げて色を付ける）
BURST, BURST2, BURST3 = M("Light_Burst", 0xffffff, emit=True), M("Light_Burst2", 0x9a9a9a, emit=True), M("Light_Burst3", 0x505050, emit=True)
n = 140
for k in range(n):
    zz = 1 - 2 * (k + 0.5) / n
    rr = math.sqrt(1 - zz * zz)
    a = k * 2.39996
    d = Vector((math.cos(a) * rr, math.sin(a) * rr, zz))
    for r, size, mat in ((1.0, 0.035, BURST), (0.86, 0.026, BURST2), (0.74, 0.018, BURST3)):
        c = d * r
        p.ellipsoid(c, size, size, size, mat, seg=4, rows=2)
p.finish("C6_Burst")

# ================= 季節の行事 =================
POLE = M("C6_Pole", 0xd8d8d0)
CARP = [M("C6_CarpBlack", 0x1e2028), M("C6_CarpRed", 0xd8322a), M("C6_CarpBlue", 0x2f6fde)]
p = Part()  # 鯉のぼり（高さ 7m の竿に、吹き流しと 3 匹。+X の向きになびく）
p.tube((0, 0, 0), (0, 0, 7.2), 0.07, 0.04, mat=POLE, seg=6)
p.ellipsoid((0, 0, 7.3), 0.1, 0.1, 0.1, M("C6_PoleBall", 0xe0b030, metal=0.6), seg=6, rows=4)
p.tube((0, 0, 7.0), (0.4, 0, 7.0), 0.01, mat=DARK, seg=3)
for k, col in enumerate((0x2f6fde, 0xf2c230, 0xd8322a, 0x2f9a4a, 0xf4f4f0)):  # 吹き流し
    m = M(f"C6_Fuki{k}", col)
    z = 6.95 - k * 0.12
    p.face([(0.05, 0, z), (2.2, 0.05 * (k - 2), z - 0.25), (2.2, 0.05 * (k - 2), z - 0.37), (0.05, 0, z - 0.12)], m)
for k, (z, L) in enumerate(((6.2, 2.6), (5.2, 2.2), (4.3, 1.8))):
    mat = CARP[k]
    R = L * 0.16
    pts = [Vector((0.15 + L * t, 0, z - L * 0.08 * t)) for t in (0, 0.2, 0.5, 0.8, 1.0)]
    rad = [R, R * 1.05, R * 0.9, R * 0.55, R * 0.2]
    for j, (a, b) in enumerate(zip(pts, pts[1:])):
        p.tube(a, b, rad[j], rad[j + 1], mat=mat, seg=8, caps=False)
    p.face([pts[-1], pts[-1] + Vector((0.4, 0, R * 1.3)), pts[-1] + Vector((0.4, 0, -R * 1.3))], mat)  # 尾びれ
    p.tube(pts[0] - Vector((0.02, 0, 0)), pts[0] + Vector((0.04, 0, 0)), R * 1.02, R * 1.02, mat=WHITE, seg=8, caps=False)  # 口の白い輪
    for s in (-1, 1):
        p.ellipsoid(pts[0] + Vector((0.25, s * R * 0.92, R * 0.25)), 0.06 * L / 2, 0.02, 0.06 * L / 2, WHITE, seg=6, rows=3)  # 目
        p.ellipsoid(pts[0] + Vector((0.26, s * R * 0.95, R * 0.25)), 0.03 * L / 2, 0.015, 0.03 * L / 2, BLACK, seg=5, rows=3)
p.finish("C6_Koinobori")

PUMP, PUMP2 = M("C6_Pumpkin", 0xe8781a), M("C6_PumpkinStem", 0x4a6a2a)
FACE = M("Light_PumpkinFace", 0xffc040, emit=True)
p = Part()  # ハロウィンのかぼちゃ 3 つ（顔は光る。+Y が前）と、わらの台
p.box(-0.7, 0.7, -0.35, 0.35, 0, 0.4, M("C6_Hay", 0xd8b860))
for x, z, r in ((-0.38, 0.4, 0.28), (0.35, 0.4, 0.24), (0.0, 0.62, 0.22)):
    for k in range(8):
        a = k * math.tau / 8
        p.ellipsoid((x + math.cos(a) * r * 0.35, math.sin(a) * r * 0.35, z + r * 0.85), r * 0.55, r * 0.55, r * 0.85, PUMP, seg=7, rows=5)
    p.tube((x, 0, z + r * 1.65), (x + 0.03, 0, z + r * 1.95), 0.03, 0.02, mat=PUMP2, seg=5)
    fy = r * 0.86
    for s in (-1, 1):
        p.face([(x + s * r * 0.45, fy, z + r * 1.05), (x + s * r * 0.2, fy, z + r * 1.05), (x + s * r * 0.32, fy, z + r * 1.3)], FACE)
    p.face([(x - r * 0.5, fy, z + r * 0.7), (x + r * 0.5, fy, z + r * 0.7), (x + r * 0.3, fy, z + r * 0.5), (x - r * 0.3, fy, z + r * 0.5)], FACE)
p.finish("C6_Pumpkins")

BAMBOO6, PINE, STRAW = M("C6_Bamboo", 0x6aa83a), M("C6_Pine", 0x2f6a34), M("C6_Straw", 0xc8a860)
p = Part()  # 門松（左右 1 対。+Y が前）
for x in (-0.55, 0.55):
    p.tube((x, 0, 0), (x, 0, 0.55), 0.3, 0.3, mat=STRAW, seg=12)
    for k in range(3):
        p.box(x - 0.31, x + 0.31, -0.31, 0.31, 0.12 + k * 0.17, 0.15 + k * 0.17, M("C6_Rope", 0x6a4a2a))
    for k, (dx, dy, h) in enumerate(((0, 0.05, 1.45), (-0.08, -0.06, 1.2), (0.08, -0.06, 1.0))):
        top = Vector((x + dx, dy, h))
        p.tube((x + dx, dy, 0.5), top, 0.045, mat=BAMBOO6, seg=6, caps=False)
        p.face([top + Vector((-0.045, 0, -0.02)), top + Vector((0.045, 0, -0.1)), top + Vector((0.045, 0, 0.02)), top + Vector((-0.045, 0, 0.1))], M("C6_BambooCut", 0xe8e0b0))
    for k in range(7):
        a = k * math.tau / 7
        p.ellipsoid((x + math.cos(a) * 0.22, math.sin(a) * 0.22, 0.62), 0.14, 0.14, 0.1, PINE, seg=6, rows=3)
    p.ellipsoid((x + 0.2, 0.25, 0.68), 0.04, 0.04, 0.04, M("C6_Berry", 0xd8322a), seg=5, rows=3)
p.finish("C6_Kadomatsu")

p = Part()  # しめ飾り（入口の上に掛ける。+Y が前）
for k in range(12):
    a0, a1 = k * math.tau / 12, (k + 1) * math.tau / 12
    p.tube((math.cos(a0) * 0.18, 0, math.sin(a0) * 0.18), (math.cos(a1) * 0.18, 0, math.sin(a1) * 0.18), 0.035, mat=STRAW, seg=5)
for s in (-1, 1):
    p.face([(s * 0.06, 0.03, -0.12), (s * 0.13, 0.03, -0.12), (s * 0.11, 0.03, -0.45), (s * 0.04, 0.03, -0.45)], STRAW)
for x in (-0.09, 0.09):  # 紙垂
    for k in range(3):
        z = -0.1 - k * 0.1
        p.face([(x - 0.03, 0.04, z), (x + 0.03, 0.04, z), (x + 0.03, 0.04, z - 0.08), (x - 0.03, 0.04, z - 0.08)], WHITE)
p.ellipsoid((0, 0.06, 0.02), 0.07, 0.06, 0.065, M("C6_Daidai", 0xf08a1a), seg=8, rows=5)
p.ellipsoid((0, 0.04, 0.14), 0.08, 0.03, 0.05, M("C6_Leaf", 0x2f8a34), seg=6, rows=3)
p.finish("C6_Shimekazari")

# ================= 富士山（実物の大きさ m。ゲームでは遠くの目印と同じように縮めて置く） =================
FUJI, FUJI_SNOW = M("C6_Fuji", 0x5a6a88, rough=0.9), M("C6_FujiSnow", 0xf2f6fa, rough=0.9)
prof = [(0, 3776), (700, 3700), (2000, 3200), (4000, 2500), (7000, 1700), (11000, 1000), (16000, 450), (22000, 0)]  # 半径・高さ
SEG = 48


def mountain(name, lo, hi, mat, jag=0.0):
    p = Part()
    rings = []
    for r, h in prof:
        if h < lo - 1 or h > hi + 1:
            continue
        ring = []
        for k in range(SEG):
            a = k * math.tau / SEG
            j = 1 + 0.05 * math.sin(a * 5 + r) + 0.03 * math.sin(a * 13)
            ring.append(Vector((math.cos(a) * r * j, math.sin(a) * r * j, h)))
        rings.append(ring)
    if lo > 0:  # 雪のふちはぎざぎざに下げる
        last = rings[-1]
        jagged = []
        for k, v in enumerate(last):
            drop = jag * (0.5 + 0.5 * math.sin(k * 2.7) * math.sin(k * 1.3))
            jagged.append(Vector((v.x * (1 + drop / 3000), v.y * (1 + drop / 3000), v.z - drop)))
        rings[-1] = jagged
    for A, B in zip(rings, rings[1:]):
        for k in range(SEG):
            p.face([A[k], A[(k + 1) % SEG], B[(k + 1) % SEG], B[k]], mat)
    return p.finish(name)


prof_body = prof
mountain("C6_Fuji", 0, 3776, FUJI)
prof = [(0, 3790), (700, 3714), (2000, 3214), (3300, 2750)]  # 少し外へ浮かせた雪の帽子
mountain("C6_FujiSnow", 2750, 3790, FUJI_SNOW, jag=450)
prof = prof_body

# ================= 道を走る大きな車 =================
TIRE6 = M("C6_Tire", 0x141416, rough=0.9)
HEAD, TAIL = M("Light_Head6", 0xfff6dc, emit=True), M("Light_Tail6", 0xff3030, emit=True)
CABG6 = M("C6_CabGlass", 0x2a3a4a, rough=0.1)


def wheels(p, xs, ys, r=0.48, w=0.3):
    for x in xs:
        for y in ys:
            p.tube((x - w / 2, y, r), (x + w / 2, y, r), r, mat=TIRE6, seg=12)


def lights(p, w, front, back, zf=0.9):
    for s in (-1, 1):
        p.cbox((s * (w - 0.25), front + 0.01, zf), 0.15, 0.02, 0.08, HEAD)
        p.cbox((s * (w - 0.2), back - 0.01, 0.9), 0.1, 0.02, 0.12, TAIL)


def cab(p, color, y0=2.4, y1=4.4, w=1.24, h=2.9):
    """トラックの運転台（前は +Y）"""
    p.box(-w, w, y0, y1, 0.6, h, color)
    p.box(-w + 0.06, w - 0.06, y1 - 0.01, y1 + 0.01, 1.7, h - 0.25, CABG6)
    for s in (-1, 1):
        p.box(s * w - 0.01, s * w + 0.01, y0 + 0.9, y1 - 0.2, 1.7, h - 0.3, CABG6)


p = Part()  # 二階建ての観光バス（屋根なし。長さ 12m）
RED_BUS = M("C6_BusRed", 0xc8202a, rough=0.4)
p.box(-1.25, 1.25, -6, 6, 0.5, 2.1, RED_BUS)
p.box(-1.24, 1.24, -6, 6, 2.1, 2.8, CABG6)  # 1 階の窓
p.box(-1.25, 1.25, -6, 6, 2.8, 3.3, RED_BUS)
p.box(-1.25, 1.25, 5.98, 6.01, 1.3, 2.8, CABG6)
for s in (-1, 1):
    p.box(s * 1.25 - 0.03, s * 1.25 + 0.03, -6, 6, 3.3, 4.0, RED_BUS)  # 2 階の手すりの壁
p.box(-1.25, 1.25, 5.95, 6.0, 3.3, 4.0, RED_BUS)
p.box(-1.25, 1.25, -6.0, -5.95, 3.3, 4.0, RED_BUS)
for k in range(9):  # 2 階の座席と客
    y = -5 + k * 1.2
    for s in (-1, 1):
        p.box(s * 0.65 - 0.4, s * 0.65 + 0.4, y - 0.15, y + 0.1, 3.3, 3.8, DARK)
        if (k + (s > 0)) % 3:
            p.ellipsoid((s * 0.65, y + 0.25, 4.05), 0.11, 0.12, 0.13, SKIN if k % 2 else HAIR)
            p.ellipsoid((s * 0.65, y + 0.25, 3.75), 0.18, 0.12, 0.22, M(f"C6_Shirt{k % 4}", (0x2f6fde, 0xf2c230, 0xf4f4f0, 0x4ab84a)[k % 4]))
p.box(-1.26, 1.26, -2, 2, 1.0, 1.4, M("C6_BusStripe", 0xf2c230))
wheels(p, (-1.05, 1.05), (-4.0, 4.0))
lights(p, 1.25, 6.0, -6.0)
p.finish("C6_OpenBus")

p = Part()  # タンクローリー（長さ 10m）
TANKW = M("C6_TankSilver", 0xd8dce2, rough=0.3, metal=0.6)
cab(p, M("C6_TruckBlue", 0x2f5fbf, rough=0.4), 2.6, 4.9)
p.box(-1.0, 1.0, -5.0, 2.5, 0.5, 0.9, DARK)
p.tube((0, -4.9, 2.0), (0, 2.4, 2.0), 1.15, 1.15, mat=TANKW, seg=14)
p.box(-1.16, 1.16, -1.4, -0.6, 0.9, 3.0, M("C6_TankBand", 0xd8322a))
p.text("危", 0.6, (0, -4.92, 2.1), X, Z, M("C6_Warn", 0xf2c230))  # 後ろの面（後ろから読む）
wheels(p, (-1.05, 1.05), (-4.0, -2.8, 3.7))
lights(p, 1.24, 4.9, -5.0)
p.finish("C6_Tanker")

p = Part()  # 引っ越しのトラック（荷台の箱に、段ボールの絵）
cab(p, WHITE, 2.4, 4.3)
BOXW = M("C6_MoverBox", 0xf4f4f0, rough=0.5)
p.box(-1.25, 1.25, -4.5, 2.3, 0.6, 3.3, BOXW)
p.box(-1.26, 1.26, -4.5, 2.3, 0.6, 0.95, M("C6_MoverStripe", 0x2f9a4a))
for s in (-1, 1):
    p.box(s * 1.262, s * 1.27, -3.0, -1.4, 1.4, 2.6, M("C6_Cardboard", 0xc8965a))
    p.text("おひっこし", 0.42, (s * 1.272, 0.4, 2.0), Y * s, Z, M("C6_MoverText", 0x2f9a4a))
wheels(p, (-1.05, 1.05), (-3.3, 3.2))
lights(p, 1.24, 4.3, -4.5)
p.finish("C6_Mover")

p = Part()  # ゴミ収集車（後ろの投入口）
cab(p, WHITE, 1.9, 3.6, h=2.7)
GBODY = M("C6_Garbage", 0x3a8a4a, rough=0.4)
p.box(-1.1, 1.1, -2.6, 1.85, 0.6, 2.7, GBODY)
p.box(-1.12, 1.12, -3.4, -2.6, 0.5, 2.5, GBODY)
p.box(-0.9, 0.9, -3.42, -3.4, 0.7, 1.6, BLACK)  # 投入口
p.box(-1.11, 1.11, -1.0, 0.5, 1.3, 2.0, WHITE)
wheels(p, (-0.95, 0.95), (-1.8, 2.6), r=0.44)
lights(p, 1.1, 3.6, -3.4)
p.finish("C6_Garbage")

p = Part()  # 宣伝トラック（荷台の両側と後ろが光る看板。看板の画はゲームで貼る：側面は x = ±1.27、y -3.9〜0.9、高さ 1.2〜3.2）
cab(p, M("C6_AdCab", 0x1e2028, rough=0.4), 1.5, 3.4)
p.box(-1.25, 1.25, -4.1, 1.1, 0.6, 3.4, DARK)
for s in (-1, 1):
    p.box(s * 1.25, s * 1.265, -4.0, 1.0, 1.1, 3.3, M("C6_AdFrame", 0x404450))
p.box(-1.0, 1.0, -4.12, -4.1, 1.2, 3.2, M("Light_AdBack", 0xff4aa8, emit=True))
wheels(p, (-1.05, 1.05), (-3.0, 2.4))
lights(p, 1.24, 3.4, -4.1)
p.finish("C6_AdTruck")

# ================= 人 =================
GUARD, GUARD2 = M("C6_GuardBlue", 0x2a3a6a), M("C6_Reflect", 0xd8f040)
BATON = M("Light_Baton", 0xff3020, emit=True)
p = Part()  # 工事現場の警備員（右腕は別。+Y が前）
person(p, 0, 0, GUARD, pants=GUARD, arms=False)
p.tube((-0.21, 0, 1.42), (-0.25, 0.05, 1.0), 0.045, mat=GUARD)  # 左腕
p.box(-0.2, 0.2, 0.1, 0.13, 1.1, 1.18, GUARD2)  # 反射たすき
p.box(-0.04, 0.04, 0.1, 0.13, 0.95, 1.4, GUARD2)
p.ellipsoid((0, 0.0, 1.68), 0.13, 0.14, 0.1, WHITE, rows=3, top=0.55)  # ヘルメット
p.finish("C6_Guard")
p = Part()  # 右腕と誘導灯（原点は右肩。前へ伸ばした形。ゲームで振る）
p.tube((0, 0, 0), (0.02, 0.3, -0.12), 0.045, mat=GUARD)
p.tube((0.02, 0.3, -0.12), (0.03, 0.55, -0.1), 0.035, mat=SKIN)
p.tube((0.03, 0.55, -0.1), (0.04, 0.6, 0.45), 0.03, mat=BATON, seg=8)
p.finish("C6_GuardArm")

p = Part()  # ジョギングする人（走る形）
RUN = M("C6_RunShirt", 0x2fb0d0)
p.tube((0.09, 0.15, 0.84), (0.09, -0.15, 0.45), 0.065, mat=M("C6_RunShorts", 0x1e2028))
p.tube((0.09, -0.15, 0.45), (0.09, -0.35, 0.1), 0.05, mat=SKIN)
p.ellipsoid((0.09, -0.33, 0.05), 0.05, 0.11, 0.05, M("C6_Shoe", 0xf2f2f2), seg=6, rows=3)
p.tube((-0.09, -0.05, 0.84), (-0.09, 0.25, 0.5), 0.065, mat=M("C6_RunShorts", 0x1e2028))
p.tube((-0.09, 0.25, 0.5), (-0.09, 0.1, 0.12), 0.05, mat=SKIN)
p.ellipsoid((-0.09, 0.12, 0.07), 0.05, 0.11, 0.05, M("C6_Shoe", 0xf2f2f2), seg=6, rows=3)
p.ellipsoid((0, 0.05, 1.17), 0.18, 0.12, 0.32, RUN)
p.ellipsoid((0, 0.1, 1.6), 0.1, 0.11, 0.12, SKIN)
p.ellipsoid((0, 0.08, 1.67), 0.11, 0.12, 0.07, M("C6_Cap6", 0xf2f2f2), rows=3)
for s, f in ((-1, 1), (1, -1)):
    p.tube((s * 0.21, 0.05, 1.42), (s * 0.25, 0.05 + f * 0.2, 1.18), 0.042, mat=RUN)
    p.tube((s * 0.25, 0.05 + f * 0.2, 1.18), (s * 0.2, 0.05 + f * 0.32, 1.32), 0.035, mat=SKIN)
p.finish("C6_Jogger")

p = Part()  # ベビーカーを押す人
person(p, 0, -0.55, M("C6_Coat", 0xb08a6a), arms=False)
for s in (-1, 1):
    p.tube((s * 0.21, -0.55, 1.42), (s * 0.18, -0.2, 1.0), 0.045, mat=M("C6_Coat", 0xb08a6a))
STR = M("C6_Stroller", 0x2f6fae)
p.box(-0.25, 0.25, 0.1, 0.65, 0.45, 0.75, STR)
p.ellipsoid((0, 0.5, 0.75), 0.27, 0.22, 0.25, STR, rows=4, top=0.5)  # 幌
p.tube((-0.22, -0.18, 1.0), (0.22, -0.18, 1.0), 0.02, mat=DARK, seg=4)
for s in (-1, 1):
    p.tube((s * 0.22, -0.18, 1.0), (s * 0.22, 0.1, 0.55), 0.015, mat=METAL, seg=4)
    for y in (0.15, 0.6):
        p.tube((s * 0.23 - 0.02, y, 0.11), (s * 0.23 + 0.02, y, 0.11), 0.11, mat=DARK, seg=8)
p.finish("C6_Stroller")

p = Part()  # ベンチと、座って休む 2 人（+Y が前）
p.box(-0.9, 0.9, -0.2, 0.2, 0.42, 0.47, WOOD)
p.box(-0.9, 0.9, -0.22, -0.18, 0.5, 0.85, WOOD)
for x in (-0.75, 0.75):
    p.box(x - 0.04, x + 0.04, -0.2, 0.2, 0, 0.42, METAL)
for x, shirt in ((-0.4, M("C6_Shirt4", 0x8a5aa8)), (0.42, M("C6_Shirt5", 0x5a8a6a))):
    p.ellipsoid((x, -0.02, 0.85), 0.18, 0.12, 0.3, shirt)
    p.ellipsoid((x, 0.0, 1.27), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((x, -0.01, 1.34), 0.105, 0.115, 0.08, HAIR if x < 0 else M("C6_Gray", 0xc8c8c8), rows=3)
    for s in (-1, 1):
        p.tube((x + s * 0.09, 0.0, 0.5), (x + s * 0.09, 0.42, 0.5), 0.065, mat=PANTS)
        p.tube((x + s * 0.09, 0.42, 0.5), (x + s * 0.09, 0.45, 0.06), 0.052, mat=PANTS)
        p.ellipsoid((x + s * 0.09, 0.5, 0.04), 0.05, 0.11, 0.04, SHOE, seg=6, rows=3)
        p.tube((x + s * 0.2, 0, 1.08), (x + s * 0.17, 0.25, 0.72), 0.042, mat=shirt)
p.finish("C6_BenchSitter")

p = Part()  # ボール遊びをする子ども 2 人（X の向きに 3m 離れて向かい合う）
for x, shirt, face in ((-1.5, M("C6_KidShirt0", 0xf2c230), 1), (1.5, M("C6_KidShirt1", 0xd8322a), -1)):
    for s in (-1, 1):
        p.tube((x, s * 0.06, 0.55), (x, s * 0.06, 0.05), 0.05, 0.04, mat=PANTS)
        p.ellipsoid((x + face * 0.03, s * 0.06, 0.03), 0.08, 0.04, 0.03, SHOE, seg=6, rows=3)
    p.ellipsoid((x, 0, 0.75), 0.11, 0.13, 0.22, shirt)
    p.ellipsoid((x, 0, 1.06), 0.09, 0.09, 0.1, SKIN)
    p.ellipsoid((x - face * 0.01, 0, 1.11), 0.095, 0.095, 0.07, HAIR, rows=3)
    for s in (-1, 1):
        p.tube((x, s * 0.13, 0.92), (x + face * 0.22, s * 0.1, 0.85), 0.032, mat=shirt)
p.finish("C6_Kids")
p = Part()
p.ellipsoid((0, 0, 0.11), 0.11, 0.11, 0.11, M("C6_BallW", 0xf4f4f0), seg=8, rows=5)
p.tube((-0.112, 0, 0.11), (0.112, 0, 0.11), 0.06, mat=M("C6_BallR", 0xd8322a), seg=8)
p.finish("C6_PlayBall")

# ================= 配達 =================
UNI, BOX6 = M("C6_Uniform", 0x2a6a4a), M("C6_Parcel", 0xc8965a)
p = Part()  # 台車で荷物を運ぶ配達員（台車は前）
person(p, 0, -0.5, UNI, arms=False)
p.ellipsoid((0, -0.5, 1.68), 0.115, 0.13, 0.06, UNI, rows=3)  # 帽子
for s in (-1, 1):
    p.tube((s * 0.21, -0.5, 1.42), (s * 0.24, -0.15, 1.0), 0.045, mat=UNI)
p.box(-0.32, 0.32, -0.15, 0.6, 0.12, 0.16, METAL)
p.tube((-0.28, -0.15, 0.16), (-0.28, -0.15, 1.0), 0.015, mat=METAL, seg=4)
p.tube((0.28, -0.15, 0.16), (0.28, -0.15, 1.0), 0.015, mat=METAL, seg=4)
p.tube((-0.28, -0.15, 1.0), (0.28, -0.15, 1.0), 0.015, mat=METAL, seg=4)
for k, (y, z, w, h) in enumerate(((0.22, 0.16, 0.28, 0.25), (0.25, 0.66, 0.24, 0.2), (0.2, 1.06, 0.2, 0.16))):
    p.box(-w, w, y - 0.25, y + 0.25, z, z + h * 2, BOX6)
    p.box(-w - 0.002, w + 0.002, y - 0.02, y + 0.02, z, z + h * 2, M("C6_Tape", 0xe8e0c8))
for s in (-1, 1):
    for y in (-0.05, 0.5):
        p.tube((s * 0.3 - 0.02, y, 0.07), (s * 0.3 + 0.02, y, 0.07), 0.07, mat=DARK, seg=8)
p.finish("C6_Courier")

p = Part()  # 荷物を積んだ自転車便（前に大きな荷台の箱。乗る人もいっしょ）
for y in (-0.6, 0.95):
    p.tube((-0.03, y, 0.32), (0.03, y, 0.32), 0.32, mat=TIRE6, seg=14)
FR = M("C6_CargoFrame", 0x2f9a4a)
p.tube((0, -0.6, 0.32), (0, 0.05, 0.3), 0.025, mat=FR)
p.tube((0, 0.05, 0.3), (0, -0.25, 0.9), 0.025, mat=FR)
p.tube((0, 0.05, 0.3), (0, 0.55, 0.85), 0.025, mat=FR)
p.tube((0, 0.55, 0.85), (0, 0.95, 0.32), 0.025, mat=FR)
p.tube((0, 0.55, 0.85), (0, 0.45, 1.1), 0.02, mat=METAL)
p.tube((-0.28, 0.42, 1.1), (0.28, 0.42, 1.1), 0.015, mat=METAL)
p.box(-0.32, 0.32, 0.65, 1.3, 0.6, 1.15, M("C6_CargoBox", 0x2f9a4a))
p.text("便", 0.3, (0.325, 0.97, 0.88), Y, Z, WHITE)
p.text("便", 0.3, (-0.325, 0.97, 0.88), -Y, Z, WHITE)
p.ellipsoid((0, -0.3, 1.2), 0.17, 0.13, 0.28, UNI)
p.ellipsoid((0, -0.12, 1.6), 0.1, 0.11, 0.12, SKIN)
p.ellipsoid((0, -0.14, 1.68), 0.12, 0.14, 0.1, M("C6_Helmet6", 0xf2f2f2), rows=3, top=0.55)
p.box(-0.22, 0.22, -0.6, -0.25, 1.05, 1.5, M("C6_Bag6", 0x2f9a4a))
for s in (-1, 1):
    p.tube((s * 0.17, -0.25, 1.4), (s * 0.26, 0.4, 1.1), 0.04, mat=UNI)
    p.tube((s * 0.1, -0.35, 0.98), (s * 0.12, 0.0, 0.62), 0.06, mat=PANTS)
    p.tube((s * 0.12, 0.0, 0.62), (s * 0.12, 0.08, 0.2), 0.045, mat=PANTS)
p.finish("C6_CargoBike")

# ================= 商店街のアーケード =================
ROOF6, FRAME6 = M("C6_ArcadeRoof", 0xd8dce2, rough=0.4), M("C6_ArcadeFrame", 0x7a8290, metal=0.4)
p = Part()  # 屋根 1 区切り（長さ 4m・幅 1 ＝ ゲームで道の幅に伸ばす。高さ 6.2m からかまぼこ形に 1.2m 上がる）
N = 8
arc = [(-0.5 + k / N, 6.2 + 1.2 * math.sin(math.pi * k / N)) for k in range(N + 1)]
for (x0, z0), (x1, z1) in zip(arc, arc[1:]):
    p.face([(x0, -2, z0), (x1, -2, z1), (x1, 2, z1), (x0, 2, z0)], ROOF6)
    p.box(min(x0, x1), max(x0, x1), -2.0, -1.85, min(z0, z1) - 0.12, max(z0, z1), FRAME6)  # 骨組み
p.box(-0.5, 0.5, -0.05, 0.05, 7.35, 7.45, FRAME6)
p.finish("C6_ArcadeRoof")
p = Part()  # 柱（道の両端に立つ）
p.box(-0.12, 0.12, -0.12, 0.12, 0, 6.3, FRAME6)
p.box(-0.18, 0.18, -0.18, 0.18, 0, 0.3, FRAME6)
p.finish("C6_ArcadePost")
p = Part()  # 入口のアーチ（幅 10m。名前の板は +Y の面、x -3.5〜3.5、高さ 7.6〜8.8。字はゲームで貼る）
for x in (-5, 5):
    p.box(x - 0.25, x + 0.25, -0.25, 0.25, 0, 8.0, M("C6_GateRed", 0xb8302a))
p.box(-5.3, 5.3, -0.3, 0.3, 7.4, 9.0, M("C6_GateRed", 0xb8302a))
p.box(-3.6, 3.6, 0.3, 0.33, 7.5, 8.9, M("C6_GateGold", 0xe0b030, metal=0.5))
for k in range(9):
    x = -4.6 + k * 1.15
    p.ellipsoid((x, 0.4, 7.2), 0.16, 0.16, 0.22, M("Light_GateLamp", 0xffd08a, emit=True), seg=8, rows=5)
p.finish("C6_ArcadeGate")

# ================= 大型ビジョン（画はゲームで貼る：+Y の面、x -5〜5、高さ 0.4〜6.0） =================
p = Part()
p.box(-5.4, 5.4, -0.5, 0.0, 0, 6.4, M("C6_VisionFrame", 0x24262c))
p.box(-5.1, 5.1, -0.2, 0.02, 0.25, 6.15, BLACK)
for x in (-4, 0, 4):
    p.box(x - 0.15, x + 0.15, -1.0, -0.5, 1.0, 5.4, METAL)
p.finish("C6_Vision")

# ================= 自転車の飾り（ゲームで自転車の体に付ける。前は +Y） =================
p = Part()  # 買い物袋（かごの中。ねぎが出ている）
p.box(-0.13, 0.13, -0.09, 0.09, 0, 0.26, M("C6_EcoBag", 0xe8e0c8))
p.tube((-0.1, 0, 0.26), (-0.1, 0, 0.38), 0.012, mat=M("C6_EcoBag", 0xe8e0c8), seg=4)
p.tube((0.1, 0, 0.26), (0.1, 0, 0.38), 0.012, mat=M("C6_EcoBag", 0xe8e0c8), seg=4)
p.tube((-0.1, 0, 0.38), (0.1, 0, 0.38), 0.012, mat=M("C6_EcoBag", 0xe8e0c8), seg=4)
p.tube((0.05, -0.03, 0.1), (0.1, -0.15, 0.55), 0.022, mat=WHITE, seg=6)  # ねぎ
p.tube((0.1, -0.15, 0.55), (0.13, -0.24, 0.7), 0.02, mat=M("C6_Negi", 0x3a9a3a), seg=6)
p.ellipsoid((-0.06, 0.03, 0.28), 0.06, 0.05, 0.05, M("C6_Apple", 0xd8322a), seg=6, rows=4)
p.finish("C6_Bag")
p = Part()  # 花束（かごの中）
p.tube((0, 0, 0.0), (0, 0.05, 0.25), 0.07, 0.11, mat=M("C6_Wrap", 0xf4d8e8), seg=8)
for k in range(9):
    a = k * 2.4
    r = 0.05 + (k % 3) * 0.025
    p.ellipsoid((math.cos(a) * r, 0.05 + math.sin(a) * r, 0.3 + (k % 2) * 0.04), 0.045, 0.045, 0.04, M(f"C6_Flower{k % 4}", (0xe84a7a, 0xf2c230, 0xf4f4f0, 0xb05ad0)[k % 4]), seg=6, rows=3)
p.finish("C6_Flowers")
PACK = M("C6_Pack", 0x2a3a4a)
p = Part()  # リュック（背中。原点は真ん中、上は +Z、背中に付く面は +Y）
p.box(-0.15, 0.15, -0.09, 0.07, -0.2, 0.2, PACK)
p.box(-0.12, 0.12, -0.13, -0.09, -0.15, 0.05, PACK)
p.box(-0.15, 0.15, -0.095, 0.075, 0.12, 0.2, M("C6_PackTop", 0xd8322a))
p.finish("C6_Backpack")
p = Part()  # 花束を差したリュック
p.box(-0.15, 0.15, -0.09, 0.07, -0.2, 0.2, PACK)
p.tube((0.02, -0.02, 0.15), (0.0, -0.06, 0.4), 0.05, 0.08, mat=M("C6_Wrap", 0xf4d8e8), seg=8)
for k in range(7):
    a = k * 2.4
    p.ellipsoid((math.cos(a) * 0.05, -0.06 + math.sin(a) * 0.05, 0.43), 0.04, 0.04, 0.035, M(f"C6_Flower{k % 4}", (0xe84a7a, 0xf2c230, 0xf4f4f0, 0xb05ad0)[k % 4]), seg=6, rows=3)
p.finish("C6_PackFlowers")
SCARF = M("C6_Scarf", 0xd8322a)
p = Part()  # マフラー（首に巻く輪）
p.tube((0, 0, -0.03), (0, 0, 0.05), 0.105, 0.1, mat=SCARF, seg=12, caps=False)
p.tube((0, 0, -0.03), (0, 0, 0.05), 0.095, 0.09, mat=SCARF, seg=12, caps=False)
p.finish("C6_ScarfRing")
p = Part()  # マフラーのたれ（原点は首の後ろ、下へ 0.55m。ゲームで後ろへなびかせる）
for k in range(5):
    z0, z1 = -k * 0.11, -(k + 1) * 0.11
    w0, w1 = 0.06, 0.06
    p.box(-w0, w0, -0.012, 0.012, z1, z0, SCARF)
for k in range(5):
    p.box(-0.06 + k * 0.03, -0.05 + k * 0.03, -0.012, 0.012, -0.62, -0.55, M("C6_Fringe", 0xf2f2f2))
p.finish("C6_ScarfTail")

# ---- 下見（並べて 1 枚の絵にする） ----
for ob in objs:
    ob.hide_render = True
x = 0.0
for k, ob in enumerate([o for o in objs if not o.name.startswith('C6_Fuji')]):
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
gm = bpy.data.meshes.new("C6_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C6_PreviewGroundMat"))
gp = bpy.data.objects.new("C6_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C6_Sun", bpy.data.lights.new("C6_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C6_Camera", bpy.data.cameras.new("C6_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C6_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city6_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
