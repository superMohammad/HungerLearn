import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.resolve(import.meta.dirname, "..");
const APP = path.join(SRC, "app");
const E2E = path.resolve(SRC, "..", "e2e");

/**
 * Every Suspense fallback is the shared Skeleton (it carries aria-busy="true") or nothing. The feature-map e2e
 * tests fail while an aria-busy element is visible, so a page with its own spinner would slip past them and its
 * screenshot could show "Loading…" instead of the page.
 */
const ALLOWED_FALLBACK = /^fallback\s*=\s*\{\s*(null|<Skeleton\b)/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** The fallbacks in one source file that are neither <Skeleton …> nor null. */
function unmarkedFallbacks(source: string): string[] {
  return [...source.matchAll(/fallback\s*=\s*\{[^}]{0,80}/g)].map((m) => m[0]).filter((f) => !ALLOWED_FALLBACK.test(f));
}

test("every Suspense fallback under src is <Skeleton> or null", () => {
  const offenders = tsxFiles(SRC).flatMap((file) =>
    unmarkedFallbacks(readFileSync(file, "utf8")).map((f) => `${path.relative(SRC, file)}: ${f}`),
  );
  assert.deepEqual(offenders, []);
});

test("no route loading.tsx: it is an implicit Suspense fallback the scan above cannot see; use <Suspense fallback={<Skeleton …/>}>", () => {
  assert.deepEqual(tsxFiles(APP).filter((file) => path.basename(file) === "loading.tsx").map((file) => path.relative(APP, file)), []);
});

test("unmarkedFallbacks flags a hand-made spinner and accepts Skeleton and null", () => {
  assert.deepEqual(unmarkedFallbacks('<Suspense fallback={<p>Loading…</p>}>'), ["fallback={<p>Loading…</p>"]);
  assert.deepEqual(unmarkedFallbacks("<Suspense fallback = {<Spinner />}>"), ["fallback = {<Spinner />"]);
  assert.deepEqual(unmarkedFallbacks("<Suspense fallback={<Skeleton label={t.loading} />}><Suspense fallback={null}>"), []);
});

test("every e2e test goes through row(), which waits for loading states before the screenshot", () => {
  const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));
  const calls = specs.map((f) => ({ file: f, count: [...readFileSync(path.join(E2E, f), "utf8").matchAll(/\btest\s*\(/g)].length }));
  assert.deepEqual(calls, [{ file: "feature-map.spec.ts", count: 1 }],
    "only row() in feature-map.spec.ts may call test(); write new tests with row(title, async (page) => …)");
});
