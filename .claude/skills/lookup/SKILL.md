---
name: lookup
description: Look up how a card, relic, potion, event, power, or monster works by decompiling the STS2 source code live from the game PCK.
---

# Game Code Lookup

When the user asks about how something works in STS2, decompile the relevant source from the game PCK and explain the implementation.

## Paths

- **GDRE:** `C:/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe`
- **PCK:** `D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck`
- **Output:** `C:/Users/jparr/Documents/claude/sts2/raw`

## Step 1 — Extract the localization JSON

Extract the appropriate JSON from the PCK using GDRE `--headless --recover --include`:

| Type | JSON res:// path |
|---|---|
| Powers | `res://localization/eng/powers.json` |
| Monsters | `res://localization/eng/monsters.json` |
| Relics | `res://localization/eng/relics.json` |
| Cards | `res://localization/eng/cards.json` |
| Potions | `res://localization/eng/potions.json` |
| Events | `res://localization/eng/events.json` |

## Step 2 — Grep for the display name to get the internal key

Each JSON is a flat key→string map. Search for the display name value to find its key:

```bash
grep -i "\"Display Name\"" "C:/Users/jparr/Documents/claude/sts2/raw/localization/eng/<type>.json"
```

Key formats and name fields by type:

| Type | Key format | Name field | Example |
|---|---|---|---|
| Powers | `FLUTTER_POWER.title` | `.title` | `"FLUTTER_POWER.title": "Flutter"` |
| Monsters | `ARCHITECT.name` | `.name` | `"ARCHITECT.name": "The Architect"` |
| Relics | `AKABEKO.title` | `.title` | `"AKABEKO.title": "Akabeko"` |
| Cards | `ABRASIVE.title` | `.title` | `"ABRASIVE.title": "Abrasive"` |
| Potions | `ASHWATER.title` | `.title` | `"ASHWATER.title": "Ashwater"` |
| Events | `ABYSSAL_BATHS.pages...` | `.title` (nested) | `"ABYSSAL_BATHS.name": "Abyssal Baths"` |

Strip the suffix (`.title`, `.name`) from the matched key to get the internal key, e.g. `FLUTTER_POWER`.

## Step 3 — Derive the CS class name

Convert the internal key to PascalCase class name:

- Split on `_`, capitalize each word, join: `ASSASSIN_RUBY_RAIDER` → `AssassinRubyRaider`
- **Powers only:** strip `_POWER` before converting, then re-add `Power` suffix: `FLUTTER_POWER` → `Flutter` → `FlutterPower`
- All other types: straight PascalCase, no suffix

## Step 4 — Extract the CS file from the PCK

Use the class name and the type's known res:// path:

| Type | res:// path pattern | CS class convention |
|---|---|---|
| Powers | `res://src/Core/Models/Powers/{Class}.cs` | `FlutterPower` |
| Monsters | `res://src/Core/Models/Monsters/{Class}.cs` | `Architect` |
| Relics | `res://src/Core/Models/Relics/{Class}.cs` | `Akabeko` |
| Cards | `res://src/Core/Models/Cards/{Class}.cs` | `Abrasive` |
| Potions | `res://src/Core/Models/Potions/{Class}.cs` | `Ashwater` |
| Events | `res://src/Core/Models/Events/{Class}.cs` | `AbyssalBaths` |

Extract with GDRE:
```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=C:/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://src/Core/Models/{Type}/{Class}.cs"
```

## Step 5 — Read and explain

Read the extracted CS file. Focus on:
- How the mechanic works step by step
- Numeric values and scaling (including ascension via `GetValueIfAscension`)
- Multiplayer scaling (`ShouldScaleInMultiplayer`, `ScaleHpForMultiplayer`)
- Special conditions, edge cases, state machines
- Interactions with other systems

## Response format

Clear, concise breakdown. Lead with the key facts. Include specific numbers and conditions from the code. Quote important lines but don't paste entire files.
