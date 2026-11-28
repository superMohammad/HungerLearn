import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ensureLearner } from "@/components/guard";
import { Screen } from "@/components/screen";
import { PageHeader, Skeleton } from "@/components/ui";
import { nextScreen } from "@/lib/learning";
import { getDict } from "@/lib/i18n-server";
import { getDocument, getLearner } from "@/lib/repo";

async function ProcedureScreen({ params, searchParams }: { params: PageProps<"/[lang]/learn/[doc]/[proc]">["params"]; searchParams: PageProps<"/[lang]/learn/[doc]/[proc]">["searchParams"] }) {
  const [{ doc: documentId, proc }, query] = await Promise.all([params, searchParams]);
  await connection();
  const learnerId = await ensureLearner();
  const [learner, doc, t] = await Promise.all([getLearner(learnerId), getDocument(documentId), getDict()]);
  if (doc.role !== learner.role) throw new Error(`Procedure ${documentId}/${proc} is for role ${doc.role}, not ${learner.role}`);
  const screen = await nextScreen(learner, doc, proc, query.changes === "1" ? "changes" : query.lesson === "1" ? "lesson" : query.start === "1" ? "questions" : "auto");
  const key = screen.kind === "screen" ? (screen.spec.kind === "question" ? screen.spec.itemId : screen.spec.kind) : screen.kind;
  return (
    <>
      <PageHeader eyebrow={t.learn.flow} title={screen.title}>
        <Link href="/learn" className="text-sm underline underline-offset-4">{t.learn.backToProcedures}</Link>
      </PageHeader>
      {screen.kind === "screen" && screen.changesAvailable && screen.spec.kind !== "what_changed" ? (
        <p className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-brand bg-surface p-4 text-sm text-ink">
          <span>{t.learn.changes.recheck}</span>
          <Link href={`/learn/${documentId}/${proc}?changes=1`} className="font-bold underline underline-offset-4">{t.learn.changes.review}</Link>
        </p>
      ) : null}
      {screen.kind === "screen" ? <Screen key={key} spec={screen.spec} /> : null}
      {screen.kind === "mastered" ? (
        <div className="grid gap-3">
          <p className="rounded-3xl bg-accent p-8 text-center text-xl font-bold text-on-accent">{t.learn.masteredBanner}</p>
          <Link href={`/learn/${documentId}/${proc}?lesson=1`} className="text-center text-sm underline underline-offset-4">{t.learn.reviewLesson}</Link>
        </div>
      ) : null}
      {screen.kind === "empty" ? <p className="rounded-3xl border border-dashed border-line p-8 text-center text-ink-soft">{t.learn.empty}</p> : null}
    </>
  );
}

export default async function LearnProcedurePage({ params, searchParams }: PageProps<"/[lang]/learn/[doc]/[proc]">) {
  const t = await getDict();
  return (
    <Suspense fallback={<Skeleton label={t.learn.loadingScreen} />}>
      <ProcedureScreen params={params} searchParams={searchParams} />
    </Suspense>
  );
}
