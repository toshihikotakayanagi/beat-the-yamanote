# 駅の近くの有名な建物 3 つ（渋谷の SHIBUYA109・QFRONT、秋葉原ラジオ会館）を、地図データ（OpenStreetMap）の建物の形のとおりに
# ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-famous-buildings.py -- <保存先の .blend>
#
# 書き出すものはコレクション「F109_Export」（SHIBUYA109）、「FQF_Export」（QFRONT）、「FRK_Export」（秋葉原ラジオ会館）。
# 下見用の地面・カメラ・光は「FB_Preview」。
# 建物の形（OSM の建物の外形）は、それぞれの真ん中（緯度・経度は src/render3d.js の MODELS と同じ）からの m で、
# Blender の +X が東、+Y が北、Z が高さ（MODELS の heading は 180）。看板の字や広告の絵は描かない（建物の名前の字だけ）。
#   SHIBUYA109   8 階建ての銀色の建物と、道玄坂と文化村通りの分かれ目に立つ円柱の塔（上に「SHIBUYA109」の字）
#   QFRONT       ガラス張りの建物と、スクランブル交差点の方を向く大きな画面（光る色の帯）
#   秋葉原ラジオ会館  駅の方を向く面に、色とりどりの大きな看板の板と「ラジオ会館」の縦の字
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("famous_buildings.blend")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"  # BIZ UDゴシック Bold（SIL Open Font License。字の形だけをモデルに入れる）
font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None

# OSM の建物の外形（真ん中からの m。+X 東・+Y 北）
FOOT = {
    "109": [(-30.38, 24.69), (-32.46, 23.6), (-36.27, 15.5), (-38.23, 16.42), (-41.29, 10), (-37.84, 8.26), (-40.52, 3.32), (-30.87, -12.04),
            (-27.75, -18.38), (-25.1, -26.14), (17.12, -12.84), (19.35, -12.11), (18.79, -10.85), (19.34, -10.45), (19.91, -9.99), (20.74, -9.03),
            (21.2, -8.16), (21.48, -7.34), (21.67, -6.52), (21.76, -5.66), (21.72, -4.88), (21.32, -3.72), (20.83, -2.72), (19.97, -1.64),
            (19.21, -1.06), (18.46, -0.57), (17.46, -0.09), (18.34, 2.12), (12.15, 5.01), (4.22, -0.73), (-6.73, 12.31), (-6.39, 13.41), (-10.83, 15.5)],
    "qf": [(-13.58, 15.35), (16.34, 6.88), (15.7, 4.25), (12.3, -9.67), (6.63, -11), (0.51, -11.98), (-5.38, -11.22), (-18.93, 2.04)],
    "rk": [(-10.38, 16.32), (-10.96, -32.27), (13.02, -32.55), (13.6, 16.04), (5.1, 16.14)],
}
SCRAMBLE = (20.3, -40.7)  # QFRONT から見たスクランブル交差点の向き（m）
STATION_AKB = (125.0, 0.0)  # ラジオ会館から見た秋葉原駅の向き


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


MAT = {
    "silver": material("FB_Silver", srgb(0xc9ccd0), rough=0.3, metal=0.6),
    "silver2": material("FB_SilverDark", srgb(0x8e9399), rough=0.3, metal=0.6),
    "win": material("FB_Window", srgb(0x2a3440), rough=0.1, metal=0.3, emit=srgb(0xffe2b0), strength=0.6),
    "glass": material("FB_Glass", srgb(0x3b5670), rough=0.1, metal=0.4, emit=srgb(0xffe8c0), strength=0.35),
    "frame": material("FB_Frame", srgb(0x5d636b), rough=0.4, metal=0.5),
    "roof": material("FB_Roof", srgb(0x6e7177), rough=0.8),
    "black": material("FB_Black", srgb(0x17181b), rough=0.5),
    "white": material("FB_White", srgb(0xf2f2ee), rough=0.4, emit=srgb(0xffffff), strength=0.4),
    "base": material("FB_Base", srgb(0x3a3d43), rough=0.6),
}
# 大きな画面・看板の色（昼も明るい色、夜は光る）
PANEL_COLORS = [0xff4f7b, 0x3fb7ff, 0xffd23f, 0x7cdb5a, 0xb36bff, 0xff8a3d, 0x36e0c8, 0xf4f4f4]
for i, h in enumerate(PANEL_COLORS):
    MAT[f"p{i}"] = material(f"FB_Panel{i}", srgb(h), rough=0.4, emit=srgb(h), strength=1.5)
MI = {k: i for i, k in enumerate(MAT)}
preview_col = bpy.data.collections.new("FB_Preview")
scene.collection.children.link(preview_col)
rng = random.Random(109)


class Part:
    def __init__(self, col_name):
        self.bm = bmesh.new()
        self.col = bpy.data.collections.new(col_name)
        scene.collection.children.link(self.col)

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def prism(self, pts, z0, z1, mat, top_mat=None, bottom=False):
        A = [Vector((x, y, z0)) for x, y in pts]
        B = [Vector((x, y, z1)) for x, y in pts]
        n = len(pts)
        for k in range(n):
            self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], mat)
        self.face(B, top_mat or mat)
        if bottom:
            self.face(A[::-1], mat)

    def wall_band(self, pts, z0, z1, mat, out=0.03, skip=None):
        """外形の各辺に、少し外へ浮かせた帯（窓の帯など）を貼る。skip(k) が真の辺は貼らない"""
        n = len(pts)
        cx = sum(p[0] for p in pts) / n
        cy = sum(p[1] for p in pts) / n
        for k in range(n):
            if skip and skip(k):
                continue
            (ax, ay), (bx, by) = pts[k], pts[(k + 1) % n]
            l = math.hypot(bx - ax, by - ay)
            if l < 1.0:
                continue
            nx, ny = (by - ay) / l, -(bx - ax) / l
            mx, my = (ax + bx) / 2, (ay + by) / 2
            if (mx - cx) * nx + (my - cy) * ny < 0:
                nx, ny = -nx, -ny
            self.face([(ax + nx * out, ay + ny * out, z0), (bx + nx * out, by + ny * out, z0), (bx + nx * out, by + ny * out, z1), (ax + nx * out, ay + ny * out, z1)], mat)

    def text(self, body, size, center, normal, mat, up=(0, 0, 1)):
        """字 body を、center に、外向き normal（x, y）の面として立てて貼る"""
        cu = bpy.data.curves.new("FB_Text", 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.resolution_u = 3
        if font:
            cu.font = font
        ob = bpy.data.objects.new("FB_TextTmp", cu)
        scene.collection.objects.link(ob)
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        nx, ny = normal
        l = math.hypot(nx, ny)
        nx, ny = nx / l, ny / l
        rx, ry = -ny, nx  # 外から見たときの右
        for poly in me.polygons:
            pts = []
            for i in poly.vertices:
                v = me.vertices[i].co
                pts.append((center[0] + rx * v.x, center[1] + ry * v.x, center[2] + v.y))
            self.face(pts, mat)
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
        self.col.objects.link(ob)
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


def facing_edge(pts, target):
    """外向きが target（x, y の向き）にいちばん近い、長さ 8m 以上の辺"""
    tl = math.hypot(*target)
    best, bk = -2, 0
    for k in range(len(pts)):
        nx, ny, l = outward(pts, k)
        d = (nx * target[0] + ny * target[1]) / tl
        if l >= 8 and d > best:
            best, bk = d, k
    return bk


# ---- SHIBUYA109 ----
p = Part("F109_Export")
foot = FOOT["109"]
H = 30.0
p.prism(foot, 0, H, "silver", "roof")
for f in range(8):  # 階ごとの窓の帯
    z = 1.2 + f * 3.6
    p.wall_band(foot, z + 1.0, z + 2.6, "win")
p.wall_band(foot, 0.0, 1.2, "base", out=0.05)
# 円柱の塔（道の分かれ目の丸い角）。縦のひれと、上の字
TC, TR, TH = (17.2, -6.4), 5.0, 46.0
ring = lambda r, z, n=20: [Vector((TC[0] + math.cos(2 * math.pi * k / n) * r, TC[1] + math.sin(2 * math.pi * k / n) * r, z)) for k in range(n)]
A, B, Ct = ring(TR, 0), ring(TR, TH - 6), ring(TR, TH)
for k in range(20):
    p.face([A[k], A[(k + 1) % 20], B[(k + 1) % 20], B[k]], "silver" if k % 2 else "silver2")
    p.face([B[k], B[(k + 1) % 20], Ct[(k + 1) % 20], Ct[k]], "white")
p.face(Ct, "roof")
for k in range(0, 20, 2):  # 縦のひれ
    a = 2 * math.pi * k / 20
    x, y = TC[0] + math.cos(a) * TR, TC[1] + math.sin(a) * TR
    p.face([(x, y, 0.5), (x + math.cos(a) * 0.5, y + math.sin(a) * 0.5, 0.5), (x + math.cos(a) * 0.5, y + math.sin(a) * 0.5, TH - 6.5), (x, y, TH - 6.5)], "silver2")
for ang in (0, 120, 240):  # 塔の上の字（3 方向）
    a = math.radians(ang + 10)
    nx, ny = math.cos(a), math.sin(a)
    p.text("SHIBUYA109", 1.7, (TC[0] + nx * (TR + 0.05), TC[1] + ny * (TR + 0.05), TH - 3.0), (nx, ny), "black")
b109 = p.finish("F109_Building")

# ---- QFRONT ----
p = Part("FQF_Export")
foot = FOOT["qf"]
H = 45.9
p.prism(foot, 0, H, "glass", "roof")
for z in [3.0 + k * 4.0 for k in range(11)]:  # 床の線
    p.wall_band(foot, z, z + 0.25, "frame")
# 大きな画面：スクランブル交差点の方を向く辺（丸い角の面）すべてにまたがる。黒い枠と、色の帯の絵（何枚かの光る板）
tl = math.hypot(*SCRAMBLE)
sz0, sz1 = 9.0, 40.0
col = 0
for k in range(len(foot)):
    nx, ny, l = outward(foot, k)
    if (nx * SCRAMBLE[0] + ny * SCRAMBLE[1]) / tl < 0.55:
        continue
    (ax, ay), (bx, by) = foot[k], foot[(k + 1) % len(foot)]
    ux, uy = (bx - ax) / l, (by - ay) / l
    pt = lambda s, z, d=0.15: (ax + ux * s + nx * d, ay + uy * s + ny * d, z)
    p.face([pt(0, sz0 - 0.6, 0.1), pt(l, sz0 - 0.6, 0.1), pt(l, sz1 + 0.6, 0.1), pt(0, sz1 + 0.6, 0.1)], "black")
    cols = max(1, round(l / 3.0))
    for i in range(cols):
        for j in range(5):
            s0, s1 = 0.3 + (l - 0.6) * i / cols, 0.3 + (l - 0.6) * (i + 1) / cols
            z0, z1 = sz0 + (sz1 - sz0) * j / 5, sz0 + (sz1 - sz0) * (j + 1) / 5
            p.face([pt(s0, z0), pt(s1, z0), pt(s1, z1), pt(s0, z1)], f"p{((col + i) * 3 + j * 5 + rng.randrange(3)) % len(PANEL_COLORS)}")
    col += cols
p.wall_band(foot, 0.0, 3.0, "base", out=0.05)
qf = p.finish("FQF_Building")

# ---- 秋葉原ラジオ会館 ----
p = Part("FRK_Export")
foot = FOOT["rk"]
H = 40.0
p.prism(foot, 0, H, "silver2", "roof")
k = facing_edge(foot, STATION_AKB)
for f in range(10):
    z = 1.5 + f * 3.8
    p.wall_band(foot, z + 1.2, z + 2.8, "win", skip=lambda e: e == k)
nx, ny, l = outward(foot, k)
(ax, ay), (bx, by) = foot[k], foot[(k + 1) % len(foot)]
ux, uy = (bx - ax) / l, (by - ay) / l
pt = lambda s, z, d=0.2: (ax + ux * s + nx * d, ay + uy * s + ny * d, z)
# 駅の方の面：色とりどりの大きな看板（字や絵はない）
cols = max(3, int(l // 7))
for i in range(cols):
    for j in range(6):
        s0 = 1.0 + (l - 2.0) * i / cols + 0.3
        s1 = 1.0 + (l - 2.0) * (i + 1) / cols - 0.3
        z0 = 6.0 + j * 5.4
        p.face([pt(s0, z0), pt(s1, z0), pt(s1, z0 + 4.8), pt(s0, z0 + 4.8)], f"p{rng.randrange(len(PANEL_COLORS))}")
p.face([pt(0.2, 0.0, 0.05), pt(l - 0.2, 0.0, 0.05), pt(l - 0.2, 5.0, 0.05), pt(0.2, 5.0, 0.05)], "glass")
# 角の縦の看板「ラジオ会館」
cx, cy = ax + ux * 1.2 + nx * 0.6, ay + uy * 1.2 + ny * 0.6
p.prism([(cx - 0.5, cy - 0.5), (cx + 0.5, cy - 0.5), (cx + 0.5, cy + 0.5), (cx - 0.5, cy + 0.5)], 8.0, 36.0, "black")
p.text("ラ\nジ\nオ\n会\n館", 2.6, (cx + nx * 0.52, cy + ny * 0.52, 22.0), (nx, ny), "white")
rk = p.finish("FRK_Building")

# ---- 下見用 ----
for i, ob in enumerate((b109, qf, rk)):
    pv = ob.copy()
    pv.location = (i * 90 - 90, 0, 0)
    preview_col.objects.link(pv)
for c in ("F109_Export", "FQF_Export", "FRK_Export"):
    bpy.data.collections[c].hide_render = True
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=200)
gm = bpy.data.meshes.new("FB_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("FB_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("FB_PreviewGround", gm))
sun = bpy.data.objects.new("FB_Sun", bpy.data.lights.new("FB_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(40))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("FB_Camera", bpy.data.cameras.new("FB_Camera"))
cam.data.lens = 28
cam.data.clip_end = 2000
preview_col.objects.link(cam)
cam.location = (40, -170, 70)
cam.rotation_euler = (Vector((0, 0, 18)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("FB_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "famous_buildings_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in (b109, qf, rk)}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
