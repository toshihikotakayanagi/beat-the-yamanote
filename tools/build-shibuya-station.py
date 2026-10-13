# 東京メトロ銀座線の渋谷駅（2020 年。明治通りの上に架かる、白い M 字のアーチ屋根の駅）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-shibuya-station.py -- <保存先の .blend>
#
# 輪郭は OpenStreetMap の way 810356690（3 階建て・高さ 19m・layer 1）。ゲームの地図データでは、この駅が
# 地面から立ち上がる高さ 19m の箱になっていて明治通りをふさいでいたので、下を道路が通れる高架の駅にする。
# 橋脚は、地図の明治通り（X ≒ 8〜33）とその東の歩道（X ≒ 32〜68）を避けて、西側だけに立てる。
# 屋根の形（M 字のアーチの連なり）・高さの割り振りは、写真の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（東北東が +。西の端で JR の駅舎につながる）、Y は線路と直角（正面は南南東の -Y）、
# Z は高さ。原点は輪郭の中心（緯度 35.659003、経度 139.702420）。
# 書き出すものはコレクション「SB_Export」、下見用の地面・カメラ・光は「SB_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("shibuya_station.blend")

# ---- 寸法 ----
X0, X1 = -66.0, 49.9  # 駅（屋根のある部分）
TAIL = (49.9, 66.0, -3.7, 3.5)  # 東の端：線路だけの細い高架（X0, X1, Y0, Y1）
HALF = 12.0  # 駅の幅の半分
DECK_BOTTOM, DECK_TOP = 9.0, 11.0  # 床板（下を車が通れる高さ）
EAVE = 14.5  # 屋根の縁（両側）の高さ
CROWN = 19.0  # アーチの頂（OSM の高さ 19m）
VALLEY = 15.6  # M の真ん中の谷
RIB_STEP = 3.2  # アーチの梁（リブ）の間隔
ARCH_SEG = 8  # アーチ 1 つの分け数
PIERS_X = [-50.0, -25.0, 0.0]  # 橋脚（明治通りと東の歩道を避ける）
PIERS_Y = [-7.0, 7.0]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
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


MAT = {
    "roof": material("SB_Roof", (0.78, 0.8, 0.8), 0.5, emit=(1.0, 0.95, 0.88), strength=0.25),  # 屋根の膜（夜はほんのり明るい）
    "rib": material("SB_Rib", (0.92, 0.93, 0.93), 0.4, 0.2),  # 白い M 字の梁
    "glass": material("SB_Glass", (0.05, 0.08, 0.1), 0.1, emit=(1.0, 0.88, 0.7), strength=0.9),
    "concrete": material("SB_Concrete", (0.55, 0.56, 0.57), 0.8),
    "under": material("SB_Under", (0.42, 0.43, 0.44), 0.8),
    "line": material("SB_Line", (0.95, 0.65, 0.05), 0.5),  # 銀座線の色（オレンジ）の帯
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SB_Export")
preview_col = bpy.data.collections.new("SB_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
bm = bmesh.new()


def face(pts, mat):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = MI[mat]
    return f


def box(x0, x1, y0, y1, z0, z1, mat, top=True, bottom=True):
    for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)
    if top:
        face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    if bottom:
        face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


def m_profile():
    """M 字の断面（Y, Z）：縁 → アーチ → 谷 → アーチ → 縁。アーチは楕円の上半分を、縁と谷の高さの差に合わせてゆがめる"""
    pts = []
    for side, (ya, yb, za, zb) in enumerate([(-HALF, 0.0, EAVE, VALLEY), (0.0, HALF, VALLEY, EAVE)]):
        for k in range(ARCH_SEG + (1 if side == 1 else 0)):
            t = k / ARCH_SEG
            ang = math.pi * (1 - t)
            y = (ya + yb) / 2 + (yb - ya) / 2 * math.cos(ang)
            base = za + (zb - za) * t
            z = base + (CROWN - (za + zb) / 2) * math.sin(ang)
            pts.append((y, z))
    return pts


PROFILE = m_profile()

# 床板と、東の端の細い高架
box(X0, X1, -HALF, HALF, DECK_BOTTOM, DECK_TOP, "concrete")
tx0, tx1, ty0, ty1 = TAIL
box(tx0, tx1, ty0, ty1, DECK_BOTTOM, DECK_TOP, "concrete")
for y in (ty0, ty1 - 0.3):  # 東の端の低い壁
    box(tx0, tx1, y, y + 0.3, DECK_TOP, DECK_TOP + 1.1, "concrete", bottom=False)
# 床板の側面に銀座線の色の帯
for y in (-HALF - 0.05, HALF + 0.05):
    face([(X0, y, DECK_TOP - 0.7), (X1, y, DECK_TOP - 0.7), (X1, y, DECK_TOP - 0.3), (X0, y, DECK_TOP - 0.3)], "line")
# 橋脚と、その上の梁
for x in PIERS_X:
    for y in PIERS_Y:
        box(x - 0.9, x + 0.9, y - 0.9, y + 0.9, 0, DECK_BOTTOM, "concrete", top=False, bottom=False)
    box(x - 0.8, x + 0.8, -HALF + 0.5, HALF - 0.5, DECK_BOTTOM - 1.2, DECK_BOTTOM, "under", top=False)
# 側面のガラス（床から屋根の縁まで）と、腰の低い壁
for y in (-HALF, HALF):
    box(X0, X1, y - 0.15, y + 0.15, DECK_TOP, DECK_TOP + 0.9, "concrete", bottom=False)
    face([(X0, y, DECK_TOP + 0.9), (X1, y, DECK_TOP + 0.9), (X1, y, EAVE), (X0, y, EAVE)], "glass")
# 屋根の膜：M 字の断面を X 方向に伸ばす（表はリブより少し下げる）
for (ya, za), (yb, zb) in zip(PROFILE[:-1], PROFILE[1:]):
    face([(X0, ya, za - 0.15), (X1, ya, za - 0.15), (X1, yb, zb - 0.15), (X0, yb, zb - 0.15)], "roof")
# 東の端の妻面：M 字の形のガラス
mid = len(PROFILE) // 2
gable = [(X1, y, z) for y, z in PROFILE]
face([(X1, -HALF, DECK_TOP)] + gable + [(X1, HALF, DECK_TOP)], "glass")
# 白い M 字のリブ（断面に沿った細い帯を、間隔をあけて並べる）
xs = np.arange(X0 + RIB_STEP / 2, X1, RIB_STEP)
for x in xs:
    w, d = 0.35, 0.55  # 梁の厚さ（X 方向）と、膜から下へ出る深さ
    for (ya, za), (yb, zb) in zip(PROFILE[:-1], PROFILE[1:]):
        for xa, xb in ((x - w, x + w),):
            face([(xa, ya, za), (xb, ya, za), (xb, yb, zb), (xa, yb, zb)], "rib")  # 上面
            face([(xa, yb, zb - d), (xb, yb, zb - d), (xb, ya, za - d), (xa, ya, za - d)], "rib")  # 下面
            face([(xa, ya, za - d), (xa, ya, za), (xa, yb, zb), (xa, yb, zb - d)], "rib")  # 西の面
            face([(xb, yb, zb - d), (xb, yb, zb), (xb, ya, za), (xb, ya, za - d)], "rib")  # 東の面
    for y in (-HALF, HALF):  # 縁から床までの柱
        box(x - w, x + w, y - 0.2, y + 0.2, DECK_TOP + 0.9, EAVE, "rib", top=False, bottom=False)

me = bpy.data.meshes.new("SB_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("SB_Station", me)
export_col.objects.link(ob)

# ---- 下見用 ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=120)
gm = bpy.data.meshes.new("SB_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SB_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("SB_PreviewGround", gm))
sun = bpy.data.objects.new("SB_Sun", bpy.data.lights.new("SB_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SB_Camera", bpy.data.cameras.new("SB_Camera"))
cam.data.lens = 28
preview_col.objects.link(cam)
cam.location = (45, -70, 22)
cam.rotation_euler = (mathutils.Vector((0, 0, 12)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SB_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
bpy.ops.wm.save_as_mainfile(filepath=out)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "shibuya_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f"BUILT {out} tris={tris}")
