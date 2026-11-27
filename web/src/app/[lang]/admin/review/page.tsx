import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { approveAction, approvePackageAction, editQuestionAction, rejectPackageAction, rerenderVideoAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { ensureAdmin } from "@/components/guard";
import { CheckIcon, PageHeader, Pill, Skeleton, WarnIcon } from "@/components/ui";
import { citedClauses } from "@/lib/carry-over";
import { listClauses } from "@/lib/docproc";
import { getItem, getLessonVideo, getPackage, listItemEvents, listReviewQueue } from "@/lib/repo";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/i18n-server";
import type { Clause, LessonItem, QuestionItem, TrainingItem } from "@/lib/types";

const field = "mt-1 w-full min-h-11 rounded-xl border border-line bg-bg px-3 py-2";

function itemTitle(item: TrainingItem): string {
  return item.kind === "lesson" ? item.payload.title : item.payload.prompt;
}

async function Queue({ selected, t }: { selected: string | null; t: Dict }) {
  const items = await listReviewQueue();
  if (items.length === 0) return <p className="rounded-3xl border border-dashed border-line p-8 text-center text-ink-soft">{t.admin.review.empty}</p>;
  return (
    <ul className="grid gap-2" aria-label={t.admin.review.queueAria}>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/admin/review?item=${item.id}`}
            aria-current={item.id === selected ? "true" : undefined}
            className={`block rounded-2xl border p-4 transition-colors ${item.id === selected ? "border-brand bg-surface-2" : "border-line bg-surface hover:border-brand"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {item.flags.length > 0 ? <Pill tone="warn"><WarnIcon />{t.admin.review.needsAttention}</Pill> : null}
              <Pill tone={item.status === "approved" ? "brand" : "neutral"}>{t.labels.status[item.status]}</Pill>
              <span className="text-xs text-ink-soft">
                {t.labels.kind[item.kind]}
                {item.kind !== "lesson" ? ` · ${t.labels.format[item.payload.format]}` : ""}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 font-medium" dir="auto">{itemTitle(item)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function QuestionBody({ item, t }: { item: QuestionItem; t: Dict }) {
  const q = item.payload;
  const r = t.admin.review;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-soft">{t.labels.format[q.format]}{q.time_limit_seconds !== null ? ` · ${t.common.seconds(q.time_limit_seconds)}` : ""}</p>
      <div className="grid gap-3" dir="auto">
      {q.scene !== null ? <p className="rounded-2xl bg-surface-2 p-4">{q.scene}</p> : null}
      <p className="font-semibold">{q.prompt}</p>
      {q.options.length > 0 ? (
        <ol className="grid gap-2">
          {q.options.map((o, i) => (
            <li key={i} className={`rounded-xl border p-3 ${o.correct ? "border-brand bg-surface-2 font-medium" : "border-line"}`}>
              <span className="flex items-start gap-2">{o.correct ? <span className="mt-1 text-brand"><CheckIcon /></span> : null}{o.text}</span>
              {o.misconception !== null ? <span className="mt-1 block text-xs text-ink-soft">{r.misconception}{o.misconception}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {q.correct_order.length > 0 ? <ol className="grid list-decimal gap-1 ps-5">{q.correct_order.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
      </div>
      <p className="text-sm text-ink-soft">{r.feedback}<span dir="auto">{q.feedback}</span></p>
    </div>
  );
}

function EditForm({ item, t }: { item: QuestionItem; t: Dict["admin"]["review"] }) {
  const action = editQuestionAction.bind(null, item.id);
  return (
    <details className="rounded-2xl border border-line p-4">
      <summary className="cursor-pointer font-semibold">{t.edit}</summary>
      <form action={action} className="mt-3 grid gap-3">
        <label className="text-sm font-medium">{t.prompt}<textarea name="prompt" dir="auto" defaultValue={item.payload.prompt} required rows={2} className={field} /></label>
        {item.payload.options.map((o, i) => (
          <label key={i} className="text-sm font-medium">{t.option(i + 1, o.correct)}<input name="option" dir="auto" defaultValue={o.text} required className={field} /></label>
        ))}
        <label className="text-sm font-medium">{t.feedbackField}<textarea name="feedback" dir="auto" defaultValue={item.payload.feedback} required rows={2} className={field} /></label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-2xl border border-brand font-bold text-brand hover:bg-surface-2">{t.saveRecheck}</button>
      </form>
    </details>
  );
}

async function LessonBody({ item, t }: { item: LessonItem; t: Dict }) {
  const r = t.admin.review;
  const video = await getLessonVideo(item.id);
  const busy = video !== null && (video.status === "queued" || video.status === "rendering");
  // Renders run in an in-process queue; one idle for an hour was lost (e.g. a server restart).
  const stale = busy && video !== null && video.secondsSinceUpdate > 60 * 60;
  const rerender = rerenderVideoAction.bind(null, item.id);
  const shots = item.payload.video?.shots ?? [];
  return (
    <div className="grid gap-3">
      <AutoRefresh active={busy} intervalMs={5000} />
      <h4 className="text-xl font-bold" dir="auto">{item.payload.title}</h4>
      <ol className="grid list-decimal gap-1 ps-5" dir="auto">{item.payload.key_points.map((k, i) => <li key={i}>{k.text}</li>)}</ol>
      <h5 className="mt-2 text-sm font-semibold text-ink-soft">{r.video} · {video !== null ? t.labels.video[video.status] : r.noVideo}</h5>
      {video !== null && video.status === "ready" ? <video controls preload="metadata" className="max-h-[70vh] w-full rounded-2xl border border-line bg-black" src={`/api/media/${video.itemId}`} /> : null}
      {video !== null && video.status === "failed" ? <code className="block overflow-x-auto rounded-xl bg-ember-bg p-3 text-xs text-ember" dir="ltr">{video.error.slice(0, 800)}</code> : null}
      {busy ? <p className="animate-pulse rounded-2xl bg-surface-2 p-4 text-center text-ink-soft">{r.rendering}</p> : null}
      {video !== null && (video.status === "failed" || stale) ? (
        <form action={rerender}><button type="submit" className="min-h-11 cursor-pointer rounded-2xl border border-brand px-5 font-bold text-brand">{r.rerender}</button></form>
      ) : null}
      <ol className="grid gap-2">
        {shots.map((s, i) => (
          <li key={i} className="rounded-2xl bg-surface-2 p-3 text-sm">
            <p className="font-bold">{r.shot} <span className="num">{i + 1}</span> · <span className="num">{t.common.seconds(s.seconds)}</span> · {s.clip_id ?? r.slide}</p>
            <p className="mt-1">{r.onScreen}<span dir="auto">{s.on_screen_text}</span></p>
            {s.narration !== null ? <p className="mt-1 text-ink-soft">{r.narration}<span dir="auto">{s.narration}</span></p> : null}
            <p className="mt-1 text-xs text-ink-soft">{r.mustShow}<span dir="auto">{s.must_show.join(r.listSep) || "—"}</span> · {r.mustNotShow}<span dir="auto">{s.must_not_show.join(r.listSep) || "—"}</span></p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceClauses({ item, clauses, t }: { item: TrainingItem; clauses: Clause[]; t: Dict }) {
  const cited = citedClauses(item, clauses);
  return (
    <div className="grid gap-3">
      {cited.map((c) => (
        <figure key={c.recordId} className="rounded-2xl border border-line bg-bg p-4">
          <figcaption className="mb-1 flex flex-wrap gap-2 text-xs text-ink-soft">
            {c.page !== null ? <span className="num">{t.common.page(c.page)}</span> : null}
            <span className="num" dir="ltr">{c.stableId.slice(0, 8)}</span>
          </figcaption>
          <blockquote className="source-quote" dir="auto">{c.quote}</blockquote>
        </figure>
      ))}
      {cited.length === 0 ? <p className="text-sm text-ember">{t.admin.review.clauseMissing}</p> : null}
    </div>
  );
}

async function Panel({ itemId, t }: { itemId: string; t: Dict }) {
  const r = t.admin.review;
  const item = await getItem(itemId);
  const [clauses, events, pkg] = await Promise.all([listClauses(item.documentId, item.versionId), listItemEvents(item.id), getPackage(item.packageId)]);
  const reviewable = item.status === "draft" || item.status === "verified" || item.status === "approved";
  const approve = approveAction.bind(null, item.id);
  const approveAll = approvePackageAction.bind(null, item.packageId);
  const reject = rejectPackageAction.bind(null, item.packageId);

  return (
    <article className="panel-enter rounded-3xl border border-line bg-surface p-6" aria-label={r.panelAria}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="neutral">{t.labels.kind[item.kind]}</Pill>
        <Pill tone={item.status === "published" ? "brand" : "neutral"}>{t.labels.status[item.status]}</Pill>
        {item.flags.map((f) => <Pill key={f} tone="warn"><WarnIcon />{r.flag[f] ?? f}</Pill>)}
      </div>
      {item.judgeReason !== "" ? <p className="mt-2 text-sm text-ink-soft">{r.judgeNote}<span dir="auto">{item.judgeReason}</span></p> : null}
      {pkg.flags.map((f, i) => <p key={i} className="mt-2 rounded-xl bg-ember-bg p-2 text-sm text-ember" dir="auto">{f.type}: {f.note}</p>)}

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-soft">{r.generated}</h3>
          {item.kind === "lesson" ? <LessonBody item={item} t={t} /> : <QuestionBody item={item} t={t} />}
          <p className="mt-3 text-xs text-ink-soft">{r.citedQuote}<q className="source-quote" dir="auto">{item.quote}</q></p>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-soft">{r.source}</h3>
          <SourceClauses item={item} clauses={clauses} t={t} />
        </section>
      </div>

      {reviewable ? (
        <section className="mt-6 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {item.status !== "approved" ? (
              <form action={approve}><button type="submit" className="min-h-12 w-full cursor-pointer rounded-2xl bg-accent text-lg font-bold text-on-accent hover:bg-accent-strong">{r.approve}</button></form>
            ) : <p className="rounded-2xl bg-surface-2 p-3 text-center text-sm">{r.approvedNote}</p>}
            <form action={approveAll}><button type="submit" className="min-h-12 w-full cursor-pointer rounded-2xl border-2 border-brand text-lg font-bold text-brand hover:bg-surface-2">{r.approveAll}</button></form>
          </div>
          {item.kind !== "lesson" ? <EditForm item={item} t={r} /> : null}
          <form action={reject} className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="reason">{r.rejectReason}</label>
            <input id="reason" name="reason" dir="auto" placeholder={r.rejectPlaceholder} className="min-h-11 flex-1 rounded-xl border border-line bg-bg px-3" />
            <button type="submit" className="min-h-11 cursor-pointer rounded-2xl border border-ember px-5 font-bold text-ember hover:bg-ember-bg">{r.reject}</button>
          </form>
        </section>
      ) : null}

      <section className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-ink-soft">{r.audit}</h3>
        <ol className="grid gap-1 text-sm">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 text-ink-soft">
              <span className="num" dir="ltr">{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span>
              <span className="text-ink">{e.actor}</span>
              <span>{e.action}</span>
              <span className="num" dir="ltr">{e.fromStatus ?? "∅"} → {e.toStatus}</span>
              <span className="num">{e.versionId}</span>
              {e.note !== "" ? <span dir="auto">{e.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

async function ReviewContent({ searchParams }: { searchParams: PageProps<"/[lang]/admin/review">["searchParams"] }) {
  await connection();
  await ensureAdmin();
  const t = await getDict();
  const params = await searchParams;
  const selected = typeof params.item === "string" ? params.item : null;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <Queue selected={selected} t={t} />
      {selected !== null ? <Panel key={selected} itemId={selected} t={t} /> : (
        <p className="hidden rounded-3xl border border-dashed border-line p-10 text-center text-ink-soft lg:block">{t.admin.review.pick}</p>
      )}
    </div>
  );
}

export default async function ReviewPage({ searchParams }: PageProps<"/[lang]/admin/review">) {
  const t = await getDict();
  const r = t.admin.review;
  return (
    <>
      <PageHeader eyebrow={r.eyebrow} title={r.title}>
        {r.intro}
      </PageHeader>
      <Suspense fallback={<Skeleton label={r.loading} />}>
        <ReviewContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
