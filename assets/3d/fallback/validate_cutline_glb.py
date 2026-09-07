#!/usr/bin/env python3
"""Independent structural/topology checks for the procedural Cutline GLB."""
import json, math, struct, sys
from collections import Counter
from pathlib import Path

P = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("cutline-ribbon-fallback.glb")
b = P.read_bytes()
assert b[:4] == b"glTF" and struct.unpack_from("<I", b, 4)[0] == 2
assert struct.unpack_from("<I", b, 8)[0] == len(b)
pos_len = struct.unpack_from("<I", b, 12)[0]
doc = json.loads(b[20:20 + pos_len])
assert b[16:20] == b"JSON"
bin_header = 20 + pos_len
bin_len = struct.unpack_from("<I", b, bin_header)[0]
assert b[bin_header + 4:bin_header + 8] == b"BIN\x00" and bin_header + 8 + bin_len == len(b)
blob = b[bin_header + 8:]
views, acc = doc["bufferViews"], doc["accessors"]
def read_vec(view, n, fmt):
    v = views[view]; off = v.get("byteOffset", 0); size = struct.calcsize(fmt)
    return list(struct.iter_unpack(fmt, blob[off:off + v["byteLength"]]))[:n]
prim = doc["meshes"][0]["primitives"][0]; attrs = prim["attributes"]
assert set(attrs) == {"POSITION", "NORMAL", "COLOR_0"}
positions = read_vec(acc[attrs["POSITION"]]["bufferView"], acc[attrs["POSITION"]]["count"], "<3f")
normals = read_vec(acc[attrs["NORMAL"]]["bufferView"], acc[attrs["NORMAL"]]["count"], "<3f")
target_map = prim["targets"][0]; assert set(target_map) == {"POSITION", "NORMAL"}
target = read_vec(acc[target_map["POSITION"]]["bufferView"], acc[target_map["POSITION"]]["count"], "<3f")
normal_target = read_vec(acc[target_map["NORMAL"]]["bufferView"], acc[target_map["NORMAL"]]["count"], "<3f")
assert acc[target_map["POSITION"]]["componentType"] == 5126 and acc[target_map["NORMAL"]]["componentType"] == 5126
iv = views[acc[prim["indices"]]["bufferView"]]; raw = blob[iv.get("byteOffset", 0):iv.get("byteOffset", 0) + iv["byteLength"]]
indices = [x[0] for x in struct.iter_unpack("<I", raw)]
assert len(indices) % 3 == 0 and max(indices) < len(positions)
assert all(math.isfinite(x) for row in positions + normals + target for x in row)
assert all(abs(math.sqrt(sum(x*x for x in n)) - 1) < 1e-5 for n in normals)
assert len(target) == len(positions) == len(normal_target) and doc["meshes"][0]["weights"] == [0.0]
keys = lambda p: tuple(round(x, 5) for x in p)
weld = {keys(p): i for i, p in enumerate(positions)}
edges = Counter()
for a, c, d in zip(indices[::3], indices[1::3], indices[2::3]):
    tri = [weld[keys(positions[i])] for i in (a, c, d)]
    assert len(set(tri)) == 3
    for u, v in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
        edges[tuple(sorted((u, v)))] += 1
assert all(n == 2 for n in edges.values()), Counter(edges.values())
print(json.dumps({"file": str(P), "chunks": "JSON+BIN valid", "vertices": len(positions), "welded_vertices": len(weld), "triangles": len(indices)//3, "edges": len(edges), "closed_manifold": True, "index_bounds": True, "finite_normals": True, "unit_normals": True, "primitive_accessor_mapping": "dereferenced", "morph": "BendToStraight POSITION+NORMAL deltas"}, sort_keys=True))
