# .blend の 1 つのコレクションの中身を、3D 版で読み込む glb に書き出す（Blender で実行）
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background <.blend> --python tools/export-glb.py -- <コレクション名> <出力先.glb>
#   例：... takanawa_gateway.blend --python tools/export-glb.py -- TG_Export data/models/takanawa_gateway.glb
#
# .blend は保存しない。法線は入れない（three.js が平らな陰影で描く。入れると角で頂点が分かれて重くなる）
import bpy, os, sys

collection, path = sys.argv[sys.argv.index("--") + 1:][:2]
path = os.path.abspath(path)
keep = set(bpy.data.collections[collection].all_objects)
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o)
os.makedirs(os.path.dirname(path), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=False,
                          export_lights=False, export_cameras=False, export_image_format='JPEG', export_image_quality=85)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in keep if o.type == 'MESH')
print(f"EXPORTED {path} objects={len(keep)} tris={tris} bytes={os.path.getsize(path)}")
