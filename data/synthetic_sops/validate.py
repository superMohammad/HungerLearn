"""Validate HungerLearn's upload corpus and gold fixtures without running models."""

import json
import re
import sys
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream


ROOT = Path(__file__).resolve().parent
ROLES = ("courier", "employee", "partner")
SPLITS = ("dev", "held_out")
MARKERS = {"ar": "بيانات تدريب اصطناعية", "en": "Synthetic training data"}
EXTENSIONS = {"pdf": ".pdf", "image_pdf": ".pdf", "docx": ".docx", "txt": ".txt", "png": ".png"}
SCOPE_FIELDS = ("role", "organization", "document_family")
W = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def check(condition, message):
    if not condition:
        raise ValueError(message)


def load(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def indexed(rows, key):
    by_key = {row[key]: row for row in rows}
    check(len(by_key) == len(rows), f"Duplicate {key}")
    return by_key


def fields(row, names):
    return {key: row[key] for key in names}


def compact(text):
    # PDF line wrapping and TXT/DOCX line separators are layout whitespace.
    return " ".join(text.split())


def files_in(directory):
    return {p.relative_to(ROOT).as_posix() for p in (ROOT / directory).rglob("*") if p.is_file()}


def validate_manifest():
    manifest = load("manifest.json")
    docs = indexed(manifest["documents"], "document_id")
    paths = indexed(manifest["documents"], "path")
    check(manifest["schema_version"] == 2, "Unsupported manifest schema")
    check(len(docs) == 15, f"Found {len(docs)} manifest documents, expected 15")
    check(set(paths) == set.union(*(files_in(f"{split}/uploads") for split in SPLITS)),
          "Manifest paths differ from upload files on disk")
    check({d["format"] for d in docs.values()} == set(EXTENSIONS), "All five formats must be present")
    family_groups = defaultdict(list)
    for doc_id, doc in docs.items():
        fmt, split, family = doc["format"], doc["split"], doc["document_family"]
        check(split in SPLITS and doc["role"] in ROLES and doc["language"] in MARKERS, f"Invalid scope: {doc_id}")
        check(doc["version"] in (1, 2) and doc["variant"] in ("original", "scan"), f"Invalid version/variant: {doc_id}")
        check(all(doc[k] for k in ("organization", "organization_local", "branch", "document_family")),
              f"Missing organization, branch, or family: {doc_id}")
        path = Path(doc["path"])
        check(path.parent.as_posix() == f"{split}/uploads" and path.suffix == EXTENSIONS[fmt],
              f"Path, format, or split mismatch: {doc_id}")
        check((doc["variant"] == "scan") == (fmt in {"png", "image_pdf"}), f"Wrong scan format: {doc_id}")
        check(10 <= doc["procedure_count"] <= 20, f"Expected 10 to 20 procedures: {doc_id}")
        family_groups[family].append(doc)
    for family, group in family_groups.items():
        fingerprint = {(g["split"], g["role"], g["organization"], g["branch"], g["language"]) for g in group}
        check(len(fingerprint) == 1, f"Document family crosses splits or scopes: {family}")
        versions = sorted((d["version"], d["variant"]) for d in group)
        check(versions in ([(1, "original")], [(1, "original"), (1, "scan"), (2, "original")]),
              f"Invalid version or scan set: {family}")
        for scan in (d for d in group if d["variant"] == "scan"):
            source = docs[scan["source_document_id"]]
            check(source in group and source["version"] == 1 and source["variant"] == "original",
                  f"Scan does not point to its original v1: {scan['document_id']}")
    for role in ROLES:
        rows = [doc for doc in docs.values() if doc["role"] == role]
        v1 = [d for d in rows if (d["split"], d["version"], d["variant"]) == ("dev", 1, "original")]
        check(len(rows) == 5 and Counter(d["language"] for d in v1) == {"ar": 1, "en": 1},
              f"Expected five files and two bilingual dev originals for {role}")
        check(sum(d["variant"] == "scan" for d in rows) == 1
              and sum(d["split"] == "held_out" for d in rows) == 1, f"Wrong scan or held-out count for {role}")
    held_out = [d for d in docs.values() if d["split"] == "held_out"]
    check({d["language"] for d in held_out} == set(MARKERS), "Held-out set must have both languages")
    scans = [d for d in docs.values() if d["variant"] == "scan"]
    check(Counter(d["language"] for d in scans) == {"ar": 2, "en": 1}, "Expected two Arabic scans and one English scan")
    profiles = {d["scan_quality"]["profile"] for d in scans}
    check({"clean", "mild_skew_and_noise"} <= profiles, "Missing scan quality profiles")
    demo = docs[manifest["live_demo_document_id"]]
    check(demo["split"] == "held_out" and demo["format"] == "pdf", "Demo must be a held-out text PDF")
    return docs, demo


def word_text(path, language):
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    body = document.find("w:body", W)
    if language == "ar":
        for para in body.findall(".//w:p", W):
            if para.findall(".//w:t", W):
                check(para.find("w:pPr/w:bidi", W) is not None, f"Arabic paragraph needs bidirectional text: {path.name}")
    p_tag = f"{{{W['w']}}}p"
    table_tag = f"{{{W['w']}}}tbl"

    def paragraph(para):
        return "".join(t.text or "" for t in para.findall(".//w:t", W))

    rows = []
    lines = []
    for node in body:
        if node.tag == p_tag:
            lines.append(paragraph(node))
        if node.tag == table_tag:
            if language == "ar":
                check(node.find("w:tblPr/w:bidiVisual", W) is not None, f"Arabic table needs RTL columns: {path.name}")
            for row in node.findall("w:tr", W):
                cells = ["\n".join(paragraph(para) for para in cell.findall("w:p", W))
                         for cell in row.findall("w:tc", W)]
                rows.append(cells)
                lines.extend(cells)
    return lines, rows


def image_page_count(path, fmt):
    if fmt == "png":
        with Image.open(path) as img:
            check(img.format == "PNG" and img.n_frames == 1, f"Expected a single-page PNG: {path.name}")
            check(img.width >= 1000 and img.height >= 1000, f"Scan is too small: {path.name}")
            img.load()
            check(not img.text, f"PNG contains embedded text metadata: {path.name}")
        return 1
    reader = PdfReader(path)
    for page in reader.pages:
        check(not page.extract_text().strip(), f"Scan has a text layer: {path.name}")
        resources = page.get("/Resources").get_object()
        check(not resources.get("/Font"), f"Scan contains font resources: {path.name}")
        image_objects = resources.get("/XObject").get_object()
        check(len(image_objects) == 1, f"Expected one page raster: {path.name}")
        for image_ref in image_objects.values():
            image = image_ref.get_object()
            check(image["/Subtype"] == "/Image" and image["/Width"] >= 1000 and image["/Height"] >= 1000,
                  f"Invalid page raster: {path.name}")
        operators = [op for _, op in ContentStream(page.get_contents(), reader).operations]
        check(operators.count(b"Do") == 1 and not ({b"BT", b"Tj", b"TJ", b"'", b'"'} & set(operators)),
              f"Page must draw only the scan image as content: {path.name}")
    return len(reader.pages)


def validate_scan(doc, origin_pages, extraction, count):
    doc_id = doc["document_id"]
    path = ROOT / doc["path"]
    transcription = load(f"dev/gold/transcriptions/{doc_id}.json")
    check(transcription["document_id"] == doc_id and transcription["source_document_id"] == doc["source_document_id"],
          f"Wrong transcription reference: {doc_id}")
    check(transcription["scan_sha256"] == sha256(path.read_bytes()).hexdigest(),
          f"Scan differs from the visually reviewed artifact: {doc_id}")
    pages = transcription["pages"]
    check(len(pages) == count == len(origin_pages)
          and [p["page"] for p in pages] == list(range(1, count + 1)), f"Incomplete scanned pages: {doc_id}")
    for entry, original in zip(pages, origin_pages):
        check(entry["lines"] and all(line.strip() for line in entry["lines"]), f"Blank reference line: {doc_id}")
        check("\n".join(entry["lines"]) == entry["text"], f"Transcript fields disagree: {doc_id}")
        check(compact(entry["text"]) == compact("\n".join(original)), f"Transcript differs from the original page: {doc_id}")
    origin = extraction[doc["source_document_id"]]
    scanned = extraction[doc_id]
    check(fields(scanned, ("title", "scope_quote")) == fields(origin, ("title", "scope_quote")),
          f"Scan and original document scope differs: {doc_id}")
    scans = [
        {**procedure, "locator": {key: value for key, value in procedure["locator"].items() if key != "page"}}
        for procedure in scanned["procedures"]
    ]
    originals = [
        {**procedure, "locator": {key: value for key, value in procedure["locator"].items() if key != "page"}}
        for procedure in origin["procedures"]
    ]
    check(scans == originals, f"Scan and original procedures differ: {doc_id}")
    return [p["lines"] for p in pages]


def validate_procedures(doc, label, clauses, whole):
    doc_id, family = doc["document_id"], doc["document_family"]
    check(label["title"] in whole and label["scope_quote"] in whole, f"Document scope differs from source: {doc_id}")
    procedures = indexed(label["procedures"], "procedure_id")
    check(len(procedures) == doc["procedure_count"], f"Procedure count differs from manifest: {doc_id}")
    sections, covered = set(), []
    for key, procedure in procedures.items():
        supporting = procedure["clause_ids"]
        locator = procedure["locator"]
        section = locator["section"]
        check(supporting and all(cid in clauses for cid in supporting), f"Missing procedure clauses: {doc_id}/{key}")
        check(key == f"{family}:{supporting[0]}", f"Invalid stable procedure ID: {doc_id}/{key}")
        check(section not in sections and re.sub(r"^\d+\. ", "", section) == procedure["title"],
              f"Duplicate or mismatched procedure title: {doc_id}/{key}")
        check(locator == clauses[supporting[0]]["locator"], f"Procedure citation differs from its rule: {doc_id}/{key}")
        sections.add(section)
        covered.extend(supporting)
    check(covered == list(clauses), f"Procedure mapping does not cover the clauses in source order: {doc_id}")


def validate_extraction(docs):
    extraction = {}
    for split in SPLITS:
        rows = indexed(load(f"{split}/gold/extraction.json"), "document_id")
        check(set(rows) == {key for key, doc in docs.items() if doc["split"] == split},
              f"Extraction coverage or isolation failure: {split}")
        extraction.update(rows)
    source_pages, source_tables, body_signatures, clause_index, clause_families = {}, {}, {}, {}, {}
    for doc_id, doc in sorted(docs.items(), key=lambda item: item[1]["variant"] == "scan"):
        path, fmt = ROOT / doc["path"], doc["format"]
        table_rows = []
        if doc["variant"] == "scan":
            origin_id = doc["source_document_id"]
            pages = validate_scan(doc, source_pages[origin_id], extraction, image_page_count(path, fmt))
            table_rows = source_tables[origin_id]
        elif fmt == "docx":
            lines, table_rows = word_text(path, doc["language"])
            pages = [lines]
        elif fmt == "pdf":
            pages = [(page.extract_text() or "").splitlines() for page in PdfReader(path).pages]
        else:
            pages = [path.read_text(encoding="utf-8").splitlines()]
        source_pages[doc_id] = pages
        source_tables[doc_id] = table_rows
        whole = compact(" ".join(line for page in pages for line in page))
        check(MARKERS[doc["language"]] in whole and doc["organization_local"] in whole,
              f"Missing visible data marker or organization: {doc_id}")
        label = extraction[doc_id]
        clauses = indexed(label["clauses"], "clause_id")
        clause_index[doc_id] = clauses
        validate_procedures(doc, label, clauses, whole)
        signature = tuple(c["quote"] for c in clauses.values())
        prior_split = body_signatures.setdefault(signature, doc["split"])
        check(prior_split == doc["split"], f"Identical rule text appears across splits: {doc_id}")
        if doc["variant"] == "scan":
            origin_clauses = clause_index[doc["source_document_id"]]
            check(list(clauses) == list(origin_clauses), f"Scan and origin clause coverage differs: {doc_id}")
        section_names = {clause["locator"]["section"] for clause in clauses.values()}
        for cid, clause in clauses.items():
            context = f"{doc_id}/{cid}"
            family = doc["document_family"]
            check(clause_families.setdefault(cid, family) == family, f"Clause ID reused across families: {context}")
            locator, quote, facts = (clause[key] for key in ("locator", "quote", "facts"))
            section = locator["section"]
            check(section and quote and facts["responsible_role"] == doc["role"], f"Incomplete clause: {context}")
            if fmt in {"pdf", "image_pdf", "png"}:
                check(1 <= locator["page"] <= len(pages), f"Bad page locator: {context}")
            page = pages[locator.get("page", 1) - 1]
            lines = [line.strip().removeprefix("[ ] ") for line in page if line.strip()]
            check(lines.count(section) == 1, f"Unmatched or ambiguous section: {context}")
            start = lines.index(section) + 1
            end = next((index for index in range(start, len(lines)) if lines[index] in section_names), len(lines))
            check(compact(" ".join(lines[start:end])) == quote, f"Exact quote mismatch at locator: {context}")
            if "table_row" in locator:
                row = locator["table_row"]
                check(2 <= row <= len(table_rows) and table_rows[row - 1] == [section, quote], f"Wrong table row: {context}")
            if doc["variant"] == "scan":
                old = origin_clauses[cid]
                check(old["quote"] == quote and old["facts"] == facts and
                      {k: v for k, v in locator.items() if k != "page"} ==
                      {k: v for k, v in old["locator"].items() if k != "page"}, f"Wrong origin clause mapping: {context}")
            if "threshold" in facts:
                threshold = facts["threshold"]
                digits = quote.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
                source_value = threshold.get("source_value", str(threshold["value"]))
                visible = re.search(rf"\b{re.escape(source_value)}\b", digits)
                check(visible and threshold["unit"] and threshold["operator"] in {"=", ">=", "<="},
                      f"Malformed numeric threshold: {context}")
    transcriptions = {f"dev/gold/transcriptions/{doc_id}.json" for doc_id, d in docs.items() if d["variant"] == "scan"}
    check(transcriptions == files_in("dev/gold/transcriptions"), "Unexpected or missing transcription file")
    return clause_index, source_pages


def reference(ref, clauses):
    return clauses[ref["document_id"]][ref["clause_id"]]


def validate_retrieval(docs, clauses):
    total = cross_total = 0
    for split in SPLITS:
        queries = indexed(load(f"{split}/gold/retrieval.json"), "query_id")
        counts, cross = Counter(), Counter()
        languages = defaultdict(set)
        for qid, query in queries.items():
            scope = query["scope"]
            role = scope["role"]
            check(query["query"].strip() and query["query_language"] in MARKERS, f"Empty query or invalid language: {qid}")
            check(query["expected"] and query["wrong_matches"], f"Missing positive or negative: {qid}")
            positives = set()
            cross_matches = []
            for ref in query["expected"]:
                reference(ref, clauses)
                doc = docs[ref["document_id"]]
                check(doc["split"] == split and doc["variant"] == "original"
                      and fields(doc, (*SCOPE_FIELDS, "version")) == scope, f"Retrieval scope mismatch: {qid}")
                positives.add((ref["document_id"], ref["clause_id"]))
                cross_matches.append(doc["language"] != query["query_language"])
            for ref in query["wrong_matches"]:
                reference(ref, clauses)
                pair = (ref["document_id"], ref["clause_id"])
                check(pair not in positives and docs[pair[0]]["split"] == split and ref["reason"],
                      f"Invalid retrieval distractor: {qid}")
            check(query["cross_language"] == all(cross_matches), f"Incorrect cross-language label: {qid}")
            counts[role] += 1
            cross[role] += query["cross_language"]
            languages[role].add(query["query_language"])
        minimum, minimum_cross = (8, 2) if split == "dev" else (2, 1)
        for role in ROLES:
            check(counts[role] >= minimum and cross[role] >= minimum_cross
                  and languages[role] == set(MARKERS), f"Insufficient bilingual retrieval coverage: {split}/{role}")
        total += len(queries)
        cross_total += sum(cross.values())
    return total, cross_total


def validate_assessments(docs, clauses):
    cases = indexed(load("dev/gold/assessments.json"), "case_id")
    check(Counter(c["role"] for c in cases.values()) == dict.fromkeys(ROLES, 2), "Expected two assessment cases per role")
    for cid, case in cases.items():
        doc = docs[case["document_id"]]
        check(doc["split"] == "dev" and doc["role"] == case["role"], f"Invalid assessment scope: {cid}")
        check(case["language"] in MARKERS and all(case[key].strip() for key in ("scenario", "correct_action", "explanation")),
              f"Incomplete assessment: {cid}")
        supporting = case["supporting_clause_ids"]
        check(supporting and set(supporting) <= clauses[case["document_id"]].keys(), f"Invalid assessment citations: {cid}")
        wrong = case["wrong_answer"]
        check(wrong["text"].strip() and wrong["text"] != case["correct_action"]
              and wrong["expected_route"] == "remedial_practice" and wrong["practice_items"]
              and set(wrong["practice_items"]) <= {f"training-{x.lower()}" for x in supporting}, f"Invalid remedial route: {cid}")
    draft = load("dev/gold/flagged_draft.json")
    citation = draft["citation"]
    check(docs[citation["document_id"]]["split"] == "dev"
          and docs[citation["document_id"]]["role"] == draft["role"]
          and reference(citation, clauses)["locator"] == citation["locator"], "Invalid flagged draft citation")
    check(draft["expected_decision"] == "block_publication" and draft["claim"] and draft["reason"]
          and draft["state"] == "awaiting_trainer_approval", "Invalid publication gate fixture")
    return cases


def expected_learner_action(learner, scope, source_version):
    match = ("role", "organization", "branch")
    if fields(learner, match) != fields(scope, match):
        return "unaffected_out_of_scope"
    for mastery in learner["mastery"]:
        if (mastery["document_family"], mastery["version"]) == (scope["document_family"], source_version):
            return "reassess" if mastery["state"] == "mastered" else "update_in_progress_assignment"
    return "unaffected_no_assignment"


def validate_updates(docs, clauses, cases):
    learners = indexed(load("dev/gold/learners.json")["learners"], "learner_id")
    for lid, learner in learners.items():
        check(learner["language"] in MARKERS and learner["role"] in ROLES
              and learner["branch"] and learner["device_type"], f"Incomplete learner profile: {lid}")
        for mastery in learner["mastery"]:
            check(any(d["split"] == "dev" and fields(d, SCOPE_FIELDS) == {**fields(learner, ("role", "organization")),
                      "document_family": mastery["document_family"]} and d["version"] == mastery["version"]
                      for d in docs.values()), f"Invalid learner assignment: {lid}")
            check(mastery["state"] in {"mastered", "in_progress", "needs_practice"} and 0 <= mastery["score"] <= 1,
                  f"Invalid mastery state or score: {lid}")
    updates = indexed(load("dev/gold/version_diffs.json"), "to_document_id")
    check(set(updates) == {doc_id for doc_id, d in docs.items() if d["version"] == 2}, "Incomplete v2 diff coverage")
    types, actions, changed_facts = set(), set(), set()
    moved = False
    for new_id, update in updates.items():
        old_id = update["from_document_id"]
        old, new = docs[old_id], docs[new_id]
        scope_fields = (*SCOPE_FIELDS, "branch")
        scope = update["scope"]
        check(old["version"] == 1 and old["variant"] == new["variant"] == "original"
              and old["split"] == new["split"] == "dev"
              and scope == fields(old, scope_fields) == fields(new, scope_fields), f"Wrong revision pairing: {new_id}")
        before, after = clauses[old_id], clauses[new_id]
        entries = indexed(update["clauses"], "clause_id")
        check(set(entries) == before.keys() | after.keys(), f"Incomplete change set: {new_id}")
        reassess = set()
        for cid, entry in entries.items():
            prior, current = before.get(cid), after.get(cid)
            previous_loc = prior["locator"] if prior else None
            current_loc = current["locator"] if current else None
            check(entry["before"] == previous_loc and entry["after"] == current_loc, f"Stale diff locators: {new_id}/{cid}")
            if prior is None:
                kind, decision = "added", "approve_new"
            elif current is None:
                kind, decision = "removed", "retire"
            elif prior["quote"] != current["quote"]:
                kind, decision = "changed", "reapprove"
                changed_facts.update(
                    key for key in ("threshold", "actor", "exceptions")
                    if prior["facts"].get(key) != current["facts"].get(key)
                )
            else:
                kind, decision = "unchanged", "remains_valid"
            is_moved = bool(prior and current and previous_loc["section"] != current_loc["section"])
            moved |= is_moved and kind == "unchanged"
            types.add(kind)
            check((entry["change"], entry["moved"]) == (kind, is_moved) and entry["reason"], f"Incorrect diff label: {cid}")
            item = entry["training_item"]
            check(item["item_id"] == f"training-{cid.lower()}" and item["decision"] == decision
                  and item["update_citation"] == bool(current and (kind != "unchanged" or previous_loc != current_loc)),
                  f"Wrong training decision: {cid}")
            expected_cases = {key for key, case in cases.items() if case["document_id"] == new_id and cid in case["supporting_clause_ids"]}
            check(set(item["assessment_case_ids"]) == expected_cases, f"Wrong updated assessment links: {cid}")
            if kind in {"changed", "added"}:
                reassess.add(cid)
        check(set(update["reassessment_clause_ids"]) == reassess, f"Wrong reassessment clause set: {new_id}")
        impacts = indexed(update["learner_impacts"], "learner_id")
        check(set(impacts) == set(learners), f"Missing learner impacts: {new_id}")
        for lid, impact in impacts.items():
            action = impact["expected_action"]
            check(action == expected_learner_action(learners[lid], scope, old["version"]), f"Wrong learner routing: {new_id}/{lid}")
            actions.add(action)
    check(types == {"unchanged", "changed", "added", "removed"} and moved
          and "threshold" in changed_facts and {"actor", "exceptions"} & changed_facts,
          "Diffs must cover every change type, a moved rule, a threshold, and an actor or exception change")
    check({"reassess", "unaffected_no_assignment", "unaffected_out_of_scope", "update_in_progress_assignment"} <= actions,
          "Missing reassessment routing scenarios")
    return len(updates), len(learners)


def main():
    docs, demo = validate_manifest()
    clauses, pages = validate_extraction(docs)
    check(len(pages[demo["document_id"]]) == 1, "The live demo SOP must fit on one page")
    queries, cross = validate_retrieval(docs, clauses)
    cases = validate_assessments(docs, clauses)
    updates, learners = validate_updates(docs, clauses, cases)
    print("PASS: HungerLearn fixture validation")
    for label in ("role", "language", "format", "split"):
        counts = Counter(doc[label] for doc in docs.values())
        print(f"  {label}: " + ", ".join(f"{name}={count}" for name, count in sorted(counts.items())))
    procedure_counts = [doc["procedure_count"] for doc in docs.values()]
    print(f"  {min(procedure_counts)}-{max(procedure_counts)} procedures per file, {sum(procedure_counts)} procedure occurrences")
    print(f"  {len(docs)} files, {sum(map(len, clauses.values()))} clause occurrences, 3 transcribed scan pages")
    print(f"  {queries} retrieval queries ({cross} cross-language), {len(cases)} assessment cases, 1 blocked draft")
    print(f"  {updates} version diffs, {learners} learner profiles")
    print(f"  Live demo upload: {demo['path']}")
    print("  Model evaluations run: 0")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError) as error:
        sys.exit(f"FAIL: {error}")
