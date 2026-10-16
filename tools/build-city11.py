# 街の物 その 12：盆踊り（やぐら・提灯・踊る人）・建設中のビルとタワークレーン・駅前ロータリー（乗り場の屋根・真ん中の島）・
# 川沿いの桜並木とぼんぼり・ランニング大会（ランナー・給水所）・選挙カーを、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city11.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C11_Export」。
#   盆踊り     C11_Yagura（やぐら）・C11_BonLanterns（やぐらから下がる提灯の線 1 本）・C11_Dancer0/1（踊る人。ゲームで輪にして回す）
#   建設       C11_Construction（鉄骨と養生シートのビル）・C11_CraneMast（クレーンのマスト）・C11_CraneTop（回る腕。原点は回る軸）
#   駅前       C11_BusShelter（乗り場の屋根とベンチ）・C11_Roundabout（ロータリーの真ん中の島と時計）
#   川沿い     C11_RiverSakura（川へ張り出す大きな桜。+X が川）・C11_Bonbori（夜桜のぼんぼり）
#   大会       C11_Runner0〜3（ランナー）・C11_WaterStation（給水所）
#   選挙       C11_ElectionVan（屋根に看板の選挙カー）・C11_Waver（窓から手を振る人。原点は肩）
# 光る部品の材質の名前は「Light」で始める。下見用は「C11_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city11.blend")
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


export_col = bpy.data.collections.new("C11_Export")
preview_col = bpy.data.collections.new("C11_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C11_Skin", 0xe0b896), M("C11_Hair", 0x231c18), M("C11_Shoe", 0x2b2c31), M("C11_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C11_White", 0xf2f2ee), M("C11_Black", 0x17181b), M("C11_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C11_Wood", 0x8a6440), M("C11_Red", 0xd8322a), M("C11_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C11_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C11_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C11_TextTmp", cu)
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



# ================= 盆踊り（やぐら・提灯の線・踊る人） =================
YAGURA = M("C11_Yagura", 0xa0703a)
RED11, WHITE11 = M("C11_Red", 0xd8322a), M("C11_White", 0xf4f2ec)
p = Part()  # やぐら（4m 四方・高さ 4.5m。紅白の幕、上に太鼓）
for x, y in ((-2, -2), (2, -2), (2, 2), (-2, 2)):
    p.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, 0, 4.5, YAGURA)
p.box(-2.2, 2.2, -2.2, 2.2, 2.6, 2.8, YAGURA)  # 舞台の床
for k in range(16):  # 紅白の幕（四方）
    t0, t1 = k / 16, (k + 1) / 16
    m = RED11 if k % 2 == 0 else WHITE11
    for (ax, ay), (bx, by) in (((-2.2, -2.2), (2.2, -2.2)), ((2.2, -2.2), (2.2, 2.2)), ((2.2, 2.2), (-2.2, 2.2)), ((-2.2, 2.2), (-2.2, -2.2))):
        x0, y0 = ax + (bx - ax) * t0, ay + (by - ay) * t0
        x1, y1 = ax + (bx - ax) * t1, ay + (by - ay) * t1
        nx, ny = (by - ay) / 4.4, -(bx - ax) / 4.4
        p.face([(x0 + nx * 0.02, y0 + ny * 0.02, 0.2), (x1 + nx * 0.02, y1 + ny * 0.02, 0.2), (x1 + nx * 0.02, y1 + ny * 0.02, 2.6), (x0 + nx * 0.02, y0 + ny * 0.02, 2.6)], m)
p.box(-2.3, 2.3, -2.3, 2.3, 2.8, 2.95, YAGURA)  # 手すり
for z in (3.7, 4.5):
    p.box(-2.3, 2.3, -2.3, 2.3, z, z + 0.1, YAGURA)
pts = [(2.7, 4.6), (1.6, 5.4), (0.0, 5.7)]
for (r0, z0), (r1, z1) in zip(pts, pts[1:]):  # 屋根
    for (sx, sy), (tx, ty) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        p.face([(sx * r0, sy * r0, z0), (tx * r0, ty * r0, z0), (tx * r1, ty * r1, z1), (sx * r1, sy * r1, z1)], M("C11_YaguraRoof", 0x3a3e46))
p.tube((0, -0.4, 3.35), (0, 0.4, 3.35), 0.45, mat=M("C11_Drum", 0xc8a06a), seg=12)  # 太鼓
for y in (-0.42, 0.42):
    p.tube((0, y, 3.35), (0, y + (0.01 if y > 0 else -0.01), 3.35), 0.46, mat=WHITE11, seg=12)
p.finish("C11_Yagura")
p = Part()  # 提灯の線 1 本（原点はやぐらの上、X の向きに 12m のびて下がる。8 個）
LAMP11 = M("Light_BonLantern", 0xffd8a0, emit=True)
for k in range(9):
    t = k / 8
    x, z = t * 12, -3.0 * t
    if k < 8:
        t2 = (k + 1) / 8
        p.tube((x, 0, z), (t2 * 12, 0, -3.0 * t2), 0.008, mat=DARK, seg=3)
    if k > 0:
        p.ellipsoid((x, 0, z - 0.28), 0.14, 0.14, 0.2, LAMP11, seg=8, rows=5)
        p.text("祭", 0.1, (x, 0.142, z - 0.28), -X, Z, M("C11_LanternText", 0x8a1a1a), res=2)
p.finish("C11_BonLanterns")


def dancer(name, shirt, arm_up):
    """踊る人（浴衣。片手を上げる形と、両手を前に出す形）"""
    p = Part()
    p.tube((0, 0, 0.05), (0, 0, 0.95), 0.16, 0.13, mat=shirt, seg=8)  # 浴衣のすそ
    p.ellipsoid((0, 0, 1.18), 0.18, 0.12, 0.32, shirt)
    p.box(-0.18, 0.18, -0.12, 0.12, 0.92, 1.02, M("C11_Obi", 0xf2c230))  # 帯
    p.ellipsoid((0, 0.01, 1.6), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((0, -0.01, 1.67), 0.105, 0.115, 0.08, HAIR, rows=3)
    for s in (-1, 1):
        if arm_up and s > 0:
            p.tube((0.21, 0, 1.42), (0.3, 0.05, 1.9), 0.05, mat=shirt)
        else:
            p.tube((s * 0.21, 0, 1.42), (s * 0.32, 0.25, 1.25), 0.05, mat=shirt)
    p.ellipsoid((0, 0.02, 0.04), 0.1, 0.12, 0.04, M("C11_Geta", 0x8a6440), seg=6, rows=3)
    return p.finish(name)


dancer("C11_Dancer0", M("C11_Yukata0", 0x2f5fbf), True)
dancer("C11_Dancer1", M("C11_Yukata1", 0xe84a7a), False)

# ================= 建設中のビル（鉄骨の骨組み 30m・養生シートの下の階・上のクレーンは別） =================
STEEL, SHEET = M("C11_Steel", 0xb8402a), M("C11_Sheet", 0x6a8aa8, rough=0.9)
p = Part()  # 16m 四方・高さ 30m
W2, H = 8, 30
for x in (-W2, -W2 / 3, W2 / 3, W2):
    for y in (-W2, -W2 / 3, W2 / 3, W2):
        p.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, 0, H, STEEL)
for z in range(4, H + 1, 4):
    for y in (-W2, W2):
        p.box(-W2, W2, y - 0.15, y + 0.15, z - 0.3, z, STEEL)
    for x in (-W2, W2):
        p.box(x - 0.15, x + 0.15, -W2, W2, z - 0.3, z, STEEL)
    if z <= 16:  # 下の階は床と養生シート
        p.box(-W2, W2, -W2, W2, z - 0.4, z - 0.3, M("C11_Floor", 0x8a8e94))
for s in (-1, 1):  # 養生シート（下の 16m）
    p.box(-W2 - 0.3, W2 + 0.3, s * (W2 + 0.3) - 0.03, s * (W2 + 0.3) + 0.03, 0, 16, SHEET)
    p.box(s * (W2 + 0.3) - 0.03, s * (W2 + 0.3) + 0.03, -W2 - 0.3, W2 + 0.3, 0, 16, SHEET)
p.box(-W2 - 0.32, W2 + 0.32, W2 + 0.32, W2 + 0.34, 6, 9, WHITE11)  # 工事の看板の帯
p.text("工事中", 1.5, (0, W2 + 0.35, 7.5), -X, Z, M("C11_SignText", 0x1f3a8a))
p.finish("C11_Construction")
p = Part()  # タワークレーン（マストは別にして、上の腕だけ回す。原点は回る軸）
YEL11 = M("C11_CraneYellow", 0xf2c230)
p.box(-0.8, 0.8, -0.8, 0.8, -1.5, 0, YEL11)  # 運転席の台
p.box(0.3, 0.9, 0.5, 1.1, -1.4, -0.4, M("C11_CraneCab", 0x3a4a5a, rough=0.1))
p.box(-0.3, 0.3, -6, 22, 0, 1.2, YEL11)  # 腕（前 22m、後ろ 6m）
for k in range(0, 28, 2):
    p.tube((0, -6 + k, 0), (0, -5 + k, 1.2), 0.04, mat=YEL11, seg=3)
p.box(-0.9, 0.9, -6.5, -4, -1.0, 0.0, M("C11_Weight", 0x5a5e66))  # おもり
p.tube((0, 0, 1.2), (0, 0, 5), 0.2, mat=YEL11, seg=4)
p.tube((0, 0, 5), (0, 20, 1.2), 0.04, mat=METAL, seg=3)
p.tube((0, 0, 5), (0, -6, 1.2), 0.04, mat=METAL, seg=3)
p.tube((0, 16, 0), (0, 16, -14), 0.02, mat=DARK, seg=3)  # 吊るワイヤー
p.box(-1.5, 1.5, 15.2, 16.8, -15.5, -14, M("C11_Load", 0xb8402a))  # 吊った鉄骨
p.finish("C11_CraneTop")
p = Part()  # クレーンのマスト（高さ 34m）
p.box(-0.8, 0.8, -0.8, 0.8, 0, 34, YEL11)
for z in range(0, 34, 2):
    p.box(-0.82, 0.82, -0.82, 0.82, z, z + 0.2, M("C11_Mast", 0xd8a820))
p.finish("C11_CraneMast")

# ================= 駅前ロータリー（バスの乗り場の屋根と、真ん中の島） =================
p = Part()  # 乗り場の屋根（長さ 12m。+Y が車道の側）
for x in (-5, 0, 5):
    p.tube((x, -0.6, 0), (x, -0.6, 3.2), 0.1, mat=METAL, seg=8)
p.box(-6.5, 6.5, -1.6, 1.2, 3.2, 3.35, M("C11_Canopy", 0xe8eaec))
p.box(-6.5, 6.5, 1.15, 1.25, 2.9, 3.35, M("C11_CanopyEdge", 0x2f6fde))
for x in (-3.5, 2.5):  # ベンチ
    p.box(x - 1.0, x + 1.0, -1.2, -0.8, 0.42, 0.47, WOOD)
    p.box(x - 1.0, x + 1.0, -1.25, -1.2, 0.47, 0.85, WOOD)
p.box(5.6, 5.9, -0.2, 0.0, 0, 2.3, METAL)  # 乗り場の番号の柱
p.box(5.3, 6.2, -0.05, 0.05, 1.7, 2.3, M("C11_StopSign", 0x2f6fde))
p.text("1", 0.4, (5.75, 0.055, 2.0), -X, Z, WHITE11)
p.finish("C11_BusShelter")
p = Part()  # ロータリーの真ん中の島（半径 9m。植え込みと時計の柱）
N = 24
for k in range(N):
    a0, a1 = k * math.tau / N, (k + 1) * math.tau / N
    p.face([(0, 0, 0.3), (math.cos(a0) * 9, math.sin(a0) * 9, 0.3), (math.cos(a1) * 9, math.sin(a1) * 9, 0.3)], M("C11_Lawn", 0x4f8a3c))
    p.face([(math.cos(a0) * 9, math.sin(a0) * 9, 0), (math.cos(a1) * 9, math.sin(a1) * 9, 0), (math.cos(a1) * 9, math.sin(a1) * 9, 0.3), (math.cos(a0) * 9, math.sin(a0) * 9, 0.3)][::-1], M("C11_Curb", 0xc8c4bc))
for k in range(10):
    a = k * math.tau / 10
    p.ellipsoid((math.cos(a) * 6.5, math.sin(a) * 6.5, 0.7), 0.9, 0.9, 0.6, M("C11_Shrub", 0x3a7a34), seg=7, rows=4)
p.tube((0, 0, 0.3), (0, 0, 4.2), 0.12, mat=METAL, seg=8)
p.tube((0, -0.1, 4.6), (0, 0.1, 4.6), 0.45, mat=WHITE11, seg=14)
p.tube((0, 0.1, 4.6), (0, 0.12, 4.6), 0.4, mat=M("C11_ClockFace", 0xf4f4f0), seg=14)
p.box(-0.02, 0.02, 0.12, 0.13, 4.6, 4.9, BLACK)
p.box(0.0, 0.25, 0.12, 0.13, 4.58, 4.62, BLACK)
p.finish("C11_Roundabout")

# ================= 川沿いの桜並木（大きな桜 1 本。枝が川へ張り出す。+X が川） =================
SAK, SAK2, TRUNK11 = M("C11_Sakura", 0xf6c4d4), M("C11_Sakura2", 0xeaa4bc), M("C11_Trunk", 0x4a3a30)
p = Part()
p.tube((0, 0, 0), (0.3, 0, 2.6), 0.32, 0.24, mat=TRUNK11, seg=8)
for k, (dx, dy, dz) in enumerate(((3.5, 0.5, 4.2), (2.4, -2.4, 4.0), (1.8, 2.6, 4.3), (-1.4, 0.5, 4.6))):
    p.tube((0.3, 0, 2.4), (dx, dy, dz), 0.14, 0.06, mat=TRUNK11, seg=5)
r = random.Random(31)
for k in range(14):
    c = (r.uniform(-1.5, 5.0), r.uniform(-3.2, 3.2), r.uniform(3.6, 5.6))
    rr = r.uniform(1.2, 2.0)
    p.ellipsoid(c, rr, rr, rr * 0.75, SAK if k % 3 else SAK2, seg=8, rows=5)
for k in range(5):  # 川へ垂れる枝の花
    c = (r.uniform(3.5, 6.0), r.uniform(-2.5, 2.5), r.uniform(2.6, 3.6))
    p.ellipsoid(c, 0.8, 0.8, 0.9, SAK, seg=7, rows=4)
p.finish("C11_RiverSakura")
p = Part()  # 遊歩道のぼんぼり（夜桜の灯り）
p.tube((0, 0, 0), (0, 0, 1.6), 0.05, mat=WOOD, seg=6)
p.box(-0.18, 0.18, -0.18, 0.18, 1.6, 2.1, M("Light_Bonbori", 0xffe8d0, emit=True))
p.cone((0, 0, 2.1), 0.26, 0.15, M("C11_BonboriRoof", 0x3a2a20), seg=4)
p.finish("C11_Bonbori")

# ================= ランニング大会（ランナー 4 人の形・給水所） =================
BIB = M("C11_Bib", 0xf4f4f0)
for n, (shirt, pants) in enumerate(((0x2fb0d0, 0x1e2028), (0xf2c230, 0x1e2028), (0xd84a5a, 0x2a3040), (0x4ab84a, 0x1e2028))):
    p = Part()
    S11, P11 = M(f"C11_RunShirt{n}", shirt), M(f"C11_RunPants{n}", pants)
    ph = n * 0.8
    for s in (-1, 1):
        f = math.sin(ph) * s
        p.tube((s * 0.09, 0, 0.84), (s * 0.09, f * 0.2, 0.45), 0.065, mat=P11)
        p.tube((s * 0.09, f * 0.2, 0.45), (s * 0.09, f * 0.1 - 0.05, 0.08), 0.05, mat=SKIN)
        p.ellipsoid((s * 0.09, f * 0.1 - 0.02, 0.05), 0.05, 0.11, 0.05, M("C11_RunShoe", 0xf2f2f2), seg=6, rows=3)
        p.tube((s * 0.21, 0.05, 1.42), (s * 0.25, -f * 0.25 + 0.05, 1.15), 0.042, mat=S11)
    p.ellipsoid((0, 0.05, 1.17), 0.18, 0.12, 0.32, S11)
    p.box(-0.1, 0.1, 0.165, 0.17, 1.05, 1.25, BIB)  # ゼッケン
    p.box(-0.06, 0.06, 0.171, 0.172, 1.1, 1.2, M("C11_BibNum", 0x1e2028))
    p.ellipsoid((0, 0.1, 1.6), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((0, 0.08, 1.67), 0.11, 0.12, 0.07, HAIR if n % 2 else M(f"C11_RunCap{n}", shirt), rows=3)
    p.finish(f"C11_Runner{n}")
p = Part()  # 給水所（テーブルと紙コップ、ボランティア 2 人。+Y が道の側）
p.box(-1.6, 1.6, -0.4, 0.4, 0.72, 0.78, WHITE11)
for x in (-1.5, 1.5):
    p.box(x - 0.04, x + 0.04, -0.35, 0.35, 0, 0.72, METAL)
for k in range(14):
    x = -1.4 + k * 0.2
    p.tube((x, 0.15, 0.78), (x, 0.15, 0.9), 0.035, 0.04, mat=WHITE11, seg=6)
for x in (-0.7, 0.7):
    person(p, x, -0.8, M("C11_Volunteer", 0xf28a2a))
p.box(-1.2, 1.2, -0.42, -0.4, 0.3, 0.7, M("C11_WaterSign", 0x2f6fde))
p.text("給水", 0.25, (0, -0.425, 0.5), X, Z, WHITE11)  # 看板は -Y の面（ボランティアの側）
p.finish("C11_WaterStation")

# ================= 選挙カー（白いワゴンの上に看板と、手を振る人） =================
p = Part()
VAN11 = M("C11_ElectionVan", 0xf4f4f0, rough=0.4)
p.box(-0.85, 0.85, -2.4, 2.4, 0.35, 1.9, VAN11)
p.box(-0.82, 0.82, 1.7, 2.41, 1.1, 1.8, M("C11_Glass", 0x2a3a4a, rough=0.1))
for s in (-1, 1):
    p.box(s * 0.85 - 0.005, s * 0.85 + 0.005, -1.8, 1.5, 1.1, 1.75, M("C11_Glass", 0x2a3a4a, rough=0.1))
for x in (-0.75, 0.75):
    for y in (-1.6, 1.6):
        p.tube((x - 0.09, y, 0.32), (x + 0.09, y, 0.32), 0.32, mat=M("C11_Tire", 0x141416), seg=10)
p.box(-0.08, 0.08, -1.8, 1.8, 1.9, 2.0, METAL)  # 屋根の看板の台
p.box(-0.05, 0.05, -2.2, 2.2, 2.0, 2.9, WHITE11)
for s in (-1, 1):
    p.box(s * 0.055 - 0.002, s * 0.055 + 0.002, -2.15, 2.15, 2.05, 2.85, WHITE11)
    p.text("やまて たろう", 0.42, (s * 0.06, 0.1, 2.5), Y * s, Z, M("C11_ElectionName", 0xc8202a))  # +X の面は +Y へ読む（-X の面は逆）
    p.box(s * 0.06 - 0.003, s * 0.06 + 0.003, -2.15, 2.15, 2.05, 2.15, M("C11_ElectionStripe", 0x2f6fde))
for k in range(2):  # 屋根のスピーカー
    p.tube((0, 1.9 + k * 0.1, 2.0), (0, 2.35, 2.25), 0.15, 0.25, mat=WHITE11, seg=8)
p.finish("C11_ElectionVan")
p = Part()  # 窓から手を振る人（車の右側の後ろの窓。原点は肩）
p.ellipsoid((0, 0, 0.15), 0.1, 0.11, 0.12, SKIN)
p.ellipsoid((0, -0.01, 0.22), 0.105, 0.115, 0.08, HAIR, rows=3)
p.box(-0.12, 0.12, -0.08, 0.08, -0.25, 0.05, M("C11_Suit", 0x24345a))
p.box(-0.13, 0.13, -0.085, 0.085, -0.05, 0.02, WHITE11)  # たすき
p.tube((0.12, 0, -0.02), (0.35, 0.05, 0.35), 0.04, mat=M("C11_Suit", 0x24345a), seg=6)
p.ellipsoid((0.37, 0.05, 0.4), 0.05, 0.03, 0.06, M("C11_Glove", 0xf4f4f4), seg=6, rows=3)
p.finish("C11_Waver")


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
gm = bpy.data.meshes.new("C11_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C11_PreviewGroundMat"))
gp = bpy.data.objects.new("C11_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C11_Sun", bpy.data.lights.new("C11_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C11_Camera", bpy.data.cameras.new("C11_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C11_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city11_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
