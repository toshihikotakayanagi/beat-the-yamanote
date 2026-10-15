# 道ばたの物（街灯・自動販売機・電柱・ガードパイプ・バス停）と、スタート・ゴールの門を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-street.py -- <保存先の .blend>
#
# ゲーム（src/render3d.js）では、区間の物ぜんぶを種類ごとに 1 つの InstancedMesh で描く。原点は物の根元（地面）。
# 向きはどれも、Blender の +X が道路の側（ゲームのローカルの +x）、Y が道に沿う向き、Z が高さ（m）。
#   SL_Pole       街灯の柱・腕・灯具（高さ 6.8m。腕は +X へ 1.9m）、SL_Lens 灯具の下の光る面
#   VM_Body       飲み物の自動販売機（道路の側が前）、VM_Light 前の光る面（商品の見本の段・ボタン）
#   UP_Pole       コンクリートの電柱（高さ 12m。道を横切る腕金と碍子・変圧器・足場ボルト。電線はゲームで柱どうしを結ぶ）
#   GR_Pipe       白いガードパイプ 4m 分（原点は真ん中。Y の向きに並べる）
#   BS_Sign       バス停の標識（丸い板と時刻表）、BS_Shelter 屋根とベンチ（道路の反対側に背の板）
#   GT_Post       門の柱 1 本、GT_Beam 門の横の梁（X の向きの長さ 1。ゲームで道幅に合わせて伸ばす）
#   GT_Start・GT_Goal  門の横断幕（幅 7m。前後どちらからも読める「START」「GOAL」の字。原点は幕の真ん中）
# 光る部品の材質の名前は「Light」で始める。書き出すものはコレクション「ST_Export」、下見用は「ST_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("street.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

STREETLIGHT_H, STREETLIGHT_ARM, STREETLIGHT_TILT = 6.8, 1.9, 0.12  # src/render3d.js と同じ
BANNER_W, BANNER_H = 7.0, 1.3
GATE_H = 6.0  # 門の梁の高さ


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


MAT = {
    "metal": material("ST_Metal", srgb(0x5a606b), rough=0.4, metal=0.5),  # 街灯・標識の柱
    "lamp": material("ST_LampHead", srgb(0x2a2e35), rough=0.5),
    "lens": material("Light_Lens", srgb(0xffd9a0), emit=srgb(0xffd9a0)),
    "vm_red": material("ST_VendingRed", srgb(0xc8282d), rough=0.4),
    "vm_white": material("ST_VendingWhite", srgb(0xe8e8e4), rough=0.4),
    "vm_dark": material("ST_VendingDark", srgb(0x22252b), rough=0.5),
    "vm_light": material("Light_Vending", srgb(0xf4f1e6), emit=srgb(0xf4f1e6)),
    "vm_items": material("Light_VendingItems", srgb(0x5aa0d8), emit=srgb(0x5aa0d8)),  # 商品の見本の段
    "concrete": material("ST_Concrete", srgb(0x9a9c98), rough=0.9),
    "steel": material("ST_Steel", srgb(0x6b6f74), rough=0.5, metal=0.6),
    "insulator": material("ST_Insulator", srgb(0xd8d4c8), rough=0.4),
    "transformer": material("ST_Transformer", srgb(0x8e9496), rough=0.5, metal=0.3),
    "stripe": material("ST_StripeYellow", srgb(0xe8c020), rough=0.6),
    "black": material("ST_Black", srgb(0x18191c), rough=0.6),
    "white": material("ST_White", srgb(0xeeeeea), rough=0.5),
    "bs_green": material("ST_BusStopGreen", srgb(0x1f8a4c), rough=0.5),
    "bs_glass": material("ST_BusStopGlass", srgb(0x8fa4b4), rough=0.1, metal=0.3),
    "wood": material("ST_Wood", srgb(0x8a6a48), rough=0.8),
    "gate": material("ST_GateRed", srgb(0xd8382f), rough=0.5),
    "gate_green": material("ST_GateGreen", srgb(0x2a9a4a), rough=0.5),
    "check_w": material("ST_CheckWhite", srgb(0xf4f4f0), rough=0.5),
    "check_b": material("ST_CheckBlack", srgb(0x16171a), rough=0.5),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("ST_Export")
preview_col = bpy.data.collections.new("ST_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, skip=()):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        quads = {"bottom": (0, 3, 2, 1), "top": (4, 5, 6, 7), "-y": (0, 1, 5, 4), "+y": (3, 7, 6, 2), "-x": (0, 4, 7, 3), "+x": (1, 2, 6, 5)}
        for k, q in quads.items():
            if k not in skip:
                self.face([v[i] for i in q], mat)

    def tube(self, a, b, r0, r1=None, mat="metal", seg=8, caps=True):
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

    def disc_x(self, x, y, z, r, mat, seg=16):
        """+X を向いた円板（標識の板）"""
        self.face([(x, y + math.cos(2 * math.pi * k / seg) * r, z + math.sin(2 * math.pi * k / seg) * r) for k in range(seg)], mat)

    def text(self, body, size, center, facing, mat, depth=0.0):
        """文字 body を、高さ size で、center を中心に、facing（'+y' か '-y'）の向きから読めるように貼る"""
        cu = bpy.data.curves.new("ST_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.extrude = depth
        ob = bpy.data.objects.new("ST_TextTmp", cu)
        scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = ob.evaluated_get(dg).to_mesh()
        # 文字は XY 平面に寝ているので、立てて向きを合わせる（+y から読む：X はそのまま、Y→Z。-y から読む：X を反対に）
        rot = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X') if facing == '+y' else Matrix.Rotation(math.pi / 2, 4, 'X')
        T = Matrix.Translation(Vector(center)) @ rot
        for poly in me.polygons:
            self.face([T @ me.vertices[i].co for i in poly.vertices], mat)
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
        return ob


# ---- 街灯（柱・腕・灯具）と光る面 ----
p = Part()
p.tube((0, 0, 0), (0, 0, STREETLIGHT_H), 0.12, 0.08, seg=10)
p.tube((0, 0, 0), (0, 0, 0.5), 0.16, 0.14, seg=10)
top = Vector((0, 0, STREETLIGHT_H - 0.15))
tip = top + Vector((math.cos(STREETLIGHT_TILT), 0, math.sin(STREETLIGHT_TILT))) * STREETLIGHT_ARM
p.tube(top + Vector((0, 0, -0.35)), top + Vector((0.6, 0, 0.0)), 0.035, mat="metal", seg=6)  # 腕の支え
p.tube(top, tip, 0.05, 0.045, seg=8)
hx = tip.x + 0.25
# 灯具：先が少し細い平たい箱
hz = tip.z - 0.02
p.box(tip.x - 0.12, hx + 0.38, -0.15, 0.15, hz - 0.07, hz + 0.06, "lamp")
p.box(tip.x - 0.05, hx + 0.3, -0.12, 0.12, hz + 0.06, hz + 0.09, "lamp")
streetlight = p.finish("SL_Pole")
p = Part()
p.face([(hx - 0.3, -0.11, hz - 0.075), (hx + 0.3, -0.11, hz - 0.075), (hx + 0.3, 0.11, hz - 0.075), (hx - 0.3, 0.11, hz - 0.075)][::-1], "lens")
lens = p.finish("SL_Lens")

# ---- 自動販売機（幅 1.0m・奥行き 0.7m・高さ 1.83m。前は +X） ----
p = Part()
W, D, H = 1.0, 0.7, 1.83
xf = D / 2  # 前の面
p.box(-xf, xf, -W / 2, W / 2, 0.05, H, "vm_red")
p.box(-xf, xf - 0.05, -W / 2 - 0.02, W / 2 + 0.02, 0, 0.08, "vm_dark")  # 台
p.box(xf, xf + 0.02, -W / 2 + 0.04, W / 2 - 0.04, 0.12, 0.42, "vm_dark")  # 取り出し口のまわり
p.box(xf + 0.02, xf + 0.03, -0.3, 0.3, 0.18, 0.32, "black")  # 取り出し口
p.box(xf, xf + 0.02, 0.18, 0.4, 0.55, 0.95, "vm_white")  # お金を入れる所
p.box(xf + 0.02, xf + 0.025, 0.24, 0.34, 0.75, 0.88, "black")
p.box(-xf - 0.02, xf + 0.02, -W / 2 - 0.02, W / 2 + 0.02, H, H + 0.04, "vm_white")  # 屋根
vending = p.finish("VM_Body")
p = Part()
x = xf + 0.012
p.face([(x, -W / 2 + 0.05, 0.98), (x, W / 2 - 0.05, 0.98), (x, W / 2 - 0.05, H - 0.1), (x, -W / 2 + 0.05, H - 0.1)], "vm_light")
for z in (1.06, 1.3, 1.54):  # 商品の見本の段
    for k in range(6):
        y = -W / 2 + 0.1 + k * 0.135
        p.box(x, x + 0.03, y, y + 0.09, z, z + 0.17, "vm_items")
p.face([(x + 0.002, -0.42, 0.98), (x + 0.002, 0.12, 0.98), (x + 0.002, 0.12, 1.02), (x + 0.002, -0.42, 1.02)], "vm_items")  # ボタンの列
vending_light = p.finish("VM_Light")

# ---- 電柱（コンクリートの柱・腕金と碍子・変圧器・足場ボルト・黄と黒の巻き板） ----
p = Part()
p.tube((0, 0, 0), (0, 0, 12.0), 0.19, 0.12, mat="concrete", seg=10)
for z, w in ((11.2, 1.0), (10.4, 0.8)):  # 腕金（道を横切る向き。電線は道に沿って碍子の上を通る）
    p.box(-w, w, -0.06, 0.06, z - 0.05, z + 0.05, "steel")
    for x in (-w + 0.08, 0.3, w - 0.08):
        p.tube((x, 0, z + 0.05), (x, 0, z + 0.22), 0.05, 0.04, mat="insulator", seg=6)
p.tube((0.42, 0, 8.4), (0.42, 0, 9.4), 0.24, 0.24, mat="transformer", seg=10)  # 変圧器（道路の側）
p.box(0.12, 0.22, -0.06, 0.06, 8.6, 9.2, "steel")
for k in range(10):  # 足場ボルト（互い違い）
    z = 2.0 + k * 0.45
    a = math.pi / 2 if k % 2 else -math.pi / 2
    p.tube((0, 0, z), (math.cos(a) * 0.0, math.sin(a) * 0.32, z), 0.015, mat="steel", seg=4)
for k in range(4):  # 足もとの黄と黒の巻き板
    p.tube((0, 0, 0.3 + k * 0.4), (0, 0, 0.7 + k * 0.4), 0.2, 0.198, mat="stripe" if k % 2 == 0 else "black", seg=10, caps=False)
utility = p.finish("UP_Pole")

# ---- 白いガードパイプ（4m 分。柱 2 本と横の管 2 本） ----
p = Part()
L = 4.0
for y in (-1.0, 1.0):
    p.tube((0, y, 0), (0, y, 0.82), 0.035, mat="white", seg=6)
    p.tube((0, y, 0.82), (0, y, 0.86), 0.035, 0.02, mat="white", seg=6)
for z in (0.45, 0.78):
    p.tube((0, -L / 2, z), (0, L / 2, z), 0.025, mat="white", seg=6)
guard = p.finish("GR_Pipe")

# ---- バス停：標識（丸い板・時刻表）と、屋根とベンチ ----
p = Part()
p.tube((0, 0, 0), (0, 0, 2.5), 0.04, mat="metal", seg=8)
p.box(-0.25, 0.25, -0.25, 0.25, 0, 0.12, "concrete")  # 重しの台
p.tube((-0.015, 0, 2.3), (0.015, 0, 2.3), 0.3, mat="white", seg=16)  # 丸い板（白）
for s in (-1, 1):
    p.disc_x(s * 0.017, 0, 2.3, 0.26, "bs_green", seg=16)  # 緑の丸
    p.face([(s * 0.019, -0.2, 2.26), (s * 0.019, 0.2, 2.26), (s * 0.019, 0.2, 2.34), (s * 0.019, -0.2, 2.34)][:: s], "white")  # 白い帯
p.box(-0.02, 0.02, -0.22, 0.22, 1.1, 1.7, "white")  # 時刻表
p.box(0.02, 0.025, -0.19, 0.19, 1.15, 1.65, "black")
bus_sign = p.finish("BS_Sign")
p = Part()
SW, SD, SH = 4.0, 1.5, 2.5  # 屋根の長さ（道に沿う）・奥行き・高さ
for y in (-SW / 2 + 0.2, SW / 2 - 0.2):
    p.box(-SD / 2, -SD / 2 + 0.08, y - 0.04, y + 0.04, 0, SH, "metal")
p.face([(-SD / 2 + 0.04, -SW / 2 + 0.2, 0.3), (-SD / 2 + 0.04, SW / 2 - 0.2, 0.3), (-SD / 2 + 0.04, SW / 2 - 0.2, 2.3), (-SD / 2 + 0.04, -SW / 2 + 0.2, 2.3)], "bs_glass")  # 背の板
p.box(-SD / 2 - 0.05, SD / 2, -SW / 2, SW / 2, SH, SH + 0.08, "metal")  # 屋根
p.box(-SD / 2 - 0.05, SD / 2, -SW / 2, SW / 2, SH + 0.08, SH + 0.1, "bs_green")
p.box(-SD / 2 + 0.1, -SD / 2 + 0.5, -1.2, 1.2, 0.42, 0.47, "wood")  # ベンチ
for y in (-1.0, 1.0):
    p.box(-SD / 2 + 0.25, -SD / 2 + 0.3, y - 0.03, y + 0.03, 0, 0.42, "metal")
bus_shelter = p.finish("BS_Shelter")

# ---- スタート・ゴールの門（柱・梁・横断幕） ----
p = Part()
p.box(-0.3, 0.3, -0.3, 0.3, 0, GATE_H + 0.6, "white")
p.box(-0.4, 0.4, -0.4, 0.4, 0, 0.3, "check_b")
for k in range(int((GATE_H - 0.5) / 0.6)):  # 柱の帯
    z = 0.5 + k * 0.6
    p.box(-0.305, 0.305, -0.305, 0.305, z, z + 0.3, "gate")
gate_post = p.finish("GT_Post")
p = Part()
p.box(-0.5, 0.5, -0.2, 0.2, GATE_H - 0.15, GATE_H + 0.25, "white", skip=("-x", "+x"))
gate_beam = p.finish("GT_Beam")


def banner(name, word, color):
    """横断幕：色の板に白い字、上下の縁は白黒の市松模様（前後どちらからも読める）"""
    p = Part()
    w, h, d = BANNER_W / 2, BANNER_H / 2, 0.06
    p.box(-w, w, -d, d, -h, h, color)
    n = 28
    for k in range(n):  # 市松の縁
        x0 = -w + k * (BANNER_W / n)
        for z0, row in ((h - 0.18, 0), (-h, 1)):
            for y in (-d - 0.004, d + 0.004):
                for r in range(2):
                    mat = "check_w" if (k + r + row) % 2 == 0 else "check_b"
                    pts = [(x0, y, z0 + r * 0.09), (x0 + BANNER_W / n, y, z0 + r * 0.09), (x0 + BANNER_W / n, y, z0 + (r + 1) * 0.09), (x0, y, z0 + (r + 1) * 0.09)]
                    p.face(pts if y > 0 else pts[::-1], mat)
    p.text(word, 0.75, (0, -d - 0.006, -0.02), '-y', "check_w")
    p.text(word, 0.75, (0, d + 0.006, -0.02), '+y', "check_w")
    return p.finish(name)


gate_start = banner("GT_Start", "START", "gate_green")
gate_goal = banner("GT_Goal", "GOAL", "gate")

parts = [streetlight, lens, vending, vending_light, utility, guard, bus_sign, bus_shelter, gate_post, gate_beam, gate_start, gate_goal]

# ---- 下見用：並べた街灯・自販機・電柱・ガードパイプ・バス停と、幅 12m の道の門 ----
def place(src, loc, rot=0.0, scale=(1, 1, 1)):
    ob = src.copy()
    ob.matrix_world = Matrix.Translation(loc) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Diagonal((*scale, 1))
    ob.hide_render = False
    preview_col.objects.link(ob)


for ob in parts:
    ob.hide_render = True
place(streetlight, (-7, -6, 0))
place(lens, (-7, -6, 0))
place(vending, (-7, -2, 0))
place(vending_light, (-7, -2, 0))
place(utility, (-7, 3, 0))
for k in range(3):
    place(guard, (-6.5, -12 + k * 4, 0))
place(bus_sign, (-6.5, 8, 0))
place(bus_shelter, (-8, 11, 0))
hw = 6.0
place(gate_post, (-hw - 0.8, 18, 0))
place(gate_post, (hw + 0.8, 18, 0))
place(gate_beam, (0, 18, 0), scale=(2 * (hw + 0.8), 1, 1))
place(gate_start, (0, 18, GATE_H - 0.15 - BANNER_H / 2 - 0.05))
place(gate_goal, (0, 30, 3))
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=30)
gm = bpy.data.meshes.new("ST_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("ST_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("ST_PreviewGround", gm))
sun = bpy.data.objects.new("ST_Sun", bpy.data.lights.new("ST_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-120))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("ST_Camera", bpy.data.cameras.new("ST_Camera"))
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (10, -20, 9)
cam.rotation_euler = (Vector((-3, 6, 3)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("ST_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "street_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
