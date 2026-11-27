import assert from "node:assert/strict";
import { test } from "node:test";
import { carriesOver, changeLines, citedClauses, clauseStatuses } from "./carry-over";
import { DICTIONARIES } from "./i18n";
import type { Clause, ClauseStatus, ComparisonReport, LessonItem, QuestionItem } from "./types";

const QUOTE = "If the order is still being prepared 10 minutes after check-in, send a pickup-delay report.";

function clause(stableId: string, page: number, clauseNumber: string, quote: string): Clause {
  return { recordId: `${stableId}-p${page}`, stableId, ordinal: page, quote, statement: quote, heading: null, clauseNumber, page };
}

function report(clauses: { stable_id: string; status: ClauseStatus; old: string | null; new: string | null; reasons: string[] }[]): ComparisonReport {
  return {
    old_version_id: "v1",
    new_version_id: "v2",
    complete: true,
    summary: { unchanged: 0, moved: 0, changed: 0, added: 0, removed: 0, needs_review: 0 },
    clauses: clauses.map((c) => ({
      status: c.status,
      stable_id: c.stable_id,
      old: c.old === null ? null : { quote: c.old, heading: null },
      new: c.new === null ? null : { quote: c.new, heading: null },
      change_reasons: c.reasons,
    })),
  };
}

const EXAM: QuestionItem = {
  id: "item-v1", packageId: "pkg-v1", documentId: "doc", versionId: "v1", procedureKey: "pickup-delay", role: "courier",
  ordinal: 0, stableId: "s2", quote: QUOTE, status: "published", flags: [], judgeReason: "ok", updatedAt: new Date(0),
  kind: "exam",
  payload: {
    format: "mcq", prompt: "You checked in 10 minutes ago and the order is not ready. What now?", scene: null, time_limit_seconds: null,
    options: [
      { text: "Send a pickup-delay report", correct: true, misconception: null },
      { text: "Keep waiting", correct: false, misconception: "thinks waiting is always fine" },
    ],
    correct_order: [], feedback: "f", confidence_tap: true,
  },
};

const LESSON: LessonItem = {
  ...EXAM, id: "lesson-v1", ordinal: 1, kind: "lesson",
  payload: { title: "Pickup delay", key_points: [{ text: "Report after 10 minutes", stable_id: "s2", quote: QUOTE }], video: null },
};

const V1 = [clause("s1", 1, "1.1", "Check in at the branch."), clause("s2", 1, "1.2", QUOTE)];
const V2 = [clause("s1", 1, "1.1", "Check in at the branch."), clause("s2", 4, "3.5", QUOTE)];

const PROCEDURE = { stableIds: ["s1", "s2"] };
const MOVED = report([
  { stable_id: "s1", status: "unchanged", old: "Check in at the branch.", new: "Check in at the branch.", reasons: [] },
  { stable_id: "s2", status: "moved", old: QUOTE, new: QUOTE, reasons: ["location changed"] },
]);

test("a moved clause keeps its procedure's training package on v2", () => {
  assert.ok(carriesOver(PROCEDURE, PROCEDURE, clauseStatuses(MOVED)));
});

test("a carried question cites the moved clause at its new place, with the same source text", () => {
  // carryPackage copies the item row as-is with the new version id; citations resolve by (stable id, version).
  const before = citedClauses(EXAM, V1);
  const after = citedClauses({ ...EXAM, versionId: "v2" }, V2);
  assert.deepEqual(before.map((c) => [c.page, c.clauseNumber]), [[1, "1.2"]]);
  assert.deepEqual(after.map((c) => [c.page, c.clauseNumber]), [[4, "3.5"]]);
  assert.equal(after[0].quote, before[0].quote);
});

test("a moved clause sends learners no change notice", () => {
  assert.deepEqual(changeLines(MOVED, new Set(PROCEDURE.stableIds), DICTIONARIES.en.reasons), []);
});

test("a changed, removed or unknown clause regenerates the package instead", () => {
  const changed = report([
    { stable_id: "s1", status: "unchanged", old: "Check in at the branch.", new: "Check in at the branch.", reasons: [] },
    { stable_id: "s2", status: "changed", old: QUOTE, new: QUOTE.replace("10", "15"), reasons: ["number changed"] },
  ]);
  assert.ok(!carriesOver(PROCEDURE, PROCEDURE, clauseStatuses(changed)));
  assert.equal(changeLines(changed, new Set(PROCEDURE.stableIds), DICTIONARIES.en.reasons).length, 1);

  const removed = report([{ stable_id: "s1", status: "unchanged", old: "a", new: "a", reasons: [] }, { stable_id: "s2", status: "removed", old: QUOTE, new: null, reasons: [] }]);
  assert.ok(!carriesOver(PROCEDURE, { stableIds: ["s1"] }, clauseStatuses(removed)));

  const missing = report([{ stable_id: "s1", status: "unchanged", old: "a", new: "a", reasons: [] }]);
  assert.ok(!carriesOver(PROCEDURE, PROCEDURE, clauseStatuses(missing)), "a clause the report does not mention counts as removed");
});

test("a carried lesson key point cites the moved clause at its new place", () => {
  assert.deepEqual(citedClauses(LESSON, V1).map((c) => c.page), [1]);
  assert.deepEqual(citedClauses({ ...LESSON, versionId: "v2" }, V2).map((c) => c.page), [4]);
});
