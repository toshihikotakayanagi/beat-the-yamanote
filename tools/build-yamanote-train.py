# ライバルの山手線の電車（E235 系）の車両 4 種類を、ゲーム向けに軽く Blender で組み立てる
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/build-yamanote-train.py -- <保存先の .blend>
#
# 車両は「TR_Lead」（先頭車）、「TR_Middle」（中間車）、「TR_Panto」（パンタグラフ付きの中間車）、「TR_Tail」（最後尾車）。
# ゲーム（src/render3d.js）のプログラムで組み立てる電車と同じ寸法・向きにする：
#   長さ 19.2m、幅 2.96m、高さはレールの上から（屋根 3.87m）。原点は車両の真ん中のレールの上。
#   Blender の +Y が進む向き（glb では -z、ゲームの電車の前）、X は左右、Z は高さ。
# 車体の側面は 1 枚の絵（ステンレスの車体、黄緑のドア 4 つ、窓。夜に灯る窓は光の絵）を、丸みのある断面に貼る。
# 先頭・最後尾は黒い顔と大きな窓、黄緑の帯、前照灯（白）・尾灯（赤）・行き先表示（橙）。光る部品の材質の名前は
# 「Light」で始め、ゲームでは光の当たり方によらない色で描く。
# 書き出すものはコレクション「TR_Export」、下見用の地面・カメラ・光は「TR_Preview」。
import bpy, bmesh, math, os, sys, mathutils
import numpy as np

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("yamanote_train.blend")

# ---- 寸法（m） ----
L = 19.2
HL = L / 2
PROFILE = [(1.38, 1.0), (1.47, 1.3), (1.48, 2.0), (1.47, 3.25), (1.4, 3.52), (1.16, 3.74), (0.62, 3.84), (0.0, 3.87)]  # 断面（片側）
H = 3.9  # 側面の絵の高さ
DOORS_Y = (-6.9, -2.3, 2.3, 6.9)
DOOR_W = 1.5
CAB = 1.15  # 運転台の長さ（先頭・最後尾の端から）

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TEX_DIR = os.path.join(os.path.dirname(os.path.abspath(out)), "yamanote_train_textures")
os.makedirs(TEX_DIR, exist_ok=True)
rng = np.random.default_rng(201)

STAIN = np.array([0.78, 0.8, 0.83])
SKIRT = np.array([0.42, 0.44, 0.47])
ROOFC = np.array([0.6, 0.62, 0.65])
GREEN = np.array([0.42, 0.74, 0.22])
GLASS = np.array([0.11, 0.13, 0.16])
SEAM = np.array([0.66, 0.68, 0.71])
LIGHT = np.array([1.0, 0.95, 0.82])


def save_image(name, arr):
    Hp, W = arr.shape[:2]
    img = bpy.data.images.new(name, W, Hp, alpha=False)
    rgba = np.ones((Hp, W, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(TEX_DIR, name + ".png")
    img.file_format = 'PNG'
    img.save()
    return img


def side_texture(W=1024, Hp=256):
    """車体の側面の絵（横は車両の長さ、縦はレールの上からの高さ 0〜H）と、夜に灯る窓の光の絵"""
    col = np.zeros((Hp, W, 3)) + STAIN
    glow = np.zeros((Hp, W, 3))
    pu, pv = W / L, Hp / H

    def rect(y0, y1, z0, z1, c, g=None):
        a, b = int(round((y0 + HL) * pu)), int(round((y1 + HL) * pu))
        c0, d0 = int(round(z0 * pv)), int(round(z1 * pv))
        col[c0:d0, a:b] = c
        if g is not None:
            glow[c0:d0, a:b] = g

    for y in np.arange(-HL, HL, 0.45):  # ステンレスの細いすじ
        rect(y, y + 0.03, 1.35, 3.4, SEAM)
    rect(-HL, HL, 0, 1.32, SKIRT)
    rect(-HL, HL, 3.45, H, ROOFC)
    # ドアのあいだと端の窓（夜は灯る）
    edges = [-HL + 1.0] + [v for d in DOORS_Y for v in (d - DOOR_W / 2 - 0.3, d + DOOR_W / 2 + 0.3)] + [HL - 1.0]
    for y0, y1 in zip(edges[0::2], edges[1::2]):
        if y1 - y0 > 0.5:
            rect(y0, y1, 2.05, 3.05, GLASS, LIGHT * 0.8)
            for k in range(1, int((y1 - y0) / 1.3) + 1):  # 窓の縦の枠
                yy = y0 + (y1 - y0) * k / (int((y1 - y0) / 1.3) + 1)
                rect(yy - 0.03, yy + 0.03, 2.05, 3.05, SEAM)
    # 黄緑のドアとドアの窓
    for d in DOORS_Y:
        rect(d - DOOR_W / 2, d + DOOR_W / 2, 1.15, 3.2, GREEN)
        rect(d - 0.03, d + 0.03, 1.15, 3.2, GREEN * 0.55)  # 2 枚の戸の合わせ目
        for pane in (-0.36, 0.36):
            rect(d + pane - 0.27, d + pane + 0.27, 2.2, 3.0, GLASS, LIGHT * 0.8)
    rect(-HL, HL, 3.3, 3.36, GREEN)  # 屋根の下の細い黄緑の線
    col *= rng.uniform(0.985, 1.015, (Hp, W, 1))
    return save_image("tr_side", col), save_image("tr_side_glow", glow)


SIDE, SIDE_GLOW = side_texture()


def material(name, color, rough=0.5, metal=0.0, tex=None, glow=None, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = (*color, 1)
    if glow:
        g = nt.nodes.new("ShaderNodeTexImage")
        g.image = glow
        nt.links.new(g.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.0
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


MAT = {
    "side": material("TR_Side", STAIN, rough=0.35, metal=0.3, tex=SIDE, glow=SIDE_GLOW),
    "stain": material("TR_Stainless", STAIN, rough=0.35, metal=0.3),
    "roof": material("TR_Roof", ROOFC, rough=0.6),
    "dark": material("TR_Dark", (0.12, 0.13, 0.15), rough=0.8),  # 台車・床下・ほろ
    "black": material("TR_Face", (0.05, 0.06, 0.07), rough=0.3),  # 運転台の黒い顔
    "window": material("TR_Windshield", (0.08, 0.12, 0.16), rough=0.1, metal=0.2),
    "green": material("TR_Green", GREEN, rough=0.5),
    "head": material("Light_Head", (1.0, 0.97, 0.85), emit=(1.0, 0.97, 0.85)),
    "tail": material("Light_Tail", (1.0, 0.15, 0.12), emit=(1.0, 0.15, 0.12)),
    "dest": material("Light_Dest", (1.0, 0.6, 0.15), emit=(1.0, 0.6, 0.15)),
}
MI = {k: i for i, k in enumerate(MAT)}
export_col = bpy.data.collections.new("TR_Export")
preview_col = bpy.data.collections.new("TR_Preview")
scene.collection.children.link(export_col)
scene.collection.children.link(preview_col)


class Car:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def face(self, pts, mat, uvs=None):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = MI[mat]
        if uvs is None:
            uvs = [(0, 0)] * len(pts)
        for l, uv in zip(f.loops, uvs):
            l[self.uv].uv = uv
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces="all"):
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        quads = {"bottom": (0, 3, 2, 1), "top": (4, 5, 6, 7), "front": (3, 7, 6, 2), "back": (0, 1, 5, 4), "left": (0, 4, 7, 3), "right": (1, 2, 6, 5)}
        for k, q in quads.items():
            if faces == "all" or k in faces:
                self.face([v[i] for i in q], mat)

    def cylinder_x(self, x0, x1, y, z, r, mat, seg=8):
        """X 向きの円柱（車輪・車軸）"""
        ring = [(math.cos(2 * math.pi * k / seg) * r, math.sin(2 * math.pi * k / seg) * r) for k in range(seg)]
        for k in range(seg):
            (a, b), (c, d) = ring[k], ring[(k + 1) % seg]
            self.face([(x0, y + a, z + b), (x0, y + c, z + d), (x1, y + c, z + d), (x1, y + a, z + b)], mat)
        for x, rev in ((x0, True), (x1, False)):
            pts = [(x, y + a, z + b) for a, b in ring]
            self.face(pts[::-1] if rev else pts, mat)

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


def shell(c, y0, y1):
    """丸みのある断面の車体を y0〜y1 に伸ばす（側面の絵を貼る）"""
    u0, u1 = (y0 + HL) / L, (y1 + HL) / L
    for side in (-1, 1):
        for (xa, za), (xb, zb) in zip(PROFILE, PROFILE[1:]):
            pts = [(xa * side, y0, za), (xa * side, y1, za), (xb * side, y1, zb), (xb * side, y0, zb)]
            uvs = [(u0, za / H), (u1, za / H), (u1, zb / H), (u0, zb / H)]
            if side < 0:
                pts, uvs = pts[::-1], uvs[::-1]
            c.face(pts, "side", uvs)
    c.box(-1.38, 1.38, y0, y1, 0.98, 1.0, "dark", faces=("bottom",))


def end_cap(c, y, facing):
    """車体の端の面（断面の形）"""
    ring = [(x, z) for x, z in PROFILE] + [(-x, z) for x, z in PROFILE[::-1][1:]]
    pts = [(x, y, z) for x, z in ring]
    c.face(pts if facing > 0 else pts[::-1], "stain")


def cab(c, front):
    """運転台：黒い顔、大きな窓、黄緑の帯、前照灯（front）または尾灯、行き先表示"""
    s = 1 if front else -1
    yb = HL * s  # 車体の端
    yf = yb + 0.18 * s  # 顔のいちばん前（窓の下）
    yt = yb + 0.02 * s  # 顔の上（少しうしろへ傾ける）
    zf, zt = 1.25, 3.6

    def P(x, y, z):
        return (x, y, z)

    # 顔（左右・下・上に分けた傾いた面）
    face_pts = [P(-1.42, yf, zf), P(1.42, yf, zf), P(1.36, yt, zt), P(-1.36, yt, zt)]
    c.face(face_pts if front else face_pts[::-1], "black")
    for x in (-1.42, 1.42):  # 顔の左右の面
        q = [P(x, yb, zf), P(x, yf, zf), P(x * 0.96, yt, zt), P(x * 0.96, yb, zt)]
        c.face(q if (x > 0) == front else q[::-1], "black")
    top = [P(-1.36, yb, zt), P(1.36, yb, zt), P(1.36, yt, zt), P(-1.36, yt, zt)]
    c.face(top if front else top[::-1], "black")
    # 大きな窓（顔より少し前に浮かせる）
    def on_face(x, z, d=0.012):
        t = (z - zf) / (zt - zf)
        return P(x * (1 - 0.04 * t), yf + (yt - yf) * t + d * s, z)
    win = [on_face(-1.22, 2.2), on_face(1.22, 2.2), on_face(1.22, 3.3), on_face(-1.22, 3.3)]
    c.face(win if front else win[::-1], "window")
    # 黄緑の帯（顔の下の部分）
    band = [on_face(-1.43, 1.3, 0.02), on_face(1.43, 1.3, 0.02), on_face(1.43, 1.62, 0.02), on_face(-1.43, 1.62, 0.02)]
    c.face(band if front else band[::-1], "green")
    # 前照灯・尾灯（左右 2 つずつ）と行き先表示
    for x in (-0.95, 0.95):
        q = [on_face(x - 0.22, 1.72, 0.025), on_face(x + 0.22, 1.72, 0.025), on_face(x + 0.22, 1.92, 0.025), on_face(x - 0.22, 1.92, 0.025)]
        c.face(q if front else q[::-1], "head" if front else "tail")
    if front:
        q = [on_face(-0.62, 3.36, 0.03), on_face(0.62, 3.36, 0.03), on_face(0.62, 3.52, 0.03), on_face(-0.62, 3.52, 0.03)]
        c.face(q, "dest")
    # 運転台の横の窓（黒）と、顔の下の排障器
    for side in (-1, 1):
        x = 1.49 * side
        y0, y1 = sorted((yb - (CAB - 0.1) * s, yb - 0.25 * s))
        q = [(x, y0, 2.05), (x, y1, 2.05), (x, y1, 3.1), (x, y0, 3.1)]
        c.face(q if side > 0 else q[::-1], "black")
    y0, y1 = sorted((yb, yf + 0.05 * s))
    c.box(-1.2, 1.2, y0, y1, 0.45, 1.25, "dark")


def underframe(c):
    """台車と車輪、床下の機器"""
    for by in (-HL + 2.6, HL - 2.6):
        c.box(-1.15, 1.15, by - 1.4, by + 1.4, 0.45, 0.95, "dark")
        for wy in (-0.9, 0.9):
            c.cylinder_x(-0.85, -0.67, by + wy, 0.43, 0.43, "dark")
            c.cylinder_x(0.67, 0.85, by + wy, 0.43, 0.43, "dark")
    c.box(-1.2, 1.2, -HL + 4.3, HL - 4.3, 0.55, 1.0, "dark")


def roof_units(c):
    for ay in (-4.5, 4.5):  # 冷房装置
        c.box(-0.85, 0.85, ay - 1.2, ay + 1.2, 3.85, 4.15, "roof")
        for gx in (-0.5, 0.0, 0.5):
            c.box(gx - 0.18, gx + 0.18, ay - 0.7, ay + 0.7, 4.15, 4.17, "dark", faces=("top",))


def pantograph(c):
    py, top = HL - 3.2, 4.75  # 前（+Y）寄り
    c.box(-0.7, 0.7, py - 0.7, py + 0.7, 3.87, 3.95, "dark")
    for (z0, z1, y0, y1) in ((3.95, 4.38, py + 0.6, py + 0.05), (4.38, top, py + 0.05, py - 0.4)):
        for sx in (-0.45, 0.45):
            dz, dy, steps = z1 - z0, y1 - y0, 4
            for k in range(steps):
                za, ya = z0 + dz * k / steps, y0 + dy * k / steps
                yb2 = ya + dy / steps
                c.box(sx - 0.025, sx + 0.025, min(ya, yb2) - 0.02, max(ya, yb2) + 0.02, za, za + dz / steps + 0.02, "dark")
    c.box(-0.85, 0.85, py - 0.5, py - 0.3, top, top + 0.06, "dark")


def build(name, kind, panto=False):
    c = Car()
    shell(c, -HL, HL)
    if kind == "lead":
        cab(c, True)
        end_cap(c, -HL, -1)
    elif kind == "tail":
        cab(c, False)
        end_cap(c, HL, 1)
        c.box(-0.62, 0.62, HL, HL + 0.42, 1.05, 3.2, "dark")  # 前の端のほろ
    else:
        end_cap(c, -HL, -1)
        end_cap(c, HL, 1)
        c.box(-0.62, 0.62, HL, HL + 0.42, 1.05, 3.2, "dark")  # 前の端のほろ（先頭以外）
    underframe(c)
    roof_units(c)
    if panto:
        pantograph(c)
    return c.finish(name)


cars = [build("TR_Lead", "lead"), build("TR_Middle", "middle"), build("TR_Panto", "middle", panto=True), build("TR_Tail", "tail")]

# ---- 下見用（4 両を並べる） ----
for i, ob in enumerate(cars):
    ob.location = (0, -20.0 * i, 0)
g = bmesh.new()
bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=60)
gm = bpy.data.meshes.new("TR_PreviewGround")
g.to_mesh(gm)
g.free()
gm.materials.append(material("TR_PreviewGroundMat", (0.35, 0.36, 0.38)))
ground = bpy.data.objects.new("TR_PreviewGround", gm)
ground.location = (0, -30, 0)
preview_col.objects.link(ground)
sun = bpy.data.objects.new("TR_Sun", bpy.data.lights.new("TR_Sun", 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-140))
preview_col.objects.link(sun)
cam = bpy.data.objects.new("TR_Camera", bpy.data.cameras.new("TR_Camera"))
cam.data.lens = 35
preview_col.objects.link(cam)
cam.location = (9.0, 16.0, 4.5)
cam.rotation_euler = (mathutils.Vector((0, -6, 2.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
world = bpy.data.worlds.new("TR_World")
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
scene.render.filepath = os.path.join(os.path.dirname(out), "yamanote_train_preview.png")
bpy.ops.render.render(write_still=True)
for ob in cars:  # 書き出す前に、どの車両も原点に戻す
    ob.location = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=out)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in cars)
print(f"BUILT {out} tris={tris} per_car={[sum(len(p.vertices) - 2 for p in o.data.polygons) for o in cars]}")
