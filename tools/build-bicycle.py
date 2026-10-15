# プレイヤーの自転車と乗っている人を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-bicycle.py -- <保存先の .blend>
#
# ゲーム（src/render3d.js の BIKE）と同じ寸法・向きにする。原点は地面の上の自転車の真ん中。
# Blender の +Y が進む向き（glb では -z、ゲームの自転車の前）、X は左右、Z は高さ。
# 動く部品は別の物にして、ゲームで動かす：
#   BK_Frame  フレーム・フォーク・ハンドル・サドル・チェーン・ボトル（動かない）
#   BK_Rider  乗っている人の胴体・頭とヘルメット・ハンドルを握る腕（動かない。前かがみ）
#   BK_FrameCity・BK_FrameEbike  ママチャリと電動アシスト自転車のフレーム（かご・泥よけ・荷台など。電動は電池と子ども乗せも）
#   BK_RiderUp  背すじを立てて乗る人（ママチャリ・電動アシスト自転車用）
#   BK_Poncho・BK_PonchoUp  雨の日の合羽（前かがみ用・背すじを立てた人用。材質 BK_Poncho）
#   BK_Wheel  車輪 1 つ（原点は車軸。前後の車輪に使い、x 軸まわりに回す）
#   BK_Crank  クランク・ギア・ペダル（原点はペダルの軸。x 軸まわりに回す）
#   BK_Thigh  太もも、BK_Shin すね（長さ 1・太さ 1 の筒。ゲームで腰→ひざ、ひざ→ペダルに伸ばして置く。-Z の端が腰・ひざ側）
#   BK_Shoe   靴（原点はペダルの位置。向きは自転車と同じ）
# 材質の名前で色を決める（ゲームのゴーストは同じ名前の材質を白くする）：
#   BK_Frame・BK_Metal・BK_Saddle（サドル・握り・ペダル・靴・手袋・サングラス）・BK_Tire・BK_Jersey・BK_Shorts・
#   BK_Skin・BK_Helmet（ヘルメット・ジャージの線・ボトル）。BK_Sock（靴下）はいつも白。
# 書き出すものはコレクション「BK_Export」、下見用の地面・カメラ・光・組み立てた脚は「BK_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("bicycle.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def G(x, y, z):
    """ゲームの座標（x, 高さ y, 前が -z）を Blender の座標にする"""
    return Vector((x, -z, y))


# ---- 寸法（src/render3d.js の BIKE と同じ。ゲームの座標） ----
WHEEL_R = 0.34
REAR, FRONT = G(0, WHEEL_R, 0.52), G(0, WHEEL_R, -0.53)
BB = G(0, 0.3, 0.06)
SEAT = G(0, 0.86, 0.2)
HEAD_TOP, HEAD_BOTTOM = G(0, 0.9, -0.38), G(0, 0.74, -0.42)
SADDLE = G(0, 0.97, 0.24)
BAR = G(0, 1.02, -0.36)
CRANK = 0.17
HIP = G(0, 1.03, 0.21)
SHOULDER = G(0, 1.43, -0.12)
THIGH = SHIN = 0.46


def material(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def srgb(h):
    """0xRRGGBB（ゲームの色）を Blender の色（リニア）にする"""
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {
    "frame": material("BK_Frame", srgb(0xffcc33), rough=0.3, metal=0.2),
    "metal": material("BK_Metal", srgb(0x9aa0aa), rough=0.3, metal=0.6),
    "dark": material("BK_Saddle", srgb(0x15171b), rough=0.6),
    "tire": material("BK_Tire", srgb(0x1b1d22), rough=0.9),
    "jersey": material("BK_Jersey", srgb(0xffcc33), rough=0.7),
    "shorts": material("BK_Shorts", srgb(0x22324f), rough=0.7),
    "skin": material("BK_Skin", srgb(0xf2d0a9), rough=0.7),
    "accent": material("BK_Helmet", srgb(0xe8443a), rough=0.4),
    "sock": material("BK_Sock", srgb(0xf4f4f4), rough=0.8),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("BK_Export")
preview_col = bpy.data.collections.new("BK_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def loft(self, pts, radii, mats, seg=8, u=None, v=None, caps=(True, True)):
        """点 pts を通る筒。radii は太さ（数か (左右, 前後) の組）、mats は区間ごとの材質"""
        pts = [Vector(p) for p in pts]
        if u is None:
            d = (pts[-1] - pts[0]).normalized()
            up = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
            u = d.cross(up).normalized()
            v = d.cross(u).normalized()
        rings = []
        for p, r in zip(pts, radii):
            rx, ry = r if isinstance(r, tuple) else (r, r)
            rings.append([p + u * (math.cos(2 * math.pi * k / seg) * rx) + v * (math.sin(2 * math.pi * k / seg) * ry) for k in range(seg)])
        if isinstance(mats, str):
            mats = [mats] * (len(pts) - 1)
        for i, (A, B) in enumerate(zip(rings, rings[1:])):
            for k in range(seg):
                self.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], mats[i])
        if caps[0]:
            self.face(rings[0][::-1], mats[0])
        if caps[1]:
            self.face(rings[-1], mats[-1])

    def tube(self, a, b, r0, r1=None, mat="frame", seg=8):
        self.loft([a, b], [r0, r0 if r1 is None else r1], mat, seg)

    def prism_x(self, profile, x0, x1, mat):
        """横から見た形 profile（y, z）を x0〜x1 の厚さにした板"""
        A = [Vector((x0, y, z)) for y, z in profile]
        B = [Vector((x1, y, z)) for y, z in profile]
        self.face(A[::-1], mat)
        self.face(B, mat)
        n = len(profile)
        for k in range(n):
            self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], mat)

    def box(self, c, sx, sy, sz, mat):
        x, y, z = c
        self.prism_x([(y - sy, z - sz), (y + sy, z - sz), (y + sy, z + sz), (y - sy, z + sz)], x - sx, x + sx, mat)

    def ellipsoid(self, c, rx, ry, rz, mat, seg=12, rows=7, top=1.0):
        """だ円の球（top < 1 は上から top の割合までの帽子の形）"""
        c = Vector(c)
        ring = lambda t: [c + Vector((math.cos(2 * math.pi * k / seg) * math.sin(t) * rx, math.sin(2 * math.pi * k / seg) * math.sin(t) * ry, math.cos(t) * rz)) for k in range(seg)]
        pole = c + Vector((0, 0, rz))
        ts = [math.pi * top * (i + 1) / rows for i in range(rows)]
        R = [ring(t) for t in ts]
        for k in range(seg):
            self.face([pole, R[0][k], R[0][(k + 1) % seg]], mat)
        for A, B in zip(R, R[1:]):
            for k in range(seg):
                self.face([A[k], B[k], B[(k + 1) % seg], A[(k + 1) % seg]], mat)
        return R[-1]

    def finish(self, name, col=export_col):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        return ob


# ---- フレーム・ハンドル・サドル・チェーン ----
f = Part()
f.tube(SEAT + Vector((0, 0, 0.02)), HEAD_TOP, 0.022, 0.024)  # トップチューブ
f.tube(BB, HEAD_BOTTOM, 0.03, 0.026)  # ダウンチューブ
f.tube(BB, SEAT + Vector((0, 0, 0.03)), 0.025, 0.022)  # シートチューブ
f.tube(HEAD_BOTTOM + (HEAD_BOTTOM - HEAD_TOP) * 0.15, HEAD_TOP + (HEAD_TOP - HEAD_BOTTOM) * 0.15, 0.032)  # ヘッドチューブ
f.box(BB, 0.04, 0.035, 0.035, "frame")  # ペダルの軸のまわり
for s in (-1, 1):
    f.tube(Vector((s * 0.025, BB.y - 0.02, BB.z)), Vector((s * 0.065, REAR.y, REAR.z)), 0.014, 0.01)  # チェーンステー
    f.tube(Vector((s * 0.02, SEAT.y + 0.01, SEAT.z - 0.05)), Vector((s * 0.065, REAR.y, REAR.z)), 0.012, 0.009)  # シートステー
    f.tube(Vector((s * 0.04, HEAD_BOTTOM.y - 0.01, HEAD_BOTTOM.z - 0.03)), Vector((s * 0.06, FRONT.y, FRONT.z)), 0.016, 0.01)  # フォーク
    f.box(Vector((s * 0.065, REAR.y, REAR.z)), 0.008, 0.02, 0.02, "frame")  # 後ろの車軸の受け
f.box(HEAD_BOTTOM + Vector((0, 0, -0.03)), 0.06, 0.03, 0.02, "frame")  # フォークの肩
f.box(Vector((0, HEAD_BOTTOM.y + 0.03, HEAD_BOTTOM.z - 0.06)), 0.05, 0.015, 0.012, "metal")  # 前のブレーキ
f.box(Vector((0, SEAT.y - 0.06, SEAT.z - 0.1)), 0.05, 0.015, 0.012, "metal")  # 後ろのブレーキ
# ハンドル：ステム・横のバー・握り・ブレーキのレバー
f.tube(HEAD_TOP, BAR + Vector((0, 0.03, 0)), 0.018, 0.016, "metal")
f.tube(BAR + Vector((-0.28, 0, 0)), BAR + Vector((0.28, 0, 0)), 0.014, mat="metal")
for s in (-1, 1):
    f.tube(BAR + Vector((s * 0.19, 0, 0)), BAR + Vector((s * 0.285, 0, 0)), 0.021, mat="dark")
    f.tube(BAR + Vector((s * 0.17, 0.02, 0.005)), BAR + Vector((s * 0.22, 0.11, -0.02)), 0.006, mat="metal")
# サドルとシートポスト
f.tube(SEAT, SADDLE + Vector((0, 0.01, -0.03)), 0.015, mat="metal")
outline = [(0.02, -0.1), (0.035, -0.19), (0.072, -0.29), (0.06, -0.37)]
sad = [Vector((x, SADDLE.y + 0.13 + (y + 0.1), 0)) for x, y in outline]  # 前（鼻）から後ろへ
pts = [Vector((-p.x, p.y, 0)) for p in sad] + [Vector((p.x, p.y, 0)) for p in sad[::-1]]
lo = [p + Vector((0, 0, SADDLE.z - 0.025)) for p in pts]
hi = [p + Vector((0, 0, SADDLE.z + 0.02)) for p in pts]
f.face(lo[::-1], "dark")
f.face(hi, "dark")
for k in range(len(pts)):
    f.face([lo[k], lo[(k + 1) % len(pts)], hi[(k + 1) % len(pts)], hi[k]], "dark")
# 後ろのギア（車輪と一緒に回っても同じに見えるのでここに置く）・チェーン・変速機
f.loft([REAR + Vector((0.05, 0, 0)), REAR + Vector((0.075, 0, 0))], [0.045, 0.03], "metal", seg=12)
for (ya, za), (yb, zb) in (((BB.y, BB.z + 0.092), (REAR.y, REAR.z + 0.045)), ((BB.y, BB.z - 0.092), (REAR.y + 0.03, REAR.z - 0.08))):
    f.tube(Vector((0.055, ya, za)), Vector((0.055, yb, zb)), 0.006, mat="metal", seg=4)
f.tube(Vector((0.055, REAR.y + 0.03, REAR.z - 0.08)), Vector((0.06, REAR.y, REAR.z - 0.045)), 0.006, mat="metal", seg=4)
f.box(Vector((0.07, REAR.y + 0.015, REAR.z - 0.07)), 0.012, 0.02, 0.035, "dark")
# ボトルとボトルのかご（ダウンチューブの上）
d = (HEAD_BOTTOM - BB).normalized()
n = Vector((0, -d.z, d.y))  # ダウンチューブに直角で上向き
b0 = BB + d * 0.14 + n * 0.06
f.loft([b0, b0 + d * 0.17, b0 + d * 0.2, b0 + d * 0.23], [0.035, 0.035, 0.02, 0.012], ["accent", "accent", "dark"], seg=10)
frame = f.finish("BK_Frame")

# ---- 車輪（タイヤ・リム・スポーク・ハブ） ----
w = Part()
SEG = 24
TR, TT = WHEEL_R - 0.02, 0.025
tor = [[Vector((math.cos(2 * math.pi * j / 6) * TT, math.cos(2 * math.pi * k / SEG) * (TR + math.sin(2 * math.pi * j / 6) * TT),
                math.sin(2 * math.pi * k / SEG) * (TR + math.sin(2 * math.pi * j / 6) * TT))) for j in range(6)] for k in range(SEG)]
for k in range(SEG):
    for j in range(6):
        A, B = tor[k], tor[(k + 1) % SEG]
        w.face([A[j], A[(j + 1) % 6], B[(j + 1) % 6], B[j]], "tire")
rim_r = (TR - TT, TR - TT - 0.03)
for k in range(SEG):
    a, b = 2 * math.pi * k / SEG, 2 * math.pi * (k + 1) / SEG
    p = lambda t, r, x: Vector((x, math.cos(t) * r, math.sin(t) * r))
    for x in (-0.012, 0.012):
        w.face([p(a, rim_r[0], x), p(b, rim_r[0], x), p(b, rim_r[1], x), p(a, rim_r[1], x)], "metal")
    w.face([p(a, rim_r[1], -0.012), p(b, rim_r[1], -0.012), p(b, rim_r[1], 0.012), p(a, rim_r[1], 0.012)], "metal")
for k in range(16):  # スポーク（左右のハブのつばから交互に）
    t = 2 * math.pi * k / 16
    x = 0.03 if k % 2 else -0.03
    w.tube(Vector((x, math.cos(t + 0.3) * 0.03, math.sin(t + 0.3) * 0.03)), Vector((0, math.cos(t) * rim_r[1], math.sin(t) * rim_r[1])), 0.0035, mat="metal", seg=3)
w.loft([Vector((-0.05, 0, 0)), Vector((-0.03, 0, 0)), Vector((0.03, 0, 0)), Vector((0.05, 0, 0))], [0.012, 0.035, 0.035, 0.012], ["metal", "metal", "metal"], seg=10)
wheel = w.finish("BK_Wheel")

# ---- クランク・前のギア・ペダル（原点はペダルの軸。右のペダルが上の向き） ----
c = Part()
TEETH = 30
star = [(math.cos(math.pi * k / TEETH) * r, math.sin(math.pi * k / TEETH) * r) for k, r in zip(range(2 * TEETH), [0.095, 0.088] * TEETH)]
c.prism_x(star, 0.045, 0.052, "metal")
c.loft([Vector((-0.07, 0, 0)), Vector((0.07, 0, 0))], [0.018, 0.018], "metal", seg=8)
for s in (-1, 1):
    c.tube(Vector((s * 0.075, 0, 0)), Vector((s * 0.085, 0, s * CRANK)), 0.016, 0.012, "metal", seg=6)
    p = Vector((s * 0.125, 0, s * CRANK))
    c.box(p, 0.045, 0.04, 0.01, "dark")
    c.tube(Vector((s * 0.08, 0, s * CRANK)), p, 0.006, mat="metal", seg=4)
crank = c.finish("BK_Crank")

# ---- 乗っている人の胴体・頭・腕 ----
# 前かがみ（ロードバイク）と、背すじを立てた姿勢（ママチャリ・電動アシスト自転車）の 2 つ。
# hip・shoulder は腰と肩、grip はハンドルを握る位置（右手）、elbow は腕の真ん中からひじをずらす向き
def make_rider(name, hip, shoulder, grip, elbow, head_up, glasses):
    r = Part()
    ax = (shoulder - hip).normalized()
    belly = Vector((0, ax.z, -ax.y))  # 胴体に直角で前（おなか）向き
    torso = [(-0.07, 0.13, 0.08), (0.0, 0.17, 0.11), (0.1, 0.16, 0.1), (0.24, 0.155, 0.1), (0.27, 0.16, 0.105), (0.31, 0.17, 0.11),
             (0.42, 0.19, 0.12), (0.5, 0.19, 0.1), (0.56, 0.1, 0.06)]
    r.loft([hip + ax * t for t, _, _ in torso], [(wx, dy) for _, wx, dy in torso],
           ["shorts", "shorts", "jersey", "accent", "jersey", "jersey", "jersey", "jersey"], seg=10, u=Vector((1, 0, 0)), v=belly)
    head = shoulder + head_up
    r.tube(shoulder + ax * 0.08, head + Vector((0, -0.03, -0.06)), 0.05, 0.045, "skin")
    r.ellipsoid(head, 0.1, 0.11, 0.11, "skin", seg=10, rows=6)
    # ヘルメット（後ろに少し長い）・通気の溝・サングラス
    hc = head + Vector((0, -0.01, 0.02))
    r.ellipsoid(hc, 0.125, 0.15, 0.12, "accent", seg=12, rows=4, top=0.55)
    for x in (-0.045, 0, 0.045):
        r.loft([hc + Vector((x, 0.08, 0.09)), hc + Vector((x, 0, 0.113)), hc + Vector((x, -0.08, 0.09))], [0.006, 0.006, 0.006], "dark", seg=4)
    if glasses:
        gl = [head + Vector((math.sin(t) * 0.112, math.cos(t) * 0.112, 0.01)) for t in [math.radians(a) for a in range(-75, 76, 25)]]
        for a, b in zip(gl, gl[1:]):
            r.face([a + Vector((0, 0, -0.02)), b + Vector((0, 0, -0.02)), b + Vector((0, 0, 0.02)), a + Vector((0, 0, 0.02))], "dark")
    else:  # 目と、ヘルメットのあごひも
        for x in (-0.035, 0.035):
            r.box(head + Vector((x, 0.104, 0.015)), 0.012, 0.006, 0.012, "dark")
        for x in (-0.095, 0.095):
            r.tube(hc + Vector((x, 0.02, -0.03)), head + Vector((x * 0.6, 0.06, -0.1)), 0.006, mat="dark", seg=4)
    for s in (-1, 1):
        sh = shoulder + Vector((s * 0.17, 0, -0.02))
        gr = Vector((s * grip.x, grip.y, grip.z))
        el = sh.lerp(gr, 0.5) + Vector((s * elbow.x, elbow.y, elbow.z))
        mid = sh.lerp(el, 0.55)
        r.loft([sh, mid, el], [0.05, 0.042, 0.034], ["jersey", "skin"])
        wrist = el.lerp(gr, 0.75)
        r.loft([el, wrist, gr + (gr - el).normalized() * 0.02], [0.033, 0.026, 0.03], ["skin", "dark"])
    return r.finish(name)


rider = make_rider("BK_Rider", HIP, SHOULDER, G(0.24, 1.04, -0.36), Vector((0.008, 0.02, 0.005)), Vector((0, 0.1, 0.2)), True)
# 背すじを立てた姿勢（src/render3d.js の BIKE_TYPES.city と同じ）
UP_HIP, UP_SHOULDER = G(0, 0.98, 0.25), G(0, 1.46, 0.08)
UP_GRIP = G(0.27, 1.075, -0.2)
rider_up = make_rider("BK_RiderUp", UP_HIP, UP_SHOULDER, UP_GRIP, Vector((0.05, 0.0, -0.07)), Vector((0, 0.04, 0.21)), False)

# ---- 雨の日の合羽（胴体をおおうポンチョ。腰の下まで広がる。ゲームで雨の日だけ出す） ----
def make_poncho(name, hip, shoulder):
    r = Part()
    ax = (shoulder - hip).normalized()
    belly = Vector((0, ax.z, -ax.y))
    rings = [(-0.22, 0.27, 0.2), (-0.05, 0.25, 0.17), (0.15, 0.22, 0.155), (0.35, 0.235, 0.16), (0.5, 0.215, 0.135), (0.6, 0.11, 0.09)]
    r.loft([hip + ax * t + belly * 0.01 for t, _, _ in rings], [(wx, dy) for _, wx, dy in rings], "poncho", seg=12,
           u=Vector((1, 0, 0)), v=belly, caps=(False, False))
    return r.finish(name)


MAT["poncho"] = material("BK_Poncho", srgb(0xbfe0f0), rough=0.2)
MI["poncho"] = len(MI)
poncho = make_poncho("BK_Poncho", HIP, SHOULDER)
poncho_up = make_poncho("BK_PonchoUp", UP_HIP, UP_SHOULDER)

# ---- ママチャリと電動アシスト自転車のフレーム ----
# 低くまたげる曲がったフレーム・後ろに引いたハンドル・前かご・泥よけ・荷台・チェーンカバー・スタンド・ライト。
# 電動アシスト自転車は、さらにシートチューブの後ろの電池・ペダルの軸のモーター・ハンドルの表示・荷台の子ども乗せ
C_HEAD_TOP, C_HEAD_BOTTOM = G(0, 0.95, -0.4), G(0, 0.76, -0.44)
C_SEAT, C_SADDLE = G(0, 0.8, 0.2), G(0, 0.92, 0.255)


def fender(p, axle, a0, a1, rad=WHEEL_R + 0.035, half=0.03, n=10):
    """車輪の上の泥よけ（axle のまわり、角度 a0〜a1。0 が前、90° が真上）"""
    pts = [axle + Vector((0, math.cos(math.radians(a0 + (a1 - a0) * k / n)) * rad, math.sin(math.radians(a0 + (a1 - a0) * k / n)) * rad)) for k in range(n + 1)]
    for a, b in zip(pts, pts[1:]):
        p.face([a + Vector((-half, 0, 0)), b + Vector((-half, 0, 0)), b + Vector((half, 0, 0)), a + Vector((half, 0, 0))], "metal")
        p.face([a + Vector((half, 0, 0)), b + Vector((half, 0, 0)), b + Vector((-half, 0, 0)), a + Vector((-half, 0, 0))], "metal")


def basket(p, c, sx, sy, sz):
    """針金のかご（c は底の真ん中。sx 左右・sy 前後・sz 高さの半分ではなく全体）"""
    for z in (0, sz * 0.5, sz):
        q = [c + Vector((x, y, z)) for x, y in ((-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2))]
        for a, b in zip(q, q[1:] + q[:1]):
            p.tube(a, b, 0.006 if z else 0.008, mat="metal", seg=4)
    for k in range(7):
        x = -sx / 2 + sx * k / 6
        for y in (-sy / 2, sy / 2):
            p.tube(c + Vector((x, y, 0)), c + Vector((x, y, sz)), 0.004, mat="metal", seg=3)
    for k in range(1, 5):
        y = -sy / 2 + sy * k / 5
        for x in (-sx / 2, sx / 2):
            p.tube(c + Vector((x, y, 0)), c + Vector((x, y, sz)), 0.004, mat="metal", seg=3)
    p.box(c + Vector((0, 0, 0.004)), sx / 2, sy / 2, 0.004, "metal")  # 底の板


def city_frame(name, ebike):
    p = Part()
    # 曲がったメインのパイプ（ヘッドから低く下りてペダルの軸へ）
    p.loft([C_HEAD_BOTTOM + Vector((0, 0.01, 0.06)), G(0, 0.6, -0.33), G(0, 0.42, -0.2), G(0, 0.34, -0.06), BB + Vector((0, 0, 0.01))],
           [0.03, 0.03, 0.03, 0.03, 0.03], "frame", seg=8)
    p.tube(BB, C_SEAT + Vector((0, 0, 0.03)), 0.027, 0.024)  # シートチューブ
    p.tube(C_HEAD_BOTTOM + (C_HEAD_BOTTOM - C_HEAD_TOP) * 0.15, C_HEAD_TOP + (C_HEAD_TOP - C_HEAD_BOTTOM) * 0.15, 0.033)  # ヘッドチューブ
    p.box(BB, 0.045, 0.04, 0.04, "frame")
    for s in (-1, 1):
        p.tube(Vector((s * 0.025, BB.y - 0.02, BB.z)), Vector((s * 0.065, REAR.y, REAR.z)), 0.015, 0.011)  # チェーンステー
        p.tube(Vector((s * 0.02, C_SEAT.y + 0.01, C_SEAT.z - 0.05)), Vector((s * 0.065, REAR.y, REAR.z)), 0.013, 0.01)  # シートステー
        p.tube(Vector((s * 0.04, C_HEAD_BOTTOM.y - 0.01, C_HEAD_BOTTOM.z - 0.03)), Vector((s * 0.06, FRONT.y, FRONT.z)), 0.017, 0.011)  # フォーク
    p.box(C_HEAD_BOTTOM + Vector((0, 0, -0.03)), 0.06, 0.03, 0.02, "frame")
    # 後ろに引いたハンドル・握り・ベル
    stem = C_HEAD_TOP + Vector((0, 0.02, 0.12))
    p.tube(C_HEAD_TOP, stem, 0.018, mat="metal")
    gx, gy, gz = UP_GRIP
    bar = [Vector((-gx - 0.03, gy - 0.02, gz)), Vector((-0.22, stem.y - 0.02, stem.z)), Vector((0, stem.y, stem.z)),
           Vector((0.22, stem.y - 0.02, stem.z)), Vector((gx + 0.03, gy - 0.02, gz))]
    for a, b in zip(bar, bar[1:]):
        p.tube(a, b, 0.012, mat="metal", seg=6)
    for s in (-1, 1):
        p.tube(Vector((s * (gx - 0.06), gy + 0.01, gz)), Vector((s * (gx + 0.04), gy - 0.03, gz)), 0.02, mat="dark", seg=8)
        p.tube(Vector((s * 0.16, stem.y - 0.01, stem.z)), Vector((s * 0.2, stem.y - 0.1, stem.z - 0.02)), 0.006, mat="metal", seg=4)  # ブレーキのレバー
    p.ellipsoid(Vector((-0.13, stem.y - 0.03, stem.z + 0.015)), 0.022, 0.022, 0.015, "metal", seg=8, rows=3, top=0.5)  # ベル
    # サドル（幅の広い、やわらかい形）とシートポスト
    p.tube(C_SEAT, C_SADDLE + Vector((0, 0, -0.03)), 0.015, mat="metal")
    p.ellipsoid(C_SADDLE + Vector((0, -0.02, -0.03)), 0.12, 0.14, 0.05, "dark", seg=10, rows=4, top=0.5)
    p.box(C_SADDLE + Vector((0, -0.02, -0.04)), 0.11, 0.12, 0.012, "dark")
    # 泥よけ・前かご（フォークの上）・荷台・チェーンカバー・スタンド・ライト
    fender(p, FRONT, 20, 175)
    fender(p, REAR, 0, 160)
    bk = FRONT + Vector((0, 0.06, 0.6))
    basket(p, bk + Vector((0, 0, -0.02)), 0.36, 0.28, 0.24)
    p.tube(C_HEAD_TOP + Vector((0, 0.05, -0.08)), bk + Vector((0, -0.12, 0.02)), 0.01, mat="metal", seg=4)
    for s in (-1, 1):
        p.tube(Vector((s * 0.06, FRONT.y, FRONT.z)), bk + Vector((s * 0.1, 0, -0.02)), 0.006, mat="metal", seg=4)
    rack_z = 0.8
    for s in (-1, 1):
        p.tube(G(s * 0.08, rack_z, 0.33), G(s * 0.08, rack_z, 0.76), 0.008, mat="metal", seg=4)
        p.tube(Vector((s * 0.07, REAR.y, REAR.z)), G(s * 0.08, rack_z, 0.7), 0.007, mat="metal", seg=4)
    for z in (0.4, 0.5, 0.6, 0.7):
        p.tube(G(-0.08, rack_z, z), G(0.08, rack_z, z), 0.006, mat="metal", seg=4)
    p.tube(G(0, rack_z, 0.33), C_SEAT + Vector((0, -0.03, -0.05)), 0.007, mat="metal", seg=4)
    guard = [(BB.y - 0.12, BB.z + 0.12), (REAR.y + 0.02, REAR.z + 0.08), (REAR.y + 0.06, REAR.z), (REAR.y + 0.02, REAR.z - 0.07),
             (BB.y - 0.12, BB.z - 0.1), (BB.y + 0.1, BB.z - 0.1), (BB.y + 0.12, BB.z + 0.02), (BB.y + 0.06, BB.z + 0.11)]
    p.prism_x(guard, 0.085, 0.095, "frame")
    p.tube(Vector((0.07, REAR.y, REAR.z)), Vector((0.1, REAR.y - 0.22, 0.03)), 0.01, mat="metal", seg=4)  # スタンド（たたんだ形）
    p.box(C_HEAD_BOTTOM + Vector((0, 0.08, -0.04)), 0.035, 0.035, 0.03, "metal")  # ライト
    p.box(C_HEAD_BOTTOM + Vector((0, 0.116, -0.04)), 0.028, 0.003, 0.022, "sock")
    p.box(REAR + Vector((0, -0.4, 0.1)), 0.03, 0.006, 0.02, "accent")  # 後ろの反射板
    if ebike:
        # 電池（シートチューブの後ろ）・モーター・ハンドルの表示
        d = (C_SEAT - BB).normalized()
        back = Vector((0, -d.z, d.y))  # シートチューブに直角で後ろ向き
        b0, b1 = BB + d * 0.16 + back * 0.055, BB + d * 0.46 + back * 0.055
        p.loft([b0, b0 + d * 0.02, b1 - d * 0.02, b1], [(0.05, 0.035), (0.055, 0.04), (0.055, 0.04), (0.05, 0.035)], ["dark", "dark", "dark"], seg=8,
               u=Vector((1, 0, 0)), v=back)
        p.box(b1 + d * 0.02, 0.05, 0.03, 0.02, "metal")
        p.box(b0 + d * 0.12 + back * 0.04, 0.056, 0.005, 0.06, "frame")  # 電池の色の線
        p.loft([BB + Vector((-0.08, 0, 0)), BB + Vector((0.08, 0, 0))], [0.075, 0.075], "dark", seg=12)
        p.box(stem + Vector((0.05, -0.02, 0.025)), 0.035, 0.02, 0.012, "dark")
        p.box(stem + Vector((0.05, -0.0225, 0.038)), 0.026, 0.014, 0.001, "sock")
        # 後ろの子ども乗せ（荷台の上）
        cs = G(0, rack_z + 0.02, 0.56)
        p.box(cs + Vector((0, 0, 0.02)), 0.15, 0.16, 0.02, "dark")
        p.prism_x([(cs.y + 0.12, cs.z), (cs.y + 0.14, cs.z), (cs.y - 0.17, cs.z + 0.5), (cs.y - 0.21, cs.z + 0.46)], -0.17, 0.17, "dark")  # 背もたれ
        for s in (-1, 1):
            p.prism_x([(cs.y + 0.14, cs.z), (cs.y - 0.12, cs.z), (cs.y - 0.17, cs.z + 0.42), (cs.y + 0.08, cs.z + 0.22)], s * 0.16, s * 0.18, "dark")  # 横の囲い
        p.tube(Vector((-0.15, cs.y + 0.15, cs.z + 0.24)), Vector((0.15, cs.y + 0.15, cs.z + 0.24)), 0.015, mat="frame", seg=6)  # 前のバー
        p.box(Vector((0, cs.y - 0.18, cs.z + 0.49)), 0.13, 0.02, 0.04, "frame")
    return p.finish(name)


frame_city = city_frame("BK_FrameCity", False)
frame_ebike = city_frame("BK_FrameEbike", True)

# ---- 脚（長さ 1・太さ 1 の筒。-Z の端が腰・ひざ） ----
t = Part()
t.loft([(0, 0, -0.5), (0, 0, -0.1), (0, 0, 0.15), (0, 0, 0.5)], [1.15, 1.05, 0.95, 0.8], ["shorts", "shorts", "skin"])
thigh = t.finish("BK_Thigh")
s_ = Part()
s_.loft([(0, 0, -0.5), (0, 0, -0.25), (0, 0, 0.15), (0, 0, 0.25), (0, 0, 0.5)], [1.07, 1.15, 0.75, 0.7, 0.68], ["skin", "skin", "skin", "sock"])
shin = s_.finish("BK_Shin")
h = Part()
h.prism_x([(-0.13, 0.01), (0.1, 0.01), (0.13, 0.03), (0.12, 0.055), (0.03, 0.08), (-0.06, 0.11), (-0.13, 0.1)], -0.045, 0.045, "dark")
h.prism_x([(-0.13, 0.0), (0.12, 0.0), (0.12, 0.012), (-0.13, 0.012)], -0.047, 0.047, "sock")  # 靴底の白い線
shoe = h.finish("BK_Shoe")

parts = [frame, wheel, crank, rider, thigh, shin, shoe, frame_city, frame_ebike, rider_up, poncho, poncho_up]


# ---- 下見用：ゲームと同じように車輪・クランク・脚を置いた自転車 ----
def place(src, mat4):
    ob = src.copy()
    ob.matrix_world = mat4
    preview_col.objects.link(ob)


def knee_of(hip, foot):  # src/render3d.js の kneeOf と同じ（ゲームの座標）
    dy, dz = foot[1] - hip[1], foot[2] - hip[2]
    dd = min(THIGH + SHIN - 1e-3, math.hypot(dy, dz))
    a = math.atan2(dz, dy) + math.acos((THIGH ** 2 + dd * dd - SHIN ** 2) / (2 * THIGH * dd))
    return [foot[0], hip[1] + math.cos(a) * THIGH, hip[2] + math.sin(a) * THIGH]


def limb(src, o, a, b, rad):
    a, b = Vector(a), Vector(b)
    q = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    place(src, o @ Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((rad, rad, (b - a).length, 1)))


for ob in parts:
    ob.hide_render = True
# 3 台を横に並べる（左からロードバイク・ママチャリ・電動アシスト自転車）
for off, fr, rd, hip_g in ((0.0, frame, rider, (1.03, 0.21)), (-1.3, frame_city, rider_up, (0.98, 0.25)), (1.3, frame_ebike, rider_up, (0.98, 0.25))):
    o = Matrix.Translation((off, 0, 0))
    place(fr, o)
    place(rd, o)
    ang = 0.7
    place(wheel, o @ Matrix.Translation(REAR) @ Matrix.Rotation(-1.3, 4, 'X'))
    place(wheel, o @ Matrix.Translation(FRONT) @ Matrix.Rotation(-0.4, 4, 'X'))
    place(crank, o @ Matrix.Translation(BB) @ Matrix.Rotation(ang, 4, 'X'))
    for side in (-1, 1):
        a = ang + (0 if side > 0 else math.pi)  # ゲームの animateBike と同じ
        foot = [side * 0.13, 0.3 + math.cos(a) * CRANK, 0.06 + math.sin(a) * CRANK]
        hip = [side * 0.1, hip_g[0], hip_g[1]]
        knee = knee_of(hip, foot)
        knee[0] = side * 0.12
        limb(thigh, o, G(*hip), G(*knee), 0.06)
        limb(shin, o, G(*knee), G(*foot), 0.045)
        place(shoe, o @ Matrix.Translation(G(*foot)))
for ob in preview_col.objects:
    ob.hide_render = False

g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=6)
gm = bpy.data.meshes.new("BK_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("BK_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("BK_PreviewGround", gm))
sun = bpy.data.objects.new("BK_Sun", bpy.data.lights.new("BK_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), 0, math.radians(-130))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("BK_Camera", bpy.data.cameras.new("BK_Camera"))
cam.data.lens = 50
preview_col.objects.link(cam)
cam.location = (5.2, 3.4, 2.4)
cam.rotation_euler = (Vector((0, 0.05, 0.85)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("BK_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "bicycle_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
