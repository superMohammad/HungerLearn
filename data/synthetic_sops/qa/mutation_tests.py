"""Seeded-error tests: copy the dataset to a temp folder, inject one known error, and confirm
validate.py rejects it. Run from the dataset directory: python qa/mutation_tests.py [name ...]
Exit code 1 if any mutation is NOT caught."""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def jedit(path, fn):
    data = json.loads(path.read_text(encoding="utf-8")); fn(data)
    path.write_bytes((json.dumps(data, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n").encode())

def doc(m, doc_id):
    return next(d for d in m["documents"] if d["document_id"] == doc_id)

def clause(rows, doc_id, cid):
    return next(c for r in rows if r["document_id"] == doc_id for c in r["clauses"] if c["clause_id"] == cid)

MUTATIONS = {}
def mutation(loop, catches):
    def deco(fn):
        MUTATIONS[fn.__name__] = (loop, catches, fn); return fn
    return deco

# Loop 1 — metadata
@mutation(1, "manifest branch disagrees with the branch printed in the SOP header")
def wrong_branch(r):
    jedit(r / "manifest.json", lambda m: doc(m, "courier-failed-handoff-v1").update(branch="Papaya Bend", branch_local="Papaya Bend"))

@mutation(1, "Arabic branch name in the manifest disagrees with the Arabic header")
def wrong_branch_local(r):
    jedit(r / "manifest.json", lambda m: doc(m, "courier-damaged-package-v1").update(branch_local="منعطف البابايا"))

# Loop 2 — English SOP wording
def replace_everywhere(r, rel_upload, old, new, gold="dev/gold/extraction.json"):
    up = r / rel_upload
    up.write_bytes(up.read_bytes().decode("utf-8").replace(old, new).encode("utf-8"))
    g = r / gold
    g.write_bytes(g.read_bytes().decode("utf-8").replace(old, new).encode("utf-8"))

@mutation(2, "a wait threshold that never says when its timer starts (source and gold consistent)")
def unanchored_timer(r):
    replace_everywhere(r, "dev/uploads/partner-item-substitution-v1-en.txt",
                       "has not answered 7 minutes after you send the request", "has not answered after 7 minutes")

# Loop 3 — Arabic digit fidelity
def docx_replace(path, old, new):
    import zipfile
    with zipfile.ZipFile(path) as z:
        items = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for info, data in items:
            if info.filename == "word/document.xml":
                text = data.decode("utf-8"); assert old in text; data = text.replace(old, new).encode("utf-8")
            z.writestr(info, data)

@mutation(3, "Arabic-Indic digits silently rewritten as ASCII in source and quote (glyph loss)")
def digit_glyph_loss(r):
    docx_replace(r / "dev/uploads/employee-duplicate-charge-v1-ar.docx", "لمدة ٢٤ ساعة", "لمدة 24 ساعة")
    g = r / "dev/gold/extraction.json"
    g.write_bytes(g.read_bytes().decode("utf-8").replace("لمدة ٢٤ ساعة", "لمدة 24 ساعة").encode("utf-8"))

# Loop 4 — extraction facts
@mutation(4, "a facts label copied verbatim (in Arabic) from the quote instead of normalized")
def copied_facts(r):
    def go(rows):
        for rec in rows:
            if rec["document_id"] == "employee-duplicate-charge-v1":
                c = next(c for c in rec["clauses"] if c["clause_id"] == "EC-15")
                c["facts"]["trigger"] = "إذا أظهر السجل دفعة نقدية وأخرى إلكترونية للطلب نفسه"
    jedit(r / "dev/gold/extraction.json", go)

@mutation(4, "an exception that points at a clause the document does not contain")
def dangling_exception(r):
    jedit(r / "held_out/gold/extraction.json",
          lambda rows: clause(rows, "employee-complaint-escalation-v1", "EG-14")["facts"].update(exception_to="EG-99"))

@mutation(4, "an explicit prohibition (ولا ترفع طلب استرداد ثانياً) dropped from the facts")
def dropped_negation(r):
    jedit(r / "dev/gold/extraction.json",
          lambda rows: clause(rows, "employee-duplicate-charge-v1", "EC-13")["facts"].pop("negation"))

# Loop 5 — scans
def rewrite_png(r, fn):
    from PIL import Image
    p = r / "dev/uploads/employee-delayed-order-v1-scan-en.png"
    img = Image.open(p); img.load(); fn(img, p)
    t = r / "dev/gold/transcriptions/employee-delayed-order-v1-scan.json"
    import hashlib
    jedit(t, lambda d: d.update(scan_sha256=hashlib.sha256(p.read_bytes()).hexdigest()))  # keep hash consistent

@mutation(5, "scan downsampled to ~118 dpi (still >=1000 px, too coarse for reliable OCR)")
def low_resolution_scan(r):
    rewrite_png(r, lambda img, p: img.resize((1003, int(img.height * 1003 / img.width))).save(p))

@mutation(5, "PNG scan carrying hidden text in an EXIF block instead of a tEXt chunk")
def exif_hidden_text(r):
    def go(img, p):
        exif = img.getexif(); exif[0x010E] = "Escalate a stalled status after 8 minutes"  # ImageDescription
        img.save(p, exif=exif)
    rewrite_png(r, go)

# Loop 6 — retrieval
@mutation(6, "a v2-scoped query that no longer lists the identical v1 rule, so the version filter goes untested")
def missing_version_distractor(r):
    def go(rows):
        q = next(q for q in rows if q["query_id"] == "dev-courier-03")
        q["wrong_matches"] = [w for w in q["wrong_matches"] if w["document_id"] != "courier-pickup-wait-v1"]
    jedit(r / "dev/gold/retrieval.json", go)

@mutation(6, "a retrieval target pointing at the superseded version (stale-version label)")
def stale_retrieval_target(r):
    def go(rows):
        q = next(q for q in rows if q["query_id"] == "dev-courier-01")
        q["expected"] = [{"document_id": "courier-pickup-wait-v1", "clause_id": "CW-02"}]
    jedit(r / "dev/gold/retrieval.json", go)

# Loop 7 — version diffs
def diff_entry(rows, to_doc, cid):
    return next(e for d in rows if d["to_document_id"] == to_doc for e in d["clauses"] if e["clause_id"] == cid)

@mutation(7, "CW-02 change recorded with the wrong new threshold (15 -> 15 instead of 15 -> 10)")
def wrong_threshold_change(r):
    jedit(r / "dev/gold/version_diffs.json", lambda rows: diff_entry(rows, "courier-pickup-wait-v2", "CW-02")
          ["changed_facts"]["threshold"]["after"].update(value=15, printed_value="١٥"))

@mutation(7, "low-similarity PP-02 rewrite labelled as an easy text match")
def overstated_match_basis(r):
    jedit(r / "dev/gold/version_diffs.json",
          lambda rows: diff_entry(rows, "partner-packing-sealing-v2", "PP-02").update(match_basis="similar_text"))

@mutation(7, "changed rule (CW-02) mislabelled unchanged, so nobody is reassessed")
def missed_rule_change(r):
    def go(rows):
        d = next(d for d in rows if d["to_document_id"] == "courier-pickup-wait-v2")
        e = diff_entry(rows, "courier-pickup-wait-v2", "CW-02")
        e.update(change="unchanged"); e.pop("changed_facts"); e["training_item"]["decision"] = "remains_valid"
        d["reassessment_clause_ids"] = []
    jedit(r / "dev/gold/version_diffs.json", go)

# Loop 8 — assessments
def case(rows, cid):
    return next(c for c in rows if c["case_id"] == cid)

@mutation(8, "scenario no longer reaches the cited threshold (4 minutes on a 6-minute rule)")
def scenario_below_threshold(r):
    def go(rows):
        c = case(rows, "A-C2"); c["scenario"] = c["scenario"].replace("Seven minutes", "Four minutes").replace("Six minutes", "Four minutes")
    jedit(r / "dev/gold/assessments.json", go)

@mutation(8, "remediation skips a rule the wrong answer breaks (door drop without authorization)")
def incomplete_remediation(r):
    jedit(r / "dev/gold/assessments.json", lambda rows: case(rows, "A-C2")["wrong_answer"].update(practice_items=["training-ch-02"]))

@mutation(8, "CW-02 case set at 16 minutes, so v1 and v2 give the same answer and the update is untested")
def non_discriminating_case(r):
    def go(rows):
        c = case(rows, "A-C1"); c["scenario"] = c["scenario"].replace("قبل 12 دقيقة", "قبل 16 دقيقة").replace("قبل 10 دقائق", "قبل 16 دقيقة")
    jedit(r / "dev/gold/assessments.json", go)

# Loop 9 — approval gates and learner routing
def gate(rows, gid):
    return next(g for g in rows if g["gate_id"] == gid)

@mutation(9, "'more than 10 minutes' draft (excludes the 10-minute mark) allowed through the gate")
def strict_operator_allowed(r):
    jedit(r / "dev/gold/publication_gates.json",
          lambda rows: gate(rows, "G-04").update(reason_code="supported", expected_decision="allow_trainer_review"))

@mutation(9, "draft citing the superseded v1 rule allowed through the gate")
def superseded_citation_allowed(r):
    jedit(r / "dev/gold/publication_gates.json",
          lambda rows: gate(rows, "G-06").update(reason_code="supported", expected_decision="allow_trainer_review"))

@mutation(9, "learner who mastered the same family at another branch is sent to reassessment")
def out_of_branch_reassessed(r):
    def go(rows):
        d = next(d for d in rows if d["to_document_id"] == "courier-pickup-wait-v2")
        next(i for i in d["learner_impacts"] if i["learner_id"] == "HL-105")["expected_action"] = "reassess"
    jedit(r / "dev/gold/version_diffs.json", go)

@mutation(9, "partner update loses its only in-progress learner, so assignment repointing goes untested")
def routing_gap(r):
    jedit(r / "dev/gold/learners.json", lambda d: d.update(learners=[l for l in d["learners"] if l["learner_id"] != "HL-303"]))
    def go(rows):
        for d in rows:
            d["learner_impacts"] = [i for i in d["learner_impacts"] if i["learner_id"] != "HL-303"]
    jedit(r / "dev/gold/version_diffs.json", go)

# Loop 10 — leakage and freeze
@mutation(10, "a gold clause ID leaked into an upload's audience line (no quote or scope check covers it)")
def label_leak_in_text(r):
    p = r / "dev/uploads/employee-delayed-order-v2-en.txt"
    p.write_bytes(p.read_bytes().replace(b"To: Company employee", b"To: Company employee (rules ED-01 to ED-16)"))

@mutation(10, "a gold label hidden in DOCX document properties")
def label_leak_in_metadata(r):
    import zipfile
    p = r / "dev/uploads/employee-duplicate-charge-v1-ar.docx"
    with zipfile.ZipFile(p) as z:
        items = [(i, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(p, "w") as z:
        for info, data in items:
            if info.filename == "docProps/core.xml":
                data = data.replace(b"</cp:coreProperties>", b"<cp:keywords>EC-02 A-E2</cp:keywords></cp:coreProperties>")
            z.writestr(info, data, compress_type=info.compress_type)

@mutation(10, "a frozen label edited after the freeze in a way no other check notices (distractor reason)")
def freeze_tamper(r):
    def go(rows):
        rows[0]["wrong_matches"][0]["reason"] = "edited after freeze"
    jedit(r / "dev/gold/retrieval.json", go)

# Change-pair fixtures (added after loop 10)
def pair(rows, pid):
    return next(p for p in rows if p["pair_id"] == pid)

@mutation(11, "a 6 -> 4 minute threshold change mislabelled as a harmless rewording")
def threshold_called_wording(r):
    jedit(r / "dev/gold/change_pairs.json", lambda rows: pair(rows, "CP-DEV-T05").update(
        change_type="wording", material=False, severity="low", expected_handling="refresh_text", evidence={}))

@mutation(11, "a 'wording' pair whose new text slips in a new time limit")
def wording_adds_number(r):
    jedit(r / "dev/gold/change_pairs.json", lambda rows: pair(rows, "CP-DEV-W01").update(
        after=pair(rows, "CP-DEV-W01")["after"].replace("to every case.", "to every case within 12 minutes.")))

@mutation(11, "allergy-check modality change (safety-tagged) downgraded to medium severity")
def safety_severity_downgraded(r):
    jedit(r / "dev/gold/change_pairs.json", lambda rows: pair(rows, "CP-DEV-M09").update(severity="medium"))

@mutation(11, "held-out change pair built on a development clause (split leak)")
def held_out_pair_from_dev(r):
    jedit(r / "held_out/gold/change_pairs.json", lambda rows: pair(rows, "CP-HO-W02").update(
        base={"document_id": "employee-delayed-order-v2", "clause_id": "ED-10"}))

@mutation(11, "change pair whose 'before' text drifted from the gold quote")
def before_text_drift(r):
    jedit(r / "dev/gold/change_pairs.json", lambda rows: pair(rows, "CP-DEV-A01").update(
        before=pair(rows, "CP-DEV-A01")["before"].replace("late order", "delayed order")))

# Loop 12 — v3 uploads (long SOPs rendered to PDF, DOCX and TXT in both languages)
def v3_row(rows, doc_id):
    return next(r for r in rows if r["document_id"] == doc_id)

@mutation(12, "a v3 rule quote in the gold that is not a numbered rule line in the upload")
def v3_quote_drift(r):
    # Every Arabic v3 label drifts together, so only the comparison with the upload text can catch it.
    def go(rows):
        for doc_id in ("courier-pickup-wait-v3", "courier-pickup-wait-v3-ar-pdf", "courier-pickup-wait-v3-ar-txt"):
            c = clause(rows, doc_id, "CW-24"); c["quote"] = c["quote"].replace("20 دقيقة", "25 دقيقة")
    jedit(r / "dev/gold/extraction.json", go)

@mutation(12, "an English v3 PDF quote with its words reordered")
def v3_en_pdf_word_order(r):
    # The same words in another order pass a word-bag check; English PDFs must match as written.
    def go(rows):
        c = clause(rows, "courier-pickup-wait-v3-en-pdf", "CW-24")
        c["quote"] = c["quote"].replace("phone dispatch. Do not rely", "phone dispatch. Rely do not")
    jedit(r / "dev/gold/extraction.json", go)

@mutation(12, "an Arabic v3 translation PDF whose quote disagrees with its DOCX and TXT")
def v3_translation_disagrees(r):
    # Arabic PDFs are checked by words, so a reordered quote is caught only against the other Arabic translations.
    def go(rows):
        c = next(c for c in v3_row(rows, "employee-delayed-order-v3-ar-pdf")["clauses"] if len(c["quote"].split()) > 3)
        words = c["quote"].split()
        c["quote"] = " ".join([words[1], words[0], *words[2:]])
    jedit(r / "dev/gold/extraction.json", go)

@mutation(12, "a v3 Arabic PDF rule cited on the wrong page")
def v3_pdf_wrong_page(r):
    def go(rows):
        clause(rows, "courier-pickup-wait-v3-ar-pdf", "CW-02")["locator"].update(page=2)
        row = v3_row(rows, "courier-pickup-wait-v3-ar-pdf")
        next(p for p in row["procedures"] if p["clause_ids"][0] == "CW-02")["locator"].update(page=2)
    jedit(r / "dev/gold/extraction.json", go)

@mutation(12, "a v3 translation whose facts drift from the original")
def v3_translation_facts(r):
    jedit(r / "dev/gold/extraction.json", lambda rows: clause(rows, "courier-pickup-wait-v3-en-txt", "CW-02")["facts"]
          ["threshold"].update(value=10, printed_value="10"))

@mutation(12, "a v3 copy that no longer points at its original")
def v3_copy_without_source(r):
    jedit(r / "manifest.json", lambda m: doc(m, "courier-pickup-wait-v3-ar-pdf").pop("source_document_id"))

@mutation(12, "a changed v3 rule labelled unchanged in the v2 -> v3 diff")
def v3_wrong_diff_label(r):
    def go(rows):
        update = next(u for u in rows if u["to_document_id"] == "courier-pickup-wait-v3")
        entry = next(e for e in update["clauses"] if e["clause_id"] == "CW-02")
        entry["change"] = "unchanged"
    jedit(r / "dev/gold/version_diffs.json", go)

@mutation(12, "a retrieval query that drops the v3 copy of its answer from the distractors")
def v3_missing_distractor(r):
    def go(rows):
        q = next(q for q in rows if q["query_id"] == "dev-courier-04")
        q["wrong_matches"] = [w for w in q["wrong_matches"] if w["document_id"] != "courier-pickup-wait-v3"]
    jedit(r / "dev/gold/retrieval.json", go)

@mutation(12, "a gate still citing v2 as current after v3 superseded it")
def v3_stale_gate(r):
    jedit(r / "dev/gold/publication_gates.json", lambda rows: next(g for g in rows if g["gate_id"] == "G-01")["citation"]
          .update(document_id="courier-pickup-wait-v2", locator={"section": "٢. تأخر التجهيز", "table_row": 3}))

KEEPS_FREEZE = {"freeze_tamper"}  # every other mutation runs on an unfrozen copy so its own check is what fires

# Mutations for later loops are appended below this line.

def run(names):
    missed = skipped = 0
    for name in names:
        loop, catches, fn = MUTATIONS[name]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "synthetic_sops"
            shutil.copytree(ROOT, root, ignore=shutil.ignore_patterns("qa", "__pycache__"))
            freeze = root / "FREEZE.sha256"
            if name in KEEPS_FREEZE and not freeze.exists():
                print(f"SKIP     {name}: dataset is not frozen yet (run qa/freeze.py)"); skipped += 1; continue
            if name not in KEEPS_FREEZE and freeze.exists():
                freeze.unlink()
            fn(root)
            res = subprocess.run([sys.executable, "-I", str(root / "validate.py")], capture_output=True, text=True,
                                 encoding="utf-8", errors="replace")
        caught = res.returncode != 0
        missed += not caught
        msg = (res.stderr or res.stdout).strip().splitlines()[-1] if caught else "validator PASSED the corrupted data"
        print(f"{'CAUGHT' if caught else 'MISSED'} loop {loop:>2} {name}: {catches}\n         -> {msg}")
    tested = len(names) - skipped
    print(f"\n{tested - missed}/{tested} seeded errors caught" + (f" ({skipped} skipped)" if skipped else ""))
    return 1 if missed else 0

if __name__ == "__main__":
    sys.exit(run(sys.argv[1:] or list(MUTATIONS)))
