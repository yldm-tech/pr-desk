import { apiURL } from "./api-url";
import { useSearchParams } from "react-router-dom";
import { OverviewSkeleton, AccessSkeleton } from "./LoadingSkeleton";
import { useMemo, useEffect, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";
import * as Select from "@radix-ui/react-select";
import { selectContent, selectOption } from "./select-styles";
import { emptyState, linkAction, secondaryAction } from "./action-styles";
import {
  achievementBottom,
  achievementEmpty,
  achievementFootnote,
  achievementOutcomes,
  achievementPanel,
  achievementScore,
  achievementTop,
  authorizedAccounts,
  distributionDetails,
  distributionLegend,
  distributionPanel,
  distributionSummary,
  legendDot,
  outcomesContent,
  outcomesLegend,
  outcomesRing,
  overviewPage,
  panelDescription,
  panelHeading,
  panelKicker,
  repositoryTooltip,
  ringLabel,
  scoreDot,
  scoreLabel,
  scoreNumber,
  scoreRate,
  scoreSecondary,
  scoreWatermark,
  trendEmpty,
  trendHeader,
  trendHeadingSlot,
  trendRepositoryLink,
  trendRepoTrigger,
  trendSkeleton,
  trendSummaryRow,
  trendTotal,
  visibilityFeedback,
  visibilityTabs,
  yearPanel,
  yearTab,
  yearTabs,
} from "./overview-styles";
import { syncStatusError } from "./status-styles";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Chart } from "@tanstack/charts/react";
import { Chart as TooltipChart } from "@tanstack/charts/react/tooltip";
import { barY, defineChart } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { GitMerge, GitPullRequest, FolderGit2, Info, ChevronDown, Check, AlertTriangle } from "lucide-react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import ky from "ky";
import { z } from "zod";
const schema = z.object({
  visibility_counts: z.object({ public_repositories: z.number().optional(), private_repositories: z.number().optional(), unknown_repositories: z.number().optional(), public: z.number(), private: z.number(), unknown: z.number() }),
  history_complete: z.boolean(),
  history_total: z.number(),
  year: z.number(),
  years: z.array(z.number()),
  summary: z.object({ total: z.number(), merged: z.number(), open: z.number(), closed: z.number(), repositories: z.number() }),
  repositories: z.array(z.object({ repo: z.string(), total: z.number(), merged: z.number() })),
  months: z.array(z.object({ month: z.string(), merged: z.number() })),
});
type Data = z.infer<typeof schema>;
// Keep visited scopes available while stale data refreshes in the background.
const overviewCache = { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 };
// The narrowest trend panel that still carries a label for every month; below it the axis is thinned. The default period is thirteen months and the labels carry a two-digit year, so a -35deg "Sep 25" occupies about 35px of axis-aligned box — which is what the chart's collision test measures — against a band that is only as wide as the panel divided by thirteen. A 1280px window gives this panel 447px, or about 439px once the platform draws a classic scrollbar, and that is still enough for all thirteen; a phone's 250-350px is not, and there the library drops the labels that collide. The number cannot be a container query: nothing in CSS can reach a chart option, so the panel has to be measured.
const trendAxisAllMonthsWidth = 420;
export default function Overview({ onAccessGranted }: { onAccessGranted: () => void }) {
  const previousAccess = useRef<string | undefined>(undefined);
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const currentYear = new Date().getUTCFullYear();
  const requestedYear = Number(params.get("year"));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2008 && requestedYear <= currentYear ? requestedYear : currentYear;
  const visibility = params.get("visibility") === "all" ? "all" : params.get("visibility") === "private" ? "private" : "public";
  const changeScope = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  const access = useQuery({
    queryKey: ["repository-access"],
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/repository-access", { credentials: "include", signal, retry: 0 })
        .json()
        .then((value) => z.object({ has_installations: z.boolean(), can_read_private: z.boolean().optional(), install_url: z.string().optional(), installations: z.array(z.object({ account: z.string(), repository_selection: z.string(), can_read_prs: z.boolean(), settings_url: z.string() })).optional() }).parse(value)),
    staleTime: 0,
  });
  useEffect(() => {
    if (!access.data) return;
    const current = JSON.stringify({ readable: access.data.can_read_private, installations: (access.data.installations ?? []).map(({ account, repository_selection, can_read_prs }) => ({ account, repository_selection, can_read_prs })).sort((a, b) => a.account.localeCompare(b.account)) });
    const changed = previousAccess.current !== undefined && previousAccess.current !== current;
    previousAccess.current = current;
    if (changed && access.data.can_read_private) onAccessGranted();
  }, [access.data, onAccessGranted]);
  const query = useQuery<Data>({
    queryKey: ["overview", year, visibility, "rolling-current-year"],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + `/api/v1/overview?year=${year}&visibility=${visibility}`, { credentials: "include", signal, retry: 0, timeout: 120000 })
        .json()
        .then((data) => schema.parse(data)),
    ...overviewCache,
  });
  if (query.isPending) return <OverviewSkeleton controls />;
  if (query.isError && !query.data)
    return (
      <div className={emptyState} role="alert">
        <AlertTriangle size={28} />
        <h2>{t("overviewError")}</h2>
        <button className={secondaryAction} onClick={() => query.refetch()}>
          {t("retry")}
        </button>
        {visibility !== "all" && (
          <button className={secondaryAction} onClick={() => changeScope("visibility", "all")}>
            {t("allContributions")}
          </button>
        )}
      </div>
    );
  const counts = query.data.visibility_counts;
  const repositoryCountsReady = counts.public_repositories !== undefined && counts.private_repositories !== undefined && counts.unknown_repositories !== undefined;
  return (
    <Tabs.Root value={String(year)} onValueChange={(value) => changeScope("year", value)}>
      {query.isError && query.data && (
        <div className={syncStatusError} role="status">
          <span>{t("refreshFailedKeepData")}</span>
          <button className={linkAction} onClick={() => query.refetch()}>
            {t("retry")}
          </button>
        </div>
      )}
      <Tabs.Root value={visibility} onValueChange={(value) => changeScope("visibility", value)}>
        <Tabs.List className={visibilityTabs} aria-label={t("visibilityScope")}>
          <Tabs.Trigger value="all">{t("allContributions")}</Tabs.Trigger>
          <Tabs.Trigger value="public">
            {t("publicOnly")} <span>{query.isPlaceholderData || (!query.data.history_complete && !counts.public_repositories) ? "—" : (counts.public_repositories?.toLocaleString(i18n.resolvedLanguage) ?? "—")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="private">
            {t("privateOnly")}{" "}
            <span>{access.data?.can_read_private === false || access.data?.has_installations === false ? t("notAuthorized") : query.isPlaceholderData || (!query.data.history_complete && !counts.private_repositories) ? "—" : (counts.private_repositories?.toLocaleString(i18n.resolvedLanguage) ?? "—")}</span>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
      <p className={visibilityFeedback} role="status" aria-live="polite">
        {visibility === "all" ? (
          t("showingAllContributions")
        ) : visibility === "public" ? (
          query.isPlaceholderData ? (
            t("loading")
          ) : (
            t("showingPublic", { public: counts.public_repositories ?? 0 })
          )
        ) : access.data?.can_read_private === false || access.data?.has_installations === false ? (
          <>
            {t(access.data?.has_installations ? "privatePermissionMissing" : "privateAccessMissing")}{" "}
            <a href={access.data?.install_url || "https://github.com/settings/installations"} target="_blank" rel="noopener noreferrer">
              {t("installGitHubApp")}
            </a>
            {" · "}
            <button className={linkAction} onClick={() => access.refetch()} disabled={access.isFetching}>
              {t("recheckAccess")}
            </button>
          </>
        ) : access.isPending ? (
          <span aria-label={t("checkingAccess")}>
            <Skeleton width={180} height={12} />
          </span>
        ) : access.isError ? (
          <>
            {t("accessCheckFailed")}{" "}
            <button className={linkAction} onClick={() => access.refetch()}>
              {t("retry")}
            </button>
          </>
        ) : query.isPlaceholderData ? (
          t("loading")
        ) : (
          <>
            {repositoryCountsReady ? t("showingPrivate", { public: counts.public_repositories, private: counts.private_repositories }) : t("privateOnly")}
            {visibility === "private" && query.data.visibility_counts.private === 0 && query.data.visibility_counts.unknown === 0 && <> {t("noSyncedPrivate")}</>}
          </>
        )}
      </p>
      {visibility === "private" && access.isPending && <AccessSkeleton />}
      {visibility === "private" && access.data?.installations && access.data.installations.length > 0 && (
        <div className={authorizedAccounts}>
          {access.data.installations.map((account) => (
            <a key={account.account} href={account.settings_url} target="_blank" rel="noopener noreferrer">
              {account.account} · {t(account.can_read_prs ? (account.repository_selection === "all" ? "allRepositoriesAuthorized" : "selectedRepositoriesAuthorized") : "privatePermissionMissing")}
            </a>
          ))}
        </div>
      )}
      <Tabs.List className={yearTabs} aria-label={t("yearSelect")}>
        {query.data.years.map((value) => (
          <Tabs.Trigger key={value} value={String(value)} className={yearTab}>
            {value}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={String(year)} className={yearPanel} aria-busy={query.isFetching}>
        {query.isPlaceholderData ? <OverviewSkeleton /> : <Achievements data={query.data} visibility={visibility} />}
      </Tabs.Content>
    </Tabs.Root>
  );
}
function Achievements({ data, visibility }: { data: Data; visibility: string }) {
  const { t, i18n } = useTranslation();
  const s = data.summary;
  const number = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const rate = s.total ? new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 1 }).format(s.merged / s.total) : "—";
  const percentage = (total: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 2 }).format(s.total ? total / s.total : 0);
  const [params, setParams] = useSearchParams();
  const selectedRepo = params.get("repo") || "all";
  const setSelectedRepo = (value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") next.delete("repo");
      else next.set("repo", value);
      return next;
    });
  const repo = data.repositories.some((item) => item.repo === selectedRepo) ? selectedRepo : "all";
  const trendQuery = useQuery({
    queryKey: ["overview", "trend", data.year, visibility, repo],
    enabled: repo !== "all",
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/overview?" + new URLSearchParams({ year: String(data.year), visibility, trend_repo: repo }), { credentials: "include", signal, retry: 0, timeout: 120000 })
        .json()
        .then((value) => schema.parse(value)),
    ...overviewCache,
  });
  const trendLoading = repo !== "all" && trendQuery.isPending;
  const trendError = repo !== "all" && trendQuery.isError && !trendQuery.data;
  const months = repo === "all" ? data.months : (trendQuery.data?.months ?? []);

  const periodTotal = months.reduce((sum, m) => sum + m.merged, 0);
  const trendPanel = useRef<HTMLElement>(null);
  // Starts optimistic so a browser without ResizeObserver, or the frame before the first observation, renders the full axis rather than a thinned one.
  const [trendAxisFitsEveryMonth, setTrendAxisFitsEveryMonth] = useState(true);
  useEffect(() => {
    const panel = trendPanel.current;
    if (!panel) return;
    const observer = new ResizeObserver((entries) => setTrendAxisFitsEveryMonth((entries[0]?.contentRect.width ?? 0) >= trendAxisAllMonthsWidth));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [s.total]);
  const monthChart = useMemo(
    () =>
      defineChart({
        marks: [barY(months, { x: "month", y: "merged", fill: "var(--accent)", radius: { end: 5 }, maxThickness: 28 })],
        scales: {
          x: {
            scale: () => scaleBand().padding(0.48),
            axis: {
              // `thin: false` pins every month; without it the library drops the labels whose boxes collide. The explicit tick values are gone either way: a band scale has no tick generator, so the chart already falls back to the whole domain and the list only restated it.
              tickLabels: trendAxisFitsEveryMonth ? { rotate: -35, thin: false } : { rotate: -35 },
              line: false,
              ticks: { size: 0, padding: 12, format: (value) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", year: months[0]?.month.slice(0, 4) !== months[months.length - 1]?.month.slice(0, 4) ? "2-digit" : undefined, timeZone: "UTC" }).format(new Date(value + "-01T00:00:00Z")) },
            },
          },
          y: { scale: scaleLinear, nice: true, grid: true, axis: { line: false, ticks: { size: 0, count: 4, padding: 10 } } },
        },
        tooltip: {
          use: tooltip,
          items: [
            { field: "month", label: t("month") },
            { field: "merged", label: t("mergedTotal") },
          ],
        },
      }),
    [months, t, i18n.resolvedLanguage, trendAxisFitsEveryMonth],
  );
  const distribution = useMemo(() => {
    const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
    return data.repositories.map((repo, index) => ({ label: repo.repo, href: `https://github.com/${repo.repo}`, value: repo.total, share: percentage(repo.total), color: colors[index] ?? `hsl(${(255 + index * 137.508) % 360} 50% 60%)` }));
  }, [data.repositories, s.total, t, i18n.resolvedLanguage]);
  const repoChart = useMemo(
    () =>
      defineChart({
        marks: [polar({ inset: 3, marks: [radialArc(pie(distribution, { value: "value", gapAngle: 0 }), { innerRadius: ({ radius }) => radius * 0.78, cornerRadius: 0, fill: (d) => d.color, key: "label" })], scales: { angle: null, radius: null } })],
        scales: { x: null, y: null },
        tooltip: {
          use: tooltip,
          items: [
            { field: "label", label: t("repository") },
            { field: "value", label: "PRs" },
            { field: "share", label: t("contributionShare") },
          ],
        },
      }),
    [distribution, t, i18n.resolvedLanguage],
  );
  const states = useMemo(
    () => [
      { label: t("merged"), value: s.merged, color: "var(--accent)", share: percentage(s.merged) },
      { label: t("openStatus"), value: s.open, color: "var(--warning)", share: percentage(s.open) },
      { label: t("closed"), value: s.closed, color: "var(--chart-other)", share: percentage(s.closed) },
    ],
    [s, t, i18n.resolvedLanguage],
  );
  const stateChart = useMemo(
    () =>
      defineChart({
        marks: [polar({ inset: 3, marks: [radialArc(pie(states, { value: "value", gapAngle: 0.035 }), { innerRadius: ({ radius }) => radius * 0.8, cornerRadius: 3, fill: (d) => d.color, key: "label" })], scales: { angle: null, radius: null } })],
        scales: { x: null, y: null },
        tooltip: {
          use: tooltip,
          items: [
            { field: "label", label: t("status") },
            { field: "value", label: "PRs" },
            { field: "share", label: t("contributionShare") },
          ],
        },
      }),
    [states, t, i18n.resolvedLanguage],
  );
  return (
    <section className={`${overviewPage} @container/overview`} aria-label={t("achievements")}>
      <div className={`${achievementTop} grid grid-cols-1 @row/overview:grid-cols-2`}>
        <article className={achievementScore}>
          <div className={scoreLabel}>
            <GitMerge size={18} />
            <span>{t("mergedTotal")}</span>
          </div>
          <div className={scoreNumber}>
            {number(s.merged)}
            <span>PRs</span>
          </div>
          <div className={scoreRate}>
            <span className={scoreDot} />
            {t("mergeRate")} <strong>{rate}</strong>
          </div>
          <GitMerge className={scoreWatermark} aria-hidden="true" />
          <div className={scoreSecondary}>
            <div>
              <GitPullRequest size={16} />
              <span>{t("contributionTotal")}</span>
              <strong>{number(s.total)}</strong>
            </div>
            <div>
              <FolderGit2 size={16} />
              <span>{t("contributedRepos")}</span>
              <strong>{number(s.repositories)}</strong>
            </div>
          </div>
        </article>
        <article className={achievementOutcomes}>
          <div className={panelHeading}>
            <h2>{t("contributionStates")}</h2>
            <span className={panelKicker}>{t("syncedSnapshot")}</span>
          </div>
          <div className={outcomesContent}>
            <div className={outcomesRing}>
              {s.total > 0 && <Chart definition={stateChart} height={166} ariaLabel={t("contributionStates")} />}
              <div className={ringLabel}>
                <strong>{rate}</strong>
                <span>{t("mergeRate")}</span>
              </div>
            </div>
            <ul className={outcomesLegend}>
              {states.map((state) => (
                <li key={state.label}>
                  <span className={legendDot} style={{ backgroundColor: state.color }} />
                  <span>{state.label}</span>
                  <strong>{number(state.value)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
      {s.total === 0 ? (
        <p className={achievementEmpty}>{t(data.history_complete ? "noAchievements" : "historySyncNeeded")}</p>
      ) : (
        <div className={`${achievementBottom} grid grid-cols-1 @row/overview:grid-cols-2`}>
          <article className={`${achievementPanel} @container/chart`} aria-busy={trendLoading} ref={trendPanel}>
            <div className={`${trendHeader} flex-col items-stretch gap-3.5 @pair/chart:flex-row @pair/chart:items-center`}>
              <div className={`${panelHeading} ${trendHeadingSlot}`}>
                <div>
                  <h2>{t("mergeActivity")}</h2>
                  <p>
                    {data.months[0]?.month} — {data.months[data.months.length - 1]?.month} · UTC
                  </p>
                </div>
              </div>
              <Select.Root value={repo} onValueChange={setSelectedRepo}>
                <Select.Trigger className={`${trendRepoTrigger} w-full max-w-full @pair/chart:w-80 @pair/chart:max-w-[48%]`} aria-label={t("trendRepository")}>
                  <FolderGit2 size={16} />
                  <Select.Value />
                  <Select.Icon>
                    <ChevronDown size={14} />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  {/* The viewport is the element that scrolls, so its cap has to be the smaller of the list height this menu wants and the room Radix measured below the trigger. A bare 280px draws the bottom of the list past the collision boundary on a landscape phone, and nothing can scroll it back into view, because the element overflowing is the scroll container itself. */}
                  <Select.Content className={`${selectContent} min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] [&_[data-radix-select-viewport]]:max-h-[min(280px,var(--radix-select-content-available-height))]`} position="popper" align="end" sideOffset={8} collisionPadding={12}>
                    <Select.Viewport>
                      <Select.Item className={`${selectOption} gap-6 text-[length:0.75rem] [overflow-wrap:anywhere]`} value="all">
                        <Select.ItemText>{t("allTrendRepositories")}</Select.ItemText>
                        <Select.ItemIndicator>
                          <Check size={15} />
                        </Select.ItemIndicator>
                      </Select.Item>
                      {data.repositories.map((item) => (
                        <Select.Item className={`${selectOption} gap-6 text-[length:0.75rem] [overflow-wrap:anywhere]`} value={item.repo} key={item.repo}>
                          <Select.ItemText>{item.repo}</Select.ItemText>
                          <Select.ItemIndicator>
                            <Check size={15} />
                          </Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>
            <div className={`${trendSummaryRow} flex-wrap gap-2`}>
              <div className={`trend-total ${trendTotal}`}>
                <strong>{trendLoading ? <Skeleton width={90} /> : number(periodTotal)}</strong>
                <span>{t("periodMerged")}</span>
              </div>
              {repo !== "all" && (
                <a className={trendRepositoryLink} href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer">
                  {repo}
                </a>
              )}
            </div>
            {trendLoading ? (
              <div className={trendSkeleton} role="status" aria-label={t("loading")}>
                <Skeleton height={260} />
              </div>
            ) : trendError ? (
              <div role="alert" className={trendEmpty}>
                <p>{t("overviewError")}</p>
                <button className={linkAction} onClick={() => trendQuery.refetch()}>
                  {t("retry")}
                </button>
              </div>
            ) : periodTotal === 0 ? (
              <div className={trendEmpty}>{t("noTrendMerges")}</div>
            ) : (
              <Chart definition={monthChart} height={280} ariaLabel={t("mergeActivity")} />
            )}
          </article>
          <article className={distributionPanel}>
            <div className={panelHeading}>
              <h2>{t("contributionDistribution")}</h2>
              <span className={panelKicker}>
                {number(s.repositories)} {t("repositories")}
              </span>
            </div>
            <p className={panelDescription}>{t("distributionDescription")}</p>
            <div className={distributionSummary}>
              <div className={outcomesRing}>
                <TooltipChart
                  definition={repoChart}
                  onSelect={(point) => {
                    // The chart fires this from its click handler, and a click is the only way a touch device can raise the tooltip that carries each slice's count and share. Opening github.com on that gesture — with a 48px radius around a 166px donut, so anywhere near it counts — would make reading the chart at all impossible without leaving the dashboard, so a coarse pointer gets the breakdown table instead, which carries the same numbers.
                    if (point?.datum.href && window.matchMedia("(hover: hover) and (pointer: fine)").matches) window.open(point.datum.href, "_blank", "noopener,noreferrer");
                    else if (point) document.getElementById("repository-breakdown")?.focus();
                  }}
                  renderTooltipBody={({ points }) => {
                    const item = points[0]?.datum;
                    return item ? (
                      <div className={repositoryTooltip}>
                        {item.href ? (
                          <a href={item.href} target="_blank" rel="noopener noreferrer">
                            {item.label}
                          </a>
                        ) : (
                          <span>{item.label}</span>
                        )}
                        <div>
                          PRs <strong>{number(item.value)}</strong>
                        </div>
                        <div>
                          {t("contributionShare")} <strong>{item.share}</strong>
                        </div>
                      </div>
                    ) : null;
                  }}
                  height={166}
                  ariaLabel={t("contributionDistribution")}
                />
                <div className={ringLabel}>
                  <strong>{number(s.total)}</strong>
                  <span>PRs</span>
                </div>
              </div>
              <ul className={distributionLegend} tabIndex={0} aria-label={t("contributionDistribution")}>
                {distribution.map((item) => (
                  <li key={item.label}>
                    <span className={legendDot} style={{ backgroundColor: item.color }} />
                    <a href={item.href} title={item.label} target="_blank" rel="noopener noreferrer">
                      {item.label}
                    </a>
                    <strong>{percentage(item.value)}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div id="repository-breakdown" className={distributionDetails} tabIndex={0} role="region" aria-label={t("repositoryBreakdown")}>
              <table>
                <thead>
                  <tr>
                    <th>{t("repository")}</th>
                    <th>PRs</th>
                    <th>{t("contributionShare")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.repositories.map((repo) => (
                    <tr key={repo.repo}>
                      <td>
                        <a href={`https://github.com/${repo.repo}`} target="_blank" rel="noopener noreferrer">
                          {repo.repo}
                        </a>
                      </td>
                      <td>{number(repo.total)}</td>
                      <td>{percentage(repo.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}
      <p className={achievementFootnote}>
        <Info size={14} />
        <span>
          {t(data.history_complete ? "historyScope" : "historySyncNeeded")} {t("yearBasis")}
        </span>
      </p>
    </section>
  );
}
