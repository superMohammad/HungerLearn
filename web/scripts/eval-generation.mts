/**
 * Generation eval (A2a): runs the app's real groupProcedures + buildPackage on the dev originals' gold
 * clauses and scores citation accuracy and items publishable with a failed check.
 *   pnpm eval:generation [--documents id1,id2] [--out file.json] [--keep-db]
 * Needs a real LLM (web/.env.local). AI calls are logged in a throwaway database hl_eval_<random> on
 * DATABASE_URL's server, created here and dropped at the end; the app's own database is never written.
 * Output: -/docproc/out/eval_generation_dev.json (next to docproc eval's output).
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { buildReport, loadDevOriginals, scoreProcedure, type DocumentResult, type ProcedureOutcome, type Summary } from "../src/lib/generation-eval";

const WEB = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(WEB, "..");
const DATASET = path.join(REPO, "data", "synthetic_sops");

const { values } = parseArgs({
  options: {
    documents: { type: "string" },
    out: { type: "string", default: path.join(REPO, "-", "docproc", "out", "eval_generation_dev.json") },
    "keep-db": { type: "boolean", default: false },
  },
});

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set (see web/.env.example)`);
  return value;
}

function gitCommit(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : `unknown (${r.stderr.trim()})`;
}

function migrate(url: string): void {
  const tsx = path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs");
  const r = spawnSync(process.execPath, [tsx, "scripts/migrate.mts"], { cwd: WEB, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`migrations failed on the eval database:\n${r.stdout}\n${r.stderr}`);
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function line(label: string, s: Summary): string {
  return `${label.padEnd(8)} items ${String(s.items).padStart(4)}  citation accuracy ${pct(s.citation_accuracy.normalized)} (exact ${pct(s.citation_accuracy.exact)})  `
    + `silent failures ${s.silent_failures}  publishable with failed check ${s.publishable_with_failed_check}  `
    + `procedures ${s.procedures} (failed ${s.procedures_failed}, skipped ${s.packages_skipped})`;
}

async function main(): Promise<void> {
  const only = values.documents?.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const documents = await loadDevOriginals(DATASET, { only });
  if (documents.length === 0) throw new Error("no dev originals selected");

  const adminUrl = requiredEnv("DATABASE_URL");
  const dbName = `hl_eval_${randomBytes(6).toString("hex")}`;
  // Everything that can fail on configuration is computed before CREATE DATABASE, so a config mistake
  // never leaves an hl_eval_* database behind.
  const evalUrl = withDatabase(adminUrl, dbName);
  const evalReadonlyUrl = withDatabase(requiredEnv("READONLY_DATABASE_URL"), dbName);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  console.log(`eval database ${dbName} (${values["keep-db"] ? "kept" : "dropped"} at the end)`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  // The app code reads its pools from these; set before the first query so nothing touches the app database.
  process.env.DATABASE_URL = evalUrl;
  process.env.READONLY_DATABASE_URL = evalReadonlyUrl;

  let closeAppPool: (() => Promise<void>) | null = null;
  try {
    migrate(evalUrl);
    const { buildPackage, groupProcedures } = await import("../src/lib/generation");
    const { sql } = await import("../src/lib/db");
    const { serverEnv } = await import("../src/lib/env");
    const { canPublishWithFlags } = await import("../src/lib/publication-rules");
    const env = serverEnv();
    const pool = sql();
    closeAppPool = () => pool.end();

    const results: DocumentResult[] = [];
    for (const d of documents) {
      await sql()`INSERT INTO hl_documents (document_id, title, role, partner_type, language)
                  VALUES (${d.documentId}, ${d.doc.title}, ${d.doc.role}, ${d.doc.partnerType}, ${d.doc.language})`;
      const scored: DocumentResult["procedures"] = [];
      let error: string | null = null;
      try {
        const drafts = await groupProcedures(d.doc, d.versionId, d.clauses);
        for (const [ordinal, draft] of drafts.entries()) {
          const procedure = {
            id: randomUUID(),
            documentId: d.documentId,
            versionId: d.versionId,
            procedureKey: `P${ordinal + 1}`,
            ordinal,
            ...draft,
          };
          const clauses = d.clauses.filter((c) => draft.stableIds.includes(c.stableId));
          let outcome: ProcedureOutcome;
          try {
            const pkg = await buildPackage(d.doc, procedure, d.clauses, "");
            outcome = { procedureKey: procedure.procedureKey, title: draft.title, clauses, result: { kind: "package", status: pkg.status, items: pkg.items } };
          } catch (e) {
            outcome = { procedureKey: procedure.procedureKey, title: draft.title, clauses, result: { kind: "error", message: e instanceof Error ? e.message : String(e) } };
          }
          scored.push(scoreProcedure(outcome, canPublishWithFlags));
          console.log(`  ${d.documentId} ${procedure.procedureKey}/${drafts.length} ${outcome.result.kind === "error" ? `ERROR ${outcome.result.message}` : `${outcome.result.status}, ${outcome.result.items.length} items`}`);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.log(`  ${d.documentId} ERROR ${error}`);
      }
      const [t] = await sql()<{ calls: number; input: number; output: number }[]>`
        SELECT count(*)::int AS calls, COALESCE(sum(input_tokens), 0)::int AS input, COALESCE(sum(output_tokens), 0)::int AS output
        FROM ai_calls WHERE document_id = ${d.documentId}`;
      results.push({ document: d, procedures: scored, error, tokens: { calls: t.calls, input: t.input, output: t.output } });
    }

    const promptVersions = (await sql()<{ v: string }[]>`SELECT DISTINCT prompt_version AS v FROM ai_calls ORDER BY 1`).map((r) => r.v);
    const report = buildReport(
      {
        date: new Date().toISOString(),
        commit: gitCommit(),
        model: env.llmModel,
        llm_host: new URL(env.llmBaseUrl).host,
        reasoning_effort: env.llmReasoningEffort,
        prompt_versions: promptVersions,
        input: "dev originals' gold clauses (data/synthetic_sops/dev/gold/extraction.json); held_out never read",
        publication_rule: "publication-rules.ts canPublishWithFlags (the app's approve rule)",
        documents: documents.map((d) => d.documentId),
      },
      results,
    );
    await mkdir(path.dirname(values.out), { recursive: true });
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`\n${line("total", report.totals)}`);
    for (const [k, s] of Object.entries(report.by_generation)) console.log(line(k, s));
    console.log(`-> ${values.out}`);
    const failures = report.totals.documents_failed + report.totals.procedures_failed;
    if (failures > 0) {
      // The JSON is still written, but a run with failed procedures (e.g. the LLM was unreachable) is not a clean result.
      console.error(`${failures} document(s)/procedure(s) failed; see "error" in the JSON. Exit code 1.`);
      process.exitCode = 1;
    }
  } finally {
    try {
      await closeAppPool?.();
    } finally {
      try {
        if (!values["keep-db"]) await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
}

await main();
