# 街の物 その 14：雨の日の傘の花・名所のライトアップの投光器と光の筋・冬のイルミネーションのアーチ・屋形船の夜の灯を、
# ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city13.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C13_Export」。
#   C13_UmbrellaGroup0/1（傘をさした 5 人の群れ）・C13_Uplight（地面の投光器）・C13_UpBeam（光の筋。高さ 1。ゲームで伸ばし色を付ける）・
#   C13_LightArch（イルミネーションのアーチ 1 つ）・C13_YakataNight（屋形船の夜の提灯と窓）・C13_YakataReflect（水面に映る光）
# 光る部品の材質の名前は「Light」で始める。下見用は「C13_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city13.blend")
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


export_col = bpy.data.collections.new("C13_Export")
preview_col = bpy.data.collections.new("C13_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C13_Skin", 0xe0b896), M("C13_Hair", 0x231c18), M("C13_Shoe", 0x2b2c31), M("C13_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C13_White", 0xf2f2ee), M("C13_Black", 0x17181b), M("C13_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C13_Wood", 0x8a6440), M("C13_Red", 0xd8322a), M("C13_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C13_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C13_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C13_TextTmp", cu)
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



# ================= 傘の花（傘をさして歩く・立つ人の小さな群れ 2 種類。+Y が前） =================
UMB = [M(f"C13_Umbrella{k}", h) for k, h in enumerate((0xd8322a, 0x2f6fde, 0xf2c230, 0x3a9a4a, 0xf4f4f0, 0xe84a7a, 0x8a5aa8, 0x1e2028))]
COATS = [M(f"C13_Coat{k}", h) for k, h in enumerate((0x2a3040, 0x6a5a4a, 0x3a4a5a, 0x8a8e94, 0x5a3a3a))]


def umbrella_person(p, x, y, coat, umb, tilt):
    person(p, x, y, coat, arms=False)
    p.tube((x + 0.21, y, 1.42), (x + 0.1, y + 0.2, 1.3), 0.045, mat=coat)
    top = Vector((x + 0.08 + tilt, y + 0.2, 2.15))
    p.tube((x + 0.1, y + 0.2, 1.25), top, 0.012, mat=DARK, seg=4)  # 柄
    n = 8
    for k in range(n):  # 8 枚の布（少し丸い）
        a0, a1 = k * math.tau / n, (k + 1) * math.tau / n
        r = 0.55
        e0 = top + Vector((math.cos(a0) * r, math.sin(a0) * r, -0.25))
        e1 = top + Vector((math.cos(a1) * r, math.sin(a1) * r, -0.25))
        p.face([top + Vector((0, 0, 0.04)), e0, e1], umb)
        p.face([top + Vector((0, 0, 0.04)), e1, e0], umb)


for g in range(2):
    r = random.Random(40 + g)
    p = Part()
    for k in range(5):
        x, y = r.uniform(-1.6, 1.6), r.uniform(-1.6, 1.6)
        umbrella_person(p, x, y, COATS[(k + g) % len(COATS)], UMB[(k * 3 + g) % len(UMB)], r.uniform(-0.08, 0.08))
    p.finish(f"C13_UmbrellaGroup{g}")

# ================= ライトアップの投光器（地面に置く小さな灯。光の筋は別：ゲームで足し算で重ねる。+Y が壁の方） =================
p = Part()
p.box(-0.2, 0.2, -0.2, 0.2, 0, 0.18, DARK)
p.box(-0.16, 0.16, 0.0, 0.21, 0.18, 0.4, METAL)
p.box(-0.13, 0.13, 0.21, 0.22, 0.21, 0.37, M("Light_Uplight", 0xfff0c8, emit=True))
p.finish("C13_Uplight")
p = Part()  # 光の筋（投光器から壁を上へ広がる。高さ 1 ＝ ゲームで建物の高さに伸ばす。白い光で、ゲームで色を付ける）
BEAM = M("Light_Beam", 0xffffff, emit=True)
p.face([(-0.15, 0.25, 0.35), (0.15, 0.25, 0.35), (2.2, 1.2, 1.0), (-2.2, 1.2, 1.0)], BEAM)
p.face([(0.15, 0.25, 0.35), (-0.15, 0.25, 0.35), (-2.2, 1.2, 1.0), (2.2, 1.2, 1.0)], BEAM)
p.finish("C13_UpBeam")

# ================= イルミネーションのアーチ 1 つ（幅 5m・高さ 4.4m。電球が並ぶ） =================
p = Part()
ARCH_BULB = [M("Light_ArchBulbW", 0xfff2c8, emit=True), M("Light_ArchBulbB", 0x8ac8ff, emit=True)]
N = 26
pts = [Vector((math.cos(math.pi * k / N) * 2.5, 0, 2.2 + math.sin(math.pi * k / N) * 2.2)) for k in range(N + 1)]
for a, b in zip(pts, pts[1:]):
    p.tube(a, b, 0.025, mat=DARK, seg=4)
for s in (-1, 1):
    p.tube((s * 2.5, 0, 0), (s * 2.5, 0, 2.2), 0.04, mat=DARK, seg=5)
for k, q in enumerate(pts):
    p.ellipsoid(q + Vector((0, 0.04, 0)), 0.06, 0.06, 0.06, ARCH_BULB[k % 2], seg=5, rows=3)
for s in (-1, 1):
    for k in range(6):
        p.ellipsoid((s * 2.5, 0.05, 0.3 + k * 0.36), 0.06, 0.06, 0.06, ARCH_BULB[k % 2], seg=5, rows=3)
p.finish("C13_LightArch")

# ================= 屋形船の夜の灯（屋根のまわりの提灯の列・明るい窓・水面に映る光。屋形船 BT_Yakata に重ねる） =================
p = Part()
LAN13 = M("Light_YakataLantern", 0xff5a3a, emit=True)
WIN13 = M("Light_YakataWindow", 0xffd890, emit=True)
for yy in [k * 0.9 - 4.5 for k in range(11)]:
    for x in (-2.05, 2.05):
        p.ellipsoid((x, yy, 2.35), 0.14, 0.14, 0.2, LAN13, seg=8, rows=5)
for x in (-1.83, 1.83):  # 窓（もとの窓の少し外）
    s = 1 if x > 0 else -1
    q = [(x, -4.4, 1.45), (x, 3.9, 1.45), (x, 3.9, 2.15), (x, -4.4, 2.15)]
    p.face(q if s > 0 else q[::-1], WIN13)
p.finish("C13_YakataNight")
p = Part()  # 水面に映る光（船のまわりの、ゆらぐ光の帯。ゲームで足し算で重ねる）
REF = M("Light_Reflect", 0xffb060, emit=True)
for s in (-1, 1):
    for k in range(5):
        y0 = -4 + k * 2
        p.face([(s * 2.4, y0, 0.02), (s * (2.4 + 3.5), y0 + 0.3, 0.02), (s * (2.4 + 3.5), y0 + 0.8, 0.02), (s * 2.4, y0 + 1.1, 0.02)][:: s], REF)
p.finish("C13_YakataReflect")

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
gm = bpy.data.meshes.new("C13_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C13_PreviewGroundMat"))
gp = bpy.data.objects.new("C13_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C13_Sun", bpy.data.lights.new("C13_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C13_Camera", bpy.data.cameras.new("C13_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C13_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city13_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
