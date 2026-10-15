# ゴールの演出：門の梁から下がるくす玉（左右に割れる 2 つの半球）・中から下りるたれ幕・旗を振って応援する人を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-goal.py -- <保存先の .blend>
#
# Z が高さ（m）。+Y がゲームの進む向き（glb では -z）。書き出すものは「GL_Export」。
#   GL_Cord             くす玉を吊るすひも（原点はくす玉のてっぺん。上へ CORD_LEN m）
#   GL_BallL・GL_BallR  くす玉の左・右の半分（原点はてっぺんの蝶番。ゲームで Y 軸（glb では z 軸）まわりに開く）
#   GL_Streamer         たれ幕「祝 ゴール」（原点は上の端。下へ STREAMER_LEN m。ゲームで上から伸ばす）
#   GL_Fan0〜2          応援する人の体（腕のない形。+X を向く。法被の色が 3 通り）
#   GL_FanArm           上げた右腕と小旗（原点は右肩。左腕はゲームで左右を裏返して使う）
# 下見用は「GL_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("goal.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # BIZ UDゴシック Bold（SIL Open Font License。字の形だけをモデルに入れる）
font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None

BALL_R = 0.6  # くす玉の半径（src/render3d.js の GOAL_BALL_R と同じ）
CORD_LEN = 1.6
STREAMER_LEN, STREAMER_W = 2.0, 0.42
SH = (0.0, -0.21, 1.42)  # 応援する人の右肩（+X を向いた人の右は -Y。src/render3d.js の FAN_SHOULDER）


def material(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


C = lambda name, h, **kw: material(name, srgb(h), **kw)
MAT = {
    "gold": C("GL_Gold", 0xf2c230, rough=0.3, metal=0.4), "red": C("GL_Red", 0xd8322a), "white": C("GL_White", 0xf4f2ec),
    "inside": C("GL_Inside", 0xfff6e0), "cord": C("GL_Cord", 0xc8202a), "ink": C("GL_Ink", 0xc01818),
    "skin": C("GL_Skin", 0xe0b896, rough=0.7), "hair": C("GL_Hair", 0x231c18), "pants": C("GL_Pants", 0x1f2228), "shoe": C("GL_Shoe", 0x2b2c31),
    "h0": C("GL_Happi0", 0xd8322a), "h1": C("GL_Happi1", 0x2f5fbf), "h2": C("GL_Happi2", 0x2f9a4a), "band": C("GL_Band", 0xf4f2ec),
    "flag": C("GL_Flag", 0x80c241), "stick": C("GL_Stick", 0x9a7a52),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("GL_Export")
preview_col = bpy.data.collections.new("GL_Preview")
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

    def tube(self, a, b, r0, r1=None, mat="cord", seg=6):
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
        self.face(A[::-1], mat)
        self.face(B, mat)

    def ellipsoid(self, c, rx, ry, rz, mat, seg=8, rows=5):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def text_y(self, body, size, x, y, z, flip, mat):
        """Y 軸に向いた面に立つ字（flip=False は -Y から、True は +Y から読める）。縦書きは 1 字ずつ置く"""
        cu = bpy.data.curves.new("GL_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = 3
        if font:
            cu.font = font
        ob = bpy.data.objects.new("GL_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        s = -1 if flip else 1
        for poly in me.polygons:
            pts = [(x + s * me.vertices[i].co.x, y, z + me.vertices[i].co.y) for i in poly.vertices]
            self.face(pts if not flip else pts[::-1], mat)
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


# ---- ひも（てっぺんの金具から上へ） ----
p = Part()
p.tube((0, 0, 0.02), (0, 0, CORD_LEN), 0.012, mat="cord")
p.ellipsoid((0, 0, 0.03), 0.05, 0.05, 0.035, "gold", seg=8, rows=4)
# 房（くす玉が開いても、ひもの先に残る飾り）
for k in range(6):
    a = 2 * math.pi * k / 6
    p.tube((0, 0, 0.02), (math.cos(a) * 0.06, math.sin(a) * 0.06, -0.08), 0.008, mat="cord", seg=4)
p.finish("GL_Cord")


# ---- くす玉の半分（x の向き side）。外は金と赤の帯、内は白 ----
def half(name, side):
    p = Part()
    seg, rows = 10, 9  # 半分の周りの分け方・上から下への分け方
    c = Vector((0, 0, -BALL_R))
    def pt(i, j, r):
        t = math.pi * i / rows  # 0 がてっぺん
        a = math.pi * j / seg - math.pi / 2  # -90°〜90°（side の向きの半分）
        return c + Vector((side * math.cos(a) * math.sin(t) * r, math.sin(a) * math.sin(t) * r, math.cos(t) * r))
    for i in range(rows):
        for j in range(seg):
            mat = "gold" if (j // 2) % 2 == 0 else "red"
            q = [pt(i, j, BALL_R), pt(i + 1, j, BALL_R), pt(i + 1, j + 1, BALL_R), pt(i, j + 1, BALL_R)]
            p.face(q if side > 0 else q[::-1], mat)
            q = [pt(i, j, BALL_R - 0.015), pt(i + 1, j, BALL_R - 0.015), pt(i + 1, j + 1, BALL_R - 0.015), pt(i, j + 1, BALL_R - 0.015)]
            p.face(q[::-1] if side > 0 else q, "inside")
    # 割れ目のふち（白い帯）
    for i in range(rows):
        a0, a1 = pt(i, 0, BALL_R), pt(i + 1, 0, BALL_R)
        b0, b1 = pt(i, seg, BALL_R), pt(i + 1, seg, BALL_R)
        for u0, u1 in ((a0, a1), (b0, b1)):
            inner0, inner1 = c + (u0 - c) * 0.96, c + (u1 - c) * 0.96
            p.face([u0, u1, inner1, inner0], "white")
    return p.finish(name)


half("GL_BallL", -1)
half("GL_BallR", 1)

# ---- たれ幕「祝 ゴール」（白い布に赤い字。前後どちらからも読める） ----
p = Part()
w, d = STREAMER_W / 2, 0.01
p.box(-w, w, -d, d, -STREAMER_LEN, 0, "white")
p.box(-w - 0.02, w + 0.02, -0.02, 0.02, -0.05, 0, "red")  # 上の棒
p.box(-w - 0.02, w + 0.02, -0.02, 0.02, -STREAMER_LEN - 0.04, -STREAMER_LEN, "red")  # 下のおもり
for k, ch in enumerate("祝ゴール"):
    z = -0.32 - k * 0.42 - (0.08 if k else 0)  # 「祝」とあとの字は少し離す
    for y, flip in ((-d - 0.003, False), (d + 0.003, True)):
        p.text_y(ch, 0.34, 0, y, z, flip, "ink")
p.finish("GL_Streamer")

# ---- 応援する人（法被・はちまき。右腕は別） ----
for n in range(3):
    p = Part()
    for y in (-0.1, 0.1):
        p.tube((0, y, 0.84), (0, y, 0.06), 0.07, 0.055, mat="pants")
        p.ellipsoid((0.05, y, 0.04), 0.11, 0.05, 0.04, "shoe", seg=6, rows=3)
    p.ellipsoid((0, 0, 1.16), 0.13, 0.2, 0.34, f"h{n}")  # 法被
    p.box(0.1, 0.135, -0.03, 0.03, 0.85, 1.45, "band")  # 法被の前の白い線
    p.box(-0.02, 0.02, -0.2, 0.2, 0.9, 0.95, "band")  # 帯
    p.ellipsoid((0.01, 0, 1.6), 0.11, 0.1, 0.12, "skin")
    p.ellipsoid((-0.005, 0, 1.65), 0.115, 0.105, 0.08, "hair", rows=3)
    p.tube((0.005, 0, 1.62), (0.005, 0, 1.67), 0.118, mat="band", seg=10)  # はちまき
    p.tube((-0.11, 0.0, 1.64), (-0.2, 0.04, 1.58), 0.015, mat="band", seg=4)  # はちまきの結び目
    p.tube((0, 0.21, 1.42), (0.12, 0.3, 1.86), 0.045, mat=f"h{n}")  # 左腕の付け根（腕はゲームで足す）
    p.finish(f"GL_Fan{n}")
p = Part()  # 右腕と小旗（原点は肩。まっすぐ上へ上げた形）
p.tube((0, 0, 0), (0.03, 0, 0.3), 0.048, mat="h0")
p.tube((0.03, 0, 0.3), (0.06, 0, 0.58), 0.04, mat="skin")
p.ellipsoid((0.065, 0, 0.62), 0.045, 0.04, 0.05, "skin", seg=6, rows=3)
p.tube((0.065, 0, 0.55), (0.08, 0, 1.0), 0.01, mat="stick", seg=4)
p.box(0.075, 0.085, 0.0, 0.32, 0.76, 0.98, "flag")  # 小旗（山手線の黄緑。外へなびく）
p.finish("GL_FanArm")

# ---- 下見 ----
for ob in objs:
    ob.hide_render = True
spots = {"GL_Cord": (0, 0, 3.0), "GL_BallL": (-0.4, 0, 3.0), "GL_BallR": (0.4, 0, 3.0), "GL_Streamer": (1.6, 0, 3.0),
         "GL_Fan0": (0, -3, 0), "GL_Fan1": (0, -1.5, 0), "GL_Fan2": (0, -4.5, 0), "GL_FanArm": (0, -1.5 + SH[1], SH[2])}
for ob in objs:
    pv = ob.copy()
    pv.location = spots[ob.name]
    pv.hide_render = False
    preview_col.objects.link(pv)
for name, ang in (("GL_BallL", 1.9), ("GL_BallR", -1.9)):  # 開いたくす玉も見せる
    pv = bpy.data.objects[name].copy()
    pv.location = (3.4, 0, 3.0)
    pv.rotation_euler = (0, ang, 0)
    pv.hide_render = False
    preview_col.objects.link(pv)
for name, loc in (("GL_Cord", (3.4, 0, 3.0)), ("GL_Streamer", (3.4, 0, 3.0))):
    pv = bpy.data.objects[name].copy()
    pv.location = loc
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=20)
gm = bpy.data.meshes.new("GL_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("GL_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("GL_PreviewGround", gm))
sun = bpy.data.objects.new("GL_Sun", bpy.data.lights.new("GL_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(60))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("GL_Camera", bpy.data.cameras.new("GL_Camera"))
cam.data.lens = 30
preview_col.objects.link(cam)
cam.location = (5.5, -10, 3.2)
cam.rotation_euler = (Vector((1.2, -1.5, 2.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("GL_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1400, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "goal_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
