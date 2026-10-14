# 御徒町駅（高架の上の 2 つの島式ホームと屋根、高架下の北口・南口の改札口と店）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-okachimachi-station.py -- <保存先の .blend>
#
# ゲームの線路はこの駅の前後すべて高架（高さ 6m。橋げたの下は 4.9m）。地図ではホームの屋根（OSM way 1548304328 など。高さ
# 13m）が高架をふさぐ箱になり、高架下の店（ケンタッキー、ローソン、南の高架下の店）も高さ 6m の箱で高架の床を突き抜けて
# いたので、それらは描かずに、このモデルに置きかえる。
#   ・島式ホーム 2 つ（3・4 番線と 1・2 番線。京浜東北線と山手線）：高架の上（上面 7m、下面 5m）。ゲームの線路の中心から 1.6m
#     あけて形を決め、長さは OSM（way 60538893 / 81606326）に合わせた。屋根と柱、ホームの北の端に駅名の看板
#   ・高架下（高さ 4.8m）：春日通りの側の北口の改札口、南口の改札口、ケンタッキーとローソン、南の高架下の店。
#     高架下を抜ける道（駅の中ほどの斜めの道、北の春日通りと歩道）はあけておく
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（南の秋葉原側が +。方位 187°）、Y は東が +（正面は西の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.70695、経度 139.77463）。
# 書き出すものはコレクション「OC_Export」、下見用の地面・カメラ・光は「OC_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("okachimachi_station.blend")

# ---- 寸法 ----
UNDER_H = 4.8  # 高架下の建物の高さ
GATES = [  # 改札口（X0, X1, Y0, Y1）
    (-70.0, -16.0, -9.5, 11.5),  # 北口
    (18.0, 54.0, -9.5, 11.5),    # 南口
]
SHOPS = [  # 高架下の店（多角形）
    [(3.9, -1.0), (0.1, -13.6), (-0.7, -14.0), (-12.4, -13.9), (-8.5, -0.8)],  # ケンタッキー（OSM way 636881979）
    [(7.2, 10.1), (4.1, -0.3), (-8.2, -0.3), (-5.1, 10.2)],                   # ローソン（OSM way 636881980）
    [(57.0, -9.5), (97.0, -8.0), (97.0, 6.0), (57.0, 4.0)],                    # 南の高架下の店
]
HIGH = (5.0, 7.0)  # ホームの下面と上面
PLATFORMS = [  # （西の端, 東の端）。X ごとの Y
    ([(-134, -5.7), (-130, -5.8), (-120, -6.1), (-110, -6.4), (-100, -6.7), (-90, -7.0), (-80, -7.3), (-70, -7.7), (-60, -8.0),
      (-50, -8.3), (-40, -8.6), (-30, -8.9), (-20, -9.2), (-10, -9.5), (0, -9.8), (10, -10.1), (20, -10.5), (30, -10.6),
      (40, -10.1), (50, -9.6), (60, -9.1), (70, -8.6), (80, -8.1), (84, -7.8)],
     [(-134, -1.2), (-120, -1.4), (-110, -1.5), (-100, -1.7), (-90, -1.9), (-80, -2.0), (-70, -2.2), (-60, -2.4), (-50, -2.5),
      (-40, -2.7), (-30, -2.9), (-20, -3.0), (-10, -3.2), (0, -3.3), (10, -3.5), (20, -3.7), (30, -3.8), (40, -4.0),
      (50, -4.2), (60, -4.3), (70, -4.5), (80, -4.6), (84, -4.7)]),
    ([(-141, 6.2), (-130, 6.1), (-120, 6.0), (-110, 5.9), (-100, 5.8), (-80, 5.7), (-70, 5.4), (-60, 5.2), (-50, 5.0),
      (-40, 4.8), (-30, 4.6), (-20, 4.4), (-10, 4.2), (0, 4.0), (10, 3.8), (20, 3.6), (30, 3.4), (40, 3.2), (50, 3.0),
      (60, 2.8), (70, 2.6), (79, 2.4)],
     [(-141, 13.2), (-140, 13.3), (-130, 13.4), (-120, 13.2), (-110, 13.0), (-100, 12.8), (-90, 12.6), (-80, 12.3),
      (-70, 12.1), (-60, 11.9), (-50, 11.7), (-40, 11.4), (-30, 11.2), (-20, 11.0), (-10, 10.8), (0, 10.6), (10, 10.3),
      (20, 10.1), (30, 9.8), (40, 9.1), (50, 8.4), (60, 7.6), (70, 6.9), (79, 6.3)]),
]
ROOF = (-128, 76, 7.0 + 3.4)  # ホームの屋根（X の範囲と高さ）
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、90 は +X、-90 は -X）
    ("御徒町駅　北口", (-70.2, 1.0, 2.9), -90, 0.9),
    ("御徒町駅", (-43.0, -9.6, 2.8), 0, 1.2),
    ("御徒町駅", (-43.0, 11.6, 2.8), 180, 1.2),
    ("御徒町駅　南口", (54.2, 1.0, 2.9), 90, 0.9),
    ("御徒町", (-134.2, -3.5, 7.4), -90, 0.9),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "okachimachi_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(117)

WHITE = np.array([0.88, 0.88, 0.86])
GRAY = np.array([0.55, 0.56, 0.57])
GLASS = np.array([0.15, 0.18, 0.21])
LIGHT = np.array([1.0, 0.88, 0.68])
SHOP_COLORS = [np.array(c) for c in ((0.8, 0.2, 0.18), (0.95, 0.75, 0.15), (0.2, 0.45, 0.75), (0.25, 0.6, 0.3), (0.9, 0.45, 0.15))]


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

    if kind == "gate":  # 改札口：白い壁とガラスの入口
        rect(0, BAY, 0, h, WHITE)
        rect(0.3, BAY - 0.3, 0.1, 3.3, GLASS, LIGHT)
        rect(0, BAY, 3.7, 4.3, GRAY)
    else:  # 高架下の店：店ごとに色のちがう看板と、明るい店先（1 枚に 2 軒）
        rect(0, BAY, 0, h, np.array([0.4, 0.4, 0.41]))
        for i, x0 in enumerate((0.15, BAY / 2 + 0.15)):
            c = SHOP_COLORS[rng.integers(len(SHOP_COLORS))]
            rect(x0, x0 + BAY / 2 - 0.3, 3.0, 3.9, c, c * 0.6)
            rect(x0, x0 + BAY / 2 - 0.3, 0.0, 2.8, np.array([0.55, 0.5, 0.42]), LIGHT)
    return save_images(name, col, glow)


TEX = {"gate": facade("oc_gate", UNDER_H, "gate"), "shop": facade("oc_shop", UNDER_H, "shop")}


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
    "gate": material("OC_Gate", tex=TEX["gate"], rough=0.4),
    "shop": material("OC_Shop", tex=TEX["shop"], rough=0.6),
    "roof": material("OC_Roof", (0.4, 0.4, 0.41), rough=0.8),
    "tunnel": material("OC_Under", (0.45, 0.45, 0.46), rough=0.9),  # 高架のホームの下面
    "platform": material("OC_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "edge": material("OC_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("OC_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("OC_Post", (0.3, 0.32, 0.34), rough=0.5),
    "signboard": material("OC_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("OC_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("OC_Export")
preview_col = bpy.data.collections.new("OC_Preview")
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


# 高架下の改札口と店
for x0, x1, y0, y1 in GATES:
    box(x0, x1, y0, y1, 0, UNDER_H, "gate")
for p in SHOPS:
    prism(p, 0, UNDER_H, "shop", UNDER_H)

# 高架の上の島式ホーム 2 つと屋根
z0, z1 = HIGH
rx0, rx1, rz = ROOF
for lo_, hi_ in PLATFORMS:
    xs = sorted(set([p[0] for p in lo_] + [p[0] for p in hi_]))
    lo, hi = [(x, interp(lo_, x)) for x in xs], [(x, interp(hi_, x)) for x in xs]
    prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=True)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
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

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("OC_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("OC_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("OC_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("OC_Sign", cu)
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
gm = bpy.data.meshes.new("OC_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("OC_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("OC_PreviewGround", gm))
sun = bpy.data.objects.new("OC_Sun", bpy.data.lights.new("OC_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("OC_Camera", bpy.data.cameras.new("OC_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (-150, -70, 35)
cam.rotation_euler = (mathutils.Vector((-30, 0, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("OC_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "okachimachi_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
