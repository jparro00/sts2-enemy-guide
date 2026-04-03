---
name: render-sprite-vfx
description: Render monster sprites that require shader effects or particles (e.g. Waterfall Giant, Living Fog) by recreating the game's Godot scene with VFX in our Godot project.
---

# Render VFX Monster Sprite

For monsters that can't be rendered with the standard `/render-sprite` skill because they use shader materials, GPU particles, or other Godot-specific VFX. This skill recreates the game's scene setup programmatically in GDScript.

## When to Use

Use this when `/render-sprite` produces broken results due to:
- Placeholder textures (e.g. "Smoke Placeholder" watermark)
- Flat translucent rectangles instead of water/fog effects
- Missing particle effects that define the monster's appearance

## Overview

The approach:
1. Extract the monster's `.tscn` scene file from the game PCK to understand what VFX nodes, shaders, and textures are used
2. Extract all referenced assets (shaders, textures, materials)
3. Write a custom GDScript that loads the Spine skeleton AND recreates the VFX nodes programmatically
4. Render interactively with slider + capture button

## Step 1: Extract and Analyze the Scene File

```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=/d/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=/c/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://scenes/creature_visuals/{monster_name}.tscn"
```

Read the `.tscn` and identify:
- `SpineSlotNode` entries with `normal_material` (shader materials applied to spine slots)
- `GPUParticles2D` nodes (particle effects)
- External resource references (shaders, textures, materials)
- The sprite's `scale` and `position`

## Step 2: Extract Dependencies

Extract all referenced resources from the PCK:
- Shader files (`.tres` VisualShader or gdshader)
- Texture PNGs (smoke textures, gradient textures, particle sprites)
- Material .tres files (for reference — we recreate these in GDScript)

Copy textures to `spine_godot/assets/textures/particles/` or similar.
Copy shaders to `spine_godot/assets/shaders/`.

**Important**: Godot can't load raw PNGs via `load()` without importing them first. Use `Image.load_from_file()` + `ImageTexture.create_from_image()` instead:
```gdscript
func _load_tex(relative_path: String) -> ImageTexture:
    var img = Image.load_from_file(project_dir + "/" + relative_path)
    return ImageTexture.create_from_image(img)
```

Shader `.tres` files CAN be loaded via `load()` since they're Godot resources.

## Step 3: Write the Render Script

Create a GDScript (e.g. `render_{monster}.gd`) that:

1. Loads the Spine skeleton from disk
2. Creates a SpineSprite with the correct scale from the scene file
3. Plays idle animation, paused (`set_time_scale(0)`)
4. Creates ShaderMaterial instances in code, setting all shader_parameters from the scene file
5. Attaches materials to SpineSlotNodes by slot_name
6. Optionally adds GPUParticles2D nodes (skip flipbook particles that don't render correctly — these show as white blobs)
7. Adds interactive UI (CanvasLayer + VBoxContainer with slider and capture button)
8. On capture: clones everything into a 6144x6144 SubViewport, waits for particles to fill, screenshots, converts to webp

### Key Patterns

**Applying shader materials to Spine slots:**
```gdscript
var slot_node = SpineSlotNode.new()
slot_node.slot_name = "body_water_rect"  # from the .tscn
slot_node.normal_material = my_shader_material
slot_node.show_behind_parent = true
sprite.add_child(slot_node)
```

**Creating shader materials from scene data:**
```gdscript
var mat = ShaderMaterial.new()
mat.shader = load("res://assets/shaders/my_shader.tres")
mat.set_shader_parameter("Color", Color(0.33, 0.23, 0.30, 1))
mat.set_shader_parameter("ScrollSpeed", 0.22)
mat.set_shader_parameter("smokeTex", _load_tex("assets/textures/my_texture.png"))
```

**Interactive UI must use CanvasLayer** to render on top:
```gdscript
var canvas_layer = CanvasLayer.new()
add_child(canvas_layer)
var ui = VBoxContainer.new()
ui.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
ui.offset_top = -120
canvas_layer.add_child(ui)
```

**Particles that use flipbook animation** (CanvasItemMaterial with `particles_anim_h_frames`) won't render correctly with manually loaded textures — they show as white circles. Skip these; the monster usually looks fine without them.

### Scene/Script Template

Each VFX monster gets:
- `render_{monster}.gd` — the GDScript
- `render_{monster}.tscn` — minimal scene that just loads the script

```
[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://render_{monster}.gd" id="1"]
[node name="Main" type="Node2D"]
script = ExtResource("1")
```

Launch with:
```bash
"C:/Users/jparr/Downloads/Godot_v4.6.1-stable_win64.exe/Godot_v4.6.1-stable_win64_console.exe" --path "C:/Users/jparr/Documents/claude/sts2/spine_godot" res://render_{monster}.tscn 2>&1
```

## Already Created VFX Renderers

| Monster | Script | Key VFX |
|---------|--------|---------|
| Waterfall Giant | `render_waterfall.gd` | Water shader on body/mouth slots, mist particles, droplets |
| Living Fog | `render_living_fog.gd` | 3-layer scrolling smoke shader on smoke_tex slots |

## Candidates for VFX Rendering

These monsters are in the "known broken" list and could potentially be fixed with this approach:

| Monster | Folder | Expected VFX |
|---------|--------|-------------|
| The Forgotten | the_forgotten | Scrolling smoke shader (same as Living Fog) |
| Fogmog | fogmog | Likely similar smoke/gas shader |
| Cubex Construct | cubex_construct | 2D sphere shader for the orb |

## Paths

- Game PCK: `D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck`
- GDRE tools: `C:/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe`
- Godot exe: `C:/Users/jparr/Downloads/Godot_v4.6.1-stable_win64.exe/Godot_v4.6.1-stable_win64_console.exe`
- Godot project: `C:/Users/jparr/Documents/claude/sts2/spine_godot/`
- Extracted game files: `C:/Users/jparr/Documents/claude/sts2/raw/`
- Shader assets: `spine_godot/assets/shaders/`
- Texture assets: `spine_godot/assets/textures/`
- Final webp: `C:/Users/jparr/Documents/claude/sts2/media/enemies/`
