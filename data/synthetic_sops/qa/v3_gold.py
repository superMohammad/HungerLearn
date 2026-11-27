"""Write the gold labels for the v3 uploads from the authoring record and the rendered files.

Run from the dataset directory after qa/v3_render.py:
    uv run --no-project --with Pillow==13.0.0 --with pypdf==6.21.4 --with python-docx==1.2.0 python -m qa.v3_gold
then `python validate.py` and, after review, `python qa/freeze.py`.

It replaces any earlier v3 rows, so it can run again after an edit:
- manifest.json: six documents per family. The v3 original is in the family's language and v2's format; the other
  five are `format_copy` (same language) or `translation` (other language), each pointing at the original through
  `source_document_id`.
- dev/gold/extraction.json: quotes exactly as written in the authoring record, section locators (plus the page for
  PDFs, found in the rendered file), and facts. Unchanged rules reuse v2's facts.
- dev/gold/version_diffs.json: the v2 -> v3 update for each original, derived with validate.py's own rules.
- dev/gold/learners.json: two learners per family who hold v2 (mastered, in progress), so each v3 update exercises
  every routing outcome. They are added to the earlier updates' learner impacts too.
- dev/gold/retrieval.json: every query whose answer is a rule that v3 carries lists the v3 original's copy of that
  rule as a wrong match, since only the version filter separates them.
- dev/gold/publication_gates.json: v3 supersedes v2, so gates that tested a claim against the current v2 rule are
  re-pointed at the same rule in v3 (GATES_ON_V3, with v3's value), and the superseded-v1 gate names v3.
"""
from __future__ import annotations

import json
from pathlib import Path

from pypdf import PdfReader

from qa.v3_authoring.model import FamilyV3, Language, LANGUAGES, Rules
from qa.v3_render import FAMILIES, FORMATS, heading, upload_path
from validate import (
    ROOT, expected_learner_action, fields, load, match_key, trigram_similarity, word_bag,
)

# Gate claims rewritten for the rule that is current in v3; each keeps the trap it was written to test.
GATES_ON_V3 = {
    "courier-pickup-wait": {
        "G-01": ("If the order is still being prepared 8 minutes after check-in, send a Pickup Delay report to Dispatch.",
                 "Matches the v3 threshold and operator; it may go to trainer review but is not yet approved."),
        "G-02": ("إذا بقي الطلب قيد التجهيز بعد ٨ دقائق من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.",
                 "Arabic-Indic ٨ equals the printed ASCII 8 in v3; a gate must compare values, not glyphs."),
        "G-03": ("Wait 15 minutes after check-in before reporting a pickup delay to Dispatch.",
                 "Teaches the superseded 15-minute timer against a v3 citation that says 8."),
        "G-04": ("Report a pickup delay once more than 8 minutes have passed since check-in.",
                 "The rule applies at 8 minutes (>=); 'more than 8' tells couriers to keep waiting at exactly 8."),
        "G-05": ("أرسل بلاغ «تأخر الاستلام» إذا مرّ أكثر من 8 دقائق على تسجيل الوصول.",
                 "«أكثر من 8» excludes the 8-minute mark at which the v3 rule already applies."),
    },
}
SUPERSEDED_GATES = {"courier-pickup-wait": ("G-06", "Faithful to v1, but v1 is superseded by courier-pickup-wait-v3; "
                                                   "new training must cite the current version.")}

NEW_LEARNERS = {
    "courier-pickup-wait": ("HL-106", "HL-107", "ar", "android", "ios"),
    "employee-delayed-order": ("HL-204", "HL-205", "en", "desktop", "desktop"),
    "partner-packing-sealing": ("HL-305", "HL-306", "ar", "shared_tablet", "android"),
}


def write_json(relative: str, data: object) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n"
    (ROOT / relative).write_bytes(text.encode("utf-8"))


def document_id(family: FamilyV3, language: Language, fmt: str) -> str:
    original = language == family.original_language and fmt == family.original_format
    return f"{family.family}-v3" if original else f"{family.family}-v3-{language}-{fmt}"


def manifest_rows(family: FamilyV3, v2: dict) -> list[dict]:
    rows = []
    original = document_id(family, family.original_language, family.original_format)
    for language in LANGUAGES:
        for fmt in FORMATS:
            doc_id = document_id(family, language, fmt)
            row = {
                "document_id": doc_id,
                "path": upload_path(family, language, fmt).relative_to(ROOT).as_posix(),
                "document_family": family.family, "version": 3, "language": language, "format": fmt,
                "role": v2["role"], "organization": v2["organization"],
                "organization_local": family.cover.organization.get(language),
                "branch": v2["branch"], "branch_local": family.cover.branch.get(language),
                "split": "dev",
                "variant": "original" if doc_id == original else
                ("format_copy" if language == family.original_language else "translation"),
                "procedure_count": len(family.procedures()),
            }
            if doc_id != original:
                row["source_document_id"] = original
            rows.append(row)
    return rows


def pdf_pages(family: FamilyV3, language: Language) -> dict[str, int]:
    """Page of every section heading and every rule in the rendered PDF, searched in document order."""
    bags = [word_bag(page.extract_text() or "") for page in PdfReader(upload_path(family, language, "pdf")).pages]
    found: dict[str, int] = {}
    page = 0
    for n, section in family.numbered():
        line = heading(section, n, language)
        page = next(p for p in range(page, len(bags)) if word_bag(line) <= bags[p])
        found[line] = page + 1
        rule_page = page
        for block in section.blocks:
            if isinstance(block, Rules):
                for rule in block.rules:
                    quote = rule.text.get(language)
                    rule_page = next(p for p in range(rule_page, len(bags)) if word_bag(quote) <= bags[p])
                    found[rule.clause_id] = rule_page + 1
    return found


def extraction_row(family: FamilyV3, language: Language, fmt: str, v2_facts: dict[str, dict]) -> dict:
    pages = pdf_pages(family, language) if fmt == "pdf" else {}
    clauses, procedures = [], []
    for n, section in family.numbered():
        if not section.procedure:
            continue
        line = heading(section, n, language)
        rules = [r for b in section.blocks if isinstance(b, Rules) for r in b.rules]
        for rule in rules:
            change = family.changes.get(rule.clause_id)
            facts = v2_facts[rule.clause_id] if change and change.change == "unchanged" else family.facts[rule.clause_id]
            locator = {"section": line, **({"page": pages[rule.clause_id]} if fmt == "pdf" else {})}
            clauses.append({"clause_id": rule.clause_id, "quote": rule.text.get(language), "locator": locator, "facts": facts})
        first = clauses[-len(rules)]
        procedures.append({"procedure_id": f"{family.family}:{rules[0].clause_id}", "title": section.title.get(language),
                           "locator": first["locator"], "clause_ids": [r.clause_id for r in rules]})
    return {"document_id": document_id(family, language, fmt), "title": family.cover.title.get(language),
            "scope_quote": family.cover.scope_quote.get(language), "clauses": clauses, "procedures": procedures}


def diff_row(family: FamilyV3, v2_doc: dict, v2_row: dict, v3_row: dict, learners: list[dict]) -> dict:
    before = {c["clause_id"]: c for c in v2_row["clauses"]}
    after = {c["clause_id"]: c for c in v3_row["clauses"]}
    entries, reassess = [], []
    for cid in [*before, *(c for c in after if c not in before)]:
        prior, current = before.get(cid), after.get(cid)
        if prior is None:
            kind, decision, basis = "added", "approve_new", "none"
            facts = current["facts"]
            reason = f"New v3 rule: {facts.get('action') or facts.get('negation')}."
        elif current is None:
            kind, decision, basis, reason = "removed", "retire", "none", family.removed[cid]
        else:
            authored = family.changes[cid]
            kind = "unchanged" if prior["quote"] == current["quote"] else "changed"
            if kind != authored.change:
                raise ValueError(f"{cid}: the text says {kind} but the authoring record says {authored.change}")
            decision = "remains_valid" if kind == "unchanged" else "reapprove"
            reason = authored.reason
            if match_key(prior["quote"]) == match_key(current["quote"]):
                basis = "identical_text"
            elif trigram_similarity(prior["quote"], current["quote"]) >= 0.5:
                basis = "similar_text"
            else:
                basis = "same_section_low_similarity"
        entry = {"clause_id": cid, "change": kind,
                 "before": prior["locator"] if prior else None, "after": current["locator"] if current else None,
                 "moved": bool(prior and current and prior["locator"]["section"] != current["locator"]["section"]),
                 "match_basis": basis}
        if kind == "changed":
            keys = sorted(set(prior["facts"]) | set(current["facts"]))
            entry["changed_facts"] = {k: {"before": prior["facts"].get(k), "after": current["facts"].get(k)}
                                      for k in keys if prior["facts"].get(k) != current["facts"].get(k)}
        entry["reason"] = reason
        entry["training_item"] = {"item_id": f"training-{cid.lower()}", "decision": decision,
                                  "update_citation": bool(current and (kind != "unchanged" or entry["moved"])),
                                  "assessment_case_ids": []}
        entries.append(entry)
        if kind in {"changed", "added"}:
            reassess.append(cid)
    scope = {**fields(v2_doc, ("role", "organization", "branch")), "document_family": family.family}
    return {"scope": scope, "from_document_id": v2_doc["document_id"], "to_document_id": v3_row["document_id"],
            "clauses": entries,
            "learner_impacts": [{"learner_id": l["learner_id"], "expected_action": expected_learner_action(l, scope, 2)}
                                for l in learners],
            "reassessment_clause_ids": reassess}


def new_learners(family: FamilyV3, v2: dict) -> list[dict]:
    mastered, in_progress, language, device_a, device_b = NEW_LEARNERS[family.family]
    base = {"role": v2["role"], "language": language, "organization": v2["organization"], "branch": v2["branch"]}
    return [
        {"learner_id": mastered, **base, "device_type": device_a,
         "mastery": [{"document_family": family.family, "version": 2, "state": "mastered", "score": 1.0}]},
        {"learner_id": in_progress, **base, "device_type": device_b,
         "mastery": [{"document_family": family.family, "version": 2, "state": "in_progress", "score": 0.5}]},
    ]


def main() -> None:
    manifest = load("manifest.json")
    extraction = load("dev/gold/extraction.json")
    diffs = load("dev/gold/version_diffs.json")
    learner_file = load("dev/gold/learners.json")
    v3_families = {f.family for f in FAMILIES}
    new_ids = {lid for f in FAMILIES for lid in NEW_LEARNERS[f.family][:2]}

    manifest["documents"] = [d for d in manifest["documents"] if d["version"] != 3]
    v3_ids_before = {d["document_id"] for d in load("manifest.json")["documents"] if d["version"] == 3}
    extraction = [e for e in extraction if e["document_id"] not in v3_ids_before]
    diffs = [d for d in diffs if not d["to_document_id"].endswith("-v3")]
    learners = [l for l in learner_file["learners"] if l["learner_id"] not in new_ids]

    by_id = {d["document_id"]: d for d in manifest["documents"]}
    rows = {e["document_id"]: e for e in extraction}
    for family in FAMILIES:
        v2 = by_id[f"{family.family}-v2"]
        manifest["documents"] += manifest_rows(family, v2)
        learners += new_learners(family, v2)
    for family in FAMILIES:
        v2 = by_id[f"{family.family}-v2"]
        v2_facts = {c["clause_id"]: c["facts"] for c in rows[v2["document_id"]]["clauses"]}
        for language in LANGUAGES:
            for fmt in FORMATS:
                row = extraction_row(family, language, fmt, v2_facts)
                extraction.append(row)
                rows[row["document_id"]] = row
        original = rows[document_id(family, family.original_language, family.original_format)]
        unchanged_text = [c["clause_id"] for c in original["clauses"]
                          if family.changes.get(c["clause_id"]) and family.changes[c["clause_id"]].change == "unchanged"
                          and c["quote"] != next(x["quote"] for x in rows[v2["document_id"]]["clauses"] if x["clause_id"] == c["clause_id"])]
        if unchanged_text:
            raise ValueError(f"{family.family}: rules marked unchanged differ from v2's text: {unchanged_text}")
        diffs.append(diff_row(family, v2, rows[v2["document_id"]], original, learners))

    for update in diffs:
        if update["to_document_id"].endswith("-v2"):
            scope = update["scope"]
            known = {i["learner_id"] for i in update["learner_impacts"]}
            update["learner_impacts"] += [{"learner_id": l["learner_id"], "expected_action": expected_learner_action(l, scope, 1)}
                                          for l in learners if l["learner_id"] not in known]

    gates = load("dev/gold/publication_gates.json")
    for family in FAMILIES:
        original = rows[document_id(family, family.original_language, family.original_format)]
        v3_clauses = {c["clause_id"]: c for c in original["clauses"]}
        for gate in gates:
            if gate["gate_id"] in GATES_ON_V3.get(family.family, {}):
                claim, reason = GATES_ON_V3[family.family][gate["gate_id"]]
                cid = gate["citation"]["clause_id"]
                gate.update(claim=claim, reason=reason, citation={"document_id": original["document_id"], "clause_id": cid,
                                                                  "locator": v3_clauses[cid]["locator"]})
        if family.family in SUPERSEDED_GATES:
            gate_id, reason = SUPERSEDED_GATES[family.family]
            next(g for g in gates if g["gate_id"] == gate_id)["reason"] = reason

    queries = load("dev/gold/retrieval.json")
    for query in queries:
        for family in FAMILIES:
            original = rows[document_id(family, family.original_language, family.original_format)]
            v3_quotes = {c["clause_id"]: c["quote"] for c in original["clauses"]}
            query["wrong_matches"] = [w for w in query["wrong_matches"] if w["document_id"] != original["document_id"]]
            for ref in query["expected"]:
                cid = ref["clause_id"]
                if not ref["document_id"].startswith(f"{family.family}-v") or cid not in v3_quotes:
                    continue
                same = v3_quotes[cid] == next(c["quote"] for c in rows[ref["document_id"]]["clauses"] if c["clause_id"] == cid)
                query["wrong_matches"].append({
                    "document_id": original["document_id"], "clause_id": cid,
                    "reason": "identical rule in v3; only the version filter excludes it" if same
                    else "v3 changes this rule; it is outside the requested version"})

    write_json("dev/gold/publication_gates.json", gates)
    write_json("dev/gold/retrieval.json", queries)
    write_json("manifest.json", manifest)
    write_json("dev/gold/extraction.json", extraction)
    write_json("dev/gold/version_diffs.json", diffs)
    write_json("dev/gold/learners.json", {**learner_file, "learners": learners})
    print(f"v3 families: {sorted(v3_families)}; documents: {sum(d['version'] == 3 for d in manifest['documents'])}")


if __name__ == "__main__":
    main()
