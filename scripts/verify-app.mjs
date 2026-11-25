// @ts-check
/**
 * Runtime verification: walks docs/feature-map.md rows in a real browser (Arabic and English) against a
 * running app and saves screenshots, traces and an HTML report to .verify/<branch>/.
 * Covers the rows that need no LLM (F01 landing + language, F02 auth + guards, F06 readiness page).
 *
 * Needs: the app running (cd web && pnpm dev), a migrated and seeded database (pnpm db:migrate &&
 * pnpm db:seed), and DEMO_PASSWORD in web/.env.local or the environment.
 *
 * Usage: node scripts/verify-app.mjs              # every row
 *        node scripts/verify-app.mjs F01 F02      # only these rows
 *        BASE_URL=http://localhost:3001 node scripts/verify-app.mjs   # app on another port
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { CheckFailed, git, REPO, run, runMain, WEB } from "./lib/hl.mjs";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const reachable = await fetch(`${baseUrl}/signin`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);

runMain(() => {
  if (!reachable) throw new CheckFailed(`The app is not reachable at ${baseUrl}. Start it first: cd web && pnpm dev`);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim().replaceAll("/", "-");
  const verifyDir = path.join(REPO, ".verify", branch);
  const rows = process.argv.slice(2);
  const bad = rows.filter((r) => !/^F\d\d$/.test(r));
  if (bad.length > 0) throw new CheckFailed(`Row ids look like F01 (see docs/feature-map.md); got: ${bad.join(", ")}`);

  rmSync(verifyDir, { recursive: true, force: true });
  mkdirSync(verifyDir, { recursive: true });
  process.env.BASE_URL = baseUrl;
  process.env.VERIFY_DIR = verifyDir;
  process.env.VERIFY_ROWS = rows.join(",");
  run("pnpm", ["exec", "playwright", "test"], WEB);
  console.log(`== evidence: ${verifyDir} (report: ${path.join(verifyDir, "report", "index.html")})`);
});
