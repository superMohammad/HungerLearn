"""Loop 7 targeted check: recompute every v1 -> v2 diff without trusting the gold clause IDs.

1. Match v2 clauses to v1 clauses by text only: exact normalized match first (digits folded to ASCII, Arabic
   diacritics/tatweel removed, alef forms unified, whitespace collapsed), then best character-trigram
   similarity for the remainder (>= 0.5 and a 0.1 margin over the runner-up).
2. Check that matched pairs share the same stable clause_id (identity check).
3. Re-derive change, moved and update_citation, and the fact keys that differ, and compare with
   dev/gold/version_diffs.json.
4. Check that an unchanged rule carries identical facts in both versions.
5. Spell out the CW-02 15 -> 10 minute scenario end to end.
Run from the dataset directory: python qa/diff_check.py
"""
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v

FOLD = str.maketrans("٠١٢٣٤٥٦٧٨٩أإآى", "0123456789اااي", "ـ")  # tatweel deleted, not spaced


def normalize(text):
    text = unicodedata.normalize("NFKC", text).translate(FOLD)
    text = re.sub(r"[ً-ْ]", "", text)           # harakat
    text = re.sub(r"[«»\"“”'’.,،:;]", " ", text)
    return " ".join(text.split()).lower()


def trigrams(text):
    t = normalize(text)
    return {t[i:i + 3] for i in range(len(t) - 2)}


def similarity(a, b):
    x, y = trigrams(a), trigrams(b)
    return len(x & y) / max(len(x | y), 1)


def match(before, after):
    pairs, used = {}, set()
    by_norm = {normalize(c["quote"]): cid for cid, c in before.items()}
    for cid, c in after.items():
        old = by_norm.get(normalize(c["quote"]))
        if old:
            pairs[cid] = old
            used.add(old)
    for cid, c in after.items():
        if cid in pairs:
            continue
        scored = sorted(((similarity(c["quote"], o["quote"]), oid) for oid, o in before.items() if oid not in used), reverse=True)
        if scored and scored[0][0] >= 0.5 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.1):
            pairs[cid] = scored[0][1]
            used.add(scored[0][1])
    # Third pass: low text similarity, but the same section heading (a rewritten rule in place). A real
    # pipeline should send these to the trainer to confirm; gold labels them same_section_low_similarity.
    for cid, c in after.items():
        if cid in pairs:
            continue
        same = [oid for oid, o in before.items() if oid not in used and o["locator"]["section"] == c["locator"]["section"]
                and similarity(c["quote"], o["quote"]) >= 0.3]
        if len(same) == 1:
            pairs[cid] = same[0]
            used.add(same[0])
    return pairs


def main():
    clauses = {r["document_id"]: {c["clause_id"]: c for c in r["clauses"]} for r in v.load("dev/gold/extraction.json")}
    failures = []
    for diff in v.load("dev/gold/version_diffs.json"):
        old_id, new_id = diff["from_document_id"], diff["to_document_id"]
        before, after = clauses[old_id], clauses[new_id]
        pairs = match(before, after)
        gold = {e["clause_id"]: e for e in diff["clauses"]}
        print(f"== {old_id} -> {new_id}")
        for new_cid, old_cid in pairs.items():
            if new_cid != old_cid:
                failures.append(f"identity: v2 {new_cid} matches v1 {old_cid} by text")
        derived = {}
        for cid in sorted(set(before) | set(after)):
            if cid in after and cid in pairs.values() and pairs.get(cid) != cid and cid not in pairs:
                pass
            p, c = before.get(cid), after.get(cid)
            if c and cid not in pairs:
                kind = "added"
            elif p and cid not in pairs.values():
                kind = "removed"
            elif normalize(p["quote"]) == normalize(c["quote"]):
                kind = "unchanged"
            else:
                kind = "changed"
            moved = bool(p and c and p["locator"]["section"] != c["locator"]["section"])
            update = bool(c and (kind != "unchanged" or p["locator"] != c["locator"]))
            facts = sorted(k for k in set((p or {}).get("facts", {})) | set((c or {}).get("facts", {}))
                           if p and c and p["facts"].get(k) != c["facts"].get(k))
            derived[cid] = (kind, moved, update, facts)
            g = gold[cid]
            ok = (g["change"], g["moved"], g["training_item"]["update_citation"]) == (kind, moved, update)
            if kind == "unchanged" and facts:
                failures.append(f"{new_id}/{cid}: unchanged rule has different facts across versions: {facts}")
            if not ok:
                failures.append(f"{new_id}/{cid}: derived {kind}/moved={moved}/update={update} vs gold {g['change']}/{g['moved']}/{g['training_item']['update_citation']}")
            if kind != "unchanged" or moved or update:
                print(f"   {cid}: {kind:9} moved={moved!s:5} update_citation={update!s:5} changed_facts={facts} {'ok' if ok else 'MISMATCH'}")
        reassess = sorted(cid for cid, d in derived.items() if d[0] in ("changed", "added"))
        if reassess != sorted(diff["reassessment_clause_ids"]):
            failures.append(f"{new_id}: reassessment {diff['reassessment_clause_ids']} vs derived {reassess}")
        print(f"   reassessment clauses: {reassess}")

    # CW-02 end-to-end scenario
    d = next(x for x in v.load("dev/gold/version_diffs.json") if x["to_document_id"] == "courier-pickup-wait-v2")
    e = next(x for x in d["clauses"] if x["clause_id"] == "CW-02")
    t1 = clauses["courier-pickup-wait-v1"]["CW-02"]["facts"]["threshold"]
    t2 = clauses["courier-pickup-wait-v2"]["CW-02"]["facts"]["threshold"]
    impacts = {i["learner_id"]: i["expected_action"] for i in d["learner_impacts"]}
    checks = {
        "threshold 15 -> 10 minutes, glyphs ١٥ -> 10": (t1["value"], t1["printed_value"], t2["value"], t2["printed_value"]) == (15, "١٥", 10, "10"),
        "operator unchanged (>=)": t1["operator"] == t2["operator"] == ">=",
        "classified changed, not moved": (e["change"], e["moved"]) == ("changed", False),
        "training-cw-02 needs reapproval, citation refreshed": (e["training_item"]["decision"], e["training_item"]["update_citation"]) == ("reapprove", True),
        "assessment A-C1 linked to the change": e["training_item"]["assessment_case_ids"] == ["A-C1"],
        "only CW-02 is reassessed": d["reassessment_clause_ids"] == ["CW-02"],
        "HL-101 (mastered v1, Fig Gate) reassessed": impacts.get("HL-101") == "reassess",
        "HL-103 (in progress v1, Fig Gate) gets updated assignment": impacts.get("HL-103") == "update_in_progress_assignment",
        "HL-102 (Papaya Bend) untouched": impacts.get("HL-102") == "unaffected_out_of_scope",
        "nobody outside the courier family is reassessed": all(a != "reassess" for k, a in impacts.items() if k != "HL-101"),
    }
    print("== CW-02 scenario")
    for name, ok in checks.items():
        print(f"   {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failures.append(f"CW-02 scenario: {name}")
    print("\n".join(f"FAIL {f}" for f in failures) or "all diffs reproduced from text")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
