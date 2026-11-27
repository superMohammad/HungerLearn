"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WhatChangedScreen } from "@/lib/compose";
import { reasonLabel } from "@/lib/reasons";
import { uploadNumber } from "@/lib/uploads";
import { useDict } from "@/components/i18n-provider";
import { NumText } from "@/components/num-text";

/**
 * The "What changed" lesson (B7): the old and new text of each changed, added or removed clause of the
 * procedure, straight from docproc's comparison. Quotes stay in the document's language (dir="auto").
 */
export function WhatChanged({ spec }: { spec: WhatChangedScreen }) {
  const pathname = usePathname();
  const t = useDict();
  const c = t.learn.changes;
  return (
    <article className="panel-enter grid gap-5" aria-labelledby="what-changed-title">
      <header className="rounded-3xl border border-brand bg-surface p-5 text-ink">
        <h2 id="what-changed-title" className="text-xl font-bold">{t.learn.whatChanged}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          <NumText text={c.range(t.common.upload(uploadNumber(spec.fromVersionId)), t.common.upload(uploadNumber(spec.toVersionId)))} />
        </p>
        <p className="mt-2">{c.intro}</p>
      </header>
      <ol className="grid gap-3">
        {spec.changes.map((change) => (
          <li key={change.stableId} className="rounded-3xl border border-line bg-surface p-5" data-change={change.change}>
            {change.change === "review" ? (
              <div className="grid gap-3">
                <Side label={change.after !== null && change.after !== change.before ? `${c.possibleChange} · ${c.before}` : c.possibleChange} quote={change.before} muted />
                {change.after !== null && change.after !== change.before ? <Side label={`${c.possibleChange} · ${c.after}`} quote={change.after} /> : null}
              </div>
            ) : change.change === "changed" ? (
              <div className="grid gap-3">
                <Side label={c.before} quote={change.before} muted />
                <Side label={c.after} quote={change.after} />
                {change.reasons.length > 0 ? (
                  <p className="text-sm text-ink-soft" dir="auto">{change.reasons.map((r) => reasonLabel(r, t.reasons)).join(t.reasons.join)}</p>
                ) : null}
              </div>
            ) : change.change === "added" ? (
              <Side label={c.added} quote={change.after} />
            ) : (
              <Side label={c.removed} quote={change.before} muted />
            )}
          </li>
        ))}
      </ol>
      <Link href={`${pathname}?lesson=1`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand px-6 text-lg font-bold text-bg">
        {c.continueToLesson}
      </Link>
    </article>
  );
}

function Side({ label, quote, muted = false }: { label: string; quote: string | null; muted?: boolean }) {
  return (
    <figure className={`rounded-2xl border p-4 ${muted ? "border-line bg-surface-2 text-ink-soft" : "border-brand"}`}>
      <figcaption className="text-xs font-semibold tracking-wide">{label}</figcaption>
      <blockquote className="source-quote mt-1" dir="auto">{quote}</blockquote>
    </figure>
  );
}
