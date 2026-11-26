"""Loop 1 targeted check: compare each upload's visible header with manifest metadata.
Run from the dataset directory: python qa/header_audit.py"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v
from pypdf import PdfReader

AUDIENCE = {"ar": {"courier": "إلى: مندوب التوصيل", "employee": "إلى: موظف الشركة", "partner": "إلى: موظف المطعم الشريك"},
            "en": {"courier": "To: Courier", "employee": "To: Company employee", "partner": "To: Partner restaurant staff"}}

def lines_of(doc):
    path, fmt = v.ROOT / doc["path"], doc["format"]
    if doc["variant"] == "scan":
        t = v.load(f"dev/gold/transcriptions/{doc['document_id']}.json")
        return [l for p in t["pages"] for l in p["lines"]]
    if fmt == "docx": return v.word_text(path, doc["language"])[0]
    if fmt == "pdf": return [l for pg in PdfReader(path).pages for l in (pg.extract_text() or "").splitlines()]
    return path.read_text(encoding="utf-8").splitlines()

def main():
    docs = v.load("manifest.json")["documents"]; problems = 0
    for d in docs:
        ls = [l.strip() for l in lines_of(d) if l.strip()][:5]
        meta = ls[2]; aud = ls[3]
        parts = [p.strip() for p in meta.split("|")]
        org_ok = parts[0] == d["organization_local"]
        if d["language"] == "ar":
            branch_text, ver_text = parts[1].removeprefix("فرع "), parts[2].removeprefix("الإصدار ")
        else:
            branch_text, ver_text = parts[1].removesuffix(" branch"), parts[2].removeprefix("Version ")
        branch_expected = d.get("branch_local", d["branch"]) if d["language"] == "ar" else d["branch"]
        checks = {"org": org_ok, "branch": branch_text == branch_expected or "branch_local" not in d and d["language"] == "ar",
                  "version": ver_text == str(d["version"]), "audience": aud == AUDIENCE[d["language"]][d["role"]]}
        status = "ok" if all(checks.values()) else "MISMATCH"
        problems += status != "ok"
        print(f"{status:8} {d['document_id']:34} branch_in_header={branch_text!r} manifest_branch={d['branch']!r} "
              f"branch_local={d.get('branch_local')!r} version={ver_text} audience_ok={checks['audience']}")
    unverifiable = sum(d["language"] == "ar" and "branch_local" not in d for d in docs)
    print(f"\n{problems} mismatch(es); {unverifiable} Arabic header branch(es) cannot be checked against the manifest (no branch_local).")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main())
