# 東京駅丸の内駅舎の Blender モデルを、3D 版で読み込む glb に書き出す
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background <tokyo_station.blend> --python tools/export-tokyo-station.py
#
# .blend は保存しない（読み込んで書き出すだけ）。
# ・駅舎の部品（下の NAMES）だけを 1 つにまとめる。広場・周りのビル・線路・電車・地面・照明は入れない
#   （ゲームは地図データから自分で作るので、入れると重なる）
# ・レンガの壁と屋根のスレートの模様は、端がつながるタイル画像に焼き込み、面の向きで貼る（箱貼り）
# 出力: data/models/tokyo_station.glb
import bpy, bmesh, numpy as np, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "models")
NAMES = ["TokyoStation", "TS_RoofOutline", "TS_DomeDetail", "TS_DomeDetail2", "TS_CenterDetail", "TS_CenterDetail2",
         "TS_WingDetail", "TS_WingDetail2", "TS_EntranceDetail", "TS_FacadeStripes"]
BRICK_TILE = 2.0  # レンガの画像 1 枚で 2m 四方
SLATE_TILE = 1.8  # スレートの画像 1 枚で 1.8m 四方（元のマテリアルの 0.9m × 0.45m の並びが 2 × 4 個）


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def brick_image(name, px, tile, bw, rh, mortar, c1, c2, cm, var, seed):
    """レンガ積みの模様（1 段ごとに半分ずらす）。色は c1〜c2 のあいだでレンガごとにばらつかせる"""
    rng = np.random.default_rng(seed)
    cols, rows = int(round(tile / bw)), int(round(tile / rh))
    rand = rng.random((rows, cols))
    noise = rng.normal(0, 1, (px, px)) * 0.025
    ys, xs = np.mgrid[0:px, 0:px]
    y, x = (ys + 0.5) / px * tile, (xs + 0.5) / px * tile
    r = np.floor(y / rh).astype(int) % rows
    xx = (x + (r % 2) * 0.5 * bw) % tile
    c = np.floor(xx / bw).astype(int) % cols
    joint = (xx % bw < mortar) | (y % rh < mortar)
    t = rand[r, c][..., None]
    col = np.array(c1) * (1 - t) + np.array(c2) * t
    col = col * (1 + (t - 0.5) * var) + noise[..., None]
    col = np.where(joint[..., None], np.array(cm) + noise[..., None] * 0.5, col)
    img = bpy.data.images.new(name, px, px, alpha=False)
    rgba = np.ones((px, px, 4), np.float32)
    rgba[..., :3] = lin2srgb(col)[::-1]  # Blender の画像は下の行から
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = 'PNG'
    img.save()
    return img


def use_image(material, img):
    nt = bpy.data.materials[material].node_tree
    bsdf = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    for link in list(bsdf.inputs['Base Color'].links):
        nt.links.remove(link)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])


os.makedirs(OUT, exist_ok=True)
# 色は元のマテリアル（TS_Brick の単色、TS_Slate のレンガテクスチャ）に合わせる
use_image("TS_Brick", brick_image("ts_brick", 512, BRICK_TILE, 0.5, 2 / 12, 0.022,
                                  (0.46, 0.12, 0.065), (0.36, 0.085, 0.045), (0.62, 0.6, 0.55), 0.35, 1))
use_image("TS_Slate", brick_image("ts_slate", 256, SLATE_TILE, 0.9, 0.45, 0.04,
                                  (0.11, 0.12, 0.14), (0.07, 0.075, 0.09), (0.025, 0.025, 0.03), 0.2, 2))

for o in list(bpy.data.objects):
    if o.name not in NAMES:
        bpy.data.objects.remove(o)
objs = [bpy.data.objects[n] for n in NAMES]
with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs):
    bpy.ops.object.join()
ob = objs[0]
me = ob.data
idx = lambda name: {i for i, m in enumerate(me.materials) if m and m.name == name}
plaza, slate = idx("TS_Plaza"), idx("TS_Slate")

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in plaza], context='FACES')  # 駅前広場の床
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
uv = bm.loops.layers.uv.new("UVMap")
for f in bm.faces:
    ax = max(range(3), key=lambda k: abs(f.normal[k]))
    for l in f.loops:
        p = l.vert.co
        if f.material_index in slate:  # 元と同じく (X + 0.5, Z) で貼る。妻側（X 向きの面）は (Y, Z)
            u, v, t = (p.y, p.z, SLATE_TILE) if ax == 0 else (p.x + 0.5, p.z, SLATE_TILE)
        else:
            u, v = (p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y)
            t = BRICK_TILE
        l[uv].uv = (u / t, v / t)
bm.to_mesh(me)
bm.free()
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
    bpy.ops.object.material_slot_remove_unused()

path = os.path.join(OUT, "tokyo_station.glb")
# 法線は入れない（面ごとの法線があると角で頂点が分かれて 3 倍ほど重くなる）。
# 法線のない glb は、three.js の GLTFLoader が平らな陰影（flatShading）で描く
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=False,
                          export_lights=False, export_cameras=False, export_image_format='JPEG', export_image_quality=85)
for f in ("ts_brick.png", "ts_slate.png"):  # 画像は glb の中に入るので、別のファイルは残さない
    os.remove(os.path.join(OUT, f))
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f"EXPORTED {path} tris={tris} verts={len(me.vertices)} materials={[m.name for m in me.materials]} bytes={os.path.getsize(path)}")
