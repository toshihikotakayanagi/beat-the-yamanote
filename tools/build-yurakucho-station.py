# 有楽町駅（赤レンガの高架橋の上の駅。高架の下に改札口や飲食店が並ぶ「有楽町ガード下」）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-yurakucho-station.py -- <保存先の .blend>
#
# 作り方は tools/build-kanda-station.py と同じ：高架の両側の側面に赤レンガのアーチが並ぶ壁を立て、改札口に看板を付ける。
#   ・高さはゲームの高架の床板の下面（4.9m）まで。中は空ける（ゲームの地図では、ホームが高さ 5m の箱になっていて
#     ガード下の建物の代わりをしているので、それは残す）
#   ・壁は、高架のいちばん外の線路の 2.2m 外に沿う折れ線。高架の下を横切る道路（南西の錦町有楽町線・大名小路
#     X ≦ -75、北東の道路 X ≧ 83）のあいだだけに置き、改札口と日比谷口の前の広場のところは壁をあける
#   ・ホームと屋根は作らない（ゲームが山手線のホームと屋根を描く）
# 位置は OpenStreetMap のホーム（way 128248384 / 128248385）と改札口（train_station_entrance）に合わせた。
# 赤レンガのアーチは、有楽町〜新橋の高架橋の雰囲気をもとにした簡略化。
# 座標（m）：X は線路の向き（北東が +。方位 47.8°）、Y は北西（日比谷側）が +（正面は南東の銀座側 -Y）、Z は高さ。
# 原点は 2 本のホームの中心（緯度 35.675017、経度 139.763121）。
# 書き出すものはコレクション「YR_Export」、下見用の地面・カメラ・光は「YR_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("yurakucho_station.blend")

# ---- 寸法 ----
H = 4.9  # 壁の高さ（高架の床板の下面）
BAY = 6.0  # アーチ 1 つぶんの幅
# 壁の折れ線（X, Y）：南東は北東へ向かって（外から見て左から右）、北西は南西へ向かって
EAST_WALL = [(-73.0, -32.6), (-40.0, -34.2), (0.0, -34.2), (40.0, -34.2), (81.0, -32.1)]
WEST_WALL = [(81.0, 13.0), (40.0, 16.2), (0.0, 17.2), (-40.0, 15.2), (-73.0, 13.6)]
GAPS = {"east": [(-70.0, -60.0), (-24.0, -14.0), (58.0, 68.0)],  # 銀座口・中央口・京橋口
        "west": [(-70.0, -36.0), (-30.0, -21.0), (52.0, 62.0)]}  # 日比谷口の前の広場・中央西口・国際フォーラム口
# 看板（壁, X の中心, 本文）
SIGNS = [("east", -65.0, "有楽町駅　銀座口"), ("east", -19.0, "有楽町駅　中央口"), ("east", 63.0, "有楽町駅　京橋口"),
         ("west", -58.0, "有楽町駅　日比谷口"), ("west", -25.5, "有楽町駅　中央西口"), ("west", 57.0, "有楽町駅　国際フォーラム口")]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "yurakucho_station_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(67)

BRICK = np.array([0.62, 0.26, 0.19])
BRICK2 = np.array([0.53, 0.2, 0.14])
MORTAR = np.array([0.66, 0.6, 0.55])
STONE = np.array([0.82, 0.8, 0.74])
GLASS = np.array([0.12, 0.14, 0.17])
FRAME = np.array([0.25, 0.25, 0.26])
LIGHT = np.array([1.0, 0.8, 0.52])


def arch_texture(name, px=192):
    """アーチ 1 つぶん（6m × 4.9m）：赤レンガの柱と、アーチの中の店先のガラス（夜は灯る）"""
    ppm = px / BAY
    Hp = int(round(H * ppm))
    ys, xs = np.mgrid[0:Hp, 0:px]
    x, z = (xs + 0.5) / ppm, (ys + 0.5) / ppm
    # レンガ（1 段ごとに半分ずらす）
    bw, bh = 0.5, 0.15
    row = np.floor(z / bh).astype(int)
    xx = x + (row % 2) * bw / 2
    t = ((row * 73 + np.floor(xx / bw).astype(int) * 151) % 17)[..., None] / 16.0
    col = BRICK * (1 - t) + BRICK2 * t
    joint = ((xx % bw) < 1.2 / ppm) | ((z % bh) < 1.2 / ppm)
    col = np.where(joint[..., None], MORTAR, col)
    glow = np.zeros_like(col)
    # アーチの開口：幅 3.6m、2.6m から上は半円
    cx, r, spring = BAY / 2, 1.8, 2.6
    inside = (np.abs(x - cx) <= r) & ((z <= spring) | ((x - cx) ** 2 + (z - spring) ** 2 <= r * r))
    rim = (np.abs(x - cx) <= r + 0.25) & ((z <= spring) | ((x - cx) ** 2 + (z - spring) ** 2 <= (r + 0.25) ** 2)) & ~inside
    col = np.where(rim[..., None], STONE * 0.9, col)  # アーチの縁の石
    lit = rng.uniform(0.5, 1.0)
    col = np.where(inside[..., None], GLASS, col)
    glow = np.where(inside[..., None], LIGHT * lit, glow)
    for fx in (cx - 0.04, cx + 0.04):  # 店先の桟
        m = inside & (np.abs(x - fx) < 0.04)
        col[m] = FRAME
    m = inside & (np.abs(z - 2.3) < 0.05)
    col[m] = FRAME
    key = (np.abs(x - cx) < 0.25) & (z > spring + r - 0.1) & (z < spring + r + 0.35)  # 要石
    col[key] = STONE
    col[(z > H - 0.35)] = STONE  # 上の石の帯
    col[(z < 0.3)] = STONE * 0.8  # 足元
    imgs = []
    for arr, n in ((col, name), (glow, name + "_glow")):
        img = bpy.data.images.new(n, px, Hp, alpha=False)
        rgba = np.ones((Hp, px, 4), np.float32)
        rgba[..., :3] = np.clip(arr + (rng.normal(0, 0.015, (Hp, px, 1)) if n == name else 0), 0, 1)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, n + ".png")
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return imgs


TEX = {"arch": arch_texture("yr_arch")}


def material(name, color=None, tex=None, rough=0.7, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
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
    "arch": material("YR_Arch", tex=TEX["arch"]),
    "brick": material("YR_Brick", (0.36, 0.1, 0.06)),
    "stone": material("YR_Stone", (0.62, 0.6, 0.55)),
    "signboard": material("YR_Signboard", (0.1, 0.11, 0.13), rough=0.5),
    "sign": material("YR_Sign", (0.95, 0.95, 0.95), emit=(1, 1, 1), strength=1.0),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("YR_Export")
preview_col = bpy.data.collections.new("YR_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")


def face(pts, mat, uvs=None, tile=2.0):
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


def y_at(line, x):
    for (xa, ya), (xb, yb) in zip(line[:-1], line[1:]):
        lo, hi = min(xa, xb), max(xa, xb)
        if lo <= x <= hi:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    raise ValueError(x)


def wall(line, gaps):
    """折れ線に沿ってアーチの壁を立てる。gaps の X の範囲はあけ、開口の両わきに厚みを付ける"""
    xs = sorted({line[0][0], line[-1][0]} | {x for g in gaps for x in g} | {p[0] for p in line})
    rev = line[0][0] > line[-1][0]  # 西の壁は X の大きい方から（外から見て左から右）
    pieces = list(zip(xs[:-1], xs[1:]))
    u = 0.0
    for xa, xb in (reversed(pieces) if rev else pieces):
        if any(g0 <= (xa + xb) / 2 <= g1 for g0, g1 in gaps):
            for xg in (xa, xb):  # 開口のわきの厚み（レンガ）
                y = y_at(line, xg)
                d = 1.2 if y > 0 else -1.2
                face([(xg, y, 0), (xg, y - d, 0), (xg, y - d, H), (xg, y, H)], "brick")
            continue
        a, b = (xb, xa) if rev else (xa, xb)
        ya, yb = y_at(line, a), y_at(line, b)
        L = math.hypot(b - a, yb - ya)
        face([(a, ya, 0), (b, yb, 0), (b, yb, H), (a, ya, H)], "arch", [(u, 0), (u + L / BAY, 0), (u + L / BAY, 1), (u, 1)])
        u += L / BAY
        # 上の石の帯を少し張り出す
        d = 0.25 if ya > 0 else -0.25
        face([(a, ya + d, H - 0.35), (b, yb + d, H - 0.35), (b, yb + d, H), (a, ya + d, H)], "stone")


wall(EAST_WALL, GAPS["east"])
wall(WEST_WALL, GAPS["west"])
# 両端の小口（壁の端の厚み）
for line in (EAST_WALL, WEST_WALL):
    for x, y in (line[0], line[-1]):
        d = 1.2 if y > 0 else -1.2
        face([(x, y, 0), (x, y - d, 0), (x, y - d, H), (x, y, H)], "brick")
# 看板の板（壁から少し出す）
for side, x, _ in SIGNS:
    line = EAST_WALL if side == "east" else WEST_WALL
    y = y_at(line, x)
    d = -0.3 if side == "east" else 0.3
    pts = [(x - 4.5, y + d, 3.1), (x + 4.5, y + d, 3.1), (x + 4.5, y + d, 4.5), (x - 4.5, y + d, 4.5)]
    face(pts if side == "east" else [(p[0], p[1], p[2]) for p in reversed(pts)], "signboard")

me = bpy.data.meshes.new("YR_Station")
bm.to_mesh(me)
bm.free()
for m in MAT.values():
    me.materials.append(m)
ob = bpy.data.objects.new("YR_Station", me)
export_col.objects.link(ob)

# ---- 看板の文字（東の壁は東向き、西の壁は西向き） ----
font = None
for f in ("YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"):
    p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break
for side, x, text in SIGNS:
    line = EAST_WALL if side == "east" else WEST_WALL
    y = y_at(line, x) + (-0.35 if side == "east" else 0.35)
    cu = bpy.data.curves.new("YR_SignText", 'FONT')
    cu.body = text
    if font:
        cu.font = font
    cu.size = 0.8
    cu.resolution_u = 2  # 厚みは付けない（ゲームは両面を描く）
    cu.align_x = 'CENTER'
    sign = bpy.data.objects.new("YR_Sign", cu)
    sign.location = (x, y, 3.45)
    sign.rotation_euler = (math.radians(90), 0, math.radians(0 if side == "east" else 180))
    export_col.objects.link(sign)
    cu.materials.append(MAT["sign"])
    for o2 in bpy.context.view_layer.objects:
        o2.select_set(False)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target='MESH')

# ---- 下見用（高架の床板の代わりの板も置く） ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=150)
gm = bpy.data.meshes.new("YR_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("YR_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("YR_PreviewGround", gm))
d = bmesh.new()
bmesh.ops.create_cube(d, size=1.0)
dm = bpy.data.meshes.new("YR_PreviewDeck")
d.to_mesh(dm)
d.free()
dm.materials.append(material("YR_PreviewDeckMat", (0.42, 0.43, 0.47)))
deck = bpy.data.objects.new("YR_PreviewDeck", dm)
deck.location = (4, -9, 5.45)
deck.scale = (154, 54, 1.1)
preview_col.objects.link(deck)
sun = bpy.data.objects.new("YR_Sun", bpy.data.lights.new("YR_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(55), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("YR_Camera", bpy.data.cameras.new("YR_Camera"))
cam.data.lens = 26
preview_col.objects.link(cam)
cam.location = (-40, -90, 14)
cam.rotation_euler = (mathutils.Vector((0, -30, 3)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("YR_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "yurakucho_station_preview.png")
bpy.ops.render.render(write_still=True)
tris = sum(sum(len(p.vertices) - 2 for p in o3.data.polygons) for o3 in export_col.objects)
print(f"BUILT {out} tris={tris}")
