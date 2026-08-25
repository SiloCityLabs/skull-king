#!/usr/bin/env python3
"""Generate Skull King PWA icons with Pillow (no external SVG renderer)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "icons"

BG = (26, 20, 16)
BG2 = (18, 12, 9)
BONE = (232, 220, 200)
INK = (26, 20, 16)
GOLD = (240, 208, 128)
GOLD_D = (184, 134, 11)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    pad = int(size * 0.12) if maskable else 0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # rounded rect background
    r = int(size * 0.19)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=BG)
    for y in range(size):
      t = y / max(size - 1, 1)
      c = tuple(int(lerp(BG[i], BG2[i], t)) for i in range(3))
      draw.line([(0, y), (size, y)], fill=c)

    cx, cy = size // 2, int(size * 0.52)
    s = (size - pad * 2) / 512

    def px(x: float, y: float) -> tuple[float, float]:
        return pad + x * s, pad + y * s

    # ring
    ring_r = 168 * s
    draw.ellipse(
        (cx - ring_r, cy - ring_r - 16 * s, cx + ring_r, cy + ring_r - 16 * s),
        outline=GOLD_D,
        width=max(2, int(10 * s)),
    )

    # crown
    crown = [
        px(128, 168),
        px(168, 112),
        px(256, 96),
        px(344, 112),
        px(384, 168),
        px(360, 208),
        px(152, 208),
    ]
    draw.polygon(crown, fill=GOLD)
    for gx, gy, gr in [(168, 112, 14), (256, 96, 16), (344, 112, 14)]:
        x, y = px(gx, gy)
        draw.ellipse((x - gr * s, y - gr * s, x + gr * s, y + gr * s), fill=(248, 232, 176))

    # skull
    skull_cx, skull_cy = cx, cy - 4 * s
    draw.ellipse(
        (
            skull_cx - 118 * s,
            skull_cy - 132 * s,
            skull_cx + 118 * s,
            skull_cy + 132 * s,
        ),
        fill=BONE,
    )
    draw.ellipse(
        (
            skull_cx - 88 * s,
            skull_cy - 20 * s,
            skull_cx + 88 * s,
            skull_cy + 124 * s,
        ),
        fill=INK,
    )

    for ex in (-50, 50):
        draw.ellipse(
            (
                skull_cx + ex * s - 28 * s,
                skull_cy - 24 * s - 34 * s,
                skull_cx + ex * s + 28 * s,
                skull_cy - 24 * s + 34 * s,
            ),
            fill=INK,
        )

    # nose
    nx, ny = px(256, 278)
    draw.polygon(
        [(nx, ny), (nx - 20 * s, ny + 40 * s), (nx + 20 * s, ny + 40 * s)],
        fill=INK,
    )

    # teeth
    for i, tx in enumerate([214, 238, 262, 286]):
        x, y = px(tx, 332)
        draw.rounded_rectangle(
            (x, y, x + 18 * s, y + 26 * s),
            radius=max(1, int(3 * s)),
            fill=BONE,
        )

    # crossbones
    lw = max(3, int(22 * s))
    for ox in (-160, 80):
        bx = cx + ox * s
        by = size - pad - 72 * s
        d = 40 * s
        draw.line((bx - d, by - d, bx + d, by + d), fill=BONE, width=lw)
        draw.line((bx - d, by + d, bx + d, by - d), fill=BONE, width=lw)

    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = {
        "favicon-16.png": (16, False),
        "favicon-32.png": (32, False),
        "apple-touch-icon.png": (180, False),
        "icon-192.png": (192, False),
        "icon-512.png": (512, False),
        "icon-192-maskable.png": (192, True),
        "icon-512-maskable.png": (512, True),
    }
    for name, (size, maskable) in targets.items():
        img = draw_icon(size, maskable=maskable)
        path = OUT_DIR / name
        img.save(path, format="PNG", optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
