# 街の名物の建物 3 つ（ラフォーレ原宿・高田馬場 BIG BOX・東京交通会館）と、歌舞伎町一番街のアーチ、ガード下の店、夜のネオン、
# 公園の物、歩行者の持ち物を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-city.py -- <保存先の .blend>
#
# 書き出すもの：
#   FL_Export（ラフォーレ原宿）・FBB_Export（BIG BOX）・FKK_Export（東京交通会館）  地図データ（OSM）の建物の形のとおりの建物。
#       それぞれの真ん中からの m で +X が東・+Y が北（src/render3d.js の MODELS の heading は 180）
#   CT_Export  ほかの物（原点は物の根元。+X が道の側・外側、Y が壁や道に沿う向き。歩行者の持ち物はゲームで置く点が原点）
#     CT_Kabukicho      歌舞伎町一番街のアーチ（+Y が門をくぐる向き。字は前後どちらからも読める）
#     CT_Guard0〜2      ガード下の店の正面 4m 分（やきとり・居酒屋・ラーメンの看板、のれん、赤ちょうちん）
#     CT_NeonV          縦の看板（壁から +X へ出る。白っぽく光る板で、ゲームで 1 枚ずつ色を付ける）
#     CT_NeonBand       光る帯 1m 分（Y の向きに伸ばす）
#     CT_Bench・CT_Play（すべり台とブランコ）・CT_Fountain（噴水）・CT_Toilet（公衆トイレ）
#     CT_Briefcase（右手に持つかばん。原点は肩）・CT_Backpack（背中のかばん。原点は胴体の真ん中）・
#     CT_Suitcase（引くスーツケース。原点は人の足もと）・CT_Dog（散歩の犬。原点は人の足もと）・CT_Tie（シャツとネクタイ。原点は胴体の真ん中）
# 光る部品の材質の名前は「Light」で始める。下見用は「CT_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("city.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # BIZ UDゴシック Bold（SIL Open Font License。字の形だけをモデルに入れる）
font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None
rng = random.Random(7)

FOOT = {
    "laforet": [(-20.92, 39.73), (2.72, 24.04), (13.84, 39.99), (19.05, 37.32), (26.68, 19.86), (12.42, -1.05), (7.54, -0.38), (7.19, -3.36),
                (6.66, -5.37), (6.13, -6.82), (5.13, -8.53), (4.14, -9.76), (2.59, -11.55), (0.96, -12.69), (-1.17, -13.64), (-1.18, -14.69),
                (-1.18, -15.48), (-1.39, -16.57), (-2.18, -17.88), (-3.46, -18.88), (-5.73, -19.39), (-7.51, -19.27), (-9.22, -18.42), (-40.22, 13.06)],
    "bigbox": [(-3.32, 27.58), (-1.54, 27.41), (5.55, 26.74), (10.26, 25.29), (14.29, 24), (22.3, 21.46), (30.2, 17.28), (33.76, 9.46),
               (26.22, -15.26), (17.03, -43.14), (13.68, -45.47), (5.12, -42.94), (5.61, -41.14), (-17.18, -33.92), (-17.54, -35.24), (-23.72, -33.38),
               (-22.15, -27.83), (-23.83, -27.13), (-12.09, 8.03), (-13.24, 9.62), (-11.32, 15.29), (-10.97, 16.07), (-7.8, 17.86), (-7.36, 18.11),
               (-4.63, 26.39), (-4.02, 27.27)],
    "kotsu": [(-48.8, -20.53), (11.06, 40.22), (20.76, 41.92), (55.33, 32.43), (58.07, 31.57), (58.63, 28.8), (60.26, 22.48), (27.37, -38.69),
              (-44.25, -34.31), (-48.51, -31.72), (-50.55, -28.25), (-50.6, -23.39)],
}
TO_STATION_BIGBOX = (-40.0, 0.0)  # BIG BOX から見た高田馬場駅の向き


def material(name, color, rough=0.5, metal=0.0, emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


C = lambda name, h, **kw: material(name, srgb(h), **kw)
L = lambda name, h: material(name, srgb(h), emit=srgb(h), strength=2.0)
MAT = {
    # 建物（ゲームの建物のモデルの読み込み：放射の材質は夜に灯る）
    "white": C("CT_White", 0xe6e6e0, rough=0.5),
    "silver": C("CT_Silver", 0xb9bec4, rough=0.3, metal=0.6),
    "brick": C("CT_Brick", 0x8a5a44, rough=0.8),
    "win": material("CT_Window", srgb(0x2a3440), rough=0.1, metal=0.3, emit=srgb(0xffe2b0), strength=0.6),
    "glass": material("CT_Glass", srgb(0x4a6a86), rough=0.1, metal=0.4, emit=srgb(0xffe8c0), strength=0.5),
    "roof": C("CT_Roof", 0x6e7177, rough=0.8),
    "base": C("CT_Base", 0x3a3d43, rough=0.6),
    "signw": material("CT_SignWhite", srgb(0xf4f4f0), rough=0.4, emit=srgb(0xffffff), strength=0.8),
    "signr": material("CT_SignRed", srgb(0xd8282e), rough=0.4, emit=srgb(0xff3030), strength=1.0),
    # 小物
    "pole": C("CT_Pole", 0x6b6f74, rough=0.5, metal=0.6),
    "dark": C("CT_Dark", 0x2a2d33, rough=0.6),
    "wood": C("CT_Wood", 0x7a5a3a, rough=0.8),
    "wall": C("CT_ShopWall", 0x5a4a3c, rough=0.9),
    "noren": C("CT_Noren", 0x1f2f5a, rough=0.9),
    "board": C("CT_Board", 0xf0e6c8, rough=0.6),
    "ink": C("CT_Ink", 0x1a1a1a),
    "lantern": L("Light_Lantern", 0xff4a2a),
    "neon": L("Light_Neon", 0xf8f8f8),
    "neon2": L("Light_Neon2", 0xd0d0d0),
    "redglow": L("Light_KabukiRed", 0xff2a3a),
    "concrete": C("CT_Concrete", 0x9a9c98, rough=0.9),
    "blue": C("CT_Blue", 0x2f6fd0),
    "red": C("CT_Red", 0xd03a3a),
    "yellow": C("CT_Yellow", 0xf2c200),
    "green": C("CT_Green", 0x3a9a5a),
    "water": C("CT_Water", 0x7fc4e8, rough=0.1, metal=0.2),
    "case": C("CT_Case", 0x2a2a2e, rough=0.5),
    "suitcase": C("CT_Suitcase", 0x3a6fb0, rough=0.4),
    "bag": C("CT_Bag", 0x30353d, rough=0.7),
    "dog": C("CT_Dog", 0xc89a5a, rough=0.8),
    "tie": C("CT_Tie", 0xb02a3a, rough=0.6),
    "shirt": C("CT_Shirt", 0xf2f2ee, rough=0.7),
}
MI = {k: i for i, k in enumerate(MAT)}
preview_col = bpy.data.collections.new("CT_Preview")
scene.collection.children.link(preview_col)
cols = {}


def col(name):
    if name not in cols:
        cols[name] = bpy.data.collections.new(name)
        scene.collection.children.link(cols[name])
    return cols[name]


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

    def ellipsoid(self, c, rx, ry, rz, mat, seg=8, rows=5):
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        R = [ring(math.pi * i / rows) for i in range(rows + 1)]
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)

    def prism(self, pts, z0, z1, mat, top_mat=None):
        A = [Vector((x, y, z0)) for x, y in pts]
        B = [Vector((x, y, z1)) for x, y in pts]
        n = len(pts)
        for k in range(n):
            self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], mat)
        self.face(B, top_mat or mat)

    def bands(self, pts, z0, z1, mat, out=0.04, skip=()):
        n = len(pts)
        cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
        for k in range(n):
            if k in skip:
                continue
            nx, ny, l = outward(pts, k)
            if l < 1.0:
                continue
            (ax, ay), (bx, by) = pts[k], pts[(k + 1) % n]
            self.face([(ax + nx * out, ay + ny * out, z0), (bx + nx * out, by + ny * out, z0), (bx + nx * out, by + ny * out, z1), (ax + nx * out, ay + ny * out, z1)], mat)

    def text(self, body, size, center, normal, mat, res=3):
        """字 body を center に、外向き normal（x, y）の面として立てて貼る"""
        cu = bpy.data.curves.new("CT_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = res
        if font:
            cu.font = font
        ob = bpy.data.objects.new("CT_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        nx, ny = normal
        l = math.hypot(nx, ny)
        nx, ny = nx / l, ny / l
        rx, ry = -ny, nx  # 外から見たときの右
        for poly in me.polygons:
            self.face([(center[0] + rx * me.vertices[i].co.x, center[1] + ry * me.vertices[i].co.x, center[2] + me.vertices[i].co.y) for i in poly.vertices], mat)
        ob.to_mesh_clear()
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)

    def finish(self, name, collection):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        col(collection).objects.link(ob)
        return ob


def outward(pts, k):
    n = len(pts)
    cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    (ax, ay), (bx, by) = pts[k], pts[(k + 1) % n]
    l = math.hypot(bx - ax, by - ay) or 1
    nx, ny = (by - ay) / l, -(bx - ax) / l
    if ((ax + bx) / 2 - cx) * nx + ((ay + by) / 2 - cy) * ny < 0:
        nx, ny = -nx, -ny
    return nx, ny, l


objs = []

# ================= 名物の建物 =================
# ラフォーレ原宿：白い建物と、交差点の丸い角（ガラス張り）。丸い角の上に字
p = Part()
foot = FOOT["laforet"]
H = 30.0
p.prism(foot, 0, H, "white", "roof")
curve = set(range(6, 23))  # 丸い角の辺（交差点の側）
for f in range(7):
    z = 1.0 + f * 4.0
    p.bands(foot, z + 1.2, z + 3.0, "win", skip=curve)
p.bands(foot, 0.5, H - 2.0, "glass", out=0.06, skip=set(range(len(foot))) - curve)
p.bands(foot, H - 2.0, H - 0.2, "silver", out=0.07, skip=set(range(len(foot))) - curve)
p.text("LAFORET", 1.6, (-4.5, -21.6, H - 1.1), (0.2, -1.0), "signr")
objs.append(p.finish("FL_Building", "FL_Export"))

# 高田馬場 BIG BOX：茶色いタイルの大きな箱。駅の方の面に大きな「BIG BOX」
p = Part()
foot = FOOT["bigbox"]
H = 46.0
p.prism(foot, 0, H, "brick", "roof")
best, bk = -2, 0
for k in range(len(foot)):
    nx, ny, l = outward(foot, k)
    d = nx * TO_STATION_BIGBOX[0] / 40 + ny * TO_STATION_BIGBOX[1] / 40
    if l >= 15 and d > best:
        best, bk = d, k
for f in range(10):
    z = 2.0 + f * 4.3
    p.bands(foot, z + 1.4, z + 2.8, "win", skip={bk})
nx, ny, l = outward(foot, bk)
(ax, ay), (bx, by) = foot[bk], foot[(bk + 1) % len(foot)]
mx, my = (ax + bx) / 2, (ay + by) / 2
p.text("BIG BOX", 6.0, (mx + nx * 0.08, my + ny * 0.08, H - 12.0), (nx, ny), "signw")
p.bands(foot, 0.0, 4.0, "glass", out=0.06)
objs.append(p.finish("FBB_Building", "FBB_Export"))

# 東京交通会館：白い横長の建物と、屋上の丸い展望レストラン
p = Part()
foot = FOOT["kotsu"]
H = 45.0
p.prism(foot, 0, H, "white", "roof")
for f in range(12):
    z = 1.5 + f * 3.6
    p.bands(foot, z + 1.0, z + 2.6, "win")
cx, cy = 8.0, 2.0
ring = lambda r, z, n=24: [Vector((cx + math.cos(2 * math.pi * k / n) * r, cy + math.sin(2 * math.pi * k / n) * r, z)) for k in range(n)]
A, B, Cc, D = ring(11, H), ring(13, H + 1.2), ring(13, H + 4.6), ring(11, H + 5.6)
for k in range(24):
    p.face([A[k], A[(k + 1) % 24], B[(k + 1) % 24], B[k]], "silver")
    p.face([B[k], B[(k + 1) % 24], Cc[(k + 1) % 24], Cc[k]], "glass")
    p.face([Cc[k], Cc[(k + 1) % 24], D[(k + 1) % 24], D[k]], "silver")
p.face(D, "roof")
p.text("東京交通会館", 3.0, (cx, cy - 13.1, H + 7.6), (0, -1), "signr")
p.box(cx - 10, cx + 10, cy - 13.2, cy - 13.0, H + 6.2, H + 9.0, "white")
objs.append(p.finish("FKK_Building", "FKK_Export"))

# ================= 歌舞伎町一番街のアーチ =================
p = Part()
hw = 5.5
for x in (-hw, hw):
    p.box(x - 0.25, x + 0.25, -0.25, 0.25, 0.0, 6.0, "dark")
p.box(-hw - 0.4, hw + 0.4, -0.35, 0.35, 6.0, 8.0, "dark")
for y, facing in ((-0.36, -1), (0.36, 1)):
    # 赤く光る字（前後どちらからも読める）
    p.text("歌舞伎町一番街", 1.15, (0, y + facing * 0.01, 7.0), (0, facing), "redglow")
p.box(-hw - 0.4, hw + 0.4, -0.37, 0.37, 7.85, 8.0, "redglow")
p.box(-hw - 0.4, hw + 0.4, -0.37, 0.37, 6.0, 6.15, "redglow")
objs.append(p.finish("CT_Kabukicho", "CT_Export"))

# ================= ガード下の店（4m 分） =================
for i, word in enumerate(("やきとり", "居酒屋", "ラーメン")):
    p = Part()
    p.box(-0.3, 0.0, -2.0, 2.0, 0.0, 3.8, "wall")
    p.box(0.0, 0.06, -1.6, 1.6, 0.0, 2.4, "glass")  # 店の中の明かり
    p.box(0.0, 0.1, -2.0, -1.6, 0.0, 3.8, "wood")
    p.box(0.0, 0.1, 1.6, 2.0, 0.0, 3.8, "wood")
    p.box(0.0, 0.5, -2.0, 2.0, 2.4, 2.55, "wood")  # 軒
    for k in range(4):  # のれん
        y = -1.2 + k * 0.62
        p.box(0.08, 0.1, y - 0.28, y + 0.28, 1.75, 2.38, "noren")
    p.box(0.02, 0.14, -1.6, 1.6, 2.7, 3.5, "board")  # 看板
    p.text(word, 0.55, (0.15, 0, 3.1), (1, 0), "ink")
    for y in (-1.8, 1.8):  # 赤ちょうちん
        p.tube((0.45, y, 2.5), (0.45, y, 2.3), 0.01, mat="dark", seg=4)
        p.ellipsoid((0.45, y, 2.05), 0.18, 0.18, 0.26, "lantern")
    objs.append(p.finish(f"CT_Guard{i}", "CT_Export"))

# ================= 夜のネオン =================
p = Part()  # 縦の看板（壁から +X へ。1 枚の板に、明るさの違う段）
p.box(0.0, 0.6, -0.08, 0.08, 0.0, 0.3, "pole")
p.box(0.0, 0.6, -0.08, 0.08, 6.7, 7.0, "pole")
p.box(0.4, 0.55, -0.6, 0.6, 0.2, 6.8, "neon")
for k in range(5):
    z = 0.5 + k * 1.25
    for y in (-0.62, 0.62):
        p.face([(0.38, y, z), (0.57, y, z), (0.57, y, z + 0.9), (0.38, y, z + 0.9)], "neon2")
objs.append(p.finish("CT_NeonV", "CT_Export"))
p = Part()  # 光る帯 1m 分
p.box(0.0, 0.12, -0.5, 0.5, 0.0, 0.35, "neon")
objs.append(p.finish("CT_NeonBand", "CT_Export"))

# ================= 公園の物 =================
p = Part()  # ベンチ
for y in (-0.7, 0.7):
    p.box(-0.25, 0.25, y - 0.04, y + 0.04, 0.0, 0.42, "pole")
p.box(-0.25, 0.25, -0.9, 0.9, 0.42, 0.47, "wood")
p.box(-0.28, -0.24, -0.9, 0.9, 0.5, 0.85, "wood")
objs.append(p.finish("CT_Bench", "CT_Export"))
p = Part()  # すべり台とブランコ
p.box(-0.6, 0.6, -2.4, -1.8, 0.0, 1.8, "red")  # すべり台の台
for x in (-0.6, 0.6):
    p.tube((x, -2.4, 0), (x, -3.2, 1.8), 0.04, mat="yellow", seg=4)  # 階段の柱
p.face([(-0.45, -1.8, 1.8), (0.45, -1.8, 1.8), (0.45, 0.6, 0.2), (-0.45, 0.6, 0.2)], "blue")  # すべる面
for x in (-0.48, 0.48):
    p.face([(x, -1.8, 1.8), (x, 0.6, 0.2), (x, 0.6, 0.45), (x, -1.8, 2.05)], "blue")
for x in (1.6, 4.0):  # ブランコの柱（A の形）
    for y in (-1.3, 0.7):
        p.tube((x, y, 0), (x, -0.3, 2.4), 0.05, mat="green", seg=5)
p.tube((1.6, -0.3, 2.4), (4.0, -0.3, 2.4), 0.05, mat="green", seg=5)
for x in (2.3, 3.3):  # 鎖と座る板
    for dx in (-0.2, 0.2):
        p.tube((x + dx, -0.3, 2.4), (x + dx, -0.3, 0.55), 0.008, mat="pole", seg=3)
    p.box(x - 0.25, x + 0.25, -0.45, -0.15, 0.5, 0.56, "yellow")
objs.append(p.finish("CT_Play", "CT_Export"))
p = Part()  # 噴水（丸い池と真ん中の水の柱）
ringO = [(math.cos(2 * math.pi * k / 20) * 3.0, math.sin(2 * math.pi * k / 20) * 3.0) for k in range(20)]
ringI = [(x * 0.88, y * 0.88) for x, y in ringO]
p.prism(ringO, 0, 0.5, "concrete")
p.face([(x, y, 0.42) for x, y in ringI], "water")
p.tube((0, 0, 0.4), (0, 0, 1.2), 0.4, 0.3, mat="concrete", seg=10)
p.tube((0, 0, 1.2), (0, 0, 3.2), 0.12, 0.35, mat="water", seg=8)
p.ellipsoid((0, 0, 3.2), 0.5, 0.5, 0.25, "water")
objs.append(p.finish("CT_Fountain", "CT_Export"))
p = Part()  # 公衆トイレ（小さな建物・屋根・入口の色の板）
p.box(-2.0, 2.0, -3.0, 3.0, 0.0, 2.8, "white")
p.box(-2.3, 2.3, -3.3, 3.3, 2.8, 3.1, "roof")
p.box(2.0, 2.05, -2.2, -0.8, 0.0, 2.1, "dark")
p.box(2.0, 2.05, 0.8, 2.2, 0.0, 2.1, "dark")
p.box(2.05, 2.08, -1.8, -1.2, 2.2, 2.6, "blue")
p.box(2.05, 2.08, 1.2, 1.8, 2.2, 2.6, "red")
p.text("トイレ", 0.32, (2.09, 0, 2.45), (1, 0), "ink")
objs.append(p.finish("CT_Toilet", "CT_Export"))

# ================= 歩行者の持ち物 =================
p = Part()  # 右手に持つかばん（原点は肩。腕と一緒に振る）
p.box(-0.04, 0.04, -0.03, 0.03, -0.66, -0.58, "case")
p.box(-0.05, 0.05, -0.2, 0.2, -0.95, -0.66, "case")
objs.append(p.finish("CT_Briefcase", "CT_Export"))
p = Part()  # 背中のかばん（原点は胴体の真ん中。後ろは -Y）
p.box(-0.16, 0.16, -0.27, -0.12, -0.22, 0.22, "bag")
p.box(-0.13, 0.13, -0.3, -0.27, -0.18, 0.05, "bag")
objs.append(p.finish("CT_Backpack", "CT_Export"))
p = Part()  # 引くスーツケース（原点は人の足もと。右うしろ）
p.box(0.3, 0.5, -0.75, -0.35, 0.06, 0.7, "suitcase")
p.tube((0.4, -0.38, 0.7), (0.4, -0.12, 0.95), 0.012, mat="pole", seg=4)
for y in (-0.72, -0.38):
    p.tube((0.29, y, 0.04), (0.51, y, 0.04), 0.035, mat="dark", seg=6)
objs.append(p.finish("CT_Suitcase", "CT_Export"))
p = Part()  # 散歩の犬（原点は人の足もと。左前）とリード
p.ellipsoid((-0.55, 0.45, 0.32), 0.12, 0.25, 0.12, "dog")
p.ellipsoid((-0.55, 0.72, 0.43), 0.09, 0.11, 0.09, "dog")
p.ellipsoid((-0.55, 0.82, 0.41), 0.04, 0.06, 0.04, "dark")
for x in (-0.62, -0.48):
    for y in (0.3, 0.6):
        p.tube((x, y, 0.28), (x, y, 0.0), 0.025, mat="dog", seg=4)
p.tube((-0.55, 0.3, 0.38), (-0.55, 0.15, 0.5), 0.02, mat="dog", seg=4)
p.tube((-0.55, 0.7, 0.42), (-0.25, 0.15, 0.85), 0.006, mat="red", seg=3)
objs.append(p.finish("CT_Dog", "CT_Export"))
p = Part()  # シャツの襟元とネクタイ（原点は胴体の真ん中。前は +Y）
p.face([(-0.09, 0.122, 0.3), (0.09, 0.122, 0.3), (0.0, 0.124, 0.08)], "shirt")
p.face([(-0.025, 0.126, 0.27), (0.025, 0.126, 0.27), (0.035, 0.126, -0.12), (0.0, 0.126, -0.17), (-0.035, 0.126, -0.12)], "tie")
objs.append(p.finish("CT_Tie", "CT_Export"))

# ================= 下見用 =================
for c in cols.values():
    c.hide_render = True
spots = {"FL_Building": (-200, 0, 0), "FBB_Building": (-90, 0, 0), "FKK_Building": (60, 0, 0)}
x0 = -30
for ob in objs:
    pv = ob.copy()
    if ob.name in spots:
        pv.location = spots[ob.name]
    else:
        pv.location = (x0, -90, 0)
        x0 += 9
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=400)
gm = bpy.data.meshes.new("CT_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("CT_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("CT_PreviewGround", gm))
sun = bpy.data.objects.new("CT_Sun", bpy.data.lights.new("CT_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("CT_Camera", bpy.data.cameras.new("CT_Camera"))
cam.data.lens = 24
cam.data.clip_end = 3000
preview_col.objects.link(cam)
cam.location = (-20, -260, 90)
cam.rotation_euler = (Vector((-50, -30, 10)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("CT_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1000
scene.render.filepath = os.path.join(os.path.dirname(out), "city_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in objs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
