#!/usr/bin/env python3
"""Proof the validator dereferences primitive accessors (intentional failure)."""
import subprocess, tempfile
from pathlib import Path

src = Path(__file__).with_name("cutline-ribbon-fallback.glb"); raw = src.read_bytes()
bad = raw.replace(b'"POSITION":3', b'"POSITION":9', 1)
with tempfile.NamedTemporaryFile(suffix=".glb") as f:
    f.write(bad); f.flush()
    result = subprocess.run(["python3", str(Path(__file__).with_name("validate_cutline_glb.py")), f.name], capture_output=True, text=True)
    assert result.returncode != 0, result.stdout
print("corruption test: validator rejected out-of-range primitive POSITION accessor")
