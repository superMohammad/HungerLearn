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
/** Two calls × three attempts stay well inside the pr-policy job's 5-minute timeout. */
const GH_TIMEOUT_MS = 25_000;

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `gh api <args>` and returns its stdout; retries with a structured warning, then raises the last failure.
 * @param {readonly string[]} args @returns {string}
 */
function ghApi(args) {
  /** @type {Record<string, unknown>} */
  let last = {};
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const run = spawnSync("gh", ["api", ...args], { cwd: REPO, encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    if (run.status === 0) return run.stdout;
    last = { args, status: run.status, signal: run.signal, error: run.error?.message ?? null, stderr: run.stderr?.slice(0, 2000) ?? null };
    if (attempt < ATTEMPTS) {
      console.warn(JSON.stringify({ event: "gh_api_retry", attempt, attempts: ATTEMPTS, failure: last }));
      sleep(BACKOFF_MS * attempt);
    }
  }
  throw new CheckFailed(`pr-meta: gh api failed ${ATTEMPTS} times: ${JSON.stringify(last)}`);
}

runMain(() => {
  const [pr, outFile] = process.argv.slice(2);
  if (pr === undefined || outFile === undefined || !/^\d+$/.test(pr)) {
    throw new CheckFailed(`Usage: node scripts/pr-meta.mjs <pr-number> <out-file> (got ${JSON.stringify(process.argv.slice(2))})`);
  }
  const head = ghApi([`repos/{owner}/{repo}/pulls/${pr}`, "--jq", "{author: .user.login, headSha: .head.sha}"]);
  // A review by a deleted account has no user, and one of a garbage-collected commit (after a force-push) has no
  // commit_id: neither can be a team approval of the current head, so both are left out.
  const reviews = ghApi(["--paginate", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "--jq",
    ".[] | select(.user != null and .commit_id != null) | {login: .user.login, state: .state, association: .author_association, commitId: .commit_id}"]);
  const meta = prMetaFromGh(head, reviews);
  writeFileSync(outFile, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`pr-meta: PR #${pr} by @${meta.author} at ${meta.headSha.slice(0, 12)}, ${meta.reviews.length} review(s) → ${outFile}`);
});
