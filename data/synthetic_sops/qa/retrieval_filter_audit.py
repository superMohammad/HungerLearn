"""Loop 6 targeted check: which scope filters do the retrieval distractors exercise?
Each wrong match is classed by the first scope field it violates (organization/role, family, version) or 'in-scope'.
A query scoped to one version of a multi-version family must list the other version's occurrence of each
expected clause, otherwise nothing tests the version filter for that query.
Run from the dataset directory: python qa/retrieval_filter_audit.py"""
import sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v

def main():
    docs = {d["document_id"]: d for d in v.load("manifest.json")["documents"]}
    extraction = {r["document_id"]: {c["clause_id"] for c in r["clauses"]}
                  for s in v.SPLITS for r in v.load(f"{s}/gold/extraction.json")}
    missing = 0
    for split in v.SPLITS:
        kinds = Counter()
        for q in v.load(f"{split}/gold/retrieval.json"):
            scope = q["scope"]
            for w in q["wrong_matches"]:
                d = docs[w["document_id"]]
                kind = ("role/organization" if d["role"] != scope["role"] else
                        "family" if d["document_family"] != scope["document_family"] else
                        "version" if d["version"] != scope["version"] else "in-scope")
                kinds[kind] += 1
            wrong = {(w["document_id"], w["clause_id"]) for w in q["wrong_matches"]}
            for e in q["expected"]:
                for other_id, other in docs.items():
                    if (other["document_family"] == scope["document_family"] and other["variant"] == "original"
                            and other["version"] != scope["version"] and e["clause_id"] in extraction[other_id]
                            and (other_id, e["clause_id"]) not in wrong):
                        missing += 1
                        print(f"{q['query_id']}: no version distractor {other_id}/{e['clause_id']}")
        print(f"{split}: distractors by violated filter {dict(kinds)}")
    print(f"{missing} missing version-filter distractor(s)")
    return 1 if missing else 0

if __name__ == "__main__":
    sys.exit(main())
