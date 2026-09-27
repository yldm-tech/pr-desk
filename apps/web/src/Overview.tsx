import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { CircleAlert, GitMerge, Info, RefreshCw } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { GitHubAccessPanel } from "./GitHubAccessPanel";
import { installHref, openInstallPopup, privateAccessMissing, useRepositoryAccess } from "./github-access";
import { OverviewSkeleton } from "./LoadingSkeleton";
import { OutcomeBar } from "./OutcomeBar";
import { useDocumentTitle } from "./page-title";
import { RepoBreakdown } from "./RepoBreakdown";
import { paths } from "./routes";
import { fillMonths, TrendChart } from "./TrendChart";
import { Button, LinkButton, SegmentedControl, Select, Tabs, TextLink } from "./ui-controls";
import { EmptyState, Notice, PageHeader, StaleNotice, Stat } from "./ui-display";

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
type Visibility = "all" | "public" | "private";

// Keep visited scopes available while stale data refreshes in the background.
const overviewCache = { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 };

function scopeOf(params: URLSearchParams): { year: number; visibility: Visibility } {
  const currentYear = new Date().getUTCFullYear();
  const requested = Number(params.get("year"));
  const year = Number.isInteger(requested) && requested >= 2008 && requested <= currentYear ? requested : currentYear;
  const value = params.get("visibility");
  return { year, visibility: value === "all" || value === "private" ? value : "public" };
}

// The retrospective: what the reader contributed in a year, in one visibility scope. The year and the scope are parameters of the address, so a reload or a shared link reopens the same report; the page is its own lazy chunk because it carries the chart library.
export default function Overview() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { year, visibility } = scopeOf(params);
  useDocumentTitle([t("insights.title")]);
  const changeScope = (key: "year" | "visibility", value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  const access = useRepositoryAccess();
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
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const data = query.data;
  const counts = data?.visibility_counts;
  // A count is only a count once the history behind it is complete; until then, and while the previous scope stands in for the next one, the honest answer is a dash.
  const repositoryCount = (value: number | undefined) => (!data || query.isPlaceholderData || (!data.history_complete && !value) || value === undefined ? "—" : number.format(value));
  const missing = privateAccessMissing(access.data);
  const visibilityItems = [
    { value: "all" as const, label: t("insights.visibilityAll") },
    { value: "public" as const, label: t("insights.visibilityPublic"), count: repositoryCount(counts?.public_repositories) },
    { value: "private" as const, label: t("insights.visibilityPrivate"), count: missing ? t("notAuthorized") : repositoryCount(counts?.private_repositories) },
  ];
  // The year in the address always has a tab, even one the server lists no contributions for, so the panel under it is never left without a tab that names it.
  const years = useMemo(() => [...new Set([...(data?.years ?? []), year])].sort((a, b) => b - a), [data?.years, year]);
  return (
    <div className="@container/overview grid min-w-0 gap-4">
      <PageHeader
        title={t("insights.title")}
        actions={<SegmentedControl label={t("visibilityScope")} value={visibility} onChange={(value) => changeScope("visibility", value)} items={visibilityItems} />}
        summary={<VisibilityFeedback visibility={visibility} data={data} placeholder={query.isPlaceholderData} access={access} />}
      />
      {visibility === "private" && <GitHubAccessPanel variant="compact" />}
      {query.isPending ? (
        <OverviewSkeleton />
      ) : query.isError && !data ? (
        <div role="alert">
          <EmptyState
            icon={CircleAlert}
            tone="blocked"
            title={t("overviewError")}
            action={
              <>
                <Button icon={RefreshCw} onClick={() => query.refetch()}>
                  {t("retry")}
                </Button>
                {visibility !== "all" && (
                  <Button variant="ghost" onClick={() => changeScope("visibility", "all")}>
                    {t("allContributions")}
                  </Button>
                )}
              </>
            }
          />
        </div>
      ) : (
        data && (
          <>
            {query.isError && <StaleNotice onRetry={() => query.refetch()} />}
            <Tabs value={String(year)} onValueChange={(value) => changeScope("year", value)} label={t("yearSelect")} items={years.map((value) => ({ value: String(value), label: String(value) }))}>
              {(value) => (value !== String(year) ? null : query.isPlaceholderData ? <OverviewSkeleton /> : <Report data={data} visibility={visibility} />)}
            </Tabs>
          </>
        )
      )}
    </div>
  );
}

// The line under the header that says which repositories the numbers cover, and what to do when the private scope cannot be read. It is a polite live region, so switching the scope is announced; the actions sit beside it rather than inside, so the announcement is the sentence and not the button labels.
function VisibilityFeedback({ visibility, data, placeholder, access }: { visibility: Visibility; data: Data | undefined; placeholder: boolean; access: ReturnType<typeof useRepositoryAccess> }) {
  const { t } = useTranslation();
  const counts = data?.visibility_counts;
  const missing = privateAccessMissing(access.data);
  const loading = !data || placeholder;
  let message: ReactNode;
  let actions: ReactNode = null;
  if (visibility === "all") message = t("showingAllContributions");
  else if (visibility === "public") message = loading ? t("loading") : t("insights.showingPublic", { count: counts?.public_repositories ?? 0 });
  else if (missing) {
    message = t(access.data?.has_installations ? "privatePermissionMissing" : "privateAccessMissing");
    const href = installHref(access.data);
    actions = (
      <>
        <LinkButton size="sm" variant="primary" href={href} external newTabLabel={t("insights.newTab")} onClick={(event) => openInstallPopup(event, href)}>
          {t("insights.installApp")}
        </LinkButton>
        <Button size="sm" icon={RefreshCw} busy={access.isFetching} onClick={() => access.refetch()}>
          {t("recheckAccess")}
        </Button>
        <TextLink to={`${paths.settings}?tab=github`} className="text-small pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
          {t("insights.manageInSettings")}
        </TextLink>
      </>
    );
  } else if (access.isPending)
    message = (
      <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
        <span role="img" aria-label={t("checkingAccess")}>
          <Skeleton width={180} height={12} inline />
        </span>
      </SkeletonTheme>
    );
  else if (access.isError) {
    message = t("accessCheckFailed");
    actions = (
      <Button size="sm" onClick={() => access.refetch()}>
        {t("retry")}
      </Button>
    );
  } else if (loading) message = t("loading");
  else {
    const complete = counts?.public_repositories !== undefined && counts.private_repositories !== undefined && counts.unknown_repositories !== undefined;
    message = (
      <>
        {complete ? t("insights.showingPrivate", { count: counts.private_repositories ?? 0 }) : t("privateOnly")}
        {counts?.private === 0 && counts.unknown === 0 && <> {t("noSyncedPrivate")}</>}
      </>
    );
  }
  const attention = visibility === "private" && (missing || access.isError);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <p role="status" aria-live="polite" className={attention ? "min-w-0 max-w-[65ch] text-body text-fg" : "min-w-0 text-body text-fg-muted"}>
        {message}
      </p>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// One year of the retrospective: the totals, how the contributions ended, merges per month and the share of each repository.
function Report({ data, visibility }: { data: Data; visibility: Visibility }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const s = data.summary;
  const number = new Intl.NumberFormat(language);
  const rate = s.total ? new Intl.NumberFormat(language, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(s.merged / s.total) : "—";
  const [params, setParams] = useSearchParams();
  const requestedRepo = params.get("repo") || "all";
  // A repository from a shared link that contributed nothing this year falls back to all of them, rather than to an empty chart for a name the picker cannot show.
  const repo = data.repositories.some((item) => item.repo === requestedRepo) ? requestedRepo : "all";
  const setRepo = (value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") next.delete("repo");
      else next.set("repo", value);
      return next;
    });
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
  const trendMonths = repo === "all" ? data.months : trendQuery.data?.months;
  const months = useMemo(() => fillMonths(trendMonths ?? [], data.year), [trendMonths, data.year]);
  const repositoryOptions = [{ value: "all", label: t("allTrendRepositories") }, ...data.repositories.map((item) => ({ value: item.repo, label: item.repo }))];
  return (
    <section aria-labelledby="contribution-overview-heading" className="grid min-w-0 gap-4">
      <h2 id="contribution-overview-heading" className="text-title font-semibold text-fg">
        {t("achievements")}
      </h2>
      {!data.history_complete && (
        <Notice tone="info" title={t("insights.partialTitle")}>
          {t("historySyncNeeded")}
        </Notice>
      )}
      {s.total === 0 ? (
        <EmptyState icon={GitMerge} title={t(data.history_complete ? "noAchievements" : "historySyncNeeded")} className="max-w-none rounded-lg border border-dashed border-line" />
      ) : (
        <>
          <div className="grid min-w-0 overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-2 gap-px bg-line @row/overview:grid-cols-4">
              <Stat value={number.format(s.merged)} label={t("mergedTotal")} className="bg-bg p-4" />
              <Stat value={rate} label={t("mergeRate")} className="bg-bg p-4" />
              <Stat value={number.format(s.total)} label={t("contributionTotal")} className="bg-bg p-4" />
              <Stat value={number.format(s.repositories)} label={t("contributedRepos")} className="bg-bg p-4" />
            </div>
            <section aria-labelledby="outcomes-heading" className="grid gap-3 border-t border-line p-4">
              <h3 id="outcomes-heading" className="text-body font-semibold text-fg">
                {t("insights.outcomes")}
              </h3>
              <OutcomeBar merged={s.merged} open={s.open} closed={s.closed} />
            </section>
          </div>
          <div className="grid min-w-0 gap-4 @table/overview:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 rounded-lg border border-line p-4">
              <TrendChart
                months={months}
                loading={trendLoading}
                error={trendError}
                onRetry={() => trendQuery.refetch()}
                controls={
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Select label={t("trendRepository")} hideLabel value={repo} onChange={(event) => setRepo(event.target.value)} options={repositoryOptions} className="w-full min-w-0 @pair/chart:w-auto @pair/chart:max-w-64 [&>select]:w-full [&>select]:truncate" />
                    {repo !== "all" && (
                      <TextLink href={`https://github.com/${repo}`} external newTabLabel={t("insights.newTab")} tone="muted" className="max-w-full truncate text-small pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                        {repo}
                      </TextLink>
                    )}
                  </div>
                }
              />
            </div>
            <div className="min-w-0 rounded-lg border border-line p-4">
              <RepoBreakdown repositories={data.repositories} total={s.total} />
            </div>
          </div>
        </>
      )}
      <p className="flex items-start gap-1.5 text-caption text-fg-subtle">
        <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
        <span>
          {data.history_complete && <>{t("historyScope")} </>}
          {t("yearBasis")}
        </span>
      </p>
    </section>
  );
}
