#!/usr/bin/env python3
"""Report whether PNG files carry real transparency. Standard library only."""

import struct
import sys
import zlib

CLEAR_MAX = 7
SOLID_MIN = 248


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, header = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    width, height, depth, color_type, _, _, interlace = header
    return width, height, depth, color_type, interlace, zlib.decompress(idat)


def alpha_values(width, height, raw, channels):
    stride = width * channels
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        kind = raw[pos]
        line = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = prev[i]
            corner = prev[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                p = left + up - corner
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - corner)
                pred = left if pa <= pb and pa <= pc else up if pb <= pc else corner
                line[i] = (line[i] + pred) & 255
        yield line[channels - 1::channels]
        prev = line


def report(path):
    width, height, depth, color_type, interlace, raw = read_png(path)
    if color_type not in (4, 6):
        return f"{path}: {width}x{height}, no alpha channel (opaque)"
    if depth != 8 or interlace:
        return f"{path}: {width}x{height}, alpha channel present (unsupported layout for pixel stats)"
    channels = 2 if color_type == 4 else 4
    rows = list(alpha_values(width, height, raw, channels))
    total = width * height
    clear = sum(1 for row in rows for a in row if a <= CLEAR_MAX)
    solid = sum(1 for row in rows for a in row if a >= SOLID_MIN)
    partial = total - clear - solid
    corners = [rows[0][0], rows[0][-1], rows[-1][0], rows[-1][-1]]
    verdict = (
        "transparent background"
        if clear and max(corners) <= CLEAR_MAX
        else "alpha present but corners opaque"
    )
    return (
        f"{path}: {width}x{height}, {verdict}; {clear / total:.1%} clear, "
        f"{solid / total:.1%} solid, {partial / total:.1%} semi-transparent (edges, glass, shadows), "
        f"corner alpha {corners}"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: alpha_report.py IMAGE.png [...]")
    for arg in sys.argv[1:]:
        try:
            print(report(arg))
        except Exception as error:  # noqa: BLE001
            print(f"{arg}: {error}")
