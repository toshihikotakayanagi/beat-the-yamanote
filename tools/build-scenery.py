# 線路のまわり（線路の柵・信号機）、川と橋（橋の欄干・船）、空を飛ぶ物（飛行機・ヘリコプター・鳥）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-scenery.py -- <保存先の .blend>
#
# 原点はどれも物の根元（地面・水面）か、回したり動かしたりする軸。Z が高さ（m）。
#   RF_Fence      線路の柵 1m 分（Y の向きに伸ばす。+X が線路の側）
#   RS_Signal     線路の信号機の柱と灯の箱（+X が電車の来る側）、RS_Lamp 青く灯る灯
#   BR_Rail       橋の欄干 1m 分（Y の向きに伸ばす。+X が道の外）
#   BT_Boat       小さな船、BT_Yakata 屋形船（提灯は光る）。+Y が船首
#   SK_Plane      旅客機（+Y が前。長さ約 40m）、SK_Heli ヘリコプターの胴体、SK_Rotor 回る羽根（原点は羽根の軸）
#   BD_Body       鳥の胴体（+Y が前）、BD_WingL・BD_WingR 翼（原点は付け根。ゲームで羽ばたかせる）。鳥は白く作り、ゲームで色を付ける
# 光る部品の材質の名前は「Light」で始める。書き出すものはコレクション「SC_Export」、下見用は「SC_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("scenery.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


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
    "concrete": C("SC_Concrete", 0x9a9c98, rough=0.9),
    "mesh": C("SC_FenceMesh", 0x6f8a7a, rough=0.6, metal=0.3),
    "pole": C("SC_Pole", 0x7a808b, rough=0.4, metal=0.5),
    "black": C("SC_Black", 0x17181b),
    "rail": C("SC_BridgeRail", 0x4f6d5e, rough=0.5, metal=0.4),
    "white": C("SC_White", 0xf2f2ee),
    "hull": C("SC_Hull", 0xe8e8e2),
    "blue": C("SC_Blue", 0x1f4fa8),
    "wood": C("SC_Wood", 0x7a5a3a, rough=0.8),
    "roofred": C("SC_RoofRed", 0x8a2a24, rough=0.7),
    "glass": C("SC_Glass", 0x1c2733, rough=0.1, metal=0.3),
    "gray": C("SC_Gray", 0xb8bcc2, rough=0.4, metal=0.3),
    "red": C("SC_Red", 0xc8282d),
    "bird": C("SC_Bird", 0xffffff, rough=0.8),
    "beak": C("SC_Beak", 0x3a3a3a),
    "lamp": material("Light_SignalGreen", srgb(0x3cff9a), emit=srgb(0x3cff9a)),
    "lantern": material("Light_Lantern", srgb(0xff6a3a), emit=srgb(0xff6a3a)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SC_Export")
preview_col = bpy.data.collections.new("SC_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


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

    def tube(self, a, b, r0, r1=None, mat="pole", seg=8, caps=True):
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

    def loft_y(self, sections, mats, seg=10):
        """Y の向きに並ぶ断面（y, 中心 z, 幅の半分, 高さの半分）をつないだ胴体"""
        rings = [[Vector((math.cos(2 * math.pi * k / seg) * rx, y, zc + math.sin(2 * math.pi * k / seg) * rz)) for k in range(seg)] for y, zc, rx, rz in sections]
        if isinstance(mats, str):
            mats = [mats] * (len(rings) - 1)
        for (A, B), m in zip(zip(rings, rings[1:]), mats):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], m)
        self.face(rings[0], mats[0])
        self.face(rings[-1][::-1], mats[-1])

    def wing(self, root, tip_dx, chord_root, chord_tip, sweep, mat, thick=0.1, z=0.0):
        """+X（tip_dx が負なら -X）へ伸びる平たい翼"""
        x0, y0 = root
        xt = x0 + tip_dx
        pts = [(x0, y0 + chord_root / 2), (xt, y0 - sweep + chord_tip / 2), (xt, y0 - sweep - chord_tip / 2), (x0, y0 - chord_root / 2)]
        top = [(x, y, z + thick / 2) for x, y in pts]
        bot = [(x, y, z - thick / 2) for x, y in pts]
        self.face(top if tip_dx > 0 else top[::-1], mat)
        self.face(bot[::-1] if tip_dx > 0 else bot, mat)
        for k in range(4):
            self.face([top[k], bot[k], bot[(k + 1) % 4], top[(k + 1) % 4]], mat)

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        export_col.objects.link(ob)
        return ob


objs = []
done = lambda p, name: objs.append(p.finish(name))

# ---- 線路の柵（コンクリートの柱と金網）1m 分 ----
p = Part()
p.box(-0.06, 0.06, -0.06, 0.06, 0.0, 1.8, "concrete")
p.box(-0.04, 0.04, -0.5, 0.5, 0.0, 0.25, "concrete")
for x in (-0.005, 0.005):
    p.face([(x, -0.5, 0.25), (x, 0.5, 0.25), (x, 0.5, 1.75), (x, -0.5, 1.75)][:: 1 if x > 0 else -1], "mesh")
p.box(-0.02, 0.02, -0.5, 0.5, 1.75, 1.8, "pole")
done(p, "RF_Fence")

# ---- 線路の信号機（柱・灯の箱・背の板）と、青く灯る灯 ----
p = Part()
p.tube((0, 0, 0), (0, 0, 4.6), 0.08, mat="pole")
p.box(-0.15, 0.15, -0.15, 0.15, 0.0, 0.3, "concrete")
p.box(0.05, 0.25, -0.3, 0.3, 3.0, 4.4, "black")  # 灯の箱（縦に 3 つ）
p.box(0.0, 0.05, -0.55, 0.55, 2.85, 4.55, "black")  # 背の板
for z in (3.25, 3.7, 4.15):
    p.tube((0.25, 0, z), (0.42, 0, z), 0.14, 0.15, mat="black", seg=10, caps=False)  # 庇
done(p, "RS_Signal")
p = Part()
p.face([(0.26, math.cos(2 * math.pi * k / 12) * 0.11, 3.25 + math.sin(2 * math.pi * k / 12) * 0.11) for k in range(12)], "lamp")
done(p, "RS_Lamp")

# ---- 橋の欄干 1m 分（柱・上の手すり・縦の棒） ----
p = Part()
p.box(-0.08, 0.08, -0.08, 0.08, 0.0, 1.15, "rail")
p.box(-0.07, 0.07, -0.5, 0.5, 1.05, 1.15, "rail")
p.box(-0.05, 0.05, -0.5, 0.5, 0.0, 0.2, "concrete")
for k in range(1, 6):
    y = -0.5 + k / 6
    p.box(-0.015, 0.015, y - 0.015, y + 0.015, 0.2, 1.05, "rail")
done(p, "BR_Rail")

# ---- 船：小さな船と屋形船 ----
p = Part()
p.loft_y([(-2.8, 0.35, 0.9, 0.35), (-1.0, 0.3, 1.05, 0.4), (1.5, 0.3, 0.95, 0.4), (2.8, 0.5, 0.15, 0.25)], "hull")
p.box(-0.7, 0.7, -1.5, 0.3, 0.6, 1.6, "white")
p.box(-0.71, 0.71, -0.6, 0.25, 1.0, 1.4, "glass")
p.box(-1.02, 1.02, -2.5, 2.3, 0.45, 0.55, "blue")
done(p, "BT_Boat")
p = Part()
p.loft_y([(-6.5, 0.4, 1.7, 0.4), (-4.0, 0.35, 2.0, 0.45), (4.0, 0.35, 2.0, 0.45), (6.5, 0.6, 0.6, 0.3)], "wood")
p.box(-1.8, 1.8, -5.0, 4.5, 0.7, 2.6, "white")
for x in (-1.81, 1.81):  # 窓の列
    p.face([(x, -4.5, 1.4), (x, 4.0, 1.4), (x, 4.0, 2.2), (x, -4.5, 2.2)][:: 1 if x > 0 else -1], "glass")
for yy in range(-4, 5, 2):  # 提灯の列
    for x in (-1.9, 1.9):
        p.box(x - 0.1, x + 0.1, yy - 0.1, yy + 0.1, 2.45, 2.7, "lantern")
p.box(-2.0, 2.0, -5.2, 4.7, 2.6, 2.75, "roofred")  # 屋根
p.box(-1.4, 1.4, -4.6, 4.1, 2.75, 3.2, "roofred")
done(p, "BT_Yakata")

# ---- 旅客機（白い胴体・翼・青い尾翼。長さ約 40m） ----
p = Part()
p.loft_y([(-19, 3.6, 0.3, 0.4), (-15, 3.0, 1.6, 1.7), (12, 3.0, 2.0, 2.0), (17, 2.8, 1.5, 1.4), (20, 2.6, 0.3, 0.3)], "white", seg=10)
for s in (1, -1):
    p.wing((s * 1.6, 1.0), s * 16.0, 7.0, 2.0, 7.0, "gray", thick=0.4, z=2.0)  # 主翼
    p.wing((s * 1.0, -16.0), s * 6.0, 3.5, 1.4, 2.5, "gray", thick=0.2, z=3.4)  # 水平尾翼
    p.tube((s * 6.5, 0.8, 1.2), (s * 6.5, 4.0, 1.2), 0.9, 0.9, mat="gray", seg=8)  # エンジン
p.face([(0, -14, 3.8), (0, -19.5, 3.8), (0, -19.5, 10.5), (0, -16.5, 10.5)], "blue")  # 垂直尾翼
p.face([(0.01, -14, 3.8), (0.01, -16.5, 10.5), (0.01, -19.5, 10.5), (0.01, -19.5, 3.8)], "blue")
done(p, "SK_Plane")

# ---- ヘリコプター（胴体と回る羽根） ----
p = Part()
p.loft_y([(-1.8, 1.4, 0.6, 0.6), (0.0, 1.5, 0.95, 0.95), (1.6, 1.4, 0.8, 0.8), (2.4, 1.3, 0.3, 0.4)], ["red", "red", "glass"], seg=10)
p.tube((0, -1.6, 1.6), (0, -6.5, 2.0), 0.3, 0.12, mat="red", seg=6)  # 尾
p.face([(0, -6.2, 1.6), (0, -6.8, 1.6), (0, -6.9, 3.0), (0, -6.5, 3.0)], "red")
for x in (-0.8, 0.8):  # そり
    p.tube((x, -1.5, 0.05), (x, 1.8, 0.05), 0.06, mat="pole", seg=5)
    p.tube((x, -0.8, 0.05), (x * 0.7, -0.8, 0.8), 0.04, mat="pole", seg=4)
    p.tube((x, 0.9, 0.05), (x * 0.7, 0.9, 0.8), 0.04, mat="pole", seg=4)
p.tube((0, 0.2, 2.4), (0, 0.2, 2.9), 0.12, mat="pole", seg=6)
done(p, "SK_Heli")
p = Part()  # 羽根（原点は軸。ゲームで Z（glb では y）まわりに回す）
p.box(-0.15, 0.15, -5.0, 5.0, -0.03, 0.03, "black")
p.box(-5.0, 5.0, -0.15, 0.15, -0.03, 0.03, "black")
done(p, "SK_Rotor")

# ---- 鳥（胴体と、付け根で羽ばたく翼。長さ約 0.45m） ----
p = Part()
p.loft_y([(-0.22, 0.0, 0.02, 0.02), (-0.12, 0.0, 0.06, 0.05), (0.06, 0.01, 0.07, 0.07), (0.15, 0.04, 0.05, 0.05), (0.2, 0.04, 0.02, 0.02)], "bird", seg=8)
p.face([(0.0, -0.18, 0.0), (0.09, -0.34, 0.0), (-0.09, -0.34, 0.0)], "bird")  # しっぽ
p.tube((0, 0.2, 0.04), (0, 0.26, 0.03), 0.015, 0.002, mat="beak", seg=4)
done(p, "BD_Body")
for name, s in (("BD_WingR", 1), ("BD_WingL", -1)):
    p = Part()
    p.wing((0, 0.02), s * 0.36, 0.16, 0.06, 0.08, "bird", thick=0.01)
    done(p, name)

# ---- 下見用（並べる） ----
for ob in objs:
    ob.hide_render = True
spots = {"RF_Fence": (-12, -6, 0), "RS_Signal": (-8, -6, 0), "RS_Lamp": (-8, -6, 0), "BR_Rail": (-4, -6, 0), "BT_Boat": (2, -6, 0), "BT_Yakata": (10, -6, 0),
         "SK_Plane": (0, 30, 0), "SK_Heli": (-14, 10, 0), "SK_Rotor": (-14, 10.2, 2.9), "BD_Body": (6, 8, 2), "BD_WingL": (6, 8, 2), "BD_WingR": (6, 8, 2)}
for ob in objs:
    pv = ob.copy()
    pv.location = spots[ob.name]
    if ob.name.startswith("BD_"):
        pv.scale = (6, 6, 6)
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=60)
gm = bpy.data.meshes.new("SC_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SC_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("SC_PreviewGround", gm))
sun = bpy.data.objects.new("SC_Sun", bpy.data.lights.new("SC_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(40))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SC_Camera", bpy.data.cameras.new("SC_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (30, -40, 22)
cam.rotation_euler = (Vector((0, 8, 2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SC_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "scenery_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
