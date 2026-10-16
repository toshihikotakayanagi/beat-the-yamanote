# 街の物 その 13：夜の屋台村・除雪車・川のカモと白鳥・打ち水をする人・窓ふきのゴンドラを、ゲーム向けに軽く Blender で組み立てる
# （駅前の大きなクリスマスツリーと高架下の自転車置き場は、前に作ったモデルを使う：build-city5.py のクリスマスツリー・build-city3.py の自転車置き場）
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city12.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C12_Export」。
#   C12_YataiMura（夜の屋台村。ネオンとちょうちん、座る客。湯気はゲームで出す）・C12_SnowPlow（除雪車）・
#   C12_Duck・C12_Swan（水に浮かぶカモと白鳥）・C12_Uchimizu（打ち水をする人）・C12_Gondola（窓ふきのゴンドラ。原点は上の吊り元）
# 光る部品の材質の名前は「Light」で始める。下見用は「C12_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city12.blend")
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


export_col = bpy.data.collections.new("C12_Export")
preview_col = bpy.data.collections.new("C12_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C12_Skin", 0xe0b896), M("C12_Hair", 0x231c18), M("C12_Shoe", 0x2b2c31), M("C12_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C12_White", 0xf2f2ee), M("C12_Black", 0x17181b), M("C12_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C12_Wood", 0x8a6440), M("C12_Red", 0xd8322a), M("C12_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C12_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C12_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C12_TextTmp", cu)
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



# ================= 夜の屋台村（長さ 10m のカウンターの並び。+Y がお客さんの側） =================
NEONS = [M(f"Light_Neon12_{k}", h, emit=True) for k, h in enumerate((0xff3fa4, 0x3fe0ff, 0xffe03f, 0x6aff6a))]
p = Part()
p.box(-5, 5, -1.2, 0.0, 0, 1.0, WOOD)  # カウンター
p.box(-5.1, 5.1, -0.05, 0.25, 1.0, 1.06, M("C12_Counter", 0x6a4a30))
for x in (-5, -1.7, 1.7, 5):
    p.box(x - 0.06, x + 0.06, -1.2, -1.08, 0, 2.6, WOOD)
p.box(-5.3, 5.3, -1.6, 0.9, 2.6, 2.75, M("C12_Roof", 0x3a2a20))  # 屋根
for k, x0 in enumerate((-5, -1.7, 1.7)):  # 3 軒の看板（ネオンの縁取り）
    x1 = x0 + 3.3
    p.box(x0 + 0.1, x1 - 0.1, 0.88, 0.92, 2.15, 2.6, BLACK)
    for z in (2.17, 2.56):
        p.box(x0 + 0.1, x1 - 0.1, 0.92, 0.94, z, z + 0.03, NEONS[k])
    p.text(("やきとり", "おでん", "もつ煮")[k], 0.26, ((x0 + x1) / 2, 0.945, 2.37), -X, Z, NEONS[k])
    for j in range(3):  # 赤ちょうちん
        p.ellipsoid((x0 + 0.6 + j * 1.05, 0.95, 1.9), 0.13, 0.13, 0.18, M("Light_YataiLamp", 0xff4a2a, emit=True), seg=8, rows=5)
for k in range(9):  # 丸いすと、座る人
    x = -4.4 + k * 1.1
    p.tube((x, 0.6, 0), (x, 0.6, 0.55), 0.04, mat=METAL, seg=5)
    p.tube((x, 0.6, 0.55), (x, 0.6, 0.6), 0.18, mat=M("C12_Stool", 0xc8302a), seg=10)
    if k % 3 != 1:
        shirt = M(f"C12_Guest{k % 4}", (0x3a5a8a, 0x5a5a5a, 0x8a5a3a, 0x2a4a3a)[k % 4])
        p.ellipsoid((x, 0.55, 1.05), 0.17, 0.12, 0.3, shirt)
        p.ellipsoid((x, 0.5, 1.45), 0.1, 0.11, 0.12, SKIN)
        p.ellipsoid((x, 0.52, 1.52), 0.105, 0.115, 0.08, HAIR, rows=3)
        p.tube((x, 0.6, 0.6), (x, 0.95, 0.6), 0.06, mat=PANTS)
        p.tube((x + 0.15, 0.5, 1.25), (x + 0.12, 0.15, 1.1), 0.04, mat=shirt)
        p.tube((x + 0.12, 0.15, 1.1), (x + 0.12, 0.15, 1.2), 0.035, 0.04, mat=M("C12_Mug", 0xf2c230), seg=6)  # ジョッキ
for x in (-3.3, 0.0, 3.3):  # 中の店主
    person(p, x, -0.7, M("C12_Chef", 0xf4f4f0), arms=False)
p.finish("C12_YataiMura")

# ================= 除雪車（オレンジの小さなトラックと、前の排土板。+Y が前） =================
ORANGE = M("C12_PlowOrange", 0xf28a1a, rough=0.4)
p = Part()
p.box(-0.95, 0.95, -2.2, 0.8, 0.5, 1.5, ORANGE)
p.box(-0.95, 0.95, 0.8, 2.2, 0.5, 2.4, ORANGE)
p.box(-0.9, 0.9, 2.19, 2.21, 1.5, 2.25, M("C12_Glass", 0x2a3a4a, rough=0.1))
for s in (-1, 1):
    p.box(s * 0.95 - 0.01, s * 0.95 + 0.01, 1.0, 2.0, 1.5, 2.2, M("C12_Glass", 0x2a3a4a, rough=0.1))
for x in (-0.85, 0.85):
    for y in (-1.4, 1.5):
        p.tube((x - 0.12, y, 0.45), (x + 0.12, y, 0.45), 0.45, mat=M("C12_Tire", 0x141416), seg=12)
blade = [(-1.6, 3.3, 0.05), (1.6, 2.7, 0.05), (1.6, 2.7, 0.95), (-1.6, 3.3, 0.95)]  # 斜めの排土板
p.face(blade, M("C12_Blade", 0xd8dce2, metal=0.5))
p.face(blade[::-1], M("C12_Blade", 0xd8dce2, metal=0.5))
for x in (-0.6, 0.6):
    p.box(x - 0.08, x + 0.08, 2.2, 2.95, 0.4, 0.6, METAL)
p.box(-0.5, 0.5, 1.4, 1.8, 2.4, 2.55, M("Light_PlowLamp", 0xffa020, emit=True))  # 回転灯
p.box(-0.95, 0.95, -2.2, 0.8, 1.5, 1.6, M("C12_Salt", 0xe8e8e0))  # 荷台の融雪剤
p.finish("C12_SnowPlow")

# ================= カモと白鳥（水に浮かぶ。+Y が前） =================
p = Part()  # カモ（長さ 0.5m）
DUCK, DUCKH = M("C12_Duck", 0x8a6a4a), M("C12_DuckHead", 0x2a6a3a)
p.ellipsoid((0, 0, 0.06), 0.12, 0.24, 0.1, DUCK, seg=8, rows=5)
p.ellipsoid((0, 0.16, 0.2), 0.065, 0.075, 0.07, DUCKH, seg=8, rows=4)
p.tube((0, 0.22, 0.2), (0, 0.32, 0.19), 0.025, 0.015, mat=M("C12_Bill", 0xe0b030), seg=5)
p.face([(-0.06, -0.22, 0.08), (0.06, -0.22, 0.08), (0, -0.32, 0.14)], DUCK)
p.finish("C12_Duck")
p = Part()  # 白鳥（長さ 1.2m、長い首）
SWAN = M("C12_Swan", 0xf6f6f2)
p.ellipsoid((0, 0, 0.12), 0.28, 0.55, 0.22, SWAN, seg=10, rows=6)
neck = [Vector((0, 0.38, 0.2)), Vector((0, 0.48, 0.45)), Vector((0, 0.45, 0.7)), Vector((0, 0.52, 0.82))]
for a, b in zip(neck, neck[1:]):
    p.tube(a, b, 0.06, 0.045, mat=SWAN, seg=7)
p.ellipsoid((0, 0.55, 0.84), 0.06, 0.09, 0.06, SWAN, seg=7, rows=4)
p.tube((0, 0.62, 0.83), (0, 0.72, 0.8), 0.03, 0.012, mat=M("C12_SwanBill", 0xf28a1a), seg=5)
for s in (-1, 1):
    p.face([(s * 0.25, 0.25, 0.2), (s * 0.3, -0.35, 0.22), (s * 0.12, -0.5, 0.4)], SWAN)
p.finish("C12_Swan")

# ================= 打ち水をする人（ひしゃくで水をまく。前に水の弧。+Y が前） =================
p = Part()
YUK = M("C12_Yukata", 0x3a6aa8)
p.tube((0, 0, 0.05), (0, 0.05, 0.9), 0.16, 0.13, mat=YUK, seg=8)
p.ellipsoid((0, 0.08, 1.15), 0.18, 0.13, 0.3, YUK)
p.ellipsoid((0, 0.15, 1.55), 0.1, 0.11, 0.12, SKIN)
p.ellipsoid((0, 0.13, 1.62), 0.105, 0.115, 0.08, HAIR, rows=3)
p.tube((-0.15, 0.1, 1.38), (-0.25, 0.3, 0.9), 0.045, mat=YUK)
p.tube((-0.25, 0.3, 0.9), (-0.25, 0.3, 0.55), 0.008, mat=METAL, seg=3)  # 手おけの持ち手
p.tube((-0.25, 0.3, 0.3), (-0.25, 0.3, 0.55), 0.14, 0.16, mat=WOOD, seg=10)  # 手おけ
p.tube((0.15, 0.1, 1.38), (0.3, 0.45, 1.15), 0.045, mat=YUK)
p.tube((0.3, 0.45, 1.15), (0.35, 0.85, 0.95), 0.012, mat=WOOD, seg=4)  # ひしゃく
p.tube((0.35, 0.85, 0.95), (0.35, 0.88, 0.88), 0.06, 0.06, mat=WOOD, seg=8)
WATER12 = M("C12_Water", 0xc8e8f8, rough=0.05)
for k in range(10):  # 水の弧（粒）
    t = k / 9
    p.ellipsoid((0.35 + t * 0.2, 0.95 + t * 1.6, 0.9 + 0.5 * t - 1.3 * t * t), 0.035, 0.035, 0.035, WATER12, seg=5, rows=3)
p.face([(0.0 + math.cos(a) * 0.9 + 0.4, 2.3 + math.sin(a) * 0.6, 0.012) for a in [k * math.tau / 12 for k in range(12)]], M("C12_Wet", 0x3a4048, rough=0.1))  # 濡れた地面
p.finish("C12_Uchimizu")

# ================= 窓ふきのゴンドラ（幅 4m。作業員 2 人。原点は真ん中の上の吊り元。+Y が壁から外） =================
p = Part()
GON = M("C12_Gondola", 0xd8dce2, metal=0.4)
p.box(-2, 2, 0.3, 1.0, -1.25, -1.15, GON)  # 床
p.box(-2, 2, 0.98, 1.02, -0.2, -0.1, GON)  # 手すり
for x in (-2, 2):
    p.box(x - 0.02, x + 0.02, 0.3, 1.0, -1.15, -0.1, GON)
    p.tube((x * 0.9, 0.65, -0.1), (x * 0.9, 0.65, 0.0), 0.01, mat=METAL, seg=3)
for x, shirt in ((-0.9, 0x3a8ae0), (0.9, 0xf28a1a)):
    WK = M(f"C12_Worker{x > 0}", shirt)
    p.ellipsoid((x, 0.6, -0.65), 0.17, 0.12, 0.3, WK)
    p.ellipsoid((x, 0.58, -0.25), 0.1, 0.11, 0.12, SKIN)
    p.ellipsoid((x, 0.58, -0.18), 0.12, 0.13, 0.1, WHITE, rows=3, top=0.55)
    for s in (-1, 1):
        p.tube((x + s * 0.1, 0.65, -1.15), (x + s * 0.1, 0.65, -0.85), 0.06, mat=PANTS)
    p.tube((x + 0.15, 0.5, -0.45), (x + 0.2, 0.15, -0.3), 0.04, mat=WK)  # 窓へ伸ばす腕
    p.box(x + 0.1, x + 0.3, 0.12, 0.15, -0.35, -0.25, M("C12_Squeegee", 0x2a2d33))
p.finish("C12_Gondola")

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
gm = bpy.data.meshes.new("C12_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C12_PreviewGroundMat"))
gp = bpy.data.objects.new("C12_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C12_Sun", bpy.data.lights.new("C12_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C12_Camera", bpy.data.cameras.new("C12_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C12_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city12_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
