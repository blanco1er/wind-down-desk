# Tripo lamp foot (walnut ring with a brass inlay) → engine-ready GLB + textures (28 Oct 2026).
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/objets-28oct/lamp-foot.py -- <wdd-lamp-foot.glb> <out dir>
# Tripo added a glass dome on top: everything above the wooden ring's rim is cut away. The ring is scaled so the globe
# rests exactly where it rested on the former foot (its opening's radius = 0.72 × the globe's, its rim at
# LAMP.footHeight − 0.6 mm): nothing moves in Breathe or Places. Textures: albedo 512² (sRGB), and normal xy +
# roughness + metal 512² (RGBA, linear). Ambient occlusion per vertex (`_ao`). Writes lamp-foot.json (sizes).
import bpy, bmesh, json, math, os, sys
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
TX = 512
GLOBE = 0.025
SEAT_R = 0.72 * GLOBE      # where the globe touches the opening (geometry.ts LAMP)
SEAT_Y = 0.016 - 0.0006    # the opening's rim height (LAMP.footHeight − 0.6 mm)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.context.view_layer.objects.active = meshes[0]
for o in meshes:
    o.select_set(True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o != obj:
        bpy.data.objects.remove(o)
obj.name = 'foot'
me = obj.data

co = np.array([v.co[:] for v in me.vertices])
zmin = co[:, 2].min()
low = co[co[:, 2] < zmin + 0.05 * np.ptp(co[:, 2])]
cx, cy = (low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 1].min() + low[:, 1].max()) / 2
co[:, 0] -= cx; co[:, 1] -= cy; co[:, 2] -= zmin
r = np.hypot(co[:, 0], co[:, 1])
R = r.max()
# The wooden ring's rim: the top of its outer wall.
top = co[r > 0.96 * R, 2].max()
# Cut the glass dome: faces whose centre is above the rim.
bm = bmesh.new(); bm.from_mesh(me)
bm.verts.ensure_lookup_table()
# The brass inlay stands a little above the wood's outer rim (≈ +5 % of the radius): keep it, cut the dome above.
cut = top + 0.06 * R
kill = [f for f in bm.faces if (sum(v.co.z for v in f.verts) / len(f.verts)) - zmin > cut]
bmesh.ops.delete(bm, geom=kill, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me); bm.free()
co = np.array([v.co[:] for v in me.vertices])
co[:, 0] -= cx; co[:, 1] -= cy; co[:, 2] -= zmin
r = np.hypot(co[:, 0], co[:, 1])
# The rim the globe rests on: the top of what is left inside the outer wall (the brass inlay), and the opening below it.
rim = co[r < 0.8 * R, 2].max()
near = co[(co[:, 2] > rim - 0.06 * R) & (r < 0.7 * R)]
r_open = float(np.median(np.hypot(near[:, 0], near[:, 1]))) if len(near) else 0.6 * R
sxy = SEAT_R / r_open
sz = SEAT_Y / rim
co[:, 0] *= sxy; co[:, 1] *= sxy; co[:, 2] *= sz
me.vertices.foreach_set('co', co.ravel().astype(np.float32))
me.update()
outer = float(np.hypot(co[:, 0], co[:, 1]).max())
print('foot: R', R, 'top', top, 'rim', rim, 'open', r_open, '→ outer radius', outer, 'height', co[:, 2].max(), 'xy', sxy, 'z', sz)


def find_image(key):
    for mat in me.materials:
        if mat and mat.node_tree:
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image is not None and key in n.image.name.lower():
                    return n.image
    return None


def pixels(img):
    img = img.copy(); img.scale(TX, TX)
    a = np.empty(TX * TX * 4, dtype=np.float32); img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(TX, TX, 4)


alb = pixels(find_image('basecolor'))
nrm = pixels(find_image('normal'))
rm = pixels(find_image('_rm'))
packed = np.zeros((TX, TX, 4), dtype=np.float32)
packed[..., 0] = nrm[..., 0]; packed[..., 1] = nrm[..., 1]; packed[..., 2] = rm[..., 1]; packed[..., 3] = rm[..., 2]


def dilate(arr, empty, passes=10):
    arr = arr.copy(); filled = ~empty
    for _ in range(passes):
        acc = np.zeros_like(arr); cnt = np.zeros(arr.shape[:2], dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(arr, (dy, dx), axis=(0, 1)) * m[..., None]; cnt += m
        grow = (~filled) & (cnt > 0)
        arr[grow] = acc[grow] / cnt[grow][:, None]; filled = filled | grow
    return arr


empty = alb[..., :3].sum(axis=2) < 0.004
alb = dilate(alb, empty); packed = dilate(packed, empty)


def save(arr, path, srgb, alpha):
    img = bpy.data.images.new(os.path.basename(path), TX, TX, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    if not alpha:
        arr = arr.copy(); arr[..., 3] = 1.0
    img.pixels.foreach_set(arr.ravel()); img.filepath_raw = path; img.file_format = 'PNG'; img.save()


save(alb, os.path.join(OUT, 'lamp-foot-albedo.png'), True, False)
save(packed, os.path.join(OUT, 'lamp-foot-nrm-rough-metal.png'), False, True)

# Ambient occlusion per vertex (1.5 cm), with the table under it.
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, -0.0002)); ground = bpy.context.active_object
scene.world = bpy.data.worlds.new('W'); scene.world.light_settings.distance = 0.012
attr = me.color_attributes.new('AOBake', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = attr
for o in bpy.data.objects:
    o.select_set(False)
obj.select_set(True); bpy.context.view_layer.objects.active = obj
me.materials.clear()
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
ao = np.empty(len(me.vertices) * 4, dtype=np.float32); attr.data.foreach_get('color', ao); ao = ao.reshape(-1, 4)[:, 0]
ao = 0.3 + 0.7 * ao
me.color_attributes.remove(attr)
at = me.attributes.new('_ao', 'FLOAT', 'POINT'); at.data.foreach_set('value', ao)
bpy.data.objects.remove(ground)
for o in bpy.data.objects:
    o.select_set(o == obj)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'lamp-foot.glb'), use_selection=True, export_yup=True, export_texcoords=True,
                          export_normals=True, export_tangents=True, export_attributes=True, export_materials='NONE', export_apply=True)
tris = sum(len(p.vertices) - 2 for p in me.polygons)
info = {'triangles': tris, 'outer_radius': outer, 'height': float(co[:, 2].max()), 'opening': SEAT_R, 'scale_xy': sxy, 'scale_z': sz}
json.dump(info, open(os.path.join(OUT, 'lamp-foot.json'), 'w'), indent=1)
print('FOOT OK', json.dumps(info))
