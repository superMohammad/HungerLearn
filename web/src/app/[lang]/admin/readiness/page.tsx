import { connection } from "next/server";
import { Suspense } from "react";
import { AskBox } from "@/components/ask-box";
import { ensureAdmin } from "@/components/guard";
import { Card, Meter, PageHeader, Pill, Skeleton, WarnIcon } from "@/components/ui";
import { readinessRows, summarize, type ReadinessFilter } from "@/lib/readiness";
import { listLearners } from "@/lib/repo";
import { branchName } from "@/lib/i18n";
import { getDict } from "@/lib/i18n-server";
import { ROLES, type Role } from "@/lib/types";

const field = "min-h-11 rounded-xl border border-line bg-bg px-3";

function parseFilter(params: Record<string, string | string[] | undefined>): ReadinessFilter {
  const one = (k: string): string | null => (typeof params[k] === "string" && params[k] !== "" ? (params[k] as string) : null);
  const role = one("role");
  return { role: role !== null && (ROLES as readonly string[]).includes(role) ? (role as Role) : null, branch: one("branch"), learnerId: one("learner") };
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/[lang]/admin/readiness">["searchParams"] }) {
  await connection();
  await ensureAdmin();
  const filter = parseFilter(await searchParams);
  const [rows, learners, t] = await Promise.all([readinessRows(filter), listLearners(), getDict()]);
  const r = t.admin.readiness;
  const { procedures, branches } = summarize(rows);
  const retrain = rows.filter((r) => r.state !== "mastered");
  const mastered = rows.filter((r) => r.state === "mastered").length;
  const branchNames = [...new Set(learners.map((l) => l.branch))].sort();

  return (
    <div className="grid gap-6">
      <form className="flex flex-wrap items-end gap-3" aria-label={r.filterAria}>
        <label className="text-sm font-medium">{r.role}<br />
          <select name="role" defaultValue={filter.role ?? ""} className={field}>
            <option value="">{t.common.all}</option>
            {ROLES.map((role) => <option key={role} value={role}>{t.labels.role[role]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{r.branch}<br />
          <select name="branch" defaultValue={filter.branch ?? ""} className={field}>
            <option value="">{t.common.all}</option>
            {branchNames.map((b) => <option key={b} value={b}>{branchName(t, b)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{r.learner}<br />
          <select name="learner" defaultValue={filter.learnerId ?? ""} className={field}>
            <option value="">{t.common.all}</option>
            {learners.map((l) => <option key={l.learnerId} value={l.learnerId}>{l.name}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-xl border border-brand px-5 font-bold text-brand hover:bg-surface-2">{r.apply}</button>
      </form>

      <section className="rounded-3xl bg-brand p-8 text-bg">
        <p className="text-sm opacity-80">{r.overall}</p>
        <p className="num mt-1 text-6xl font-medium">{rows.length === 0 ? 0 : Math.round((mastered / rows.length) * 100)}%</p>
        <p className="mt-1 opacity-80">{r.overallOf(mastered, rows.length)}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="">
          <h2 className="mb-4 text-lg font-bold">{r.perProcedure}</h2>
          <div className="grid gap-5">
            {procedures.map((p) => <Meter key={p.procedureKey} label={p.title} value={p.mastered} total={p.total} />)}
            {procedures.length === 0 ? <p className="text-ink-soft">{t.common.noData}</p> : null}
          </div>
        </Card>
        <Card className="">
          <h2 className="mb-4 text-lg font-bold">{r.perBranch}</h2>
          <div className="grid gap-5">
            {branches.map((b) => <Meter key={b.branch} label={branchName(t, b.branch)} value={b.mastered} total={b.total} />)}
          </div>
        </Card>
      </div>

      <Card className="">
        <h2 className="mb-1 text-lg font-bold">{r.needsTraining} <span className="num text-ink-soft">({retrain.length})</span></h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 text-start font-medium">{r.name}</th>
                <th className="py-2 text-start font-medium">{r.role}</th>
                <th className="py-2 text-start font-medium">{r.branch}</th>
                <th className="py-2 text-start font-medium">{r.procedure}</th>
                <th className="py-2 text-start font-medium">{r.state}</th>
              </tr>
            </thead>
            <tbody>
              {retrain.map((row) => (
                <tr key={`${row.learnerId}-${row.procedureKey}`} className="border-b border-line last:border-0">
                  <td className="py-2 pe-4 font-medium"><span dir="auto">{row.name}</span></td>
                  <td className="py-2 pe-4">{t.labels.role[row.role]}</td>
                  <td className="py-2 pe-4">{branchName(t, row.branch)}</td>
                  <td className="py-2 pe-4"><span dir="auto">{row.procedureTitle}</span></td>
                  <td className="py-2">
                    {row.confidentWrong > 0 ? <Pill tone="warn"><WarnIcon />{r.confidentWrong} <span className="num">×{row.confidentWrong}</span></Pill> : null}{" "}
                    <Pill tone={row.state === "needs_refresh" ? "warn" : "neutral"}>
                      {row.state === "needs_refresh" ? <WarnIcon /> : null}
                      {t.labels.mastery[row.state]}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default async function ReadinessPage({ searchParams }: PageProps<"/[lang]/admin/readiness">) {
  const r = (await getDict()).admin.readiness;
  return (
    <>
      <PageHeader eyebrow={r.eyebrow} title={r.title}>
        {r.intro}
      </PageHeader>
      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-bold">{r.askTitle}</h2>
        <AskBox />
      </Card>
      <Suspense fallback={<Skeleton label={r.loading} />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </>
  );
}
