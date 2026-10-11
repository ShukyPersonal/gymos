#!/usr/bin/env python3
"""Generate app icons from a single square source image.

Android masks adaptive icons into a circle/squircle and crops roughly the
outer 25%, so the artwork must sit inside a centred "safe zone". A full-bleed
source (this one filled 87% x 94% of its canvas) gets its edges sliced off on
a Pixel unless it is scaled down and padded first.

Outputs:
  assets/icon.png           full-bleed square  (iOS / legacy launchers)
  assets/adaptive-icon.png  art inside the safe zone, padded with the source's
                            own background colour so the mask edge is seamless

Usage: python3 scripts/make-icons.py <source.png> [safe_fraction]
"""
import sys, statistics
from PIL import Image, ImageChops

SIZE = 1024
DEFAULT_SAFE = 0.72  # 0.66 = safe on every launcher shape; 0.72 = safe on a circle


def background_colour(im):
    w, h = im.size
    px = im.load()
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    return tuple(int(statistics.median([c[i] for c in corners])) for i in range(3))


def subject_bbox(im, bg, threshold=28):
    diff = ImageChops.difference(im, Image.new('RGB', im.size, bg)).convert('L')
    return diff.point(lambda v: 255 if v > threshold else 0).getbbox() or (0, 0, *im.size)


def main():
    src = sys.argv[1]
    safe = float(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SAFE

    im = Image.open(src).convert('RGB')
    if im.width != im.height:
        print(f'WARNING: source is {im.width}x{im.height}, not square — will distort')
    bg = background_colour(im)

    # Full-bleed: straight resize, no padding.
    im.resize((SIZE, SIZE), Image.LANCZOS).save('assets/icon.png')

    # Adaptive: crop to the subject, then scale it to fit the safe zone so the
    # art is as large as possible without being clipped by the mask.
    l, t, r, b = subject_bbox(im, bg)
    art = im.crop((l, t, r, b))
    budget = int(SIZE * safe)
    scale = budget / max(art.width, art.height)
    art = art.resize((max(1, int(art.width * scale)), max(1, int(art.height * scale))), Image.LANCZOS)

    canvas = Image.new('RGB', (SIZE, SIZE), bg)
    canvas.paste(art, ((SIZE - art.width) // 2, (SIZE - art.height) // 2))
    canvas.save('assets/adaptive-icon.png')

    hexbg = '#%02X%02X%02X' % bg
    print(f'background      : rgb{bg}  ->  {hexbg}')
    print(f'subject bbox    : {(l, t, r, b)}')
    print(f'adaptive art    : {art.width}x{art.height} inside {SIZE}px ({safe:.0%} safe zone)')
    print(f'wrote           : assets/icon.png, assets/adaptive-icon.png')
    print(f'\nSet adaptiveIcon.backgroundColor to {hexbg} in app.json')


if __name__ == '__main__':
    main()
