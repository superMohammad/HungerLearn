import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ensureLearner } from "@/components/guard";
import { CheckIcon, PageHeader, Pill, Skeleton, WarnIcon } from "@/components/ui";
import { levelFor } from "@/lib/compose";
import { branchName } from "@/lib/i18n";
import { getDict } from "@/lib/i18n-server";
import { learnerProgress, listNotifications } from "@/lib/learning";
import { getLearner } from "@/lib/repo";

async function LearnerHome() {
  await connection();
  const learnerId = await ensureLearner();
  const [learner, t] = await Promise.all([getLearner(learnerId), getDict()]);
  const [progress, notifications] = await Promise.all([learnerProgress(learner), listNotifications(learnerId)]);
  const mastered = progress.filter((p) => p.state === "mastered");
  const level = levelFor(mastered.length, progress.length);

  return (
    <>
      <PageHeader eyebrow={`${t.labels.role[learner.role]} · ${branchName(t, learner.branch)}`} title={t.learn.greeting(learner.name)}>
        {t.learn.intro}
      </PageHeader>

      <section className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-3xl bg-accent p-5 text-on-accent">
          <p className="text-sm">{t.learn.level}</p>
          <p className="mt-1 text-3xl font-bold">{t.labels.level[level]}</p>
        </div>
        <div className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-ink-soft">{t.learn.badges}</p>
          <p className="num mt-1 text-3xl font-medium" dir="ltr">{mastered.length}<span className="text-base text-ink-soft">/{progress.length}</span></p>
        </div>
      </section>

      {notifications.length > 0 ? (
        <section className="mb-6 grid gap-3" aria-label={t.learn.updatesAria}>
          {notifications.map((n) => (
            <div key={n.id} className="rounded-3xl border border-ember bg-ember-bg p-5 text-ink">
              <p className="flex items-center gap-2 font-bold text-ember"><WarnIcon />{t.learn.whatChanged}</p>
              <p className="mt-2 whitespace-pre-line text-sm" dir="auto">{n.message}</p>
            </div>
          ))}
        </section>
      ) : null}

      <h2 className="mb-3 text-lg font-bold">{t.learn.yourProcedures}</h2>
      {progress.length === 0 ? <p className="rounded-3xl border border-dashed border-line p-8 text-center text-ink-soft">{t.learn.nothingPublished}</p> : null}
      <ul className="grid gap-3">
        {progress.map((p) => (
          <li key={`${p.documentId}/${p.procedureKey}`}>
            <Link href={`/learn/${p.documentId}/${p.procedureKey}`} className="flex min-h-16 items-center justify-between gap-4 rounded-3xl border border-line bg-surface p-5 hover:border-brand">
              <span dir="auto">
                <span className="block text-lg font-bold">{p.title}</span>
                <span className="text-sm text-ink-soft">{p.documentTitle}</span>
              </span>
              <Pill tone={p.state === "mastered" ? "brand" : p.state === "needs_refresh" ? "warn" : "neutral"}>
                {p.state === "mastered" ? <CheckIcon /> : p.state === "needs_refresh" ? <WarnIcon /> : null}
                {t.labels.mastery[p.state]}
              </Pill>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function LearnPage() {
  const t = await getDict();
  return (
    <Suspense fallback={<Skeleton label={t.learn.loadingHome} />}>
      <LearnerHome />
    </Suspense>
  );
}
