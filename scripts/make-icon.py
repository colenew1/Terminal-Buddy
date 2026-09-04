"""Generates build/icon.png (512x512) with no third-party deps.

electron-builder converts this to a Windows .ico at package time.
"""
import struct
import zlib
import math
import os

SIZE = 512
RADIUS = 112

# Brand gradient, matching .brand-mark in styles.css
C0 = (0x6E, 0xA8, 0xFE)
C1 = (0xA7, 0x8B, 0xFA)
INK = (0xF5, 0xF8, 0xFF)


def rounded_alpha(x, y):
    """Anti-aliased coverage for a rounded square."""
    cx = min(max(x, RADIUS), SIZE - RADIUS)
    cy = min(max(y, RADIUS), SIZE - RADIUS)
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, RADIUS - d + 0.5))


def seg_distance(px, py, x1, y1, x2, y2):
    vx, vy = x2 - x1, y2 - y1
    wx, wy = px - x1, py - y1
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(px - (x1 + t * vx), py - (y1 + t * vy))


# A ">_" prompt glyph.
STROKES = [
    (168, 176, 268, 256, 30),
    (268, 256, 168, 336, 30),
    (296, 344, 404, 344, 28),
]


def pixel(x, y):
    a = rounded_alpha(x, y)
    if a <= 0:
        return (0, 0, 0, 0)

    t = (x + y) / (2.0 * SIZE)
    r = int(C0[0] + (C1[0] - C0[0]) * t)
    g = int(C0[1] + (C1[1] - C0[1]) * t)
    b = int(C0[2] + (C1[2] - C0[2]) * t)

    ink = 0.0
    for x1, y1, x2, y2, w in STROKES:
        d = seg_distance(x, y, x1, y1, x2, y2)
        ink = max(ink, max(0.0, min(1.0, w / 2.0 - d + 0.5)))

    if ink > 0:
        r = int(r + (INK[0] - r) * ink)
        g = int(g + (INK[1] - g) * ink)
        b = int(b + (INK[2] - b) * ink)

    return (r, g, b, int(a * 255))


def chunk(tag, data):
    return (
        struct.pack('>I', len(data))
        + tag
        + data
        + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def main():
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type: none
        for x in range(SIZE):
            raw.extend(pixel(x + 0.5, y + 0.5))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    os.makedirs('build', exist_ok=True)
    out = os.path.join('build', 'icon.png')
    with open(out, 'wb') as f:
        f.write(png)
    print('wrote %s (%d bytes)' % (out, len(png)))


if __name__ == '__main__':
    main()
