"""Dense-retrieval baseline over the gold retrieval queries (model evaluation, NOT fixture validation).

Indexes clause quotes from the split's original uploads only (scans excluded), embeds each query, and scores
the gold `expected` occurrences:
  * filtered:   candidates restricted to the query scope (role, organization, family, version);
  * unfiltered: all clauses of the split, plus the share of queries where a labelled wrong match outranks
                every expected clause (stale-version and cross-role ranking errors).
Default model is BGE-M3 (CLS pooling); any local Hugging Face encoder works. Models load from the local
cache only (no download). Use --split held_out only after the configuration is frozen.

  python qa/retrieval_baseline.py --model BAAI/bge-m3
  python qa/retrieval_baseline.py --model intfloat/multilingual-e5-small     # what was run in loop 6
Requires torch and transformers.
"""
import argparse
import json
import sys
from pathlib import Path

import torch
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]


def load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def embed(model, tok, texts, pooling):
    out = []
    for i in range(0, len(texts), 32):
        batch = tok(texts[i:i + 32], padding=True, truncation=True, max_length=256, return_tensors="pt")
        with torch.no_grad():
            hidden = model(**batch).last_hidden_state
        if pooling == "cls":
            vec = hidden[:, 0]
        else:
            mask = batch["attention_mask"].unsqueeze(-1).float()
            vec = (hidden * mask).sum(1) / mask.sum(1)
        out.append(torch.nn.functional.normalize(vec, dim=-1))
    return torch.cat(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="BAAI/bge-m3")
    ap.add_argument("--split", default="dev", choices=["dev", "held_out"])
    args = ap.parse_args()
    e5 = "e5" in args.model.lower()
    pooling = "mean" if e5 else "cls"
    qp, pp = ("query: ", "passage: ") if e5 else ("", "")

    docs = {d["document_id"]: d for d in load("manifest.json")["documents"]}
    rows = [(r["document_id"], c["clause_id"], c["quote"]) for r in load(f"{args.split}/gold/extraction.json")
            for c in r["clauses"] if docs[r["document_id"]]["variant"] == "original"]
    queries = load(f"{args.split}/gold/retrieval.json")

    try:  # resolve to the cached snapshot folder so nothing is fetched from the network
        from huggingface_hub import snapshot_download
        local = snapshot_download(args.model, local_files_only=True)
    except Exception as error:
        sys.exit(f"NOT RUN: {args.model} is not in the local Hugging Face cache ({type(error).__name__}).")
    tok = AutoTokenizer.from_pretrained(local)
    model = AutoModel.from_pretrained(local).eval()
    passages = embed(model, tok, [pp + q for _, _, q in rows], pooling)
    qvecs = embed(model, tok, [qp + q["query"] for q in queries], pooling)
    scores = qvecs @ passages.T

    def ranked(i, filtered):
        scope = queries[i]["scope"]
        idx = [j for j, (doc_id, _, _) in enumerate(rows)
               if not filtered or all(docs[doc_id][k] == scope[k] for k in ("role", "organization", "document_family", "version"))]
        idx.sort(key=lambda j: -float(scores[i, j]))
        return [(rows[j][0], rows[j][1]) for j in idx]

    report = {}
    for mode in ("filtered", "unfiltered"):
        r1 = r3 = mrr = wrong_first = 0
        cross = [0, 0]
        misses = []
        for i, q in enumerate(queries):
            order = ranked(i, mode == "filtered")
            expected = {(e["document_id"], e["clause_id"]) for e in q["expected"]}
            rank = next(k for k, pair in enumerate(order, 1) if pair in expected)
            r1 += rank == 1
            r3 += rank <= 3
            mrr += 1 / rank
            if q["cross_language"]:
                cross[0] += rank <= 3
                cross[1] += 1
            wrong = {(w["document_id"], w["clause_id"]) for w in q["wrong_matches"]}
            first_wrong = next((k for k, pair in enumerate(order, 1) if pair in wrong), 10 ** 6)
            wrong_first += first_wrong < rank
            if rank > 3:
                misses.append(f"{q['query_id']} rank {rank}: top={order[0]}")
        n = len(queries)
        report[mode] = {"queries": n, "recall@1": round(r1 / n, 3), "recall@3": round(r3 / n, 3), "mrr": round(mrr / n, 3),
                        "cross_language_recall@3": round(cross[0] / max(cross[1], 1), 3),
                        "wrong_match_ranked_above_expected": round(wrong_first / n, 3), "misses@3": misses}
    print(json.dumps({"model": args.model, "split": args.split, "index_size": len(rows), **report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
