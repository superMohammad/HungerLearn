"use client";

import { useActionState } from "react";
import { askAction, type AskState } from "@/app/actions";
import { useDict } from "@/components/i18n-provider";

const INITIAL: AskState = { kind: "idle" };

/** "Ask in plain language" (Arabic or English): LLM → read-only SQL over readiness_v → names. */
export function AskBox() {
  const t = useDict();
  const a = t.admin.ask;
  const [state, action, pending] = useActionState(askAction, INITIAL);
  return (
    <div>
      <form action={action} className="flex flex-wrap gap-2">
        <label htmlFor="question" className="sr-only">{a.label}</label>
        <input
          id="question"
          name="question"
          required
          minLength={3}
          dir="auto"
          defaultValue={a.examples[0]}
          className="min-h-12 flex-1 rounded-2xl border border-line bg-bg px-4 text-lg"
        />
        <button type="submit" disabled={pending} aria-busy={pending} className="min-h-12 cursor-pointer rounded-2xl bg-accent px-6 font-bold text-on-accent hover:bg-accent-strong disabled:opacity-60">
          {pending ? a.searching : a.ask}
        </button>
      </form>
      <p className="mt-2 text-xs text-ink-soft">{a.hint(a.examples[1])}</p>
      <div aria-live="polite" className="mt-4">
        {state.kind === "error" ? (
          <p className="rounded-2xl bg-ember-bg p-4 text-sm text-ember" dir="auto">{state.message}</p>
        ) : null}
        {state.kind === "ok" ? (
          <div className="grid gap-3">
            <p className="font-medium" dir="auto">{state.result.intro}</p>
            {state.result.rows.length === 0 ? (
              <p className="text-ink-soft">{t.common.noResults}</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2">
                    <tr>{state.result.columns.map((c) => <th key={c} className="px-3 py-2 text-start font-medium">{a.column[c] ?? c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {state.result.rows.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {r.map((v, j) => <td key={j} className="px-3 py-2"><span dir="auto">{v}</span></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-xs text-ink-soft">{a.sql}</summary>
              <code className="mt-2 block overflow-x-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs" dir="ltr">{state.result.sql}</code>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
