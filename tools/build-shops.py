# コンビニの店先（建物の 1 階に付けるガラス張りの正面と、色の帯の看板）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-shops.py -- <保存先の .blend>
#
#   SF_Front    店先（幅 8m・高さ 3.6m）。柱・腰の板・ガラスの壁と自動ドア、明るい店の中（棚の段）、入口の前のマット
#   SF_Sign0〜4 看板（幅 8m）。店の種類ごとの色の帯だけで、店の名前やロゴは描かない
#               （0 そのほか、1 セブン-イレブン風の白に橙・緑・赤の帯、2 ファミリーマート風の緑と青、3 ローソン風の青、4 ミニストップ風の青と黄）
# 原点は壁の根元の真ん中。Blender の +X が店の外（道の側）、Y が壁に沿う向き、Z が高さ。
# ゲーム（src/render3d.js）では、地図データのコンビニ（shops）の建物の、道に近い壁に置く（壁が短ければ幅を縮める）。
# 光る部品（店の中・看板）の材質の名前は「Light」で始める。書き出すものはコレクション「SF_Export」、下見用は「SF_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("shops.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

W, H = 8.0, 3.6  # 店先の幅・高さ
SIGN = (2.85, 3.55)  # 看板の下と上


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.5
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def light(name, hexcolor):
    c = srgb(hexcolor)
    return material(name, c, emit=c)


MAT = {
    "frame": material("SF_Frame", srgb(0xc8ccd0), rough=0.3, metal=0.6),
    "base": material("SF_Base", srgb(0x55595f), rough=0.6),
    "mat": material("SF_Mat", srgb(0x2a2d33), rough=0.9),
    "inside": light("Light_ShopInside", 0xf4f6f8),
    "shelf": light("Light_ShopShelf", 0x9aa6b4),
    "goods": light("Light_ShopGoods", 0xd9b45a),
    "s_white": light("Light_SignWhite", 0xf8f8f4),
    "s_orange": light("Light_SignOrange", 0xf58220),
    "s_green": light("Light_SignGreen", 0x00a050),
    "s_red": light("Light_SignRed", 0xe2231a),
    "s_blue": light("Light_SignBlue", 0x0f5fb0),
    "s_sky": light("Light_SignSky", 0x2e9ad8),
    "s_yellow": light("Light_SignYellow", 0xf5c400),
    "s_navy": light("Light_SignNavy", 0x2a3550),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("SF_Export")
preview_col = bpy.data.collections.new("SF_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def front(self, x, y0, y1, z0, z1, mat):
        """+X を向いた面"""
        self.face([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat)

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (3, 7, 6, 2), (0, 1, 5, 4), (0, 4, 7, 3), (1, 2, 6, 5)):
            self.face([v[i] for i in q], mat)

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        export_col.objects.link(ob)
        return ob


# ---- 店先 ----
p = Part()
hw = W / 2
p.front(0.0, -hw, hw, 0.0, SIGN[0], "inside")  # 店の中の明るい壁（ガラスの奥）
for z in (0.9, 1.5, 2.1):  # 棚の段と商品
    p.front(0.01, -hw + 0.3, hw - 2.4, z, z + 0.06, "shelf")
    for k in range(10):
        y = -hw + 0.4 + k * 0.52
        p.front(0.012, y, y + 0.36, z + 0.06, z + 0.3, "goods")
p.box(0.0, 0.25, -hw, hw, 0.0, 0.35, "base")  # 腰の板
for y in [-hw + k * (W / 5) for k in range(6)]:  # 柱（サッシ）
    p.box(0.02, 0.12, y - 0.05, y + 0.05, 0.0, SIGN[0], "frame")
p.box(0.02, 0.12, -hw, hw, SIGN[0] - 0.1, SIGN[0], "frame")
p.box(0.02, 0.12, -hw, hw, 2.2, 2.26, "frame")
# 自動ドア（右側）と入口の前のマット
p.front(0.13, hw - 2.2, hw - 0.6, 0.0, 2.2, "inside")
p.box(0.12, 0.15, hw - 1.42, hw - 1.38, 0.0, 2.2, "frame")
p.box(0.0, 1.1, hw - 2.3, hw - 0.5, 0.0, 0.02, "mat")
p.box(-0.02, 0.35, -hw - 0.15, hw + 0.15, SIGN[1], SIGN[1] + 0.08, "frame")  # 看板の上のふち
shop = p.finish("SF_Front")


# ---- 看板（店の種類ごとの色の帯） ----
def sign(name, bands):
    """bands：下から（割合, 材質）の帯"""
    p = Part()
    x0, x1 = 0.0, 0.32
    p.box(x0, x1 - 0.02, -hw - 0.1, hw + 0.1, SIGN[0], SIGN[1], "s_white")
    z = SIGN[0]
    for frac, mat in bands:
        z1 = z + (SIGN[1] - SIGN[0]) * frac
        if mat:
            p.front(x1, -hw - 0.1, hw + 0.1, z, z1, mat)
        z = z1
    return p.finish(name)


signs = [
    sign("SF_Sign0", [(0.2, "s_navy"), (0.6, "s_green"), (0.2, "s_navy")]),
    sign("SF_Sign1", [(0.55, "s_white"), (0.15, "s_orange"), (0.15, "s_green"), (0.15, "s_red")]),
    sign("SF_Sign2", [(0.18, "s_blue"), (0.12, "s_white"), (0.4, "s_green"), (0.12, "s_white"), (0.18, "s_blue")]),
    sign("SF_Sign3", [(0.15, "s_white"), (0.7, "s_sky"), (0.15, "s_white")]),
    sign("SF_Sign4", [(0.3, "s_yellow"), (0.7, "s_blue")]),
]

# ---- 下見用（建物の壁に 5 種類の看板の店先を並べる） ----
for ob in [shop] + signs:
    ob.hide_render = True
for i, sg in enumerate(signs):
    for src in (shop, sg):
        pv = src.copy()
        pv.location = (0, (i - 2) * 9.0, 0)
        pv.hide_render = False
        preview_col.objects.link(pv)
wall = bmesh.new()
bmesh.ops.create_cube(wall, size=1.0)
wm = bpy.data.meshes.new("SF_PreviewWall")
wall.to_mesh(wm)
wall.free()
wm.materials.append(material("SF_PreviewWallMat", (0.6, 0.58, 0.55)))
wob = bpy.data.objects.new("SF_PreviewWall", wm)
wob.scale = (6, 46, 12)
wob.location = (-3.0, 0, 6)
preview_col.objects.link(wob)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=40)
gm = bpy.data.meshes.new("SF_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("SF_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("SF_PreviewGround", gm))
sun = bpy.data.objects.new("SF_Sun", bpy.data.lights.new("SF_Sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(60))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("SF_Camera", bpy.data.cameras.new("SF_Camera"))
cam.data.lens = 30
preview_col.objects.link(cam)
cam.location = (22, -14, 6)
cam.rotation_euler = (Vector((0, 2, 2.2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("SF_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 800
scene.render.filepath = os.path.join(os.path.dirname(out), "shops_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in [shop] + signs}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
