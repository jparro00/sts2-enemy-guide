"""
build_thumbs.py — resize media assets to optimal display dimensions.

Walks media/{ui,enemies,events,powers,relics,potions,enchantments} and shrinks
any .webp larger than its target max dimension to fit within (target × target),
preserving aspect ratio. Re-encodes at quality 75 with method=6 (best webp
compression). Idempotent — files already at or below target are skipped.

Originals live in raw/ and media/raw/ (gitignored). The webps in media/* are
derived working assets, safe to overwrite.

Targets are 2× max display size (retina sharp on 2× DPR phones; mildly soft on
rare 3× DPR devices, invisible for stylized game art).

Usage: python build_thumbs.py
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is not installed. Install with: pip install Pillow")
    sys.exit(1)

BASE = os.path.dirname(os.path.abspath(__file__))

# Max dimension (longer side) for each media subdir
TARGETS = {
    "media/ui": 400,
    "media/enemies": 400,
    "media/events": 400,
    "media/powers": 96,
    "media/relics": 64,
    "media/potions": 64,
    "media/enchantments": 64,
    # cards, intents: skipped (already small)
}

QUALITY = 75
METHOD = 4  # 0 fastest, 6 best/slowest. 4 is the sweet spot — ~5% larger files than 6 but ~5× faster


def fmt_kb(b):
    return f"{b/1024:>7.1f} KB"


totals = {"before": 0, "after": 0, "resized": 0, "skipped": 0, "files": 0}

for rel_dir, target in TARGETS.items():
    abs_dir = os.path.join(BASE, rel_dir)
    if not os.path.isdir(abs_dir):
        print(f"  skip {rel_dir} (not found)")
        continue

    dir_before = 0
    dir_after = 0
    dir_resized = 0
    dir_skipped = 0

    for name in sorted(os.listdir(abs_dir)):
        if not name.lower().endswith(".webp"):
            continue
        path = os.path.join(abs_dir, name)
        size_before = os.path.getsize(path)
        totals["files"] += 1
        dir_before += size_before
        totals["before"] += size_before

        try:
            with Image.open(path) as img:
                w, h = img.size
                if w <= target and h <= target:
                    dir_skipped += 1
                    totals["skipped"] += 1
                    dir_after += size_before
                    totals["after"] += size_before
                    continue

                img.thumbnail((target, target), Image.LANCZOS)
                # Pillow's WebP encoder preserves alpha automatically when mode is RGBA
                img.save(path, "WEBP", quality=QUALITY, method=METHOD)

            size_after = os.path.getsize(path)
            dir_after += size_after
            totals["after"] += size_after
            dir_resized += 1
            totals["resized"] += 1
        except Exception as e:
            print(f"  ERROR {rel_dir}/{name}: {e}")
            dir_after += size_before
            totals["after"] += size_before

    if dir_before == 0:
        print(f"  {rel_dir}: empty")
        continue
    pct = (1 - dir_after / dir_before) * 100
    print(f"  {rel_dir:<22} resized={dir_resized:>3}  skipped={dir_skipped:>3}  "
          f"{fmt_kb(dir_before)} -> {fmt_kb(dir_after)}  ({pct:>4.0f}% reduction)")

print()
if totals["before"] > 0:
    saved = totals["before"] - totals["after"]
    pct = (1 - totals["after"] / totals["before"]) * 100
    print(f"Total: {totals['resized']} resized, {totals['skipped']} skipped, "
          f"{totals['files']} files scanned")
    print(f"  {fmt_kb(totals['before'])} -> {fmt_kb(totals['after'])}  "
          f"({pct:.0f}% reduction, saved {fmt_kb(saved)})")
else:
    print("No files processed.")
