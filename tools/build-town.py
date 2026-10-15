# 街の小物（道路標識・カーブミラー・郵便ポスト・消火栓の標識・駐輪場・コーンとバリケード・屋上の物・歩道橋の手すり・踏切）と、
# 駅の近くの名物（ハチ公像・明治神宮の大鳥居・竹下通り・アメ横・巣鴨地蔵通りの門）、道を走るバイクとスクーターを、
# ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-town.py -- <保存先の .blend>
#
# 原点はどれも物の根元（地面）。向きは、標識・ミラー・ポスト・踏切などは Blender の +X が見せる側（道路の側）、
# 名物の門は +Y が門をくぐる向き、バイク・スクーターは +Y が前（glb では -z、ゲームの前）。Z が高さ（m）。
#   TS_Stop・TS_Speed30・TS_Speed40・TS_OneWay（矢印は +Y の向き）・TS_Mirror     道路標識とカーブミラー
#   PB_Post 郵便ポスト、HY_Sign 消火栓の標識（足もとに黄色いふた）、BP_Rack 駐輪場（自転車 6 台）、CN_Cone コーン、BR_Barricade バリケード
#   RT_Tank 給水タンク、RT_AC 室外機、RT_Antenna アンテナ、RT_Billboard 看板（屋上に置く）
#   FB_Rail 歩道橋の手すり 1m 分（Y の向きに伸ばす）、FB_Girder 歩道橋の橋げたの横の板 1m 分
#   LC_Post 踏切の警報機（柱・×の標識・遮断機の箱）、LC_LampL・LC_LampR 赤い灯（交互に光らせる）、
#   LC_Arm 遮断機の棒（原点は回る軸。+Y へ長さ 1。ゲームで道幅に合わせて伸ばし、上げ下げする）
#   LM_Hachiko ハチ公像、LM_Torii 大鳥居、LM_Takeshita・LM_Ameyoko・LM_Sugamo 商店街の門（看板の字は前後どちらからも読める）
#   MB_Scooter 配達のスクーター（後ろに箱）、MB_Motorbike バイク（乗っている人も一緒）
# 光る部品の材質の名前は「Light」で始める。書き出すものはコレクション「TW_Export」、下見用は「TW_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("town.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT_JP = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # 看板の日本語の字（BIZ UDゴシック Bold。SIL Open Font License。字の形だけをモデルに入れる）
font_jp = bpy.data.fonts.load(FONT_JP) if os.path.exists(FONT_JP) else None


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
    "pole": C("TW_Pole", 0x8a9098, rough=0.4, metal=0.5),
    "white": C("TW_White", 0xf2f2ee),
    "red": C("TW_Red", 0xd22a2a),
    "blue": C("TW_Blue", 0x1f4fa8),
    "orange": C("TW_Orange", 0xf07a1a),
    "yellow": C("TW_Yellow", 0xf2c200),
    "black": C("TW_Black", 0x17181b),
    "mirror": C("TW_Mirror", 0x7f95a8, rough=0.05, metal=0.9),
    "postred": C("TW_PostRed", 0xc8161e, rough=0.4),
    "gray": C("TW_Gray", 0x9a9c98, rough=0.9),
    "dark": C("TW_Dark", 0x2a2d33, rough=0.6),
    "tank": C("TW_Tank", 0xc9d2d8, rough=0.5),
    "steel": C("TW_Steel", 0x6b6f74, rough=0.5, metal=0.6),
    "board": C("TW_Board", 0x2f8fcf, rough=0.5),
    "board2": C("TW_Board2", 0xf2c94c, rough=0.5),
    "fb": C("TW_FootbridgeGreen", 0x3f7f86, rough=0.5),
    "bronze": C("TW_Bronze", 0x5a5040, rough=0.4, metal=0.6),
    "stone": C("TW_Stone", 0x8c8a84, rough=0.9),
    "wood": C("TW_Wood", 0x7d6a55, rough=0.9),
    "pink": C("TW_Pink", 0xe85a9a),
    "sky": C("TW_Sky", 0x55b9e8),
    "green": C("TW_Green", 0x2a8a4a),
    "tire": C("TW_Tire", 0x101114, rough=0.9),
    "skin": C("TW_Skin", 0xe0b896, rough=0.7),
    "jacket": C("TW_Jacket", 0x30405a, rough=0.7),
    "lamp": material("Light_CrossingRed", srgb(0xff2a20), emit=srgb(0xff2a20)),
    "head": material("Light_Head", srgb(0xfff4d0), emit=srgb(0xfff4d0)),
    "tail": material("Light_Tail", srgb(0xff3030), emit=srgb(0xff3030)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("TW_Export")
preview_col = bpy.data.collections.new("TW_Preview")
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

    def poly_x(self, x, pts_yz, mat):
        """+X を向いた板（pts_yz は y, z の点）"""
        self.face([(x, y, z) for y, z in pts_yz], mat)

    def disc_x(self, x, y, z, r, mat, seg=20):
        self.poly_x(x, [(y + math.cos(2 * math.pi * k / seg) * r, z + math.sin(2 * math.pi * k / seg) * r) for k in range(seg)], mat)

    def ring_x(self, x, y, z, r0, r1, mat, seg=20):
        for k in range(seg):
            a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
            self.poly_x(x, [(y + math.cos(a) * r0, z + math.sin(a) * r0), (y + math.cos(a) * r1, z + math.sin(a) * r1),
                            (y + math.cos(b) * r1, z + math.sin(b) * r1), (y + math.cos(b) * r0, z + math.sin(b) * r0)], mat)

    def ellipsoid(self, c, rx, ry, rz, mat, seg=10, rows=6):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def text(self, body, size, center, mat, facing="+x", font=None):
        """字 body を、高さ size で center に貼る。facing は字を読む側（'+x'・'-x'・'+y'・'-y'）"""
        cu = bpy.data.curves.new("TW_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = 2  # 字の曲線を粗くして軽くする
        if font:
            cu.font = font
        ob = bpy.data.objects.new("TW_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        up = Matrix.Rotation(math.pi / 2, 4, 'X')  # XY 平面の字を立てる（-Y から読める）
        turn = {'-y': 0, '+x': math.pi / 2, '+y': math.pi, '-x': -math.pi / 2}[facing]
        T = Matrix.Translation(Vector(center)) @ Matrix.Rotation(turn, 4, 'Z') @ up
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


objs = []


def done(p, name):
    objs.append(p.finish(name))


# ================= 道路標識・カーブミラー =================
def sign_pole(p, h=2.6):
    p.tube((0, 0, 0), (0, 0, h), 0.03, seg=8)


p = Part()  # 止まれ（赤い逆三角に白い字）
sign_pole(p)
z, r = 2.25, 0.5
tri = [(0, z - r), (r * 0.87, z + r * 0.5), (-r * 0.87, z + r * 0.5)]
p.poly_x(0.045, [(-y, zz) for y, zz in tri], "white")
p.poly_x(0.05, [(-y * 0.85, z + (zz - z) * 0.85) for y, zz in tri], "red")
p.poly_x(0.04, [(y, zz) for y, zz in tri], "pole")
p.text("止まれ", 0.2, (0.055, 0, z + 0.13), "white", "+x", font_jp)
done(p, "TS_Stop")

for speed in (30, 40):  # 最高速度（白い丸に赤い輪、青い数字）
    p = Part()
    sign_pole(p)
    z = 2.2
    p.disc_x(0.045, 0, z, 0.3, "white")
    p.ring_x(0.05, 0, z, 0.24, 0.3, "red")
    p.disc_x(0.04, 0, z, 0.3, "pole")
    p.text(str(speed), 0.28, (0.055, 0, z), "blue", "+x")
    done(p, f"TS_Speed{speed}")

p = Part()  # 一方通行（青い板に白い矢印）
sign_pole(p)
z = 2.25
p.poly_x(0.045, [(-0.4, z - 0.15), (0.4, z - 0.15), (0.4, z + 0.15), (-0.4, z + 0.15)], "blue")
p.poly_x(0.04, [(0.4, z - 0.15), (-0.4, z - 0.15), (-0.4, z + 0.15), (0.4, z + 0.15)], "pole")
p.poly_x(0.05, [(-0.32, z - 0.04), (0.18, z - 0.04), (0.18, z - 0.1), (0.34, z), (0.18, z + 0.1), (0.18, z + 0.04), (-0.32, z + 0.04)], "white")
p.text("一方通行", 0.075, (0.052, -0.06, z - 0.105), "white", "+x", font_jp)
done(p, "TS_OneWay")

p = Part()  # カーブミラー（オレンジの柱と丸い鏡）
p.tube((0, 0, 0), (0, 0, 2.9), 0.04, mat="orange", seg=8)
p.tube((0, 0, 2.7), (0.15, 0, 2.7), 0.025, mat="orange", seg=6)
p.disc_x(0.22, 0, 2.7, 0.36, "mirror", seg=20)
p.ring_x(0.225, 0, 2.7, 0.33, 0.4, "orange", seg=20)
p.disc_x(0.2, 0, 2.7, 0.4, "orange", seg=20)
done(p, "TS_Mirror")

# ================= 郵便ポスト・消火栓の標識・駐輪場・コーン・バリケード =================
p = Part()  # 四角い郵便ポスト（赤。投入口 2 つ）
p.box(-0.2, 0.2, -0.22, 0.22, 0.0, 0.25, "dark")
p.box(-0.21, 0.21, -0.25, 0.25, 0.25, 1.25, "postred")
p.box(-0.23, 0.23, -0.27, 0.27, 1.25, 1.32, "postred")
for y in (-0.12, 0.12):
    p.box(0.21, 0.215, y - 0.08, y + 0.08, 1.05, 1.09, "black")
p.box(0.21, 0.212, -0.1, 0.1, 0.6, 0.75, "white")  # 集める時刻の札
done(p, "PB_Post")

p = Part()  # 消火栓の標識（赤い板に白い字）と足もとの黄色いふた
sign_pole(p, 2.4)
z = 2.15
p.poly_x(0.045, [(-0.22, z - 0.3), (0.22, z - 0.3), (0.22, z + 0.3), (-0.22, z + 0.3)], "red")
p.poly_x(0.04, [(0.22, z - 0.3), (-0.22, z - 0.3), (-0.22, z + 0.3), (0.22, z + 0.3)], "pole")
p.text("消\n火\n栓", 0.17, (0.05, 0, z), "white", "+x", font_jp)
p.tube((0.6, 0, 0.0), (0.6, 0, 0.03), 0.3, mat="yellow", seg=16)
done(p, "HY_Sign")


def bicycle(p, y, color):
    """とめてある自転車（+X が前）：車輪 2 つ・三角のフレーム・ハンドル・サドル・前かご"""
    for x in (-0.55, 0.55):
        for k in range(14):
            a, b = 2 * math.pi * k / 14, 2 * math.pi * (k + 1) / 14
            p.tube((x + math.cos(a) * 0.32, y, 0.33 + math.sin(a) * 0.32), (x + math.cos(b) * 0.32, y, 0.33 + math.sin(b) * 0.32), 0.022, mat="tire", seg=4, caps=False)
    pts = [(-0.55, 0.33), (-0.05, 0.36), (0.38, 0.75), (-0.15, 0.8)]
    for (ax, az), (bx, bz) in ((pts[0], pts[1]), (pts[1], pts[2]), (pts[1], pts[3]), (pts[3], pts[2]), (pts[0], pts[3]), ((0.55, 0.33), (0.4, 0.9))):
        p.tube((ax, y, az), (bx, y, bz), 0.018, mat=color, seg=4)
    p.tube((0.4, y - 0.25, 0.95), (0.4, y + 0.25, 0.95), 0.015, mat="black", seg=4)
    p.box(-0.25, -0.05, y - 0.06, y + 0.06, 0.85, 0.9, "black")
    p.box(0.5, 0.78, y - 0.16, y + 0.16, 0.72, 0.92, "steel")  # 前かご


p = Part()  # 駐輪場：低い柵と自転車 6 台（道に沿って並ぶ）
p.box(-0.05, 0.05, -2.0, 2.0, 0.0, 0.05, "steel")
for k in range(6):
    y = -1.75 + k * 0.7
    p.tube((-0.2, y, 0.0), (-0.2, y, 0.45), 0.02, mat="steel", seg=4)
    bicycle(p, y, ["red", "blue", "white", "black", "green", "pink"][k])
done(p, "BP_Rack")

p = Part()  # コーン（赤と白）
p.box(-0.2, 0.2, -0.2, 0.2, 0.0, 0.04, "red")
p.tube((0, 0, 0.04), (0, 0, 0.3), 0.15, 0.11, mat="red", seg=10)
p.tube((0, 0, 0.3), (0, 0, 0.45), 0.11, 0.075, mat="white", seg=10, caps=False)
p.tube((0, 0, 0.45), (0, 0, 0.7), 0.075, 0.02, mat="red", seg=10)
done(p, "CN_Cone")

p = Part()  # バリケード（黄と黒の板、足、点滅する灯）
for y in (-0.55, 0.55):
    p.box(-0.25, 0.25, y - 0.03, y + 0.03, 0.0, 0.05, "black")
    p.box(-0.03, 0.03, y - 0.03, y + 0.03, 0.0, 0.9, "yellow")
p.box(-0.02, 0.02, -0.65, 0.65, 0.6, 0.85, "yellow")
for k in range(6):  # 黒い斜めの縞
    y = -0.6 + k * 0.22
    for x in (0.021, -0.021):
        p.poly_x(x, [(y, 0.6), (y + 0.09, 0.6), (y + 0.19, 0.85), (y + 0.1, 0.85)][:: 1 if x > 0 else -1], "black")
p.box(-0.04, 0.04, -0.04, 0.04, 0.9, 1.0, "orange")
done(p, "BR_Barricade")

# ================= 屋上の物 =================
p = Part()  # 給水タンク（鉄の台の上の四角いタンク）
for x in (-1.0, 1.0):
    for y in (-0.8, 0.8):
        p.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.0, 0.8, "steel")
p.box(-1.1, 1.1, -0.9, 0.9, 0.8, 0.9, "steel")
p.box(-1.0, 1.0, -0.8, 0.8, 0.9, 2.6, "tank")
for z in (1.3, 1.8, 2.3):
    p.box(-1.01, 1.01, -0.81, 0.81, z, z + 0.04, "white")
done(p, "RT_Tank")

p = Part()  # 室外機 3 台（ファンの丸）
for k in range(3):
    y = -1.0 + k * 1.0
    p.box(-0.3, 0.3, y - 0.42, y + 0.42, 0.0, 0.7, "white")
    p.disc_x(0.302, y, 0.35, 0.24, "dark", seg=12)
done(p, "RT_AC")

p = Part()  # アンテナ（細い塔と横の棒）
for x, y in ((-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)):
    p.tube((x, y, 0.0), (x * 0.3, y * 0.3, 6.0), 0.03, mat="steel", seg=4)
for z in (1.5, 3.0, 4.5):
    p.box(-0.35 + z * 0.04, 0.35 - z * 0.04, -0.01, 0.01, z, z + 0.03, "steel")
p.tube((0, 0, 6.0), (0, 0, 7.5), 0.02, mat="steel", seg=4)
for z in (6.3, 6.8, 7.2):
    p.tube((0, -0.6, z), (0, 0.6, z), 0.012, mat="steel", seg=4)
done(p, "RT_Antenna")

p = Part()  # 屋上の看板（鉄の骨組みの上の色の板。字はない）
for y in (-2.6, 0, 2.6):
    p.tube((0, y, 0.0), (0, y, 4.0), 0.06, mat="steel", seg=6)
    p.tube((-1.0, y, 0.0), (0, y, 2.5), 0.04, mat="steel", seg=4)
p.box(0.0, 0.1, -3.0, 3.0, 1.0, 4.0, "white")
p.poly_x(0.101, [(-2.9, 1.1), (2.9, 1.1), (2.9, 2.2), (-2.9, 2.2)], "board")
p.poly_x(0.102, [(-2.9, 2.3), (2.9, 2.3), (2.9, 3.9), (-2.9, 3.9)], "board2")
done(p, "RT_Billboard")

# ================= 歩道橋 =================
p = Part()  # 手すり 1m 分（柱・上の手すり・縦の棒）
p.box(-0.04, 0.04, -0.03, 0.03, 0.0, 1.15, "fb")
p.box(-0.05, 0.05, -0.5, 0.5, 1.1, 1.18, "fb")
p.box(-0.02, 0.02, -0.5, 0.5, 0.12, 0.16, "fb")
for k in range(1, 8):
    y = -0.5 + k * 0.125
    p.box(-0.012, 0.012, y - 0.012, y + 0.012, 0.16, 1.1, "fb")
done(p, "FB_Rail")
p = Part()  # 橋げたの横の板 1m 分（床の下へ 0.9m。外向きは +X）
p.poly_x(0.0, [(-0.5, -0.9), (0.5, -0.9), (0.5, 0.0), (-0.5, 0.0)], "fb")
p.poly_x(-0.01, [(0.5, -0.9), (-0.5, -0.9), (-0.5, 0.0), (0.5, 0.0)], "fb")
p.box(-0.3, 0.0, -0.5, 0.5, -0.92, -0.88, "fb")
done(p, "FB_Girder")

# ================= 踏切 =================
p = Part()  # 警報機の柱・×の標識・灯の板・遮断機の箱（+X が道路の側。遮断機の棒は +Y へ伸びる）
p.box(-0.25, 0.25, -0.25, 0.25, 0.0, 0.1, "gray")
p.tube((0, 0, 0.1), (0, 0, 3.5), 0.07, mat="white", seg=8)
for k in range(5):  # 柱の黄と黒の帯
    p.tube((0, 0, 0.1 + k * 0.35), (0, 0, 0.27 + k * 0.35), 0.072, mat="black", seg=8, caps=False)
z = 3.2
for a in (45, -45):  # ×の標識
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    L, Wd = 0.55, 0.09
    p.poly_x(0.08, [(-L * ca + Wd * sa, z - L * sa - Wd * ca), (L * ca + Wd * sa, z + L * sa - Wd * ca), (L * ca - Wd * sa, z + L * sa + Wd * ca), (-L * ca - Wd * sa, z - L * sa + Wd * ca)], "yellow")
    p.poly_x(0.085, [(-L * ca + Wd * 0.4 * sa, z - L * sa - Wd * 0.4 * ca), (L * ca + Wd * 0.4 * sa, z + L * sa - Wd * 0.4 * ca), (L * ca - Wd * 0.4 * sa, z + L * sa + Wd * 0.4 * ca), (-L * ca - Wd * 0.4 * sa, z - L * sa + Wd * 0.4 * ca)], "black")
p.box(0.05, 0.1, -0.5, 0.5, 2.35, 2.75, "black")  # 灯の板
for y in (-0.3, 0.3):
    p.tube((0.1, y, 2.7), (0.35, y, 2.7), 0.15, 0.17, mat="black", seg=10, caps=False)  # 灯の庇
p.ellipsoid((0, 0, 2.95), 0.12, 0.12, 0.1, "black", seg=8, rows=4)  # 警報の鐘
p.box(-0.2, 0.2, 0.15, 0.55, 0.1, 1.1, "yellow")  # 遮断機の箱
p.box(-0.21, 0.21, 0.14, 0.56, 0.6, 0.75, "black")
done(p, "LC_Post")
for name, y in (("LC_LampL", -0.3), ("LC_LampR", 0.3)):
    p = Part()
    p.disc_x(0.12, y, 2.55, 0.14, "lamp", seg=14)
    done(p, name)
p = Part()  # 遮断機の棒（長さ 1。黄と黒の縞は 8 本）
for k in range(8):
    p.box(-0.04, 0.04, k / 8, (k + 1) / 8, -0.04, 0.04, "yellow" if k % 2 == 0 else "black")
done(p, "LC_Arm")

# ================= 駅の近くの名物 =================
p = Part()  # ハチ公像：石の台の上に座る秋田犬（+Y を向く）
p.box(-0.7, 0.7, -0.9, 0.9, 0.0, 1.6, "stone")
p.box(-0.78, 0.78, -0.98, 0.98, 1.6, 1.7, "stone")
z0 = 1.7
p.ellipsoid((0, -0.15, z0 + 0.25), 0.2, 0.35, 0.22, "bronze")  # 腰・後ろ足
p.ellipsoid((0, 0.08, z0 + 0.55), 0.17, 0.2, 0.32, "bronze")  # 胸（立ち上がった前半身）
for x in (-0.09, 0.09):
    p.tube((x, 0.18, z0 + 0.3), (x, 0.22, z0), 0.05, mat="bronze", seg=6)  # 前足
p.ellipsoid((0, 0.18, z0 + 0.92), 0.13, 0.14, 0.13, "bronze")  # 頭
p.ellipsoid((0, 0.32, z0 + 0.88), 0.06, 0.09, 0.05, "bronze")  # 鼻先
for x in (-0.07, 0.07):
    p.tube((x, 0.15, z0 + 1.02), (x * 1.2, 0.14, z0 + 1.13), 0.035, 0.005, mat="bronze", seg=4)  # 耳
p.tube((0, -0.45, z0 + 0.3), (0, -0.4, z0 + 0.55), 0.04, mat="bronze", seg=5)  # 巻いたしっぽ
p.text("忠犬ハチ公", 0.14, (0, 0.905, 1.1), "black", "+y", font_jp)
done(p, "LM_Hachiko")

p = Part()  # 明治神宮の大鳥居（木の明神鳥居。柱の太さ約 1.2m、高さ 12m）
for x in (-4.5, 4.5):
    p.tube((x, 0, 0), (x * 0.97, 0, 10.6), 0.6, 0.55, mat="wood", seg=12)
    p.tube((x, 0, 0), (x, 0, 0.8), 0.75, 0.7, mat="dark", seg=12)  # 根巻き
p.box(-6.0, 6.0, -0.45, 0.45, 8.3, 9.1, "wood")  # 貫
p.box(-0.35, 0.35, -0.4, 0.4, 9.1, 10.6, "wood")  # 額束
kasagi = []  # 笠木：両端が少し反った長い梁
for k in range(9):
    x = -8.5 + k * (17.0 / 8)
    kasagi.append((x, 10.6 + 0.45 * (abs(x) / 8.5) ** 2))
for (xa, za), (xb, zb) in zip(kasagi, kasagi[1:]):
    p.box(xa, xb, -0.6, 0.6, min(za, zb), min(za, zb) + 1.0, "wood")
done(p, "LM_Torii")


def street_gate(name, words, width, color, color2, clock=False):
    """商店街の入口の門：2 本の柱と、字の看板（前後どちらからも読める）"""
    p = Part()
    hw = width / 2
    for x in (-hw, hw):
        p.box(x - 0.2, x + 0.2, -0.2, 0.2, 0.0, 5.6, color2)
    p.box(-hw - 0.3, hw + 0.3, -0.25, 0.25, 5.6, 7.0, color)
    p.box(-hw - 0.3, hw + 0.3, -0.27, 0.27, 7.0, 7.12, color2)
    p.box(-hw - 0.3, hw + 0.3, -0.27, 0.27, 5.48, 5.6, color2)
    for facing, y in (("-y", -0.26), ("+y", 0.26)):
        p.text(words, min(1.15, width * 0.85 / len(words)), (0, y + (-0.01 if facing == "-y" else 0.01), 6.3), "white", facing, font_jp)
    if clock:
        for y, s in ((-0.28, -1), (0.28, 1)):
            for k in range(16):
                a, b = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
                p.face([(0, y, 7.75), (math.cos(a) * 0.55 * -s, y, 7.75 + math.sin(a) * 0.55), (math.cos(b) * 0.55 * -s, y, 7.75 + math.sin(b) * 0.55)], "white")
        p.box(-0.65, 0.65, -0.25, 0.25, 7.12, 8.4, color)
    done(p, name)


street_gate("LM_Takeshita", "竹下通り", 8.0, "pink", "sky")
street_gate("LM_Ameyoko", "アメ横", 10.0, "red", "white", clock=True)
street_gate("LM_Sugamo", "巣鴨地蔵通り", 10.0, "green", "white")

# ================= バイク・スクーター =================
def wheel_y(p, y, r, w):
    p.tube((-w / 2, y, r), (w / 2, y, r), r, mat="tire", seg=12)
    p.tube((-w / 2 - 0.01, y, r), (w / 2 + 0.01, y, r), r * 0.5, mat="steel", seg=10)


def rider(p, y_hip, z_hip, lean):
    """乗っている人：胴体・頭とヘルメット・腕・脚（座った形）"""
    p.ellipsoid((0, y_hip + 0.1 * lean, z_hip + 0.32), 0.18, 0.14, 0.32, "jacket")
    p.ellipsoid((0, y_hip + 0.2 * lean, z_hip + 0.78), 0.14, 0.15, 0.15, "white")  # ヘルメット
    p.box(-0.1, 0.1, y_hip + 0.2 * lean + 0.1, y_hip + 0.2 * lean + 0.16, z_hip + 0.72, z_hip + 0.8, "black")  # シールド
    for x in (-0.12, 0.12):
        p.tube((x, y_hip, z_hip), (x, y_hip + 0.4, z_hip - 0.05), 0.07, mat="dark", seg=6)  # 太もも
        p.tube((x, y_hip + 0.4, z_hip - 0.05), (x, y_hip + 0.45, 0.25), 0.055, mat="dark", seg=6)  # すね
        p.tube((x * 1.4, y_hip + 0.1, z_hip + 0.5), (x * 1.6, y_hip + 0.55, z_hip + 0.35), 0.05, mat="jacket", seg=6)  # 腕


p = Part()  # 配達のスクーター（白い車体と後ろの四角い箱）
wheel_y(p, 0.6, 0.26, 0.12)
wheel_y(p, -0.55, 0.26, 0.12)
p.box(-0.18, 0.18, -0.5, 0.45, 0.25, 0.42, "white")  # 足を置く床
p.box(-0.2, 0.2, -0.75, -0.2, 0.42, 0.75, "white")  # 座席の下
p.box(-0.18, 0.18, -0.7, -0.2, 0.75, 0.82, "black")  # 座席
p.tube((0, 0.52, 0.35), (0, 0.42, 1.0), 0.06, mat="white", seg=6)  # 前の柱
p.box(-0.3, 0.3, 0.38, 0.46, 0.95, 1.0, "black")  # ハンドル
p.box(-0.08, 0.08, 0.6, 0.66, 0.6, 0.72, "head")
p.box(-0.28, 0.28, -1.15, -0.65, 0.82, 1.32, "white")  # 配達の箱
p.box(-0.06, 0.06, -1.16, -1.14, 0.85, 0.92, "tail")
rider(p, -0.3, 0.85, 1.0)
done(p, "MB_Scooter")

p = Part()  # バイク（タンク・エンジン・マフラー）
wheel_y(p, 0.75, 0.32, 0.14)
wheel_y(p, -0.7, 0.32, 0.16)
p.box(-0.2, 0.2, -0.2, 0.35, 0.35, 0.7, "dark")  # エンジン
p.ellipsoid((0, 0.25, 0.85), 0.18, 0.3, 0.14, "red")  # タンク
p.box(-0.16, 0.16, -0.6, 0.05, 0.78, 0.88, "black")  # 座席
p.tube((0, 0.72, 0.35), (0, 0.5, 1.05), 0.04, mat="steel", seg=6)
p.box(-0.35, 0.35, 0.47, 0.53, 1.02, 1.06, "black")
p.tube((0.18, 0.1, 0.35), (0.2, -0.8, 0.5), 0.05, mat="steel", seg=6)  # マフラー
p.box(-0.1, 0.1, 0.78, 0.84, 0.85, 0.98, "head")
p.box(-0.08, 0.08, -0.72, -0.68, 0.85, 0.92, "tail")
rider(p, -0.3, 0.88, 1.6)
done(p, "MB_Motorbike")

# ================= 下見用（並べる） =================
for ob in objs:
    ob.hide_render = True
for i, ob in enumerate(objs):
    pv = ob.copy()
    pv.location = ((i % 8) * 4.0 - 14, (i // 8) * 7.0 - 10, 0)
    if ob.name.startswith("LM_"):
        pv.location = ((i % 8) * 4.0 - 14 + (6 if ob.name in ("LM_Torii",) else 0), 18 + (i % 3) * 3, 0)
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=60)
gm = bpy.data.meshes.new("TW_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TW_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("TW_PreviewGround", gm))
sun = bpy.data.objects.new("TW_Sun", bpy.data.lights.new("TW_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(60))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TW_Camera", bpy.data.cameras.new("TW_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (26, -30, 18)
cam.rotation_euler = (Vector((0, 4, 2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TW_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "town_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
