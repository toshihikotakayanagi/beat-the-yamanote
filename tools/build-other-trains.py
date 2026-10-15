# 山手線と並んで走るほかの電車（JR・私鉄の通勤電車と新幹線）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-other-trains.py -- <保存先の .blend>
#
#   OT_Lead・OT_Middle   ステンレスの通勤電車（長さ 20m）の先頭車と中間車。窓の下の帯（OT_Band）と、その下の 2 本目の帯（OT_Band2）は
#                        ゲームで路線の色にする（京浜東北線は水色、中央線はオレンジ、東海道線はオレンジと緑など）
#   OT_SkLead・OT_SkMiddle  新幹線（長さ 25m）の先頭車と中間車。帯（OT_Band）と車体の上の色（OT_Band2）は路線の色にする
# 最後尾の車両は、先頭車をゲームで後ろ向きに置いて使う。窓の材質「Light_Window」はゲームで夕方・夜に灯す。
# 原点は車両の真ん中のレールの上。Blender の +Y が前（glb では -z、ゲームの電車の前）、X は左右、Z は高さ。
# 書き出すものはコレクション「OT_Export」、下見用の地面・カメラ・光は「OT_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("other_trains.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


MAT = {
    "stain": material("OT_Stainless", (0.6, 0.62, 0.66), rough=0.35, metal=0.4),
    "door": material("OT_Door", (0.48, 0.5, 0.54), rough=0.35, metal=0.4),
    "roof": material("OT_Roof", (0.35, 0.37, 0.4), rough=0.6),
    "dark": material("OT_Dark", (0.02, 0.022, 0.026), rough=0.8),
    "black": material("OT_Face", (0.01, 0.012, 0.015), rough=0.3),
    "glass": material("OT_Glass", (0.012, 0.018, 0.026), rough=0.1, metal=0.3),
    "band": material("OT_Band", (0.0, 0.45, 0.75), rough=0.4),  # ゲームで路線の色にする
    "band2": material("OT_Band2", (0.0, 0.45, 0.75), rough=0.4),  # 2 本目の帯・新幹線の車体の上（ゲームで路線の色にする）
    "white": material("OT_White", (0.85, 0.86, 0.87), rough=0.3),
    "window": material("Light_Window", (0.95, 0.9, 0.75), emit=(0.95, 0.9, 0.75)),
    "head": material("Light_Head", (1.0, 0.97, 0.85), emit=(1.0, 0.97, 0.85)),
    "dest": material("Light_Dest", (1.0, 0.6, 0.15), emit=(1.0, 0.6, 0.15)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("OT_Export")
preview_col = bpy.data.collections.new("OT_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (3, 7, 6, 2), (0, 1, 5, 4), (0, 4, 7, 3), (1, 2, 6, 5)):
            self.face([v[i] for i in q], mat)

    def side(self, x, y0, y1, z0, z1, mat):
        """車体の横 x（正なら右）に貼る帯・窓"""
        pts = [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
        self.face(pts if x > 0 else pts[::-1], mat)

    def shell(self, profile, stations, edge_mat, cap_front=None, cap_back=None):
        """断面 profile（右側の下から上）を左右に広げた輪を、stations（y, 幅の倍率, 高さの倍率）の順につなぐ。
        edge_mat(i, k) は i 番目の区間の k 番目の辺の材質。高さの倍率は車体の下の端から縮める"""
        z0 = profile[0][1]
        rings = []
        for y, sw, sh in stations:
            right = [Vector((x * sw, y, z0 + (z - z0) * sh)) for x, z in profile]
            left = [Vector((-v.x, v.y, v.z)) for v in reversed(right)]
            rings.append(right + left)
        n = len(rings[0])
        for i, (A, B) in enumerate(zip(rings, rings[1:])):
            for k in range(n):
                self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], edge_mat(i, k))
        if cap_back:
            self.face(rings[0], cap_back)
        if cap_front:
            self.face(rings[-1][::-1], cap_front)
        return rings

    def bogies(self, ys, hw):
        for yb in ys:
            self.box(-hw + 0.25, hw - 0.25, yb - 1.3, yb + 1.3, 0.25, 0.75, "dark")
            for dy in (-0.9, 0.9):
                for s in (-1, 1):
                    self.box(s * 0.7 - 0.06, s * 0.7 + 0.06, yb + dy - 0.43, yb + dy + 0.43, 0.0, 0.86, "dark")

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


# ---- 通勤電車（E233 系のようなステンレスの車体。長さ 20m・幅 2.95m） ----
CM_L = 20.0
CM_PROFILE = [(1.38, 1.0), (1.47, 1.3), (1.48, 2.0), (1.47, 3.2), (1.38, 3.45), (1.1, 3.62), (0.55, 3.7)]
CM_DOORS = (-7.35, -2.45, 2.45, 7.35)
CM_DOOR_W = 1.3


def cm_edge(i, k):
    # 辺：0〜5 右（下から上）、6 屋根の真ん中、7〜12 左（上から下）、13 床下
    if k in (0, 12):
        return "dark"
    if k in (4, 5, 6, 7, 8):
        return "roof"
    if k == 13:
        return "dark"
    return "stain"


def commuter(name, lead):
    p = Part()
    hl = CM_L / 2
    front = hl - (0.9 if lead else 0)
    p.shell(CM_PROFILE, [(-hl, 1, 1), (front, 1, 1)], cm_edge, cap_back="dark", cap_front=None if lead else "dark")
    x = 1.48 + 0.006
    for s in (-1, 1):
        xs = s * x
        p.side(xs, -hl + 0.2, front - 0.1, 1.95, 2.1, "band")  # 窓の下の帯
        p.side(xs, -hl + 0.2, front - 0.1, 1.82, 1.95, "band2")  # 2 本目の帯
        p.side(xs, -hl + 0.2, front - 0.1, 3.15, 3.22, "band")  # 屋根の下の細い帯
        edges = [-hl + 0.5] + [v for d in CM_DOORS for v in (d - CM_DOOR_W / 2 - 0.25, d + CM_DOOR_W / 2 + 0.25)] + [front - 0.5]
        for y0, y1 in zip(edges[0::2], edges[1::2]):
            if y1 - y0 > 0.5:
                p.side(s * (x + 0.001), y0, y1, 2.2, 3.0, "window")
        for d in CM_DOORS:
            if d + CM_DOOR_W / 2 > front:
                continue
            p.side(s * (x + 0.002), d - CM_DOOR_W / 2, d + CM_DOOR_W / 2, 1.15, 3.05, "door")
            for a, b in ((d - CM_DOOR_W / 2 + 0.12, d - 0.06), (d + 0.06, d + CM_DOOR_W / 2 - 0.12)):
                p.side(s * (x + 0.003), a, b, 2.25, 2.95, "window")
    p.box(-1.3, 1.3, -hl + 1.0, front - 1.0, 0.75, 1.0, "dark")  # 床下の機器
    p.bogies((-hl + 3.0, hl - 3.0), 1.47)
    for yy in (-4.5, 4.5):  # 屋根の冷房
        p.box(-0.8, 0.8, yy - 1.4, yy + 1.4, 3.66, 3.95, "roof")
    if lead:
        # 運転台：少し傾いた黒い顔、大きな窓、行き先表示、帯、前照灯、連結器
        f0, f1 = front, hl
        face = [Vector((1.4, f0, 1.05)), Vector((1.4, f1, 1.05)), Vector((1.4, f1 - 0.15, 3.45)), Vector((1.1, f0, 3.62))]
        p.face([(-v.x, v.y, v.z) for v in face], "black")
        p.face([v for v in face][::-1], "black")
        p.face([(-1.42, f1, 1.05), (1.42, f1, 1.05), (1.4, f1 - 0.15, 3.4), (-1.4, f1 - 0.15, 3.4)], "black")
        p.face([(-1.3, f1 + 0.01, 2.15), (1.3, f1 + 0.01, 2.15), (1.25, f1 - 0.12, 3.15), (-1.25, f1 - 0.12, 3.15)], "glass")
        p.face([(-0.7, f1 - 0.11, 3.18), (0.7, f1 - 0.11, 3.18), (0.7, f1 - 0.13, 3.36), (-0.7, f1 - 0.13, 3.36)], "dest")
        p.face([(-1.42, f1 + 0.02, 1.7), (1.42, f1 + 0.02, 1.7), (1.42, f1 + 0.015, 2.05), (-1.42, f1 + 0.015, 2.05)], "band")
        p.face([(-1.42, f1 + 0.025, 1.55), (1.42, f1 + 0.025, 1.55), (1.42, f1 + 0.02, 1.7), (-1.42, f1 + 0.02, 1.7)], "band2")
        for s in (-1, 1):
            p.box(s * 1.0 - 0.2, s * 1.0 + 0.2, f1, f1 + 0.04, 1.3, 1.45, "head")
        roof = [Vector((1.38, f0, 3.45)), Vector((1.1, f0, 3.62)), Vector((0.55, f0, 3.7)), Vector((-0.55, f0, 3.7)), Vector((-1.1, f0, 3.62)), Vector((-1.38, f0, 3.45))]
        roof2 = [Vector((v.x * 0.98, f1 - 0.15, min(v.z, 3.48))) for v in roof]
        for a, b, c, d in zip(roof, roof[1:], roof2[1:], roof2):
            p.face([a, b, c, d], "roof")
        p.box(-0.3, 0.3, f1 - 0.2, f1 + 0.5, 0.75, 1.0, "dark")  # 連結器
        p.box(-1.35, 1.35, f1 - 0.3, f1 + 0.05, 0.55, 1.05, "dark")  # スカート
    return p.finish(name)


# ---- 新幹線（長さ 25m・幅 3.38m。先頭車は長い鼻） ----
SK_L = 25.0
SK_PROFILE = [(1.55, 0.9), (1.69, 1.3), (1.69, 2.6), (1.6, 3.2), (1.3, 3.5), (0.7, 3.63)]


def sk_body_mat(k):
    # 辺：0〜4 右、5 屋根の真ん中、6〜10 左、11 床下
    if k == 11 or k == 0 or k == 10:
        return "white"
    if k in (3, 4, 5, 6, 7):
        return "band2"  # 車体の上（東海道新幹線は白、東北新幹線は緑）
    return "white"


def shinkansen(name, lead):
    p = Part()
    hl = SK_L / 2
    nose0 = hl - 8.5  # 鼻の始まり
    if lead:
        st = [(-hl, 1, 1), (nose0, 1, 1), (nose0 + 2.0, 0.98, 0.88), (nose0 + 4.0, 0.86, 0.66), (nose0 + 5.6, 0.68, 0.48),
              (nose0 + 7.0, 0.45, 0.33), (nose0 + 8.0, 0.22, 0.22), (hl, 0.06, 0.15)]

        def mat(i, k):
            if i in (2, 3) and k in (3, 4, 5, 6, 7):
                return "glass"  # 運転台の窓
            if i >= 1 and k in (1, 9):
                return "band"  # 鼻に続く帯
            return sk_body_mat(k)
        p.shell(SK_PROFILE, st, mat, cap_back="dark", cap_front="white")
        for s in (-1, 1):
            p.box(s * 0.75 - 0.18, s * 0.75 + 0.18, nose0 + 6.5, nose0 + 6.6, 1.15, 1.3, "head")
    else:
        p.shell(SK_PROFILE, [(-hl, 1, 1), (hl, 1, 1)], lambda i, k: sk_body_mat(k), cap_back="dark", cap_front="dark")
    front = nose0 if lead else hl
    x = 1.69 + 0.006
    for s in (-1, 1):
        xs = s * x
        p.side(xs, -hl + 0.3, front, 1.45, 1.68, "band")
        p.side(s * (x + 0.001), -hl + 2.0, front - (1.0 if lead else 2.0), 2.05, 2.45, "window")
        for y in [-hl + 2.0 + 1.05 * k for k in range(1, int((front - (1.0 if lead else 2.0) + hl - 2.0) / 1.05))]:
            p.side(s * (x + 0.002), y - 0.06, y + 0.06, 2.05, 2.45, "white")  # 窓のあいだの柱
        for y in (-hl + 1.0, front - (0.5 if lead else 1.0)):  # ドア
            p.side(s * (x + 0.002), y - 0.5, y + 0.5, 1.2, 2.85, "door")
    p.box(-1.4, 1.4, -hl + 1.0, front - 1.0, 0.55, 0.9, "dark")
    p.bogies((-hl + 3.5, hl - 3.5 if not lead else nose0 - 1.0), 1.69)
    return p.finish(name)


cars = [commuter("OT_Lead", True), commuter("OT_Middle", False), shinkansen("OT_SkLead", True), shinkansen("OT_SkMiddle", False)]

# ---- 下見用（京浜東北線の色の通勤電車と、東海道新幹線の色の新幹線を並べる） ----
for ob in cars:
    ob.hide_render = True
colors = {"OT_Lead": ((0.0, 0.5, 0.8), (0.0, 0.5, 0.8)), "OT_Middle": ((0.0, 0.5, 0.8), (0.0, 0.5, 0.8)),
          "OT_SkLead": ((0.02, 0.15, 0.6), (0.85, 0.86, 0.87)), "OT_SkMiddle": ((0.02, 0.15, 0.6), (0.85, 0.86, 0.87))}
for i, ob in enumerate(cars):
    pv = ob.copy()
    pv.data = ob.data.copy()
    b1, b2 = colors[ob.name]
    pv.data.materials[MI["band"]] = material(f"OT_PrevBand_{i}", b1)
    pv.data.materials[MI["band2"]] = material(f"OT_PrevBand2_{i}", b2)
    pv.location = (0 if i < 2 else 5.5, (-20.4 * (i % 2)) if i < 2 else (-25.4 * (i % 2)), 0)
    pv.hide_render = False
    preview_col.objects.link(pv)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=40)
gm = bpy.data.meshes.new("OT_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("OT_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("OT_PreviewGround", gm))
sun = bpy.data.objects.new("OT_Sun", bpy.data.lights.new("OT_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-140))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("OT_Camera", bpy.data.cameras.new("OT_Camera"))
cam.data.lens = 35
preview_col.objects.link(cam)
cam.location = (-12.0, 22.0, 7.0)
cam.rotation_euler = (Vector((2.5, 2.0, 1.8)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("OT_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "other_trains_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in cars}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
