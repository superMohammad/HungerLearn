import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ensureAdmin } from "@/components/guard";
import { Card, PageHeader, Pill, Skeleton, WarnIcon } from "@/components/ui";
import { getDict } from "@/lib/i18n-server";
import { SCOREBOARD_FILES, type Scoreboard } from "@/lib/scoreboard";
import { loadScoreboard } from "@/lib/scoreboard-files";

type Text = Awaited<ReturnType<typeof getDict>>["admin"]["scoreboard"];
type Result = Scoreboard[keyof Scoreboard];
/** What a card shows when its result file was read: the big number (null: not available), details and the source line. */
type Shown = { value: string | null; details: ReactNode; source: string };
type MetricView = { id: string; title: string; hint: string; result: Result; shown: Shown | null };

/** Left-to-right isolate, so a number or a Latin name keeps its order inside Arabic text ("91.0%", not "%91.0"). */
const ltr = (text: string): string => `⁦${text}⁩`;
const pct = (x: number): string => ltr(`${(x * 100).toFixed(1)}%`);
const usd = (x: number): string => ltr(`$${x.toFixed(4)}`);
const count = (x: number): string => ltr(Math.round(x).toLocaleString("en-US"));
const day = (iso: string): string => iso.slice(0, 10);

function duration(s: Text, seconds: number): string {
  const whole = Math.round(seconds);
  return s.duration(Math.floor(whole / 60), whole % 60);
}

/**
 * A detail line: a label in the page's language and its number in monospace, isolated left to right.
 * A value that mixes words and numbers (an Arabic duration such as «5 د 12 ث») keeps the page's direction
 * (`mixed`), and a missing value is plain "not available" text.
 */
function Line({ label, value, s, mixed = false }: { label: string; value: string | null; s: Text; mixed?: boolean }) {
  if (value === null) return <p>{label} <span className="text-ink-soft">{s.notAvailable}</span></p>;
  return <p>{label} {mixed ? <bdi className="num">{value}</bdi> : <bdi dir="ltr" className="num">{value}</bdi>}</p>;
}

function Warn({ children }: { children: ReactNode }) {
  return <p><Pill tone="warn"><WarnIcon />{children}</Pill></p>;
}

function MetricCard({ metric, s }: { metric: MetricView; s: Text }) {
  const { result, shown } = metric;
  return (
    <section data-metric={metric.id} data-state={result.status} className="flex">
      <Card className="flex w-full flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">{metric.title}</h2>
          <p className="text-sm text-ink-soft">{metric.hint}</p>
        </div>
        {result.status === "missing" ? (
          <div className="grid gap-2">
            <Pill tone="neutral">{s.notRun}</Pill>
            <p className="text-sm">{s.notRunHint(ltr(result.file))}</p>
            <code dir="ltr" className="num block rounded-xl bg-surface-2 px-3 py-2 text-sm">{result.command}</code>
          </div>
        ) : result.status === "invalid" ? (
          <div className="grid gap-2" role="alert">
            <Pill tone="warn"><WarnIcon />{s.invalid(ltr(result.file))}</Pill>
            <p dir="ltr" className="num break-words text-sm">{result.problem}</p>
          </div>
        ) : shown !== null ? (
          <>
            {shown.value === null
              ? <p className="text-xl text-ink-soft">{s.notAvailable}</p>
              : <p className="num text-5xl font-medium text-brand">{shown.value}</p>}
            <div className="grid gap-1 text-sm">{shown.details}</div>
            <p className="mt-auto text-xs text-ink-soft">{s.source} <bdi dir="ltr" className="num">{shown.source}</bdi></p>
          </>
        ) : null}
      </Card>
    </section>
  );
}

/** Failed documents or procedures in the generation run: the card's number covers only part of the dev set. */
function PartialRun({ gen, s }: { gen: Extract<Scoreboard["generation"], { status: "ok" }>; s: Text }) {
  if (gen.documentsFailed === 0 && gen.proceduresFailed === 0) return null;
  return (
    <>
      <Warn>{s.partialRun}</Warn>
      <Line s={s} label={s.failedDocuments} value={`${count(gen.documentsFailed)} / ${count(gen.documents)}`} />
      <Line s={s} label={s.failedProcedures} value={count(gen.proceduresFailed)} />
    </>
  );
}

function metrics(board: Scoreboard, s: Text): MetricView[] {
  const { extraction: ex, generation: gen, cost } = board;
  const genSource = gen.status === "ok" ? `${SCOREBOARD_FILES.generation.file} · ${day(gen.date)} · ${gen.model}` : "";
  const costSource = cost.status === "ok" ? `${SCOREBOARD_FILES.cost.file} · ${day(cost.date)} · ${cost.model}` : "";
  return [
    {
      id: "extraction", title: s.extraction.title, hint: s.extraction.hint, result: ex,
      shown: ex.status !== "ok" ? null : {
        value: pct(ex.recall),
        details: (
          <>
            <Line s={s} label={s.precision} value={pct(ex.precision)} />
            <Line s={s} label={s.scored} value={`${count(ex.scored)} / ${count(ex.scored + ex.skipped)}`} />
            {ex.skipped > 0 ? <Warn>{s.skipped} <bdi dir="ltr" className="num">{count(ex.skipped)}</bdi></Warn> : null}
          </>
        ),
        source: [SCOREBOARD_FILES.extraction.file, ex.date === null ? null : day(ex.date), ex.model].filter((p) => p !== null).join(" · "),
      },
    },
    {
      id: "citation", title: s.citation.title, hint: s.citation.hint, result: gen,
      shown: gen.status !== "ok" ? null : {
        value: gen.citationAccuracy === null ? null : pct(gen.citationAccuracy),
        details: (
          <>
            <Line s={s} label={s.documents} value={count(gen.documents)} />
            <Line s={s} label={s.items} value={count(gen.items)} />
            <Line s={s} label={s.exact} value={gen.citationAccuracyExact === null ? null : pct(gen.citationAccuracyExact)} />
            <PartialRun gen={gen} s={s} />
          </>
        ),
        source: genSource,
      },
    },
    {
      id: "silent", title: s.silent.title, hint: s.silent.hint, result: gen,
      shown: gen.status !== "ok" ? null : {
        value: count(gen.silentFailures),
        details: (
          <>
            <Line s={s} label={s.documents} value={count(gen.documents)} />
            <Line s={s} label={s.items} value={count(gen.items)} />
            {gen.publishableWithFailedCheck > 0
              ? <Warn>{s.publishable} <bdi dir="ltr" className="num">{count(gen.publishableWithFailedCheck)}</bdi></Warn>
              : <Line s={s} label={s.publishable} value={count(0)} />}
            <PartialRun gen={gen} s={s} />
          </>
        ),
        source: genSource,
      },
    },
    {
      id: "cost", title: s.cost.title, hint: s.cost.hint, result: cost,
      shown: cost.status !== "ok" ? null : {
        value: cost.meanUsd === null ? null : usd(cost.meanUsd),
        details: (
          <>
            {cost.meanHostedUsd !== null && cost.hostedModel !== null
              ? <p><Pill tone="neutral">{s.estimate}</Pill> {s.hosted(ltr(cost.hostedModel))} <bdi dir="ltr" className="num">{usd(cost.meanHostedUsd)}</bdi></p>
              : <p>{s.noHosted}</p>}
            {cost.meanInputTokens !== null && cost.meanOutputTokens !== null
              ? <Line s={s} label={s.tokens} value={`${count(cost.meanInputTokens)} · ${count(cost.meanOutputTokens)}`} />
              : null}
            <Line s={s} label={s.versions} value={count(cost.versions)} />
            {cost.coverage.docprocCallsNotLogged ? <p className="text-ink-soft">{s.docprocNotLogged}</p> : null}
            <div className="text-ink-soft"><Line s={s} label={s.coverage} value={[cost.coverage.zeroTokenCalls, cost.coverage.failedJobs, cost.coverage.runningJobs].map(count).join(" · ")} /></div>
          </>
        ),
        source: costSource,
      },
    },
    {
      id: "time", title: s.time.title, hint: s.time.hint, result: cost,
      shown: cost.status !== "ok" ? null : {
        value: cost.meanProcessingSeconds === null ? null : duration(s, cost.meanProcessingSeconds),
        details: (
          <>
            <Line s={s} mixed label={s.elapsed} value={cost.meanElapsedSeconds === null ? null : duration(s, cost.meanElapsedSeconds)} />
            <Line s={s} label={s.versions} value={count(cost.versions)} />
          </>
        ),
        source: costSource,
      },
    },
    {
      id: "saving", title: s.saving.title, hint: s.saving.hint, result: cost,
      shown: cost.status !== "ok" ? null : {
        value: cost.savingUsd === null ? null : usd(cost.savingUsd),
        details: (
          <>
            <p><Pill tone="neutral">{s.estimate}</Pill> {s.updates} <bdi dir="ltr" className="num">{count(cost.updates)}</bdi></p>
            {cost.savingUnknownVersions > 0 ? <Warn>{s.unknownSaving} <bdi dir="ltr" className="num">{count(cost.savingUnknownVersions)}</bdi></Warn> : null}
          </>
        ),
        source: costSource,
      },
    },
  ];
}

async function Board() {
  await connection();
  await ensureAdmin();
  const [board, t] = await Promise.all([loadScoreboard(), getDict()]);
  const s = t.admin.scoreboard;
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {metrics(board, s).map((m) => <MetricCard key={m.id} metric={m} s={s} />)}
    </div>
  );
}

export default async function ScoreboardPage() {
  const s = (await getDict()).admin.scoreboard;
  return (
    <>
      <PageHeader eyebrow={s.eyebrow} title={s.title}>{s.intro}</PageHeader>
      <Suspense fallback={<Skeleton label={s.loading} />}>
        <Board />
      </Suspense>
    </>
  );
}
