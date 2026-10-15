# 街の物 その 5：スタートの演出（旗を振る人・3・2・1 の灯の柱）と、駅の入口を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city4.py -- <保存先の .blend>
#
# 原点はどれも物の根元（地面）。+X が道の側（見せる側）、Z が高さ（m）。書き出すものは「C4_Export」。
#   C4_Starter     旗を振る人の体（右腕のない形。+X を向く）、C4_StarterArm  右腕と白黒の旗（原点は右肩。ゲームで振る）
#   C4_LampPole    灯の柱（3・2・1 の赤い灯 3 つと、GO の緑の灯 1 つの箱）、C4_Lamp1〜3 赤い灯、C4_LampGo 緑の灯（ゲームで点ける）
#   C4_Entrance    駅の入口（柱・屋根・ガラスの扉・駅名の板の枠。駅名の板の絵はゲームで貼る：
#                  板は +X の面の X=0.42、Y -2.3〜2.3、Z 3.3〜4.1）
# 光る部品の材質の名前は「Light」で始める。下見用は「C4_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city4.blend")
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
    "skin": C("C4_Skin", 0xe0b896, rough=0.7), "hair": C("C4_Hair", 0x231c18), "shirt": C("C4_Shirt", 0xd8382f), "pants": C("C4_Pants", 0x1f2228),
    "cap": C("C4_Cap", 0xf2f2ee), "shoe": C("C4_Shoe", 0x2b2c31), "pole": C("C4_Pole", 0x6b6f74, rough=0.4, metal=0.6), "black": C("C4_Black", 0x17181b),
    "white": C("C4_White", 0xf2f2ee), "dark": C("C4_Dark", 0x2a2d33), "glass": C("C4_Glass", 0x4a6a86, rough=0.1, metal=0.3),
    "roof": C("C4_Roof", 0x9aa4ae, rough=0.4, metal=0.4), "tile": C("C4_Tile", 0xc8c4bc, rough=0.9), "green": C("C4_Green", 0x2a9a4a),
    "red": material("Light_LampRed", srgb(0xff3030), emit=srgb(0xff3030)), "go": material("Light_LampGreen", srgb(0x30ff70), emit=srgb(0x30ff70)),
    "inside": material("Light_Inside", srgb(0xfff2d8), emit=srgb(0xfff2d8)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("C4_Export")
preview_col = bpy.data.collections.new("C4_Preview")
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

    def tube(self, a, b, r0, r1=None, mat="pole", seg=6, caps=True):
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

    def disc_x(self, x, y, z, r, mat, seg=14):
        self.face([(x, y + math.cos(2 * math.pi * k / seg) * r, z + math.sin(2 * math.pi * k / seg) * r) for k in range(seg)], mat)

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


# ---- 旗を振る人（+X を向く。右腕は別） ----
SH = (0.0, -0.21, 1.42)  # 右肩（+X を向いた人の右は -Y）
p = Part()
for y in (-0.1, 0.1):
    p.tube((0, y, 0.84), (0, y, 0.06), 0.07, 0.055, mat="pants")
    p.ellipsoid((0.05, y, 0.04), 0.11, 0.05, 0.04, "shoe", seg=6, rows=3)
p.ellipsoid((0, 0, 1.16), 0.12, 0.19, 0.33, "shirt")
p.ellipsoid((0.01, 0, 1.6), 0.11, 0.1, 0.12, "skin")
p.ellipsoid((0.0, 0, 1.68), 0.12, 0.11, 0.07, "cap", rows=3)
p.box(0.05, 0.2, -0.08, 0.08, 1.66, 1.68, "cap")  # 帽子のつば
p.tube((0, 0.21, 1.42), (0.05, 0.25, 1.0), 0.045, mat="shirt")  # 左腕（下ろす）
p.finish("C4_Starter")
p = Part()  # 右腕と旗（原点は肩）
p.tube((0, 0, 0), (0.1, 0.0, 0.5), 0.045, mat="shirt")
p.tube((0.1, 0.0, 0.5), (0.12, 0.0, 1.3), 0.015, mat="pole")
for i in range(4):  # 白黒の市松の旗
    for j in range(3):
        y0, z0 = -0.05 - i * 0.15, 0.85 + j * 0.15
        pts = [(0.12, y0, z0), (0.12, y0 - 0.15, z0), (0.12, y0 - 0.15, z0 + 0.15), (0.12, y0, z0 + 0.15)]
        m = "black" if (i + j) % 2 else "white"
        p.face(pts, m)
        p.face(pts[::-1], m)
p.finish("C4_StarterArm")

# ---- 3・2・1 の灯の柱 ----
p = Part()
p.box(-0.3, 0.3, -0.3, 0.3, 0.0, 0.15, "dark")
p.tube((0, 0, 0.15), (0, 0, 3.0), 0.08)
p.box(-0.12, 0.12, -0.35, 0.35, 3.0, 5.4, "black")
for z in (5.0, 4.45, 3.9, 3.35):
    p.tube((0.12, 0, z), (0.3, 0, z), 0.2, 0.22, mat="black", seg=10, caps=False)
p.finish("C4_LampPole")
for name, z, mat in (("C4_Lamp1", 5.0, "red"), ("C4_Lamp2", 4.45, "red"), ("C4_Lamp3", 3.9, "red"), ("C4_LampGo", 3.35, "go")):
    p = Part()
    p.disc_x(0.125, 0, z, 0.19, mat)
    p.finish(name)

# ---- 駅の入口（柱・屋根・ガラスの扉と明るい中・駅名の板の枠・足もとのタイル） ----
p = Part()
p.box(-3.0, 0.45, -3.2, 3.2, 0.0, 0.05, "tile")
for y in (-2.8, 2.8):
    p.box(-0.2, 0.2, y - 0.2, y + 0.2, 0.05, 3.2, "white")
p.box(-3.0, 1.4, -3.4, 3.4, 4.2, 4.45, "roof")  # 屋根（前へ張り出す）
p.box(-0.1, 0.4, -2.6, 2.6, 3.2, 4.2, "dark")  # 駅名の板の枠
p.box(-2.8, -2.6, -2.6, 2.6, 0.05, 3.2, "inside")  # 奥の明るい中
for k in range(4):  # ガラスの扉
    y0 = -2.4 + k * 1.2
    p.box(-0.06, 0.0, y0 + 0.05, y0 + 1.15, 0.05, 2.9, "glass")
p.box(-0.08, 0.02, -2.6, 2.6, 2.9, 3.2, "white")
p.box(0.0, 0.42, -2.6, 2.6, 4.12, 4.2, "green")  # 板の上の緑の帯
p.finish("C4_Entrance")

# ---- 下見用 ----
for ob in objs:
    ob.hide_render = True
spots = {"C4_Starter": (0, 0, 0), "C4_StarterArm": SH, "C4_LampPole": (0, 3, 0), "C4_Lamp1": (0, 3, 0), "C4_Lamp2": (0, 3, 0), "C4_Lamp3": (0, 3, 0), "C4_LampGo": (0, 3, 0), "C4_Entrance": (0, 10, 0)}
for ob in objs:
    pv = ob.copy()
    pv.location = spots[ob.name]
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=30)
gm = bpy.data.meshes.new("C4_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("C4_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("C4_PreviewGround", gm))
sun = bpy.data.objects.new("C4_Sun", bpy.data.lights.new("C4_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(60))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C4_Camera", bpy.data.cameras.new("C4_Camera"))
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (12, 2, 5)
cam.rotation_euler = (Vector((0, 5, 2.2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C4_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1400, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "city4_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
