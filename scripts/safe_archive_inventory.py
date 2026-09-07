#!/usr/bin/env python3
"""Read-only ZIP inventory with extraction safety checks."""
from __future__ import annotations

import argparse
import hashlib
import json
import stat
import re
import sys
import zipfile
from pathlib import PurePosixPath


MAX_ENTRIES = 10000
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_ENTRY_BYTES = 512 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100

def inspect(path: str, verify_crc: bool = True) -> dict:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        bad_names, symlinks, executable_files, manual_review = [], [], [], []
        normalized = set()
        uncompressed = 0
        max_ratio = 0.0
        max_ratio_name = None
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            parts = PurePosixPath(name).parts
            mode = (entry.external_attr >> 16) & 0xFFFF
            if name.startswith("/") or ".." in parts or re.match(r"^[A-Za-z]:/", name):
                bad_names.append(name)
            clean = str(PurePosixPath(name))
            if clean in normalized: bad_names.append(f"duplicate:{name}")
            normalized.add(clean)
            if stat.S_ISLNK(mode):
                symlinks.append(name)
            if not name.endswith("/"):
                uncompressed += entry.file_size
                if mode & 0o111 or name.lower().endswith((".exe", ".dylib", ".so", ".bin", ".command")):
                    if ".git/hooks/" in name and name.endswith(".sample"): manual_review.append(name)
                    else: executable_files.append(name)
                if entry.compress_size:
                    ratio = entry.file_size / entry.compress_size
                    if ratio > max_ratio:
                        max_ratio, max_ratio_name = ratio, name
        unsafe = bool(bad_names or symlinks or executable_files or len(entries) > MAX_ENTRIES or uncompressed > MAX_TOTAL_BYTES or max_ratio > MAX_COMPRESSION_RATIO or any(i.file_size > MAX_ENTRY_BYTES for i in entries))
        if unsafe:
            raise ValueError(f"unsafe archive metadata: paths={len(bad_names)} symlinks={len(symlinks)} executables={len(executable_files)} entries={len(entries)} bytes={uncompressed} ratio={max_ratio:.1f}")
        bad_crc = None
        if verify_crc:
            bad_crc = archive.testzip()
            if bad_crc is not None:
                raise ValueError(f"archive CRC failed: {bad_crc}")
        return {
            "path": path,
            "sha256": digest.hexdigest(),
            "entries": len(entries),
            "uncompressed_bytes": uncompressed,
            "path_traversal_or_absolute": bad_names,
            "symlinks": symlinks,
            "executable_like_files": executable_files,
            "manual_review_files": manual_review,
            "max_compression_ratio": max_ratio,
            "max_compression_ratio_entry": max_ratio_name,
            "zip_test": "passed" if verify_crc else "not_run",
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archives", nargs="+")
    args = parser.parse_args()
    results = []
    try:
        for archive in args.archives: results.append(inspect(archive))
    except (OSError, zipfile.BadZipFile, ValueError) as exc:
        print(json.dumps({"status": "rejected", "error": str(exc)}, indent=2))
        raise SystemExit(2)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
