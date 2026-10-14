# 交差点の信号機を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-signal.py -- <保存先の .blend>
#
# ゲーム（src/render3d.js の syncSignals）では区間の信号ぜんぶを部品ごとに 1 つの InstancedMesh で描くので、部品を別々の物にする。
# 寸法と置き方はゲームの信号機と同じ（m）。Blender の X はゲームの x（道を横切る向き）、-Y はゲームの z（道の向き）、Z は高さ。
#   SG_Pole     柱（道の左端に立つ。原点は柱の根元）と、柱に付いた歩行者用の信号の箱（道の向き +X を向く）・腕の支え
#   SG_Arm      腕（X の向きの長さ 1 の管。原点は真ん中。ゲームで道幅に合わせて伸ばす）
#   SG_Head     車用の信号の箱（原点は箱の真ん中。道の上の高さ 5.05m に置く）。薄い箱と、灯ごとの庇（前後どちらにも）・腕への金具
#   SG_Lamp     車用の灯 1 つ（原点は灯の真ん中。箱を前後に突き抜ける短い円柱。ゲームで左から青・黄・赤の位置に置き、色を付ける）
#   SG_PedStop  歩行者用の赤の灯（立ち止まる人の形）、SG_PedGo 青の灯（歩く人の形）。原点は柱の根元（SG_Pole と同じ）
# 灯の材質の名前は「Light」で始める（ゲームでは灯ごとに今の色を付ける）。ほかの部品の色は材質の色をそのまま使う。
# 書き出すものはコレクション「SG_Export」、下見用の地面・カメラ・光と組み立てた信号機は「SG_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("signal.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

POLE_H, ARM_Y, BOX_Y, LAMP_GAP = 5.6, 5.45, 5.05, 0.5  # src/render3d.js の SIG と同じ
BOX_W, BOX_H, BOX_D = 1.65, 0.52, 0.22  # 車用の信号の箱（幅・高さ・厚さ）
LAMP_R = 0.15
PED_X = 0.12  # 歩行者用の箱の柱側の面（柱の中心から +X へ）
PED_Z = (2.3, 3.1)  # 歩行者用の箱の下と上


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 3.0
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {
    "pole": material("SG_PoleMat", srgb(0x7a808b), rough=0.4, metal=0.5),
    "housing": material("SG_Housing", srgb(0x8d939c), rough=0.5, metal=0.2),  # 薄型の信号の箱（灰色）
    "face": material("SG_Face", srgb(0x16181c), rough=0.6),  # 灯のまわりの黒い板
    "lamp": material("Light_Lamp", (1, 1, 1), emit=(1, 1, 1)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SG_Export")
preview_col = bpy.data.collections.new("SG_Preview")
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

    def hood(self, cx, cz, y0, y1, r, mat, seg=8):
        """灯の上半分をおおう庇（y0〜y1 に突き出す半分の筒）"""
        pts = [(cx + math.cos(math.pi * k / seg) * r, cz + math.sin(math.pi * k / seg) * r) for k in range(seg + 1)]
        for (xa, za), (xb, zb) in zip(pts, pts[1:]):
            self.face([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], mat)

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


# ---- 柱・支え・歩行者用の信号の箱 ----
p = Part()
p.tube((0, 0, 0), (0, 0, POLE_H), 0.12, 0.09, seg=10)
p.tube((0, 0, POLE_H), (0, 0, POLE_H + 0.06), 0.1, 0.04, seg=10)  # 柱の頭
p.box(-0.22, 0.22, -0.22, 0.22, 0, 0.05, "pole")  # 根元の板
p.tube((0, 0, 0.05), (0, 0, 0.6), 0.15, 0.13, seg=10)  # 根元の太い部分
p.tube((0.0, 0, ARM_Y - 0.75), (0.95, 0, ARM_Y - 0.02), 0.04)  # 腕の支え
# 歩行者用の信号：柱に金具で付けた縦長の箱（+X を向く）。灯の部分は黒い板と庇
x0, x1 = PED_X, PED_X + 0.24
z0, z1 = PED_Z
p.box(0.05, x0, -0.04, 0.04, z0 + 0.15, z0 + 0.25, "pole")
p.box(0.05, x0, -0.04, 0.04, z1 - 0.25, z1 - 0.15, "pole")
p.box(x0, x1, -0.2, 0.2, z0, z1, "housing")
for zc in (z1 - 0.2, z0 + 0.2):
    p.face([(x1 + 0.002, -0.17, zc - 0.17), (x1 + 0.002, 0.17, zc - 0.17), (x1 + 0.002, 0.17, zc + 0.17), (x1 + 0.002, -0.17, zc + 0.17)], "face")
    p.face([(x1, -0.19, zc + 0.19), (x1, 0.19, zc + 0.19), (x1 + 0.14, 0.19, zc + 0.17), (x1 + 0.14, -0.19, zc + 0.17)], "housing")  # 庇
    for s in (-1, 1):
        p.face([(x1, s * 0.19, zc - 0.05), (x1, s * 0.19, zc + 0.19), (x1 + 0.14, s * 0.19, zc + 0.17), (x1 + 0.1, s * 0.19, zc - 0.05)], "housing")
pole = p.finish("SG_Pole")

# ---- 腕（長さ 1） ----
a = Part()
a.tube((-0.5, 0, 0), (0.5, 0, 0), 0.065, seg=8)
arm = a.finish("SG_Arm")

# ---- 車用の信号の箱（薄型）・庇・金具 ----
h = Part()
hw, hh, hd = BOX_W / 2, BOX_H / 2, BOX_D / 2
# 角を落とした箱（前から見て八角形に近い形）
c = 0.08
outline = [(-hw + c, -hh), (hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c)]
F = [Vector((x, -hd, z)) for x, z in outline]
B = [Vector((x, hd, z)) for x, z in outline]
for k in range(len(outline)):
    h.face([F[k], F[(k + 1) % 8], B[(k + 1) % 8], B[k]], "housing")
for y in (-hd - 0.002, hd + 0.002):  # 前後の黒い板
    pts = [Vector((x * 0.96, y, z * 0.9)) for x, z in outline]
    h.face(pts if y > 0 else pts[::-1], "face")
for y in (-hd, hd):
    pts = [Vector((x, y, z)) for x, z in outline]
    h.face(pts if y > 0 else pts[::-1], "housing")
for k in range(3):  # 灯ごとの庇（前後）
    cx = (k - 1) * LAMP_GAP
    h.hood(cx, 0, -hd, -hd - 0.16, LAMP_R + 0.035, "housing")
    h.hood(cx, 0, hd, hd + 0.16, LAMP_R + 0.035, "housing")
for x in (-0.45, 0.45):  # 腕への金具
    h.box(x - 0.03, x + 0.03, -0.03, 0.03, hh, ARM_Y - BOX_Y, "pole")
h.box(-0.5, 0.5, -0.04, 0.04, ARM_Y - BOX_Y - 0.03, ARM_Y - BOX_Y + 0.03, "pole")
head = h.finish("SG_Head")

# ---- 車用の灯（前後の面に出る短い円柱） ----
l = Part()
l.tube((0, -hd - 0.012, 0), (0, hd + 0.012, 0), LAMP_R, mat="lamp", seg=16)
lamp = l.finish("SG_Lamp")


# ---- 歩行者用の灯：人の形（+X の面に貼る、少し浮かせた板）。原点は柱の根元 ----
def figure(part, zc, walking):
    x = PED_X + 0.24 + 0.006

    def rect(y0, y1, z0, z1):
        part.face([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], "lamp")

    def limb(ya, za, yb, zb, w):
        d = Vector((yb - ya, zb - za)).normalized()
        n = Vector((-d.y, d.x)) * (w / 2)
        part.face([(x, ya + n.x, za + n.y), (x, yb + n.x, zb + n.y), (x, yb - n.x, zb - n.y), (x, ya - n.x, za - n.y)], "lamp")

    head = [(x, math.cos(2 * math.pi * k / 10) * 0.028, zc + 0.115 + math.sin(2 * math.pi * k / 10) * 0.028) for k in range(10)]
    part.face(head, "lamp")
    rect(-0.03, 0.03, zc - 0.02, zc + 0.08)  # 胴体
    if walking:  # 歩く人：手足を前後に開く
        limb(0.0, zc - 0.015, 0.06, zc - 0.13, 0.03)
        limb(0.0, zc - 0.015, -0.055, zc - 0.13, 0.03)
        limb(0.0, zc + 0.065, 0.06, zc - 0.0, 0.024)
        limb(0.0, zc + 0.065, -0.055, zc + 0.0, 0.024)
    else:  # 立ち止まる人：手足をそろえる
        rect(-0.03, -0.004, zc - 0.13, zc - 0.015)
        rect(0.004, 0.03, zc - 0.13, zc - 0.015)
        rect(-0.045, -0.03, zc - 0.02, zc + 0.07)
        rect(0.03, 0.045, zc - 0.02, zc + 0.07)


s_ = Part()
figure(s_, PED_Z[1] - 0.2, False)
ped_stop = s_.finish("SG_PedStop")
g_ = Part()
figure(g_, PED_Z[0] + 0.2, True)
ped_go = g_.finish("SG_PedGo")

parts = [pole, arm, head, lamp, ped_stop, ped_go]

# ---- 下見用：幅 14m の道に置いた信号機（灯は赤、歩行者は青） ----
reach = 7.6


def place(src, mat4, color=None):
    ob = src.copy()
    if color:
        ob.data = src.data.copy()
        ob.data.materials[MI["lamp"]] = material(f"SG_PreviewLamp_{len(preview_col.objects)}", color, emit=color)
    ob.matrix_world = mat4
    preview_col.objects.link(ob)


T = Matrix.Translation
place(pole, T((-reach, 0, 0)))
place(arm, T((-reach / 2, 0, ARM_Y)) @ Matrix.Diagonal((reach, 1, 1, 1)))
place(head, T((0, 0, BOX_Y)))
for k, col in enumerate([(0.02, 0.1, 0.08), (0.12, 0.09, 0.02), (1.0, 0.08, 0.08)]):  # 左から青・黄・赤（赤が点灯）
    place(lamp, T(((k - 1) * LAMP_GAP, 0, BOX_Y)), col)
place(ped_stop, T((-reach, 0, 0)), (0.12, 0.02, 0.02))
place(ped_go, T((-reach, 0, 0)), (0.05, 0.9, 0.6))
for ob in parts:
    ob.hide_render = True
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=12)
gm = bpy.data.meshes.new("SG_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SG_PreviewGroundMat", (0.25, 0.26, 0.28)))
preview_col.objects.link(bpy.data.objects.new("SG_PreviewGround", gm))
sun = bpy.data.objects.new("SG_Sun", bpy.data.lights.new("SG_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-130))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SG_Camera", bpy.data.cameras.new("SG_Camera"))
cam.data.lens = 40
preview_col.objects.link(cam)
cam.location = (3.5, -9.0, 3.6)
cam.rotation_euler = (Vector((-3.0, 0, 4.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SG_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1400, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "signal_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
