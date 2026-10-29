# Tripo keepsakes → one engine-ready GLB + one texture atlas (28 Oct 2026).
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/objets-28oct/keepsakes.py -- <src dir> <out dir>
# <src dir> holds the Tripo Studio exports (Smart Low Poly, GLB, PBR): wdd-keepsake-{pebble,cup,plant}.glb.
# Each object is scaled to its real size (metres), stood on z = 0 around its foot's centre, its UVs packed into one
# atlas tile (albedo 1024², normal xy + roughness 1024²), and its ambient occlusion baked per vertex (Cycles, with a
# ground plane) into the `_ao` attribute. Export: one GLB, three meshes (pebble, cup, plant) at the origin, no
# materials, with UVs, normals, tangents and `_ao`; plus keepsakes.json (sizes, triangles, the cup's steam origin).
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
ATLAS = 1024

# name, file, how to size it, size (m), atlas tile (u0, v0, u1, v1 in Blender UV space: v up)
OBJECTS = [
    ('pebble', 'wdd-keepsake-pebble.glb', 'xy', 0.040, (0.0, 0.5, 0.5, 1.0)),
    ('cup', 'wdd-keepsake-cup.glb', 'xy', 0.105, (0.0, 0.0, 0.5, 0.5)),
    ('plant', 'wdd-keepsake-plant.glb', 'foot', 0.040, (0.5, 0.0, 1.0, 1.0)),
]
# The cup's handle points toward the seat and a little toward the tray (desk +z, +x): Blender −y, +x.
HANDLE_DIR = math.atan2(-0.87, 0.5)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64

albedo = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
albedo[..., 3] = 1.0
nrm = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
nrm[..., :] = (0.5, 0.5, 0.6, 1.0)
info = {}


def pixels(img, w, h):
    img = img.copy()
    img.scale(w, h)
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def find_image(obj, key):
    for mat in obj.data.materials:
        if mat is None or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image is not None and key in n.image.name.lower():
                return n.image
    return None


for name, file, fit, size, tile in OBJECTS:
    if not os.path.exists(os.path.join(SRC, file)):
        print('missing', file)
        continue
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, file))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        o.select_set(False)
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        o.select_set(True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o != obj and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    obj.name = name
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    low = co[co[:, 2] < zmin + 0.12 * (zmax - zmin)]
    # Size: the largest horizontal extent (pebble, cup on its saucer) or the width of the foot (the plant's pot).
    ref = co if fit == 'xy' else low
    extent = max(np.ptp(ref[:, 0]), np.ptp(ref[:, 1]))
    k = size / extent
    centre = np.array([(low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 1].min() + low[:, 1].max()) / 2, zmin])
    co = (co - centre) * k
    if name == 'cup':
        # The handle: the vertices farthest from the axis, in the upper half of the cup (above the saucer).
        h = co[:, 2].max()
        mid = co[(co[:, 2] > 0.35 * h) & (co[:, 2] < 0.85 * h)]
        r = np.hypot(mid[:, 0], mid[:, 1])
        far = mid[r > np.percentile(r, 97)]
        a = math.atan2(far[:, 1].mean(), far[:, 0].mean())
        rot = HANDLE_DIR - a
        c, s = math.cos(rot), math.sin(rot)
        x, y = co[:, 0].copy(), co[:, 1].copy()
        co[:, 0], co[:, 1] = c * x - s * y, s * x + c * y
    me.vertices.foreach_set('co', co.ravel().astype(np.float32))
    me.update()
    if name == 'cup':
        # 28 Oct (review): smooth shading over the low-poly rim (no faceted glaze): drop Tripo's split normals.
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
        if me.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        # Weld the vertices split at UV seams first (UVs live on face corners: they are kept), or each island
        # would be smoothed on its own and show as facets.
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me); bm.free(); me.update()
        bpy.ops.object.shade_smooth()
    # Atlas: this object's UVs into its tile, its textures into the same pixels.
    u0, v0, u1, v1 = tile
    uv = me.uv_layers.active.data
    a = np.empty(len(uv) * 2, dtype=np.float64)
    uv.foreach_get('uv', a)
    a = a.reshape(-1, 2)
    a[:, 0] = u0 + np.clip(a[:, 0], 0, 1) * (u1 - u0)
    a[:, 1] = v0 + np.clip(a[:, 1], 0, 1) * (v1 - v0)
    uv.foreach_set('uv', a.ravel().astype(np.float32))
    px0, py0, px1, py1 = int(u0 * ATLAS), int(v0 * ATLAS), int(u1 * ATLAS), int(v1 * ATLAS)
    w, hgt = px1 - px0, py1 - py0
    base = find_image(obj, 'basecolor')
    nimg = find_image(obj, 'normal')
    rm = find_image(obj, '_rm') or find_image(obj, 'metallic') or find_image(obj, 'rough')
    albedo[py0:py1, px0:px1] = pixels(base, w, hgt)
    n = pixels(nimg, w, hgt) if nimg else None
    rr = pixels(rm, w, hgt) if rm else None
    if n is not None:
        nrm[py0:py1, px0:px1, 0] = n[..., 0]
        nrm[py0:py1, px0:px1, 1] = n[..., 1]
    if rr is not None:
        nrm[py0:py1, px0:px1, 2] = rr[..., 1]  # glTF: roughness in G
    # Ambient occlusion per vertex, with a ground plane under it (the table).
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, -0.0002))
    ground = bpy.context.active_object
    attr = me.color_attributes.new('AOBake', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.world = scene.world or bpy.data.worlds.new('W')
    # Occlusion within 1.5 cm only (objects of a few centimetres; the default 10 m darkens everything).
    scene.world.light_settings.distance = 0.015
    obj.data.materials.clear()
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    ao = np.empty(len(me.vertices) * 4, dtype=np.float32)
    attr.data.foreach_get('color', ao)
    ao = ao.reshape(-1, 4)[:, 0]
    # Smooth it a little over the mesh (low-poly AO is blotchy), keep a floor so nothing goes black.
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    nb = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    bm.free()
    for _ in range(3):
        ao = np.array([0.5 * ao[i] + 0.5 * (ao[nb[i]].mean() if nb[i] else ao[i]) for i in range(len(ao))], dtype=np.float32)
    ao = 0.25 + 0.75 * ao
    me.color_attributes.remove(attr)
    at = me.attributes.new('_ao', 'FLOAT', 'POINT')
    at.data.foreach_set('value', ao)
    bpy.data.objects.remove(ground)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    entry = {'triangles': tris, 'height': float(co[:, 2].max()), 'width': float(np.ptp(co[:, 0])), 'depth': float(np.ptp(co[:, 1])), 'ao_min': float(ao.min())}
    if name == 'cup':
        # Steam rises from the tea: the centre of the cup's rim (its top ring), at the rim's height minus a little.
        top = co[co[:, 2] > co[:, 2].max() - 0.004]
        rim = np.hypot(top[:, 0] - top[:, 0].mean(), top[:, 1] - top[:, 1].mean()).mean()
        # glTF axes (y up, z = −Blender y)
        entry['steam'] = [float(top[:, 0].mean()), float(co[:, 2].max() - 0.006), float(-top[:, 1].mean())]
        entry['rim'] = float(rim)
    info[name] = entry
    print('keepsake', name, entry)


def dilate(arr, empty, passes=12):
    """Grow each UV island's border colour into the empty (black) pixels around it: no dark seams in the mipmaps."""
    arr = arr.copy()
    filled = ~empty
    for _ in range(passes):
        acc = np.zeros_like(arr)
        cnt = np.zeros(arr.shape[:2], dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(arr, (dy, dx), axis=(0, 1)) * m[..., None]
            cnt += m
        grow = (~filled) & (cnt > 0)
        arr[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    return arr


def save(arr, path, srgb):
    img = bpy.data.images.new(os.path.basename(path), ATLAS, ATLAS, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


empty = albedo[..., :3].sum(axis=2) < 0.004
albedo = dilate(albedo, empty)
nrm = dilate(nrm, empty)
save(albedo, os.path.join(OUT, 'keepsakes-albedo.png'), True)
save(nrm, os.path.join(OUT, 'keepsakes-nrm-rough.png'), False)
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH' and o.name in ('pebble', 'cup', 'plant'))
    if o.type == 'MESH':
        o.data.materials.clear()
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'keepsakes.glb'), use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_tangents=True, export_attributes=True, export_materials='NONE', export_apply=True)
json.dump(info, open(os.path.join(OUT, 'keepsakes.json'), 'w'), indent=1)
print('KEEPSAKES OK', json.dumps(info))
