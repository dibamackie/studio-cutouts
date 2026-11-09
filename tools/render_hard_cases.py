# Render the failure-gallery test images: five scenes, each built around one known weakness of
# salient-object cutout (glass, chrome, thin parts, white-on-white, clutter). Rendered with Cycles.
# Usage: blender -b -P tools/render_hard_cases.py -- OUT_DIR   (tested with Blender 5.2)
import math
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    try:  # GPU when available; CPU otherwise
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = True
                    scene.cycles.device = "GPU"
                    break
            except TypeError:
                continue
    except KeyError:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 1024, 768
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.5
    return scene


def mat(name, color, rough=0.5, metal=0.0, transmission=0.0, ior=1.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["IOR"].default_value = ior
    return m


def checker(name, c1, c2, scale):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    t = nt.nodes.new("ShaderNodeTexChecker")
    t.inputs["Color1"].default_value = (*c1, 1)
    t.inputs["Color2"].default_value = (*c2, 1)
    t.inputs["Scale"].default_value = scale
    nt.links.new(t.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def add(obj_op, material, smooth=True, **kw):
    obj_op(**kw)
    o = bpy.context.object
    if smooth and o.type == "MESH":
        bpy.ops.object.shade_smooth()
    o.data.materials.append(material)
    return o


def room(floor, wall):
    add(bpy.ops.mesh.primitive_plane_add, floor, smooth=False, size=20)
    add(bpy.ops.mesh.primitive_plane_add, wall, smooth=False, size=20, location=(0, 4, 5), rotation=(math.pi / 2, 0, 0))


def lights(key=800):
    bpy.ops.object.light_add(type="AREA", location=(2.5, -2.5, 4))
    k = bpy.context.object
    k.data.energy, k.data.size = key, 3
    k.rotation_euler = (math.radians(50), 0, math.radians(45))
    bpy.ops.object.light_add(type="AREA", location=(-3, -1, 3))
    f = bpy.context.object
    f.data.energy, f.data.size = key * 0.35, 4
    f.rotation_euler = (math.radians(60), 0, math.radians(-60))


def camera(target=(0, 0, 0.5), loc=(0, -4.2, 1.9), lens=45):
    bpy.ops.object.empty_add(location=target)
    t = bpy.context.object
    bpy.ops.object.camera_add(location=loc)
    c = bpy.context.object
    c.data.lens = lens
    tr = c.constraints.new("TRACK_TO")
    tr.target, tr.track_axis, tr.up_axis = t, "TRACK_NEGATIVE_Z", "UP_Y"
    bpy.context.scene.camera = c


def render(name):
    bpy.context.scene.render.filepath = f"{OUT}/{name}.png"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)


busy_floor = lambda: checker("floor", (0.55, 0.42, 0.3), (0.42, 0.3, 0.2), 14)
busy_wall = lambda: checker("wall", (0.25, 0.55, 0.7), (0.9, 0.85, 0.7), 5)

# 1. Glass: you see the background through the object.
reset()
room(busy_floor(), busy_wall())
add(bpy.ops.mesh.primitive_cylinder_add, mat("glass", (1, 1, 1), rough=0.0, transmission=1.0), vertices=96, radius=0.42, depth=1.2, location=(0, 0, 0.6))
bpy.ops.object.modifier_add(type="SOLIDIFY")
bpy.context.object.modifiers["Solidify"].thickness = 0.04
lights()
camera(target=(0, 0, 0.55))
render("glass-vase")

# 2. Chrome: the object is a mirror of its surroundings.
reset()
room(busy_floor(), busy_wall())
chrome = mat("chrome", (0.9, 0.9, 0.92), rough=0.05, metal=1.0)
add(bpy.ops.mesh.primitive_cylinder_add, chrome, vertices=96, radius=0.45, depth=0.8, location=(0, 0, 0.4))
add(bpy.ops.mesh.primitive_uv_sphere_add, chrome, segments=64, ring_count=32, radius=0.45, location=(0, 0, 0.8), scale=(1, 1, 0.45))
add(bpy.ops.mesh.primitive_torus_add, chrome, major_radius=0.32, minor_radius=0.04, location=(0, 0, 1.05), rotation=(math.pi / 2, 0, 0))
add(bpy.ops.mesh.primitive_cone_add, chrome, radius1=0.09, radius2=0.04, depth=0.6, location=(0.6, 0, 0.55), rotation=(0, math.radians(55), 0))
lights()
camera(target=(0, 0, 0.6))
render("chrome-kettle")

# 3. Thin parts: a wire chair, mostly background between the wires.
reset()
room(busy_floor(), busy_wall())
wire = mat("wire", (0.08, 0.08, 0.08), rough=0.4, metal=0.8)
r = 0.012
for x in (-0.35, 0.35):
    for y in (-0.35, 0.35):
        add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=12, radius=r, depth=0.9, location=(x, y, 0.45))
for x in (-0.35, 0.35):
    add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=12, radius=r, depth=0.8, location=(x, 0.35, 1.3))
for i in range(9):  # seat grid
    t = -0.35 + i * 0.0875
    add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=8, radius=r * 0.7, depth=0.7, location=(t, 0, 0.9), rotation=(math.pi / 2, 0, 0))
    add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=8, radius=r * 0.7, depth=0.7, location=(0, t, 0.9), rotation=(0, math.pi / 2, 0))
for i in range(7):  # backrest grid
    t = -0.3 + i * 0.1
    add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=8, radius=r * 0.7, depth=0.75, location=(t, 0.35, 1.3))
    add(bpy.ops.mesh.primitive_cylinder_add, wire, vertices=8, radius=r * 0.7, depth=0.7, location=(0, 0.35, 0.95 + i * 0.11), rotation=(0, math.pi / 2, 0))
lights()
camera(target=(0, 0, 0.8), loc=(1.6, -3.6, 1.9), lens=40)
render("wire-chair")

# 4. White on white: low contrast between object and set.
reset()
white = mat("white", (0.9, 0.9, 0.88), rough=0.6)
room(white, mat("wall", (0.92, 0.92, 0.9), rough=0.8))
bowl = add(bpy.ops.mesh.primitive_uv_sphere_add, mat("ceramic", (0.95, 0.95, 0.93), rough=0.25), segments=96, ring_count=48, radius=0.55, location=(0, 0, 0.45))
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for v in bowl.data.vertices:  # cut the top off to make a bowl
    v.select = v.co.z > 0.1
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.delete(type="VERT")
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.modifier_add(type="SOLIDIFY")
bowl.modifiers["Solidify"].thickness = 0.03
lights(key=600)
camera(target=(0, 0, 0.3), loc=(0, -3.6, 1.6))
render("white-bowl")

# 5. Clutter: which of these is "the product"?
reset()
room(busy_floor(), busy_wall())
add(bpy.ops.mesh.primitive_cylinder_add, mat("mug", (0.75, 0.12, 0.1), rough=0.25), vertices=64, radius=0.3, depth=0.65, location=(0, 0, 0.33))
add(bpy.ops.mesh.primitive_cube_add, mat("book1", (0.1, 0.25, 0.6)), smooth=False, size=1, location=(-0.85, 0.3, 0.1), scale=(0.7, 0.5, 0.2))
add(bpy.ops.mesh.primitive_cube_add, mat("book2", (0.75, 0.6, 0.1)), smooth=False, size=1, location=(-0.85, 0.3, 0.3), scale=(0.6, 0.45, 0.18), rotation=(0, 0, 0.3))
add(bpy.ops.mesh.primitive_cylinder_add, mat("bottle", (0.15, 0.5, 0.25), rough=0.1, transmission=0.6), vertices=48, radius=0.14, depth=1.0, location=(0.75, 0.4, 0.5))
add(bpy.ops.mesh.primitive_uv_sphere_add, mat("fruit", (0.85, 0.45, 0.05)), radius=0.17, location=(0.45, -0.35, 0.17))
add(bpy.ops.mesh.primitive_uv_sphere_add, mat("fruit2", (0.6, 0.75, 0.1)), radius=0.15, location=(0.75, -0.2, 0.15))
add(bpy.ops.mesh.primitive_cone_add, mat("lamp", (0.9, 0.9, 0.85), rough=0.6), radius1=0.35, radius2=0.12, depth=0.4, location=(-0.4, 0.9, 1.2))
add(bpy.ops.mesh.primitive_cylinder_add, mat("stand", (0.1, 0.1, 0.1)), vertices=16, radius=0.025, depth=1.0, location=(-0.4, 0.9, 0.5))
lights()
camera(target=(0, 0.2, 0.4), loc=(0.3, -3.8, 2.0), lens=38)
render("cluttered-desk")
