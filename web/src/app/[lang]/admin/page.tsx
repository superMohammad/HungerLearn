import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { uploadNewDocument } from "@/app/actions";
import { ensureAdmin } from "@/components/guard";
import { Card, PageHeader, Pill, Skeleton } from "@/components/ui";
import { sql } from "@/lib/db";
import { getDict } from "@/lib/i18n-server";
import { LANGUAGES, ROLES, type Role } from "@/lib/types";

type DocRow = { document_id: string; title: string; role: Role; language: string; current_version_id: string | null; clauses: number; published: number; pending: number; running: number };

async function DocumentList() {
  await connection();
  await ensureAdmin();
  const t = await getDict();
  const docs = await sql()<DocRow[]>`
    SELECT d.document_id, d.title, d.role, d.language, d.current_version_id,
      (SELECT COUNT(*)::int FROM procedures c WHERE c.document_id = d.document_id AND c.version_id = d.current_version_id) AS clauses,
      (SELECT COUNT(*)::int FROM training_items i WHERE i.document_id = d.document_id AND i.version_id = d.current_version_id AND i.status = 'published') AS published,
      (SELECT COUNT(*)::int FROM training_items i WHERE i.document_id = d.document_id AND i.version_id = d.current_version_id AND i.status IN ('draft','verified','approved')) AS pending,
      (SELECT COUNT(*)::int FROM pipeline_jobs j WHERE j.document_id = d.document_id AND j.status = 'running') AS running
    FROM hl_documents d ORDER BY d.created_at DESC`;
  if (docs.length === 0) {
    return <p className="rounded-3xl border border-dashed border-line p-8 text-center text-ink-soft">{t.admin.docs.empty}</p>;
  }
  return (
    <ul className="grid content-start gap-4">
      {docs.map((d) => (
        <li key={d.document_id}>
          <Link href={`/admin/documents/${d.document_id}`} className="block rounded-3xl border border-line bg-surface p-5 transition-colors hover:border-brand">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold"><span dir="auto">{d.title}</span></h3>
              <Pill tone="neutral">{t.labels.role[d.role]}</Pill>
              <Pill tone="neutral"><span className="num">{d.current_version_id ?? "…"}</span></Pill>
              {d.running > 0 ? <Pill tone="accent">{t.admin.docs.processing}</Pill> : null}
            </div>
            <dl className="mt-3 flex flex-wrap gap-6 text-sm text-ink-soft">
              <div><dt className="inline">{t.admin.docs.procedures}</dt><dd className="num inline text-ink">{d.clauses}</dd></div>
              <div><dt className="inline">{t.admin.docs.published}</dt><dd className="num inline text-ink">{d.published}</dd></div>
              <div><dt className="inline">{t.admin.docs.pending}</dt><dd className="num inline text-ink">{d.pending}</dd></div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const field = "mt-1 w-full min-h-11 rounded-xl border border-line bg-bg px-3 py-2";

export default async function AdminHome() {
  const t = await getDict();
  const d = t.admin.docs;
  return (
    <>
      <PageHeader eyebrow={d.eyebrow} title={d.title}>
        {d.intro}
      </PageHeader>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <Suspense fallback={<Skeleton label={d.loading} />}>
          <DocumentList />
        </Suspense>
        <Card className="h-fit">
          <h2 className="text-lg font-bold">{d.uploadTitle}</h2>
          <form action={uploadNewDocument} className="mt-4 grid gap-4">
            <label className="block text-sm font-medium">
              {d.docTitle}
              <input name="title" required minLength={3} dir="auto" className={field} placeholder={d.docTitlePlaceholder} />
            </label>
            <label className="block text-sm font-medium">
              {d.docId}
              <input name="documentId" required pattern="[a-z0-9][a-z0-9\-]{2,60}" dir="ltr" className={`${field} num`} placeholder="courier-pickup-wait" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                {d.role}
                <select name="role" className={field} defaultValue="courier">
                  {ROLES.map((r) => <option key={r} value={r}>{t.labels.role[r]}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">
                {d.language}
                <select name="language" className={field} defaultValue="ar">
                  {LANGUAGES.map((lang) => <option key={lang} value={lang}>{t.labels.language[lang]}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">
              {d.partnerType}
              <select name="partnerType" className={field} defaultValue="restaurant">
                <option value="restaurant">{t.labels.partnerType.restaurant}</option>
                <option value="cafe">{t.labels.partnerType.cafe}</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              {d.file}
              <input name="file" type="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className={`${field} file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1`} />
              <span className="mt-1 block text-xs text-ink-soft">{d.fileHint}</span>
            </label>
            <button type="submit" className="min-h-12 cursor-pointer rounded-2xl bg-accent font-bold text-on-accent hover:bg-accent-strong">
              {d.submit}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
