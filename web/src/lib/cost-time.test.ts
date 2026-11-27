import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCostTimeReport, computeVersion, type VersionData } from "./cost-time";
import { parseLlmPrices } from "./prices";

const PRICES = parseLlmPrices('{"gemma4:latest":{"input":0,"output":0},"hosted":{"input":1,"output":4}}', "gemma4:latest");
const PAID = parseLlmPrices('{"m":{"input":2,"output":10}}', "m");
const T0 = new Date("2026-11-27T10:00:00Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

/** Dollars are binary floating point (0.8 × 3 / 2 = 1.2000000000000002): compare within 1e-8. */
function assertUsd(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-8, `expected $${expected}, got $${actual}`);
}

function call(purpose: string, inputTokens: number, outputTokens: number, model = "gemma4:latest") {
  return { purpose, model, inputTokens, outputTokens };
}

function version(over: Partial<VersionData> = {}): VersionData {
  return {
    documentId: "courier-pickup-wait",
    versionId: "v1",
    role: "courier",
    language: "ar",
    calls: [],
    jobs: [],
    procedureKeys: [],
    packages: [],
    ...over,
  };
}

test("tokens, dollars and the split by purpose are exact", () => {
  const v = version({
    calls: [call("understand.name_procedures", 1_000_000, 0, "m"), call("generate.package", 500_000, 100_000, "m"), call("verify.judge", 0, 100_000, "m")],
  });
  const r = computeVersion(v, PAID, { hostedModel: null, previous: null });
  assert.deepEqual(
    { calls: r.cost.calls, input: r.cost.input_tokens, output: r.cost.output_tokens, usd: r.cost.usd },
    { calls: 3, input: 1_500_000, output: 200_000, usd: 2 + 1 + 1 + 1 },
  );
  assert.deepEqual(r.cost.by_purpose["generate.package"], { calls: 1, input_tokens: 500_000, output_tokens: 100_000, usd: 2 });
  assert.equal(r.cost.hosted_estimate, null);
});

test("a call with a model that has no price fails with the model's name, never a silent 0", () => {
  const v = version({ calls: [call("generate.package", 10, 10, "gpt-unknown")] });
  assert.throws(() => computeVersion(v, PRICES, { hostedModel: null, previous: null }), /No price for model "gpt-unknown"/);
});

test("the hosted estimate prices the same tokens at the named hosted model, and an unknown hosted model fails", () => {
  const v = version({ calls: [call("generate.package", 1_000_000, 500_000)] });
  const r = computeVersion(v, PRICES, { hostedModel: "hosted", previous: null });
  assert.equal(r.cost.usd, 0, "local Gemma is free");
  assert.deepEqual(r.cost.hosted_estimate, { model: "hosted", usd: 1 + 2 });
  assert.throws(() => computeVersion(v, PRICES, { hostedModel: "nope", previous: null }), /No price for model "nope"/);
});

test("processing time sums job durations; elapsed runs from the first job to the last procedure's first package", () => {
  const v = version({
    jobs: [
      { step: "queued", status: "done", startedAt: at(0), finishedAt: at(0) },
      { step: "understand", status: "done", startedAt: at(1), finishedAt: at(61) },
      { step: "procedures", status: "done", startedAt: at(61), finishedAt: at(71) },
      { step: "generate:A", status: "done", startedAt: at(600), finishedAt: at(660) },
      { step: "generate:B", status: "done", startedAt: at(900), finishedAt: at(990) },
    ],
    procedureKeys: ["A", "B"],
    packages: [
      { procedureKey: "A", createdAt: at(655), carried: false },
      { procedureKey: "B", createdAt: at(985), carried: false },
    ],
  });
  const r = computeVersion(v, PRICES, { hostedModel: null, previous: null });
  assert.equal(r.time.processing_seconds, 60 + 10 + 60 + 90);
  assert.equal(r.time.elapsed_to_ready_seconds, 985);
  assert.equal(r.kind, "first");
});

test("a version where one procedure has no package is not ready: elapsed is null, processing is still reported", () => {
  const v = version({
    jobs: [{ step: "understand", status: "done", startedAt: at(0), finishedAt: at(30) }],
    procedureKeys: ["A", "B"],
    packages: [{ procedureKey: "A", createdAt: at(100), carried: false }],
  });
  const r = computeVersion(v, PRICES, { hostedModel: null, previous: null });
  assert.equal(r.time.elapsed_to_ready_seconds, null);
  assert.equal(r.time.ready, false);
  assert.equal(r.time.processing_seconds, 30);
  assert.equal(computeVersion(version(), PRICES, { hostedModel: null, previous: null }).time.ready, false, "no procedures: not ready");
});

test("a v2 with 3 carried and 1 regenerated procedure saves 3 × v1's average cost per generated package", () => {
  const v1 = version({
    calls: [call("understand.name_procedures", 999, 999, "m"), call("generate.package", 100_000, 0, "m"), call("verify.judge", 100_000, 0, "m"), call("generate.package", 200_000, 0, "m")],
    procedureKeys: ["A", "B"],
    packages: [
      { procedureKey: "A", createdAt: at(10), carried: false },
      { procedureKey: "B", createdAt: at(20), carried: false },
    ],
  });
  const v2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "done", startedAt: at(100), finishedAt: at(160) }],
    procedureKeys: ["A", "B", "C", "D"],
    packages: ["A", "B", "C"].map((k) => ({ procedureKey: k, createdAt: at(150), carried: true })).concat([{ procedureKey: "D", createdAt: at(155), carried: false }]),
  });
  const r = computeVersion(v2, PAID, { hostedModel: null, previous: v1 });
  assert.equal(r.kind, "update");
  assert.deepEqual(r.packages, { procedures: 4, generated: 1, carried: 3, regenerated: 0 });
  // v1: generation tokens (packages + judges, naming excluded) 400,000 input over 2 packages = 200,000 per package = $0.40.
  const saving = r.carry_over_saving_estimate;
  assert.ok(saving !== null);
  const { usd: savingUsd, ...savingRest } = saving;
  assert.deepEqual(savingRest, { procedures: 3, input_tokens: 600_000, output_tokens: 0, estimate: true });
  assertUsd(savingUsd, 1.2);
});

test("without logged generation in the previous version, the saving is null, not 0", () => {
  const v1 = version({ procedureKeys: ["A"], packages: [] });
  const v2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "done", startedAt: at(0), finishedAt: at(2) }],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(1), carried: true }],
  });
  assert.equal(computeVersion(v2, PRICES, { hostedModel: null, previous: v1 }).carry_over_saving_estimate, null);
  assert.equal(computeVersion(v2, PRICES, { hostedModel: null, previous: null }).carry_over_saving_estimate, null);
});

test("a procedure with two generated packages counts one regeneration, estimated at the version's average cost per package", () => {
  const v = version({
    calls: [call("generate.package", 300_000, 0, "m"), call("generate.package", 300_000, 0, "m"), call("verify.judge", 0, 0, "m")],
    procedureKeys: ["A"],
    packages: [
      { procedureKey: "A", createdAt: at(10), carried: false },
      { procedureKey: "A", createdAt: at(50), carried: false },
    ],
  });
  const r = computeVersion(v, PAID, { hostedModel: null, previous: null });
  assert.equal(r.packages.regenerated, 1);
  const rework = r.rework_estimate;
  assert.ok(rework !== null);
  const { usd: reworkUsd, ...reworkRest } = rework;
  assert.deepEqual(reworkRest, { packages: 1, input_tokens: 300_000, output_tokens: 0, estimate: true });
  assertUsd(reworkUsd, 0.6);
  assert.equal(r.time.elapsed_to_ready_seconds, null, "no jobs: no start time");
});

test("coverage flags: docproc calls are never logged, 0-token calls, failed and running jobs are counted", () => {
  const v = version({
    calls: [call("generate.package", 0, 0), call("verify.judge", 5, 1)],
    jobs: [
      { step: "understand", status: "failed", startedAt: at(0), finishedAt: at(5) },
      { step: "generate:A", status: "running", startedAt: at(10), finishedAt: null },
    ],
  });
  const r = computeVersion(v, PRICES, { hostedModel: null, previous: null });
  assert.deepEqual(r.coverage, { docproc_calls_not_logged: true, zero_token_calls: 1, failed_jobs: 1, running_jobs: 1 });
  assert.equal(r.time.processing_seconds, 5, "a running job has no duration yet");
});

test("the report pairs each version with the previous version of the same document and averages by kind", () => {
  const v1 = version({
    jobs: [{ step: "procedures", status: "done", startedAt: at(0), finishedAt: at(100) }],
    calls: [call("generate.package", 100, 0)],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(50), carried: false }],
  });
  const v2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "done", startedAt: at(1000), finishedAt: at(1020) }],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(1010), carried: true }],
  });
  const other = version({
    documentId: "employee-delayed-order",
    role: "employee",
    language: "en",
    jobs: [{ step: "procedures", status: "done", startedAt: at(5), finishedAt: at(45) }],
    procedureKeys: ["X"],
  });
  const report = buildCostTimeReport([v2, other, v1], PRICES, "hosted");
  assert.deepEqual(report.versions.map((v) => `${v.document_id}@${v.version_id}`), ["courier-pickup-wait@v1", "courier-pickup-wait@v2", "employee-delayed-order@v1"]);
  assert.equal(report.versions[1].carry_over_saving_estimate?.procedures, 1);
  assert.equal(report.summary.first.versions, 2);
  assert.equal(report.summary.first.mean_processing_seconds, (100 + 40) / 2);
  assert.equal(report.summary.update.mean_processing_seconds, 20);
  assert.equal(report.summary.first.mean_elapsed_to_ready_seconds, 50, "only ready versions are averaged");
  assert.deepEqual(Object.keys(report.by_role), ["courier", "employee"]);
  assert.equal(report.by_role.courier.versions, 2);
  assert.equal(report.by_language.en.mean_processing_seconds, 40);
  assert.equal(report.hosted_model, "hosted");
  assert.equal(report.coverage.docproc_calls_not_logged, true);
  assert.equal(buildCostTimeReport([], PRICES, null).summary.all.mean_processing_seconds, null);
});

test("a failed upload between v1 and v2 is incomplete: v2 is paired with v1, and the failure skews no average", () => {
  const v1 = version({
    jobs: [{ step: "procedures", status: "done", startedAt: at(0), finishedAt: at(100) }],
    calls: [call("generate.package", 100_000, 0, "m")],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(50), carried: false }],
  });
  const failed = version({ versionId: "vX", jobs: [{ step: "understand", status: "failed", startedAt: at(500), finishedAt: at(530) }] });
  const v2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "done", startedAt: at(1000), finishedAt: at(1020) }],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(1010), carried: true }],
  });
  const report = buildCostTimeReport([v2, failed, v1], PAID, null);
  assert.deepEqual(report.versions.map((v) => `${v.version_id}:${v.kind}`), ["v1:first", "vX:incomplete", "v2:update"]);
  assert.equal(report.versions[2].carry_over_saving_estimate?.input_tokens, 100_000, "v2 uses v1's average, not the failed upload's");
  assert.equal(report.summary.update.versions, 1);
  assert.equal(report.summary.update.mean_processing_seconds, 20);
  assert.equal(report.summary.incomplete.versions, 1);
  assert.equal(report.coverage.failed_jobs, 1);
});

test("a failed update is incomplete even though it already has procedures and carried packages; v3 is paired with v1", () => {
  const v1 = version({
    jobs: [{ step: "procedures", status: "done", startedAt: at(0), finishedAt: at(100) }],
    calls: [call("generate.package", 100_000, 0, "m")],
    procedureKeys: ["A", "B"],
    packages: [{ procedureKey: "A", createdAt: at(50), carried: false }, { procedureKey: "B", createdAt: at(60), carried: false }],
  });
  const failedV2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "failed", startedAt: at(1000), finishedAt: at(1030) }],
    procedureKeys: ["A", "B"],
    packages: [{ procedureKey: "A", createdAt: at(1010), carried: true }],
  });
  const v3 = version({
    versionId: "v3",
    jobs: [{ step: "update", status: "done", startedAt: at(2000), finishedAt: at(2020) }],
    procedureKeys: ["A", "B"],
    packages: [{ procedureKey: "A", createdAt: at(2010), carried: true }, { procedureKey: "B", createdAt: at(2015), carried: true }],
  });
  const report = buildCostTimeReport([v3, failedV2, v1], PAID, null);
  assert.deepEqual(report.versions.map((v) => `${v.version_id}:${v.kind}`), ["v1:first", "v2:incomplete", "v3:update"]);
  assert.equal(report.versions[1].carry_over_saving_estimate, null, "an incomplete version has no saving");
  assert.equal(report.versions[2].carry_over_saving_estimate?.input_tokens, 100_000, "2 carried × v1's 50,000 per package");
  assert.equal(report.summary.update.versions, 1);
  assert.equal(report.summary.incomplete.carry_over_saving_usd_estimate, null);
});

test("unknown savings are reported as unknown, never added up as $0", () => {
  const noGeneration = version({ procedureKeys: ["A"], packages: [{ procedureKey: "A", createdAt: at(1), carried: false }], jobs: [{ step: "procedures", status: "done", startedAt: at(0), finishedAt: at(1) }] });
  const v2 = version({ versionId: "v2", procedureKeys: ["A"], packages: [{ procedureKey: "A", createdAt: at(20), carried: true }], jobs: [{ step: "update", status: "done", startedAt: at(10), finishedAt: at(20) }] });
  const unknown = buildCostTimeReport([noGeneration, v2], PAID, null).summary.update;
  assert.equal(unknown.carry_over_saving_usd_estimate, null);
  assert.equal(unknown.carry_over_saving_unknown_versions, 1);

  const other = version({
    documentId: "other",
    calls: [call("generate.package", 500_000, 0, "m")],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(1), carried: false }],
    jobs: [{ step: "procedures", status: "done", startedAt: at(0), finishedAt: at(1) }],
  });
  const otherV2 = version({ ...v2, documentId: "other" });
  const mixed = buildCostTimeReport([noGeneration, v2, other, otherV2], PAID, null).summary.update;
  assertUsd(mixed.carry_over_saving_usd_estimate ?? undefined, 1);
  assert.equal(mixed.carry_over_saving_unknown_versions, 1, "the known part is summed, the unknown part is counted");
});

test("an update that carried nothing saved exactly 0, which is known, not unknown", () => {
  const v1 = version({ procedureKeys: ["A"], packages: [{ procedureKey: "A", createdAt: at(1), carried: false }] });
  const v2 = version({
    versionId: "v2",
    jobs: [{ step: "update", status: "done", startedAt: at(2), finishedAt: at(6) }],
    procedureKeys: ["A"],
    packages: [{ procedureKey: "A", createdAt: at(5), carried: false }],
  });
  assert.deepEqual(computeVersion(v2, PRICES, { hostedModel: null, previous: v1 }).carry_over_saving_estimate, {
    procedures: 0, input_tokens: 0, output_tokens: 0, usd: 0, estimate: true,
  });
});
