import csv
import re
import os

BASE = r"C:\Users\jparr\Documents\claude\sts2"
CSV_DIR = os.path.join(BASE, "csv")
OUT_DIR = os.path.join(BASE, "data")
os.makedirs(OUT_DIR, exist_ok=True)

enemies = []  # list of dicts: {name, hp, pattern, notes}
moves = []    # list of dicts: {enemy, move, effects, intent}

def guess_intent(effects_list):
    """Best-guess intent from effect text. Returns comma-separated intents."""
    intents = set()
    combined = " | ".join(effects_list).lower()

    # Check for damage
    has_damage = bool(re.search(r'damage\s+\d+', combined))
    has_multi = bool(re.search(r'damage\s+\d+x\d+', combined) or re.search(r'damage\s+\d+\s*x\s*\d+', combined))

    if has_multi:
        intents.add("multi_attack")
    elif has_damage:
        intents.add("attack")

    # Block
    if re.search(r'block\s+\d+', combined) and 'all block' not in combined:
        intents.add("block")

    # Buffs (self-beneficial)
    if re.search(r'gain\s+\d+\s*(strength|ritual|thorns|dexterity|plating|intangible|artifact|vigor)', combined):
        intents.add("buff")
    if re.search(r'gain\s+ritual\s+\d+', combined):
        intents.add("buff")
    if re.search(r'gain\s+\d+\s*\(\d+\)\s*strength', combined):
        intents.add("buff")
    if re.search(r'strength\s+\d+', combined) and 'apply' not in combined and '-' not in combined:
        intents.add("buff")
    if 'heal' in combined:
        intents.add("buff")
    if re.search(r'gains?\s+(plow|flutter|burrowed|soar|enrage|personal hive)', combined):
        intents.add("buff")

    # Debuffs (applied to player)
    if re.search(r'apply\s+\d*\s*(weak|frail|vulnerable|ringing|shrink|tangled|hex|dampen|constrict|tender|smoggy)', combined):
        intents.add("debuff")
    if re.search(r'apply\s+-\d+\s*(strength|dexterity)', combined):
        intents.add("debuff")

    # Add statuses (cards added to deck)
    if re.search(r'(add|shuffle)\s+\d+\s+\w+.*(discard|draw|hand)', combined):
        intents.add("add_statuses")

    # Summon
    if 'summon' in combined:
        intents.add("summon")

    # Affliction (ongoing damage effects like Constrict)
    if 'constrict' in combined and 'apply' in combined:
        intents.discard("debuff")
        intents.add("affliction")

    # Sleeping
    if 'pass' in combined and 'turn' in combined:
        intents.add("sleeping")
    if combined.strip() == 'passes turn':
        intents = {"sleeping"}

    # Escape
    if 'escape' in combined:
        intents = {"escape"}

    # Hatching / special
    if 'hatch' in combined:
        intents.add("buff")

    if not intents:
        intents.add("unknown")

    # Sort for consistency
    order = ["attack", "multi_attack", "block", "buff", "debuff", "add_statuses", "affliction", "summon", "sleeping", "deathblow", "escape", "unknown"]
    sorted_intents = sorted(intents, key=lambda x: order.index(x) if x in order else 99)
    return ", ".join(sorted_intents)


def parse_enemy_file(filepath, category_label):
    """Parse a Monsters/Elites/Bosses CSV file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = list(csv.reader(f))

    i = 0
    while i < len(reader):
        row = reader[i]

        # Skip header row
        if i == 0:
            i += 1
            continue

        # Check if this is an enemy name row (col 0 is non-empty and not a section header)
        name = row[0].strip() if row[0] else ""

        # Skip empty rows or section headers
        if not name or name in ("Knights", "Kaiser Crab", "The Kin", "Doormaker", "Test Subject #C14", "Stage 1", "Stage 2", "Stage 3"):
            # Special handling for sub-enemies
            if name in ("Stage 1", "Stage 2", "Stage 3"):
                name = f"Test Subject {name}"
            elif name == "":
                i += 1
                continue
            else:
                i += 1
                continue

        # Clean up name - remove (minion) suffix for HP lookup but keep for identification
        clean_name = re.sub(r'\s*\(minion\)\s*', '', name).strip()

        hp = row[1].strip() if len(row) > 1 else ""

        # Get move names from this row (columns 2-7)
        move_names = []
        for col in range(2, min(8, len(row))):
            mn = row[col].strip() if row[col] else ""
            if mn:
                move_names.append((col, mn))

        notes = row[8].strip() if len(row) > 8 and row[8] else ""
        pattern = row[9].strip() if len(row) > 9 and row[9] else ""

        # Collect effect rows below
        effect_rows = []
        j = i + 1
        while j < len(reader):
            erow = reader[j]
            # If col 0 has a non-empty value that looks like a new enemy, stop
            if erow[0].strip() and erow[0].strip() not in ("", "(minion)"):
                # Check if it's a continuation (like "(minion)" on next line)
                if erow[0].strip() == "(minion)":
                    j += 1
                    continue
                break
            # If the row is completely empty, might be end of enemy
            if all(not c.strip() for c in erow):
                j += 1
                continue
            effect_rows.append(erow)
            j += 1

        # Also grab pattern continuations from effect rows
        extra_patterns = []
        for erow in effect_rows:
            if len(erow) > 9 and erow[9] and erow[9].strip():
                extra_patterns.append(erow[9].strip())
            if len(erow) > 8 and erow[8] and erow[8].strip() and not notes:
                notes = erow[8].strip()
            elif len(erow) > 8 and erow[8] and erow[8].strip():
                notes += " " + erow[8].strip()

        if extra_patterns:
            pattern = pattern + " " + " ".join(extra_patterns)

        # Build moves
        for col, move_name in move_names:
            effects = []
            # First check the name row itself for effects below move name
            # Effects are in the rows below, same column
            for erow in effect_rows:
                if len(erow) > col and erow[col] and erow[col].strip():
                    effects.append(erow[col].strip())

            intent = guess_intent(effects) if effects else "unknown"

            moves.append({
                "enemy": clean_name,
                "move": move_name,
                "effects": "; ".join(effects),
                "intent": intent
            })

        # Add enemy
        enemies.append({
            "name": clean_name,
            "hp": hp,
            "pattern": pattern.strip(),
            "notes": notes.strip()
        })

        i = j if j > i + 1 else i + 1


def parse_special_bosses(filepath):
    """Handle multi-part bosses like Kaiser Crab, The Kin, Doormaker, Test Subject."""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = list(csv.reader(f))

    # Find and parse sub-enemies that were skipped
    i = 0
    current_section = None
    while i < len(reader):
        row = reader[i]
        name = row[0].strip() if row[0] else ""

        if name in ("Kaiser Crab", "The Kin", "Doormaker", "Test Subject #C14"):
            current_section = name
            i += 1
            continue

        # Sub-enemies of multi-part bosses
        if name in ("Crusher", "Rocket", "Kin Priest", "Kin Follower", "Door",
                     "Stage 1", "Stage 2", "Stage 3"):

            display_name = name
            if name.startswith("Stage"):
                display_name = f"Test Subject {name}"

            hp = row[1].strip() if len(row) > 1 else ""

            move_names = []
            for col in range(2, min(8, len(row))):
                mn = row[col].strip() if row[col] else ""
                if mn:
                    move_names.append((col, mn))

            notes = row[8].strip() if len(row) > 8 and row[8] else ""
            pattern = row[9].strip() if len(row) > 9 and row[9] else ""

            # Collect effects
            effect_rows = []
            j = i + 1
            while j < len(reader):
                erow = reader[j]
                if erow[0].strip() and erow[0].strip() not in ("", "(Minion)", "(minion)"):
                    break
                if all(not c.strip() for c in erow):
                    j += 1
                    continue
                effect_rows.append(erow)
                j += 1

            extra_patterns = []
            for erow in effect_rows:
                if len(erow) > 9 and erow[9] and erow[9].strip():
                    extra_patterns.append(erow[9].strip())
                if len(erow) > 8 and erow[8] and erow[8].strip():
                    if notes:
                        notes += " " + erow[8].strip()
                    else:
                        notes = erow[8].strip()

            if extra_patterns:
                pattern = pattern + " " + " ".join(extra_patterns)

            for col, move_name in move_names:
                effects = []
                for erow in effect_rows:
                    if len(erow) > col and erow[col] and erow[col].strip():
                        effects.append(erow[col].strip())

                intent = guess_intent(effects) if effects else "unknown"

                moves.append({
                    "enemy": display_name,
                    "move": move_name,
                    "effects": "; ".join(effects),
                    "intent": intent
                })

            enemies.append({
                "name": display_name,
                "hp": hp,
                "pattern": pattern.strip(),
                "notes": notes.strip()
            })

            i = j if j > i + 1 else i + 1
        else:
            i += 1


# Parse all source files
parse_enemy_file(os.path.join(CSV_DIR, "Monsters.csv"), "monster")
parse_enemy_file(os.path.join(CSV_DIR, "Elites.csv"), "elite")
parse_enemy_file(os.path.join(CSV_DIR, "Bosses.csv"), "boss")
parse_special_bosses(os.path.join(CSV_DIR, "Bosses.csv"))

# Deduplicate enemies by name (keep first occurrence)
seen = set()
unique_enemies = []
for e in enemies:
    if e["name"] not in seen:
        seen.add(e["name"])
        unique_enemies.append(e)

# Deduplicate moves
seen_moves = set()
unique_moves = []
for m in moves:
    key = (m["enemy"], m["move"])
    if key not in seen_moves:
        seen_moves.add(key)
        unique_moves.append(m)

# Write enemies.csv
with open(os.path.join(OUT_DIR, "enemies.csv"), 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["Name", "HP", "Pattern", "Notes"])
    writer.writeheader()
    for e in unique_enemies:
        writer.writerow({"Name": e["name"], "HP": e["hp"], "Pattern": e["pattern"], "Notes": e["notes"]})

# Write moves.csv
with open(os.path.join(OUT_DIR, "moves.csv"), 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["Enemy", "Move", "Effects", "Intent"])
    writer.writeheader()
    for m in unique_moves:
        writer.writerow({"Enemy": m["enemy"], "Move": m["move"], "Effects": m["effects"], "Intent": m["intent"]})

# Build encounters.csv from Act files
encounters = []
act_files = {
    ("1", "Overgrowth"): "Act_1_Overgrowth.csv",
    ("1", "Underdocks"): "Act_1_Underdocks.csv",
    ("2", "Hive"): "Act_2_Hive.csv",
    ("3", "Glory"): "Act_3_Glory.csv",
}

# ── Name normalization: map encounter enemy names to enemies.csv names ──
enemy_name_map = {
    # Plurals -> singular
    "Corpse Slugs": "Corpse Slug",
    "Toadpoles": "Toadpole",
    "Two-Tailed Rats": "Two-Tailed Rat",
    "Phantasmal Gardeners": "Phantasmal Gardener",
    "Chompers": "Chomper",
    "Mytes": "Myte",
    "Axebots": "Axebot",
    "Exoskeletons": "Exoskeleton",
    "Scrolls of Biting": "Scroll of Biting",
    "Cubex Constructs": "Cubex Construct",
    "Decimillipede segments": "Decimillipede",
    "Nibbit": "Nibbit",
    # Ruby Raiders name format
    "Assassin Ruby Raider": "Ruby Raider (Assassin)",
    "Axe Ruby Raider": "Ruby Raider (Axe)",
    "Brute Ruby Raider": "Ruby Raider (Brute)",
    "Crossbow Ruby Raider": "Ruby Raider (Crossbow)",
    "Tracker Ruby Raider": "Ruby Raider (Tracker)",
    # Slime name variants
    "Twig Slime (Small)": "Twig Slime (S)",
    "Twig Slime (Medium)": "Twig Slime (M)",
    "Leaf Slime (Small)": "Leaf Slime (Small)",
    "Leaf Slime (Medium)": "Leaf Slime (Medium)",
    "Medium Slime (random)": "Leaf Slime (Medium)",
    "Small Slimes (random)": "Leaf Slime (Small)",
    # Boss sub-enemies
    "Torch Amalgam": "Torch Head Amalgam",
    "Test Subject #C14 (Stage 1)": "Test Subject Stage 1",
    # Multi-part
    "Kin Follower": "Kin Follower",
    "Kin Priest": "Kin Priest",
}

# Tags and descriptions to filter out of enemy lists
tags_to_filter = {
    "Workers", "Slugs", "Scrolls", "Thieves", "Burrower",
    "Knights", "Crawler", "Shrinker", "Slimes", "Mushroom",
    "Mushroom, Slimes", "Fruit, Strangler", "Crawler, Shrinker",
    "Seapunk", "Chomper", "Burrower, Workers", "Strangler",
}

def normalize_enemy_name(val):
    """Map encounter enemy names to match enemies.csv names."""
    val = val.strip()
    # Filter out tags
    if val in tags_to_filter:
        return None
    # Filter descriptions
    if val.startswith("random ") or val.endswith(":") or val.startswith("Summons") or val.startswith("("):
        return None
    # Apply name map
    return enemy_name_map.get(val, val)

# Emoji map for encounters
emoji_map = {
    "Fuzzy Wurm Crawler": "🐛", "Nibbits": "🐀", "Shrinker Beetle": "🪲",
    "Slimes": "🟢", "Cubex Construct": "🔷", "Flyconid": "🍄", "Fogmog": "🌫️",
    "Inklets": "🖤", "Mawler": "👹", "Overgrowth Crawlers": "🐛",
    "Ruby Raiders": "💎", "Slithering Strangler": "🐍", "Snapping Jaxfruit": "🌺",
    "Vine Shambler": "🌿", "Bygone Effigy": "🗿", "Byrdonis": "🦅",
    "Phrog Parasite": "🐸", "Ceremonial Beast": "🦬", "The Kin": "👥",
    "Vantom": "👻", "Corpse Slugs": "🐌", "Seapunk": "🦑",
    "Sludge Spinner": "🕷️", "Toadpoles": "🐸", "Cultists": "🔮",
    "Living Fog": "🌫️", "Fossil Stalker": "🦴", "Gremlin Merc": "👺",
    "Haunted Ship": "🚢", "Punch Construct": "🤖", "Sewer Clam": "🐚",
    "Two-Tailed Rats": "🐀", "Skulking Colony": "🕳️",
    "Phantasmal Gardeners": "👻", "Terror Eel": "🐍",
    "Lagavulin Matriarch": "🛡️", "Soul Fysh": "🐟", "Waterfall Giant": "🗿",
    "Bowlbugs": "🐜", "Exoskeletons": "💀", "Thieving Hopper": "🦗",
    "Tunneler": "🪱", "Chompers": "🦷", "Hunter Killer": "🔺",
    "Louse Progenitor": "🐛", "Mytes": "🕷️", "Ovicopter": "🪰",
    "Slumbering Beetle": "🪲", "Spiny Toad": "🐸", "The Obscura": "👁️",
    "Decimillipede": "🐛", "Entomancer": "🧙", "Infested Prisms": "💎",
    "Kaiser Crab": "🦀", "Knowledge Demon": "😈", "The Insatiable": "🕳️",
    "Devoted Sculptor": "⚒️", "Scrolls of Biting": "📜",
    "Turret Operator": "🛡️", "Axebots": "🪓", "Construct Menagerie": "🤖",
    "Fabricator": "⚙️", "Frog Knight": "🐸", "Globe Head": "🌐",
    "Owl Magistrate": "🦉", "Slimed Berserker": "🟢",
    "The Lost and Forgotten": "💀", "Knights": "⚔️", "Mecha Knight": "🤖",
    "Soul Nexus": "💜", "Doormaker": "🚪", "Queen": "👑",
    "Test Subject": "🧪", "Toadpoles + Cultist": "🐸",
    "Tunneler + Bowlbug": "🪱",
}

for (act, zone), filename in act_files.items():
    filepath = os.path.join(CSV_DIR, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = list(csv.reader(f))

    current_cat = None
    i = 0
    while i < len(reader):
        row = reader[i]
        line = row[0].strip() if row[0] else ""

        # Detect category
        if "Easy Pool" in line or "Easy" in line and "Combats" in line:
            current_cat = "easy"
            i += 1
            continue
        elif "Hard Pool" in line or "Hard" in line and "Combats" in line:
            current_cat = "hard"
            i += 1
            continue
        elif line.startswith("Elites:") or line.startswith("Elite"):
            current_cat = "elite"
            i += 1
            continue
        elif line.startswith("Boss") or line.startswith("Bosses"):
            current_cat = "boss"
            i += 1
            continue
        elif line.startswith("Events:") or line.startswith("Event"):
            current_cat = None  # skip events for now
            i += 1
            continue
        elif line.startswith("Ancient") or not line or line.startswith("Act ") or line.startswith("Neow") or line.startswith(","):
            i += 1
            continue

        if current_cat and line and not line.startswith(",") and not line.startswith("Summary") and not line.startswith("Monsters") and not line.startswith("Tags"):
            # This is an encounter name — clean up multi-line names
            encounter_name = line.split(":")[0].split("\n")[0].strip()
            # Remove trailing descriptions
            if encounter_name.startswith("Ruby Raiders"):
                encounter_name = "Ruby Raiders"
            if encounter_name.startswith("Slithering Strangler"):
                encounter_name = "Slithering Strangler"

            # Get enemies from the Monsters column (col 2 in act files) or from Summary
            enemy_list = []
            multi = ""

            def clean_enemy_name(val):
                """Strip number prefixes like '1 Crusher' -> 'Crusher', '2 Cubex Constructs' -> 'Cubex Constructs'"""
                val = val.strip()
                m = re.match(r'^\d+\s+(.+)$', val)
                return m.group(1) if m else val

            def is_enemy_name(val):
                return (val and not val.startswith("(") and not val.startswith("or ")
                        and val not in ("Summary:", "Monsters:", "Tags:", "")
                        and not val.startswith("with random"))

            # Also check the encounter name row itself for enemy data (cols 1+)
            for col in range(1, min(6, len(row))):
                val = row[col].strip() if len(row) > col and row[col] else ""
                if is_enemy_name(val):
                    cleaned = clean_enemy_name(val)
                    normalized = normalize_enemy_name(cleaned)
                    if normalized:
                        enemy_list.append(normalized)

            # Look at rows below for more enemy names
            j = i + 1
            while j < len(reader):
                subrow = reader[j]
                sub0 = subrow[0].strip() if subrow[0] else ""
                # If next row has content in col 0, it's a new encounter
                if sub0 and sub0 not in ("", ","):
                    break
                # Collect enemy names from columns
                for col in range(1, min(6, len(subrow))):
                    val = subrow[col].strip() if len(subrow) > col and subrow[col] else ""
                    if is_enemy_name(val):
                        cleaned = clean_enemy_name(val)
                        normalized = normalize_enemy_name(cleaned)
                        if normalized:
                            enemy_list.append(normalized)
                j += 1

            if len(enemy_list) > 1:
                multi = f"{len(enemy_list)} enemies"

            emoji = emoji_map.get(encounter_name, "❓")

            encounters.append({
                "Act": act,
                "Zone": zone,
                "Category": current_cat,
                "Encounter": encounter_name,
                "Enemies": "; ".join(enemy_list),
                "Multi": multi,
                "Emoji": emoji
            })

            i = j if j > i + 1 else i + 1
        else:
            i += 1

# Write encounters.csv
with open(os.path.join(OUT_DIR, "encounters.csv"), 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["Act", "Zone", "Category", "Encounter", "Enemies", "Multi", "Emoji"])
    writer.writeheader()
    for enc in encounters:
        writer.writerow(enc)

print(f"Generated {len(unique_enemies)} enemies, {len(unique_moves)} moves, {len(encounters)} encounters")
print(f"Output in: {OUT_DIR}")
