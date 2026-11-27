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

/** Left-to-right isolate, so a number keeps its order inside an Arabic sentence ("91.0%", not "%91.0"). */
const ltr = (text: string): string => `⁦${text}⁩`;
const pct = (x: number): string => ltr(`${(x * 100).toFixed(1)}%`);
const usd = (x: number): string => ltr(`$${x.toFixed(4)}`);
const count = (x: number): string => ltr(Math.round(x).toLocaleString("en-US"));
const day = (iso: string): string => iso.slice(0, 10);

function duration(s: Text, seconds: number): string {
  const whole = Math.round(seconds);
  return s.duration(Math.floor(whole / 60), whole % 60);
}

function MetricCard({ metric, s }: { metric: MetricView; s: Text }) {
  const { result, shown } = metric;
  return (
    <Card className="flex flex-col gap-3">
      <div data-metric={metric.id}>
        <h2 className="text-lg font-bold">{metric.title}</h2>
        <p className="text-sm text-ink-soft">{metric.hint}</p>
      </div>
      {result.status === "missing" ? (
        <div className="grid gap-2">
          <Pill tone="neutral">{s.notRun}</Pill>
          <p className="text-sm">{s.notRunHint(result.file)}</p>
          <code dir="ltr" className="num block rounded-xl bg-surface-2 px-3 py-2 text-sm">{result.command}</code>
        </div>
      ) : result.status === "invalid" ? (
        <div className="grid gap-2" role="alert">
          <Pill tone="warn"><WarnIcon />{s.invalid(result.file)}</Pill>
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
  );
}

function metrics(board: Scoreboard, s: Text): MetricView[] {
  const na = s.notAvailable;
  const { extraction: ex, generation: gen, cost } = board;
  const genSource = gen.status === "ok" ? `${SCOREBOARD_FILES.generation.file} · ${day(gen.date)} · ${gen.model}` : "";
  const costSource = cost.status === "ok" ? `${SCOREBOARD_FILES.cost.file} · ${day(cost.date)} · ${cost.model}` : "";
  return [
    {
      id: "extraction", title: s.extraction.title, hint: s.extraction.hint, result: ex,
      shown: ex.status !== "ok" ? null : {
        value: pct(ex.recall),
        details: <p>{s.precision(pct(ex.precision))}</p>,
        source: `${SCOREBOARD_FILES.extraction.file} · ${ex.model}`,
      },
    },
    {
      id: "citation", title: s.citation.title, hint: s.citation.hint, result: gen,
      shown: gen.status !== "ok" ? null : {
        value: gen.citationAccuracy === null ? null : pct(gen.citationAccuracy),
        details: <><p>{s.items(gen.items)}</p><p>{s.exact(gen.citationAccuracyExact === null ? na : pct(gen.citationAccuracyExact))}</p></>,
        source: genSource,
      },
    },
    {
      id: "silent", title: s.silent.title, hint: s.silent.hint, result: gen,
      shown: gen.status !== "ok" ? null : {
        value: String(gen.silentFailures),
        details: (
          <>
            <p>{s.items(gen.items)}</p>
            <p>{gen.publishableWithFailedCheck > 0 ? <Pill tone="warn"><WarnIcon />{s.publishable(gen.publishableWithFailedCheck)}</Pill> : s.publishable(0)}</p>
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
            <p>{cost.meanHostedUsd !== null && cost.hostedModel !== null
              ? <><Pill tone="neutral">{s.estimate}</Pill> {s.hosted(usd(cost.meanHostedUsd), cost.hostedModel)}</>
              : s.noHosted}</p>
            {cost.meanInputTokens !== null && cost.meanOutputTokens !== null
              ? <p className="num">{s.tokens(count(cost.meanInputTokens), count(cost.meanOutputTokens))}</p>
              : null}
            <p>{s.versions(cost.versions)}</p>
            {cost.coverage.docprocCallsNotLogged ? <p className="text-ink-soft">{s.docprocNotLogged}</p> : null}
            <p className="num text-ink-soft">{s.coverage(cost.coverage.zeroTokenCalls, cost.coverage.failedJobs, cost.coverage.runningJobs)}</p>
          </>
        ),
        source: costSource,
      },
    },
    {
      id: "time", title: s.time.title, hint: s.time.hint, result: cost,
      shown: cost.status !== "ok" ? null : {
        value: cost.meanProcessingSeconds === null ? null : duration(s, cost.meanProcessingSeconds),
        details: <><p>{s.elapsed(cost.meanElapsedSeconds === null ? na : duration(s, cost.meanElapsedSeconds))}</p><p>{s.versions(cost.versions)}</p></>,
        source: costSource,
      },
    },
    {
      id: "saving", title: s.saving.title, hint: s.saving.hint, result: cost,
      shown: cost.status !== "ok" ? null : {
        value: cost.savingUsd === null ? null : usd(cost.savingUsd),
        details: (
          <>
            <p><Pill tone="neutral">{s.estimate}</Pill> {s.updates(cost.updates)}</p>
            {cost.savingUnknownVersions > 0 ? <p><Pill tone="warn"><WarnIcon />{s.unknownSaving(cost.savingUnknownVersions)}</Pill></p> : null}
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
