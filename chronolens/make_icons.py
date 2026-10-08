"""Generates the placeholder pixel-clock icon set (pure stdlib, no Pillow)."""
import struct, zlib, os

SPRITE = [
    "..........",
    "..aaaaaa..",
    ".aa....aa.",
    ".a..b...a.",
    ".a..b...a.",
    ".a..bbb.a.",
    ".a......a.",
    ".aa....aa.",
    "..aaaaaa..",
    "..........",
]
PAL = {".": (13, 14, 21, 255), "a": (255, 183, 197, 255), "b": (116, 236, 207, 255)}

def render(size):
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter type 0
        for x in range(size):
            row += bytes(PAL[SPRITE[y * 10 // size][x * 10 // size]])
        rows.append(bytes(row))
    return b"".join(rows)

def png(size):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(render(size), 9)) + chunk(b"IEND", b"")

os.makedirs("src-tauri/icons", exist_ok=True)
for name, size in {"32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512}.items():
    open(f"src-tauri/icons/{name}", "wb").write(png(size))
open("app-icon.png", "wb").write(png(1024))

# Windows .ico with one PNG-compressed 256x256 image (valid since Vista)
data = png(256)
ico = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(data), 22) + data
open("src-tauri/icons/icon.ico", "wb").write(ico)
print("icons written")
