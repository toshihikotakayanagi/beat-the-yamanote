# 道路を走る車 4 種類（セダン・軽自動車・ミニバン・タクシー）を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-cars.py -- <保存先の .blend>
#
# 車は「CV_Sedan」「CV_Kei」「CV_Minivan」「CV_Taxi」。寸法は src/vehicles.js の CAR_TYPES と同じ
# （L：長さ、W：幅、body：下の車体の下と上の高さ、cabin：窓の部分の下と上の高さ、cabinBottom・cabinTop：窓の部分の下と上の前後の端）。
# 原点は地面の上の車の真ん中。Blender の +Y が前（glb では -z、ゲームの車の前）、X は左右、Z は高さ。
# 車体の色の材質は「CV_Paint」（ゲームで車ごとの色にする）。光る部品の材質の名前は「Light」で始める
# （ゲームでは光の当たり方によらない色で描く）。
# 書き出すものはコレクション「CV_Export」、下見用の地面・カメラ・光は「CV_Preview」。
import bpy, bmesh, math, os, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("cars.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# src/vehicles.js の CAR_TYPES と同じ（前後はゲームの z：前が負）
TYPES = {
    "sedan": dict(L=4.6, W=1.76, body=(0.32, 0.92), cabin=(0.92, 1.42), cabinBottom=(-1.15, 1.35), cabinTop=(-0.55, 0.9)),
    "kei": dict(L=3.4, W=1.48, body=(0.3, 0.88), cabin=(0.88, 1.68), cabinBottom=(-0.75, 1.55), cabinTop=(-0.45, 1.5)),
    "minivan": dict(L=4.7, W=1.78, body=(0.32, 1.0), cabin=(1.0, 1.86), cabinBottom=(-1.35, 2.25), cabinTop=(-0.95, 2.2)),
    "taxi": dict(L=4.4, W=1.7, body=(0.32, 0.98), cabin=(0.98, 1.72), cabinBottom=(-1.0, 1.95), cabinTop=(-0.65, 1.9), sign=True),
}
NAMES = {"sedan": "CV_Sedan", "kei": "CV_Kei", "minivan": "CV_Minivan", "taxi": "CV_Taxi"}
PREVIEW_PAINT = {"sedan": (0.08, 0.25, 0.85), "kei": (0.85, 0.85, 0.85), "minivan": (0.75, 0.07, 0.07), "taxi": (0.015, 0.023, 0.057)}


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


MAT = {
    "paint": material("CV_Paint", (0.6, 0.6, 0.6), rough=0.3, metal=0.3),
    "glass": material("CV_Glass", (0.012, 0.017, 0.025), rough=0.1, metal=0.3),
    "dark": material("CV_Dark", (0.02, 0.022, 0.026), rough=0.7),  # バンパー・グリル・タイヤハウス・すきま
    "tire": material("CV_Tire", (0.008, 0.009, 0.01), rough=0.9),
    "wheel": material("CV_Wheel", (0.45, 0.47, 0.5), rough=0.3, metal=0.7),  # ホイール・ドアの取っ手
    "plate": material("CV_Plate", (0.9, 0.9, 0.86), rough=0.5),  # ナンバープレート（白）
    "platek": material("CV_PlateKei", (0.95, 0.8, 0.1), rough=0.5),  # 軽自動車のナンバープレート（黄）
    "head": material("Light_Head", (1.0, 0.95, 0.8), emit=(1.0, 0.95, 0.8)),
    "tail": material("Light_Tail", (1.0, 0.05, 0.05), emit=(1.0, 0.05, 0.05)),
    "sign": material("Light_Sign", (1.0, 0.65, 0.07), emit=(1.0, 0.65, 0.07)),  # タクシーの屋根の行灯・方向指示器
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("CV_Export")
preview_col = bpy.data.collections.new("CV_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(tuple(p)) for p in pts])
        f.material_index = MI[mat]
        return f

    def sections(self, secs, mats, caps=True):
        """同じ点の数の断面 secs を順につないだ筒。mats は断面の辺ごとの材質"""
        n = len(secs[0])
        for A, B in zip(secs, secs[1:]):
            for k in range(n):
                self.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], mats[k])
        if caps:
            self.face(secs[0][::-1], mats[0] if isinstance(mats, str) else "paint")
            self.face(secs[-1], "paint")

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        v = [Vector(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (3, 7, 6, 2), (0, 1, 5, 4), (0, 4, 7, 3), (1, 2, 6, 5)):
            self.face([v[i] for i in q], mat)

    def wheel(self, x, y, r, w, sides=14):
        """タイヤ（x 向きの円柱）と外側のホイール"""
        z = r
        ring = [(math.cos(2 * math.pi * k / sides), math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        x0, x1 = x - w / 2, x + w / 2
        for k in range(sides):
            (a, b), (c, d) = ring[k], ring[(k + 1) % sides]
            self.face([(x0, y + a * r, z + b * r), (x0, y + c * r, z + d * r), (x1, y + c * r, z + d * r), (x1, y + a * r, z + b * r)], "tire")
        out_x = x1 if x > 0 else x0
        in_x = x0 if x > 0 else x1
        self.face([(in_x, y + a * r, z + b * r) for a, b in ring], "tire")
        self.face([(out_x, y + a * r, z + b * r) for a, b in ring], "tire")
        s = 1 if x > 0 else -1
        rim = [(out_x + s * 0.004, y + a * r * 0.62, z + b * r * 0.62) for a, b in ring]
        self.face(rim if s > 0 else rim[::-1], "wheel")
        for k in range(0, sides, 2):  # ホイールの穴（すきま）
            a, b = ring[k]
            c_ = (out_x + s * 0.007, y + a * r * 0.4, z + b * r * 0.4)
            self.face([(c_[0], c_[1] + dy, c_[2] + dz) for dy, dz in ((-0.025, -0.025), (0.025, -0.025), (0.025, 0.025), (-0.025, 0.025))], "dark")

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


def build(kind):
    t = TYPES[kind]
    p = Part()
    L, W = t["L"], t["W"]
    hl, hw = L / 2, W / 2
    y0, y1 = t["body"]
    c0, c1 = t["cabin"]
    yF, yB = -t["cabinBottom"][0], -t["cabinBottom"][1]  # 窓の部分の下の前後の端（Blender の y）
    tF, tB = -t["cabinTop"][0], -t["cabinTop"][1]
    boxy = kind in ("kei", "minivan", "taxi")

    # ---- 下の車体：断面を前から後ろへつなぐ（角は丸く、前後の端は少し細く低い） ----
    def sec(y, w, top, bot):
        return [Vector(v) for v in [(w - 0.06, y, bot), (w, y, bot + 0.12), (w, y, top - 0.1), (w - 0.07, y, top),
                                    (-w + 0.07, y, top), (-w, y, top - 0.1), (-w, y, bot + 0.12), (-w + 0.06, y, bot)]]
    nose = 0.08 if boxy else 0.16  # ボンネットの前の下がり
    stations = [(hl, hw - 0.12, y1 - nose - 0.06, y0 + 0.06), (hl - 0.12, hw - 0.02, y1 - nose, y0), (hl - 0.45, hw, y1 - nose * 0.4, y0),
                (yF, hw, y1, y0), (-hl + 0.45, hw, y1, y0), (-hl + 0.1, hw - 0.02, y1 - 0.02, y0), (-hl, hw - 0.1, y1 - 0.06, y0 + 0.06)]
    stations.sort(key=lambda s: -s[0])
    secs = [sec(*s) for s in stations]
    p.sections(secs, ["dark", "paint", "paint", "paint", "paint", "paint", "paint", "dark"])

    # ---- 窓の部分と屋根 ----
    bw, tw = hw - 0.06, hw - 0.17
    zt = c1 - 0.07
    base = [Vector((bw, yF, c0)), Vector((-bw, yF, c0)), Vector((-bw, yB, c0)), Vector((bw, yB, c0))]
    top = [Vector((tw, tF, zt)), Vector((-tw, tF, zt)), Vector((-tw, tB, zt)), Vector((tw, tB, zt))]
    p.face([base[0], base[1], top[1], top[0]], "glass")  # 前のガラス
    p.face([base[2], base[3], top[3], top[2]], "glass")  # 後ろのガラス
    p.face([base[3], base[0], top[0], top[3]], "glass")  # 右
    p.face([base[1], base[2], top[2], top[1]], "glass")  # 左
    # 屋根（少し丸みのある板）
    rw = tw + 0.03
    r0 = [Vector((rw, tF + 0.03, zt)), Vector((-rw, tF + 0.03, zt)), Vector((-rw, tB - 0.03, zt)), Vector((rw, tB - 0.03, zt))]
    r1 = [Vector((rw - 0.08, tF - 0.04, c1)), Vector((-rw + 0.08, tF - 0.04, c1)), Vector((-rw + 0.08, tB + 0.04, c1)), Vector((rw - 0.08, tB + 0.04, c1))]
    p.face(r1, "paint")
    for k in range(4):
        p.face([r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]], "paint")

    # 柱（窓の外側に少し浮かせた帯）。側面の上の高さ u（0〜1）での前の端・後ろの端・横の位置
    def side_pt(s, y, u):
        x = bw + (tw - bw) * u
        return Vector((s * (x + 0.008), y, c0 + (zt - c0) * u))

    def edge_y(front, u):
        return (yF + (tF - yF) * u) if front else (yB + (tB - yB) * u)

    def pillar(s, d0, d1, front):
        """前（または後ろ）の端から d0〜d1 m 内側の柱"""
        g = -1 if front else 1
        q = [side_pt(s, edge_y(front, 0) + g * d0, 0), side_pt(s, edge_y(front, 0) + g * d1, 0),
             side_pt(s, edge_y(front, 1) + g * d1, 1), side_pt(s, edge_y(front, 1) + g * d0, 1)]
        p.face(q, "paint")

    def post(s, y, w):
        p.face([side_pt(s, y - w, 0), side_pt(s, y + w, 0), side_pt(s, y + w, 1), side_pt(s, y - w, 1)], "paint")

    cut = (tF + tB) / 2 + (0.15 if kind == "minivan" else 0.05)  # 前のドアの後ろの端
    for s in (-1, 1):
        pillar(s, 0, 0.1, True)
        pillar(s, 0, 0.26 if kind == "sedan" else 0.16, False)
        post(s, cut, 0.06)
        if kind == "minivan":
            post(s, (cut + tB) / 2 - 0.1, 0.07)
        # 窓の下の黒い帯（ガラスのふち）
        p.face([side_pt(s, yF - 0.02, 0) + Vector((s * 0.002, 0, 0)), side_pt(s, yB + 0.02, 0) + Vector((s * 0.002, 0, 0)),
                side_pt(s, yB + 0.02, 0.06) + Vector((s * 0.002, 0, 0)), side_pt(s, yF - 0.02, 0.06) + Vector((s * 0.002, 0, 0))], "dark")
        # ドアミラー
        p.box(s * bw, s * (bw + 0.16), yF - 0.12, yF - 0.02, c0 + 0.05, c0 + 0.17, "paint")
        # ドアのすきまと取っ手（車体の横）
        x = s * (hw + 0.003)
        for yy in ([yF - 0.05, cut] + ([(cut + yB) / 2] if kind != "kei" else [])):
            p.face([(x, yy - 0.012, y0 + 0.16), (x, yy + 0.012, y0 + 0.16), (x, yy + 0.012, y1 - 0.06), (x, yy - 0.012, y1 - 0.06)], "dark")
        for yy in (cut + 0.12, yB + 0.25):
            p.box(x - 0.012 if s > 0 else x - 0.006, x + 0.006 if s > 0 else x + 0.012, yy - 0.18, yy - 0.06, y1 - 0.2, y1 - 0.16, "wheel")
        # 下の黒い帯（サイドシル）
        p.face([(x, -hl + 0.5, y0 + 0.02), (x, hl - 0.5, y0 + 0.02), (x, hl - 0.5, y0 + 0.13), (x, -hl + 0.5, y0 + 0.13)], "dark")

    # ---- タイヤとタイヤハウス ----
    wr, wz = 0.32, hl - 0.75
    for s in (-1, 1):
        for yy in (wz, -wz):
            arch = [(s * (hw + 0.002), yy + math.cos(a) * 0.41, wr + math.sin(a) * 0.41) for a in [math.pi * k / 10 for k in range(11)]]
            p.face(arch[::-1] if s > 0 else arch, "dark")
            p.wheel(s * (hw - 0.1), yy, wr, 0.22)

    # ---- 前：バンパー・グリル・前照灯・ナンバー ----
    ly = y1 - 0.28  # ライトの高さ（ゲームのライトと同じ）
    p.box(-hw + 0.04, hw - 0.04, hl - 0.12, hl + 0.06, y0, y0 + 0.24, "dark")
    p.box(-0.38, 0.38, hl - 0.1, hl + 0.01, ly - 0.08, ly + 0.12, "dark")
    for s in (-1, 1):
        x = s * (hw - 0.4)
        p.box(x - 0.2, x + 0.18, hl - 0.12, hl + 0.015, ly, ly + 0.14, "head")
        p.box(s * (hw - 0.2) - 0.08, s * (hw - 0.2) + 0.08, hl, hl + 0.075, y0 + 0.1, y0 + 0.17, "sign")  # バンパーの角の橙の方向指示器
    plate = "platek" if kind == "kei" else "plate"
    p.box(-0.17, 0.17, hl + 0.06, hl + 0.075, y0 + 0.04, y0 + 0.2, plate)
    # ---- 後ろ：バンパー・尾灯・ナンバー ----
    p.box(-hw + 0.04, hw - 0.04, -hl - 0.06, -hl + 0.12, y0, y0 + 0.24, "dark")
    for s in (-1, 1):
        x = s * (hw - 0.3)
        p.box(x - 0.17, x + 0.17, -hl - 0.015, -hl + 0.1, ly + 0.04, ly + 0.04 + 0.12, "tail")
        if kind == "minivan":  # 縦長の尾灯
            p.box(s * (hw - 0.08) - 0.06, s * (hw - 0.08) + 0.06, -hl - 0.015, -hl + 0.1, ly + 0.16, ly + 0.55, "tail")
    p.box(-0.17, 0.17, -hl - 0.075, -hl - 0.06, y0 + 0.3, y0 + 0.46, plate)
    # ---- タクシーの屋根の行灯 ----
    if t.get("sign"):
        ym = (tF + tB) / 2
        p.box(-0.06, 0.06, ym - 0.06, ym + 0.06, c1, c1 + 0.04, "dark")
        s0 = [Vector((0.27, ym + 0.13, c1 + 0.04)), Vector((-0.27, ym + 0.13, c1 + 0.04)), Vector((-0.27, ym - 0.13, c1 + 0.04)), Vector((0.27, ym - 0.13, c1 + 0.04))]
        s1 = [Vector((0.22, ym + 0.05, c1 + 0.24)), Vector((-0.22, ym + 0.05, c1 + 0.24)), Vector((-0.22, ym - 0.05, c1 + 0.24)), Vector((0.22, ym - 0.05, c1 + 0.24))]
        p.face(s1, "sign")
        p.face(s0[::-1], "sign")
        for k in range(4):
            p.face([s0[k], s0[(k + 1) % 4], s1[(k + 1) % 4], s1[k]], "sign")
    return p.finish(NAMES[kind])


cars = [build(k) for k in TYPES]

# ---- 下見用（4 台を並べ、色を付けた材質の写しで描く） ----
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=12)
gm = bpy.data.meshes.new("CV_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("CV_PreviewGroundMat", (0.35, 0.36, 0.38)))
preview_col.objects.link(bpy.data.objects.new("CV_PreviewGround", gm))
for i, (kind, ob) in enumerate(zip(TYPES, cars)):
    pv = ob.copy()
    pv.data = ob.data.copy()
    pv.data.materials[MI["paint"]] = material(f"CV_PreviewPaint_{kind}", PREVIEW_PAINT[kind], rough=0.3, metal=0.3)
    pv.location = ((i - 1.5) * 2.6, (i % 2) * 1.2, 0)
    preview_col.objects.link(pv)
    ob.hide_render = True
sun = bpy.data.objects.new("CV_Sun", bpy.data.lights.new("CV_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), 0, math.radians(-130))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("CV_Camera", bpy.data.cameras.new("CV_Camera"))
cam.data.lens = 35
preview_col.objects.link(cam)
cam.location = (7.5, 8.5, 4.2)
cam.rotation_euler = (Vector((0, 0.5, 0.6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("CV_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = os.path.join(os.path.dirname(out), "cars_preview.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in cars}
print(f"BUILT {out} tris={sum(tris.values())} {tris}")
