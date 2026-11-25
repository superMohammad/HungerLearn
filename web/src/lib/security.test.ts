import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password";

const SRC = path.resolve(import.meta.dirname, "..");

/** Server actions anyone may call: they create or end the session themselves. */
const PUBLIC_ACTIONS: ReadonlySet<string> = new Set(["signInAction", "signUpAction", "signOut"]);
const SESSION_GUARD = /^\s*(const\s+\{[^}]*\}\s*=\s*)?await\s+require(Admin|Learner)\(\);/;

type ExportedAction = { file: string; name: string; firstStatement: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

/** Source with LF endings: Windows checkouts may use CRLF. */
function readSource(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function isServerActionFile(source: string): boolean {
  return /^\s*["']use server["'];/.test(source);
}

function serverActionsIn(file: string): ExportedAction[] {
  const source = readSource(file);
  if (!isServerActionFile(source)) return [];
  return [...source.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{\n([^\n]*)/g)].map((m) => ({
    file: path.relative(SRC, file),
    name: m[1],
    firstStatement: m[2],
  }));
}

test("every server action re-checks the session as its first statement", () => {
  const actions = sourceFiles(SRC).flatMap(serverActionsIn);
  assert.ok(actions.length > 0, "no server actions found; the scanner is broken");
  const unguarded = actions.filter((a) => !PUBLIC_ACTIONS.has(a.name) && !SESSION_GUARD.test(a.firstStatement));
  assert.deepEqual(
    unguarded.map((a) => `${a.file}: ${a.name}`),
    [],
    "Start each server action with `await requireAdmin()` or `await requireLearner()` (src/lib/session.ts). " +
      "Only sign-in, sign-up and sign-out may skip it (PUBLIC_ACTIONS).",
  );
});

test("server actions are exported only as `export async function` (the form the session check can see)", () => {
  const hidden = sourceFiles(SRC).filter((file) => {
    const source = readSource(file);
    return isServerActionFile(source) && /export\s+(const|let|var|default)\b/.test(source);
  });
  assert.deepEqual(hidden.map((f) => path.relative(SRC, f)), [], "Write server actions as `export async function name(...)`.");
});

test("the public action allowlist only names actions that exist", () => {
  const names = new Set(sourceFiles(SRC).flatMap(serverActionsIn).map((a) => a.name));
  assert.deepEqual([...PUBLIC_ACTIONS].filter((n) => !names.has(n)), []);
});

test("password hashes verify the right password only", async () => {
  const encoded = await hashPassword("correct horse battery");
  assert.match(encoded, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery", encoded), true);
  assert.equal(await verifyPassword("correct horse batterY", encoded), false);
  assert.equal(await verifyPassword("", encoded), false);
});

test("password hashes are salted", async () => {
  assert.notEqual(await hashPassword("same password"), await hashPassword("same password"));
});

test("unknown password hash formats are rejected loudly", async () => {
  await assert.rejects(verifyPassword("x", "bcrypt$whatever"), /Unrecognised password hash format/);
  await assert.rejects(verifyPassword("x", "scrypt$1$2"), /Unrecognised password hash format/);
});
