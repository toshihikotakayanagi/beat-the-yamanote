# 街の物 その 4：ホームで電車を待つ人、道路の路面の物（「止まれ」の字・自転車の通る所の印・マンホール・点字ブロック）、
# 止まって作業するゴミの収集車と宅配の車、駅前の屋根付きの自転車置き場を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city3.py -- <保存先の .blend>
#
# 原点はどれも物の根元（地面・ホームの上）。Z が高さ（m）。書き出すものは「C3_Export」。
#   C3_Stand0〜3  立って待つ人（色違い 4 通り。+Y が前）、C3_Bench  ベンチに座る 2 人
#   C3_Tomare     路面の「止まれ」の白い字（地面に寝た字。字の上は +Y、+X へ読む）
#   C3_BikeMark   自転車の通る所の青い矢印と白い自転車の印（矢印は +Y の向き）
#   C3_Manhole    マンホールのふた、C3_Tactile  点字ブロック 1m 分（Y の向きに伸ばす）
#   C3_Garbage    ゴミの収集車と作業する人（+Y が前。左側（-X）に人とゴミ袋）、C3_Delivery  宅配の車と荷物を運ぶ人
#   C3_BikePark   屋根付きの自転車置き場（長さ 14m・2 列。+X が道の側）
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city3.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # BIZ UDゴシック Bold（SIL Open Font License。字の形だけをモデルに入れる）
font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


C = lambda name, h, **kw: material(name, srgb(h), **kw)
MAT = {
    "skin": C("C3_Skin", 0xe0b896, rough=0.7), "hair": C("C3_Hair", 0x231c18), "shoe": C("C3_Shoe", 0x2b2c31),
    "c0": C("C3_Cloth0", 0x2a3142), "c1": C("C3_Cloth1", 0xb8c2cc), "c2": C("C3_Cloth2", 0xc94f4f), "c3": C("C3_Cloth3", 0x4f7fc9),
    "c4": C("C3_Cloth4", 0xe0b84a), "c5": C("C3_Cloth5", 0x3c3f46), "p0": C("C3_Pants0", 0x1f2228), "p1": C("C3_Pants1", 0x3b4a63),
    "bag": C("C3_Bag", 0x30353d), "paint": C("C3_RoadWhite", 0xeeeeea, rough=0.9), "blue": C("C3_RoadBlue", 0x2f6fd0, rough=0.9),
    "iron": C("C3_Iron", 0x4a4a4c, rough=0.6, metal=0.5), "tactile": C("C3_Tactile", 0xe8c020, rough=0.8),
    "white": C("C3_White", 0xf0f0ec), "green": C("C3_Green", 0x2a8a5a), "dark": C("C3_Dark", 0x2a2d33), "glass": C("C3_Glass", 0x1c2733, rough=0.1),
    "tire": C("C3_Tire", 0x101114, rough=0.9), "steel": C("C3_Steel", 0x8a9098, rough=0.4, metal=0.6), "brown": C("C3_Box", 0xb08a5a),
    "trash": C("C3_Trash", 0x6a8a6a), "wood": C("C3_Wood", 0x7a5a3a), "roof": C("C3_Roof", 0x9aa4ae, rough=0.4, metal=0.4),
    "head": material("Light_Head", srgb(0xfff4d0), emit=srgb(0xfff4d0)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("C3_Export")
preview_col = bpy.data.collections.new("C3_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
objs = []


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (3, 7, 6, 2), (0, 1, 5, 4), (0, 4, 7, 3), (1, 2, 6, 5)):
            self.face([v[i] for i in q], mat)

    def tube(self, a, b, r0, r1=None, mat="steel", seg=6, caps=True):
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
            self.face(A[::-1], mat)
            self.face(B, mat)

    def ellipsoid(self, c, rx, ry, rz, mat, seg=8, rows=5):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def flat(self, pts, z, mat):
        self.face([(x, y, z) for x, y in pts], mat)

    def disc(self, cx, cy, z, r, mat, seg=16):
        self.flat([(cx + math.cos(2 * math.pi * k / seg) * r, cy + math.sin(2 * math.pi * k / seg) * r) for k in range(seg)], z, mat)

    def text_flat(self, body, size, center, mat):
        """地面に寝た字（字の上は +Y、+X へ読む）"""
        cu = bpy.data.curves.new("C3_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = 2
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C3_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        for poly in me.polygons:
            self.face([(center[0] + me.vertices[i].co.x, center[1] + me.vertices[i].co.y * 2.2, center[2]) for i in poly.vertices], mat)  # 路面の字は縦に長い
        ob.to_mesh_clear()
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)

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


def person(p, x, y, cloth, pants, sit=False, bag=False, phone=False, rot=0.0):
    """立つ（sit なら座る）人。+Y が前"""
    cs, sn = math.cos(rot), math.sin(rot)
    T = lambda a, b, c: (x + a * cs - b * sn, y + a * sn + b * cs, c)
    hip = 0.45 if sit else 0.84
    if sit:
        for s in (-1, 1):
            p.tube(T(s * 0.1, 0, hip), T(s * 0.1, 0.42, hip), 0.07, mat=pants)
            p.tube(T(s * 0.1, 0.42, hip), T(s * 0.1, 0.45, 0.05), 0.055, mat=pants)
            p.ellipsoid(T(s * 0.1, 0.5, 0.04), 0.05, 0.1, 0.04, "shoe", seg=6, rows=3)
    else:
        for s in (-1, 1):
            p.tube(T(s * 0.1, 0, hip), T(s * 0.1, 0.0, 0.06), 0.07, 0.05, mat=pants)
            p.ellipsoid(T(s * 0.1, 0.05, 0.04), 0.05, 0.11, 0.04, "shoe", seg=6, rows=3)
    p.ellipsoid(T(0, 0, hip + 0.32), 0.19, 0.12, 0.33, cloth)  # 胴体
    p.ellipsoid(T(0, 0.01, hip + 0.76), 0.1, 0.11, 0.12, "skin")  # 頭
    p.ellipsoid(T(0, -0.01, hip + 0.8), 0.105, 0.115, 0.1, "hair", rows=3)
    for s in (-1, 1):
        if phone and s > 0:
            p.tube(T(s * 0.21, 0, hip + 0.55), T(s * 0.12, 0.25, hip + 0.4), 0.045, mat=cloth)
            p.box(*sorted((T(0.04, 0.27, 0)[0], T(0.12, 0.29, 0)[0])), *sorted((T(0.04, 0.27, 0)[1], T(0.12, 0.29, 0)[1])), hip + 0.42, hip + 0.55, "dark")
        else:
            p.tube(T(s * 0.21, 0, hip + 0.55), T(s * 0.23, 0.05 if sit else 0, hip + (0.15 if not sit else 0.2)), 0.045, mat=cloth)
    if bag:
        p.ellipsoid(T(0.0, -0.18, hip + 0.35), 0.15, 0.08, 0.2, "bag", seg=6, rows=3)


# ================= ホームで待つ人 =================
for i, (cloth, pants, bag, phone) in enumerate((("c0", "p0", True, True), ("c1", "p1", False, False), ("c2", "p0", True, False), ("c3", "p1", False, True))):
    p = Part()
    person(p, 0, 0, cloth, pants, bag=bag, phone=phone)
    p.finish(f"C3_Stand{i}")
p = Part()  # ベンチに座る 2 人
p.box(-0.9, 0.9, -0.25, 0.25, 0.4, 0.45, "wood")
p.box(-0.9, 0.9, -0.28, -0.24, 0.45, 0.85, "wood")
for x in (-0.75, 0.75):
    p.box(x - 0.03, x + 0.03, -0.2, 0.2, 0.0, 0.4, "steel")
person(p, -0.4, -0.05, "c4", "p1", sit=True)
person(p, 0.4, -0.05, "c5", "p0", sit=True, phone=True)
p.finish("C3_Bench")

# ================= 道路の路面の物 =================
p = Part()  # 「止まれ」（地面に寝た白い字）
p.text_flat("止まれ", 0.9, (0, 0, 0.0), "paint")
p.finish("C3_Tomare")
p = Part()  # 自転車の通る所の印（青い矢印と白い自転車）
p.flat([(-0.35, -1.2), (0.35, -1.2), (0.35, 0.3), (0.65, 0.3), (0.0, 1.2), (-0.65, 0.3), (-0.35, 0.3)], 0.0, "blue")
for cy in (-0.75, -0.15):  # 車輪（輪）
    for k in range(10):
        a, b = 2 * math.pi * k / 10, 2 * math.pi * (k + 1) / 10
        p.flat([(math.cos(a) * 0.22, cy + math.sin(a) * 0.22), (math.cos(a) * 0.17, cy + math.sin(a) * 0.17), (math.cos(b) * 0.17, cy + math.sin(b) * 0.17), (math.cos(b) * 0.22, cy + math.sin(b) * 0.22)], 0.002, "paint")
p.flat([(-0.03, -0.75), (0.03, -0.75), (0.03, -0.15), (-0.03, -0.15)], 0.002, "paint")
p.finish("C3_BikeMark")
p = Part()  # マンホールのふた
p.disc(0, 0, 0.0, 0.32, "iron", seg=16)
for r in (0.26, 0.16):
    for k in range(16):
        a, b = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
        p.flat([(math.cos(a) * r, math.sin(a) * r), (math.cos(a) * (r - 0.02), math.sin(a) * (r - 0.02)), (math.cos(b) * (r - 0.02), math.sin(b) * (r - 0.02)), (math.cos(b) * r, math.sin(b) * r)], 0.002, "dark")
p.finish("C3_Manhole")
p = Part()  # 点字ブロック 1m 分（幅 0.3m の黄色い帯と、点の並び）
p.flat([(-0.15, -0.5), (0.15, -0.5), (0.15, 0.5), (-0.15, 0.5)], 0.0, "tactile")
for k in range(3):
    x = -0.1 + k * 0.1
    p.box(x - 0.012, x + 0.012, -0.48, 0.48, 0.0, 0.012, "tactile")
p.finish("C3_Tactile")


# ================= 止まって作業する車 =================
def truck_body(p, L, W, cab, cab_mat, box_mat, z_top):
    hl, hw = L / 2, W / 2
    p.box(-hw, hw, hl - cab, hl, 0.4, 2.2, cab_mat)  # 運転台
    p.box(-hw + 0.05, hw - 0.05, hl - 0.02, hl + 0.01, 1.3, 2.05, "glass")
    for s in (-1, 1):
        p.box(s * (hw - 0.02) - 0.01, s * (hw - 0.02) + 0.01, hl - cab + 0.25, hl - 0.25, 1.3, 2.0, "glass")
        for y in (hl - 0.7, -hl + 1.0):
            p.tube((s * (hw - 0.1) - 0.13, y, 0.4), (s * (hw - 0.1) + 0.13, y, 0.4), 0.4, mat="tire", seg=10)
    p.box(-hw + 0.3, hw - 0.3, -hl, hl - cab, 0.4, 0.8, "dark")
    for s in (-1, 1):
        p.box(s * (hw - 0.35) - 0.12, s * (hw - 0.35) + 0.12, hl, hl + 0.03, 0.75, 0.9, "head")
    p.box(-hw, hw, -hl, hl - cab - 0.1, 0.8, z_top, box_mat)


p = Part()  # ゴミの収集車（白い車体に緑の帯、後ろの投入口）と作業する人・ゴミ袋
truck_body(p, 6.0, 2.0, 1.7, "white", "white", 2.5)
for s in (-1, 1):
    p.box(s * 1.005 - 0.005, s * 1.005 + 0.005, -3.0, 1.2, 1.2, 1.5, "green")
p.box(-0.9, 0.9, -3.4, -3.0, 0.6, 2.2, "dark")  # 後ろの投入口
person(p, -1.0, -3.9, "c3", "p0", rot=math.pi)
for x, y in ((-1.5, -3.5), (-1.7, -3.2), (-1.4, -3.0)):
    p.ellipsoid((x, y, 0.22), 0.22, 0.22, 0.24, "trash", seg=6, rows=4)
p.finish("C3_Garbage")
p = Part()  # 宅配の車（白い箱の車）と、台車で荷物を運ぶ人
truck_body(p, 5.0, 1.9, 1.5, "white", "white", 2.6)
p.box(-0.95, 0.95, -2.52, -2.5, 1.0, 2.5, "dark")
person(p, -1.6, 0.2, "c5", "p1")
p.box(-1.75, -1.45, 0.45, 0.75, 0.9, 1.2, "brown")  # 持っている箱
p.box(-2.2, -1.6, -0.8, -0.2, 0.05, 0.1, "steel")  # 台車
p.tube((-1.9, -0.8, 0.1), (-1.9, -0.85, 1.0), 0.02, mat="steel")
for z in (0.1, 0.45):
    p.box(-2.15, -1.65, -0.75, -0.25, z, z + 0.35, "brown")
p.finish("C3_Delivery")

# ================= 駅前の屋根付きの自転車置き場 =================
p = Part()
L = 14.0
for y in (-L / 2 + 0.3, 0.0, L / 2 - 0.3):
    p.tube((-1.8, y, 0), (-1.8, y, 2.4), 0.05, mat="steel")
    p.tube((1.8, y, 0), (1.8, y, 2.2), 0.05, mat="steel")
p.face([(-2.2, -L / 2, 2.45), (2.2, -L / 2, 2.2), (2.2, L / 2, 2.2), (-2.2, L / 2, 2.45)], "roof")
p.face([(-2.2, L / 2, 2.45), (2.2, L / 2, 2.2), (2.2, -L / 2, 2.2), (-2.2, -L / 2, 2.45)], "roof")
COLS = ["c2", "c3", "c1", "c5", "c4", "c0", "green"]
for row, x in ((0, -1.0), (1, 1.0)):
    for k in range(22):
        y = -L / 2 + 0.6 + k * 0.6
        col = COLS[(k * 3 + row) % len(COLS)]
        # 横から見た自転車（+X の向きに前）を、細い管で
        for cx in (x - 0.5, x + 0.5):
            for kk in range(8):
                a, b = 2 * math.pi * kk / 8, 2 * math.pi * (kk + 1) / 8
                p.tube((cx + math.cos(a) * 0.3, y, 0.31 + math.sin(a) * 0.3), (cx + math.cos(b) * 0.3, y, 0.31 + math.sin(b) * 0.3), 0.018, mat="tire", seg=3, caps=False)
        for a, b in (((x - 0.5, 0.31), (x - 0.05, 0.33)), ((x - 0.05, 0.33), (x + 0.35, 0.72)), ((x - 0.05, 0.33), (x - 0.15, 0.78)), ((x - 0.15, 0.78), (x + 0.35, 0.72)), ((x + 0.5, 0.31), (x + 0.38, 0.88))):
            p.tube((a[0], y, a[1]), (b[0], y, b[1]), 0.016, mat=col, seg=3)
p.finish("C3_BikePark")

# ================= 下見用 =================
for ob in objs:
    ob.hide_render = True
x = -16
for ob in objs:
    pv = ob.copy()
    pv.location = (x, 0, 0)
    x += 3 if ob.name.startswith(("C3_Stand", "C3_Manhole", "C3_Tactile")) else 6
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=80)
gm = bpy.data.meshes.new("C3_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("C3_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("C3_PreviewGround", gm))
sun = bpy.data.objects.new("C3_Sun", bpy.data.lights.new("C3_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C3_Camera", bpy.data.cameras.new("C3_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (16, -22, 14)
cam.rotation_euler = (Vector((16, 4, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C3_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city3_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
