# 街路樹・公園の木 4 種類を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-trees.py -- <保存先の .blend>
#
# 木は「TREE_Round」（広葉樹。ケヤキやプラタナスのような丸い木）、「TREE_Ginkgo」（イチョウ。縦長）、
# 「TREE_Sakura」（桜。低く横に広い、花の色）、「TREE_Conifer」（針葉樹。円すいを重ねた形）。
# 地図データの木の種類（tools/fetch-osm.mjs の treeKind：0〜3）と同じ順。
# 原点は幹の根元（地面）。Z が高さ（m）。ゲームでは区間の木ぜんぶを種類ごとに 1 つの InstancedMesh で描き、
# 1 本ずつ向き・大きさ・色の明るさを少し変える。
# 書き出すものはコレクション「TREE_Export」、下見用の地面・カメラ・光は「TREE_Preview」。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("trees.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {
    "trunk": material("TREE_Trunk", srgb(0x5b4636)),
    "leaf": material("TREE_Leaf", srgb(0x4f8a3c)),  # 広葉樹の葉
    "leaf2": material("TREE_LeafDark", srgb(0x3f7531)),  # 影になる内側の葉
    "ginkgo": material("TREE_Ginkgo", srgb(0x6f9e3a)),  # イチョウの葉（明るい黄緑）
    "sakura": material("TREE_Blossom", srgb(0xf2b8c8)),  # 桜の花
    "sakura2": material("TREE_Blossom2", srgb(0xe59fb4)),
    "conifer": material("TREE_Needle", srgb(0x2f5a34)),  # 針葉樹の葉
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("TREE_Export")
preview_col = bpy.data.collections.new("TREE_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)

# 正二十面体を 1 回分けた球（80 面）の頂点と面（葉のかたまりに使う）
_t = bmesh.new()
bmesh.ops.create_icosphere(_t, subdivisions=2, radius=1.0)
ICO_V = [v.co.copy() for v in _t.verts]
ICO_F = [[v.index for v in f.verts] for f in _t.faces]
_t.free()


class Part:
    def __init__(self, seed):
        self.bm = bmesh.new()
        self.rng = random.Random(seed)

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def blob(self, c, rx, ry, rz, mat, jitter=0.18):
        """葉のかたまり：でこぼこにした、だ円の球"""
        c = Vector(c)
        vs = [c + Vector((v.x * rx, v.y * ry, v.z * rz)) * (1 + self.rng.uniform(-jitter, jitter)) for v in ICO_V]
        for f in ICO_F:
            self.face([vs[i] for i in f], mat)

    def tube(self, a, b, r0, r1, mat, seg=6):
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        up = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
        u = d.cross(up).normalized()
        v = d.cross(u).normalized()
        ring = lambda c, r: [c + u * (math.cos(2 * math.pi * k / seg) * r) + v * (math.sin(2 * math.pi * k / seg) * r) for k in range(seg)]
        A, B = ring(a, r0), ring(b, r1)
        for k in range(seg):
            self.face([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]], mat)
        self.face(B, mat)

    def cone(self, base_z, top_z, r, mat, seg=8):
        """針葉樹の段（下が開いた円すい）"""
        rot = self.rng.uniform(0, math.pi)
        ring = [Vector((math.cos(rot + 2 * math.pi * k / seg) * r * self.rng.uniform(0.9, 1.1),
                        math.sin(rot + 2 * math.pi * k / seg) * r * self.rng.uniform(0.9, 1.1), base_z + self.rng.uniform(-0.1, 0.1))) for k in range(seg)]
        tip = Vector((0, 0, top_z))
        for k in range(seg):
            self.face([ring[k], ring[(k + 1) % seg], tip], mat)
        self.face(ring[::-1], mat)

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


def branches(p, top, n, spread, mat="trunk"):
    """幹の上の方から斜めに出る枝"""
    for k in range(n):
        a = 2 * math.pi * k / n + p.rng.uniform(-0.3, 0.3)
        z0 = top * p.rng.uniform(0.75, 0.9)
        p.tube((0, 0, z0), (math.cos(a) * spread, math.sin(a) * spread, z0 + spread * 0.9), 0.08, 0.04, mat, seg=4)


# ---- 広葉樹（丸い木。高さ約 7.5m） ----
p = Part(1)
p.tube((0, 0, 0), (0, 0, 3.2), 0.2, 0.14, "trunk")
branches(p, 3.2, 3, 1.0)
p.blob((0, 0, 4.9), 2.3, 2.3, 1.9, "leaf2", 0.12)
for a, (dx, dy, dz, r) in enumerate([(1.1, 0.3, 4.6, 1.5), (-0.9, 0.9, 4.8, 1.5), (-0.4, -1.1, 4.5, 1.4), (0.2, 0.1, 6.0, 1.5)]):
    p.blob((dx, dy, dz), r, r, r * 0.85, "leaf")
round_ = p.finish("TREE_Round")

# ---- イチョウ（縦長。高さ約 9m） ----
p = Part(2)
p.tube((0, 0, 0), (0, 0, 7.5), 0.2, 0.08, "trunk")
p.blob((0, 0, 4.6), 1.6, 1.6, 2.4, "ginkgo", 0.15)
p.blob((0, 0, 6.8), 1.1, 1.1, 1.8, "ginkgo", 0.15)
p.blob((0.3, -0.2, 3.4), 1.7, 1.6, 1.3, "ginkgo", 0.15)
ginkgo = p.finish("TREE_Ginkgo")

# ---- 桜（低く横に広い。高さ約 5.5m） ----
p = Part(3)
p.tube((0, 0, 0), (0, 0, 1.8), 0.24, 0.18, "trunk")
for k in range(4):
    a = 2 * math.pi * k / 4 + 0.4
    p.tube((0, 0, 1.6), (math.cos(a) * 1.8, math.sin(a) * 1.8, 3.4), 0.13, 0.06, "trunk", seg=5)
p.blob((0, 0, 3.9), 2.8, 2.8, 1.3, "sakura2", 0.12)
for k in range(5):
    a = 2 * math.pi * k / 5
    p.blob((math.cos(a) * 1.7, math.sin(a) * 1.7, 3.9 + p.rng.uniform(-0.2, 0.4)), 1.5, 1.5, 1.0, "sakura")
p.blob((0, 0, 4.7), 1.6, 1.6, 0.9, "sakura")
sakura = p.finish("TREE_Sakura")

# ---- 針葉樹（円すいを重ねた形。高さ約 8m） ----
p = Part(4)
p.tube((0, 0, 0), (0, 0, 2.0), 0.18, 0.14, "trunk")
for k, (z0, z1, r) in enumerate([(1.5, 4.6, 2.0), (3.0, 6.0, 1.6), (4.4, 7.2, 1.2), (5.6, 8.2, 0.75)]):
    p.cone(z0, z1, r, "conifer")
conifer = p.finish("TREE_Conifer")

trees = [round_, ginkgo, sakura, conifer]

# ---- 下見用（4 本を並べる） ----
for i, ob in enumerate(trees):
    ob.location = ((i - 1.5) * 6.5, 0, 0)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=20)
gm = bpy.data.meshes.new("TREE_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TREE_PreviewGroundMat", (0.3, 0.31, 0.33)))
preview_col.objects.link(bpy.data.objects.new("TREE_PreviewGround", gm))
sun = bpy.data.objects.new("TREE_Sun", bpy.data.lights.new("TREE_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), 0, math.radians(-130))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TREE_Camera", bpy.data.cameras.new("TREE_Camera"))
cam.data.lens = 35
preview_col.objects.link(cam)
cam.location = (4.0, -24.0, 6.0)
cam.rotation_euler = (Vector((0, 0, 4.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TREE_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 800
scene.render.filepath = os.path.join(os.path.dirname(out), "trees_preview.png")
bpy.ops.render.render(write_still=True)
for ob in trees:  # 書き出す前に、どの木も原点に戻す
    ob.location = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in trees}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
