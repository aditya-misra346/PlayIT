#!/usr/bin/env python3
"""Generate Auralis brand icons (PNG, ICNS, ICO) in desktop/src-tauri/icons/."""
import math
import os
import struct
import zlib

ICONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src-tauri", "icons")
os.makedirs(ICONS_DIR, exist_ok=True)


def render_auralis_icon(size: int) -> bytes:
    """Render RGBA bytes of the Auralis brand mark: midnight circle + gradient core + 3 sound arcs."""
    rows = []
    cx = size * 0.44
    cy = size * 0.50
    r_bg = size * 0.46
    r_core = size * 0.14
    arc_radii = [size * 0.23, size * 0.31, size * 0.39]
    arc_thick = max(1.5, size * 0.028)

    for y in range(size):
        row = bytearray()
        row.append(0)  # PNG filter type 0
        for x in range(size):
            dx_bg = x - (size * 0.5)
            dy_bg = y - (size * 0.5)
            dist_bg = math.hypot(dx_bg, dy_bg)

            if dist_bg > r_bg + 1.0:
                row.extend((0, 0, 0, 0))
                continue

            alpha = 255
            if dist_bg > r_bg - 1.0:
                alpha = int(max(0.0, min(1.0, (r_bg + 1.0 - dist_bg) / 2.0)) * 255)

            # Base midnight #060A14 to deep #0B1220
            r, g, b = 11, 18, 32

            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)
            angle = math.atan2(dy, dx)

            # Signature gradient factor 135deg (#2F6BFF -> #22D3EE -> #14B8A6)
            t = max(0.0, min(1.0, (x + y) / (2.0 * size)))
            if t < 0.5:
                u = t * 2.0
                gr = int(47 * (1 - u) + 34 * u)
                gg = int(107 * (1 - u) + 211 * u)
                gb = int(255 * (1 - u) + 238 * u)
            else:
                u = (t - 0.5) * 2.0
                gr = int(34 * (1 - u) + 20 * u)
                gg = int(211 * (1 - u) + 184 * u)
                gb = int(238 * (1 - u) + 166 * u)

            if dist <= r_core:
                r, g, b = gr, gg, gb
            else:
                # Three concentric open sound arcs offset to the right (-65 deg to +65 deg)
                if -1.15 <= angle <= 1.15:
                    for ar in arc_radii:
                        if abs(dist - ar) <= arc_thick:
                            r, g, b = gr, gg, gb
                            break

            row.extend((r, g, b, alpha))
        rows.append(bytes(row))

    raw_data = b"".join(rows)

    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw_data, 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def write_png(filename: str, size: int) -> bytes:
    data = render_auralis_icon(size)
    path = os.path.join(ICONS_DIR, filename)
    with open(path, "wb") as f:
        f.write(data)
    return data


def write_ico(filename: str, png_bytes_32: bytes, png_bytes_256: bytes) -> None:
    path = os.path.join(ICONS_DIR, filename)
    header = struct.pack("<HHH", 0, 1, 2)
    offset1 = 6 + 16 * 2
    offset2 = offset1 + len(png_bytes_32)
    entry1 = struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png_bytes_32), offset1)
    entry2 = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png_bytes_256), offset2)
    with open(path, "wb") as f:
        f.write(header + entry1 + entry2 + png_bytes_32 + png_bytes_256)


def write_icns(filename: str, png_128: bytes, png_256: bytes, png_512: bytes) -> None:
    path = os.path.join(ICONS_DIR, filename)
    blocks = []
    for ostype, data in [(b"ic07", png_128), (b"ic08", png_256), (b"ic09", png_512)]:
        blocks.append(ostype + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(blocks)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


if __name__ == "__main__":
    p32 = write_png("32x32.png", 32)
    p128 = write_png("128x128.png", 128)
    p256 = write_png("128x128@2x.png", 256)
    p512 = write_png("icon.png", 512)
    write_ico("icon.ico", p32, p256)
    write_icns("icon.icns", p128, p256, p512)
    print("Generated icons in", ICONS_DIR)
