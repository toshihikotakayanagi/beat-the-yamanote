# 街の物 その 9：学校・ガソリンスタンド・コインパーキング・銭湯・噴水・シェアサイクルのポート・撮り鉄・航空障害灯・掲示板を、
# ゲーム向けに軽く Blender で組み立てる（置く場所は OpenStreetMap の施設の位置。tools/fetch-osm.mjs の facilities）
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city8.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C8_Export」。
#   学校       C8_SchoolGate（校門）・C8_Tetsubo（鉄棒）・C8_JungleGym・C8_SoccerGoal・C8_Pupils（ランドセルの子ども 3 人。歩く）
#   GS         C8_GasStation（屋根・給油機・値段の看板・店員さん）
#   駐車場     C8_ParkSign（P の看板と精算機）・C8_ParkStall（1 台分の区画。幅 2.5m・奥行き 5m）
#   銭湯       C8_Chimney（煙突）・C8_SentoFront（壁に付ける入口）・C8_Bather（湯おけを持つ人。歩く）
#   噴水       C8_Fountain（池）・C8_FountainWater（水。高さはゲームで上下させる）
#   自転車     C8_CyclePort（シェアサイクルのポート。赤い自転車 5 台）
#   撮り鉄     C8_RailfanUp・C8_RailfanDown（カメラを構えた形・下ろした形）・C8_Tripod
#   ビル       C8_ObstLight（航空障害灯。赤い灯は光る）
#   掲示板     C8_ElectionBoard（選挙のポスター掲示板）・C8_NoticeBoard（町内会の掲示板）
# 光る部品の材質の名前は「Light」で始める。下見用は「C8_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city8.blend")
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


export_col = bpy.data.collections.new("C8_Export")
preview_col = bpy.data.collections.new("C8_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C8_Skin", 0xe0b896), M("C8_Hair", 0x231c18), M("C8_Shoe", 0x2b2c31), M("C8_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C8_White", 0xf2f2ee), M("C8_Black", 0x17181b), M("C8_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C8_Wood", 0x8a6440), M("C8_Red", 0xd8322a), M("C8_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C8_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C8_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C8_TextTmp", cu)
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



# ================= 学校（校門・鉄棒・ジャングルジム・サッカーゴール・下校する子ども） =================
GATEC, PLATE = M("C8_GateConcrete", 0xc8c4bc, rough=0.9), M("C8_Plate", 0xb08a3a, metal=0.5)
p = Part()  # 校門（門柱の間 5m。+Y が道の側）
for x in (-2.8, 2.8):
    p.box(x - 0.3, x + 0.3, -0.3, 0.3, 0, 1.9, GATEC)
    p.box(x - 0.34, x + 0.34, -0.34, 0.34, 1.9, 2.0, GATEC)
p.box(-2.55, -2.45, 0.31, 0.33, 1.0, 1.6, PLATE)  # 学校の名前の板（字は省く）
for k in range(11):  # 開いた門扉（左側に寄せてたたむ）
    x = -2.4 + k * 0.12
    p.tube((x, -0.1, 0.05), (x, -0.1, 1.45), 0.012, mat=METAL, seg=4)
p.box(-2.45, -1.15, -0.12, -0.08, 1.4, 1.48, METAL)
p.box(-2.45, -1.15, -0.12, -0.08, 0.05, 0.12, METAL)
for x in (-3.1, 3.1):  # 両側のフェンスの端
    p.box(x - 0.03 if x < 0 else x, x if x < 0 else x + 0.03, -0.03, 0.03, 0, 1.8, METAL)
p.finish("C8_SchoolGate")
BARS = [M(f"C8_Bar{k}", h) for k, h in enumerate((0xd8322a, 0x2f6fde, 0xf2c230, 0x3a9a4a))]
p = Part()  # 鉄棒（高さの違う 3 つ。幅 4.5m）
xs = [-2.2, -0.7, 0.8, 2.3]
for k, x in enumerate(xs):
    p.tube((x, 0, 0), (x, 0, 1.0 + 0.25 * min(k, 3)), 0.05, mat=BARS[k % 4], seg=8)
for k in range(3):
    h = 0.95 + 0.25 * k
    p.tube((xs[k], 0, h), (xs[k + 1], 0, h), 0.018, mat=METAL, seg=6)
p.finish("C8_Tetsubo")
p = Part()  # ジャングルジム（3 × 3 × 3 マス。1 マス 0.6m）
for i in range(4):
    for j in range(4):
        p.tube((-0.9 + i * 0.6, -0.9 + j * 0.6, 0), (-0.9 + i * 0.6, -0.9 + j * 0.6, 1.8), 0.025, mat=BARS[(i + j) % 4], seg=5)
        for k in range(1, 4):
            z = k * 0.6
            if i < 3:
                p.tube((-0.9 + i * 0.6, -0.9 + j * 0.6, z), (-0.9 + (i + 1) * 0.6, -0.9 + j * 0.6, z), 0.02, mat=BARS[k % 4], seg=4)
            if j < 3:
                p.tube((-0.9 + i * 0.6, -0.9 + j * 0.6, z), (-0.9 + i * 0.6, -0.9 + (j + 1) * 0.6, z), 0.02, mat=BARS[k % 4], seg=4)
p.finish("C8_JungleGym")
p = Part()  # サッカーゴール（幅 5m・高さ 2.1m。+Y が前）
for x in (-2.5, 2.5):
    p.tube((x, 0, 0), (x, 0, 2.1), 0.05, mat=WHITE, seg=6)
    p.tube((x, 0, 2.1), (x, -1.5, 0), 0.03, mat=WHITE, seg=5)
p.tube((-2.5, 0, 2.1), (2.5, 0, 2.1), 0.05, mat=WHITE, seg=6)
p.tube((-2.5, -1.5, 0), (2.5, -1.5, 0), 0.03, mat=WHITE, seg=5)
NET = M("C8_Net", 0xd8dce2)
for k in range(11):  # 網（縦の糸）
    x = -2.5 + k * 0.5
    p.tube((x, 0, 2.1), (x, -1.5, 0), 0.006, mat=NET, seg=3)
for k in range(1, 5):
    t = k / 5
    p.tube((-2.5, -1.5 * t, 2.1 * (1 - t)), (2.5, -1.5 * t, 2.1 * (1 - t)), 0.006, mat=NET, seg=3)
p.finish("C8_SoccerGoal")


def pupil(p, x, y, shirt, bag, cap=None):
    """ランドセルを背負って歩く子ども（+Y を向く）"""
    for s, f in ((-1, 1), (1, -1)):
        p.tube((x + s * 0.06, y, 0.55), (x + s * 0.06, y + f * 0.1, 0.05), 0.045, 0.035, mat=PANTS)
        p.ellipsoid((x + s * 0.06, y + f * 0.1 + 0.03, 0.03), 0.04, 0.08, 0.03, SHOE, seg=6, rows=3)
    p.ellipsoid((x, y, 0.75), 0.12, 0.09, 0.22, shirt)
    p.ellipsoid((x, y + 0.01, 1.06), 0.09, 0.09, 0.1, SKIN)
    p.ellipsoid((x, y, 1.11), 0.095, 0.095, 0.07, HAIR, rows=3)
    if cap:
        p.ellipsoid((x, y, 1.13), 0.1, 0.1, 0.06, cap, rows=3)
    p.box(x - 0.13, x + 0.13, y - 0.24, y - 0.08, 0.62, 0.95, bag)  # ランドセル
    p.box(x - 0.13, x + 0.13, y - 0.25, y - 0.15, 0.82, 0.97, bag)
    for s in (-1, 1):
        p.tube((x + s * 0.13, y, 0.92), (x + s * 0.15, y + 0.04, 0.62), 0.03, mat=shirt)


p = Part()  # 下校する子ども 3 人
pupil(p, -0.45, 0.2, M("C8_KidShirtA", 0x6aa8e0), M("C8_Randoseru0", 0xc8202a), M("C8_SchoolCap", 0xf2d020))
pupil(p, 0.0, -0.1, M("C8_KidShirtB", 0xf2f2f2), M("C8_Randoseru1", 0x1e1e22), M("C8_SchoolCap", 0xf2d020))
pupil(p, 0.45, 0.25, M("C8_KidShirtC", 0xe88ab0), M("C8_Randoseru2", 0x8a5aa8), M("C8_SchoolCap", 0xf2d020))
p.finish("C8_Pupils")

# ================= ガソリンスタンド（屋根 14m × 10m。+Y が道の側） =================
GSR, GSW = M("C8_GsRed", 0xd8322a, rough=0.4), M("C8_GsWhite", 0xf4f4f0, rough=0.4)
p = Part()
for x in (-5.5, 5.5):
    for y in (-3, 3):
        p.box(x - 0.25, x + 0.25, y - 0.25, y + 0.25, 0, 5.4, GSW)
p.box(-7, 7, -5, 5, 5.4, 6.2, GSW)  # 屋根
p.box(-7.02, 7.02, -5.02, 5.02, 5.6, 6.0, GSR)  # 屋根の縁の赤い帯
p.box(-6.9, 6.9, -4.9, 4.9, 5.38, 5.4, M("Light_GsCeiling", 0xf8f4e8, emit=True))  # 屋根の下の明かり
for x in (-3, 3):  # 給油の島と給油機
    p.box(x - 0.5, x + 0.5, -2.5, 2.5, 0, 0.2, GATEC)
    for y in (-1.2, 1.2):
        p.box(x - 0.3, x + 0.3, y - 0.4, y + 0.4, 0.2, 1.9, GSW)
        p.box(x - 0.31, x + 0.31, y - 0.25, y + 0.25, 1.3, 1.7, M("Light_PumpScreen", 0x5ad0ff, emit=True))
        for s in (-1, 1):
            p.tube((x + s * 0.3, y, 1.1), (x + s * 0.5, y, 0.9), 0.025, mat=BLACK, seg=4)
p.tube((6.5, 4.6, 0), (6.5, 4.6, 7.5), 0.18, mat=METAL, seg=8)  # 値段の看板
p.box(5.6, 7.4, 4.5, 4.7, 5.2, 7.6, GSR)
p.box(5.7, 7.3, 4.71, 4.72, 5.3, 7.0, M("Light_PriceBoard", 0x1e2028, emit=True))
for k, (lab, col) in enumerate((("レギュラー", 0xff4040), ("ハイオク", 0xf2c230), ("軽油", 0x40c040))):
    z = 6.7 - k * 0.6
    p.text(lab, 0.16, (6.1, 4.73, z), -X, Z, M(f"Light_Fuel{k}", col, emit=True))
    p.text(str(168 + k * 11), 0.26, (6.95, 4.73, z), -X, Z, M("Light_PriceNum", 0xffe080, emit=True))
p.text("GAS", 0.5, (6.5, 4.72, 7.3), -X, Z, WHITE)
p.text("GAS", 0.5, (6.5, 4.48, 7.3), X, Z, WHITE)
# 店員さん（給油機の横で車を案内する）
person(p, -1.8, 1.8, M("C8_GsUniform", 0xd8322a), pants=M("C8_GsPants", 0x2a3040), arms=False)
p.ellipsoid((-1.8, 1.8, 1.69), 0.12, 0.13, 0.06, GSW, rows=3)
p.tube((-2.01, 1.8, 1.42), (-2.3, 2.0, 1.55), 0.045, mat=M("C8_GsUniform", 0xd8322a))
p.tube((-1.59, 1.8, 1.42), (-1.55, 1.85, 1.0), 0.045, mat=M("C8_GsUniform", 0xd8322a))
p.finish("C8_GasStation")

# ================= コインパーキング =================
PB = M("C8_ParkBlue", 0x1f4aa8)
p = Part()  # 「P」の看板（高さ 3.4m。+Y が前。両面）
p.tube((0, 0, 0), (0, 0, 3.4), 0.06, mat=METAL, seg=6)
p.box(-0.55, 0.55, -0.06, 0.06, 2.3, 3.4, PB)
for y, rt in ((0.065, -X), (-0.065, X)):
    p.text("P", 0.85, (0, y, 2.95), rt, Z, WHITE)
    p.text("24H", 0.18, (0, y, 2.45), rt, Z, M("C8_ParkYellow", 0xf2d020))
p.box(-0.3, 0.3, 0.25, 0.65, 0, 1.4, M("C8_PayMachine", 0xd8dce2))  # 精算機
p.box(-0.22, 0.22, 0.65, 0.66, 0.85, 1.2, M("Light_PayScreen", 0x5ad0a0, emit=True))
p.finish("C8_ParkSign")
p = Part()  # 1 台分の区画（幅 2.5m・奥行き 5m。+Y が道の側）。白線・車止め・ロック板
for x in (-1.25, 1.25):
    p.box(x - 0.06, x + 0.06, -2.5, 2.5, 0.0, 0.012, WHITE)
p.box(-0.7, 0.7, -2.3, -2.1, 0, 0.12, M("C8_WheelStop", 0xf2d020))
p.box(-0.25, 0.25, -0.8, 0.0, 0, 0.08, M("C8_FlapLock", 0x606468))
p.finish("C8_ParkStall")

# ================= 銭湯（煙突・のれんの入口・湯おけを持つ人） =================
CHIM = M("C8_Chimney", 0x8a8680, rough=0.9)
p = Part()  # 煙突（高さ 24m。上に「ゆ」）
p.tube((0, 0, 0), (0, 0, 24), 0.9, 0.6, mat=CHIM, seg=12)
p.tube((0, 0, 23.5), (0, 0, 24.2), 0.66, 0.66, mat=DARK, seg=12)
for k in range(5):  # はしごの横棒
    p.box(0.62, 0.72, -0.25, 0.25, 4 + k * 4, 4.08 + k * 4, METAL)
for a in (0, math.pi):
    c = Vector((math.cos(a) * 0.85, math.sin(a) * 0.85, 19))
    p.box(c.x - 0.02, c.x + 0.02, -0.7, 0.7, 18.2, 19.8, WHITE)
p.text("ゆ", 1.1, (0.88, 0, 19), Y, Z, M("C8_YuRed", 0xc8202a))
p.text("ゆ", 1.1, (-0.88, 0, 19), -Y, Z, M("C8_YuRed", 0xc8202a))
p.finish("C8_Chimney")
p = Part()  # 入口（壁に付ける。+Y が外。幅 4m）
p.box(-2.0, 2.0, -0.05, 0.12, 0, 3.4, M("C8_SentoWood", 0x7a5a3a))
p.box(-1.0, 1.0, 0.12, 0.14, 0, 2.3, M("Light_SentoDoor", 0xfff0d0, emit=True))
p.box(-2.2, 2.2, 0.0, 0.9, 3.0, 3.15, M("C8_SentoRoof", 0x3a3e46))  # ひさし
for k, (x0, col) in enumerate(((-1.0, 0x1f3a8a), (0.0, 0xc8202a))):  # 男湯（紺）と女湯（赤）ののれん
    p.box(x0 + 0.03, x0 + 0.97, 0.2, 0.22, 1.6, 2.3, M(f"C8_Noren{k}", col))
    p.text("ゆ", 0.5, (x0 + 0.5, 0.225, 1.95), -X, Z, WHITE)
p.box(-0.9, 0.9, 0.12, 0.16, 2.45, 2.95, M("C8_SentoSign", 0xf2ead8))
p.text("銭湯", 0.34, (0, 0.165, 2.7), -X, Z, M("C8_SentoText", 0x3a2a1a))
p.finish("C8_SentoFront")
p = Part()  # 湯おけを持って歩く人（タオルを首に）
person(p, 0, 0, M("C8_Yukata", 0x3a5a8a), arms=False)
p.tube((-0.21, 0, 1.42), (-0.25, 0.05, 1.0), 0.045, mat=M("C8_Yukata", 0x3a5a8a))
p.tube((0.21, 0, 1.42), (0.28, 0.12, 1.02), 0.045, mat=M("C8_Yukata", 0x3a5a8a))
p.tube((0.3, 0.2, 0.92), (0.3, 0.2, 1.08), 0.13, 0.15, mat=M("C8_Oke", 0xe8e0c8), seg=10)  # 黄色い湯おけの代わりに白い
p.tube((-0.12, 0.05, 1.5), (0.12, 0.05, 1.5), 0.13, mat=WHITE, seg=8, caps=False)  # 首のタオル
p.finish("C8_Bather")

# ================= 噴水（池の半径 4m。水は別：ゲームで上下させる） =================
p = Part()
STONE8 = M("C8_FountainStone", 0xc8c4bc, rough=0.9)
N = 24
for k in range(N):
    a0, a1 = k * math.tau / N, (k + 1) * math.tau / N
    for r0, r1, z in ((4.0, 4.4, 0.55),):
        q = [(math.cos(a0) * r0, math.sin(a0) * r0, z), (math.cos(a1) * r0, math.sin(a1) * r0, z), (math.cos(a1) * r1, math.sin(a1) * r1, z), (math.cos(a0) * r1, math.sin(a0) * r1, z)]
        p.face(q, STONE8)
    for r in (4.0, 4.4):
        q = [(math.cos(a0) * r, math.sin(a0) * r, 0), (math.cos(a1) * r, math.sin(a1) * r, 0), (math.cos(a1) * r, math.sin(a1) * r, 0.55), (math.cos(a0) * r, math.sin(a0) * r, 0.55)]
        p.face(q if r > 4.2 else q[::-1], STONE8)
p.face([(math.cos(k * math.tau / N) * 4.0, math.sin(k * math.tau / N) * 4.0, 0.4) for k in range(N)], M("C8_Pool", 0x5a9ac8, rough=0.05, metal=0.3))
p.tube((0, 0, 0.4), (0, 0, 1.2), 0.5, 0.35, mat=STONE8, seg=12)
p.tube((0, 0, 1.2), (0, 0, 1.35), 1.3, 1.2, mat=STONE8, seg=16)
p.finish("C8_Fountain")
p = Part()  # 噴き上がる水（高さ 1 ＝ ゲームで伸ばす。真ん中の柱と、まわりへ落ちる 8 本の弧）
WATER = M("C8_Water", 0xd8f0ff, rough=0.1)
p.tube((0, 0, 1.3), (0, 0, 1.3 + 2.5), 0.18, 0.05, mat=WATER, seg=8)
for k in range(8):
    a = k * math.tau / 8
    pts = [Vector((math.cos(a) * 1.0 * t, math.sin(a) * 1.0 * t, 1.35 + 1.6 * t * (1.6 - t))) for t in (0, 0.4, 0.8, 1.2, 1.6, 2.0)]
    for u, v in zip(pts, pts[1:]):
        if v.z < 0.4:
            break
        p.tube(u, v, 0.06, mat=WATER, seg=5)
p.finish("C8_FountainWater")

# ================= シェアサイクルのポート（赤い自転車 5 台と案内。X の向きに並ぶ。+Y が道の側） =================
SC = M("C8_ShareRed", 0xd8202a, rough=0.4)
p = Part()
p.box(-3.4, 3.4, -0.9, -0.85, 0, 0.05, METAL)
for k in range(5):
    x = -2.6 + k * 1.3
    for y in (-0.55, 0.55):
        p.tube((x - 0.03, y, 0.3), (x + 0.03, y, 0.3), 0.3, mat=BLACK, seg=10)
    p.tube((x, -0.55, 0.3), (x, 0.0, 0.3), 0.025, mat=SC, seg=5)
    p.tube((x, 0.0, 0.3), (x, -0.25, 0.78), 0.03, mat=SC, seg=5)
    p.tube((x, 0.0, 0.3), (x, 0.45, 0.85), 0.03, mat=SC, seg=5)
    p.tube((x, 0.45, 0.85), (x, 0.55, 0.3), 0.02, mat=SC, seg=5)
    p.box(x - 0.08, x + 0.08, -0.33, -0.17, 0.8, 0.86, BLACK)  # サドル
    p.tube((x - 0.25, 0.42, 0.98), (x + 0.25, 0.42, 0.98), 0.015, mat=METAL, seg=4)
    p.box(x - 0.15, x + 0.15, 0.48, 0.72, 0.7, 0.88, METAL)  # 前かご
    p.box(x - 0.08, x + 0.08, -0.75, -0.6, 0.3, 0.55, M("C8_DockLock", 0x404448))
p.tube((3.9, 0, 0), (3.9, 0, 2.2), 0.05, mat=METAL, seg=6)
p.box(3.4, 4.4, -0.05, 0.05, 1.4, 2.2, SC)
for y, rt in ((0.055, -X), (-0.055, X)):
    p.text("シェア", 0.2, (3.9, y, 1.95), rt, Z, WHITE)
    p.text("サイクル", 0.2, (3.9, y, 1.65), rt, Z, WHITE)
p.finish("C8_CyclePort")

# ================= 撮り鉄（カメラを構えた形と、下ろした形。+Y が前＝線路の方） =================
for name, up in (("C8_RailfanUp", True), ("C8_RailfanDown", False)):
    p = Part()
    JK = M("C8_RailfanJacket", 0x5a6a3a)
    person(p, 0, 0, JK, arms=False)
    p.ellipsoid((0, 0, 1.68), 0.12, 0.13, 0.06, M("C8_RailfanCap", 0x2a2d33), rows=3)
    p.box(-0.08, 0.08, 0.08, 0.2, 1.65, 1.68, M("C8_RailfanCap", 0x2a2d33))
    p.box(-0.15, 0.15, -0.25, -0.12, 0.95, 1.4, M("C8_RailfanBag", 0x2a2d33))  # リュック
    cam_at = Vector((0, 0.2, 1.6)) if up else Vector((0.08, 0.15, 1.05))
    for s in (-1, 1):
        p.tube((s * 0.21, 0, 1.42), cam_at + Vector((s * 0.09, -0.04, 0)), 0.045, mat=JK)
    p.box(cam_at.x - 0.08, cam_at.x + 0.08, cam_at.y - 0.05, cam_at.y + 0.05, cam_at.z - 0.06, cam_at.z + 0.06, BLACK)
    lens = cam_at + Vector((0, 0.05, 0))
    p.tube(lens, lens + Vector((0, 0.22, 0)), 0.045, 0.05, mat=BLACK, seg=8)
    p.finish(name)
p = Part()  # 三脚（撮り鉄の横）
for k in range(3):
    a = k * math.tau / 3
    p.tube((0, 0, 1.2), (math.cos(a) * 0.35, math.sin(a) * 0.35, 0), 0.015, mat=BLACK, seg=4)
p.box(-0.06, 0.06, -0.06, 0.06, 1.2, 1.3, BLACK)
p.finish("C8_Tripod")

# ================= 航空障害灯（ビルの屋上の角。赤い灯は光る） =================
p = Part()
p.tube((0, 0, 0), (0, 0, 0.8), 0.05, mat=METAL, seg=6)
p.ellipsoid((0, 0, 0.9), 0.16, 0.16, 0.16, M("Light_Obstruction", 0xff2020, emit=True), seg=8, rows=5)
p.finish("C8_ObstLight")

# ================= 掲示板（+Y が前） =================
p = Part()  # 選挙のポスター掲示板（4 段 × 6 列、番号つき）
p.box(-1.8, 1.8, -0.05, 0.05, 0.6, 2.4, M("C8_BoardPanel", 0xd8d8d0))
for x in (-1.75, 1.75):
    p.box(x - 0.05, x + 0.05, -0.08, 0.0, 0, 2.45, M("C8_BoardLeg", 0x3a3e46))
POST = [M(f"C8_Poster{k}", h) for k, h in enumerate((0x2f6fde, 0xd8322a, 0xf2c230, 0x3a9a4a, 0xf4f4f0, 0xe88ab0, 0x8a5aa8))]
for r in range(4):
    for c in range(6):
        x0, z0 = -1.75 + c * 0.583, 2.35 - (r + 1) * 0.43
        p.box(x0 + 0.03, x0 + 0.55, 0.05, 0.06, z0 + 0.03, z0 + 0.4, WHITE)
        if (r * 6 + c) % 3 != 2:  # ポスターが貼ってある所と、まだの所
            p.box(x0 + 0.06, x0 + 0.52, 0.06, 0.07, z0 + 0.05, z0 + 0.36, POST[(r * 6 + c * 5) % len(POST)])
            p.ellipsoid((x0 + 0.29, 0.075, z0 + 0.25), 0.07, 0.01, 0.08, SKIN, seg=6, rows=3)  # 顔写真
p.finish("C8_ElectionBoard")
p = Part()  # 町内会の掲示板（小さな屋根とガラスの戸、貼り紙）
p.box(-0.9, 0.9, -0.08, 0.08, 1.0, 2.1, M("C8_NoticeFrame", 0x6a4a30))
for x in (-0.85, 0.85):
    p.box(x - 0.05, x + 0.05, -0.05, 0.05, 0, 1.0, M("C8_NoticeFrame", 0x6a4a30))
p.face([(-1.0, -0.25, 2.1), (1.0, -0.25, 2.1), (1.0, 0.3, 2.3), (-1.0, 0.3, 2.3)][::-1], M("C8_NoticeRoof", 0x3a5a3a))
p.face([(-1.0, -0.25, 2.1), (1.0, -0.25, 2.1), (1.0, 0.3, 2.3), (-1.0, 0.3, 2.3)], M("C8_NoticeRoof", 0x3a5a3a))
for k, (x0, z0, w, h) in enumerate(((-0.8, 1.55, 0.45, 0.45), (-0.3, 1.6, 0.4, 0.4), (0.15, 1.5, 0.6, 0.48), (-0.75, 1.1, 0.5, 0.38), (-0.15, 1.12, 0.35, 0.35), (0.3, 1.08, 0.45, 0.35))):
    p.box(x0, x0 + w, 0.08, 0.09, z0, z0 + h, POST[(k * 3) % len(POST)] if k % 2 else WHITE)
p.text("町内会", 0.12, (0, 0.09, 2.0), -X, Z, M("C8_NoticeText", 0xf2ead8))
p.finish("C8_NoticeBoard")

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
gm = bpy.data.meshes.new("C8_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C8_PreviewGroundMat"))
gp = bpy.data.objects.new("C8_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C8_Sun", bpy.data.lights.new("C8_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C8_Camera", bpy.data.cameras.new("C8_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C8_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city8_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
