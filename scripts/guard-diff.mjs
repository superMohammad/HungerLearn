// @ts-check
/**
 * Fails when the change since BASE weakens checks (skipped tests, suppressions, deleted tests).
 * Usage: node scripts/guard-diff.mjs [BASE]      # default: merge-base with origin/main
 * Override (a human decision, with a reason): HL_ALLOW_WEAKENING="<reason>"; in CI the PR label allow-weakening.
 */
import { findWeakening, reportWeakening } from "./lib/guard.mjs";
import { baseRev } from "./lib/hl.mjs";

const base = process.argv[2] ?? baseRev();
process.exit(reportWeakening(findWeakening(base)) ? 0 : 1);
