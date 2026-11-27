import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { EMAILS, GoldLearnersSchema, personaProblems, type GoldLearner } from "./demo-personas";

const LEARNERS_FILE = path.resolve(import.meta.dirname, "..", "..", "..", "data", "synthetic_sops", "dev", "gold", "learners.json");

function goldLearners(): GoldLearner[] {
  return GoldLearnersSchema.parse(JSON.parse(readFileSync(LEARNERS_FILE, "utf8"))).learners;
}

test("every gold learner has a demo persona: display name, unique demo email and Arabic branch", () => {
  assert.deepEqual(personaProblems(goldLearners()), []);
});

test("personaProblems names a learner the seed cannot create", () => {
  const known = goldLearners()[0];
  const unknown: GoldLearner = { ...known, learner_id: "HL-999", branch: "Nowhere Street" };
  assert.deepEqual(personaProblems([known, unknown]), [
    "HL-999: no display name in NAMES",
    'HL-999: no Arabic name for branch "Nowhere Street" in BRANCH_AR',
    "HL-999: no email in EMAILS",
  ]);
});

test("personaProblems refuses a duplicated email", () => {
  const known = goldLearners()[0];
  assert.deepEqual(personaProblems([known, known]), [`${known.learner_id}: email ${EMAILS[known.learner_id]} is already used by ${known.learner_id}`]);
});
