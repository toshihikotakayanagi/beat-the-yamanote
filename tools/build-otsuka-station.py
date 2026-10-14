# 大塚駅（高架の上の島式ホームと屋根、南口のアトレヴィ大塚、北口、高架の下をくぐる都電荒川線の大塚駅前停留場と車両）を、
# ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-otsuka-station.py -- <保存先の .blend>
#
# ゲームの山手線はこの駅で高架（高さ 6m。橋げたの下は 4.9m）。地図に都電の線路はないので、停留場のあたりだけ線路を
# モデルに入れる（五反田駅の池上線と同じ考え方）。
#   ・島式ホーム：高架の上（上面 7m、下面 5m）。ゲームの線路の中心から 1.6m あけて形を決め、長さは OSM（way 144126032）に
#     合わせた。屋根（way 1428878230 の範囲）と柱
#   ・アトレヴィ大塚：OSM の輪郭（way 176502701。12 階・高さ 58.1m）。線路側の南口と、看板
#   ・北口：小さな入口の屋根と看板
#   ・都電荒川線：大塚駅前停留場の 2 つのホーム（way 1339195217 / 1339195216）と、そのあいだの 2 本の線路（軌間 1372mm）、
#     停車している 1 両の車両（8800 形のローズ色の帯をまねた）。線路は高架の下の前後 70m ほど
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（東南東の巣鴨側が +。方位 107.6°）、Y は北北東が +（正面は南口の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.73169、経度 139.72859）。
# 書き出すものはコレクション「OT_Export」、下見用の地面・カメラ・光は「OT_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("otsuka_station.blend")

# ---- 寸法 ----
PLATFORM_LO = [(-178, -4.1), (-170, -4.2), (-160, -4.3), (-90, -4.4), (70, -4.4), (78, -4.3)]
PLATFORM_HI = [(-178, -0.2), (-170, -0.0), (-160, 0.2), (-150, 0.4), (-140, 0.6), (-130, 0.8), (-120, 0.9), (-110, 1.1),
               (-100, 1.3), (-90, 1.5), (-80, 1.7), (-70, 1.9), (-60, 2.1), (-50, 2.3), (-40, 2.5), (-30, 2.7), (-20, 2.9),
               (-10, 3.1), (0, 3.3), (10, 3.3), (20, 3.3), (30, 2.7), (40, 1.9), (50, 1.1), (60, 0.3), (70, -0.5), (78, -1.2)]
PLATFORM_Z = (5.0, 7.0)
ROOF = (-164, 72, 7.0 + 3.4)
ATRE = [(-59.8, -25.1), (-0.4, -24.7), (-0.4, -23.1), (6.2, -23.0), (6.2, -25.3), (14.0, -25.3), (44.7, -25.1), (44.7, -31.4),
        (44.4, -42.8), (22.2, -42.7), (22.2, -43.3), (14.2, -43.4), (6.6, -43.4), (-0.1, -43.4), (-4.5, -47.4), (-10.8, -47.9),
        (-18.5, -48.4), (-34.8, -48.5), (-59.7, -48.7)]
ATRE_H = 58.1
SHOP_H = 22.0  # 下の 5 階はお店（アトレヴィ）、上はオフィス
NORTH = (8.0, 20.0, 8.0, 11.0, 3.6)  # 北口の入口の屋根（X0, X1, Y0, Y1, 高さ）
TRAM_PLATFORMS = [
    [(62.2, 6.1), (63.3, 5.9), (64.1, 5.8), (61.1, -20.7), (60.2, -20.5), (59.4, -20.4)],
    [(69.3, 5.7), (70.5, 5.7), (71.3, 5.6), (69.9, -21.4), (69.2, -21.4), (67.8, -21.3)],
]
TRAM_TRACKS = [((65.4, -45.0), (62.6, 25.0)), ((68.1, -45.0), (65.3, 25.0))]  # 都電の線路の中心線（両端）
TRAM_CAR = (1, -8.0, 12.5)  # （どちらの線路か, 車両の中心の Y, 長さ）
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、180 は +Y、-90 は -X）
    ("大塚駅　南口", (14.0, -25.2, 3.4), 180, 1.0),
    ("atre vie", (-25.0, -25.0, 49.0), 180, 3.4),
    ("atre vie", (-30.0, -48.8, 49.0), 0, 3.4),
    ("大塚駅　北口", (14.0, 11.05, 2.4), 180, 0.7),
    ("大塚駅", (-178.2, -2.2, 7.4), -90, 1.0),
    ("大塚駅前", (60.3, -21.3, 1.9), 0, 0.45),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "otsuka_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(110)

WHITE = np.array([0.88, 0.88, 0.86])
STONE = np.array([0.72, 0.7, 0.66])
GLASS = np.array([0.15, 0.18, 0.21])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.9, 0.72])
ROSE = np.array([0.78, 0.22, 0.38])
TRAM_WHITE = np.array([0.93, 0.93, 0.92])


def save_images(name, col, glow):
    imgs = []
    H, W = col.shape[:2]
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, W, H, alpha=False)
        rgba = np.ones((H, W, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.01, (H, W, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


def facade(name, h, kind, px=96):
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    if kind == "atre":  # 下はガラスのお店、上は石の壁とオフィスの窓
        rect(0, BAY, 0, h, STONE)
        rect(0.3, BAY - 0.3, 0.2, 4.0, GLASS, LIGHT)
        for z in np.arange(5.0, SHOP_H - 1.0, 4.2):
            rect(0.5, BAY - 0.5, z + 0.8, z + 3.2, GLASS, LIGHT * 0.8)
        rect(0, BAY, SHOP_H - 0.8, SHOP_H, WHITE)
        for z in np.arange(SHOP_H + 0.4, h - 2.0, 3.6):
            rect(0.4, BAY - 0.4, z + 0.9, z + 2.8, GLASS, LIGHT * rng.uniform(0.2, 0.9))
        rect(0, 0.3, 0, h, WHITE)
        rect(0, BAY, h - 1.0, h, WHITE)
    elif kind == "north":  # 北口：ガラスの入口
        rect(0, BAY, 0, h, WHITE)
        rect(0.2, BAY - 0.2, 0.1, h - 0.6, GLASS, LIGHT)
    else:  # 都電の車両（高さは地面から。車体は 0.75〜3.15m）：白い車体、ローズ色のすそと帯、窓
        rect(0, BAY, 0, h, TRAM_WHITE)
        rect(0, BAY, 0.75, 1.15, ROSE)
        rect(0, BAY, 1.75, 1.95, ROSE)
        for x0 in np.arange(0.35, BAY - 0.3, 0.95):
            rect(x0, x0 + 0.75, 2.05, 2.85, GLASS, LIGHT * 0.9)
        rect(0, BAY, h - 0.2, h, np.array([0.6, 0.62, 0.64]))
    return save_images(name, col, glow)


TEX = {"atre": facade("ot_atre", ATRE_H, "atre"), "north": facade("ot_north", NORTH[4], "north"),
       "tram": facade("ot_tram", 3.15, "tram")}


def material(name, color=None, tex=None, rough=0.6, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex[0]
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        g = nt.nodes.new("ShaderNodeTexImage")
        g.image = tex[1]
        nt.links.new(g.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.0
    else:
        b.inputs["Base Color"].default_value = (*color, 1)
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


MAT = {
    "atre": material("OT_Atre", tex=TEX["atre"], rough=0.5),
    "north": material("OT_North", tex=TEX["north"], rough=0.3),
    "tram": material("OT_Tram", tex=TEX["tram"], rough=0.4),
    "roof": material("OT_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("OT_Under", (0.42, 0.42, 0.41), rough=0.9),  # ホームの下面
    "platform": material("OT_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("OT_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("OT_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("OT_Post", (0.3, 0.32, 0.34), rough=0.5),
    "rail": material("OT_Rail", (0.5, 0.48, 0.45), rough=0.4, metal=0.3),
    "bed": material("OT_Bed", (0.2, 0.2, 0.19), rough=0.95),  # 都電の線路の敷石
    "tramroof": material("OT_TramRoof", (0.55, 0.57, 0.6), rough=0.6),
    "signboard": material("OT_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("OT_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("OT_Export")
preview_col = bpy.data.collections.new("OT_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def face(pts, mat, uvs=None, tile=4.0):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = MI[mat]
    if uvs is None:
        f.normal_update()
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uvs = [((p[1], p[2]) if ax == 0 else (p[0], p[2]) if ax == 1 else (p[0], p[1])) for p in pts]
        uvs = [(u / tile, v / tile) for u, v in uvs]
    for l, uv in zip(f.loops, uvs):
        l[uvl].uv = uv
    return f


def ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]


def clip(poly, keep, axis=1):
    """半平面で多角形を切る（keep：('ge', v) は座標 ≧ v を残す、('le', v) は ≦ v を残す。axis 0 は X、1 は Y）"""
    kind, v = keep
    inside = (lambda p: p[axis] >= v) if kind == 'ge' else (lambda p: p[axis] <= v)
    out_ = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if inside(a):
            out_.append(a)
        if inside(a) != inside(b):
            t = (v - a[axis]) / (b[axis] - a[axis])
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out_.append((v, p[1]) if axis == 0 else (p[0], v))
    return out_


def prism(poly, z0, z1, mat, tex_h, top=True, bottom=False, cut_y=None):
    """多角形を z0〜z1 に立ち上げる。cut_y の線の上の辺（線路側に切った面）はトンネルの壁にする"""
    poly = ccw(poly)
    n = len(poly)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05:
            continue
        on_cut = cut_y is not None and abs(a[1] - cut_y) < 1e-6 and abs(b[1] - cut_y) < 1e-6
        m = max(1, round(L / BAY))
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], "tunnel" if on_cut else mat,
             None if on_cut else [(0, z0 / tex_h), (m, z0 / tex_h), (m, z1 / tex_h), (0, z1 / tex_h)])
    if top:
        face([(x, y, z1) for x, y in poly], "roof", tile=6)
    if bottom:
        face([(x, y, z0) for x, y in poly[::-1]], "tunnel", tile=6)


def box(x0, x1, y0, y1, z0, z1, mat, top=True):
    prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat, max(z1 - z0, 0.1), top=top)


def interp(edge, x):
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return edge[0][1] if x < edge[0][0] else edge[-1][1]


def strip(a, b, half, z0, z1, mat, top=True):
    """a → b の線に沿った幅 2×half の細長い箱（上の面も mat で塗る）"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * half, dx / L * half
    pts = [(a[0] + nx, a[1] + ny), (a[0] - nx, a[1] - ny), (b[0] - nx, b[1] - ny), (b[0] + nx, b[1] + ny)]
    prism(pts, z0, z1, mat, max(z1 - z0, 0.1), top=False)
    if top:
        face([(x, y, z1) for x, y in ccw(pts)], mat, tile=3)


# アトレヴィ大塚と北口
prism(ATRE, 0, ATRE_H, "atre", ATRE_H)
box(-45.0, -12.0, -44.0, -30.0, ATRE_H, ATRE_H + 3.0, "roof")  # 屋上の機械室
nx0, nx1, ny0, ny1, nh = NORTH
box(nx0, nx1, ny0, ny1, 0, nh, "north")
box(nx0 - 0.5, nx1 + 0.5, ny0 - 0.5, ny1 + 1.0, nh, nh + 0.3, "roof")

# 高架の上の島式ホームと屋根
lo, hi = PLATFORM_LO, PLATFORM_HI
xs = sorted(set([p[0] for p in lo] + [p[0] for p in hi]))
lo, hi = [(x, interp(lo, x)) for x in xs], [(x, interp(hi, x)) for x in xs]
z0, z1 = PLATFORM_Z
prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=True)
for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
    for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
        face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
rx0, rx1, rz = ROOF
rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
for xa, xb in zip(rxs, rxs[1:]):  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）
    la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
    ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
    ma, mb = (la + ha) / 2, (lb + hb) / 2
    face([(xa, la, rz), (xb, lb, rz), (xb, mb, rz + 0.5), (xa, ma, rz + 0.5)], "canopy", tile=3)
    face([(xa, ma, rz + 0.5), (xb, mb, rz + 0.5), (xb, hb, rz), (xa, ha, rz)], "canopy", tile=3)
for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
    ym = (interp(lo, x) + interp(hi, x)) / 2
    box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, z1, rz + 0.5, "post", top=False)

# 都電荒川線：停留場のホーム、線路、車両
for p in TRAM_PLATFORMS:
    prism(p, 0, 0.35, "platform", 0.35)
for a, b in TRAM_TRACKS:
    strip(a, b, 1.25, 0.0, 0.1, "bed")
    for off in (-0.69, 0.69):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        ox, oy = -dy / L * off, dx / L * off
        strip((a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy), 0.04, 0.1, 0.2, "rail")
ti, yc, length = TRAM_CAR
(ax, ay), (bx, by) = TRAM_TRACKS[ti]
t = (yc - ay) / (by - ay)
cx = ax + (bx - ax) * t
ux, uy = (bx - ax) / math.hypot(bx - ax, by - ay), (by - ay) / math.hypot(bx - ax, by - ay)
p0 = (cx - ux * length / 2, yc - uy * length / 2)
p1 = (cx + ux * length / 2, yc + uy * length / 2)
strip(p0, p1, 1.1, 0.75, 3.15, "tram", top=False)  # 模様は地面からの高さで貼る
strip(p0, p1, 1.0, 3.15, 3.4, "tramroof")
strip((p0[0] + ux * 4, p0[1] + uy * 4), (p1[0] - ux * 4, p1[1] - uy * 4), 0.3, 3.4, 3.9, "post")  # パンタグラフのあたり
strip((p0[0] + ux * 1.5, p0[1] + uy * 1.5), (p1[0] - ux * 1.5, p1[1] - uy * 1.5), 0.9, 0.2, 0.75, "post")  # 台車

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * (0.55 if not text.isascii() else 0.4) + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")
box(60.2, 60.4, -21.35, -21.15, 0.35, 1.55, "post", top=False)  # 停留場の看板の柱

me = bpy.data.meshes.new("OT_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("OT_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("OT_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("OT_Sign", cu)
    sign.location = (x + math.sin(math.radians(rotz)) * 0.15, y - math.cos(math.radians(rotz)) * 0.15, z)
    sign.rotation_euler = (math.radians(90), 0, math.radians(rotz))
    export_col.objects.link(sign)
    cu.materials.append(MAT["sign"])
    for o2 in bpy.context.view_layer.objects:
        o2.select_set(False)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target='MESH')

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=320)
gm = bpy.data.meshes.new("OT_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("OT_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("OT_PreviewGround", gm))
sun = bpy.data.objects.new("OT_Sun", bpy.data.lights.new("OT_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("OT_Camera", bpy.data.cameras.new("OT_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (130, -110, 55)
cam.rotation_euler = (mathutils.Vector((20, -10, 8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("OT_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
for img in bpy.data.images:
    if img.filepath_raw.startswith(TEX_DIR):
        img.pack()
bpy.ops.wm.save_as_mainfile(filepath=out)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "otsuka_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
