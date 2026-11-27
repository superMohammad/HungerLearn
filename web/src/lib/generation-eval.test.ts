import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { goldClauses, loadDevOriginals, scoreProcedure, summarize, type ProcedureOutcome } from "./generation-eval";
import { groupBySection } from "./procedures";
import type { Clause, LessonPayload, QuestionPayload } from "./types";

const DATASET = path.resolve(import.meta.dirname, "..", "..", "..", "data", "synthetic_sops");

const CW02: Clause = {
  recordId: "CW-02",
  stableId: "CW-02",
  ordinal: 1,
  quote: "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام».",
  statement: "",
  heading: "٢. تأخر التجهيز",
  clauseNumber: "٢",
  page: null,
};
const CW03: Clause = { ...CW02, recordId: "CW-03", stableId: "CW-03", ordinal: 2, quote: "لا تغادر الفرع قبل رد مسؤول التوزيع." };

const QUESTION: QuestionPayload = {
  format: "mcq",
  prompt: "ماذا تفعل؟",
  scene: null,
  time_limit_seconds: null,
  options: [{ text: "أبلّغ", correct: true, misconception: null }],
  correct_order: [],
  feedback: "",
  confidence_tap: true,
};

function question(quote: string, flags: string[], stableId = "CW-02") {
  return { kind: "practice" as const, ordinal: 0, stableId, quote, payload: QUESTION, flags, judgeReason: "" };
}

function lesson(citations: { stable_id: string; quote: string }[], flags: string[]) {
  const payload: LessonPayload = {
    title: "تأخر التجهيز",
    key_points: citations.map((c) => ({ text: "نقطة", ...c })),
    video: null,
  };
  return { kind: "lesson" as const, ordinal: 0, stableId: "CW-02", quote: citations[0].quote, payload, flags, judgeReason: "" };
}

function outcome(items: ReturnType<typeof question | typeof lesson>[], status: "ok" | "needs_human" | "skipped" = "ok"): ProcedureOutcome {
  return { procedureKey: "P1", title: "تأخر التجهيز", clauses: [CW02, CW03], result: { kind: "package", status, items } };
}

const PUBLISH_ALL = (): boolean => true;

test("a question whose quote is not in its cited clause fails citation accuracy and is listed", () => {
  const scored = scoreProcedure(outcome([question("بعد ١٥ دقيقة من تسجيل الوصول", []), question("ثلاثين دقيقة", ["quote_not_found"])]), PUBLISH_ALL);
  const s = summarize([scored]);
  assert.equal(s.items, 2);
  assert.equal(s.citation_accuracy.normalized, 0.5);
  assert.equal(s.citation_accuracy.exact, 0.5);
  assert.deepEqual(scored.items[1].failed_checks, ["quote_not_found"]);
  assert.equal(scored.items[1].citations[0].normalized, false);
});

test("a lesson passes only if all its citations pass; per-citation numbers still count each one", () => {
  const item = lesson(
    [
      { stable_id: "CW-02", quote: "أرسل بلاغ «تأخر الاستلام»" },
      { stable_id: "CW-03", quote: "لا تغادر الفرع" },
      { stable_id: "CW-03", quote: "انتظر في السيارة" },
    ],
    ["quote_not_found"],
  );
  const s = summarize([scoreProcedure(outcome([item]), PUBLISH_ALL)]);
  assert.equal(s.items, 1);
  assert.equal(s.citation_accuracy.normalized, 0);
  assert.deepEqual(s.citations, { total: 3, normalized_pass: 2, exact_pass: 2 });
});

test("a quote printing 15 cited from a clause printing ١٥ passes the app's check but fails the exact check", () => {
  const scored = scoreProcedure(outcome([question("بعد 15 دقيقة من تسجيل الوصول", [])]), PUBLISH_ALL);
  const [item] = scored.items;
  assert.equal(item.citations[0].normalized, true);
  assert.equal(item.citations[0].exact, false);
  assert.deepEqual(item.failed_checks, ["quote_digits_differ"]);
  assert.equal(item.citations[0].clause_text, CW02.quote);
  const s = summarize([scored]);
  assert.equal(s.citation_accuracy.normalized, 1);
  assert.equal(s.citation_accuracy.exact, 0);
  assert.equal(s.items_with_failed_check, 1);
});

test("a verified item that fails the exact check is a silent failure", () => {
  const scored = scoreProcedure(outcome([question("بعد 15 دقيقة من تسجيل الوصول", [])]), PUBLISH_ALL);
  assert.equal(scored.items[0].status, "verified");
  assert.equal(scored.items[0].silent_failure, true);
  assert.equal(summarize([scored]).silent_failures, 1);
});

test("a flagged draft counts as publishable with a failed check exactly when the app's rule lets it publish", () => {
  const flagged = outcome([question("ثلاثين دقيقة", ["quote_not_found"])]);
  const today = summarize([scoreProcedure(flagged, PUBLISH_ALL)]);
  assert.equal(today.publishable_with_failed_check, 1);
  assert.equal(today.silent_failures, 0, "a flagged item is visible to the trainer, so it is not silent");
  const gated = summarize([scoreProcedure(flagged, (flags) => flags.length === 0)]);
  assert.equal(gated.publishable_with_failed_check, 0);
});

test("a clean item that passes every check is neither a failure nor counted as publishable-with-failure", () => {
  const s = summarize([scoreProcedure(outcome([question("أرسل بلاغ «تأخر الاستلام»", [])]), PUBLISH_ALL)]);
  assert.deepEqual(
    { failed: s.items_with_failed_check, silent: s.silent_failures, publishable: s.publishable_with_failed_check },
    { failed: 0, silent: 0, publishable: 0 },
  );
});

test("a needs_human package marks its items as drafts flagged needs_human", () => {
  const scored = scoreProcedure(outcome([question("أرسل بلاغ «تأخر الاستلام»", [])], "needs_human"), PUBLISH_ALL);
  assert.equal(scored.items[0].status, "draft");
  assert.deepEqual(scored.items[0].failed_checks, ["needs_human"]);
});

test("an unknown clause ref fails both checks", () => {
  const item = lesson([{ stable_id: "unknown", quote: "أرسل بلاغ" }], ["unknown_clause_ref"]);
  const [scored] = scoreProcedure(outcome([item]), PUBLISH_ALL).items;
  assert.deepEqual(scored.citations[0], { clause_id: null, quote: "أرسل بلاغ", normalized: false, exact: false, clause_text: null });
});

test("a question flagged unknown_clause_ref cites nothing, even though buildPackage points it at the first clause", () => {
  const [scored] = scoreProcedure(outcome([question("أرسل بلاغ «تأخر الاستلام»", ["unknown_clause_ref"])]), PUBLISH_ALL).items;
  assert.deepEqual(scored.citations[0], { clause_id: null, quote: "أرسل بلاغ «تأخر الاستلام»", normalized: false, exact: false, clause_text: null });
});

test("a quote differing only in punctuation is quote_not_exact, not a digit difference", () => {
  const [scored] = scoreProcedure(outcome([question("أرسل بلاغ \"تأخر الاستلام\"", [])]), PUBLISH_ALL).items;
  assert.equal(scored.citations[0].normalized, true);
  assert.deepEqual(scored.failed_checks, ["quote_not_exact"]);
});

test("a quote differing in both digits and punctuation keeps both labels", () => {
  const [scored] = scoreProcedure(outcome([question("بعد 15 دقيقة من تسجيل الوصول. أرسل بلاغ \"تأخر الاستلام\"", [])]), PUBLISH_ALL).items;
  assert.equal(scored.citations[0].normalized, true);
  assert.deepEqual(scored.failed_checks, ["quote_digits_differ", "quote_not_exact"]);
});

test("a lesson whose citations fail in different ways lists every kind once", () => {
  const item = lesson(
    [
      { stable_id: "CW-02", quote: "بعد 15 دقيقة من تسجيل الوصول" },
      { stable_id: "CW-02", quote: "أرسل بلاغ \"تأخر الاستلام\"" },
      { stable_id: "CW-03", quote: "انتظر في السيارة" },
    ],
    ["quote_not_found"],
  );
  const [scored] = scoreProcedure(outcome([item]), PUBLISH_ALL).items;
  assert.deepEqual(scored.failed_checks, ["quote_not_found", "quote_digits_differ", "quote_not_exact"]);
});

test("a digit mismatch is caught even when the clause also prints a longer number containing the quote's digits", () => {
  const clause: Clause = { ...CW02, quote: "بعد ١٥ دقيقة أرسل بلاغ، وإذا تجاوز المبلغ 150 ريالا فبلّغ المشرف." };
  const scored = scoreProcedure({ ...outcome([question("بعد 15 دقيقة أرسل بلاغ", [])]), clauses: [clause, CW03] }, PUBLISH_ALL);
  const [item] = scored.items;
  assert.equal(item.citations[0].normalized, true);
  assert.deepEqual(item.failed_checks, ["quote_digits_differ"]);
});

test("silent failures and failed checks are counted per check, so digit leaks show on their own", () => {
  const digits = question("بعد 15 دقيقة من تسجيل الوصول", []);
  const punctuation = question("أرسل بلاغ \"تأخر الاستلام\"", []);
  const flagged = question("ثلاثين دقيقة", ["quote_not_found", "judge_unsupported"]);
  const s = summarize([scoreProcedure(outcome([digits, punctuation, flagged]), PUBLISH_ALL)]);
  assert.deepEqual(s.silent_failures_by_check, { quote_digits_differ: 1, quote_not_exact: 1 });
  assert.deepEqual(s.failed_check_counts, { judge_unsupported: 1, quote_digits_differ: 1, quote_not_exact: 1, quote_not_found: 1 });
  const empty = summarize([]);
  assert.deepEqual([empty.silent_failures_by_check, empty.failed_check_counts], [{}, {}]);
});

test("a lesson's video shots are citations too", () => {
  const item = lesson([{ stable_id: "CW-02", quote: "أرسل بلاغ «تأخر الاستلام»" }], []);
  const payload = item.payload as LessonPayload;
  const shot = { seconds: 4, visual: "v", on_screen_text: "t", narration: null, source: "slide", clip_id: null, must_show: [], must_not_show: [] };
  payload.video = {
    total_seconds: 8,
    structure: "steps",
    shots: [{ ...shot, stable_id: "CW-03", quote: "لا تغادر الفرع" }, { ...shot, stable_id: "CW-03", quote: "اخرج فورا" }],
  };
  const s = summarize([scoreProcedure(outcome([item]), PUBLISH_ALL)]);
  assert.deepEqual(s.citations, { total: 3, normalized_pass: 2, exact_pass: 2 });
  assert.equal(s.citation_accuracy.normalized, 0);
});

test("a skipped package and a failed procedure are counted, and empty rates are null, not 0 or NaN", () => {
  const skipped = scoreProcedure(outcome([], "skipped"), PUBLISH_ALL);
  const failed = scoreProcedure({ procedureKey: "P2", title: "x", clauses: [CW02], result: { kind: "error", message: "LLM down" } }, PUBLISH_ALL);
  const s = summarize([skipped, failed]);
  assert.equal(s.procedures, 2);
  assert.equal(s.packages_skipped, 1);
  assert.equal(s.procedures_failed, 1);
  assert.equal(s.items, 0);
  assert.equal(s.citation_accuracy.normalized, null);
  assert.equal(s.citation_accuracy.exact, null);
  assert.equal(failed.error, "LLM down");
});

test("the loader returns the 12 original dev documents (9 v1/v2, 3 v3) and nothing else", async () => {
  const docs = await loadDevOriginals(DATASET);
  assert.equal(docs.length, 12);
  assert.equal(docs.filter((d) => d.generation === "v3").length, 3);
  assert.equal(docs.filter((d) => d.generation === "v1/v2").length, 9);
  for (const d of docs) {
    assert.doesNotMatch(d.documentId, /scan|-pdf$|-docx$|-txt$/, d.documentId);
    assert.equal(d.doc.partnerType, d.doc.role === "partner" ? "restaurant" : null);
    assert.ok(d.clauses.length > 0, d.documentId);
  }
});

test("the loader refuses a dev manifest entry whose file is outside dev/ (held_out is never read)", async () => {
  await assert.rejects(
    loadDevOriginals(DATASET, { manifestOverride: { documents: [{ document_id: "x", split: "dev", variant: "original", path: "held_out/uploads/x.txt", version: 1, language: "en", role: "courier" }] } }),
    /outside dev\//,
  );
});

test("the loader skips held_out entries without opening them", async () => {
  const docs = await loadDevOriginals(DATASET, {
    manifestOverride: { documents: [{ document_id: "secret", split: "held_out", variant: "original", path: "held_out/uploads/secret.txt", version: 1, language: "en", role: "courier" }] },
  });
  assert.equal(docs.length, 0);
});

test("the loader rejects a --documents id that is not a dev original", async () => {
  await assert.rejects(loadDevOriginals(DATASET, { only: ["courier-pickup-wait-v1-scan"] }), /not a dev original: courier-pickup-wait-v1-scan/);
});

test("gold clauses carry only source text; v3's several clauses per section group like the gold procedures", async () => {
  const docs = await loadDevOriginals(DATASET);
  assert.equal(docs.length, 12);
  for (const d of docs) {
    const groups = groupBySection(d.clauses).map((g) => g.map((c) => c.stableId).sort());
    const gold = d.goldProcedures.map((p) => [...p.clause_ids].sort());
    assert.deepEqual(groups.sort(), gold.sort(), d.documentId);
    for (const c of d.clauses) assert.equal(c.statement, "", "gold facts never reach the model");
  }
  const v3 = docs.find((d) => d.documentId === "courier-pickup-wait-v3");
  assert.equal(v3?.generation, "v3");
  assert.equal(goldClauses([{ clause_id: "X-1", quote: "q", locator: { section: "القسم ٦: عند الوصول" } }])[0].clauseNumber, "٦");
});
