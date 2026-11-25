"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { answerAction } from "@/app/actions";
import type { QuestionScreen, ScreenSpec } from "@/lib/compose";
import type { AnswerResult } from "@/lib/learning";
import { useDict } from "@/components/i18n-provider";

/** Renders a validated screen spec. It only arranges approved content; grading happens on the server. */
export function Screen({ spec }: { spec: ScreenSpec }) {
  return spec.kind === "lesson" ? <Lesson spec={spec} /> : <Question spec={spec} />;
}

function Lesson({ spec }: { spec: Extract<ScreenSpec, { kind: "lesson" }> }) {
  const pathname = usePathname();
  const t = useDict();
  return (
    <article className="panel-enter grid gap-5">
      <p className="text-xs font-semibold tracking-wide text-ink-soft">{t.screen.lesson}</p>
      {spec.videoUrl !== null ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={spec.videoUrl}
          className={`w-full rounded-3xl border border-line bg-black ${spec.orientation === "portrait" ? "mx-auto aspect-[9/16] max-h-[70vh] w-auto" : "aspect-video"}`}
        />
      ) : null}
      <section className="rounded-3xl border border-line bg-surface p-5" dir="auto">
        <h2 className="text-xl font-bold">{spec.title}</h2>
        <ul className="mt-3 grid gap-2">
          {spec.keyPoints.map((k, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="num mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent">{i + 1}</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link href={`${pathname}?start=1`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand px-6 text-lg font-bold text-bg">
        {t.screen.startTraining}
      </Link>
    </article>
  );
}

type Draft = { choice: number | null; selected: ReadonlySet<number>; order: string[] };

function Question({ spec }: { spec: QuestionScreen }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useDict();
  const [draft, setDraft] = useState<Draft>({ choice: null, selected: new Set(), order: spec.steps });
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(spec.timeLimitSeconds);

  function submit(confidence: "sure" | "unsure", timedOut: boolean): void {
    setError(null);
    startTransition(async () => {
      try {
        const answer =
          spec.format === "checklist"
            ? { format: spec.format, selected: [...draft.selected] }
            : spec.format === "order_steps"
              ? { format: spec.format, order: draft.order }
              : { format: spec.format, choice: timedOut ? -1 : (draft.choice ?? -1) };
        setResult(await answerAction({ itemId: spec.itemId, answer, confidence }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // timed_decision countdown: one tick per second; running out submits a timed-out (wrong) answer.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || result !== null || pending) return;
    const t = window.setTimeout(() => {
      if (secondsLeft === 1) submit("unsure", true);
      setSecondsLeft(secondsLeft - 1);
    }, 1000);
    return () => window.clearTimeout(t);
  });

  const ready =
    spec.format === "checklist" ? draft.selected.size > 0
    : spec.format === "order_steps" ? true
    : draft.choice !== null;

  function move(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= draft.order.length) return;
    const order = [...draft.order];
    [order[i], order[j]] = [order[j], order[i]];
    setDraft({ ...draft, order });
  }

  return (
    <article className="panel-enter grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-ink-soft">
          {t.screen.phase[spec.phase]} · {t.labels.format[spec.format]}
        </p>
        {secondsLeft !== null && result === null ? (
          <p className="num rounded-full bg-accent px-4 py-1 text-lg font-bold text-on-accent" aria-live="polite">{t.common.seconds(secondsLeft)}</p>
        ) : null}
      </div>

      <section className="rounded-3xl border border-line bg-surface p-5">
        <div dir="auto">
        {spec.scene !== null ? <p className="mb-4 rounded-2xl bg-surface-2 p-4 text-lg">{spec.scene}</p> : null}
        <fieldset disabled={result !== null || pending}>
          <legend className="mb-3 text-lg font-bold">{spec.prompt}</legend>

          {spec.format === "mcq" || spec.format === "timed_decision" || spec.format === "spot_the_mistake" ? (
            <div className="grid gap-2">
              {spec.options.map((o, i) => (
                <label key={i} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 ${draft.choice === i ? "border-brand bg-surface-2" : "border-line hover:border-brand"}`}>
                  <input type="radio" name="choice" className="size-5 accent-[var(--brand)]" checked={draft.choice === i} onChange={() => setDraft({ ...draft, choice: i })} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          ) : null}

          {spec.format === "checklist" ? (
            <div className="grid gap-2">
              {spec.options.map((o, i) => (
                <label key={i} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 ${draft.selected.has(i) ? "border-brand bg-surface-2" : "border-line hover:border-brand"}`}>
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--brand)]"
                    checked={draft.selected.has(i)}
                    onChange={() => {
                      const next = new Set(draft.selected);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setDraft({ ...draft, selected: next });
                    }}
                  />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          ) : null}

          {spec.format === "order_steps" ? (
            <ol className="grid gap-2">
              {draft.order.map((s, i) => (
                <li key={s} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-line p-3">
                  <span className="num inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-on-accent">{i + 1}</span>
                  <span className="flex-1">{s}</span>
                  <button type="button" aria-label={t.screen.moveUp(s)} onClick={() => move(i, -1)} disabled={i === 0} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-line disabled:opacity-30">▲</button>
                  <button type="button" aria-label={t.screen.moveDown(s)} onClick={() => move(i, 1)} disabled={i === draft.order.length - 1} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-line disabled:opacity-30">▼</button>
                </li>
              ))}
            </ol>
          ) : null}

        </fieldset>
        </div>

        {result === null ? (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-ink-soft">{t.screen.confidence}</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => submit("sure", false)} disabled={!ready || pending} className="min-h-12 cursor-pointer rounded-2xl bg-accent text-lg font-bold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">
                {pending ? t.screen.grading : t.screen.sure}
              </button>
              <button type="button" onClick={() => submit("unsure", false)} disabled={!ready || pending} className="min-h-12 cursor-pointer rounded-2xl border-2 border-brand text-lg font-bold text-brand disabled:cursor-not-allowed disabled:opacity-50">
                {t.screen.unsure}
              </button>
            </div>
          </div>
        ) : null}
        {error !== null ? <p className="mt-3 rounded-2xl bg-ember-bg p-3 text-sm text-ember" dir="auto">{error}</p> : null}
      </section>

      {result !== null ? (
        <section aria-live="polite" className={`rounded-3xl border-2 p-5 ${result.correct ? "border-brand bg-surface-2" : "border-ember bg-ember-bg"}`}>
          <p className="text-xl font-bold">{result.correct ? t.screen.correct : t.screen.wrong}</p>
          {!result.correct ? <p className="mt-2">{t.screen.correctAnswer} <strong dir="auto">{result.correctAnswer}</strong></p> : null}
          <p className="mt-2" dir="auto">{result.feedback}</p>
          <blockquote className="source-quote mt-3 border-s-4 border-accent ps-3" dir="auto">«{result.quote}»</blockquote>
          {result.state === "mastered" ? (
            <p className="mt-3 rounded-2xl bg-accent p-4 text-center text-lg font-bold text-on-accent">{t.screen.mastered}</p>
          ) : null}
          <div className="mt-4">
            {result.state === "mastered" ? (
              <Link href="/learn" className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-6 font-bold text-bg">{t.screen.backToProcedures}</Link>
            ) : (
              <button type="button" onClick={() => { router.replace(`${pathname}?start=1`); router.refresh(); }} className="min-h-12 cursor-pointer rounded-2xl bg-brand px-6 font-bold text-bg">
                {t.screen.next}
              </button>
            )}
          </div>
        </section>
      ) : null}
    </article>
  );
}
