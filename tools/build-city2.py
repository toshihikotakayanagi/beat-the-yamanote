# 街の物 その 3：走る路面電車・モノレール・新交通の車両、緊急車両、駅前の名物 その 2、店の前の物、工事現場の重機を、
# ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city2.py -- <保存先の .blend>
#
# 原点はどれも物の根元（地面・レールの上）。+Y が前（車両）、+X が見せる側（道の側）、Z が高さ（m）。書き出すものは「C2_Export」。
#   C2_Toden（都電荒川線の 1 両。長さ 13m）・C2_Mono（東京モノレールの 1 両。長さ 16m、レールの梁にまたがる）・
#   C2_Yuri（ゆりかもめの 1 両。長さ 9m）
#   C2_Police・C2_Ambulance・C2_Fire（パトカー・救急車・消防車）と、それぞれの回転灯 C2_PoliceLamp・C2_AmbLamp・C2_FireLamp（点滅させる）
#   C2_Saigo（上野の西郷隆盛像。+Y を向く）・C2_Cat（新宿東口の角の大きな画面と、身を乗り出す三毛猫。原点は画面の角の下、+X と +Y の面）・
#   C2_Clock（恵比寿ガーデンプレイスの時計台）・C2_Sunshine（サンシャイン60通りの入口のアーチ。+Y が門をくぐる向き）
#   C2_NoboriPole・C2_NoboriCloth（のぼり旗の竿と布。布は白く作り、ゲームで色を付ける）・C2_ABoard（立て看板）・C2_Bike（とめた自転車）・
#   C2_Yatai（焼き芋の屋台）
#   C2_Excavator（ショベルカー）・C2_Crane（クレーン車）・C2_Scaffold（足場と白い仮囲い）
# 光る部品の材質の名前は「Light」で始める。下見用は「C2_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city2.blend")
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
L = lambda name, h: material(name, srgb(h), emit=srgb(h))
MAT = {
    "white": C("C2_White", 0xf0f0ec), "cream": C("C2_Cream", 0xf0e6c8), "rose": C("C2_Rose", 0xd8507a), "blue": C("C2_Blue", 0x1f5fb0),
    "orange": C("C2_Orange", 0xf08a2a), "navy": C("C2_Navy", 0x1f2f5a), "red": C("C2_Red", 0xc8282d), "black": C("C2_Black", 0x17181b),
    "dark": C("C2_Dark", 0x2a2d33), "gray": C("C2_Gray", 0x9a9c98, rough=0.9), "steel": C("C2_Steel", 0x8a9098, rough=0.4, metal=0.6),
    "glass": C("C2_Glass", 0x1c2733, rough=0.1, metal=0.3), "tire": C("C2_Tire", 0x101114, rough=0.9), "yellow": C("C2_Yellow", 0xf2b800),
    "bronze": C("C2_Bronze", 0x4a4238, rough=0.4, metal=0.6), "stone": C("C2_Stone", 0x8c8a84, rough=0.9), "wood": C("C2_Wood", 0x7a5a3a, rough=0.8),
    "catw": C("C2_CatWhite", 0xf4f0e8), "catb": C("C2_CatBrown", 0xc07a3a), "catk": C("C2_CatBlack", 0x2a2624), "pink": C("C2_Pink", 0xf0a0b0),
    "green": C("C2_Green", 0x2a8a4a), "sheet": C("C2_Sheet", 0x8fb8d8, rough=0.8), "cloth": C("C2_Cloth", 0xffffff, rough=0.9),
    "screen": L("Light_Screen", 0x3a4a6a), "win": L("Light_Window", 0xfff0c8), "lampR": L("Light_LampRed", 0xff2020),
    "lampB": L("Light_LampBlue", 0x2a6aff), "head": L("Light_Head", 0xfff4d0), "lantern": L("Light_Lantern", 0xff6a2a),
    "clockf": L("Light_Clock", 0xfff8e8),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("C2_Export")
preview_col = bpy.data.collections.new("C2_Preview")
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

    def tube(self, a, b, r0, r1=None, mat="steel", seg=8, caps=True):
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

    def ellipsoid(self, c, rx, ry, rz, mat, seg=10, rows=6):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def side(self, x, y0, y1, z0, z1, mat):
        pts = [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
        self.face(pts if x > 0 else pts[::-1], mat)

    def wheel(self, x, y, r, w):
        self.tube((x - w / 2, y, r), (x + w / 2, y, r), r, mat="tire", seg=10)

    def text(self, body, size, center, normal, mat):
        cu = bpy.data.curves.new("C2_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = 3
        if font:
            cu.font = font
        ob = bpy.data.objects.new("C2_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        nx, ny = normal
        rx, ry = -ny, nx
        for poly in me.polygons:
            self.face([(center[0] + rx * me.vertices[i].co.x, center[1] + ry * me.vertices[i].co.x, center[2] + me.vertices[i].co.y) for i in poly.vertices], mat)
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


objs = []


def rail_car(p, L, W, H, body, band, z0=0.35, round_ends=0.6, windows=True):
    """四角い車体（角を丸めた前後）に、窓の帯と色の帯"""
    hl, hw = L / 2, W / 2
    pts = [(hw, -hl + round_ends), (hw, hl - round_ends), (hw - round_ends * 0.6, hl), (-hw + round_ends * 0.6, hl), (-hw, hl - round_ends), (-hw, -hl + round_ends), (-hw + round_ends * 0.6, -hl), (hw - round_ends * 0.6, -hl)]
    A = [Vector((x, y, z0)) for x, y in pts]
    B = [Vector((x, y, z0 + H)) for x, y in pts]
    for k in range(8):
        p.face([A[k], A[(k + 1) % 8], B[(k + 1) % 8], B[k]], body)
    p.face(B, "white")
    p.face(A[::-1], "dark")
    for s in (-1, 1):
        p.side(s * (hw + 0.005), -hl + round_ends, hl - round_ends, z0 + 0.25, z0 + 0.65, band)
        if windows:
            p.side(s * (hw + 0.01), -hl + round_ends + 0.3, hl - round_ends - 0.3, z0 + H * 0.45, z0 + H * 0.8, "win")
    for y in (hl + 0.005, -hl - 0.005):  # 前後の窓
        pts2 = [(-hw * 0.7, y, z0 + H * 0.45), (hw * 0.7, y, z0 + H * 0.45), (hw * 0.7, y, z0 + H * 0.85), (-hw * 0.7, y, z0 + H * 0.85)]
        p.face(pts2 if y > 0 else pts2[::-1], "glass")


# ================= 走る路面電車・モノレール・新交通 =================
p = Part()  # 都電荒川線（クリーム色にローズの帯、パンタグラフ）
rail_car(p, 13.0, 2.4, 2.9, "cream", "rose", z0=0.6)
for y in (-4.0, 4.0):
    p.box(-1.0, 1.0, y - 1.0, y + 1.0, 0.0, 0.6, "dark")
p.tube((0, -0.8, 3.5), (0, 0.8, 4.4), 0.03, mat="steel", seg=4)
p.box(-0.7, 0.7, 0.75, 0.85, 4.4, 4.45, "steel")
p.box(-0.5, 0.5, -6.52, -6.5, 2.9, 3.2, "head")
p.finish("C2_Toden")
p = Part()  # 東京モノレール（白い車体に青とオレンジの帯。梁にまたがる下の部分）
rail_car(p, 16.0, 2.9, 2.6, "white", "blue", z0=0.9)
for s in (-1, 1):
    p.side(s * 1.457, -7.4, 7.4, 1.6, 1.7, "orange")
p.box(-0.55, 0.55, -7.5, 7.5, -0.6, 0.9, "white")  # 梁を包む下の部分（梁は高さ 0 の上）
p.box(-0.56, 0.56, -7.5, 7.5, -0.6, -0.3, "blue")
p.finish("C2_Mono")
p = Part()  # ゆりかもめ（白い車体に青い帯、小さなタイヤ）
rail_car(p, 9.0, 2.5, 2.6, "white", "blue", z0=0.6)
for y in (-3.0, 3.0):
    for s in (-1, 1):
        p.wheel(s * 1.0, y, 0.4, 0.25)
p.finish("C2_Yuri")


# ================= 緊急車両 =================
def car_body(p, L, W, low, high, cabin, color, cab_color=None):
    hl, hw = L / 2, W / 2
    p.box(-hw, hw, -hl, hl, 0.3, low, color)
    c0, c1 = cabin
    p.box(-hw + 0.08, hw - 0.08, c0, c1, low, high, cab_color or color)
    for s in (-1, 1):
        p.side(s * (hw - 0.07), c0 + 0.2, c1 - 0.2, low + 0.1, high - 0.1, "glass")
    for y in (c1 + 0.005,):
        p.face([(-hw + 0.15, y, low + 0.05), (hw - 0.15, y, low + 0.05), (hw - 0.2, y, high - 0.08), (-hw + 0.2, y, high - 0.08)], "glass")
    for s in (-1, 1):
        for y in (hl - 0.8, -hl + 0.8):
            p.wheel(s * (hw - 0.1), y, 0.32, 0.22)
    for s in (-1, 1):
        p.box(s * (hw - 0.3) - 0.15, s * (hw - 0.3) + 0.15, hl - 0.02, hl + 0.02, low - 0.3, low - 0.15, "head")


p = Part()  # パトカー（白と黒）
car_body(p, 4.7, 1.8, 0.95, 1.45, (-1.2, 1.0), "black", "white")
for s in (-1, 1):
    p.side(s * 0.902, -1.6, 1.6, 0.35, 0.95, "white")
p.box(-0.6, 0.6, -0.2, 0.2, 1.45, 1.53, "dark")
p.text("警視庁", 0.28, (0.91, -0.4, 0.62), (1, 0), "black")
p.text("警視庁", 0.28, (-0.91, 0.4, 0.62), (-1, 0), "black")
p.finish("C2_Police")
p = Part()
p.box(-0.55, -0.05, -0.15, 0.15, 1.53, 1.68, "lampR")
p.box(0.05, 0.55, -0.15, 0.15, 1.53, 1.68, "lampR")
p.finish("C2_PoliceLamp")
p = Part()  # 救急車（白い箱に赤い帯）
car_body(p, 5.6, 1.9, 1.1, 2.4, (-2.7, 1.6), "white")
p.box(-0.95, 0.95, -2.8, 1.0, 1.1, 2.5, "white")
for s in (-1, 1):
    p.side(s * 0.96, -2.7, 1.5, 1.2, 1.4, "red")
p.text("救急車", 0.3, (0.97, -0.8, 1.85), (1, 0), "red")
p.text("救急車", 0.3, (-0.97, 0.8, 1.85), (-1, 0), "red")
p.finish("C2_Ambulance")
p = Part()
p.box(-0.6, 0.6, 1.2, 1.5, 2.5, 2.65, "lampR")
p.box(-0.25, 0.25, -2.75, -2.55, 2.5, 2.65, "lampR")
p.finish("C2_AmbLamp")
p = Part()  # 消防車（赤い車体、銀のはしご）
car_body(p, 7.5, 2.2, 1.3, 2.4, (1.6, 3.6), "red")
p.box(-1.1, 1.1, -3.7, 1.5, 0.3, 2.0, "red")
p.box(-1.1, 1.1, -3.7, 1.5, 1.95, 2.05, "white")
for s in (-0.35, 0.35):
    p.box(s - 0.05, s + 0.05, -3.5, 3.0, 2.3, 2.4, "steel")
for k in range(13):
    y = -3.4 + k * 0.5
    p.box(-0.35, 0.35, y - 0.02, y + 0.02, 2.32, 2.38, "steel")
p.finish("C2_Fire")
p = Part()
p.box(-0.7, 0.7, 3.0, 3.3, 2.4, 2.55, "lampR")
p.finish("C2_FireLamp")

# ================= 駅前の名物 その 2 =================
p = Part()  # 西郷隆盛像（浴衣姿で犬を連れた姿。石の台の上）
p.box(-1.2, 1.2, -1.2, 1.2, 0.0, 2.6, "stone")
p.box(-1.35, 1.35, -1.35, 1.35, 2.6, 2.75, "stone")
z = 2.75
p.ellipsoid((0, 0, z + 1.3), 0.55, 0.42, 1.25, "bronze")  # 着物の体
p.ellipsoid((0, 0.02, z + 2.75), 0.22, 0.24, 0.28, "bronze")  # 頭
for x in (-0.2, 0.2):
    p.tube((x, 0.05, z + 0.1), (x, 0.08, z), 0.11, mat="bronze", seg=6)
p.tube((0.45, 0.1, z + 2.0), (0.55, 0.3, z + 1.3), 0.1, mat="bronze", seg=6)  # 右手
p.ellipsoid((0.75, 0.6, z + 0.35), 0.16, 0.38, 0.18, "bronze")  # 犬
p.ellipsoid((0.75, 0.98, z + 0.55), 0.12, 0.14, 0.12, "bronze")
for xx in (0.67, 0.83):
    for yy in (0.4, 0.85):
        p.tube((xx, yy, z + 0.25), (xx, yy, z), 0.04, mat="bronze", seg=4)
p.text("西郷隆盛", 0.35, (0, 1.21, 1.6), (0, 1), "black")
p.finish("C2_Saigo")

p = Part()  # 新宿東口の角の大きな画面と、身を乗り出す三毛猫（画面の角は原点。+X と +Y の 2 面）
W2, H2, Z0 = 12.0, 8.0, 12.0
p.face([(0.01, 0, Z0), (0.01, -W2, Z0), (0.01, -W2, Z0 + H2), (0.01, 0, Z0 + H2)][::-1], "screen")  # +X の面
p.face([(0, 0.01, Z0), (0, 0.01, Z0 + H2), (-W2, 0.01, Z0 + H2), (-W2, 0.01, Z0)], "screen")  # +Y の面
p.box(-0.3, 0.3, -0.3, 0.3, Z0 - 0.5, Z0 + H2 + 0.5, "dark")
cz = Z0 + 2.5  # 猫：角から外へ身を乗り出す
p.ellipsoid((1.2, 1.2, cz), 2.6, 2.6, 2.0, "catw")  # 胸
p.ellipsoid((2.3, 2.3, cz + 2.6), 1.9, 1.9, 1.7, "catw")  # 頭
p.ellipsoid((2.0, 2.6, cz + 3.4), 1.0, 0.9, 0.8, "catb")  # 頭の茶色のぶち
p.ellipsoid((3.0, 1.8, cz + 3.5), 0.8, 0.9, 0.7, "catk")  # 黒いぶち
for ex, ey in ((1.3, 3.2), (3.2, 1.3)):
    p.tube((ex, ey, cz + 3.6), (ex * 1.02, ey * 1.02, cz + 5.0), 0.55, 0.05, mat="catw", seg=6)  # 耳
for ex, ey in ((2.9, 3.6), (3.6, 2.9)):
    p.ellipsoid((ex, ey, cz + 2.9), 0.22, 0.22, 0.28, "catk")  # 目
p.ellipsoid((3.7, 3.7, cz + 2.3), 0.15, 0.15, 0.12, "pink")  # 鼻
for ex, ey in ((3.0, 0.8), (0.8, 3.0)):
    p.ellipsoid((ex, ey, cz - 1.6), 0.55, 0.55, 0.9, "catw")  # 前足
p.finish("C2_Cat")

p = Part()  # 恵比寿ガーデンプレイスの時計台（レンガ色の柱と 4 面の時計）
p.box(-0.9, 0.9, -0.9, 0.9, 0.0, 0.4, "stone")
p.box(-0.6, 0.6, -0.6, 0.6, 0.4, 6.5, "wood")
p.box(-0.8, 0.8, -0.8, 0.8, 6.5, 8.0, "dark")
p.tube((0, 0, 8.0), (0, 0, 9.2), 0.8, 0.05, mat="green", seg=4)
for nx, ny in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    pts = [(nx * 0.81 + ny * math.cos(2 * math.pi * k / 16) * 0.6, ny * 0.81 - nx * math.cos(2 * math.pi * k / 16) * 0.6, 7.25 + math.sin(2 * math.pi * k / 16) * 0.6) for k in range(16)]
    p.face(pts, "clockf")
    p.box(nx * 0.82 - 0.03, nx * 0.82 + 0.03, ny * 0.82 - 0.03, ny * 0.82 + 0.03, 7.25, 7.7, "black")
p.finish("C2_Clock")

p = Part()  # サンシャイン60通りの入口のアーチ
hw = 6.0
for x in (-hw, hw):
    p.box(x - 0.25, x + 0.25, -0.25, 0.25, 0.0, 6.0, "steel")
p.box(-hw - 0.3, hw + 0.3, -0.3, 0.3, 6.0, 7.4, "navy")
for y, ny in ((-0.31, -1), (0.31, 1)):
    p.text("サンシャイン60通り", 0.9, (0, y + ny * 0.01, 6.7), (0, ny), "white")
p.finish("C2_Sunshine")

# ================= 店の前の物 =================
p = Part()  # のぼり旗の竿
p.tube((0, 0, 0), (0, 0, 2.7), 0.02, mat="steel", seg=5)
p.box(-0.15, 0.15, -0.15, 0.15, 0.0, 0.08, "dark")
p.tube((0, 0.0, 2.65), (0, 0.5, 2.65), 0.012, mat="steel", seg=4)
p.finish("C2_NoboriPole")
p = Part()  # のぼり旗の布（白。ゲームで色を付ける）
p.face([(0.0, 0.03, 0.8), (0.0, 0.5, 0.8), (0.0, 0.5, 2.62), (0.0, 0.03, 2.62)], "cloth")
p.face([(-0.001, 0.03, 0.8), (-0.001, 0.03, 2.62), (-0.001, 0.5, 2.62), (-0.001, 0.5, 0.8)], "cloth")
p.finish("C2_NoboriCloth")
p = Part()  # 立て看板（A の形の黒板）
for s in (-1, 1):
    p.face([(s * 0.25, -0.3, 0.0), (s * 0.25, 0.3, 0.0), (s * 0.02, 0.3, 0.95), (s * 0.02, -0.3, 0.95)][:: s], "black")
    p.face([(s * 0.23, -0.25, 0.2), (s * 0.23, 0.25, 0.2), (s * 0.06, 0.25, 0.8), (s * 0.06, -0.25, 0.8)][:: s], "dark")
p.text("本日", 0.12, (0.17, 0, 0.7), (1, -0.0), "white")
p.finish("C2_ABoard")
p = Part()  # とめた自転車（+Y が前）
for y in (-0.52, 0.52):
    for k in range(12):
        a, b = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
        p.tube((0, y + math.cos(a) * 0.31, 0.32 + math.sin(a) * 0.31), (0, y + math.cos(b) * 0.31, 0.32 + math.sin(b) * 0.31), 0.022, mat="tire", seg=4, caps=False)
for a, b in (((0, -0.52, 0.32), (0, -0.05, 0.35)), ((0, -0.05, 0.35), (0, 0.38, 0.75)), ((0, -0.05, 0.35), (0, -0.15, 0.8)), ((0, -0.15, 0.8), (0, 0.38, 0.75)), ((0, 0.52, 0.32), (0, 0.4, 0.9))):
    p.tube(a, b, 0.018, mat="blue", seg=4)
p.tube((-0.25, 0.4, 0.95), (0.25, 0.4, 0.95), 0.015, mat="black", seg=4)
p.box(-0.06, 0.06, -0.25, -0.05, 0.85, 0.9, "black")
p.box(-0.16, 0.16, 0.5, 0.78, 0.72, 0.92, "steel")
p.tube((0.2, -0.05, 0.1), (0.3, -0.1, 0.0), 0.012, mat="steel", seg=3)  # スタンド
p.finish("C2_Bike")
p = Part()  # 焼き芋の屋台（小さなトラックの荷台に釜と赤白のひさし、ちょうちん）
p.box(-0.75, 0.75, 1.0, 2.0, 0.3, 1.7, "white")
p.box(-0.74, 0.74, 1.55, 1.95, 1.0, 1.6, "glass")
p.box(-0.75, 0.75, -1.6, 1.0, 0.3, 0.75, "white")
for s in (-1, 1):
    for y in (1.4, -1.0):
        p.wheel(s * 0.65, y, 0.27, 0.18)
p.box(-0.55, 0.55, -1.4, 0.6, 0.75, 1.35, "dark")  # 石焼きの釜
p.tube((0.3, -1.1, 1.35), (0.3, -1.1, 2.1), 0.06, mat="steel", seg=6)  # 煙突
for k in range(6):  # 赤白のひさし
    y0 = -1.6 + k * 0.45
    p.face([(-0.95, y0, 1.95), (0.95, y0, 1.95), (0.95, y0 + 0.45, 1.95), (-0.95, y0 + 0.45, 1.95)], "red" if k % 2 == 0 else "white")
for x, y in ((-0.85, -1.5), (0.85, -1.5), (-0.85, 0.9), (0.85, 0.9)):
    p.tube((x, y, 0.75), (x, y, 1.95), 0.02, mat="steel", seg=4)
p.ellipsoid((0.9, -0.3, 1.6), 0.16, 0.16, 0.22, "lantern")
p.text("やきいも", 0.25, (0.76, -0.4, 1.1), (1, 0), "red")
p.finish("C2_Yatai")

# ================= 工事現場の重機 =================
p = Part()  # ショベルカー（黄色）
for s in (-1, 1):
    p.box(s * 1.0 - 0.3, s * 1.0 + 0.3, -1.6, 1.6, 0.0, 0.6, "dark")  # キャタピラ
p.box(-1.1, 1.1, -1.2, 1.2, 0.6, 1.2, "yellow")
p.box(-0.9, 0.0, 0.0, 1.0, 1.2, 2.5, "yellow")  # 運転席
p.box(-0.88, -0.02, 0.4, 1.01, 1.5, 2.3, "glass")
p.box(0.1, 1.0, -1.2, 0.0, 1.2, 2.0, "yellow")
p.tube((0.4, 0.8, 1.6), (0.4, 3.2, 3.6), 0.18, 0.15, mat="yellow", seg=6)  # ブーム
p.tube((0.4, 3.2, 3.6), (0.4, 4.2, 1.2), 0.13, 0.11, mat="yellow", seg=6)  # アーム
p.box(0.0, 0.8, 3.9, 4.6, 0.4, 1.2, "dark")  # バケット
p.finish("C2_Excavator")
p = Part()  # クレーン車（白い車体に黄色の伸びたブーム）
p.box(-1.2, 1.2, -4.0, 4.0, 0.4, 1.4, "white")
for s in (-1, 1):
    for y in (-2.8, -1.4, 1.6, 3.0):
        p.wheel(s * 1.05, y, 0.5, 0.35)
p.box(-1.1, 0.0, 3.0, 4.3, 1.4, 2.8, "white")
p.box(-1.09, 0.01, 3.4, 4.31, 1.9, 2.6, "glass")
p.box(-0.8, 0.8, -1.0, 1.0, 1.4, 2.4, "yellow")
p.tube((0, -0.5, 2.2), (0, 6.0, 12.0), 0.35, 0.18, mat="yellow", seg=6)
p.tube((0, 6.0, 12.0), (0, 6.0, 7.0), 0.01, mat="dark", seg=3)
p.box(-0.2, 0.2, 5.8, 6.2, 6.6, 7.0, "dark")  # フック
for x0, x1 in ((1.2, 2.4), (-2.4, -1.2)):  # 張り出し足
    for y in (-3.5, 3.5):
        p.box(x0, x1, y - 0.15, y + 0.15, 0.3, 0.6, "steel")
p.finish("C2_Crane")
p = Part()  # 足場（鉄パイプと青い網のシート）と白い仮囲い
for x in (-3.0, 0.0, 3.0):
    for y in (-0.6, 0.6):
        p.tube((x, y, 0), (x, y, 10.0), 0.03, mat="steel", seg=4)
for z in (2.0, 4.0, 6.0, 8.0, 10.0):
    for y in (-0.6, 0.6):
        p.tube((-3.0, y, z), (3.0, y, z), 0.025, mat="steel", seg=4)
p.face([(-3.0, 0.65, 1.8), (3.0, 0.65, 1.8), (3.0, 0.65, 10.2), (-3.0, 0.65, 10.2)], "sheet")
p.face([(-3.0, 0.66, 10.2), (3.0, 0.66, 10.2), (3.0, 0.66, 1.8), (-3.0, 0.66, 1.8)], "sheet")
p.box(-3.4, 3.4, 1.1, 1.2, 0.0, 2.6, "white")  # 仮囲い
p.text("工事中", 0.45, (0, 1.21, 1.6), (0, 1), "blue")
p.finish("C2_Scaffold")

# ================= 下見用 =================
for ob in objs:
    ob.hide_render = True
x = -40
for ob in objs:
    pv = ob.copy()
    pv.location = (x, 0, 0)
    x += 7 if not ob.name.startswith(("C2_Mono", "C2_Toden", "C2_Cat", "C2_Crane", "C2_Sunshine", "C2_Scaffold")) else 16
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=200)
gm = bpy.data.meshes.new("C2_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("C2_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("C2_PreviewGround", gm))
sun = bpy.data.objects.new("C2_Sun", bpy.data.lights.new("C2_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("C2_Camera", bpy.data.cameras.new("C2_Camera"))
cam.data.lens = 24
cam.data.clip_end = 2000
preview_col.objects.link(cam)
cam.location = (70, -70, 40)
cam.rotation_euler = (Vector((70, 0, 2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("C2_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city2_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
