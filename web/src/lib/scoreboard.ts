/**
 * The scoreboard's numbers (A2d), read from the result files the team's commands write into docproc's out/
 * folder. Pure: it gets the files' text (null when a file does not exist) and checks its shape, so
 * `pnpm test` covers it. A missing file is "not run yet" with its command; a broken file names the
 * problem. Neither ever becomes a number.
 */
import { z } from "zod";

export const SCOREBOARD_FILES = {
  extraction: { file: "eval_dev_real.json", command: "cd -/docproc && docproc eval --real" },
  generation: { file: "eval_generation_dev.json", command: "cd web && pnpm eval:generation" },
  cost: { file: "cost_time.json", command: "cd web && pnpm report:cost-time --hosted-model <model>" },
} as const;

type Source = keyof typeof SCOREBOARD_FILES;
export type ScoreboardSources = Record<Source, string | null>;

const rate = z.number().min(0).max(1).nullable();
const ExtractionSchema = z.object({ llm_model: z.string(), macro_recall: z.number().min(0).max(1), macro_precision: z.number().min(0).max(1) });
const GenerationSchema = z.object({
  run: z.object({ date: z.string(), model: z.string() }),
  totals: z.object({
    items: z.number().int().min(0),
    citation_accuracy: z.object({ normalized: rate, exact: rate }),
    silent_failures: z.number().int().min(0),
    publishable_with_failed_check: z.number().int().min(0),
  }),
});
const SummarySchema = z.object({
  versions: z.number().int().min(0),
  mean_processing_seconds: z.number().nullable(),
  mean_elapsed_to_ready_seconds: z.number().nullable(),
  mean_input_tokens: z.number().nullable(),
  mean_output_tokens: z.number().nullable(),
  mean_usd: z.number().nullable(),
  mean_hosted_usd_estimate: z.number().nullable(),
  carry_over_saving_usd_estimate: z.number().nullable(),
  carry_over_saving_unknown_versions: z.number().int().min(0),
});
const CostSchema = z.object({
  generated_at: z.string(),
  llm_model: z.string(),
  hosted_model: z.string().nullable(),
  coverage: z.object({
    docproc_calls_not_logged: z.boolean(),
    zero_token_calls: z.number().int().min(0),
    failed_jobs: z.number().int().min(0),
    running_jobs: z.number().int().min(0),
  }),
  summary: z.object({ all: SummarySchema, update: SummarySchema }),
});

type Missing = { status: "missing"; file: string; command: string };
type Invalid = { status: "invalid"; file: string; problem: string };
type Result<T> = ({ status: "ok" } & T) | Missing | Invalid;

function parse<S extends z.ZodType, T>(source: Source, text: string | null, schema: S, view: (data: z.infer<S>) => T): Result<T> {
  const { file, command } = SCOREBOARD_FILES[source];
  if (text === null) return { status: "missing", file, command };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { status: "invalid", file, problem: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { status: "invalid", file, problem: parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ") };
  }
  return { status: "ok", ...view(parsed.data) };
}

export function readScoreboard(sources: ScoreboardSources) {
  return {
    extraction: parse("extraction", sources.extraction, ExtractionSchema, (d) => ({ recall: d.macro_recall, precision: d.macro_precision, model: d.llm_model })),
    generation: parse("generation", sources.generation, GenerationSchema, (d) => ({
      items: d.totals.items,
      citationAccuracy: d.totals.citation_accuracy.normalized,
      citationAccuracyExact: d.totals.citation_accuracy.exact,
      silentFailures: d.totals.silent_failures,
      publishableWithFailedCheck: d.totals.publishable_with_failed_check,
      model: d.run.model,
      date: d.run.date,
    })),
    cost: parse("cost", sources.cost, CostSchema, (d) => ({
      versions: d.summary.all.versions,
      meanUsd: d.summary.all.mean_usd,
      meanHostedUsd: d.summary.all.mean_hosted_usd_estimate,
      hostedModel: d.hosted_model,
      meanInputTokens: d.summary.all.mean_input_tokens,
      meanOutputTokens: d.summary.all.mean_output_tokens,
      meanProcessingSeconds: d.summary.all.mean_processing_seconds,
      meanElapsedSeconds: d.summary.all.mean_elapsed_to_ready_seconds,
      updates: d.summary.update.versions,
      savingUsd: d.summary.update.carry_over_saving_usd_estimate,
      savingUnknownVersions: d.summary.update.carry_over_saving_unknown_versions,
      coverage: {
        docprocCallsNotLogged: d.coverage.docproc_calls_not_logged,
        zeroTokenCalls: d.coverage.zero_token_calls,
        failedJobs: d.coverage.failed_jobs,
        runningJobs: d.coverage.running_jobs,
      },
      model: d.llm_model,
      date: d.generated_at,
    })),
  };
}

export type Scoreboard = ReturnType<typeof readScoreboard>;
