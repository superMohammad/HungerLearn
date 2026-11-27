import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { generateProcedureAction, publishAction, uploadNewVersion } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { ensureAdmin } from "@/components/guard";
import { Card, CheckIcon, NumText, PageHeader, Pill, Skeleton, WarnIcon } from "@/components/ui";
import { getComparison, listClauses, listVersions } from "@/lib/docproc";
import { reasonLabel } from "@/lib/reasons";
import { getDocument, latestPackages, listJobs, listProcedures, listVersionItems } from "@/lib/repo";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/i18n-server";
import type { ClauseStatus, TrainingItem, TrainingPackage } from "@/lib/types";
import { uploadNumber } from "@/lib/uploads";

function stepLabel(step: string, labels: Dict["admin"]["doc"]["step"]): string {
  if (step.startsWith("generate:")) return labels.generate(step.slice("generate:".length));
  const fixed: Record<string, string> = { queued: labels.queued, understand: labels.understand, procedures: labels.procedures, update: labels.update };
  return fixed[step] ?? step;
}

function ItemChip({ item, t }: { item: TrainingItem; t: Dict }) {
  const flagged = item.flags.length > 0 && (item.status === "draft" || item.status === "verified");
  return (
    <Link href={`/admin/review?item=${item.id}`} className="inline-flex">
      <Pill tone={flagged ? "warn" : item.status === "published" ? "brand" : "neutral"}>
        {flagged ? <WarnIcon /> : item.status === "published" ? <CheckIcon /> : null}
        {t.labels.kind[item.kind]} · {t.labels.status[item.status]}
      </Pill>
    </Link>
  );
}

async function DocumentDetail({ params }: { params: PageProps<"/[lang]/admin/documents/[id]">["params"] }) {
  const { id: documentId } = await params;
  await connection();
  await ensureAdmin();
  const [doc, t] = await Promise.all([getDocument(documentId), getDict()]);
  const d = t.admin.doc;
  const [versions, jobs] = await Promise.all([listVersions(documentId), listJobs(documentId)]);
  const running = jobs.some((j) => j.status === "running");
  const versionId = doc.currentVersionId ?? versions.at(-1)?.versionId ?? null;
  const [clauses, procedures, packages, items, report] =
    versionId === null
      ? [[], [], new Map<string, TrainingPackage>(), [], null]
      : await Promise.all([
          listClauses(documentId, versionId),
          listProcedures(documentId, versionId),
          latestPackages(documentId, versionId),
          listVersionItems(documentId, versionId),
          getComparison(documentId, versionId),
        ]);
  const clauseById = new Map(clauses.map((c) => [c.stableId, c]));
  const statusOf = new Map((report?.clauses ?? []).filter((c) => c.stable_id !== null).map((c) => [c.stable_id as string, c]));
  const generatingTitles = new Set(jobs.filter((j) => j.status === "running" && j.step.startsWith("generate:")).map((j) => j.step.slice(9)));
  const approved = items.filter((i) => i.status === "approved").length;
  const publish = versionId === null ? null : publishAction.bind(null, documentId, versionId);
  const upload = uploadNewVersion.bind(null, documentId);
  const isV2 = report !== null && report.old_version_id !== null;

  return (
    <>
      <AutoRefresh active={running} intervalMs={4000} />
      <PageHeader eyebrow={`${t.labels.role[doc.role]} · ${t.labels.language[doc.language]}`} title={doc.title}>
        <span className="num">{documentId}</span> · {versionId === null ? "…" : <NumText text={d.uploads(uploadNumber(versionId), versions.length)} />}
      </PageHeader>

      <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="">
          <h2 className="text-lg font-bold">{d.pipeline}</h2>
          {jobs.length === 0 ? <p className="mt-2 text-ink-soft">{d.notStarted}</p> : null}
          <ol className="mt-3 grid gap-2">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-ink-soft"><NumText text={t.common.upload(uploadNumber(j.versionId))} /></span>
                <span className="font-medium"><bdi>{stepLabel(j.step, d.step)}</bdi></span>
                <Pill tone={j.status === "failed" ? "warn" : j.status === "running" ? "accent" : "neutral"}>
                  {j.status === "failed" ? <WarnIcon /> : j.status === "done" ? <CheckIcon /> : null}
                  {t.labels.job[j.status]}
                </Pill>
                {j.error !== "" ? <code className="block w-full overflow-x-auto rounded-xl bg-ember-bg p-2 text-xs text-ember" dir="ltr">{j.error.slice(0, 600)}</code> : null}
              </li>
            ))}
          </ol>
        </Card>
        <Card className="">
          <h2 className="text-lg font-bold">{d.publishTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {d.approvedWaiting}<span className="num text-ink">{approved}</span>{d.onlyPublished}
          </p>
          {publish !== null ? (
            <form action={publish} className="mt-3">
              <button type="submit" disabled={approved === 0} className="min-h-11 w-full cursor-pointer rounded-2xl bg-accent font-bold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">
                {d.publish(approved)}
              </button>
            </form>
          ) : null}
          <form action={upload} className="mt-5 border-t border-line pt-4">
            <label className="block text-sm font-medium">
              {d.newVersion(versions.length + 1)}
              <input name="file" type="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className="mt-1 w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1" />
            </label>
            <button type="submit" disabled={running} className="mt-3 min-h-11 w-full cursor-pointer rounded-2xl border border-brand font-bold text-brand hover:bg-surface-2 disabled:opacity-50">
              {d.compare}
            </button>
          </form>
        </Card>
      </div>

      {isV2 && report !== null ? (
        <Card className="mb-8">
          <h2 className="text-lg font-bold">{d.changesTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{d.changesBody}</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { k: d.stable, v: report.summary.unchanged + report.summary.moved },
              { k: d.changedOrNew, v: report.summary.changed + report.summary.added + report.summary.needs_review },
              { k: d.removed, v: report.summary.removed },
              { k: d.procedures, v: procedures.length },
            ].map((x) => (
              <div key={x.k} className="rounded-2xl bg-surface-2 p-4">
                <dt className="text-sm text-ink-soft">{x.k}</dt>
                <dd className="num mt-1 text-3xl font-medium">{x.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      <h2 className="mb-3 text-lg font-bold">
        {d.procedures} <span className="num text-ink-soft">({procedures.length})</span>
        <span className="ms-3 text-sm font-normal text-ink-soft">{d.clauses}<span className="num">{clauses.length}</span></span>
      </h2>
      <ol className="grid gap-4">
        {procedures.map((p) => {
          const pkg = packages.get(p.id);
          const pkgItems = pkg === undefined ? [] : items.filter((i) => i.packageId === pkg.id);
          const generating = generatingTitles.has(p.title);
          const generate = generateProcedureAction.bind(null, p.id);
          return (
            <li key={p.id} className="rounded-3xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-ink-soft">#{p.ordinal + 1}</span>
                <h3 className="text-lg font-bold"><span dir="auto">{p.title}</span></h3>
                {pkg !== undefined ? (
                  <Pill tone={pkg.status === "ok" ? "brand" : pkg.status === "needs_human" ? "warn" : "neutral"}>
                    {pkg.status === "needs_human" ? <WarnIcon /> : null}
                    {t.labels.packageStatus[pkg.status]}
                  </Pill>
                ) : null}
                {generating ? <Pill tone="accent">{d.generating}</Pill> : null}
                {!generating ? (
                  <form action={generate} className="ms-auto">
                    {pkg === undefined ? (
                      <button type="submit" className="min-h-11 cursor-pointer rounded-2xl bg-accent px-5 font-bold text-on-accent hover:bg-accent-strong">
                        {d.generate}
                      </button>
                    ) : (
                      <button type="submit" className="min-h-11 cursor-pointer rounded-2xl border border-line px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink">
                        {d.regenerate}
                      </button>
                    )}
                  </form>
                ) : null}
              </div>
              {p.steps.length > 0 ? (
                <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft" dir="auto">
                  {p.steps.map((s, i) => <li key={i}><span className="num">{i + 1}.</span> {s}</li>)}
                </ol>
              ) : null}
              <div className="mt-3 grid gap-2">
                {p.stableIds.map((sid) => {
                  const c = clauseById.get(sid);
                  const change = statusOf.get(sid);
                  if (c === undefined) return null;
                  const reasons = (change?.change_reasons ?? []).filter((r) => r !== "location changed");
                  return (
                    <blockquote key={sid} className="rounded-2xl bg-bg p-3">
                      <span className="mb-1 flex flex-wrap gap-2 text-xs text-ink-soft">
                        {c.page !== null ? <span className="num">{t.common.page(c.page)}</span> : null}
                        <span className="num" dir="ltr">{sid.slice(0, 8)}</span>
                        {isV2 && change !== undefined ? (
                          <Pill tone={change.status === "changed" || change.status === "added" ? "warn" : "neutral"}>{t.labels.clauseStatus[change.status as ClauseStatus]}</Pill>
                        ) : null}
                      </span>
                      <span className="source-quote block" dir="auto">{c.quote}</span>
                      {reasons.length > 0 ? <span className="mt-1 block text-sm text-ember">{reasons.map((r) => reasonLabel(r, t.reasons)).join(" · ")}</span> : null}
                    </blockquote>
                  );
                })}
              </div>
              {pkg !== undefined ? (
                <div className="mt-3 grid gap-2">
                  {pkg.skipReason !== null ? <p className="text-sm text-ink-soft" dir="auto">{pkg.skipReason}</p> : null}
                  <div className="flex flex-wrap gap-2">{pkgItems.map((i) => <ItemChip key={i.id} item={i} t={t} />)}</div>
                  {pkg.flags.map((f, i) => (
                    <p key={i} className="flex items-start gap-2 rounded-xl bg-ember-bg p-2 text-sm text-ember"><WarnIcon /><span dir="auto">{f.type}: {f.note}</span></p>
                  ))}
                  {pkg.resourceRequests.map((r, i) => (
                    <p key={i} className="rounded-xl bg-surface-2 p-2 text-sm">
                      <strong>{d.resourceRequest(r.priority)}</strong> <span dir="auto">{r.need}</span> · <span className="text-ink-soft">{d.fallbackUsed}<span dir="auto">{r.fallback_used}</span></span>
                    </p>
                  ))}
                  {pkg.ideas.map((idea, i) => <p key={i} className="text-sm text-ink-soft">{d.idea}<span dir="auto">{idea}</span></p>)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default async function DocumentPage({ params }: PageProps<"/[lang]/admin/documents/[id]">) {
  const t = await getDict();
  return (
    <Suspense fallback={<Skeleton label={t.admin.doc.loading} />}>
      <DocumentDetail params={params} />
    </Suspense>
  );
}
