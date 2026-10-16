# 街の物 その 15：鳩に餌をやる人・公園の太極拳・ビルの屋上のビアガーデン・冬の霜を、ゲーム向けに軽く Blender で組み立てる
# （白い息はゲームで出す）
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city14.py -- <保存先の .blend>
#
# Z が高さ（m）、+Y が前（glb では -z）。原点はどれも物の根元。書き出すものは「C14_Export」。
#   C14_PigeonFeeder（ベンチで鳩に餌をやる人と鳩 8 羽）・C14_TaichiA/B（太極拳の 6 人。2 つの型をゲームで切り替える）・
#   C14_BeerGarden（屋上のビアガーデン 12m × 8m）・C14_Frost（地面の霜の模様 1 枚）
# 光る部品の材質の名前は「Light」で始める。下見用は「C14_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city14.blend")
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


export_col = bpy.data.collections.new("C14_Export")
preview_col = bpy.data.collections.new("C14_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []

# よく使う材質
SKIN, HAIR, SHOE, PANTS = M("C14_Skin", 0xe0b896), M("C14_Hair", 0x231c18), M("C14_Shoe", 0x2b2c31), M("C14_Pants", 0x2a3040)
WHITE, BLACK, DARK = M("C14_White", 0xf2f2ee), M("C14_Black", 0x17181b), M("C14_Dark", 0x2a2d33)
WOOD, RED, METAL = M("C14_Wood", 0x8a6440), M("C14_Red", 0xd8322a), M("C14_Metal", 0x9aa0a8, rough=0.35, metal=0.6)
GLASS = M("C14_Glass", 0x3a5a78, rough=0.1, metal=0.3)


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
        cu = bpy.data.curves.new("C14_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C14_TextTmp", cu)
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



# ================= 鳩に餌をやる人（ベンチに座る人と、まわりの鳩 8 羽。+Y が前） =================
PIG14, PIGW14, PIGN14 = M("C14_Pigeon", 0x8a909c), M("C14_PigeonWing", 0x6c7280), M("C14_PigeonNeck", 0x4f7a6a)


def pigeon(p, x, y, a, peck):
    c = Vector((x, y, 0))
    f = Vector((math.sin(a), math.cos(a), 0))
    r = Vector((f.y, -f.x, 0))
    p.ellipsoid(c + Vector((0, 0, 0.12)), 0.07, 0.07, 0.075, PIG14, seg=7, rows=4)
    for s in (-1, 1):
        q = c + r * (s * 0.05) + Vector((0, 0, 0.13))
        p.ellipsoid(q, 0.03, 0.03, 0.05, PIGW14, seg=5, rows=3)
    head = c + f * (0.1 if not peck else 0.14) + Vector((0, 0, 0.21 if not peck else 0.06))
    p.ellipsoid(head, 0.04, 0.04, 0.04, PIGN14, seg=6, rows=3)


p = Part()
p.box(-0.9, 0.9, -0.2, 0.2, 0.42, 0.47, WOOD)  # ベンチ
p.box(-0.9, 0.9, -0.22, -0.18, 0.5, 0.85, WOOD)
for x in (-0.75, 0.75):
    p.box(x - 0.04, x + 0.04, -0.2, 0.2, 0, 0.42, METAL)
COAT14 = M("C14_Coat", 0x6a5a4a)
p.ellipsoid((0, -0.02, 0.85), 0.18, 0.12, 0.3, COAT14)
p.ellipsoid((0, 0.0, 1.27), 0.1, 0.11, 0.12, SKIN)
p.ellipsoid((0, -0.01, 1.35), 0.11, 0.12, 0.06, M("C14_Hat", 0x3a3e46), rows=3)  # 帽子
for s in (-1, 1):
    p.tube((s * 0.09, 0.0, 0.5), (s * 0.09, 0.42, 0.5), 0.065, mat=PANTS)
    p.tube((s * 0.09, 0.42, 0.5), (s * 0.09, 0.45, 0.06), 0.052, mat=PANTS)
p.tube((0.18, 0, 1.08), (0.35, 0.45, 0.95), 0.042, mat=COAT14)  # 餌をまく手
p.tube((-0.18, 0, 1.08), (-0.1, 0.25, 0.8), 0.042, mat=COAT14)
p.box(-0.18, -0.02, 0.2, 0.35, 0.72, 0.84, M("C14_FeedBag", 0xe8d8b0))  # 餌の袋
r = random.Random(14)
for k in range(8):  # まわりの鳩（餌をついばむ・見上げる）
    a = r.uniform(-1.2, 1.2)
    d = r.uniform(0.8, 2.0)
    pigeon(p, math.sin(a) * d, 0.4 + math.cos(a) * d, math.pi + a + r.uniform(-0.5, 0.5), k % 2 == 0)
for k in range(30):  # まいた餌
    sx, sy = r.uniform(-1.2, 1.2), r.uniform(0.6, 2.2)
    p.box(sx - 0.01, sx + 0.01, sy - 0.01, sy + 0.01, 0.0, 0.01, M("C14_Seed", 0xe0c890))
p.finish("C14_PigeonFeeder")

# ================= 太極拳の人たち（6 人。2 つの型：腕を前に流す・片足で構える。+Y が前） =================
TAI = [M(f"C14_TaiShirt{k}", h) for k, h in enumerate((0xf4f4f0, 0xd8322a, 0xf4f4f0, 0x2f6fde, 0xf4f4f0, 0x3a9a4a))]


def taichi(name, pose):
    p = Part()
    for k in range(6):
        x, y = (k % 3) * 1.6 - 1.6, (k // 3) * 1.6 - 0.8
        sh = TAI[k]
        if pose == 0:  # 両足で立ち、両腕を前に
            for s in (-1, 1):
                p.tube((x + s * 0.12, y, 0.84), (x + s * 0.18, y + 0.05, 0.06), 0.065, 0.05, mat=PANTS)
            p.ellipsoid((x, y, 1.16), 0.18, 0.12, 0.32, sh)
            for s in (-1, 1):
                p.tube((x + s * 0.2, y, 1.4), (x + s * 0.3, y + 0.4, 1.25), 0.045, mat=sh)
                p.ellipsoid((x + s * 0.31, y + 0.45, 1.24), 0.045, 0.03, 0.05, SKIN, seg=5, rows=3)
        else:  # 片足を上げ、片腕を上へ
            p.tube((x - 0.1, y, 0.84), (x - 0.1, y, 0.06), 0.065, 0.05, mat=PANTS)
            p.tube((x + 0.1, y, 0.84), (x + 0.15, y + 0.35, 0.6), 0.065, mat=PANTS)
            p.tube((x + 0.15, y + 0.35, 0.6), (x + 0.15, y + 0.2, 0.3), 0.05, mat=PANTS)
            p.ellipsoid((x, y, 1.16), 0.18, 0.12, 0.32, sh)
            p.tube((x + 0.2, y, 1.4), (x + 0.35, y + 0.1, 1.85), 0.045, mat=sh)
            p.tube((x - 0.2, y, 1.4), (x - 0.45, y + 0.25, 1.1), 0.045, mat=sh)
        p.ellipsoid((x, y + 0.01, 1.6), 0.1, 0.11, 0.12, SKIN)
        p.ellipsoid((x, y - 0.01, 1.66), 0.105, 0.115, 0.08, M("C14_Gray", 0xc8c8c8) if k % 2 else HAIR, rows=3)
    return p.finish(name)


taichi("C14_TaichiA", 0)
taichi("C14_TaichiB", 1)

# ================= ビルの屋上のビアガーデン（12m × 8m。テーブルと客・提灯の線・柵。+Y が道の側） =================
p = Part()
FENCE14 = M("C14_Fence", 0xd8dce2, metal=0.4)
for (x0, y0), (x1, y1) in (((-6, -4), (6, -4)), ((6, -4), (6, 4)), ((6, 4), (-6, 4)), ((-6, 4), (-6, -4))):
    p.tube((x0, y0, 1.1), (x1, y1, 1.1), 0.03, mat=FENCE14, seg=5)
    n = int(math.hypot(x1 - x0, y1 - y0) / 1.5)
    for k in range(n + 1):
        t = k / n
        p.tube((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1.1), 0.025, mat=FENCE14, seg=4)
p.box(-6, 6, -4, 4, 0, 0.04, M("C14_Deck", 0x8a6a48))
LAMP14 = [M("Light_BeerLamp0", 0xff7a3a, emit=True), M("Light_BeerLamp1", 0xfff0a0, emit=True)]
for (x0, y0), (x1, y1) in (((-6, -4), (6, 4)), ((-6, 4), (6, -4))):  # 交差する提灯の線（ポールの上から）
    for k in range(17):
        t = k / 16
        x, y, z = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 3.2 - 0.6 * math.sin(math.pi * t)
        if k < 16:
            t2 = (k + 1) / 16
            p.tube((x, y, z), (x0 + (x1 - x0) * t2, y0 + (y1 - y0) * t2, 3.2 - 0.6 * math.sin(math.pi * t2)), 0.008, mat=DARK, seg=3)
        if 0 < k < 16:
            p.ellipsoid((x, y, z - 0.18), 0.1, 0.1, 0.13, LAMP14[k % 2], seg=6, rows=4)
for x, y in ((-6, -4), (6, 4), (-6, 4), (6, -4)):
    p.tube((x, y, 0), (x, y, 3.25), 0.05, mat=METAL, seg=6)
SHIRTS14 = [M(f"C14_Guest{k}", h) for k, h in enumerate((0x3a5a8a, 0xf4f4f0, 0x8a5a3a, 0xd84a5a, 0x4a8a5a, 0x2a2d33))]
r = random.Random(7)
for t in range(6):
    tx, ty = -4 + (t % 3) * 4, -1.8 + (t // 3) * 3.6
    p.tube((tx, ty, 0), (tx, ty, 0.72), 0.04, mat=METAL, seg=6)
    p.tube((tx, ty, 0.72), (tx, ty, 0.76), 0.6, mat=WHITE, seg=12)  # 丸いテーブル
    for j in range(3):  # ジョッキ
        a = j * 2.1 + t
        p.tube((tx + math.cos(a) * 0.3, ty + math.sin(a) * 0.3, 0.76), (tx + math.cos(a) * 0.3, ty + math.sin(a) * 0.3, 0.92), 0.04, 0.045, mat=M("C14_Beer", 0xf2b830), seg=6)
        p.ellipsoid((tx + math.cos(a) * 0.3, ty + math.sin(a) * 0.3, 0.93), 0.045, 0.045, 0.025, WHITE, seg=6, rows=2)
    for j in range(4):  # 座る客
        a = j * math.pi / 2 + 0.4
        cx, cy = tx + math.cos(a) * 0.95, ty + math.sin(a) * 0.95
        sh = SHIRTS14[(t * 4 + j) % len(SHIRTS14)]
        p.box(cx - 0.18, cx + 0.18, cy - 0.18, cy + 0.18, 0, 0.45, METAL)  # いす
        p.ellipsoid((cx, cy, 0.85), 0.17, 0.17, 0.3, sh)
        p.ellipsoid((cx, cy, 1.27), 0.1, 0.1, 0.12, SKIN)
        p.ellipsoid((cx, cy, 1.33), 0.105, 0.105, 0.08, HAIR, rows=3)
        if j % 2 == 0:  # 乾杯する腕
            p.tube((cx, cy, 1.05), (cx + (tx - cx) * 0.4, cy + (ty - cy) * 0.4, 1.35), 0.04, mat=sh)
p.box(4.0, 5.8, 3.0, 3.9, 0, 1.0, M("C14_Counter", 0x3a2a20))  # 生ビールのカウンター
p.box(4.0, 5.8, 3.85, 3.9, 1.0, 1.6, M("Light_BeerSign", 0xf2c230, emit=True))
p.text("BEER", 0.4, (4.9, 3.905, 1.3), -X, Z, M("C14_BeerText", 0x8a2a1a))
p.finish("C14_BeerGarden")

# ================= 霜（地面の白い薄い模様 1 枚。半径 1.5m。ゲームで散らす） =================
p = Part()
FROST = M("C14_Frost", 0xe8f0f8, rough=0.95)
r = random.Random(3)
for k in range(9):
    cx, cy = r.uniform(-1, 1), r.uniform(-1, 1)
    rr = r.uniform(0.3, 0.7)
    pts = [(cx + math.cos(a) * rr * r.uniform(0.7, 1.1), cy + math.sin(a) * rr * r.uniform(0.7, 1.1), 0.0) for a in [j * math.tau / 9 for j in range(9)]]
    p.face(pts, FROST)
p.finish("C14_Frost")

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
gm = bpy.data.meshes.new("C14_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(bpy.data.materials.new("C14_PreviewGroundMat"))
gp = bpy.data.objects.new("C14_PreviewGround", gm)
gp.location = (30, 0, 0)
preview_col.objects.link(gp)
sun = bpy.data.objects.new("C14_Sun", bpy.data.lights.new("C14_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C14_Camera", bpy.data.cameras.new("C14_Camera"))
cam.data.lens = 22
preview_col.objects.link(cam)
cam.location = (x / 2, -42, 26)
cam.rotation_euler = (Vector((x / 2, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C14_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city14_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
