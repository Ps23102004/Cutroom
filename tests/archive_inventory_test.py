import stat, subprocess, sys, zipfile
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts/safe_archive_inventory.py"

def make(path, name="ok.txt", data=b"ok", mode=0):
    info = zipfile.ZipInfo(name); info.external_attr = mode << 16
    with zipfile.ZipFile(path, "w") as z: z.writestr(info, data)

def check(path, expected):
    p = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True)
    assert (p.returncode == 0) is expected, p.stdout.decode() + p.stderr.decode()

def test_safe_archive(tmp_path):
    p=tmp_path/"safe.zip"; make(p); check(p, True)

def test_reject_paths_and_symlink(tmp_path):
    for i,n in enumerate(("../escape", "/absolute", "C:/drive")):
        p=tmp_path/f"bad{i}.zip"; make(p,n); check(p, False)
    p=tmp_path/"link.zip"; make(p,"link",b"x",stat.S_IFLNK|0o777); check(p, False)

def test_reject_normalized_duplicate(tmp_path):
    p=tmp_path/"duplicate.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("a/../same.txt", b"one")
        z.writestr("same.txt", b"two")
    check(p, False)

def test_reject_corrupt_payload_crc(tmp_path):
    p = tmp_path / "corrupt.zip"
    make(p, data=b"unique-crc-payload")
    raw = p.read_bytes()
    assert raw.count(b"unique-crc-payload") == 1
    p.write_bytes(raw.replace(b"unique-crc-payload", b"broken-crc-payload"))
    check(p, False)
