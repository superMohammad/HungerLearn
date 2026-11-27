/**
 * Cost and time per document version (A2c).
 *   pnpm report:cost-time [--hosted-model <model in LLM_PRICES_USD_PER_MTOK>] [--out file.json]
 * Reads the app database (web/.env.local) and writes -/docproc/out/cost_time.json. Read-only: it writes no
 * database row. Dollars are tokens × LLM_PRICES_USD_PER_MTOK, computed now, so a corrected price fixes every
 * report. --hosted-model also prices the same tokens at a hosted model, labelled an estimate.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildCostTimeReport } from "../src/lib/cost-time";
import { loadCostTimeData } from "../src/lib/cost-time-db";
import { sql } from "../src/lib/db";
import { serverEnv } from "../src/lib/env";

const REPO = path.resolve(import.meta.dirname, "..", "..");

const { values } = parseArgs({
  options: {
    "hosted-model": { type: "string" },
    out: { type: "string", default: path.join(REPO, "-", "docproc", "out", "cost_time.json") },
  },
});

function fmt(x: number | null, unit: string, digits = 1, prefix = ""): string {
  return x === null ? "n/a" : `${prefix}${x.toFixed(digits)}${unit}`;
}

async function main(): Promise<void> {
  const env = serverEnv();
  const hostedModel = values["hosted-model"] ?? null;
  if (hostedModel !== null && !env.llmPrices.has(hostedModel)) {
    throw new Error(`--hosted-model "${hostedModel}" has no price in LLM_PRICES_USD_PER_MTOK (models: ${[...env.llmPrices.keys()].join(", ")})`);
  }
  try {
    const report = buildCostTimeReport(await loadCostTimeData(), env.llmPrices, hostedModel);
    const out = { generated_at: new Date().toISOString(), llm_model: env.llmModel, ...report };
    await mkdir(path.dirname(values.out), { recursive: true });
    await writeFile(values.out, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    for (const [kind, s] of Object.entries(report.summary)) {
      console.log(`${kind.padEnd(7)} versions ${String(s.versions).padStart(3)}  processing ${fmt(s.mean_processing_seconds, " s")}  `
        + `elapsed to ready ${fmt(s.mean_elapsed_to_ready_seconds, " s")}  tokens in ${fmt(s.mean_input_tokens, "", 0)} out ${fmt(s.mean_output_tokens, "", 0)}  `
        + `${fmt(s.mean_usd, "", 4, "$")}  hosted estimate ${fmt(s.mean_hosted_usd_estimate, "", 4, "$")}  `
        + `v2 saving estimate ${fmt(s.carry_over_saving_usd_estimate, "", 4, "$")} (unknown for ${s.carry_over_saving_unknown_versions})`);
    }
    const c = report.coverage;
    console.log(`coverage: docproc calls not logged; ${c.zero_token_calls} zero-token call(s), ${c.failed_jobs} failed job(s), ${c.running_jobs} running job(s)`);
    console.log(`-> ${values.out}`);
  } finally {
    await sql().end();
  }
}

await main();
