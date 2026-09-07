#!/usr/bin/env python3
"""Generate a small, closed Cutline ribbon GLB without external packages.

The mesh is intentionally deterministic and editable: a bent rectangular strip
is sampled along its centerline, with one glTF material and per-face vertex
colors for violet face, wine reverse, and ochre edge.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

OUT = Path(__file__).with_name("cutline-ribbon-fallback.glb")
N = 48
W = 1.35
T = 0.24
L = 4.8

VIOLET = (0.44, 0.22, 0.66, 1.0)
WINE = (0.30, 0.035, 0.12, 1.0)
OCHRE = (0.78, 0.45, 0.06, 1.0)


def point(i: int, across: float, z: float, bent: bool = True):
    x = -L / 2 + L * i / N
    y = 0.62 * math.sin(math.pi * (x / L + 0.5)) if bent else 0.0
    # Keep the ribbon broad and gently folded while its cross section stays
    # rectangular and suitable for deformation.
    return (x, y + across, z)


def make_mesh():
    positions, targets, normals, normal_targets, colors, indices = [], [], [], [], [], []

    def quad(a, b, c, d, ta, tb, tc, td, color):
        ux, uy, uz = (b[k] - a[k] for k in range(3))
        vx, vy, vz = (c[k] - a[k] for k in range(3))
        cross = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        length = math.sqrt(sum(v * v for v in cross))
        normal = tuple(v / length for v in cross)
        tux, tuy, tuz = (tb[k] - ta[k] for k in range(3)); tvx, tvy, tvz = (tc[k] - ta[k] for k in range(3))
        tcross = (tuy * tvz - tuz * tvy, tuz * tvx - tux * tvz, tux * tvy - tuy * tvx)
        tlength = math.sqrt(sum(v * v for v in tcross)); target_normal = tuple(v / tlength for v in tcross)
        base = len(positions)
        for p in (a, b, c, d):
            positions.append(p)
            normals.append(normal)
            normal_targets.append(tuple(target_normal[k] - normal[k] for k in range(3)))
            colors.append(color)
        targets.extend((ta, tb, tc, td))
        indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))

    for i in range(N):
        j = i + 1
        # broad front and reverse faces
        quad(point(i, -W / 2, T / 2), point(j, -W / 2, T / 2), point(j, W / 2, T / 2), point(i, W / 2, T / 2),
             point(i, -W / 2, T / 2, False), point(j, -W / 2, T / 2, False), point(j, W / 2, T / 2, False), point(i, W / 2, T / 2, False), VIOLET)
        quad(point(i, W / 2, -T / 2), point(j, W / 2, -T / 2), point(j, -W / 2, -T / 2), point(i, -W / 2, -T / 2),
             point(i, W / 2, -T / 2, False), point(j, W / 2, -T / 2, False), point(j, -W / 2, -T / 2, False), point(i, -W / 2, -T / 2, False), WINE)
        # long ochre edges
        quad(point(i, -W / 2, -T / 2), point(j, -W / 2, -T / 2), point(j, -W / 2, T / 2), point(i, -W / 2, T / 2),
             point(i, -W / 2, -T / 2, False), point(j, -W / 2, -T / 2, False), point(j, -W / 2, T / 2, False), point(i, -W / 2, T / 2, False), OCHRE)
        quad(point(i, W / 2, T / 2), point(j, W / 2, T / 2), point(j, W / 2, -T / 2), point(i, W / 2, -T / 2),
             point(i, W / 2, T / 2, False), point(j, W / 2, T / 2, False), point(j, W / 2, -T / 2, False), point(i, W / 2, -T / 2, False), OCHRE)
    # closed end caps
    quad(point(0, W / 2, T / 2), point(0, -W / 2, T / 2), point(0, -W / 2, -T / 2), point(0, W / 2, -T / 2),
         point(0, W / 2, T / 2, False), point(0, -W / 2, T / 2, False), point(0, -W / 2, -T / 2, False), point(0, W / 2, -T / 2, False), OCHRE)
    quad(point(N, -W / 2, T / 2), point(N, W / 2, T / 2), point(N, W / 2, -T / 2), point(N, -W / 2, -T / 2),
         point(N, -W / 2, T / 2, False), point(N, W / 2, T / 2, False), point(N, W / 2, -T / 2, False), point(N, -W / 2, -T / 2, False), OCHRE)
    # Morph POSITION and NORMAL are glTF deltas, not absolute target values.
    targets = [tuple(targets[i][k] - positions[i][k] for k in range(3)) for i in range(len(positions))]
    return positions, targets, normals, normal_targets, colors, indices


def pad4(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((-len(b)) % 4)


def main():
    pos, target, nor, normal_target, col, idx = make_mesh()
    pb = b"".join(struct.pack("<3f", *v) for v in pos)
    nb = b"".join(struct.pack("<3f", *v) for v in nor)
    cb = b"".join(struct.pack("<4f", *v) for v in col)
    tb = b"".join(struct.pack("<3f", *v) for v in target)
    tnb = b"".join(struct.pack("<3f", *v) for v in normal_target)
    ib = b"".join(struct.pack("<I", v) for v in idx)
    blob = pad4(pb) + pad4(nb) + pad4(cb) + pad4(tb) + pad4(tnb) + pad4(ib)
    off_n = len(pad4(pb)); off_c = off_n + len(pad4(nb)); off_t = off_c + len(pad4(cb)); off_tn = off_t + len(pad4(tb)); off_i = off_tn + len(pad4(tnb))
    mins = [min(p[k] for p in pos) for k in range(3)]
    maxs = [max(p[k] for p in pos) for k in range(3)]
    gltf = {"asset": {"version": "2.0", "generator": "Cutroom procedural Cutline fallback"},
            "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "CutlineRibbon"}],
            "materials": [{"name": "CutlineVertexColor", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.52}}],
            "meshes": [{"name": "CutlineRibbon", "weights": [0.0], "extras": {"targetNames": ["BendToStraight"]}, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "targets": [{"POSITION": 3, "NORMAL": 4}], "indices": 5, "material": 0}]}],
            "buffers": [{"byteLength": len(blob)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pb)}, {"buffer": 0, "byteOffset": off_n, "byteLength": len(nb)}, {"buffer": 0, "byteOffset": off_c, "byteLength": len(cb)}, {"buffer": 0, "byteOffset": off_t, "byteLength": len(tb)}, {"buffer": 0, "byteOffset": off_tn, "byteLength": len(tnb)}, {"buffer": 0, "byteOffset": off_i, "byteLength": len(ib)}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": mins, "max": maxs}, {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"}, {"bufferView": 2, "componentType": 5126, "count": len(col), "type": "VEC4"}, {"bufferView": 3, "componentType": 5126, "count": len(target), "type": "VEC3", "min": [min(p[k] for p in target) for k in range(3)], "max": [max(p[k] for p in target) for k in range(3)]}, {"bufferView": 4, "componentType": 5126, "count": len(normal_target), "type": "VEC3", "min": [min(p[k] for p in normal_target) for k in range(3)], "max": [max(p[k] for p in normal_target) for k in range(3)]}, {"bufferView": 5, "componentType": 5125, "count": len(idx), "type": "SCALAR"}]}
    # glTF requires JSON chunk padding to be spaces; BIN padding is zeroes.
    j = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(blob)) + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(blob), b"BIN\x00") + blob
    OUT.write_bytes(out)
    print(json.dumps({"path": str(OUT), "vertices": len(pos), "triangles": len(idx)//3, "bounds": [mins, maxs], "bytes": len(out), "normals": "explicit per-face unit normals", "materials": 1}))


if __name__ == "__main__":
    main()
