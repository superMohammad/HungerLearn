import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const APP = path.resolve(import.meta.dirname, "..", "app");

/**
 * Every Suspense fallback is the shared Skeleton (it carries aria-busy="true") or nothing. The feature-map e2e
 * tests fail while an aria-busy element is visible, so a page with its own spinner would slip past them and its
 * screenshot could show "Loading…" instead of the page.
 */
const ALLOWED_FALLBACK = /^fallback=\{\s*(null|<Skeleton\b)/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** The fallbacks in one source file that are neither <Skeleton …> nor null. */
function unmarkedFallbacks(source: string): string[] {
  return [...source.matchAll(/fallback=\{[^}]{0,80}/g)].map((m) => m[0]).filter((f) => !ALLOWED_FALLBACK.test(f));
}

test("every Suspense fallback under src/app is <Skeleton> or null", () => {
  const offenders = tsxFiles(APP).flatMap((file) =>
    unmarkedFallbacks(readFileSync(file, "utf8")).map((f) => `${path.relative(APP, file)}: ${f}`),
  );
  assert.deepEqual(offenders, []);
});

test("unmarkedFallbacks flags a hand-made spinner and accepts Skeleton and null", () => {
  assert.deepEqual(unmarkedFallbacks('<Suspense fallback={<p>Loading…</p>}>'), ["fallback={<p>Loading…</p>"]);
  assert.deepEqual(unmarkedFallbacks("<Suspense fallback={<Skeleton label={t.loading} />}><Suspense fallback={null}>"), []);
});

test("feature-map e2e tests go through row(), which waits for loading states before the screenshot", () => {
  const spec = readFileSync(path.resolve(import.meta.dirname, "..", "..", "e2e", "feature-map.spec.ts"), "utf8");
  const bareTests = [...spec.matchAll(/^\s*test\(/gm)].length;
  assert.equal(bareTests, 1, "only row() may call test(); write new feature-map tests with row(title, async (page) => …)");
});
