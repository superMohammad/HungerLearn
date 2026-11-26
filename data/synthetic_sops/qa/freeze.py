"""Write FREEZE.sha256: the SHA-256 of every frozen data file (manifest, uploads, gold labels).

validate.py verifies this list whenever FREEZE.sha256 exists, so any edit to a frozen file, or an added or
removed data file, fails validation until the change is reviewed and the freeze is regenerated on purpose:

    python qa/freeze.py && python validate.py
"""
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def frozen_files(root):
    files = [root / "manifest.json"]
    for split in ("dev", "held_out"):
        files += sorted(p for p in (root / split).rglob("*") if p.is_file())
    return files


def digest_lines(root):
    return [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(root).as_posix()}" for p in frozen_files(root)]


if __name__ == "__main__":
    lines = digest_lines(ROOT)
    (ROOT / "FREEZE.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"froze {len(lines)} files into FREEZE.sha256")
    sys.exit(0)
