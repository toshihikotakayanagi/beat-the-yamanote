# 目黒駅（掘割の山手線の上の駅ビル：アトレ目黒 1 と、人工地盤の上の JR東急目黒ビル）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-meguro-station.py -- <保存先の .blend>
#
# 実物の山手線は掘割（地面より低い）を通り、その上に駅ビルが建つ。ゲームは線路を地面の高さに描くので、地図の建物の箱を
# そのまま置くと電車が箱の中を通り抜ける。そこで、線路が通る帯（Y ≒ -9.5〜6）だけ地上 6m までをあけた建物にする。
#   ・アトレ目黒 1 A館（線路をまたぐ）・B館：OSM の輪郭（way 150994849 / 150994850）を高さ 14m で立ち上げ、駅名を付ける
#   ・JR東急目黒ビル：掘割の上に人工地盤を造って建てた地上 17 階のビル（2002 年。延床面積 約 5.2 万㎡）。OSM の輪郭
#     （way 74265116 / 1059984885 / 1059984886。高さは 3 つとも 79.87m になっている）は線路沿いに約 250m あるが、
#     17 階ぶんの床面積から塔の 1 階あたりは約 3000㎡ なので、輪郭は高さ 9m の低層部（1〜2 階はアトレ目黒）とし、
#     その上に約 60m × 46m・高さ 75m の塔を載せる
# 形と色は写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北北西が +。方位 -12.1°）、Y は西が +（正面は東の -Y）、Z は高さ。
# 原点はホームの中心（緯度 35.633929、経度 139.715756）。
# 書き出すものはコレクション「MG_Export」、下見用の地面・カメラ・光は「MG_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("meguro_station.blend")

# ---- 寸法 ----
CORRIDOR = (-9.5, 6.0)  # 線路が通る帯（Y）。この帯は地上 PORTAL m まであける
PORTAL = 6.0
ATRE_A = [(38.0, 2.5), (29.6, 9.3), (30.2, 23.9), (21.0, 24.1), (15.1, 24.2), (8.8, 24.4), (8.7, 7.8), (-9.8, 1.2),
          (-12.7, -22.0), (-5.0, -29.4), (-3.5, -33.8), (22.4, -33.7), (24.5, -34.7), (26.6, -35.2), (37.1, -34.8)]
ATRE_B = [(59.8, -44.4), (40.9, -40.7), (37.5, -35.1), (38.8, -12.6), (70.8, -11.3), (71.2, -20.3)]
ATRE_H = 14.0
PODIUMS = [  # JR東急目黒ビルの低層部（OSM の 3 つの輪郭）
    [(-147.5, 13.9), (-147.4, 18.0), (-147.3, 21.3), (-154.9, 21.3), (-155.0, 33.7), (-160.5, 32.9), (-160.6, 30.2),
     (-162.0, 30.2), (-184.1, 29.8), (-227.5, 13.0), (-228.3, 14.1), (-230.1, 16.5), (-248.1, 15.8), (-248.1, 12.5),
     (-255.0, 12.2), (-255.1, 15.4), (-281.5, 13.0), (-281.5, 10.5), (-281.6, -7.9), (-254.7, -6.5), (-228.1, -5.7),
     (-179.5, -5.9), (-148.1, -5.9), (-148.0, 0.5), (-147.6, 10.1)],
    [(-134.1, 14.1), (-134.2, 17.7), (-147.4, 18.0), (-147.5, 13.9)],
    [(-134.2, 17.7), (-134.1, 14.1), (-133.8, -5.9), (-98.5, -7.3), (-51.4, -5.1), (-51.8, 14.0), (-53.6, 13.9),
     (-53.6, 17.8), (-39.0, 17.4), (-38.2, 36.9), (-32.3, 37.1), (-32.4, 47.8), (-36.3, 48.0), (-45.5, 47.8),
     (-45.7, 44.6), (-69.5, 44.5), (-69.8, 40.9), (-119.9, 41.1), (-126.8, 37.1), (-134.5, 36.7), (-134.5, 32.3)],
]
PODIUM_H = 9.0
TOWER = (-120.0, -60.0, -6.0, 40.0, 75.0)  # 塔（X0, X1, Y0, Y1, 高さ）
SIGNS = [  # （本文, 位置, Z の回転, 大きさ）。回転 0 は -Y（東）向き、180 は +Y（西）向き、-90 は -X（南）向き
    ("目黒駅", (-13.6, -10.0, ATRE_H - 3.4), -90, 2.6),
    ("目黒駅　東口", (24.0, -35.6, ATRE_H - 3.0), 0, 1.3),
    ("目黒駅　西口", (19.0, 24.9, ATRE_H - 3.0), 180, 1.3),
]
BAY = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "meguro_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(103)

PANEL = np.array([0.83, 0.82, 0.8])
FIN = np.array([0.66, 0.67, 0.68])
GLASS = np.array([0.12, 0.15, 0.19])
TGLASS = np.array([0.2, 0.27, 0.34])
FRAME = np.array([0.33, 0.34, 0.36])
LIGHT = np.array([1.0, 0.87, 0.68])


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


def facade(name, h, shop=True, px=96, tower=False):
    ppm = px / BAY
    Hp = int(round(h * ppm))
    col = np.zeros((Hp, px, 3))
    glow = np.zeros((Hp, px, 3))

    def rect(x0, x1, z0, z1, c, g=None):
        a, b, cc, d = (int(round(v * ppm)) for v in (x0, z0, x1, z1))
        col[b:d, a:cc] = c
        if g is not None:
            glow[b:d, a:cc] = g

    if tower:  # オフィスの塔：ガラスの横の帯と白い縦の線
        rect(0, BAY, 0, h, TGLASS)
        for z in np.arange(0, h, 4.4):
            rect(0, BAY, z, z + 0.9, PANEL)
            rect(0.4, BAY - 0.4, z + 1.0, z + 3.8, TGLASS, LIGHT * rng.uniform(0.2, 0.9))
        for x in (0.0, BAY / 2):
            rect(x, x + 0.25, 0, h, PANEL)
    else:
        rect(0, BAY, 0, h, PANEL)
        if shop:
            rect(0.2, BAY - 0.2, 0.3, 4.0, GLASS, LIGHT)
            rect(BAY / 2 - 0.05, BAY / 2 + 0.05, 0.3, 4.0, FRAME)
        for z in np.arange(5.0, h - 1.4, 3.8):
            rect(0.4, BAY - 0.4, z, z + 2.2, GLASS, LIGHT * rng.uniform(0.4, 1.0))
        rect(0, 0.3, 0, h, FIN)
        rect(BAY - 0.3, BAY, 0, h, FIN)
        rect(0, BAY, h - 0.6, h, FIN)
    return save_images(name, col, glow)


TEX = {"atre": facade("mg_atre", ATRE_H), "podium": facade("mg_podium", PODIUM_H), "tower": facade("mg_tower", 66.0, tower=True)}


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
    "atre": material("MG_Atre", tex=TEX["atre"]),
    "podium": material("MG_Podium", tex=TEX["podium"]),
    "tower": material("MG_Tower", tex=TEX["tower"], rough=0.2),
    "roof": material("MG_Roof", (0.5, 0.51, 0.52), rough=0.7),
    "tunnel": material("MG_Tunnel", (0.3, 0.3, 0.31), rough=0.9),  # 線路の上の天井と、両わきの壁
    "trim": material("MG_Trim", (0.7, 0.71, 0.72), rough=0.5),
    "signboard": material("MG_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("MG_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("MG_Export")
preview_col = bpy.data.collections.new("MG_Preview")
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


def clip(poly, keep):
    """Y の半平面で多角形を切る（keep：('ge', y) は Y ≧ y を残す、('le', y) は Y ≦ y を残す）"""
    kind, yv = keep
    inside = (lambda p: p[1] >= yv) if kind == 'ge' else (lambda p: p[1] <= yv)
    out_ = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if inside(a):
            out_.append(a)
        if inside(a) != inside(b):
            t = (yv - a[1]) / (b[1] - a[1])
            out_.append((a[0] + (b[0] - a[0]) * t, yv))
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


def portal_building(poly, h, mat, tex_h):
    """線路の帯だけ地上 PORTAL m まであけた建物"""
    y0, y1 = CORRIDOR
    for keep, cut in ((('ge', y1), y1), (('le', y0), y0)):
        part = clip(poly, keep)
        if len(part) >= 3:
            prism(part, 0, PORTAL, mat, tex_h, top=False, cut_y=cut)
    prism(poly, PORTAL, h, mat, tex_h, top=True)
    mid = clip(clip(poly, ('ge', y0)), ('le', y1))  # 線路の上の天井
    if len(mid) >= 3:
        face([(x, y, PORTAL) for x, y in ccw(mid)[::-1]], "tunnel", tile=6)


portal_building(ATRE_A, ATRE_H, "atre", ATRE_H)
prism(ATRE_B, 0, ATRE_H, "atre", ATRE_H)
for p in PODIUMS:
    portal_building(p, PODIUM_H, "podium", PODIUM_H)
tx0, tx1, ty0, ty1, th = TOWER
prism([(tx0, ty0), (tx1, ty0), (tx1, ty1), (tx0, ty1)], PODIUM_H, th, "tower", th - PODIUM_H)
prism([(tx0 + 0.6, ty0 + 0.6), (tx1 - 0.6, ty0 + 0.6), (tx1 - 0.6, ty1 - 0.6), (tx0 + 0.6, ty1 - 0.6)], th, th + 3.0, "trim", 3.0)
# 駅名の板
for text, (x, y, z), rotz, size in SIGNS:
    w = size * len(text) * 0.55 + 1.5
    if rotz == -90:  # 南向き（-X）
        face([(x - 0.05, y + w / 2, z - 0.4), (x - 0.05, y - w / 2, z - 0.4), (x - 0.05, y - w / 2, z + size + 0.4), (x - 0.05, y + w / 2, z + size + 0.4)], "signboard")
    else:
        s = 1 if rotz == 0 else -1
        yy = y + (0.05 if s > 0 else -0.05)
        pts = [(x - w / 2 * s, yy, z - 0.4), (x + w / 2 * s, yy, z - 0.4), (x + w / 2 * s, yy, z + size + 0.4), (x - w / 2 * s, yy, z + size + 0.4)]
        face(pts, "signboard")

me = bpy.data.meshes.new("MG_Station")
bm.to_mesh(me)
bm.free()
for mm in MAT.values():
    me.materials.append(mm)
ob = bpy.data.objects.new("MG_Station", me)
export_col.objects.link(ob)

font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for text, (x, y, z), rotz, size in SIGNS:
    cu = bpy.data.curves.new("MG_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = size
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("MG_Sign", cu)
    off = {-90: (-0.15, 0), 0: (0, -0.15), 180: (0, 0.15)}[rotz]
    sign.location = (x + off[0], y + off[1], z)
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
gm = bpy.data.meshes.new("MG_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("MG_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("MG_PreviewGround", gm))
sun = bpy.data.objects.new("MG_Sun", bpy.data.lights.new("MG_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("MG_Camera", bpy.data.cameras.new("MG_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (70, -120, 45)
cam.rotation_euler = (mathutils.Vector((-60, 0, 15)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("MG_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "meguro_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
