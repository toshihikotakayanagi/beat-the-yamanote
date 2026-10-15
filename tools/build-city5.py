# 街の物 その 6：動物・季節の飾り・縁日・移動販売の車・川を進む船・雨と雪の日の物・電車の開いたドア・表彰台・
# タイトル画面のミニチュアの部品を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city5.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z。動く物は +Y へ進む）。原点はどれも物の根元（地面・水面・電線）。書き出すものは「C5_Export」。
#   動物       C5_Crow（電線にとまるカラス。原点は足）・C5_CrowFlyA/B（羽を上げた・下げた形。原点は体の真ん中）・
#              C5_Pigeon（地面のハト）・C5_PigeonFlyA/B・C5_Cat0〜2（座るネコ：茶トラ・黒・三毛）・
#              C5_DogWalk0/1（犬の散歩：飼い主と柴犬／白い小型犬）
#   季節       C5_Tanabata（七夕の笹飾り）・C5_FurinRack（風鈴の棚）・C5_XmasTree（クリスマスツリー）・
#              C5_TreeLights（丸い木に付けるイルミネーション。tools/build-trees.py の TREE_Round の葉の形に合わせる）・C5_Petal（桜の花びら）
#   縁日       C5_Yatai0〜2（たこ焼き・金魚すくい・わたあめの屋台）・C5_Lanterns（ちょうちんの列。X の向きに 8m）・C5_Mikoshi（おみこしと担ぐ人）
#   移動販売   C5_Yakiimo（石焼いもの軽トラ）・C5_FoodTruck（キッチンカー。+X の側の窓が開く）・C5_Chirigami（古紙回収の軽トラ）
#   川の船     C5_Cruise（観光船）・C5_Canoe（カヌーと漕ぐ 2 人）
#   雨と雪     C5_Puddle（水たまり）・C5_Snowman（雪だるま）・C5_SnowPile（道の端に寄せた雪）
#   電車       C5_DoorOpen（開いたドア。+X の側面、ドアの真ん中が原点。高さはレールの上から。src/render3d.js の車両と同じ寸法）
#   表彰台     C5_Podium（1・2・3 の台。字は +Y の面。前から見て左が 2 位（+X）、右が 3 位（-X））・C5_Champion（両手を上げて立つ自転車の人。材質は自転車の人と同じ名前で、
#              ゲームで服とヘルメットの色にする）・C5_Medal（首のメダル。円の材質 C5_Medal はゲームで金・銀・銅の色にする）
#   ミニチュア C5_MiniBldg0〜3（小さなビル）・C5_MiniTree・C5_MiniTower（東京タワー）・C5_MiniSkytree・C5_MiniStation（駅のホーム）
# 光る部品の材質の名前は「Light」で始める。下見用は「C5_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city5.blend")
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


export_col = bpy.data.collections.new("C5_Export")
preview_col = bpy.data.collections.new("C5_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C5_Skin", 0xe0b896), M("C5_Hair", 0x231c18), M("C5_Shoe", 0x2b2c31), M("C5_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C5_White", 0xf2f2ee), M("C5_Black", 0x17181b), M("C5_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C5_Wood", 0x8a6440), M("C5_Red", 0xd8322a), M("C5_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C5_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C5_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C5_TextTmp", cu)
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


# ================= 動物 =================
CROW, CROW2 = M("C5_Crow", 0x141418, rough=0.35), M("C5_CrowBeak", 0x24242a)
p = Part()  # 電線にとまるカラス（原点は足、+Y が頭）
p.ellipsoid((0, 0.0, 0.15), 0.075, 0.16, 0.09, CROW, seg=8, rows=5)
p.ellipsoid((0, 0.14, 0.25), 0.06, 0.07, 0.06, CROW)
p.tube((0, 0.18, 0.25), (0, 0.27, 0.235), 0.025, 0.004, mat=CROW2, seg=5)
p.face([(-0.05, -0.12, 0.17), (0.05, -0.12, 0.17), (0.04, -0.3, 0.1), (-0.04, -0.3, 0.1)], CROW)  # 尾
for s in (-1, 1):
    p.tube((s * 0.03, 0.0, 0.08), (s * 0.03, 0.02, 0.0), 0.008, mat=CROW2, seg=4)
p.finish("C5_Crow")


def flying(name, body, wing, beak, L, wing_up):
    """飛んでいる鳥（原点は体の真ん中。wing_up は羽の上がる角度 rad）"""
    p = Part()
    p.ellipsoid((0, 0, 0), L * 0.22, L * 0.5, L * 0.22, body, seg=8, rows=5)
    p.ellipsoid((0, L * 0.45, L * 0.06), L * 0.17, L * 0.2, L * 0.17, body)
    p.tube((0, L * 0.6, L * 0.06), (0, L * 0.78, L * 0.03), L * 0.06, 0.003, mat=beak, seg=5)
    p.face([(-L * 0.12, -L * 0.4, 0), (L * 0.12, -L * 0.4, 0), (L * 0.16, -L * 0.85, 0), (-L * 0.16, -L * 0.85, 0)], body)
    for s in (-1, 1):
        a = Vector((s * L * 0.15, L * 0.15, 0))
        b = Vector((s * L * 0.15, -L * 0.25, 0))
        tipz = math.sin(wing_up) * L * 1.1
        tipx = s * (L * 0.15 + math.cos(wing_up) * L * 1.1)
        c = Vector((tipx, -L * 0.3, tipz))
        d = Vector((tipx * 0.6, L * 0.1, tipz * 0.6))
        p.face([a, d, c, b], wing)
    return p.finish(name)


flying("C5_CrowFlyA", CROW, CROW, CROW2, 0.5, 0.7)
flying("C5_CrowFlyB", CROW, CROW, CROW2, 0.5, -0.35)
PIG, PIGW, PIGN, PIGF = M("C5_Pigeon", 0x8a909c), M("C5_PigeonWing", 0x6c7280), M("C5_PigeonNeck", 0x4f7a6a), M("C5_PigeonFoot", 0xd07a7a)
p = Part()  # 地面のハト（原点は足もと）
p.ellipsoid((0, 0, 0.12), 0.07, 0.13, 0.075, PIG, seg=8, rows=5)
for s in (-1, 1):
    p.ellipsoid((s * 0.05, -0.02, 0.135), 0.03, 0.1, 0.05, PIGW, seg=6, rows=4)
p.ellipsoid((0, 0.09, 0.19), 0.045, 0.05, 0.06, PIGN)
p.ellipsoid((0, 0.12, 0.24), 0.04, 0.045, 0.04, PIG)
p.tube((0, 0.155, 0.235), (0, 0.19, 0.228), 0.012, 0.003, mat=DARK, seg=4)
p.face([(-0.04, -0.1, 0.12), (0.04, -0.1, 0.12), (0.035, -0.2, 0.09), (-0.035, -0.2, 0.09)], PIGW)
for s in (-1, 1):
    p.tube((s * 0.025, 0.0, 0.06), (s * 0.025, 0.02, 0.0), 0.007, mat=PIGF, seg=4)
p.finish("C5_Pigeon")
flying("C5_PigeonFlyA", PIG, PIGW, DARK, 0.34, 0.75)
flying("C5_PigeonFlyB", PIG, PIGW, DARK, 0.34, -0.3)


def cat(name, body, patches=()):
    """座るネコ（原点は地面、+Y を向く）"""
    p = Part()
    p.ellipsoid((0, -0.05, 0.13), 0.1, 0.15, 0.13, body)
    p.ellipsoid((0, 0.03, 0.2), 0.085, 0.09, 0.12, body)
    p.ellipsoid((0, 0.07, 0.34), 0.075, 0.07, 0.065, body)
    for s in (-1, 1):
        p.face([(s * 0.025, 0.06, 0.39), (s * 0.07, 0.06, 0.385), (s * 0.055, 0.075, 0.45)], body)
        p.tube((s * 0.04, 0.08, 0.1), (s * 0.04, 0.1, 0.0), 0.025, mat=body, seg=5)
        p.cbox((s * 0.027, 0.13, 0.35), 0.01, 0.004, 0.008, M("C5_CatEye", 0xc8b43a))
    p.cbox((0, 0.14, 0.325), 0.01, 0.005, 0.006, M("C5_CatNose", 0xd08a8a))
    tail = [Vector((0.06, -0.18, 0.03)), Vector((0.14, -0.12, 0.02)), Vector((0.17, 0.0, 0.02)), Vector((0.14, 0.08, 0.03))]
    for a, b in zip(tail, tail[1:]):
        p.tube(a, b, 0.022, mat=body, seg=5)
    for c, rx, mat in patches:
        p.ellipsoid(c, rx, rx, rx * 0.8, mat, seg=6, rows=4)
    return p.finish(name)


cat("C5_Cat0", M("C5_CatOrange", 0xd88a3a))
cat("C5_Cat1", M("C5_CatBlack", 0x1e1e22))
cat("C5_Cat2", M("C5_CatWhite", 0xeeeae2), [((0.05, -0.08, 0.2), 0.07, M("C5_CatPatchO", 0xd88a3a)), ((-0.05, 0.05, 0.38), 0.045, M("C5_CatPatchB", 0x2a2624))])


def dog_walk(name, coat, coat2, shirt, small):
    p = Part()
    person(p, -0.2, 0, shirt, arms=False)
    p.tube((-0.41, 0, 1.42), (-0.45, 0.05, 1.0), 0.045, mat=shirt)
    p.tube((0.01, 0, 1.42), (0.12, 0.3, 1.02), 0.045, mat=shirt)  # 右手を前へ（リード）
    dx, dy = 0.45, 1.05  # 犬の位置
    s = 0.7 if small else 1.0
    hz = 0.32 * s
    p.ellipsoid((dx, dy, hz), 0.11 * s, 0.24 * s, 0.11 * s, coat)
    p.ellipsoid((dx, dy + 0.27 * s, hz + 0.1 * s), 0.09 * s, 0.1 * s, 0.085 * s, coat)
    p.ellipsoid((dx, dy + 0.36 * s, hz + 0.07 * s), 0.05 * s, 0.07 * s, 0.045 * s, coat2)  # 口のまわり
    p.cbox((dx, dy + 0.43 * s, hz + 0.08 * s), 0.015, 0.012, 0.012, BLACK)
    for e in (-1, 1):
        p.face([(dx + e * 0.03 * s, dy + 0.26 * s, hz + 0.16 * s), (dx + e * 0.08 * s, dy + 0.25 * s, hz + 0.15 * s), (dx + e * 0.06 * s, dy + 0.27 * s, hz + 0.24 * s)], coat)
        for ly in (0.15, -0.15):
            p.tube((dx + e * 0.06 * s, dy + ly * s, hz - 0.05 * s), (dx + e * 0.06 * s, dy + ly * s, 0.0), 0.028 * s, mat=coat, seg=5)
    # 巻いた尾
    p.ellipsoid((dx, dy - 0.24 * s, hz + 0.12 * s), 0.05 * s, 0.05 * s, 0.05 * s, coat2 if not small else coat)
    p.cbox((dx, dy + 0.2 * s, hz + 0.05 * s), 0.08 * s, 0.02, 0.07 * s, RED)  # 首輪
    # リード（手から首輪へ、少したるむ）
    hand, collar = Vector((0.12, 0.32, 1.0)), Vector((dx, dy + 0.2 * s, hz + 0.08 * s))
    mid = hand.lerp(collar, 0.5) + Vector((0, 0, -0.12))
    p.tube(hand, mid, 0.008, mat=RED, seg=4)
    p.tube(mid, collar, 0.008, mat=RED, seg=4)
    return p.finish(name)


dog_walk("C5_DogWalk0", M("C5_Shiba", 0xc8783a), M("C5_ShibaWhite", 0xf0e6d6), M("C5_Jacket0", 0x4a6a8a), False)
dog_walk("C5_DogWalk1", M("C5_Poodle", 0xf2eee6), M("C5_PoodleNose", 0xe8e2d8), M("C5_Jacket1", 0xb05a5a), True)

# ================= 季節 =================
BAMBOO, LEAFG = M("C5_Bamboo", 0x5a9a3a), M("C5_BambooLeaf", 0x4a8a2e)
PAPERS = [M(f"C5_Tanzaku{i}", h) for i, h in enumerate((0xe84a5a, 0xf2c230, 0x3a8ae0, 0x4ab84a, 0xf0f0f0, 0xb05ad0))]
p = Part()  # 七夕の笹飾り（高さ約 4.6m、台の上に立てる）
p.box(-0.35, 0.35, -0.35, 0.35, 0, 0.45, WOOD)
p.tube((0, 0, 0.4), (0.05, 0.02, 4.6), 0.06, 0.035, mat=BAMBOO, seg=7)
for k in range(9):
    z = 1.6 + k * 0.33
    a = k * 2.4
    tip = Vector((math.cos(a) * (1.3 - k * 0.09), math.sin(a) * (1.3 - k * 0.09), z + 0.35))
    base = Vector((0.02, 0.01, z))
    p.tube(base, tip, 0.015, mat=BAMBOO, seg=4)
    for j in range(5):
        q = base.lerp(tip, 0.3 + j * 0.16)
        leaf_dir = Vector((math.cos(a + 1.2 + j), math.sin(a + 1.2 + j), -0.4)).normalized() * 0.22
        p.face([q, q + leaf_dir + Vector((0, 0, 0.04)), q + leaf_dir * 1.3, q + leaf_dir - Vector((0, 0, 0.04))], LEAFG)
        if j % 2 == 0:
            m = PAPERS[(k + j) % len(PAPERS)]
            c = q + Vector((0, 0, -0.05))
            r = Vector((math.cos(a + 1.57), math.sin(a + 1.57), 0)) * 0.035
            p.face([c - r, c + r, c + r + Vector((0, 0, -0.26)), c - r + Vector((0, 0, -0.26))], m)
for k, h in enumerate((0xe84a5a, 0x3a8ae0, 0xf2c230)):  # 吹き流し
    c = Vector((0.05, 0.02, 4.0 - k * 0.15))
    a = k * 2.1
    for j in range(8):
        r = Vector((math.cos(a + j * 0.785), math.sin(a + j * 0.785), 0)) * 0.12
        p.face([c + r, c + r * 1.05, c + r * 1.05 + Vector((0, 0, -1.2)), c + r + Vector((0, 0, -1.2))], PAPERS[(k * 2 + j) % len(PAPERS)])
p.finish("C5_Tanabata")

FURIN_G, FURIN_P = M("C5_FurinGlass", 0x9ad8f0, rough=0.1), M("C5_FurinPaint", 0xe84a5a)
p = Part()  # 風鈴の棚（幅 3m・高さ 2.3m の木の枠に 3 段 × 7 個）
for x in (-1.5, 1.5):
    p.box(x - 0.05, x + 0.05, -0.05, 0.05, 0, 2.3, WOOD)
for z in (2.25, 1.65, 1.05):
    p.box(-1.55, 1.55, -0.04, 0.04, z - 0.04, z + 0.03, WOOD)
    for k in range(7):
        x = -1.25 + k * 0.42
        c = Vector((x, 0, z - 0.17))
        p.tube((x, 0, z - 0.04), (x, 0, z - 0.1), 0.004, mat=DARK, seg=3)
        p.ellipsoid(c, 0.06, 0.06, 0.07, FURIN_G, seg=8, rows=4, top=0.6)
        p.tube(c + Vector((0, 0, -0.01)), c + Vector((0, 0, -0.05)), 0.061, 0.061, mat=FURIN_P, seg=8, caps=False)
        p.face([c + Vector((-0.03, 0, -0.08)), c + Vector((0.03, 0, -0.08)), c + Vector((0.03, 0, -0.3)), c + Vector((-0.03, 0, -0.3))], PAPERS[k % len(PAPERS)])
p.finish("C5_FurinRack")

NEEDLE, ORN_R, ORN_G = M("C5_Fir", 0x1f5a34), M("C5_OrnRed", 0xd02a2a, rough=0.3), M("C5_OrnGold", 0xe8b830, rough=0.3, metal=0.5)
BULB, STAR = M("Light_Bulb", 0xffe0a0, emit=True), M("Light_Star", 0xfff07a, emit=True)
p = Part()  # クリスマスツリー（高さ約 7m。灯と星は光る）
p.box(-0.6, 0.6, -0.6, 0.6, 0, 0.6, RED)
p.tube((0, 0, 0.6), (0, 0, 1.3), 0.18, mat=WOOD)
layers = [(1.1, 3.3, 2.3), (2.4, 4.6, 1.8), (3.6, 5.8, 1.3), (4.8, 6.9, 0.8)]
for z0, z1, r in layers:
    p.cone((0, 0, z0), r, z1 - z0, NEEDLE, seg=12)
for k in range(70):  # 灯（らせん）と飾り玉
    t = k / 70
    z = 1.3 + t * 5.3
    r = 2.3 * (1 - t) * 0.92 + 0.2
    a = t * 6 * math.tau
    c = Vector((math.cos(a) * r, math.sin(a) * r, z))
    p.ellipsoid(c, 0.06, 0.06, 0.06, BULB, seg=5, rows=3)
    if k % 3 == 0:
        a2 = a + 1.7
        p.ellipsoid((math.cos(a2) * r * 0.95, math.sin(a2) * r * 0.95, z - 0.2), 0.11, 0.11, 0.11, ORN_R if k % 2 else ORN_G, seg=6, rows=4)
star = [Vector((0, math.cos(math.pi * k / 5) * (0.42 if k % 2 == 0 else 0.18), 7.15 + math.sin(math.pi * k / 5) * (0.42 if k % 2 == 0 else 0.18))) for k in range(10)]
c = Vector((0, 0, 7.15))
for a, b in zip(star, star[1:] + star[:1]):
    p.face([c + Vector((0.03, 0, 0)), a, b], STAR)
    p.face([c - Vector((0.03, 0, 0)), b, a], STAR)
p.finish("C5_XmasTree")

p = Part()  # 丸い木のイルミネーション（葉の玉の表面に灯を散らす）
blobs = [((0, 0, 4.9), 2.3, 2.3, 1.9), ((1.1, 0.3, 4.6), 1.5, 1.5, 1.28), ((-0.9, 0.9, 4.8), 1.5, 1.5, 1.28), ((-0.4, -1.1, 4.5), 1.4, 1.4, 1.19), ((0.2, 0.1, 6.0), 1.5, 1.5, 1.28)]
bulbs = 0
while bulbs < 140:
    c, rx, ry, rz = blobs[rng.randrange(len(blobs))]
    u, v = rng.uniform(0, math.tau), math.acos(rng.uniform(-0.6, 1))
    pt = Vector((c[0] + math.cos(u) * math.sin(v) * rx * 1.04, c[1] + math.sin(u) * math.sin(v) * ry * 1.04, c[2] + math.cos(v) * rz * 1.04))
    if any(((pt.x - b[0][0]) / b[1]) ** 2 + ((pt.y - b[0][1]) / b[2]) ** 2 + ((pt.z - b[0][2]) / b[3]) ** 2 < 0.95 for b in blobs if b[0] != c):
        continue  # ほかの玉の中に隠れる所には付けない
    p.ellipsoid(pt, 0.05, 0.05, 0.05, M("Light_TreeBulb", 0xfff2c8, emit=True), seg=4, rows=2)
    bulbs += 1
p.finish("C5_TreeLights")

p = Part()  # 桜の花びら（ひらひら舞わせる 1 枚）
pts = [Vector((math.cos(a) * 0.022 * (1 + 0.25 * math.cos(2 * a)), math.sin(a) * 0.016, 0)) for a in [k * math.tau / 8 for k in range(8)]]
p.face(pts, M("C5_Petal", 0xf6c4d4))
p.finish("C5_Petal")

# ================= 縁日 =================
CLOTH_R, CLOTH_W = M("C5_ClothRed", 0xd8322a), M("C5_ClothWhite", 0xf4f2ec)
CHOCHIN = M("Light_Chochin", 0xff6a3a, emit=True)


def yatai(name, label, label_mat, extra):
    """屋台（幅 2.4m・奥行き 1.6m。+Y がお客さんの側）"""
    p = Part()
    p.box(-1.2, 1.2, -0.3, 0.6, 0, 0.9, WOOD)  # 台
    p.box(-1.25, 1.25, 0.55, 0.65, 0.9, 0.95, WOOD)
    for x in (-1.15, 1.15):
        for y in (-0.75, 0.6):
            p.box(x - 0.04, x + 0.04, y - 0.04, y + 0.04, 0, 2.35, WOOD)
    # 赤と白の縞の屋根（前に傾ける）
    n = 8
    for k in range(n):
        x0, x1 = -1.3 + 2.6 * k / n, -1.3 + 2.6 * (k + 1) / n
        p.face([(x0, -0.85, 2.45), (x1, -0.85, 2.45), (x1, 0.95, 2.2), (x0, 0.95, 2.2)], CLOTH_R if k % 2 == 0 else CLOTH_W)
    # 看板（屋根の前の板に、店の名前）
    p.box(-1.2, 1.2, 0.93, 0.98, 1.85, 2.2, WHITE)
    p.text(label, 0.26, (0, 0.985, 2.025), -X, Z, label_mat)  # +Y の面（お客さんの側から読む）
    p.text(label, 0.26, (0, 0.925, 2.025), X, Z, label_mat)
    # ちょうちん 2 つ
    for x in (-0.95, 0.95):
        p.tube((x, 0.95, 2.18), (x, 0.95, 2.05), 0.005, mat=DARK, seg=3)
        p.ellipsoid((x, 0.95, 1.9), 0.12, 0.12, 0.16, CHOCHIN, seg=8, rows=5)
    extra(p)
    return p.finish(name)


def takoyaki(p):
    p.box(-0.7, 0.7, -0.1, 0.4, 0.9, 0.97, BLACK)
    for i in range(6):
        for j in range(3):
            p.ellipsoid((-0.55 + i * 0.22, 0.0 + j * 0.15, 0.98), 0.05, 0.05, 0.035, M("C5_Takoyaki", 0xc8823a), seg=5, rows=3, top=0.5)
    person(p, 0, -0.55, M("C5_Happi2", 0x2f5fbf))


def kingyo(p):
    p.box(-1.0, 1.0, -0.7, 1.4, 0, 0.35, M("C5_Tub", 0x3a8ae0))
    p.box(-0.9, 0.9, -0.6, 1.3, 0.3, 0.33, M("C5_Water", 0x6ab8e8, rough=0.1))
    for k in range(14):
        x, y = rng.uniform(-0.8, 0.8), rng.uniform(-0.5, 1.2)
        p.ellipsoid((x, y, 0.335), 0.035, 0.06, 0.012, M("C5_Fish", 0xff6a2a), seg=5, rows=2)
    person(p, 0, -0.95, M("C5_Happi0", 0xd8322a))


def wataame(p):
    for k in range(6):
        x = -0.9 + k * 0.36
        p.tube((x, 0.85, 1.85), (x, 0.85, 1.65), 0.004, mat=DARK, seg=3)
        p.ellipsoid((x, 0.85, 1.48), 0.13, 0.1, 0.18, M(f"C5_Bag{k % 3}", (0xf6b4d4, 0x9ad0f0, 0xf6e48a)[k % 3]), seg=7, rows=4)
    p.tube((0, 0.0, 0.9), (0, 0.0, 1.05), 0.25, 0.3, mat=METAL, seg=12)
    p.ellipsoid((0, 0.0, 1.15), 0.2, 0.2, 0.12, M("C5_Cotton", 0xfbd8e8), seg=8, rows=4)
    person(p, 0, -0.55, M("C5_Happi1", 0x2f9a4a))


yatai("C5_Yatai0", "たこ焼き", RED, takoyaki)
yatai("C5_Yatai1", "金魚すくい", M("C5_Blue", 0x1f5fb0), kingyo)
yatai("C5_Yatai2", "わたあめ", M("C5_Pink", 0xd04a8a), wataame)

p = Part()  # ちょうちんの列（X の向きに 8m、真ん中が少し下がる。原点は左の端の吊るす高さ）
for k in range(17):
    t = k / 16
    x = t * 8
    z = -0.35 * math.sin(math.pi * t)
    if k < 16:
        t2 = (k + 1) / 16
        p.tube((x, 0, z + 0.02), (t2 * 8, 0, -0.35 * math.sin(math.pi * t2) + 0.02), 0.006, mat=DARK, seg=3)
    if 0 < k < 16:
        p.ellipsoid((x, 0, z - 0.2), 0.1, 0.1, 0.14, CHOCHIN if k % 2 else M("Light_ChochinW", 0xfff2d8, emit=True), seg=8, rows=5)
        p.tube((x, 0, z), (x, 0, z - 0.06), 0.004, mat=DARK, seg=3)
p.finish("C5_Lanterns")

GOLD, LACQUER = M("C5_Gold", 0xe0b030, rough=0.3, metal=0.7), M("C5_Lacquer", 0x1a1214, rough=0.25)
p = Part()  # おみこし（担ぐ 2 本の棒は Y の向き 4.4m、担ぐ人 8 人）
for x in (-0.55, 0.55):
    p.box(x - 0.07, x + 0.07, -2.2, 2.2, 1.45, 1.6, WOOD)
for y in (-0.9, 0.9):
    p.box(-0.8, 0.8, y - 0.06, y + 0.06, 1.5, 1.6, WOOD)
p.box(-0.55, 0.55, -0.55, 0.55, 1.6, 1.78, LACQUER)  # 台
p.box(-0.6, 0.6, -0.6, 0.6, 1.76, 1.8, GOLD)
p.box(-0.38, 0.38, -0.38, 0.38, 1.8, 2.45, LACQUER)  # 胴
for x, y in ((-0.38, -0.38), (0.38, -0.38), (0.38, 0.38), (-0.38, 0.38)):
    p.tube((x, y, 1.8), (x, y, 2.45), 0.035, mat=GOLD, seg=5)
p.box(-0.42, 0.42, -0.42, 0.42, 1.9, 1.96, GOLD)
roof = [(0.72, 2.45), (0.6, 2.55), (0.35, 2.75), (0.12, 2.92), (0.0, 2.95)]
for (r0, z0), (r1, z1) in zip(roof, roof[1:]):  # 反った屋根
    for (sx, sy), (tx, ty) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        p.face([(sx * r0, sy * r0, z0), (tx * r0, ty * r0, z0), (tx * r1, ty * r1, z1), (sx * r1, sy * r1, z1)], LACQUER)
for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
    p.tube((sx * 0.72, sy * 0.72, 2.45), (sx * 0.84, sy * 0.84, 2.62), 0.03, mat=GOLD, seg=5)  # 屋根の角の反り
p.ellipsoid((0, 0, 3.0), 0.1, 0.12, 0.1, GOLD)  # 鳳凰（簡単な形）
for s in (-1, 1):
    p.face([(0, 0, 3.0), (s * 0.3, -0.05, 3.2), (s * 0.25, -0.1, 3.05)], GOLD)
p.tube((0, 0.1, 3.05), (0, 0.22, 3.25), 0.03, 0.02, mat=GOLD, seg=5)
HAPPI_M = [M("C5_Happi0", 0xd8322a), M("C5_Happi1", 0x2f9a4a), M("C5_Happi2", 0x2f5fbf)]
for k, y in enumerate((-1.7, -1.2, 1.2, 1.7)):
    for s in (-1, 1):
        x = s * 0.82
        person(p, x, y, HAPPI_M[(k + (s > 0)) % 3], arms=False)
        p.tube((x - s * 0.2, y, 1.42), (s * 0.6, y, 1.6), 0.045, mat=HAPPI_M[(k + (s > 0)) % 3])  # 肩に棒を担ぐ腕
        p.tube((x, y, 1.62), (x, y + 0.01, 1.66), 0.11, mat=WHITE, seg=8, caps=False)  # はちまき
p.finish("C5_Mikoshi")

# ================= 移動販売の車 =================
BODYW, CABG = M("C5_TruckWhite", 0xeeeeea, rough=0.4), M("C5_CabGlass", 0x2a3a4a, rough=0.1)
TIRE = M("C5_Tire", 0x141416, rough=0.9)


def kei_truck(p, color=BODYW):
    """軽トラ（長さ 3.4m・幅 1.48m。+Y が前）"""
    p.box(-0.74, 0.74, 0.55, 1.7, 0.35, 1.2, color)  # 運転台の下
    p.box(-0.72, 0.72, 0.6, 1.45, 1.2, 1.85, color)  # 運転台
    p.box(-0.69, 0.69, 1.44, 1.46, 1.28, 1.75, CABG)  # 前の窓（傾けず）
    for s in (-1, 1):
        p.box(s * 0.72, s * 0.725, 0.75, 1.35, 1.25, 1.72, CABG)
    p.box(-0.74, 0.74, -1.7, 0.5, 0.45, 0.55, METAL)  # 荷台の床
    for s in (-1, 1):
        p.box(s * 0.72, s * 0.74, -1.7, 0.5, 0.55, 0.85, color)  # 荷台のあおり
    p.box(-0.74, 0.74, -1.72, -1.7, 0.55, 0.85, color)
    p.box(-0.74, 0.74, 0.45, 0.5, 0.55, 1.05, color)
    for x in (-0.66, 0.66):
        for y in (-1.15, 1.1):
            p.tube((x - 0.08, y, 0.28), (x + 0.08, y, 0.28), 0.28, mat=TIRE, seg=10)
    for x in (-0.55, 0.55):
        p.cbox((x, 1.71, 0.85), 0.12, 0.01, 0.06, M("Light_Head", 0xfff6dc, emit=True))
        p.cbox((x, -1.73, 0.7), 0.08, 0.01, 0.06, M("Light_Tail", 0xff3030, emit=True))


p = Part()  # 石焼いもの軽トラ（荷台に石がまと煙突、赤いのぼり）
kei_truck(p)
p.box(-0.55, 0.55, -1.5, 0.2, 0.55, 1.15, BLACK)  # かま
p.box(-0.5, 0.5, -1.45, 0.15, 1.15, 1.2, M("C5_Stones", 0x6a625a))
p.tube((0.35, -1.3, 1.15), (0.35, -1.3, 2.1), 0.06, mat=BLACK, seg=6)
p.ellipsoid((0, 0.21, 0.95), 0.12, 0.01, 0.12, M("Light_Fire", 0xff7a2a, emit=True), seg=8, rows=4)
p.tube((-0.62, -1.6, 0.85), (-0.62, -1.6, 2.6), 0.02, mat=WOOD, seg=4)
p.box(-0.63, -0.61, -1.58, -1.2, 1.4, 2.55, RED)
p.vtext("石焼いも", 0.22, (-0.635, -1.39, 2.48), -Y, Z, WHITE)  # のぼりは縦書き
p.vtext("石焼いも", 0.22, (-0.605, -1.39, 2.48), Y, Z, WHITE)
p.ellipsoid((0.5, -0.2, 1.4), 0.14, 0.14, 0.2, CHOCHIN, seg=8, rows=5)
p.tube((0.5, -0.2, 1.6), (0.5, -0.2, 1.85), 0.006, mat=DARK, seg=3)
p.finish("C5_Yakiimo")

p = Part()  # キッチンカー（長さ 4.6m。+X の側の窓が開いて、ひさしが出る）
YEL = M("C5_KitchenYellow", 0xf2c230, rough=0.4)
p.box(-0.9, 0.9, -2.3, 1.5, 0.35, 2.5, YEL)
p.box(-0.88, 0.88, 1.5, 2.3, 0.35, 1.55, YEL)
p.box(-0.86, 0.86, 1.5, 2.2, 1.55, 2.2, CABG)
p.box(0.9, 0.91, -1.6, 0.8, 1.15, 2.05, M("Light_Kitchen", 0xfff0d0, emit=True))  # 開いた窓（中が明るい）
p.box(0.91, 1.25, -1.65, 0.85, 1.05, 1.1, METAL)  # 窓の下の台
p.face([(0.91, -1.7, 2.15), (0.91, 0.9, 2.15), (1.65, 0.9, 1.95), (1.65, -1.7, 1.95)], CLOTH_R)  # ひさし
p.box(0.905, 0.915, -2.1, -1.7, 0.9, 2.2, DARK)  # メニューの板
for k, w in enumerate(("CAFE", "CURRY", "CREPE")):
    p.text(w, 0.11, (0.918, -1.9, 2.05 - k * 0.3), Y, Z, WHITE)
p.text("KITCHEN CAR", 0.3, (-0.905, -0.4, 1.9), -Y, Z, M("C5_KitchenRed", 0xc8302a))
for x in (-0.78, 0.78):
    for y in (-1.6, 1.4):
        p.tube((x - 0.1, y, 0.33), (x + 0.1, y, 0.33), 0.33, mat=TIRE, seg=10)
for x in (-0.6, 0.6):
    p.cbox((x, 2.31, 0.9), 0.12, 0.01, 0.07, M("Light_Head", 0xfff6dc, emit=True))
p.finish("C5_FoodTruck")

p = Part()  # 古紙回収の軽トラ（運転台の上にスピーカー、荷台に新聞の束）
kei_truck(p, M("C5_TruckBlue", 0x8ab0d0, rough=0.4))
for k in range(6):
    p.box(-0.6 + (k % 3) * 0.4, -0.25 + (k % 3) * 0.4, -1.55 + (k // 3) * 0.6, -1.05 + (k // 3) * 0.6, 0.55, 0.85 + (k % 2) * 0.12, M("C5_Paper", 0xd8d2c0))
for s in (-1, 1):
    p.tube((s * 0.2, 1.0, 1.85), (s * 0.3, 1.25, 2.05), 0.12, 0.2, mat=WHITE, seg=8)  # スピーカー
p.box(-0.7, 0.7, 0.45, 0.48, 0.95, 1.5, WHITE)
p.text("古紙回収", 0.2, (0, 0.44, 1.22), X, Z, M("C5_Blue", 0x1f5fb0))
p.finish("C5_Chirigami")

# ================= 川の船 =================
p = Part()  # 観光船（長さ 20m。白い船体とガラスの屋根の客室）
hull = [(0, 10.0, 0.6), (1.2, 8.5, 0.0), (2.2, 6.0, -0.2), (2.4, 0.0, -0.3), (2.3, -8.0, -0.3), (2.0, -9.6, 0.0)]
for (x0, y0, z0), (x1, y1, z1) in zip(hull, hull[1:]):
    for s in (-1, 1):
        p.face([(s * x0, y0, 1.0), (s * x1, y1, 1.0), (s * x1, y1, z1), (s * x0, y0, z0)], WHITE)
    p.face([(-x0, y0, 1.0), (x0, y0, 1.0), (x1, y1, 1.0), (-x1, y1, 1.0)], M("C5_Deck", 0xb8a07a))
p.face([(-2.0, -9.6, 1.0), (2.0, -9.6, 1.0), (2.0, -9.6, 0.0), (-2.0, -9.6, 0.0)], WHITE)
for s in (-1, 1):
    p.box(s * 2.3, s * 2.35, -8.5, 6.0, 0.55, 0.7, M("C5_Stripe", 0x1f5fb0))
p.box(-1.8, 1.8, -6.5, 5.0, 1.0, 1.3, WHITE)
p.box(-1.75, 1.75, -6.4, 4.9, 1.3, 2.4, GLASS)  # 客室のガラス
p.box(-1.8, 1.8, -6.5, 5.0, 2.4, 2.5, WHITE)
for k in range(8):
    y = -6.4 + k * 1.6
    for s in (-1, 1):
        p.box(s * 1.76 - 0.03, s * 1.76 + 0.03, y - 0.05, y + 0.05, 1.3, 2.4, WHITE)
p.box(-1.7, 1.7, -6.3, 4.8, 1.25, 1.3, M("Light_Cabin", 0xfff0d0, emit=True))
for k in range(10):  # 客（頭だけ見える）
    p.ellipsoid((-1.2 + (k % 2) * 2.4, -5.5 + k * 1.0, 1.75), 0.1, 0.11, 0.12, HAIR if k % 3 else SKIN)
p.box(-1.0, 1.0, 5.2, 7.5, 1.0, 1.1, M("C5_Deck", 0xb8a07a))
for x in (-1.0, 1.0):
    p.tube((x, 5.2, 1.1), (x, 7.6, 1.1), 0.02, mat=METAL, seg=4)
p.finish("C5_Cruise")

p = Part()  # カヌー（長さ 5m）と漕ぐ 2 人
CANOE = M("C5_Canoe", 0xd8582a, rough=0.4)
outline = [(0, 2.5), (0.25, 1.8), (0.38, 0.8), (0.4, 0.0), (0.38, -0.8), (0.25, -1.8), (0, -2.5)]
for (x0, y0), (x1, y1) in zip(outline, outline[1:]):
    for s in (-1, 1):
        p.face([(s * x0, y0, 0.32), (s * x1, y1, 0.32), (s * x1 * 0.6, y1, -0.05), (s * x0 * 0.6, y0, -0.05)], CANOE)
    p.face([(-x0 * 0.6, y0, -0.05), (x0 * 0.6, y0, -0.05), (x1 * 0.6, y1, -0.05), (-x1 * 0.6, y1, -0.05)], CANOE)
for k, y in enumerate((0.9, -0.9)):
    vest = M("C5_Vest", 0xf2c230) if k == 0 else M("C5_Vest2", 0xd83a3a)
    p.ellipsoid((0, y, 0.55), 0.18, 0.13, 0.28, vest)
    p.ellipsoid((0, y + 0.02, 0.95), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((0, y + 0.01, 1.03), 0.11, 0.115, 0.07, M("C5_Cap", 0xf4f4f0), rows=3)
    a = -0.5 if k == 0 else 0.5
    c = Vector((0, y + 0.2, 0.7))
    d = Vector((math.cos(a), 0.1, math.sin(a))).normalized()
    p.tube(c - d * 0.9, c + d * 0.9, 0.018, mat=WOOD, seg=4)
    for e in (-1, 1):
        q = c + d * e * 0.95
        p.box(q.x - 0.04, q.x + 0.04, q.y - 0.09, q.y + 0.09, q.z - 0.18, q.z + 0.02, WOOD) if False else p.ellipsoid(q + d * e * 0.12, 0.03, 0.09, 0.16, WOOD, seg=5, rows=3)
p.finish("C5_Canoe")

# ================= 雨と雪 =================
p = Part()  # 水たまり（半径約 1m のゆがんだ円。路面のすぐ上）
pts = [Vector((math.cos(a) * (1.0 + 0.25 * math.sin(3 * a + 0.5) + 0.1 * math.sin(7 * a)), math.sin(a) * (0.7 + 0.15 * math.cos(2 * a)), 0)) for a in [k * math.tau / 20 for k in range(20)]]
p.face(pts, M("C5_Puddle", 0x2a3442, rough=0.05, metal=0.4))
p.finish("C5_Puddle")

SNOW = M("C5_Snow", 0xf2f6fa, rough=0.9)
p = Part()  # 雪だるま（高さ約 1.1m）
p.ellipsoid((0, 0, 0.32), 0.36, 0.36, 0.33, SNOW, seg=12, rows=7)
p.ellipsoid((0, 0, 0.82), 0.25, 0.25, 0.24, SNOW, seg=12, rows=7)
p.tube((0, 0, 1.0), (0, 0, 1.22), 0.17, 0.2, mat=RED, seg=10)  # バケツ
for x in (-0.08, 0.08):
    p.ellipsoid((x, 0.22, 0.88), 0.025, 0.02, 0.025, BLACK, seg=5, rows=3)
p.tube((0, 0.23, 0.82), (0, 0.38, 0.81), 0.03, 0.004, mat=M("C5_Carrot", 0xf07a1a), seg=6)
p.tube((-0.24, 0.0, 0.62), (0.24, 0.0, 0.62), 0.24, mat=M("C5_Scarf", 0x2f5fbf), seg=10, caps=False)
for s in (-1, 1):
    p.tube((s * 0.22, 0, 0.85), (s * 0.55, 0.05, 1.05), 0.015, mat=WOOD, seg=4)
for k in range(3):
    p.ellipsoid((0, 0.34, 0.45 - k * 0.12), 0.025, 0.02, 0.025, BLACK, seg=5, rows=3)
p.finish("C5_Snowman")

p = Part()  # 道の端に寄せた雪の山
for k in range(6):
    p.ellipsoid((rng.uniform(-0.6, 0.6), rng.uniform(-0.25, 0.25), 0.0), rng.uniform(0.35, 0.55), rng.uniform(0.3, 0.4), rng.uniform(0.25, 0.45), SNOW, seg=8, rows=4, top=0.5)
p.finish("C5_SnowPile")

# ================= 電車の開いたドア =================
p = Part()  # +X の側面（車体の外側 x = 1.48）、ドアの真ん中が原点。高さはレールの上から（ドアは 1.15〜3.2m・幅 1.5m）
INSIDE = M("Light_TrainInside", 0xcfc8b8, emit=True)
p.face([(1.492, -0.72, 1.17), (1.492, 0.72, 1.17), (1.492, 0.72, 3.18), (1.492, -0.72, 3.18)], INSIDE)
p.face([(1.493, -0.72, 1.17), (1.493, 0.72, 1.17), (1.493, 0.72, 1.4), (1.493, -0.72, 1.4)], M("C5_Floor", 0x6a6a70))  # 床の見える所
p.box(1.488, 1.5, -0.04, 0.04, 1.4, 3.1, METAL)  # 奥の手すり
for y in (-0.75, 0.75):
    p.box(1.48, 1.505, y - 0.04, y + 0.04, 1.15, 3.2, M("C5_DoorFrame", 0x8a8e94, metal=0.5))
p.box(1.48, 1.505, -0.78, 0.78, 3.17, 3.22, M("C5_DoorFrame", 0x8a8e94, metal=0.5))
p.finish("C5_DoorOpen")

# ================= 表彰台 =================
p = Part()  # 1 位（真ん中・高さ 1m）、2 位（前から見て左 0.7m。+X）、3 位（前から見て右 0.45m。-X）。字は +Y の面
for x, h, label in ((0, 1.0, "1"), (1.25, 0.7, "2"), (-1.25, 0.45, "3")):
    p.box(x - 0.62, x + 0.62, -0.6, 0.6, 0, h, WHITE)
    p.box(x - 0.63, x + 0.63, -0.61, 0.61, h - 0.06, h, M("C5_PodiumTop", 0x2f6fde))
    p.text(label, 0.42 if h > 0.5 else 0.3, (x, 0.605, h * 0.48), -X, Z, M("C5_PodiumNum", 0xd8a020))
p.finish("C5_Podium")

# 立つ自転車の人（両手を上げる）。材質の名前は自転車の人と同じ（ゲームで服とヘルメットの色にする）
J, SH_, SK, HL = M("BK_Jersey", 0xffcc33), M("BK_Shorts", 0x22324f), M("BK_Skin", 0xf2d0a9), M("BK_Helmet", 0xe8443a)
SHOES = M("BK_Saddle", 0x15171b)
p = Part()
for s in (-1, 1):
    p.tube((s * 0.1, 0, 0.9), (s * 0.1, 0, 0.55), 0.075, 0.065, mat=SH_)
    p.tube((s * 0.1, 0, 0.55), (s * 0.1, 0, 0.08), 0.06, 0.045, mat=SK)
    p.ellipsoid((s * 0.1, 0.05, 0.05), 0.055, 0.12, 0.05, SHOES, seg=6, rows=3)
p.ellipsoid((0, 0, 0.98), 0.17, 0.12, 0.14, SH_)
p.ellipsoid((0, 0, 1.22), 0.19, 0.12, 0.3, J)
p.tube((0, 0.0, 1.18), (0, 0.0, 1.24), 0.192, mat=HL, seg=10, caps=False)  # 横の線
p.ellipsoid((0, 0.01, 1.62), 0.1, 0.11, 0.12, SK)
p.ellipsoid((0, 0.0, 1.66), 0.125, 0.15, 0.12, HL, seg=10, rows=4, top=0.55)
for x in (-0.035, 0.035):
    p.cbox((x, 0.105, 1.63), 0.012, 0.006, 0.012, SHOES)
p.cbox((0, 0.105, 1.57), 0.03, 0.005, 0.008, M("C5_Smile", 0xb04a3a))
for s in (-1, 1):
    sh = Vector((s * 0.19, 0, 1.42))
    el = Vector((s * 0.36, 0.05, 1.68))
    hd = Vector((s * 0.42, 0.06, 1.98))
    p.tube(sh, el, 0.05, 0.042, mat=J)
    p.tube(el, hd, 0.04, 0.035, mat=SK)
    p.ellipsoid(hd + Vector((0, 0, 0.04)), 0.045, 0.04, 0.05, SHOES, seg=6, rows=3)
p.finish("C5_Champion")

p = Part()  # メダル（立つ人の首から胸へ）
RIB = M("C5_Ribbon", 0xd8322a)
for s in (-1, 1):
    p.face([(s * 0.09, 0.08, 1.46), (s * 0.06, 0.1, 1.46), (s * 0.01, 0.135, 1.25), (s * 0.04, 0.13, 1.25)], RIB)
p.tube((0, 0.13, 1.2), (0, 0.15, 1.2), 0.065, mat=M("C5_Medal", 0xf5c542, rough=0.25, metal=0.7), seg=12)
p.finish("C5_Medal")

# ================= ミニチュア（タイトル画面） =================
MINI_WALLS = [M(f"C5_MiniWall{k}", h) for k, h in enumerate((0xd8d4cc, 0xb8c2cc, 0xe0c8a8, 0x9aa6b4))]
MINI_WIN = M("Light_MiniWindow", 0xffe8b0, emit=True)
for k, (w, d, h) in enumerate(((1.0, 1.0, 1.6), (1.4, 0.9, 2.6), (0.9, 0.9, 4.2), (1.6, 1.2, 1.0))):
    p = Part()
    p.box(-w / 2, w / 2, -d / 2, d / 2, 0, h, MINI_WALLS[k])
    floors = max(1, int(h / 0.35))
    for f in range(floors):
        z = 0.15 + f * h / floors
        for s in (-1, 1):
            p.box(-w / 2 + 0.1, w / 2 - 0.1, s * d / 2 - 0.005, s * d / 2 + 0.005, z, z + h / floors * 0.45, MINI_WIN)
            p.box(s * w / 2 - 0.005, s * w / 2 + 0.005, -d / 2 + 0.1, d / 2 - 0.1, z, z + h / floors * 0.45, MINI_WIN)
    p.box(-w / 2 + 0.1, w / 2 - 0.1, -d / 2 + 0.1, d / 2 - 0.1, h, h + 0.08, M("C5_MiniRoof", 0x6a6e78))
    p.finish(f"C5_MiniBldg{k}")
p = Part()
p.tube((0, 0, 0), (0, 0, 0.4), 0.06, mat=WOOD)
p.ellipsoid((0, 0, 0.65), 0.35, 0.35, 0.38, M("C5_MiniLeaf", 0x4f8a3c), seg=8, rows=5)
p.finish("C5_MiniTree")
p = Part()  # 東京タワー（高さ 6）
TR, TW = M("C5_TowerRed", 0xe0502a), M("C5_TowerWhite", 0xf2f2ee)
lv = [(0.0, 1.3), (1.6, 0.55), (2.6, 0.35), (4.2, 0.16), (6.0, 0.02)]
for k, ((z0, r0), (z1, r1)) in enumerate(zip(lv, lv[1:])):
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p.tube((sx * r0, sy * r0, z0), (sx * r1, sy * r1, z1), 0.05, mat=TR if k % 2 == 0 else TW, seg=4)
    for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        p.tube((ax * r0, ay * r0, z0), (bx * r1, by * r1, z1), 0.025, mat=TR, seg=3)
        p.tube((bx * r0, by * r0, z0), (ax * r1, ay * r1, z1), 0.025, mat=TR, seg=3)
p.box(-0.62, 0.62, -0.62, 0.62, 1.55, 1.75, TW)
p.box(-0.4, 0.4, -0.4, 0.4, 2.55, 2.7, TW)
p.finish("C5_MiniTower")
p = Part()  # スカイツリー（高さ 9）
SKY = M("C5_SkytreeWhite", 0xdfe6ee)
p.tube((0, 0, 0), (0, 0, 9.0), 0.45, 0.04, mat=SKY, seg=8)
p.tube((0, 0, 5.0), (0, 0, 5.4), 0.4, 0.4, mat=GLASS, seg=10)
p.tube((0, 0, 6.6), (0, 0, 6.8), 0.3, 0.3, mat=GLASS, seg=10)
for k in range(3):
    a = k * math.tau / 3
    p.tube((math.cos(a) * 0.9, math.sin(a) * 0.9, 0), (0, 0, 3.0), 0.06, mat=SKY, seg=4)
p.finish("C5_MiniSkytree")
p = Part()  # 駅のホーム（長さ 3、Y の向き）
p.box(-0.35, 0.35, -1.5, 1.5, 0, 0.12, M("C5_MiniPlatform", 0xb8b4ac))
p.box(-0.3, 0.3, -1.2, 1.2, 0.55, 0.6, M("C5_MiniCanopy", 0x8a96a4))
for y in (-1.0, 0.0, 1.0):
    p.tube((0, y, 0.12), (0, y, 0.55), 0.03, mat=METAL, seg=4)
p.box(-0.36, 0.36, -1.5, 1.5, 0.12, 0.13, M("C5_MiniEdge", 0xf2c230))
p.finish("C5_MiniStation")

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
gm = bpy.data.meshes.new("C5_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C5_PreviewGroundMat"))
gp = bpy.data.objects.new("C5_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C5_Sun", bpy.data.lights.new("C5_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C5_Camera", bpy.data.cameras.new("C5_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C5_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city5_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
