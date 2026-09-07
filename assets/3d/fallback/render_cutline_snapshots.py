#!/usr/bin/env python3
"""Tiny dependency-light mesh renderer for evidence snapshots (Pillow only)."""
import json, struct
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent; GLB = ROOT / "cutline-ribbon-fallback.glb"; SIZE = 320
def load(weight):
    b = GLB.read_bytes(); jl = struct.unpack_from("<I", b, 12)[0]; d = json.loads(b[20:20+jl]); blob = b[20+jl+8:]; prim=d["meshes"][0]["primitives"][0]
    def vals(ai, fmt):
        a=d["accessors"][ai]; v=d["bufferViews"][a["bufferView"]]; raw=blob[v.get("byteOffset",0):v.get("byteOffset",0)+v["byteLength"]]
        return [x for x in struct.iter_unpack(fmt,raw)]
    p=vals(prim["attributes"]["POSITION"],"<3f"); t=vals(prim["targets"][0]["POSITION"],"<3f"); n=vals(prim["attributes"]["NORMAL"],"<3f"); c=vals(prim["attributes"]["COLOR_0"],"<4f"); iv=d["bufferViews"][d["accessors"][prim["indices"]]["bufferView"]]; raw=blob[iv.get("byteOffset",0):iv.get("byteOffset",0)+iv["byteLength"]]; idx=[x[0] for x in struct.iter_unpack("<I",raw)]
    # Morph targets are deltas per glTF 2.0; use all three position axes.
    return [(p[i][0]+weight*t[i][0], p[i][1]+weight*t[i][1], p[i][2]+weight*t[i][2]) for i in range(len(p))], n, c, idx
def render(weight, out):
    p,n,c,idx=load(weight); im=Image.new("RGB",(SIZE,SIZE),(235,233,234)); draw=ImageDraw.Draw(im)
    def proj(v):
        # fixed 3/4 orthographic camera so thickness and ochre edges remain visible
        sx = 0.94*v[0] + 0.34*v[2]; sy = 0.94*v[1] - 0.34*v[2]
        return (int(SIZE/2 + sx*48), int(SIZE*0.54 - sy*48))
    tris=[]
    for k in range(0,len(idx),3):
        ids=idx[k:k+3]; depth=sum(p[i][2] for i in ids)/3; light=max(0.25,0.7+0.25*n[ids[0]][2]); col=tuple(min(255,int(c[ids[0]][j]*255*light)) for j in range(3)); tris.append((depth,ids,col))
    for _,ids,col in sorted(tris): draw.polygon([proj(p[i]) for i in ids],fill=col)
    im.save(out)
for w,name in ((1.0,"cutline-rest-snapshot.png"),(0.0,"cutline-bent-snapshot.png")):
    render(w,ROOT/name)
print("rendered cutline-rest-snapshot.png cutline-bent-snapshot.png")
