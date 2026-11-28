import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCostTimeReport } from "./cost-time";
import { buildReport } from "./generation-eval";
import { parseLlmPrices } from "./prices";
import { readScoreboard, SCOREBOARD_FILES, type ScoreboardSources } from "./scoreboard";

const EXTRACTED = Array.from({ length: 12 }, (_, i) => ({ document_id: `doc-${i}`, recall: 0.97 }));
const EXTRACTION = JSON.stringify({
  llm: "openai_compat", llm_model: "gemma4:latest", embedding_model: "google/embeddinggemma-2", macro_recall: 0.97, macro_precision: 0.91,
  extraction: EXTRACTED, skipped: [], extra: 1,
});
const MODIFIED = "2026-11-27T11:00:00.000Z";
const GENERATION = JSON.stringify({
  run: { date: "2026-11-27T12:00:00Z", model: "gemma4:latest", commit: "199c274" },
  totals: {
    items: 580, citation_accuracy: { normalized: 0.988, exact: 0.988 }, silent_failures: 0, publishable_with_failed_check: 179,
    documents: 12, documents_failed: 0, procedures_failed: 0,
  },
});
const COST = JSON.stringify({
  generated_at: "2026-11-27T13:00:00Z",
  llm_model: "gemma4:latest",
  hosted_model: "google/gemma-4",
  coverage: { docproc_calls_not_logged: true, zero_token_calls: 2, failed_jobs: 1, running_jobs: 0 },
  summary: {
    all: {
      versions: 15, mean_processing_seconds: 312.5, mean_elapsed_to_ready_seconds: 1200, mean_input_tokens: 90000, mean_output_tokens: 21000,
      mean_usd: 0, mean_hosted_usd_estimate: 0.0174, carry_over_saving_usd_estimate: 0, carry_over_saving_unknown_versions: 0,
    },
    update: {
      versions: 3, mean_processing_seconds: 140, mean_elapsed_to_ready_seconds: 150, mean_input_tokens: 20000, mean_output_tokens: 4000,
      mean_usd: 0, mean_hosted_usd_estimate: 0.004, carry_over_saving_usd_estimate: 0.031, carry_over_saving_unknown_versions: 1,
    },
  },
});

function sources(over: Partial<ScoreboardSources>): ScoreboardSources {
  return { extraction: EXTRACTION, generation: GENERATION, cost: COST, ...over };
}

test("the five metrics and the v2 saving are read from the three result files", () => {
  const s = readScoreboard(sources({}), { extractionModified: MODIFIED });
  assert.deepEqual(s.extraction, { status: "ok", recall: 0.97, precision: 0.91, model: "gemma4:latest", scored: 12, skipped: 0, date: MODIFIED });
  assert.deepEqual(s.generation, {
    status: "ok", items: 580, citationAccuracy: 0.988, citationAccuracyExact: 0.988, silentFailures: 0, publishableWithFailedCheck: 179,
    documents: 12, documentsFailed: 0, proceduresFailed: 0, model: "gemma4:latest", date: "2026-11-27T12:00:00Z",
  });
  assert.equal(s.cost.status, "ok");
  if (s.cost.status !== "ok") return;
  assert.deepEqual(
    { usd: s.cost.meanUsd, hosted: s.cost.meanHostedUsd, hostedModel: s.cost.hostedModel, processing: s.cost.meanProcessingSeconds, elapsed: s.cost.meanElapsedSeconds, versions: s.cost.versions },
    { usd: 0, hosted: 0.0174, hostedModel: "google/gemma-4", processing: 312.5, elapsed: 1200, versions: 15 },
  );
  assert.deepEqual({ saving: s.cost.savingUsd, unknown: s.cost.savingUnknownVersions, updates: s.cost.updates }, { saving: 0.031, unknown: 1, updates: 3 });
  assert.deepEqual(s.cost.coverage, { docprocCallsNotLogged: true, zeroTokenCalls: 2, failedJobs: 1, runningJobs: 0 });
});

test("a missing result file is reported as not run yet, with the command that produces it", () => {
  const s = readScoreboard({ extraction: null, generation: null, cost: null });
  assert.deepEqual(s.extraction, { status: "missing", file: SCOREBOARD_FILES.extraction.file, command: SCOREBOARD_FILES.extraction.command });
  assert.equal(s.generation.status, "missing");
  assert.equal(s.cost.status, "missing");
  assert.match(SCOREBOARD_FILES.generation.command, /pnpm eval:generation/);
  assert.match(SCOREBOARD_FILES.cost.command, /pnpm report:cost-time/);
  assert.match(SCOREBOARD_FILES.extraction.command, /docproc eval --real/);
});

test("a broken result file is reported with its name and the problem, never as a number", () => {
  const notJson = readScoreboard(sources({ generation: "{oops" }));
  assert.equal(notJson.generation.status, "invalid");
  if (notJson.generation.status === "invalid") {
    assert.equal(notJson.generation.file, "eval_generation_dev.json");
    assert.match(notJson.generation.problem, /JSON/);
  }
  const wrongShape = readScoreboard(sources({ extraction: JSON.stringify({ macro_recall: "high" }) }));
  assert.equal(wrongShape.extraction.status, "invalid");
  if (wrongShape.extraction.status === "invalid") assert.match(wrongShape.extraction.problem, /macro_recall/);
  assert.equal(wrongShape.generation.status, "ok", "one broken file does not hide the others");
});

test("values the reports leave null stay null (shown as not available), never 0", () => {
  const cost = JSON.parse(COST) as { hosted_model: string | null; summary: { all: Record<string, unknown>; update: Record<string, unknown> } };
  cost.hosted_model = null;
  cost.summary.all.mean_hosted_usd_estimate = null;
  cost.summary.all.mean_elapsed_to_ready_seconds = null;
  cost.summary.update.carry_over_saving_usd_estimate = null;
  const generation = JSON.parse(GENERATION) as { totals: { citation_accuracy: Record<string, unknown> } };
  generation.totals.citation_accuracy.normalized = null;
  const s = readScoreboard(sources({ cost: JSON.stringify(cost), generation: JSON.stringify(generation) }));
  assert.equal(s.generation.status === "ok" ? s.generation.citationAccuracy : "not ok", null);
  assert.equal(s.cost.status, "ok");
  if (s.cost.status !== "ok") return;
  assert.deepEqual([s.cost.meanHostedUsd, s.cost.hostedModel, s.cost.meanElapsedSeconds, s.cost.savingUsd], [null, null, null, null]);
});

test("a generation run with failed documents or procedures is reported, so a partial run cannot pass as a clean 0", () => {
  const partial = JSON.parse(GENERATION) as { totals: Record<string, unknown> };
  partial.totals.documents_failed = 1;
  partial.totals.procedures_failed = 4;
  const s = readScoreboard(sources({ generation: JSON.stringify(partial) }));
  assert.equal(s.generation.status, "ok");
  if (s.generation.status !== "ok") return;
  assert.deepEqual([s.generation.documents, s.generation.documentsFailed, s.generation.proceduresFailed], [12, 1, 4]);
});

test("extraction recall says how many documents it covers, including those docproc skipped", () => {
  const partial = JSON.parse(EXTRACTION) as { extraction: unknown[]; skipped: unknown[] };
  partial.extraction = partial.extraction.slice(0, 9);
  partial.skipped = [1, 2, 3].map((i) => ({ document_id: `scan-${i}`, reason: "scan: needs a live OCR engine" }));
  const s = readScoreboard(sources({ extraction: JSON.stringify(partial) }));
  assert.equal(s.extraction.status, "ok");
  if (s.extraction.status !== "ok") return;
  assert.deepEqual([s.extraction.scored, s.extraction.skipped, s.extraction.date], [9, 3, null]);
});

test("a malformed date makes the file invalid instead of a garbled label", () => {
  const bad = JSON.parse(GENERATION) as { run: Record<string, unknown> };
  bad.run.date = "yesterday";
  const s = readScoreboard(sources({ generation: JSON.stringify(bad) }));
  assert.equal(s.generation.status, "invalid");
  if (s.generation.status === "invalid") assert.match(s.generation.problem, /run\.date/);
});

test("the real producers' output is read as ok (contract with generation-eval and cost-time)", () => {
  const generation = JSON.stringify(buildReport({ date: "2026-11-27T12:00:00.000Z", model: "gemma4:latest" }, []));
  const prices = parseLlmPrices('{"gemma4:latest":{"input":0,"output":0}}', "gemma4:latest");
  const cost = JSON.stringify({ generated_at: "2026-11-27T13:00:00.000Z", llm_model: "gemma4:latest", ...buildCostTimeReport([], prices, null) });
  const s = readScoreboard(sources({ generation, cost }));
  assert.equal(s.generation.status, "ok", JSON.stringify(s.generation));
  assert.equal(s.cost.status, "ok", JSON.stringify(s.cost));
  if (s.generation.status === "ok") assert.equal(s.generation.citationAccuracy, null, "no items: null, not 0");
  if (s.cost.status === "ok") assert.equal(s.cost.meanUsd, null, "no versions: null, not 0");
});
