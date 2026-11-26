"""RTL audit for DOCX, modelled on the documented checks of asadeisa/arabic-office-skills audit_docx (MIT).
Usage: python qa/rtl_audit.py dev/uploads/*.docx held_out/uploads/*.docx
Errors (exit 1): Arabic paragraph without w:bidi, Arabic run without w:rtl, bold/size without bCs/szCs,
Arabic table without w:bidiVisual, presentation-form glyphs.
Warnings (reported, exit 0): jc=left in a bidi paragraph and a section without w:bidi. Word renders both
correctly (start alignment, verified by rendering), but other renderers may not."""
WARN = ("jc=left", "sectPr without")
import re, sys, zipfile
from xml.etree import ElementTree as ET
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
AR = re.compile(r"[\u0600-\u06FF]")
PRESENTATION = re.compile(r"[\uFB50-\uFDFF\uFE70-\uFEFF]")
def audit(path):
    z = zipfile.ZipFile(path); root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body"); issues = []
    for i, p in enumerate(body.iter(W + "p")):
        text = "".join(t.text or "" for t in p.iter(W + "t"))
        if not AR.search(text): continue
        ppr = p.find(W + "pPr")
        if ppr is None or ppr.find(W + "bidi") is None: issues.append(f"p{i}: Arabic paragraph without w:bidi: {text[:30]}")
        jc = ppr.find(W + "jc") if ppr is not None else None
        if jc is not None and jc.get(W + "val") in ("left",): issues.append(f"p{i}: jc=left in RTL paragraph")
        for r in p.iter(W + "r"):
            rt = "".join(t.text or "" for t in r.iter(W + "t"))
            if not rt.strip(): continue
            rpr = r.find(W + "rPr")
            has = lambda tag: rpr is not None and rpr.find(W + tag) is not None
            if AR.search(rt) and not has("rtl"): issues.append(f"p{i}: Arabic run without w:rtl: {rt[:20]}")
            if has("b") and not has("bCs") and AR.search(rt): issues.append(f"p{i}: bold without w:bCs: {rt[:20]}")
            if has("sz") and not has("szCs") and AR.search(rt): issues.append(f"p{i}: w:sz without w:szCs: {rt[:20]}")
        if PRESENTATION.search(text): issues.append(f"p{i}: pre-shaped presentation forms")
    for k, tbl in enumerate(body.iter(W + "tbl")):
        if AR.search("".join(t.text or "" for t in tbl.iter(W + "t"))) and tbl.find(f"{W}tblPr/{W}bidiVisual") is None:
            issues.append(f"table{k}: Arabic table without w:bidiVisual")
    for s in body.iter(W + "sectPr"):
        if s.find(W + "bidi") is None: issues.append("sectPr without w:bidi")
    digits = {"arabic_indic": len(re.findall(r"[\u0660-\u0669]", "".join(t.text or "" for t in root.iter(W + "t")))),
              "ascii": len(re.findall(r"[0-9]", "".join(t.text or "" for t in root.iter(W + "t"))))}
    return issues, digits
if __name__ == "__main__":
    bad = 0
    for f in sys.argv[1:]:
        issues, digits = audit(f)
        errors = [x for x in issues if not any(w in x for w in WARN)]
        print(f"{f}: {len(errors)} error(s), {len(issues) - len(errors)} warning(s); digits {digits}")
        for x in errors[:12]: print("    ERROR", x)
        bad += len(errors)
    sys.exit(1 if bad else 0)
