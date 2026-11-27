/**
 * Cost and time per document version (A2c, plan docs/plans/2026-11-27-cost-time-per-document.md), from the
 * rows the pipeline already writes: ai_calls (A2b), pipeline_jobs and training_packages. Pure: no DB and no
 * server-only, so `pnpm test` covers it. The DB reader is cost-time-db.ts; the report is
 * web/scripts/report-cost-time.mts.
 */
import { costUsd, type LlmPrices } from "@/lib/prices";
import type { Language, Role } from "@/lib/types";

export type CallRow = { purpose: string; model: string; inputTokens: number; outputTokens: number };
export type JobRow = { step: string; status: "running" | "done" | "failed"; startedAt: Date; finishedAt: Date | null };
/** One training package of the version; `carried` = copied from the previous version at zero AI cost. */
export type PackageRow = { procedureKey: string; createdAt: Date; carried: boolean };
export type VersionData = {
  documentId: string;
  versionId: string;
  role: Role;
  language: Language;
  /** The web AI calls logged for this document version (docproc's calls are not logged anywhere yet). */
  calls: CallRow[];
  jobs: JobRow[];
  procedureKeys: string[];
  packages: PackageRow[];
};

/** Calls that generate and verify packages; naming the procedures is excluded from the per-package average. */
const GENERATION_PURPOSES = new Set(["generate.package", "verify.judge"]);

type Usage = { calls: number; input_tokens: number; output_tokens: number; usd: number };
type Estimate = { input_tokens: number; output_tokens: number; usd: number; estimate: true };

function usage(calls: CallRow[], prices: LlmPrices): Usage {
  return {
    calls: calls.length,
    input_tokens: calls.reduce((n, c) => n + c.inputTokens, 0),
    output_tokens: calls.reduce((n, c) => n + c.outputTokens, 0),
    usd: calls.reduce((n, c) => n + costUsd(prices, c.model, c.inputTokens, c.outputTokens), 0),
  };
}

/**
 * Cost of `count` packages at the version's average cost per generated package (generation calls ÷
 * generated packages). Null when the version logged no generation: there is no average to use.
 * Multiplying before dividing keeps exact sums exact.
 */
function packagesAtAverage(v: VersionData, prices: LlmPrices, count: number): Estimate | null {
  const generated = v.packages.filter((p) => !p.carried).length;
  const calls = v.calls.filter((c) => GENERATION_PURPOSES.has(c.purpose));
  if (generated === 0 || calls.length === 0) return null;
  const u = usage(calls, prices);
  return {
    input_tokens: (u.input_tokens * count) / generated,
    output_tokens: (u.output_tokens * count) / generated,
    usd: (u.usd * count) / generated,
    estimate: true,
  };
}

/**
 * A version is complete when its `procedures` (first upload) or `update` (new version) job finished: exactly
 * the steps after which the pipeline sets it as the document's current version, the source of carry-over.
 * A failed or still-running update already has procedures (they are copied first), so procedures alone are not enough.
 */
export function isComplete(v: VersionData): boolean {
  return v.jobs.some((j) => (j.step === "procedures" || j.step === "update") && j.status === "done");
}

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

export function computeVersion(v: VersionData, prices: LlmPrices, options: { hostedModel: string | null; previous: VersionData | null }) {
  const total = usage(v.calls, prices);
  const purposes = [...new Set(v.calls.map((c) => c.purpose))].sort();
  const byPurpose = Object.fromEntries(purposes.map((p) => [p, usage(v.calls.filter((c) => c.purpose === p), prices)]));
  const hosted = options.hostedModel === null
    ? null
    : { model: options.hostedModel, usd: costUsd(prices, options.hostedModel, total.input_tokens, total.output_tokens) };

  // Processing = machine time (finished jobs only). Elapsed = first job → every procedure has its first package.
  const processing = v.jobs.reduce((n, j) => (j.finishedAt === null ? n : n + seconds(j.startedAt, j.finishedAt)), 0);
  const start = v.jobs.length === 0 ? null : new Date(Math.min(...v.jobs.map((j) => j.startedAt.getTime())));
  const firstPackage = v.procedureKeys.map((k) => {
    const times = v.packages.filter((p) => p.procedureKey === k).map((p) => p.createdAt.getTime());
    return times.length === 0 ? null : Math.min(...times);
  });
  const ready = v.procedureKeys.length > 0 && firstPackage.every((t) => t !== null);
  const readyAt = ready ? new Date(Math.max(...firstPackage.map((t) => t ?? 0))) : null;

  const carried = v.packages.filter((p) => p.carried).length;
  const regenerated = v.procedureKeys.reduce((n, k) => n + Math.max(0, v.packages.filter((p) => p.procedureKey === k).length - 1), 0);
  const rework = regenerated === 0 ? { packages: 0, input_tokens: 0, output_tokens: 0, usd: 0, estimate: true as const } : (() => {
    const e = packagesAtAverage(v, prices, regenerated);
    return e === null ? null : { packages: regenerated, ...e };
  })();
  // Incomplete or no previous version: no saving (null). Nothing carried: exactly 0 saved, which is known.
  // Carried but no logged generation to average: unknown (null), never a made-up 0.
  const complete = isComplete(v);
  const saving = !complete || options.previous === null ? null : carried === 0
    ? { procedures: 0, input_tokens: 0, output_tokens: 0, usd: 0, estimate: true as const }
    : (() => {
      const e = packagesAtAverage(options.previous, prices, carried);
      return e === null ? null : { procedures: carried, ...e };
    })();

  return {
    document_id: v.documentId,
    version_id: v.versionId,
    role: v.role,
    language: v.language,
    // Not complete: the upload failed or is still running, so it is neither a first upload nor an update.
    kind: !complete ? ("incomplete" as const) : options.previous === null ? ("first" as const) : ("update" as const),
    cost: { ...total, by_purpose: byPurpose, hosted_estimate: hosted },
    time: {
      processing_seconds: processing,
      elapsed_to_ready_seconds: start === null || readyAt === null ? null : seconds(start, readyAt),
      ready,
    },
    packages: { procedures: v.procedureKeys.length, generated: v.packages.length - carried, carried, regenerated },
    rework_estimate: rework,
    carry_over_saving_estimate: saving,
    coverage: {
      docproc_calls_not_logged: true as const,
      zero_token_calls: v.calls.filter((c) => c.inputTokens + c.outputTokens === 0).length,
      failed_jobs: v.jobs.filter((j) => j.status === "failed").length,
      running_jobs: v.jobs.filter((j) => j.status === "running").length,
    },
  };
}

export type VersionReport = ReturnType<typeof computeVersion>;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function summarizeVersions(versions: VersionReport[]) {
  const ready = versions.flatMap((v) => (v.time.elapsed_to_ready_seconds === null ? [] : [v.time.elapsed_to_ready_seconds]));
  const hosted = versions.flatMap((v) => (v.cost.hosted_estimate === null ? [] : [v.cost.hosted_estimate.usd]));
  const known = versions.flatMap((v) => (v.carry_over_saving_estimate === null ? [] : [v.carry_over_saving_estimate.usd]));
  return {
    versions: versions.length,
    /** Headline time (decision 3): machine time, independent of how fast someone clicks "generate". */
    mean_processing_seconds: mean(versions.map((v) => v.time.processing_seconds)),
    /** Over the versions that are ready for review only. */
    mean_elapsed_to_ready_seconds: mean(ready),
    mean_input_tokens: mean(versions.map((v) => v.cost.input_tokens)),
    mean_output_tokens: mean(versions.map((v) => v.cost.output_tokens)),
    mean_usd: mean(versions.map((v) => v.cost.usd)),
    mean_hosted_usd_estimate: mean(hosted),
    /** Sum of the known savings; null when none is known. Unknown ones are counted, never added as 0. */
    carry_over_saving_usd_estimate: known.length === 0 ? null : known.reduce((n, usd) => n + usd, 0),
    /** Updates that carried packages but whose saving is unknown (no logged generation in the previous version). */
    carry_over_saving_unknown_versions: versions.filter((v) => v.packages.carried > 0 && v.carry_over_saving_estimate === null).length,
  };
}

function summarizeBy<K extends string>(versions: VersionReport[], keyOf: (v: VersionReport) => K): Record<K, ReturnType<typeof summarizeVersions>> {
  const keys = [...new Set(versions.map(keyOf))].sort();
  return Object.fromEntries(keys.map((k) => [k, summarizeVersions(versions.filter((v) => keyOf(v) === k))])) as Record<K, ReturnType<typeof summarizeVersions>>;
}

/**
 * Every version, each paired with the nearest earlier complete version of its document (by first job
 * time). Carry-over copies from the last successful version, so a failed or running upload in between
 * is never the source.
 */
export function buildCostTimeReport(versions: VersionData[], prices: LlmPrices, hostedModel: string | null) {
  const firstJob = (v: VersionData): number => (v.jobs.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...v.jobs.map((j) => j.startedAt.getTime())));
  const ordered = [...versions].sort((a, b) => a.documentId.localeCompare(b.documentId) || firstJob(a) - firstJob(b) || a.versionId.localeCompare(b.versionId));
  const reports = ordered.map((v, i) => {
    const previous = ordered.slice(0, i).reverse().find((p) => p.documentId === v.documentId && isComplete(p)) ?? null;
    return computeVersion(v, prices, { hostedModel, previous });
  });
  return {
    hosted_model: hostedModel,
    coverage: {
      docproc_calls_not_logged: true as const,
      zero_token_calls: reports.reduce((n, r) => n + r.coverage.zero_token_calls, 0),
      failed_jobs: reports.reduce((n, r) => n + r.coverage.failed_jobs, 0),
      running_jobs: reports.reduce((n, r) => n + r.coverage.running_jobs, 0),
    },
    summary: {
      all: summarizeVersions(reports),
      first: summarizeVersions(reports.filter((r) => r.kind === "first")),
      update: summarizeVersions(reports.filter((r) => r.kind === "update")),
      incomplete: summarizeVersions(reports.filter((r) => r.kind === "incomplete")),
    },
    by_role: summarizeBy(reports, (r) => r.role),
    by_language: summarizeBy(reports, (r) => r.language),
    versions: reports,
  };
}
