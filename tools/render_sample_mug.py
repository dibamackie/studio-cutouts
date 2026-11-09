# Render the sample walkaround video (public/samples/mug-walkaround.mp4): a mug on a busy set, filmed
# like a handheld phone: one orbit with wobble, distance drift and auto-exposure drift, to exercise
# the spin pipeline's stabilization and colour matching.
# Usage: blender -b -P tools/render_sample_mug.py -- OUT_DIR   (tested with Blender 5.2)
import sys

import bpy

out_dir = sys.argv[sys.argv.index("--") + 1]
FRAMES = 150  # 5 s at 30 fps
scene = bpy.context.scene

# Clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def checker_material(name, c1, c2, scale):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexChecker")
    tex.inputs["Color1"].default_value = (*c1, 1)
    tex.inputs["Color2"].default_value = (*c2, 1)
    tex.inputs["Scale"].default_value = scale
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


# Mug: body (cylinder hollowed with a solidify), handle (torus half)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.45, depth=1.0, location=(0, 0, 0.5))
body = bpy.context.object
bpy.ops.object.modifier_add(type="SOLIDIFY")
body.modifiers["Solidify"].thickness = 0.05
bpy.ops.object.shade_smooth()
body.data.materials.append(material("glaze", (0.75, 0.12, 0.10), rough=0.25))

bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.06, location=(0.48, 0, 0.5), rotation=(math.pi / 2, 0, 0))
handle = bpy.context.object
bpy.ops.object.shade_smooth()
handle.data.materials.append(material("glaze2", (0.75, 0.12, 0.10), rough=0.25))

# White band so rotation is easy to see
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.456, depth=0.12, location=(0, 0, 0.72))
band = bpy.context.object
bpy.ops.object.shade_smooth()
band.data.materials.append(material("band", (0.95, 0.93, 0.88), rough=0.4))

# Table and busy wall
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
bpy.context.object.data.materials.append(checker_material("floor", (0.55, 0.42, 0.30), (0.42, 0.30, 0.20), 18))
for i, (x, y, rot) in enumerate([(0, 5, 0), (5, 0, math.pi / 2), (0, -5, math.pi), (-5, 0, -math.pi / 2)]):
    bpy.ops.mesh.primitive_plane_add(size=10, location=(x, y, 4), rotation=(math.pi / 2, 0, rot))
    bpy.context.object.data.materials.append(
        checker_material(f"wall{i}", (0.2 + 0.15 * i, 0.5, 0.65 - 0.1 * i), (0.85, 0.82, 0.7), 6)
    )

# Lights
bpy.ops.object.light_add(type="AREA", location=(2, -2, 4))
key = bpy.context.object
key.data.energy = 900
key.data.size = 3
key.rotation_euler = (math.radians(45), 0, math.radians(45))
bpy.ops.object.light_add(type="SUN", location=(0, 0, 6))
bpy.context.object.data.energy = 2.0

# World ambient
scene.world = bpy.data.worlds.new("world")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

# Camera: one orbit with handheld wobble and distance drift
bpy.ops.object.empty_add(location=(0, 0, 0.5))
target = bpy.context.object
bpy.ops.object.camera_add()
cam = bpy.context.object
scene.camera = cam
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
cam.data.lens = 35

scene.frame_start, scene.frame_end = 1, FRAMES
for f in range(1, FRAMES + 1):
    t = (f - 1) / FRAMES
    a = 2 * math.pi * t
    r = 3.2 * (1 + 0.08 * math.sin(3 * a))  # walking closer and farther
    z = 1.6 + 0.12 * math.sin(5 * a + 1)  # hand height wobble
    jitter = 0.03 * math.sin(17 * a)
    cam.location = (r * math.cos(a) + jitter, r * math.sin(a), z)
    cam.keyframe_insert("location", frame=f)
    target.location = (0.04 * math.sin(7 * a), 0.04 * math.cos(9 * a), 0.5)  # aim drift
    target.keyframe_insert("location", frame=f)

# Auto-exposure drift, like a phone camera
scene.view_settings.exposure = 0
for f, ev in ((1, 0.0), (50, 0.35), (100, -0.25), (FRAMES, 0.0)):
    scene.view_settings.exposure = ev
    scene.view_settings.keyframe_insert("exposure", frame=f)

for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.render.fps = 30
if hasattr(scene.render.image_settings, "media_type"):  # Blender 5.x: video output is its own media type
    scene.render.image_settings.media_type = "VIDEO"
scene.render.image_settings.file_format = "FFMPEG"
scene.render.ffmpeg.format = "MPEG4"
scene.render.ffmpeg.codec = "H264"
scene.render.ffmpeg.constant_rate_factor = "HIGH"
scene.render.filepath = out_dir + "/mug-walkaround.mp4"
bpy.ops.render.render(animation=True)
print("RENDERED", scene.render.filepath)
