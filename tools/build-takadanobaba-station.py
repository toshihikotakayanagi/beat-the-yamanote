# 高田馬場駅（高架の上の JR 山手線と西武新宿線のホームと屋根、高架の下の改札口と西武の駅の建物）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-takadanobaba-station.py -- <保存先の .blend>
#
# ゲームの山手線と西武新宿線はこの駅で高架（高さ 6m。橋げたの下は 4.9m）になっていて、北の端の下を早稲田通りがくぐる。
# 地図には駅全体の輪郭（OSM way 94061850。長さ約 320m）が高さのわからない建物として入っていて、推定の高さで線路を
# まるごと覆う箱になっていたので、その箱と西武の駅の箱は描かずに、このモデルに置きかえる。
#   ・ホーム：JR の島式ホーム（1・2 番線）、西武の島式ホームと東側のホーム。上面 7m の高架の上に置き（早稲田通りを
#     ふさがないよう下面は 5m）、ゲームの線路の中心から 1.6m あけて形を決めた（長さは OSM に合わせた）。屋根と柱も付ける
#   ・高架の下の改札口（JR の早稲田口のあたり）と西武の駅の建物（OSM way 96328422）：橋げたの下の高さ 4.8m の 1 階
#   ・駅名の看板：早稲田通りの側、駅前広場の側、ホームの両端
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北東が +。方位 16°）、Y は西北西が +（正面は駅前広場のある東南東の -Y）、Z は高さ。
# 原点は駅の位置（緯度 35.71268、経度 139.70364）。
# 書き出すものはコレクション「TB_Export」、下見用の地面・カメラ・光は「TB_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("takadanobaba_station.blend")

# ---- 寸法 ----
LOW_H = 4.8  # 高架の下の建物の高さ
JR_GATE = [(62.0, -5.5), (112.0, -5.5), (112.0, 9.5), (62.0, 9.5)]  # 山手線の高架の下の改札口
SEIBU = [(112.0, -37.3), (110.1, -45.0), (109.3, -47.9), (108.6, -50.8), (100.9, -48.6), (83.6, -44.3), (81.7, -45.2),
         (61.8, -40.9), (64.6, -19.1), (63.1, -18.9), (62.7, -14.8), (79.0, -14.2), (97.8, -13.3), (97.9, -16.0),
         (115.3, -15.7), (114.6, -20.0)]  # 西武の駅の建物（OSM の輪郭）
PLATFORM_Z = (5.0, 7.0)  # ホームの下面と上面
ROOF_Z = 7.0 + 3.4
PLATFORMS = [  # （東の端, 西の端, 屋根の X の範囲）。東の端・西の端は X ごとの Y
    ([(-101, -1.8), (160, -1.8)],
     [(-101, 1.4), (-100, 1.5), (-90, 1.8), (-80, 2.0), (-70, 2.3), (-60, 2.6), (-50, 2.8), (-40, 3.1), (-30, 3.4),
      (-20, 3.7), (-10, 3.9), (0, 4.2), (10, 4.5), (20, 4.8), (30, 5.0), (40, 5.3), (50, 5.4), (60, 5.5), (70, 5.6),
      (80, 5.7), (90, 5.8), (100, 5.9), (110, 6.0), (120, 5.7), (130, 5.0), (140, 4.3), (150, 3.7), (160, 3.1)], (-95, 155)),
    ([(-150, -21.8), (-140, -21.9), (-130, -22.1), (-120, -22.2), (-110, -22.4), (-100, -22.5), (-90, -22.6), (-80, -22.8),
      (-70, -23.0), (-60, -23.5), (-50, -24.0), (-40, -24.5), (-30, -25.0), (-20, -25.5), (-10, -26.0), (0, -26.4),
      (10, -26.9), (20, -27.7), (30, -28.9), (40, -30.0), (50, -31.2), (60, -32.4), (62, -32.6)],
     [(-150, -18.5), (-110, -18.7), (-70, -18.8), (-30, -18.9), (20, -19.0), (30, -19.5), (40, -20.5), (50, -21.6),
      (60, -23.3), (62, -23.8)], (-140, 58)),
    ([(-150, -29.0), (-140, -29.1), (-130, -29.3), (-120, -29.4), (-110, -29.6), (-100, -29.7), (-90, -29.9), (-80, -30.0),
      (-70, -30.2), (-60, -30.7), (-50, -31.2), (-40, -31.7), (-30, -32.2), (-20, -32.7), (-10, -33.2), (0, -33.7),
      (10, -34.1), (20, -34.9), (30, -36.1), (40, -37.2), (50, -38.4), (60, -39.6), (62, -39.8)],
     [(-150, -25.0), (-140, -25.1), (-130, -25.3), (-120, -25.4), (-110, -25.6), (-100, -25.7), (-90, -25.9), (-80, -26.0),
      (-70, -26.2), (-60, -26.7), (-50, -27.2), (-40, -27.7), (-30, -28.2), (-20, -28.7), (-10, -29.2), (0, -29.7),
      (10, -30.1), (20, -30.9), (30, -32.1), (40, -33.2), (50, -34.4), (60, -35.6), (62, -35.8)], (-140, 58)),
]
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 r の板は (sin r, -cos r) の向き（0 は -Y、90 は +X、-90 は -X）
    ("高田馬場駅", (112.1, 2.0, 2.7), 90, 1.0),
    ("西武 高田馬場駅", (113.4, -28.6, 2.7), 81.4, 0.9),
    ("高田馬場駅", (92.2, -46.6, 2.5), -14.0, 1.3),
    ("高田馬場", (155.0, 0.9, 7.4), 90, 1.2),
    ("高田馬場", (-95.0, -0.2, 7.4), -90, 1.0),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "takadanobaba_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(108)

PANEL = np.array([0.78, 0.77, 0.74])
GLASS = np.array([0.15, 0.18, 0.21])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.9, 0.72])


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


def facade(name, h, px=96):
    """高架の下の店と改札口：ガラスの入口と、上の帯"""
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    rect(0, BAY, 0, h, PANEL)
    rect(0.3, BAY - 0.3, 0.1, 3.1, GLASS, LIGHT)
    rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.1, 3.1, FRAME)
    rect(0, 0.3, 0, h, FRAME)
    return save_images(name, col, glow)


TEX = {"low": facade("tb_low", LOW_H)}


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
    "low": material("TB_Low", tex=TEX["low"], rough=0.5),
    "roof": material("TB_Roof", (0.45, 0.46, 0.47), rough=0.7),
    "platform": material("TB_Platform", (0.62, 0.62, 0.6), rough=0.9),
    "tunnel": material("TB_Under", (0.42, 0.42, 0.41), rough=0.9),  # ホームの下面
    "edge": material("TB_Edge", (0.9, 0.78, 0.2), rough=0.6),  # ホームの端の黄色い線
    "canopy": material("TB_Canopy", (0.8, 0.81, 0.82), rough=0.5),
    "post": material("TB_Post", (0.3, 0.32, 0.34), rough=0.5),
    "signboard": material("TB_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("TB_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("TB_Export")
preview_col = bpy.data.collections.new("TB_Preview")
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


def resample(edge, xs):
    return [(x, interp(edge, x)) for x in xs]


# 高架の下の改札口と、西武の駅の建物
prism(JR_GATE, 0, LOW_H, "low", LOW_H)
prism(clip(SEIBU, ('le', -13.0)), 0, LOW_H, "low", LOW_H)

# 高架の上のホームと屋根
z0, z1 = PLATFORM_Z
for lo, hi, (rx0, rx1) in PLATFORMS:
    x0, x1 = max(lo[0][0], hi[0][0]), min(lo[-1][0], hi[-1][0])
    xs = [x0] + [x for x in range(int(math.floor(x0 / 10) * 10 + 10), int(x1), 10)] + [x1]
    lo, hi = resample(lo, xs), resample(hi, xs)
    prism(lo + hi[::-1], z0, z1, "platform", z1 - z0, bottom=True)
    for edge, d in ((lo, 0.3), (hi, -0.3)):  # 黄色い線
        for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
            face([(xa, ya + d - 0.15, z1 + 0.01), (xb, yb + d - 0.15, z1 + 0.01), (xb, yb + d + 0.15, z1 + 0.01), (xa, ya + d + 0.15, z1 + 0.01)], "edge")
    rxs = [rx0] + [x for x in range(int(math.floor(rx0 / 10) * 10 + 10), rx1, 10)] + [rx1]
    for xa, xb in zip(rxs, rxs[1:]):  # 低い切妻の屋根（ホームより左右に 0.5m 張り出す）
        la, lb = interp(lo, xa) - 0.5, interp(lo, xb) - 0.5
        ha, hb = interp(hi, xa) + 0.5, interp(hi, xb) + 0.5
        ma, mb = (la + ha) / 2, (lb + hb) / 2
        face([(xa, la, ROOF_Z), (xb, lb, ROOF_Z), (xb, mb, ROOF_Z + 0.5), (xa, ma, ROOF_Z + 0.5)], "canopy", tile=3)
        face([(xa, ma, ROOF_Z + 0.5), (xb, mb, ROOF_Z + 0.5), (xb, hb, ROOF_Z), (xa, ha, ROOF_Z)], "canopy", tile=3)
    for x in np.arange(rx0 + 5, rx1 - 2, 10.0):
        ym = (interp(lo, x) + interp(hi, x)) / 2
        box(x - 0.15, x + 0.15, ym - 0.15, ym + 0.15, z1, ROOF_Z + 0.5, "post", top=False)

# 駅名の板（回転 r の板は、向き (sin r, -cos r) へ少し浮かせる）
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.2
    r = math.radians(rotz)
    fx, fy = math.sin(r) * 0.05, -math.cos(r) * 0.05
    tx, ty = math.cos(r) * w / 2, math.sin(r) * w / 2
    face([(x + fx - tx, y + fy - ty, z - 0.35), (x + fx + tx, y + fy + ty, z - 0.35),
          (x + fx + tx, y + fy + ty, z + size + 0.35), (x + fx - tx, y + fy - ty, z + size + 0.35)], "signboard")

me = bpy.data.meshes.new("TB_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("TB_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("TB_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("TB_Sign", cu)
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
gm = bpy.data.meshes.new("TB_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TB_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("TB_PreviewGround", gm))
sun = bpy.data.objects.new("TB_Sun", bpy.data.lights.new("TB_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TB_Camera", bpy.data.cameras.new("TB_Camera"))
cam.data.lens = 24
preview_col.objects.link(cam)
cam.location = (170, -120, 60)
cam.rotation_euler = (mathutils.Vector((40, -10, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TB_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "takadanobaba_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
