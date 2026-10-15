# 歩行者の体の部品を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-pedestrian.py -- <保存先の .blend>
#
# ゲーム（src/render3d.js の drawCrowd）では、歩行者ぜんぶを部品ごとに 1 つの InstancedMesh にまとめ、部品ごとに 1 人ずつ色を付ける
# （服・ズボン・肌・髪の色）。なので部品は白く作り、色を変えたくない所（目・口）だけ暗い色にする（色はかけ算になる）。
# 背の高さ 1.0 のときの寸法（m。約 1.65m）。原点はゲームで部品を置く点：
#   PD_Head    頭と首（原点は頭の真ん中。高さ 1.56m）。目・眉・口と鼻・耳
#   PD_Hair    髪（頭と同じ原点）
#   PD_Torso   胴体（原点は胴体の真ん中。腰 0.84m から肩 1.44m）、PD_Hips 腰まわり（ズボンの色。胴体と同じ原点）
#   PD_Leg     脚 1 本（原点は股の付け根。下へ 0.82m）、PD_Shoe 靴（脚と同じ原点）
#   PD_Arm     腕 1 本（原点は肩。下へ 0.56m）、PD_Hand 手（腕と同じ原点）
#   PD_Canopy  傘の布（原点は布の真ん中）、PD_Stick 傘の柄（原点は柄の真ん中。長さ 0.95m）
# Blender の +Y が前（glb では -z、ゲームの歩行者の前）、X は左右、Z は高さ。
# 書き出すものはコレクション「PD_Export」、下見用の地面・カメラ・光と組み立てた人は「PD_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("pedestrian.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


MAT = {
    "base": material("PD_Base", (1, 1, 1)),  # ゲームで部品ごとの色をかける
    "shade": material("PD_Shade", (0.72, 0.72, 0.72)),  # 少し暗く（襟・袖口・靴底・ベルト）
    "dark": material("PD_Dark", (0.05, 0.05, 0.06)),  # 目・眉
    "mouth": material("PD_Mouth", (0.45, 0.25, 0.25)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("PD_Export")
preview_col = bpy.data.collections.new("PD_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat="base"):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def loft(self, rings, mats="base", caps=(True, True)):
        n = len(rings[0])
        if isinstance(mats, str):
            mats = [mats] * (len(rings) - 1)
        for (A, B), m in zip(zip(rings, rings[1:]), mats):
            for k in range(n):
                self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], m)
        if caps[0]:
            self.face(rings[0][::-1], mats[0])
        if caps[1]:
            self.face(rings[-1], mats[-1])

    def ellipsoid(self, c, rx, ry, rz, mat="base", seg=12, rows=8, z_from=0.0, z_to=1.0):
        """だ円の球（z_from〜z_to は上からの割合で、その範囲だけ作る）"""
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        ts = [math.pi * (z_from + (z_to - z_from) * i / rows) for i in range(rows + 1)]
        R = [ring(t) for t in ts]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

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


def ring(cx, cy, z, rx, ry, n=10, rot=0.0):
    return [Vector((cx + math.cos(rot + 2 * math.pi * k / n) * rx, cy + math.sin(rot + 2 * math.pi * k / n) * ry, z)) for k in range(n)]


# ---- 頭と首（原点は頭の真ん中） ----
p = Part()
p.ellipsoid((0, 0, 0), 0.105, 0.115, 0.125, seg=12, rows=8)
p.loft([ring(0, -0.01, -0.2, 0.05, 0.05, 8), ring(0, -0.01, -0.08, 0.05, 0.05, 8)], caps=(True, False))  # 首
p.loft([ring(0, 0.112, -0.01, 0.015, 0.012, 6), ring(0, 0.128, -0.03, 0.012, 0.012, 6)])  # 鼻
for s in (-1, 1):
    p.ellipsoid((s * 0.105, -0.01, 0.0), 0.015, 0.025, 0.035, seg=6, rows=4)  # 耳
    x = s * 0.04
    y = 0.103
    p.face([(x - 0.015, y, 0.02), (x + 0.015, y, 0.02), (x + 0.015, y, 0.04), (x - 0.015, y, 0.04)][:: s], "dark")  # 目
    p.face([(x - 0.022, y - 0.004, 0.058), (x + 0.022, y - 0.004, 0.058), (x + 0.022, y - 0.004, 0.066), (x - 0.022, y - 0.004, 0.066)][:: s], "dark")  # 眉
p.face([(-0.025, 0.104, -0.058), (0.025, 0.104, -0.058), (0.025, 0.104, -0.05), (-0.025, 0.104, -0.05)], "mouth")
head = p.finish("PD_Head")

# ---- 髪（頭の上と後ろをおおう） ----
p = Part()
p.ellipsoid((0, -0.008, 0.012), 0.115, 0.128, 0.13, seg=12, rows=5, z_from=0.0, z_to=0.5)
p.ellipsoid((0, -0.03, -0.01), 0.112, 0.1, 0.12, seg=12, rows=3, z_from=0.5, z_to=0.72)  # 後ろの髪
hair = p.finish("PD_Hair")

# ---- 胴体（原点は胴体の真ん中。下が腰、上が肩） ----
p = Part()
rings_t = [ring(0, 0, -0.3, 0.17, 0.11, 10), ring(0, 0.005, -0.15, 0.16, 0.105, 10), ring(0, 0.01, 0.05, 0.19, 0.12, 10),
           ring(0, 0, 0.2, 0.21, 0.115, 10), ring(0, -0.005, 0.27, 0.19, 0.1, 10), ring(0, -0.01, 0.31, 0.09, 0.07, 10)]
p.loft(rings_t, ["base", "base", "base", "base", "shade"])
torso = p.finish("PD_Torso")
p = Part()  # 腰まわり（ズボン）：胴体の下の端にかぶせる
p.loft([ring(0, 0, -0.34, 0.175, 0.115, 10), ring(0, 0, -0.22, 0.172, 0.113, 10), ring(0, 0.002, -0.19, 0.168, 0.112, 10)], ["base", "shade"])
hips = p.finish("PD_Hips")

# ---- 脚（原点は股の付け根。下へ） ----
p = Part()
p.loft([ring(0, 0, 0.02, 0.075, 0.08, 8), ring(0, 0.005, -0.4, 0.06, 0.065, 8), ring(0, 0, -0.45, 0.055, 0.06, 8),
        ring(0, -0.005, -0.62, 0.05, 0.055, 8), ring(0, 0, -0.78, 0.042, 0.045, 8)])
leg = p.finish("PD_Leg")
p = Part()  # 靴：足首から前へ
sole = [(-0.045, -0.06), (0.045, -0.06), (0.05, 0.08), (0.03, 0.14), (-0.03, 0.14), (-0.05, 0.08)]
A = [Vector((x, y, -0.84)) for x, y in sole]
B = [Vector((x * 0.95, y * 0.9 - 0.005, -0.78)) for x, y in sole]
C = [Vector((x * 0.7, y * 0.5 - 0.02, -0.74)) for x, y in sole]
p.loft([A, B, C], ["shade", "base"])
shoe = p.finish("PD_Shoe")

# ---- 腕（原点は肩。下へ）と手 ----
p = Part()
p.loft([ring(0, 0, 0.04, 0.05, 0.055, 8), ring(0, 0, -0.05, 0.055, 0.058, 8), ring(0, 0.01, -0.28, 0.046, 0.05, 8),
        ring(0, 0.015, -0.5, 0.038, 0.04, 8), ring(0, 0.015, -0.55, 0.04, 0.042, 8)], ["base", "base", "base", "shade"])
arm = p.finish("PD_Arm")
p = Part()
p.ellipsoid((0, 0.018, -0.6), 0.032, 0.045, 0.06, seg=8, rows=5)
hand = p.finish("PD_Hand")

# ---- 傘の布（8 枚の布のふくらみ）と柄 ----
p = Part()
N = 8
R, Hc = 0.62, 0.3
tip = Vector((0, 0, Hc / 2 + 0.06))
for k in range(N):
    a0, a1 = 2 * math.pi * k / N, 2 * math.pi * (k + 1) / N
    am = (a0 + a1) / 2
    e0 = Vector((math.cos(a0) * R, math.sin(a0) * R, -Hc / 2))
    e1 = Vector((math.cos(a1) * R, math.sin(a1) * R, -Hc / 2))
    em = Vector((math.cos(am) * R * 0.9, math.sin(am) * R * 0.9, -Hc / 2 + 0.05))  # 骨のあいだは少し上がる
    top = Vector((0, 0, Hc / 2))
    p.face([top, e0, em], "base")
    p.face([top, em, e1], "base")
p.loft([ring(0, 0, Hc / 2 - 0.01, 0.012, 0.012, 6), [tip] * 6], caps=(False, False))  # 先の石突き
canopy = p.finish("PD_Canopy")
p = Part()
p.loft([ring(0, 0, -0.475, 0.012, 0.012, 6), ring(0, 0, 0.475, 0.012, 0.012, 6)])
p.loft([ring(0, -0.0, -0.475 + 0.01, 0.018, 0.018, 6), ring(0, 0.04, -0.52, 0.016, 0.016, 6), ring(0, 0.08, -0.5, 0.016, 0.016, 6)], caps=(False, True))  # 曲がった持ち手
stick = p.finish("PD_Stick")

parts = [head, hair, torso, hips, leg, shoe, arm, hand, canopy, stick]

# ---- 下見用：ゲームと同じ置き方で、歩く人と傘をさす人（色を付けた材質の写し） ----
HIP, SHOULDER = 0.84, 1.4


def place(src, mat4, color):
    ob = src.copy()
    ob.data = src.data.copy()
    ob.data.materials[MI["base"]] = material(f"PD_PrevBase_{len(preview_col.objects)}", color)
    sh = [c * 0.72 for c in color]
    ob.data.materials[MI["shade"]] = material(f"PD_PrevShade_{len(preview_col.objects)}", sh)
    ob.matrix_world = mat4
    ob.hide_render = False
    preview_col.objects.link(ob)


T = Matrix.Translation
for ob in parts:
    ob.hide_render = True
for n, (base, swing, umbrella, shirt) in enumerate([((-0.5, 0, 0), 0.8, False, (0.15, 0.3, 0.75)), ((0.6, 0.3, 0), -0.5, True, (0.8, 0.25, 0.2))]):
    B = T(base)
    skin, pants, hairc = (0.85, 0.62, 0.45), (0.05, 0.07, 0.12), (0.03, 0.025, 0.02)
    place(leg, B @ T((-0.1, 0, HIP)) @ Matrix.Rotation(-swing * 0.5, 4, 'X'), pants)
    place(shoe, B @ T((-0.1, 0, HIP)) @ Matrix.Rotation(-swing * 0.5, 4, 'X'), (0.1, 0.1, 0.1))
    place(leg, B @ T((0.1, 0, HIP)) @ Matrix.Rotation(swing * 0.5, 4, 'X'), pants)
    place(shoe, B @ T((0.1, 0, HIP)) @ Matrix.Rotation(swing * 0.5, 4, 'X'), (0.1, 0.1, 0.1))
    place(torso, B @ T((0, 0, HIP + 0.3)), shirt)
    place(hips, B @ T((0, 0, HIP + 0.3)), pants)
    for s, sw in ((-1, swing * 0.45), (1, (0.9 if umbrella else -swing * 0.45))):
        place(arm, B @ T((s * 0.25, 0, SHOULDER)) @ Matrix.Rotation(sw, 4, 'X'), shirt)
        place(hand, B @ T((s * 0.25, 0, SHOULDER)) @ Matrix.Rotation(sw, 4, 'X'), skin)
    place(head, B @ T((0, 0, 1.56)), skin)
    place(hair, B @ T((0, 0, 1.56)), hairc)
    if umbrella:
        place(stick, B @ T((0.22, 0.38, 1.52)), (0.2, 0.2, 0.22))
        place(canopy, B @ T((0.12, 0.22, 2.12)), (0.75, 0.1, 0.1))
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=5)
gm = bpy.data.meshes.new("PD_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("PD_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("PD_PreviewGround", gm))
sun = bpy.data.objects.new("PD_Sun", bpy.data.lights.new("PD_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("PD_Camera", bpy.data.cameras.new("PD_Camera"))
cam.data.lens = 50
preview_col.objects.link(cam)
cam.location = (2.2, 4.2, 1.8)
cam.rotation_euler = (Vector((0, 0.1, 1.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("PD_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "pedestrian_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
