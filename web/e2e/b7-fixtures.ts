import { randomUUID } from "node:crypto";
import postgres from "postgres";

/**
 * B7 browser fixtures: the stored state right after a new upload changed a procedure (stage 6), for an
 * Arabic courier document (courier-pickup-wait v1 → v2) and an English employee document
 * (employee-delayed-order v1 → v2), with quotes from data/synthetic_sops/dev gold. Each learner listed
 * in `learners` starts in needs_refresh, as flagAffectedLearners leaves them.
 *
 * Writes only to a disposable database: GitHub Actions (CI=true and GITHUB_ACTIONS=true, a fresh service
 * container per job) or a database whose name equals HL_DISPOSABLE_DB. Anywhere else it throws before
 * writing. Ids derive from a random UUID; cleanup deletes exactly the rows this run inserted.
 */

export const CW02_V1 = "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.";
export const CW02_V2 = "إذا بقي الطلب قيد التجهيز بعد 10 دقائق من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.";
export const CW01 = "ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق. سجّل رقم الطلب، مثل TF-418، ووقت الوصول.";
export const CW04 = "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع بالمغادرة أو يسلّمك موظف الفرع الطلب.";
export const ED01 = "When the displayed delivery estimate is at least 12 minutes past, open a Delay case and record the order ID and last status timestamp.";
export const ED02_V1 = "If tracking has not refreshed for 8 minutes after the case opens, the support agent must page the dispatch desk directly.";
export const ED02_V2 = "If tracking has not refreshed for 8 minutes after the case opens, the support agent must route the case to the duty lead. The duty lead pages the dispatch desk.";
export const ED04 = "Before signing out, copy each open Delay case ID into the shift email to the duty lead.";

type Clause = { stable_id: string; status: string; old: string | null; new: string | null; reasons: string[] };
type Spec = {
  suffix: string; role: "courier" | "employee"; language: "ar" | "en"; title: string; procedureTitle: string;
  stableIds: string[]; clauses: Clause[]; right: string; wrong: string; cited: string; cites: string;
};

export const COURIER: Spec = {
  suffix: "courier", role: "courier", language: "ar", title: "انتظار استلام الطلب من الفرع", procedureTitle: "تأخر تجهيز الطلب في الفرع",
  stableIds: ["CW-01", "CW-02", "CW-04"], cited: CW02_V2, cites: "CW-02", right: "أرسل بلاغ «تأخر الاستلام» بعد 10 دقائق", wrong: "انتظر 15 دقيقة ثم أرسل البلاغ",
  clauses: [
    { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01, reasons: [] },
    { stable_id: "CW-02", status: "changed", old: CW02_V1, new: CW02_V2, reasons: ["threshold: 15 دقيقة -> 10 دقائق"] },
    { stable_id: "CW-04", status: "moved", old: CW04, new: CW04, reasons: ["location changed"] },
  ],
};

export const EMPLOYEE: Spec = {
  suffix: "employee", role: "employee", language: "en", title: "Delayed order handling", procedureTitle: "Escalating a stalled delay case",
  stableIds: ["ED-01", "ED-02", "ED-04"], cited: ED02_V2, cites: "ED-02", right: "Route the case to the duty lead", wrong: "Page the dispatch desk yourself",
  clauses: [
    { stable_id: "ED-01", status: "unchanged", old: ED01, new: ED01, reasons: [] },
    { stable_id: "ED-02", status: "changed", old: ED02_V1, new: ED02_V2, reasons: ["actor: support agent -> duty lead", "location changed"] },
    { stable_id: "ED-04", status: "removed", old: ED04, new: null, reasons: [] },
  ],
};

export type Seeded = { documentId: string; procedureKey: string; path: string };

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/** Throws unless the app database is disposable (see the file comment). */
export function assertDisposable(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set (web/.env.local)");
  const ci = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
  const disposable = process.env.HL_DISPOSABLE_DB;
  if (!ci && (disposable === undefined || disposable === "" || databaseName(url) !== disposable)) {
    throw new Error(`B7 fixtures write rows: run against a throwaway database and set HL_DISPOSABLE_DB to its name (DATABASE_URL points at "${databaseName(url)}")`);
  }
  return url;
}

function mcq(right: string, wrong: string, prompt: string) {
  return {
    format: "mcq", prompt, scene: null, time_limit_seconds: null, feedback: "—", confidence_tap: true, correct_order: [],
    options: [{ text: right, correct: true, misconception: null }, { text: wrong, correct: false, misconception: "the old rule" }],
  };
}

export class B7Fixtures {
  private readonly db: postgres.Sql;
  private readonly run = randomUUID().slice(0, 8);
  private readonly documents: string[] = [];

  constructor() {
    this.db = postgres(assertDisposable(), { max: 1, onnotice: () => undefined });
  }

  /** One document with uploads v1 and v2 (current), the procedure on both, and published v2 training. */
  async seed(spec: Spec, learnerIds: string[]): Promise<Seeded> {
    const db = this.db;
    const documentId = `b7-${this.run}-${spec.suffix}`;
    const procedureKey = `b7-${this.run}-${spec.suffix}-proc`;
    this.documents.push(documentId);
    // docproc owns `comparisons` (-/docproc/src/docproc/storage/schema_postgres.sql); CI's web job has no docproc.
    await db`CREATE TABLE IF NOT EXISTS comparisons (
               document_id TEXT NOT NULL, new_version_id TEXT NOT NULL, old_version_id TEXT, complete BOOLEAN NOT NULL,
               report JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (document_id, new_version_id))`;
    await db`INSERT INTO hl_documents (document_id, title, role, language, current_version_id)
             VALUES (${documentId}, ${spec.title}, ${spec.role}, ${spec.language}, 'v2')`;
    let procedureId = "";
    for (const v of ["v1", "v2"]) {
      const [p] = await db<{ id: string }[]>`
        INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
        VALUES (${documentId}, ${v}, ${procedureKey}, 0, ${spec.procedureTitle}, ${db.json([spec.procedureTitle])}, ${db.json(spec.stableIds)}) RETURNING id`;
      procedureId = p.id;
    }
    const report = {
      old_version_id: "v1", new_version_id: "v2", complete: true,
      summary: { unchanged: 0, moved: 0, changed: 0, added: 0, removed: 0, needs_review: 0 },
      clauses: spec.clauses.map((c) => ({
        status: c.status, stable_id: c.stable_id, change_reasons: c.reasons,
        old: c.old === null ? null : { quote: c.old, heading: null }, new: c.new === null ? null : { quote: c.new, heading: null },
      })),
    };
    await db`INSERT INTO comparisons (document_id, new_version_id, old_version_id, complete, report)
             VALUES (${documentId}, 'v2', 'v1', true, ${db.json(report)})`;
    const [pkg] = await db<{ id: string }[]>`
      INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas)
      VALUES (${procedureId}, ${documentId}, 'v2', ${procedureKey}, ${spec.role}, ${spec.language}, 'ok', '[]', '[]', '[]') RETURNING id`;
    const items: [string, number, unknown][] = [
      ["lesson", 0, { title: spec.procedureTitle, key_points: [{ text: spec.right, stable_id: spec.cites, quote: spec.cited }], video: null }],
      ["practice", 1, mcq(spec.right, spec.wrong, `${spec.procedureTitle} (1)`)],
      ["exam", 2, mcq(spec.right, spec.wrong, `${spec.procedureTitle} (2)`)],
    ];
    for (const [kind, ordinal, payload] of items) {
      await db`INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
               VALUES (${pkg.id}, ${documentId}, 'v2', ${procedureKey}, ${spec.role}, ${kind}, ${ordinal}, ${spec.cites}, ${spec.cited},
                       ${db.json(payload as never)}, 'published')`;
    }
    for (const learnerId of learnerIds) {
      await db`INSERT INTO mastery (learner_id, document_id, procedure_key, version_id, state)
               VALUES (${learnerId}, ${documentId}, ${procedureKey}, 'v2', 'needs_refresh')`;
    }
    return { documentId, procedureKey, path: `/learn/${documentId}/${procedureKey}` };
  }

  /** Deletes exactly this run's rows, in one transaction. Nothing cascades. */
  async cleanup(): Promise<void> {
    const docs = this.documents;
    if (docs.length > 0) {
      await this.db.begin(async (tx) => {
        await tx`DELETE FROM attempts WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM mastery WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM notifications WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM training_items WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM training_packages WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM procedures WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM comparisons WHERE document_id IN ${tx(docs)}`;
        await tx`DELETE FROM hl_documents WHERE document_id IN ${tx(docs)}`;
      });
    }
    await this.db.end();
  }
}
