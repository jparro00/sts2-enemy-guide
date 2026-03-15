"""
Clipboard-to-PNG auto-saver.

Usage: python clip2png.py
  - Take a screenshot with Win+Shift+S
  - Press Enter to save it
  - PNG is auto-numbered and saved to data/media/raw/
  - Repeat! Press Ctrl+C to quit.
"""

import os
import time
from PIL import ImageGrab

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data", "media", "raw")
os.makedirs(OUTPUT_DIR, exist_ok=True)

counter = 1
print(f"Saving PNGs to: {OUTPUT_DIR}")
print("Take a screenshot with Win+Shift+S, then press Enter to save.\n")

while True:
    try:
        input(f"[{counter}] Press Enter to save clipboard...")

        img = ImageGrab.grabclipboard()
        if img is None:
            print("  No image in clipboard! Take a screenshot first.\n")
            continue

        filename = f"{counter:03d}.png"
        path = os.path.join(OUTPUT_DIR, filename)
        img.save(path, "PNG")
        print(f"  Saved: {path}\n")
        counter += 1

    except KeyboardInterrupt:
        print(f"\nDone! Saved {counter - 1} images.")
        break
