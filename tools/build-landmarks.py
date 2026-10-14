# 遠くから見える目印の高い建物 5 つを、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-landmarks.py -- <保存先の .blend>
#
#   LM_Skytree      東京スカイツリー（634m）。三角の足もとから丸い胴へ、展望デッキ 2 つとアンテナ
#   LM_TokyoTower   東京タワー（333m）。4 本の脚、大展望台・特別展望台、白と赤（インターナショナルオレンジ）の帯
#   LM_Sunshine60   サンシャイン60（240m）。細長い四角柱
#   LM_Tocho        東京都庁第一本庁舎（243m）。低い部分から 2 本の塔に分かれる
#   LM_Docomo       NTTドコモ代々木ビル（272m）。段々に細くなる頭と時計、とがった屋根
# 寸法は実物に近い m。原点は建物の真ん中の地面。Blender の +Y が北、+X が東、Z が高さ（glb では北が -z で、ゲームの地図と同じ）。
# ゲーム（src/render3d.js）では、カメラから実物の位置への向きに、霧の外側（空の球の内側）まで縮めて置く。
# 書き出すものはコレクション「LM_Export」、下見用の地面・カメラ・光は「LM_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("landmarks.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {
    "skytree": material("LM_SkytreeWhite", srgb(0xdfe7f0), rough=0.4, metal=0.3),
    "deck": material("LM_Deck", srgb(0x4d5a6a), rough=0.2, metal=0.4),  # 展望台のガラス
    "orange": material("LM_TowerOrange", srgb(0xf05a28), rough=0.5),
    "white": material("LM_TowerWhite", srgb(0xf2f2ee), rough=0.5),
    "sunshine": material("LM_Sunshine", srgb(0xc4c0b6), rough=0.6),
    "sunshine2": material("LM_SunshineDark", srgb(0x7d7f84), rough=0.4),  # 窓の縦の筋
    "tocho": material("LM_Tocho", srgb(0xb8b6ae), rough=0.6),
    "tocho2": material("LM_TochoDark", srgb(0x6e7178), rough=0.4),
    "docomo": material("LM_Docomo", srgb(0x8a8e95), rough=0.4, metal=0.2),
    "docomo2": material("LM_DocomoDark", srgb(0x4b4f57), rough=0.3),
    "clock": material("LM_Clock", srgb(0xf0efe8), rough=0.5),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("LM_Export")
preview_col = bpy.data.collections.new("LM_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def loft(self, rings, mats, cap_top=True, cap_bottom=False):
        """同じ点の数の輪 rings（下から上）をつなぐ。mats は輪のあいだごとの材質"""
        n = len(rings[0])
        if isinstance(mats, str):
            mats = [mats] * (len(rings) - 1)
        for (A, B), m in zip(zip(rings, rings[1:]), mats):
            for k in range(n):
                self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], m)
        if cap_top:
            self.face(rings[-1], mats[-1])
        if cap_bottom:
            self.face(rings[0][::-1], mats[0])

    def prism(self, outline, z0, z1, mat, top_mat=None):
        A = [Vector((x, y, z0)) for x, y in outline]
        B = [Vector((x, y, z1)) for x, y in outline]
        n = len(outline)
        for k in range(n):
            self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], mat)
        self.face(B, top_mat or mat)

    def box(self, x0, x1, y0, y1, z0, z1, mat, top_mat=None):
        self.prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat, top_mat)

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


def circle(r, z, n=12, rot=0.0):
    return [Vector((math.cos(rot + 2 * math.pi * k / n) * r, math.sin(rot + 2 * math.pi * k / n) * r, z)) for k in range(n)]


def tri_to_circle(r_tri, r_circ, z, t, n=12):
    """三角形（t=0）から円（t=1）へ変わる輪（スカイツリーの足もとから胴へ）"""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n + math.pi / 2
        # 三角形の辺の上の点（中心からの距離）
        seg = (a - math.pi / 2) % (2 * math.pi / 3) - math.pi / 3
        r_t = r_tri * 0.5 / math.cos(seg)
        r = r_t + (r_circ - r_t) * t
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    return pts


# ---- 東京スカイツリー ----
p = Part()
R_TRI = 68 / math.sqrt(3)  # 足もとの三角形（1 辺 68m）の中心から角まで
rings = [tri_to_circle(R_TRI, 34, 0, 0), tri_to_circle(R_TRI * 0.85, 30, 120, 0.4), tri_to_circle(R_TRI * 0.7, 26, 240, 0.85), circle(24, 330)]
p.loft(rings, "skytree", cap_top=False)
p.loft([circle(24, 330), circle(30, 340), circle(30, 352), circle(25, 360), circle(18, 365)], ["deck", "deck", "skytree", "skytree"], cap_top=False)
p.loft([circle(18, 365), circle(15, 440)], "skytree", cap_top=False)
p.loft([circle(15, 440), circle(20, 445), circle(20, 452), circle(12, 458)], ["deck", "deck", "skytree"], cap_top=False)
p.loft([circle(12, 458, 8), circle(7, 500, 8), circle(4, 590, 8), circle(1.5, 634, 8)], "skytree")
skytree = p.finish("LM_Skytree")

# ---- 東京タワー（脚と胴は四角すい台。高さで白と赤の帯に塗り分ける） ----
p = Part()


def sq(r, z):
    return [Vector((r, r, z)), Vector((-r, r, z)), Vector((-r, -r, z)), Vector((r, -r, z))]


def band(z):
    return "orange" if int(z // 31) % 2 == 0 else "white"


# 4 本の脚：足もと（±40m）から大展望台の下（±13m、高さ 110m）へ
for sx in (-1, 1):
    for sy in (-1, 1):
        zs = [0, 31, 62, 93, 110]
        r = lambda z: 40 - (40 - 13) * (z / 110) ** 0.8
        legs = []
        for z in zs:
            c = Vector((sx * r(z), sy * r(z), z))
            w = 5 - 2 * z / 110
            legs.append([c + Vector((w, w, 0)), c + Vector((-w, w, 0)), c + Vector((-w, -w, 0)), c + Vector((w, -w, 0))])
        p.loft(legs, [band(z) for z in zs[:-1]], cap_top=False)
# 脚をつなぐアーチの帯（高さ 45m あたり）
p.loft([sq(30.5, 42), sq(29, 50)], "white", cap_top=False)
# 大展望台（2 階建ての箱）と、その上の胴
p.loft([sq(13, 110), sq(17, 125), sq(17, 150), sq(12, 155)], ["white", "deck", "white"], cap_top=False)
zs = [155, 186, 217, 223]
p.loft([sq(12 - (12 - 5.5) * (z - 155) / 68, z) for z in zs], [band(z) for z in zs[:-1]], cap_top=False)
p.loft([sq(5.5, 223), sq(7, 226), sq(7, 248), sq(4, 252)], ["white", "deck", "white"], cap_top=False)
zs = [252, 279, 310, 333]
p.loft([sq(4 - 3.2 * (z - 252) / 81, z) for z in zs], [band(z) for z in zs[:-1]])
tokyo_tower = p.finish("LM_TokyoTower")

# ---- サンシャイン60（東西に長い四角柱。縦の窓の筋） ----
p = Part()
W, D, H = 70, 38, 240
p.box(-W / 2, W / 2, -D / 2, D / 2, 0, H, "sunshine")
for x in range(-30, 31, 10):  # 南北の面の縦の筋
    for y in (-D / 2 - 0.3, D / 2 + 0.3):
        p.face([(x - 1.5, y, 4), (x + 1.5, y, 4), (x + 1.5, y, H - 6), (x - 1.5, y, H - 6)], "sunshine2")
for y in range(-14, 15, 7):
    for x in (-W / 2 - 0.3, W / 2 + 0.3):
        p.face([(x, y - 1.2, 4), (x, y + 1.2, 4), (x, y + 1.2, H - 6), (x, y - 1.2, H - 6)], "sunshine2")
p.box(-W / 2 + 6, W / 2 - 6, -D / 2 + 6, D / 2 - 6, H, H + 6, "sunshine2")  # 屋上の機械室
sunshine = p.finish("LM_Sunshine60")

# ---- 東京都庁第一本庁舎（低い部分から 2 本の塔。塔の上は 45 度回した形） ----
p = Part()
p.box(-55, 55, -22, 22, 0, 160, "tocho", "tocho2")
for x in (-30, 30):
    p.box(x - 17, x + 17, -17, 17, 160, 205, "tocho")
    oct8 = lambda r, z: [Vector((x + math.cos(math.pi / 8 + k * math.pi / 4) * r, math.sin(math.pi / 8 + k * math.pi / 4) * r, z)) for k in range(8)]
    p.loft([oct8(18.5, 205), oct8(18.5, 236), oct8(14, 243)], ["tocho", "tocho2"])
    for y in (-17.3, 17.3):  # 窓の縦の筋
        for dx in (-9, 0, 9):
            p.face([(x + dx - 2, y, 10), (x + dx + 2, y, 10), (x + dx + 2, y, 200), (x + dx - 2, y, 200)], "tocho2")
for y in (-22.3, 22.3):
    for dx in range(-48, 49, 12):
        if abs(abs(dx) - 30) > 14:
            p.face([(dx - 2, y, 8), (dx + 2, y, 8), (dx + 2, y, 155), (dx - 2, y, 155)], "tocho2")
tocho = p.finish("LM_Tocho")

# ---- NTTドコモ代々木ビル（段々に細くなる頭、四方の時計、とがった屋根） ----
p = Part()
p.box(-28, 28, -22, 22, 0, 150, "docomo", "docomo2")
p.box(-25, 25, -19, 19, 150, 180, "docomo")
p.box(-21, 21, -16, 16, 180, 205, "docomo2")
p.box(-16, 16, -14, 14, 205, 225, "docomo")
for s in (-1, 1):  # 時計（南北と東西の面）
    y = s * 14.3
    p.face([(math.cos(2 * math.pi * k / 12) * 8, y, 215 + math.sin(2 * math.pi * k / 12) * 8) for k in range(12)], "clock")
    x0 = s * 16.3
    p.face([(x0, math.cos(2 * math.pi * k / 12) * 7, 215 + math.sin(2 * math.pi * k / 12) * 7) for k in range(12)], "clock")
p.loft([[Vector((x, y, 225)) for x, y in ((14, 12), (-14, 12), (-14, -12), (14, -12))], [Vector((x, y, 255)) for x, y in ((3, 3), (-3, 3), (-3, -3), (3, -3))]], "docomo2", cap_top=False)
p.loft([sq(1.6, 255), sq(0.3, 272)], "docomo")
docomo = p.finish("LM_Docomo")

marks = [skytree, tokyo_tower, sunshine, tocho, docomo]

# ---- 下見用（5 つを並べる） ----
for i, ob in enumerate(marks):
    ob.location = ((i - 2) * 160, 0, 0)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=600)
gm = bpy.data.meshes.new("LM_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("LM_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("LM_PreviewGround", gm))
sun = bpy.data.objects.new("LM_Sun", bpy.data.lights.new("LM_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), 0, math.radians(-150))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("LM_Camera", bpy.data.cameras.new("LM_Camera"))
cam.data.lens = 35
preview_col.objects.link(cam)
cam.location = (120, -900, 260)
cam.rotation_euler = (Vector((0, 0, 260)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.clip_end = 5000
scene.camera = cam
world = bpy.data.worlds.new("LM_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "landmarks_preview.png")
bpy.ops.render.render(write_still=True)
for ob in marks:  # 書き出す前に、どれも原点に戻す
    ob.location = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in marks}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
