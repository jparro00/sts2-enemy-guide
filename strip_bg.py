"""
Strip background from sprite screenshots, crop to content, resize to 512px.

Usage: python strip_bg.py data/media/raw/001.png
  - Outputs to data/media/raw/001_clean.png
"""

import sys
import os
import numpy as np
from PIL import Image

def strip_background(input_path):
    img = Image.open(input_path).convert("RGBA")
    data = np.array(img)

    # Sample background color from corners (average of 20x20 corner patches)
    h, w = data.shape[:2]
    corners = [
        data[0:20, 0:20, :3],
        data[0:20, w-20:w, :3],
        data[h-20:h, 0:20, :3],
        data[h-20:h, w-20:w, :3],
    ]
    bg_color = np.mean(np.concatenate([c.reshape(-1, 3) for c in corners], axis=0), axis=0)

    # Calculate color distance from background for each pixel
    rgb = data[:, :, :3].astype(float)
    diff = np.sqrt(np.sum((rgb - bg_color) ** 2, axis=2))

    # Also detect the dark hex pattern - anything very dark is likely background
    brightness = np.mean(rgb, axis=2)

    # Create alpha mask: keep pixels that are far from bg color AND not too dark
    # Use a threshold - pixels close to bg color become transparent
    threshold = 40
    dark_threshold = 50

    # Pixel is foreground if it's different enough from bg color
    is_foreground = diff > threshold

    # But also keep brighter pixels that might be similar hue but are part of sprite
    is_bright_enough = brightness > dark_threshold

    # Combined: foreground if different from bg, OR bright enough and moderately different
    alpha_mask = is_foreground | (is_bright_enough & (diff > 25))

    # Clean up edges with simple erosion/dilation effect
    # Remove isolated transparent pixels inside the sprite
    from scipy import ndimage
    # Fill small holes
    alpha_filled = ndimage.binary_fill_holes(alpha_mask)
    # Remove small noise outside sprite
    labeled, num_features = ndimage.label(alpha_filled)
    if num_features > 0:
        sizes = ndimage.sum(alpha_filled, labeled, range(1, num_features + 1))
        largest = np.argmax(sizes) + 1
        alpha_mask = labeled == largest

    # Apply alpha
    data[:, :, 3] = (alpha_mask * 255).astype(np.uint8)

    # Crop to content (non-transparent bounding box)
    rows = np.any(alpha_mask, axis=1)
    cols = np.any(alpha_mask, axis=0)
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    # Add small padding
    pad = 10
    rmin = max(0, rmin - pad)
    rmax = min(h - 1, rmax + pad)
    cmin = max(0, cmin - pad)
    cmax = min(w - 1, cmax + pad)

    cropped = Image.fromarray(data[rmin:rmax+1, cmin:cmax+1])

    # Resize to fit in 512x512 while maintaining aspect ratio, then center on transparent canvas
    cw, ch = cropped.size
    scale = min(512 / cw, 512 / ch)
    new_w = int(cw * scale)
    new_h = int(ch * scale)
    resized = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    x_off = (512 - new_w) // 2
    y_off = (512 - new_h) // 2
    canvas.paste(resized, (x_off, y_off))

    # Save
    base, ext = os.path.splitext(input_path)
    output_path = f"{base}_clean.png"
    canvas.save(output_path, "PNG")
    print(f"Saved: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python strip_bg.py <image_path>")
        sys.exit(1)
    strip_background(sys.argv[1])
