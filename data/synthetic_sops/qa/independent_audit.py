"""Loop 10 independent audit: recheck sources and labels with different parsers from validate.py.

* PDFs are read with pdfplumber (validate.py uses pypdf); DOCX with python-docx (validate.py walks raw XML);
  TXT from raw bytes; scans from their reference transcriptions.
* Every gold quote and section heading must be found in that independent text (whitespace-insensitive).
* No gold label may leak into an upload: clause IDs, training item IDs, assessment case IDs, gate IDs, or
  learner IDs in body text, DOCX core/app properties, or PDF metadata.
* Every dependent reference (retrieval, assessments, diffs, gates, flagged draft, learners) must resolve.
Requires pdfplumber and python-docx. Run from the dataset directory: python qa/independent_audit.py
"""
import json
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path

import docx
import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
LABEL = re.compile(r"\b(?:CW|CH|CD|ED|EC|EG|PP|PS|PV)-\d{2}\b|training-[a-z]{2}-\d{2}|\bA-[CEP]\d\b|\bG-\d{2}\b|\bHL-\d{3}\b")


def load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def compact(text):
    return " ".join(text.split())


def word_bag(text):
    # v3 PDFs: a right-to-left text layer comes out in visual run order, so compare words, not strings. Written here
    # rather than imported, so this audit stays independent of validate.py.
    folded = re.sub(r"[ً-ْـ]", "", unicodedata.normalize("NFKC", text)).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).lower()
    return Counter("".join(sorted(w)) if w.isdigit() else w for w in re.findall(r"[^\W\d_]+|\d+", folded))


def independent_text(doc):
    path = ROOT / doc["path"]
    meta = ""
    if doc["variant"] == "scan":
        t = load(f"dev/gold/transcriptions/{doc['document_id']}.json")
        return "\n".join(p["text"] for p in t["pages"]), meta
    if doc["format"] == "pdf":
        with pdfplumber.open(path) as pdf:
            body = "\n".join(page.extract_text() or "" for page in pdf.pages)
        meta = json.dumps({k: str(v) for k, v in (PdfReader(path).metadata or {}).items()})
        return body, meta
    if doc["format"] == "docx":
        d = docx.Document(path)
        parts = [p.text for p in d.paragraphs]
        for table in d.tables:
            for row in table.rows:
                parts.extend(cell.text for cell in row.cells)
        with zipfile.ZipFile(path) as z:
            meta = " ".join(z.read(n).decode("utf-8", "replace") for n in ("docProps/core.xml", "docProps/app.xml") if n in z.namelist())
        return "\n".join(parts), meta
    return path.read_bytes().decode("utf-8"), meta


def main():
    docs = {d["document_id"]: d for d in load("manifest.json")["documents"]}
    extraction = {r["document_id"]: r for s in ("dev", "held_out") for r in load(f"{s}/gold/extraction.json")}
    problems, quotes, skipped_quotes = [], 0, 0
    for doc_id, doc in docs.items():
        body, meta = independent_text(doc)
        flat = compact(body).replace("[ ] ", "")
        for hit in set(LABEL.findall(body + " " + meta)):
            problems.append(f"{doc_id}: gold label '{hit}' appears in the upload")
        if doc["version"] == 3 and doc["format"] == "pdf" and doc["language"] == "ar":
            # pdfplumber returns this Chrome-printed Arabic text in visual order with letters reversed and words split
            # at diacritics; pypdfium2 and PyMuPDF break it too. validate.py's pypdf word check is the only reader
            # that recovers it, so this audit rechecks only for leaked labels here and reports the skip.
            skipped_quotes += len(extraction[doc_id]["clauses"])
            continue
        if doc["version"] == 3 and doc["format"] == "pdf":
            bag = word_bag(body)
            found = lambda text, bag=bag: word_bag(text) <= bag
        else:
            found = lambda text, flat=flat: compact(text) in flat
        for clause in extraction[doc_id]["clauses"]:
            quotes += 1
            if not found(clause["quote"]):
                problems.append(f"{doc_id}/{clause['clause_id']}: quote not found by independent parser")
            if not found(clause["locator"]["section"]):
                problems.append(f"{doc_id}/{clause['clause_id']}: section heading not found")
    ids = {(d, c["clause_id"]) for d, r in extraction.items() for c in r["clauses"]}
    refs = []
    for s in ("dev", "held_out"):
        for q in load(f"{s}/gold/retrieval.json"):
            refs += [(f"retrieval {q['query_id']}", r["document_id"], r["clause_id"]) for r in q["expected"] + q["wrong_matches"]]
    for c in load("dev/gold/assessments.json"):
        refs += [(f"assessment {c['case_id']}", c["document_id"], x) for x in c["supporting_clause_ids"]]
    for g in load("dev/gold/publication_gates.json"):
        refs.append((f"gate {g['gate_id']}", g["citation"]["document_id"], g["citation"]["clause_id"]))
    f = load("dev/gold/flagged_draft.json")
    refs.append(("flagged draft", f["citation"]["document_id"], f["citation"]["clause_id"]))
    for d in load("dev/gold/version_diffs.json"):
        for e in d["clauses"]:
            for doc_id in (d["from_document_id"], d["to_document_id"]):
                if (doc_id, e["clause_id"]) in ids:
                    break
            else:
                problems.append(f"diff {d['to_document_id']}/{e['clause_id']}: clause in neither version")
    problems += [f"{where}: unresolved citation {d}/{c}" for where, d, c in refs if (d, c) not in ids]
    learners = {l["learner_id"] for l in load("dev/gold/learners.json")["learners"]}
    for d in load("dev/gold/version_diffs.json"):
        if {i["learner_id"] for i in d["learner_impacts"]} != learners:
            problems.append(f"diff {d['to_document_id']}: learner impacts do not match learners.json")
    print(f"{len(docs)} uploads, {quotes} quotes rechecked with independent parsers, {len(refs)} references resolved")
    if skipped_quotes:
        print(f"{skipped_quotes} quotes in Arabic v3 PDFs not rechecked: no independent parser reads their text layer")
    print("\n".join(problems) or "no problems found")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
