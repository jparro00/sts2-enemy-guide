---
name: beta-pipeline
description: Run the STS2 beta patch pipeline — fetch patch notes, decompile game files, cross-reference changes, update CSVs, and prepare beta branch for deployment.
---

# Beta Patch Update Pipeline

When invoked, run through the following steps for a new STS2 beta patch. If a version argument is provided (e.g. `/beta-pipeline 0.102.0`), use that version. Otherwise, fetch patch notes first to determine the latest version.

## Step 1: Fetch patch notes
```bash
curl -s "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=2868840&count=5&maxlength=99999&feeds=steam_community_announcements"
```
- Parse JSON to find the latest beta patch post by title
- Extract sections: Enemies, Events, Potions & Relics, Ancients, and relevant General/Content changes
- Present the patch notes summary to the user and confirm this is the correct patch before proceeding

## Step 2: Create branch and update config
- If a `beta-v{VERSION}` branch already exists, check it out
- If not, create from the previous beta branch (the latest `beta-v*` branch): `git checkout beta-v{PREV} && git checkout -b beta-v{VERSION}`
  - To find the previous beta branch: `git branch -r | grep beta-v | sort -V | tail -1`
  - This ensures all prior beta-only data (CSV rows, assets) carries forward
- Update `site-config.json`:
  - Set `betaVersion` to the new version string
  - Set `isBeta` to `true`

## Step 3: Decompile game files
Run the GDRE tools extraction:
```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=/d/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=/c/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://src/Core/Models/Monsters/*.cs" \
  "--include=res://src/Core/Models/Events/*.cs" \
  "--include=res://src/Core/Models/Encounters/*.cs" \
  "--include=res://localization/eng/powers.json" \
  "--include=res://localization/eng/monsters.json" \
  "--include=res://localization/eng/events.json" \
  "--include=res://localization/eng/relics.json" \
  "--include=res://localization/eng/potions.json" \
  "--include=res://localization/eng/cards.json" \
  "--include=res://localization/eng/enchantments.json"
```
Files land at:
- `raw/src/Core/Models/Monsters/*.cs`
- `raw/src/Core/Models/Events/*.cs`
- `raw/src/Core/Models/Encounters/*.cs`
- `raw/localization/eng/*.json`

## Step 4: Extract new asset images
Only if the patch adds new powers/relics/potions/enchantments:
- Identify new assets from patch notes or by diffing JSON files against existing data
- Naming conventions:
  - Powers: `res://images/powers/{key}_power.png` -> `media/powers/{key}_power.webp`
  - Relics: `res://images/relics/{key}.png` -> `media/relics/{key}.webp`
  - Potions: `res://images/potions/{key}.png` -> `media/potions/{key}.webp`
  - Enchantments: `res://images/enchantments/{key}.png` -> `media/enchantments/{key}.webp`
- Targeted extraction:
```bash
"/c/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe" --headless \
  "--recover=/d/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck" \
  "--output=/c/Users/jparr/Documents/claude/sts2/raw" \
  "--include=res://images/powers/{name}_power.png*"
```
- Convert PNG to webp and place in appropriate `media/` folder

## Step 5: Cross-reference patch notes against decompiled CS files
For each change mentioned in the patch notes:
- **Enemy changes**: Read CS in `raw/src/Core/Models/Monsters/`, verify HP, move damage, ascension scaling, patterns, powers
- **Event changes**: Read CS in `raw/src/Core/Models/Events/`, verify IsAllowed requirements, choice effects, gold amounts, HP loss
- **Encounter changes**: Read CS in `raw/src/Core/Models/Encounters/`, verify enemy composition
- Use JSON files in `raw/localization/eng/` to verify power descriptions, monster names, event text
- CS pattern: `GetValueIfAscension(Level, ascensionValue, normalValue)` — ascension value comes FIRST

## Step 6: Update CSV data files
Update the relevant CSVs based on verified changes:
- `data/monsters.csv` — HP, Pattern, Notes, Powers, StartsWith, References
- `data/monster_moves.csv` — Effects, Intent, Notes, References
- `data/encounters.csv` — Enemies, Composition, Emoji, Category
- `data/events.csv` — Notes (requirements/tags), Acts
- `data/event_choices.csv` — Effect, Notes, References
- `data/powers.csv` — if new powers or description changes

### CSV formatting rules
- **Always quote fields that contain commas** — wrap the entire field in `"` (e.g. `"attack, buff"`, `"Damage 10; Apply 2 {weak}, 2 {vulnerable}"`)
- Multi-line CSV fields must be wrapped in `"` quotes with closing `"` on the last line
- Ascension scaling format: `base(ascension)` or `min-max(asc_min-asc_max)`
- Move references use `<Move Name>` angle brackets
- Power references use `{power_key}` curly braces
- Note tags: `[info]`, `[bug]`, `[req]`, `[coop]`
- Color tags on significant values: `[red]` for costs/penalties, `[green]` for gains, `[blue]` for quantities, `[gold]` for Gold/card-related terms
  - Example: "Lose all Gold" -> "Lose [red]all[/red] [gold]Gold[/gold]"
- Coop tag format: `[coop]🤝 Decision made as a group in co-op.`
- When removing an enemy entirely, clean up monsters.csv, monster_moves.csv, AND encounters.csv

## Step 7: Update beta_changes.csv
- Add a row for every changed encounter, monster, and event
- Format: `Type,Name,Change,Patch`
  - Type: `encounter`, `monster`, or `event`
  - Patch: version number (e.g. `0.101.0`)
- Change description should be concise patch-note style
- If a monster/event was changed in a previous beta patch AND this patch, update the existing row's Change description and set Patch to the latest version

## Step 8: Present changes for review
- Show a summary of all changes made
- Do NOT commit or push — NEVER push to remote unless the user explicitly says to push

## Paths
- Game: `D:/Steam/steamapps/common/Slay the Spire 2/`
- PCK: `D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck`
- GDRE: `C:/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe`
- Repo: `C:/Users/jparr/Documents/claude/sts2/`
- Raw output: `C:/Users/jparr/Documents/claude/sts2/raw/`

## Branch management
- Beta branches deploy to `/beta/` on the site
- Always merge master -> beta, NEVER beta -> master
- When merging, `site-config.json` will conflict — always keep `isBeta: true` on beta
- Push master first when pushing both branches, then merge master into beta, then push beta
- NEVER push to remote unless the user explicitly asks to push
- Always safe to push `test` without asking; never push `master` or `beta-*` without permission
