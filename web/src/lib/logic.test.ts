import assert from "node:assert/strict";
import { test } from "node:test";
import { composeQuestion, levelFor, nextStep, type ScreenSpec } from "./compose";
import { parseDocprocIssues, zeroClausesError } from "./docproc-issues";
import { checkQuestionShape, gradeAgainstKey, repeatedExamFormats, shuffledSteps } from "./question-rules";
import { DICTIONARIES } from "./i18n";
import { reasonLabel } from "./reasons";
import { checkReadonlySql } from "./sql-guard";
import { normalizeText, quoteInClause } from "./text";
import type { QuestionPayload } from "./types";

const ID = "00000000-0000-4000-8000-000000000001";
const LESSON: ScreenSpec = { kind: "lesson", title: "t", keyPoints: ["k"], videoUrl: null, orientation: "portrait" };

function question(over: Partial<QuestionPayload>): QuestionPayload {
  return {
    format: "mcq", prompt: "p", scene: null, time_limit_seconds: null,
    options: [
      { text: "right", correct: true, misconception: null },
      { text: "wrong", correct: false, misconception: "thinks so" },
    ],
    correct_order: [], feedback: "f", confidence_tap: true, ...over,
  };
}

test("normalizeText folds tashkeel, alef forms and Arabic-Indic digits but keeps numbers", () => {
  assert.equal(normalizeText("بعد ١٠ دقائقٍ إلى"), "بعد 10 دقائق الي");
  assert.notEqual(normalizeText("بعد ١٠ دقائق"), normalizeText("بعد ١٥ دقائق"));
});

test("quoteInClause accepts exact sub-quotes and rejects invented ones", () => {
  const clause = "إذا بقي الطلب قيد التجهيز بعد ١٠ دقائق من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام».";
  assert.ok(quoteInClause("بعد 10 دقائق من تسجيل الوصول", clause));
  assert.ok(!quoteInClause("بعد 15 دقيقة من تسجيل الوصول", clause));
});

test("grading follows the approved key for every format", () => {
  assert.ok(gradeAgainstKey(question({}), { format: "mcq", choice: 0 }));
  assert.ok(!gradeAgainstKey(question({}), { format: "mcq", choice: 1 }));
  assert.ok(!gradeAgainstKey(question({ format: "timed_decision", time_limit_seconds: 12 }), { format: "timed_decision", choice: -1 }));
  const checklist = question({ format: "checklist", options: [
    { text: "a", correct: true, misconception: null }, { text: "b", correct: true, misconception: null }, { text: "c", correct: false, misconception: "x" },
  ] });
  assert.ok(gradeAgainstKey(checklist, { format: "checklist", selected: [1, 0] }));
  assert.ok(!gradeAgainstKey(checklist, { format: "checklist", selected: [0] }));
  const order = question({ format: "order_steps", options: [], correct_order: ["one", "two", "three"] });
  assert.ok(gradeAgainstKey(order, { format: "order_steps", order: ["one", "two", "three"] }));
  assert.ok(!gradeAgainstKey(order, { format: "order_steps", order: ["two", "one", "three"] }));
  assert.throws(() => gradeAgainstKey(question({}), { format: "checklist", selected: [0] }));
});

test("shape rules enforce one correct option, misconceptions and format needs", () => {
  assert.deepEqual(checkQuestionShape(question({})), []);
  assert.ok(checkQuestionShape(question({ options: [{ text: "a", correct: true, misconception: null }, { text: "b", correct: true, misconception: null }] }))
    .includes("needs_exactly_one_correct_option"));
  assert.ok(checkQuestionShape(question({ options: [{ text: "a", correct: true, misconception: null }, { text: "b", correct: false, misconception: null }] }))
    .includes("missing_misconception"));
  assert.ok(checkQuestionShape(question({ format: "order_steps", options: [], correct_order: ["one"] })).includes("order_steps_needs_two_steps"));
  assert.deepEqual(repeatedExamFormats(["mcq", "order_steps"], ["checklist", "order_steps"]), ["order_steps"]);
});

test("order steps are never shown already in order, and the shuffle is stable", () => {
  const steps = ["a", "b", "c", "d"];
  const s1 = shuffledSteps(steps, ID);
  assert.notDeepEqual(s1, steps);
  assert.deepEqual([...s1].sort(), steps);
  assert.deepEqual(shuffledSteps(steps, ID), s1);
});

test("flow: practice first, then exam; a failed exam sends the learner back through practice", () => {
  const p = ["p1", "p2"], e = ["e1"];
  assert.deepEqual(nextStep(p, e, []), { kind: "practice", itemId: "p1" });
  const practiced = [{ itemId: "p1", correct: true, at: 1 }, { itemId: "p2", correct: false, at: 2 }];
  assert.deepEqual(nextStep(p, e, practiced), { kind: "exam", itemId: "e1" });
  const failed = [...practiced, { itemId: "e1", correct: false, at: 3 }];
  assert.deepEqual(nextStep(p, e, failed), { kind: "practice", itemId: "p1" });
  const repracticed = [...failed, { itemId: "p1", correct: true, at: 4 }, { itemId: "p2", correct: true, at: 5 }];
  assert.deepEqual(nextStep(p, e, repracticed), { kind: "exam", itemId: "e1" });
  assert.deepEqual(nextStep(p, e, [...repracticed, { itemId: "e1", correct: true, at: 6 }]), { kind: "mastered" });
});

test("composeQuestion hides the key and falls back to the lesson when the spec is invalid", () => {
  const spec = composeQuestion(ID, "practice", question({}), LESSON);
  assert.equal(spec.kind, "question");
  assert.ok(!JSON.stringify(spec).includes("correct"));
  const broken = composeQuestion(ID, "exam", question({ format: "order_steps", options: [], correct_order: ["only one"] }), LESSON);
  assert.equal(broken.kind, "lesson");
});

test("levels: beginner → certified → expert", () => {
  assert.equal(levelFor(0, 3), "beginner");
  assert.equal(levelFor(1, 3), "certified");
  assert.equal(levelFor(3, 3), "expert");
});

test("checkReadonlySql allows one SELECT on readiness_v only", () => {
  assert.equal(checkReadonlySql("SELECT name FROM readiness_v WHERE state <> 'mastered';"), "SELECT name FROM readiness_v WHERE state <> 'mastered'");
  assert.throws(() => checkReadonlySql("DELETE FROM mastery"));
  assert.throws(() => checkReadonlySql("SELECT * FROM learners"));
  assert.throws(() => checkReadonlySql("SELECT 1 FROM readiness_v; DROP TABLE mastery"));
  assert.throws(() => checkReadonlySql("SELECT pg_sleep(10) FROM readiness_v"));
});

test("reasonLabel translates docproc change reasons in each UI language", () => {
  assert.equal(reasonLabel("numbers: 15 -> 10", DICTIONARIES.ar.reasons), "الأرقام: 15 ← 10");
  assert.equal(reasonLabel("wording changed", DICTIONARIES.ar.reasons), "تغيّرت الصياغة");
  assert.equal(reasonLabel("numbers: 15 -> 10", DICTIONARIES.en.reasons), "Numbers: 15 → 10");
  assert.equal(reasonLabel("audience changed somehow", DICTIONARIES.en.reasons), "audience changed somehow");
});

test("both UI dictionaries have the same keys", () => {
  const shape = (value: unknown): unknown =>
    Array.isArray(value) ? value.length
    : typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
    : typeof value;
  assert.deepEqual(shape(DICTIONARIES.en), shape(DICTIONARIES.ar));
});

test("procedures follow section numbers; every clause lands in exactly one", async () => {
  const { groupBySection, sectionKey } = await import("./procedures");
  const clause = (ordinal: number, clauseNumber: string | null, heading: string | null) => ({
    recordId: `r${ordinal}`, stableId: `s${ordinal}`, ordinal, quote: "q", statement: "s", heading, clauseNumber, page: null,
  });
  assert.equal(sectionKey(clause(0, "٢.", null)), "n:2");
  assert.equal(sectionKey(clause(0, "2.3", null)), "n:2");
  const groups = groupBySection([clause(0, "1.", "H"), clause(1, "2.1", "H"), clause(2, "2.2", "H"), clause(3, null, "Other")]);
  assert.deepEqual(groups.map((g) => g.map((c) => c.stableId)), [["s0"], ["s1", "s2"], ["s3"]]);
});

test("zero clauses: OCR failures name the pages and how to enable OCR", () => {
  const message = zeroClausesError([
    { kind: "ocr_failed", page: 1, detail: "null: OCR not configured" },
    { kind: "ocr_failed", page: 2, detail: "null: OCR not configured" },
    { kind: "quote_not_found", page: 2, detail: "q" },
  ]);
  assert.match(message, /pages 1, 2/);
  assert.match(message, /DOCPROC_OCR=ovis/);
});

test("zero clauses: a configured OCR engine that fails lists each page instead of advising to enable OCR", () => {
  const message = zeroClausesError([
    { kind: "ocr_failed", page: 1, detail: "ATH-MaaS/OvisOCR3: OutOfMemoryError: CUDA out of memory" },
    { kind: "ocr_failed", page: 2, detail: "ATH-MaaS/OvisOCR3: empty" },
  ]);
  assert.doesNotMatch(message, /DOCPROC_OCR/);
  assert.match(message, /page 1: ATH-MaaS\/OvisOCR3: OutOfMemoryError/);
  assert.match(message, /page 2: ATH-MaaS\/OvisOCR3: empty/);
});

test("zero clauses: long issue lists are capped", () => {
  const many = Array.from({ length: 12 }, (_, n) => ({ kind: "llm_error" as const, page: n + 1, detail: "timeout" }));
  assert.match(zeroClausesError(many), /\+7 more$/);
});

test("zero clauses: without OCR failures the docproc issue kinds are listed", () => {
  const message = zeroClausesError([{ kind: "llm_error", page: null, detail: "timeout" }]);
  assert.doesNotMatch(message, /DOCPROC_OCR/);
  assert.match(message, /llm_error page \?: timeout/);
  assert.match(zeroClausesError([]), /recorded no issues/);
});

test("zero clauses: issues besides the missing OCR engine are listed too", () => {
  const message = zeroClausesError([
    { kind: "ocr_failed", page: 1, detail: "null: OCR not configured" },
    { kind: "llm_error", page: 2, detail: "timeout" },
  ]);
  assert.match(message, /DOCPROC_OCR=ovis/);
  assert.match(message, /llm_error page 2: timeout/);
});

test("zero clauses: each issue detail is shortened so every listed page fits", () => {
  const message = zeroClausesError([{ kind: "ocr_failed", page: 1, detail: `engine: ${"x".repeat(500)}` }]);
  assert.ok(message.length < 300, `message is ${message.length} chars`);
  assert.match(message, /…/);
});

test("docproc issues: the stored JSONB is validated; a missing page becomes null, an unknown kind is refused", () => {
  assert.deepEqual(parseDocprocIssues([{ kind: "ocr_failed", detail: "d", section_id: null, blocking: true }]), [
    { kind: "ocr_failed", page: null, detail: "d" },
  ]);
  assert.deepEqual(parseDocprocIssues(null), []);
  assert.throws(() => parseDocprocIssues([{ kind: "made_up", detail: "d" }]));
});
