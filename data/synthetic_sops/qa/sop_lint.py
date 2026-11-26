"""SOP wording lint over the gold clause quotes (which validate.py proves are exact source text).
Rule T1: a deadline or wait threshold (minute/hour with >= or <=) must name the event its timer starts from.
Run from the dataset directory: python qa/sop_lint.py"""
import re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v

ANCHOR = re.compile(
    r"\d+\s+(?:minutes?|hours?)\s+(?:past|after\s+(?:the|you|sending|opening|check-in)|of\s+(?:opening|the|sending)|on\s+the|since)\b"
    r"|[0-9\u0660-\u0669]+\s+(?:دقيقة|دقائق|ساعة|ساعات)\s+من\s+\S+")

def main():
    findings = 0
    for split in v.SPLITS:
        for record in v.load(f"{split}/gold/extraction.json"):
            if record["document_id"].endswith("-scan"):
                continue
            for c in record["clauses"]:
                t = c["facts"].get("threshold")
                if t and t["unit"] in ("minute", "hour") and t["operator"] in (">=", "<=") and not ANCHOR.search(c["quote"]):
                    findings += 1
                    print(f"T1 {record['document_id']}/{c['clause_id']}: timer has no start event: {c['quote']}")
    print(f"{findings} finding(s)")
    return 1 if findings else 0

if __name__ == "__main__":
    sys.exit(main())
