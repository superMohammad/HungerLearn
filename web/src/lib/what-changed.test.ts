import assert from "node:assert/strict";
import { test } from "node:test";
import { netChanges } from "./carry-over";
import { ScreenSpecSchema, whatChangedScreen } from "./compose";
import type { ClauseStatus, ComparisonReport } from "./types";

/** B7: the "What changed" lesson, built from docproc's stored comparisons without an AI call. */

type Row = { stable_id: string; status: ClauseStatus; old: string | null; new: string | null; reasons?: string[] };

function hop(oldVersionId: string, newVersionId: string, rows: Row[], complete = true): ComparisonReport {
  return {
    old_version_id: oldVersionId,
    new_version_id: newVersionId,
    complete,
    summary: { unchanged: 0, moved: 0, changed: 0, added: 0, removed: 0, needs_review: 0 },
    clauses: rows.map((r) => ({
      status: r.status,
      stable_id: r.stable_id,
      old: r.old === null ? null : { quote: r.old, heading: null },
      new: r.new === null ? null : { quote: r.new, heading: null },
      change_reasons: r.reasons ?? [],
    })),
  };
}

// Quotes from data/synthetic_sops/dev (gold extraction), courier-pickup-wait v1 → v2 (Arabic).
const CW01 = "ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق. سجّل رقم الطلب، مثل TF-418، ووقت الوصول.";
const CW02_V1 = "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.";
const CW02_V2 = "إذا بقي الطلب قيد التجهيز بعد 10 دقائق من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.";
const CW04 = "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع بالمغادرة أو يسلّمك موظف الفرع الطلب.";
const COURIER = hop("v1", "v2", [
  { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
  { stable_id: "CW-02", status: "changed", old: CW02_V1, new: CW02_V2, reasons: ["numbers: 15 -> 10"] },
  { stable_id: "CW-04", status: "moved", old: CW04, new: CW04, reasons: ["location changed"] },
]);

// employee-delayed-order v1 → v2 (English): ED-02 changed, ED-04 removed.
const ED01 = "When the displayed delivery estimate is at least 12 minutes past, open a Delay case and record the order ID and last status timestamp.";
const ED02_V1 = "If tracking has not refreshed for 8 minutes after the case opens, the support agent must page the dispatch desk directly.";
const ED02_V2 = "If tracking has not refreshed for 8 minutes after the case opens, the support agent must route the case to the duty lead. The duty lead pages the dispatch desk.";
const ED04 = "Before signing out, copy each open Delay case ID into the shift email to the duty lead.";
const EMPLOYEE = hop("v1", "v2", [
  { stable_id: "ED-01", status: "unchanged", old: ED01, new: ED01 },
  { stable_id: "ED-02", status: "changed", old: ED02_V1, new: ED02_V2, reasons: ["actor: support agent -> duty lead", "location changed"] },
  { stable_id: "ED-04", status: "removed", old: ED04, new: null },
]);

test("courier v1→v2: only the changed clause is shown, with its old and new text; moved and unchanged are left out", () => {
  const changes = netChanges([COURIER], (["CW-01", "CW-02", "CW-04"]));
  assert.deepEqual(changes, [{ stableId: "CW-02", change: "changed", before: CW02_V1, after: CW02_V2, reasons: ["numbers: 15 -> 10"] }]);
});

test("employee v1→v2: a changed clause shows before/after and a removed clause its old text; 'location changed' is dropped", () => {
  const changes = netChanges([EMPLOYEE], (["ED-01", "ED-02", "ED-04"]));
  assert.deepEqual(changes, [
    { stableId: "ED-02", change: "changed", before: ED02_V1, after: ED02_V2, reasons: ["actor: support agent -> duty lead"] },
    { stableId: "ED-04", change: "removed", before: ED04, after: null, reasons: [] },
  ]);
});

test("only clauses of the learner's procedure are shown", () => {
  assert.deepEqual(netChanges([COURIER], (["CW-01", "CW-04"])), []);
  assert.deepEqual(netChanges([EMPLOYEE], (["ED-04"])).map((c) => c.stableId), ["ED-04"]);
});

test("an added clause shows its new text only", () => {
  const added = hop("v1", "v2", [{ stable_id: "CW-05", status: "added", old: null, new: "قاعدة جديدة." }]);
  assert.deepEqual(netChanges([added], (["CW-05"])), [{ stableId: "CW-05", change: "added", before: null, after: "قاعدة جديدة.", reasons: [] }]);
});

test("a needs_review clause is shown as a possible change, never hidden (also with identical text or a deferred removal)", () => {
  const review = hop("v1", "v2", [
    { stable_id: "CW-01", status: "needs_review", old: CW01, new: CW01 },
    { stable_id: "CW-02", status: "needs_review", old: CW02_V1, new: CW02_V2 },
    { stable_id: "CW-04", status: "needs_review", old: CW04, new: null, reasons: ["removal_deferred"] },
  ]);
  assert.deepEqual(netChanges([review], ["CW-01", "CW-02", "CW-04"]), [
    { stableId: "CW-01", change: "review", before: CW01, after: CW01, reasons: [] },
    { stableId: "CW-02", change: "review", before: CW02_V1, after: CW02_V2, reasons: [] },
    { stableId: "CW-04", change: "review", before: CW04, after: null, reasons: ["removal_deferred"] },
  ]);
});

test("docproc's status decides: unchanged or moved clauses whose raw text differs (PDF vs TXT) are left out; a changed clause with identical text is shown", () => {
  const formats = hop("v1", "v2", [
    { stable_id: "ED-01", status: "unchanged", old: ED01, new: ED01.replace(" open a", "\nopen a") },
    { stable_id: "CW-02", status: "moved", old: CW02_V1, new: CW02_V1.replace("١٥", "15"), reasons: ["location changed"] },
    { stable_id: "ED-02", status: "changed", old: ED02_V1, new: ED02_V1, reasons: ["audience: support agent -> duty lead"] },
  ]);
  assert.deepEqual(netChanges([formats], ["ED-01", "CW-02", "ED-02"]), [
    { stableId: "ED-02", change: "changed", before: ED02_V1, after: ED02_V1, reasons: ["audience: support agent -> duty lead"] },
  ]);
});

test("changes follow the procedure's clause order, not the report's", () => {
  const shuffled = hop("v1", "v2", [
    { stable_id: "ED-04", status: "removed", old: ED04, new: null },
    { stable_id: "ED-02", status: "changed", old: ED02_V1, new: ED02_V2 },
  ]);
  assert.deepEqual(netChanges([shuffled], ["ED-01", "ED-02", "ED-04"]).map((c) => c.stableId), ["ED-02", "ED-04"]);
});

test("across uploads, a clause changed more than once shows no per-upload reason; before and after carry the net change", () => {
  // A v2→v3 reason ("10 -> 12") would contradict the v1 text the learner sees as "before" (15).
  const v2v3 = hop("v2", "v3", [{ stable_id: "CW-02", status: "changed", old: CW02_V2, new: CW02_V2.replace("10", "12"), reasons: ["numbers: 10 -> 12"] }]);
  assert.deepEqual(netChanges([COURIER, v2v3], ["CW-02"]), [
    { stableId: "CW-02", change: "changed", before: CW02_V1, after: CW02_V2.replace("10", "12"), reasons: [] },
  ]);
});

test("skipped versions: the net change from the version the learner learned to the current one", () => {
  const v2v3 = hop("v2", "v3", [
    { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
    { stable_id: "CW-02", status: "changed", old: CW02_V2, new: CW02_V1, reasons: ["numbers: 10 -> 15"] }, // reverted
    { stable_id: "CW-04", status: "moved", old: CW04, new: CW04, reasons: ["location changed"] },
    { stable_id: "CW-06", status: "added", old: null, new: "قاعدة الإصدار الثالث." },
  ]);
  assert.deepEqual(netChanges([COURIER, v2v3], (["CW-01", "CW-02", "CW-04", "CW-06"])), [
    { stableId: "CW-06", change: "added", before: null, after: "قاعدة الإصدار الثالث.", reasons: [] },
  ]);

  // Changed v1→v2, untouched v2→v3: the learner who skipped v2 still sees the v1→v2 change.
  const quiet = hop("v2", "v3", [
    { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
    { stable_id: "CW-02", status: "unchanged", old: CW02_V2, new: CW02_V2 },
    { stable_id: "CW-04", status: "unchanged", old: CW04, new: CW04 },
  ]);
  assert.deepEqual(netChanges([COURIER, quiet], (["CW-02"])), [
    { stableId: "CW-02", change: "changed", before: CW02_V1, after: CW02_V2, reasons: ["numbers: 15 -> 10"] },
  ]);

  // Added in v2, removed in v3: nothing to learn.
  const gone = hop("v2", "v3", [{ stable_id: "CW-05", status: "removed", old: "مؤقتة.", new: null }]);
  const came = hop("v1", "v2", [{ stable_id: "CW-05", status: "added", old: null, new: "مؤقتة." }]);
  assert.deepEqual(netChanges([came, gone], (["CW-05"])), []);
});

test("an incomplete comparison (failed pages) does not block the lesson; its deferred clauses show as possible changes", () => {
  const incomplete = hop("v1", "v2", [
    { stable_id: "CW-02", status: "changed", old: CW02_V1, new: CW02_V2 },
    { stable_id: "CW-09", status: "needs_review", old: "بند في صفحة لم تُقرأ.", new: null, reasons: ["removal_deferred"] },
  ], false);
  assert.deepEqual(netChanges([incomplete], ["CW-02"]).map((c) => c.change), ["changed"]);
  assert.deepEqual(netChanges([incomplete], ["CW-09"]).map((c) => c.change), ["review"]);
});

test("a broken chain fails loudly instead of showing a partial diff", () => {
  const gap = hop("v3", "v4", [{ stable_id: "CW-02", status: "unchanged", old: CW02_V2, new: CW02_V2 }]);
  assert.throws(() => netChanges([COURIER, gap], (["CW-02"])), /v2.*v3/);
  assert.throws(() => netChanges([], (["CW-02"])), /no comparison/);
});

test("the what-changed screen spec passes the schema and holds only quotes, change kinds and reason codes", () => {
  const changes = netChanges([EMPLOYEE], (["ED-01", "ED-02", "ED-04"]));
  const spec = whatChangedScreen("Delayed order", "v1", "v2", changes);
  assert.ok(spec !== null);
  assert.deepEqual(ScreenSpecSchema.parse(spec), spec);
  assert.equal(spec.kind, "what_changed");
  const text = JSON.stringify(spec);
  for (const forbidden of ["correct", "options", "misconception", "feedback"]) assert.ok(!text.includes(`"${forbidden}"`), forbidden);
  assert.equal(whatChangedScreen("Delayed order", "v1", "v2", []), null, "no net change means no what-changed screen");
});
