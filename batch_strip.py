"""Batch process raw screenshots to named, cleaned enemy PNGs."""
import os
import shutil
from strip_bg import strip_background

RAW_DIR = os.path.join(os.path.dirname(__file__), "data", "media", "raw")
OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "media", "enemies")

# Mapping: raw number -> correct enemy name
# 001 = already done (Seapunk based on the image)
names = {
    1: "Bowlbug (Rock)",
    2: "Bowlbug (Nectar)",
    3: "Bowlbug (Egg)",
    4: "Bowlbug (Silk)",
    5: "Exoskeleton",
    6: "Thieving Hopper",
    7: "Tunneler",
    8: "Chomper",
    9: "Hunter Killer",
    10: "Louse Progenitor",
    11: "Myte",
    12: "Ovicopter",
    13: "Tough Egg",
    14: "Hatchling",
    15: "Slumbering Beetle",
    16: "Spiny Toad",
    17: "The Obscura",
    18: "Parafright",
    19: "Decimilipede",
    20: "Entomancer",
    21: "Infested Prism",
    22: "Flail Knight",
    23: "Spectral Knight",
    24: "Magi Knight",
    25: "Mecha Knight",
    26: "Soul Nexus",
    27: "Kaiser Crab",
    28: "Knowledge Demon",
    29: "The Insatiable",
}

for num, name in names.items():
    raw_path = os.path.join(RAW_DIR, f"{num:03d}.png")
    clean_path = os.path.join(RAW_DIR, f"{num:03d}_clean.png")
    final_path = os.path.join(OUT_DIR, f"{name}.png")

    if not os.path.exists(raw_path):
        print(f"  SKIP: {raw_path} not found")
        continue

    print(f"Processing {num:03d} -> {name}...")
    strip_background(raw_path)

    if os.path.exists(clean_path):
        shutil.move(clean_path, final_path)
        print(f"  -> {final_path}")
    else:
        print(f"  ERROR: clean file not created")

print("\nDone!")
