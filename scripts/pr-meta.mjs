// @ts-check
/**
 * Writes a PR's author and reviews (oldest first) as the JSON that scripts/pr-policy.mjs reads, from GitHub via
 * `gh api`. CI runs it before pr-policy (GH_TOKEN and GH_REPO set); locally gh uses your login and this clone's remote.
 * Usage: node scripts/pr-meta.mjs <pr-number> <out-file>
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { CheckFailed, REPO, runMain } from "./lib/hl.mjs";
import { prMetaFromGh } from "./lib/policy.mjs";

const ATTEMPTS = 3;
const BACKOFF_MS = 2000;
const GH_TIMEOUT_MS = 60_000;

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `gh api <args>` and returns its stdout; retries with a structured warning, then raises the last failure.
 * @param {readonly string[]} args @returns {string}
 */
function ghApi(args) {
  /** @type {string} */
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const run = spawnSync("gh", ["api", ...args], { cwd: REPO, encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    if (run.status === 0) return run.stdout;
    last = JSON.stringify({ args, status: run.status, signal: run.signal, error: run.error?.message ?? null, stderr: run.stderr?.slice(0, 2000) ?? null });
    if (attempt < ATTEMPTS) {
      console.warn(JSON.stringify({ event: "gh_api_retry", attempt, attempts: ATTEMPTS, failure: JSON.parse(last) }));
      sleep(BACKOFF_MS * attempt);
    }
  }
  throw new CheckFailed(`pr-meta: gh api failed ${ATTEMPTS} times: ${last}`);
}

runMain(() => {
  const [pr, outFile] = process.argv.slice(2);
  if (pr === undefined || outFile === undefined || !/^\d+$/.test(pr)) {
    throw new CheckFailed(`Usage: node scripts/pr-meta.mjs <pr-number> <out-file> (got ${JSON.stringify(process.argv.slice(2))})`);
  }
  const author = ghApi([`repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".user.login"]);
  const reviews = ghApi(["--paginate", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "--jq",
    ".[] | {login: .user.login, state: .state, association: .author_association}"]);
  const meta = prMetaFromGh(author, reviews);
  writeFileSync(outFile, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`pr-meta: PR #${pr} by @${meta.author}, ${meta.reviews.length} review(s) → ${outFile}`);
});
