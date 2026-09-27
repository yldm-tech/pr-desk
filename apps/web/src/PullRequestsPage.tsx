import React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GitPullRequest } from "lucide-react";
import { PRListSkeleton } from "./LoadingSkeleton";
import { PRRow, PRTableHeader } from "./PRRow";
import { useDetail } from "./detail-context";
import { useDocumentTitle } from "./page-title";
import type { PR } from "./pr-model";
import { useFollowUps, usePRList, useStats } from "./queries";
import { paths, prViewFromPath, prViewPath, type PRView } from "./routes";
import { useShortcut } from "./shortcuts";
import { Button, LinkButton, SearchField, SegmentedControl } from "./ui-controls";
import { EmptyState, ErrorState, FilterChip, PageHeader, StaleNotice, Toolbar } from "./ui-display";
import { ItemList } from "./ui-list";

const PAGE_SIZE = 50;

// The pill label of each view, which is also the view's name in the document title.
const viewLabelKeys: Record<PRView, string> = { open: "prs.viewOpen", "review-requested": "prs.viewReviewRequested", "changes-requested": "prs.viewChangesRequested", approved: "prs.viewApproved", blocked: "prs.viewBlocked", merged: "prs.viewMerged" };
const viewOrder: PRView[] = ["open", "review-requested", "changes-requested", "approved", "blocked", "merged"];
// Merged has no count: /stats counts this month's merges while the view lists every merge, so any number beside it would describe a different set. Changes requested and Approved have no count on /stats at all.
const countedViews: PRView[] = ["open", "review-requested", "blocked"];

const githubURL = (pr: PR) => pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;

// The pull-request list at /prs and /prs/:view. The view is the address, so the pressed pill, the request filter and the document title are all read from the same path.
export function PullRequestsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const view: PRView = prViewFromPath(pathname) ?? "open";
  const [params, setParams] = useSearchParams();
  const parsedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 100000 ? parsedPage - 1 : 0;
  const repository = (params.get("repo") || "").slice(0, 256);
  const search = (params.get("q") || "").slice(0, 120);
  useDocumentTitle(view === "open" ? [t("prs.title")] : [t(viewLabelKeys[view]), t("prs.title")]);

  const edit = (apply: (next: URLSearchParams) => void) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      apply(next);
      return next;
    });
  const setPage = (value: number) =>
    edit((next) => {
      if (value > 0) next.set("page", String(value + 1));
      else next.delete("page");
    });
  const updateSearch = (value: string) =>
    edit((next) => {
      next.delete("page");
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
    });
  const filterRepository = (repo: string) =>
    edit((next) => {
      if (repo) next.set("repo", repo);
      else next.delete("repo");
      next.delete("page");
    });
  const clearFilters = () =>
    edit((next) => {
      for (const key of ["q", "repo", "page"]) next.delete(key);
    });
  // A pill changes the view and keeps what the reader narrowed it to: the search and the repository survive, the page does not, because page 2 of one view is a meaningless offset into another.
  const showView = (next: PRView) => {
    const preserved = new URLSearchParams();
    if (search) preserved.set("q", search);
    if (repository) preserved.set("repo", repository);
    void navigate(prViewPath(next) + (preserved.size ? "?" + preserved : ""));
  };

  const detail = useDetail();
  const followUps = useFollowUps();
  // The table joins each row to its follow-up by the PullRequest id both carry (collectFollowUps attaches the same row the list returns), so the join costs no request.
  const followUpByPR = React.useMemo(() => new Map((followUps.data?.data ?? []).map((item) => [item.pr.id, item])), [followUps.data]);
  // One reading of "now" per render, so a list cannot straddle a midnight boundary halfway down.
  const now = Date.now();
  const stats = useStats();
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = usePRList({ view, page, q: search, repo: repository });
  const shown = React.useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // The keyboard cursor: the row j and k move to, Enter opens and o sends to GitHub. It never marks anything read; only opening the activity does. A new list (another view, search, repository or page) starts without one.
  const [cursor, setCursor] = React.useState<number | null>(null);
  const listKey = `${view}|${search}|${repository}|${page}`;
  React.useEffect(() => setCursor(null), [listKey]);
  const cursorRow = shown.find((pr) => pr.id === cursor) ?? null;
  const activityButton = (pr: PR) => document.querySelector<HTMLElement>(`#pr-row-${pr.id} [data-testid="pr-activity"]`);
  const openActivity = (pr: PR, opener: HTMLElement | null) => {
    setCursor(pr.id);
    detail.open({ pr, followUp: followUpByPR.get(pr.id) }, opener);
  };
  useShortcut(["j", "k"], (event) => {
    if (!shown.length) return false;
    const index = shown.findIndex((pr) => pr.id === cursor);
    const next = index < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, index + (event.key === "j" ? 1 : -1)));
    const id = shown[next].id;
    setCursor(id);
    const element = document.getElementById(`pr-row-${id}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  });
  // Enter belongs to whatever control has focus; it opens the row only when the row itself (or nothing in particular) is focused, so Enter on a link or a button inside the row still does that control's thing.
  useShortcut("Enter", () => {
    const active = document.activeElement;
    if (!cursorRow || (active && active !== document.body && active.id !== "main-content" && active.id !== `pr-row-${cursorRow.id}`)) return false;
    openActivity(cursorRow, activityButton(cursorRow));
  });
  useShortcut("o", () => {
    if (!cursorRow) return false;
    window.open(githubURL(cursorRow), "_blank", "noopener,noreferrer");
  });
  useShortcut("Escape", () => {
    if (cursor === null) return false;
    setCursor(null);
  });

  const summary = stats.data;
  const counts: Partial<Record<PRView, number>> = summary ? { open: summary.open, "review-requested": summary.needs_review, blocked: summary.attention } : {};
  const filtered = !!search || !!repository;

  let body: React.ReactNode;
  if (isLoading) body = <PRListSkeleton />;
  else if (isError && !data) body = <ErrorState title={t("unablePRs")} onRetry={() => void refetch()} />;
  else if (shown.length === 0)
    body = (
      <EmptyState
        icon={GitPullRequest}
        title={t("emptyResultsTitle")}
        description={t(filtered || page > 0 ? "emptyResultsDescription" : view === "open" ? "noOpenResults" : "prs.emptyView")}
        action={page > 0 ? <Button onClick={() => setPage(0)}>{t("firstPage")}</Button> : filtered ? <Button onClick={clearFilters}>{t("clearFilters")}</Button> : view !== "open" && <LinkButton to={paths.prs}>{t("prs.showOpen")}</LinkButton>}
      />
    );
  else
    body = (
      <>
        <p className="sr-only">{t("prs.keyboardHint")}</p>
        <ItemList mode="table" label={t("prs.title")} busy={isFetching} busyLabel={t("updatingResults")} className="border-t border-line @row/dashboard:border-t-0">
          <PRTableHeader labels={[t("pullRequest"), t("repository"), t("status"), t("updated"), t("activity")]} />
          {shown.map((pr) => (
            <PRRow key={pr.id} pr={pr} followUp={followUpByPR.get(pr.id)} now={now} active={pr.id === cursor} onFilterRepository={filterRepository} onOpen={(opener) => openActivity(pr, opener)} />
          ))}
        </ItemList>
        {total > PAGE_SIZE && (
          <nav aria-label={t("prs.pagination")} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            {/* Disabled only while a page is actually on its way: a paused fetch, offline or otherwise, would otherwise leave both controls dead with no way back. */}
            <Button size="sm" disabled={page === 0 || (isPlaceholderData && isFetching)} onClick={() => setPage(page - 1)}>
              {t("previous")}
            </Button>
            <span className="text-small text-fg-muted tabular-nums">{t("prs.pageSummary", { page: page + 1, count: total })}</span>
            <Button size="sm" disabled={(isPlaceholderData && isFetching) || isError || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
              {t("next")}
            </Button>
          </nav>
        )}
      </>
    );

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title={t("prs.title")}
        count={data ? total : undefined}
        summary={
          <div className="grid min-w-0 justify-items-start gap-1.5">
            <SegmentedControl label={t("prs.views")} value={view} onChange={showView} items={viewOrder.map((value) => ({ value, label: t(viewLabelKeys[value]), count: countedViews.includes(value) ? (counts[value] ?? "—") : undefined }))} />
            {stats.isError && (
              <p role="status" className="flex flex-wrap items-center gap-x-1 text-caption text-fg-muted">
                {t("summaryUnavailable")}
                <Button variant="ghost" size="sm" onClick={() => void stats.refetch()}>
                  {t("retry")}
                </Button>
              </p>
            )}
          </div>
        }
      />
      <Toolbar>
        <SearchField id="pr-search" className="w-full max-w-md min-w-0 flex-[1_1_16rem]" label={t("search")} value={search} onChange={updateSearch} mode="submit" placeholder={t("searchPlaceholder")} maxLength={120} kbdHint />
        {repository && <FilterChip testId="repository-chip" label={repository} clearLabel={t("clearRepositoryFilter", { repo: repository })} onClear={() => filterRepository("")} />}
      </Toolbar>
      {isError && data && <StaleNotice onRetry={() => void refetch()} />}
      <div className="min-w-0">{body}</div>
    </div>
  );
}
