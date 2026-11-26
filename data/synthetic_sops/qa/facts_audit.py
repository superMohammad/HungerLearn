"""Loop 4 targeted check: are gold `facts` normalized fields, or restatements of the quote?

A trigger/action/negation/actor value is a copy if it contains Arabic script, or if it is a contiguous span of
the quote that either keeps the quote's conditional marker (If/When/Before/After/For ...) or runs 10+ words.
Short normalized phrases that happen to reuse source words are allowed.
Also checks that every clause states an action or a prohibition, and that exception_to names a clause in the
same document.
Run from the dataset directory: python qa/facts_audit.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v

ARABIC = re.compile(r"[؀-ۿ]")


def norm(text):
    return " ".join(re.sub(r"[^\w\s'-]", " ", text.lower()).split())


MARKER = ("if ", "when ", "before ", "after ", "for ")


def is_copy(field, quote):
    f = norm(field)
    span = f in norm(quote)
    return bool(ARABIC.search(field)) or (span and (f.startswith(MARKER) or len(f.split()) >= 10))


def problems(record):
    ids = {c["clause_id"] for c in record["clauses"]}
    for c in record["clauses"]:
        f, q = c["facts"], c["quote"]
        for key in ("trigger", "action", "negation", "actor"):
            if key in f and is_copy(f[key], q):
                yield c["clause_id"], f"{key} copies the quote instead of normalizing it"
        if not ("action" in f or "negation" in f):
            yield c["clause_id"], "no action or prohibition"
        if "exception_to" in f and f["exception_to"] not in ids:
            yield c["clause_id"], f"exception_to {f['exception_to']} is not in this document"


def main():
    total = 0
    for split in v.SPLITS:
        for record in v.load(f"{split}/gold/extraction.json"):
            for cid, msg in problems(record):
                total += 1
                print(f"{record['document_id']}/{cid}: {msg}")
    print(f"{total} finding(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
