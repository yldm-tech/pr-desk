import React from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { AlertTriangle, GitMerge, GitPullRequest, Inbox, MessageSquare, RefreshCw, Search, X } from "lucide-react";
import i18n from "./i18n";
import { checkToneClass } from "./activity-model";
import { groupOf, reasonTone } from "./followup-view";
import { followUpReasonCompact } from "./followup-styles";
import { emptyState, linkAction, secondaryAction } from "./action-styles";
import {
  accentText,
  backgroundRefresh,
  commentButton,
  conflict,
  filters,
  listHeading,
  muted,
  pagination,
  prRepository,
  prStatus,
  prTitle,
  prTitleLink,
  prUpdated,
  rowActivity,
  searchChip,
  searchForm,
  spinning,
  stat,
  statIcon,
  stats,
  statusPill,
  tableChecks,
  tableHead,
  tableRow,
  tableSurface,
  toolbar,
} from "./app-styles";
import { syncStatusError } from "./status-styles";
import { PRListSkeleton } from "./LoadingSkeleton";
import { useDetail } from "./detail-context";
import { useFollowUps, usePRList, useStats } from "./queries";
import { prViewFromPath, prViewPath, type PRView } from "./routes";

function statusKey(status: string) {
  return (
    ({ Open: "openStatus", "Awaiting review": "awaitingReview", "Needs attention": "attention", "Review requested": "reviewRequested", "Changes requested": "changesRequested", Approved: "approved", Merged: "merged", Closed: "closed", Conflict: "conflict", Draft: "draftStatus" } as Record<string, string>)[status] ||
    status
  );
}
// app-styles' pillTones has no Draft entry and that file is not this package's to edit, so the muted pair "Open" and "Awaiting review" already carry is restated here rather than leaving the draft pill with no skin at all.
const draftPill = `${statusPill("Draft")} bg-[var(--surface-muted)] text-[var(--muted)]`;
// A stat tile that names a set the table can show is a link to it. `stat` is a flex row, so the anchor only has to stop inheriting link colour and underline. Every tile is a link now: listPRs used to hard-scope every query to open, unmerged rows and answer merged=true with a guaranteed-empty predicate, so "Merged this month" had nowhere honest to point — an explicit state= or merged= now replaces that default rather than being intersected with it.
const statLink = `${stat} text-[var(--foreground)] no-underline hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] pointer-coarse:min-h-11`;

// The pull-request list at /prs and /prs/:view, moved out of App.tsx unchanged. The view is the address, so the pressed pill, the request filter and the heading the shell prints are all read from the same path.
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
  const [draftSearch, setDraftSearch] = React.useState(search);
  React.useEffect(() => {
    setDraftSearch(search);
  }, [pathname, search]);
  const setPage = (value: number) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value > 0) next.set("page", String(value + 1));
      else next.delete("page");
      return next;
    });
  };
  const updateSearch = (value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("page");
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      return next;
    });
  };
  // A pill changes the view and keeps what the reader narrowed it to: the search and the repository survive, the page does not.
  const showView = (next: PRView) => {
    const preserved = new URLSearchParams();
    if (search) preserved.set("q", search);
    if (repository) preserved.set("repo", repository);
    void navigate(prViewPath(next) + (preserved.size ? "?" + preserved : ""));
  };
  const detail = useDetail();
  const followUps = useFollowUps();
  // The whole payload used to be spent on one badge number while the table beside it could not say whether a row was already handled, already snoozed, or sitting in "action". The ids match: collectFollowUps attaches the same PullRequest row the table lists, so the join costs no request.
  const followUpByPR = React.useMemo(() => new Map((followUps.data?.data ?? []).map((item) => [item.pr.id, item])), [followUps.data]);
  // One reading of "now" per render, so a list cannot straddle a midnight boundary halfway down.
  const now = Date.now();
  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: retrySummary } = useStats();
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = usePRList({ view, page, q: search, repo: repository });
  const shown = data?.items || [];
  const clearSearch = () => {
    updateSearch("");
    setDraftSearch("");
  };
  const activeFilterButton = React.useRef<HTMLButtonElement | null>(null);
  // The strip scrolls horizontally when it does not fit, and has no scroll affordance, so landing on /prs/approved from a bookmark would otherwise show a row of pills that are all unselected. "nearest" leaves a strip that already shows the selection alone.
  React.useEffect(() => {
    activeFilterButton.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [view]);
  return (
    <>
      {summaryError && (
        <div className={syncStatusError} role="status">
          <span>{t("summaryUnavailable")}</span>
          <button className={linkAction} onClick={() => retrySummary()}>
            {t("retry")}
          </button>
        </div>
      )}
      <section className={stats} aria-label={t("overview")}>
        {/* The Blocked tile replaces the Conflicts one because its number and its destination are the same set character for character: /api/v1/stats counts `has_conflicts OR review_status = 'changes_requested' OR checks_status IN ('failure','error')` and listPRs filters `attention=true` with that identical predicate. A conflicts-only tile would have needed its own route to stay honest. */}
        {(
          [
            [t("open"), summary ? String(summary.open) : "—", GitPullRequest, prViewPath("open")],
            [t("needsReview"), summary ? String(summary.needs_review) : "—", MessageSquare, prViewPath("review-requested")],
            [t("blocked"), summary ? String(summary.attention) : "—", AlertTriangle, prViewPath("blocked")],
            [t("mergedMonth"), summary ? String(summary.merged) : "—", GitMerge, prViewPath("merged")],
          ] as [string, string, typeof GitPullRequest, string][]
        ).map(([l, v, I, to]) => (
          <Link key={l} to={to} className={statLink}>
            <div className={statIcon}>
              <I size={18} />
            </div>
            <div className="min-w-0">
              <span>{l}</span>
              <strong>{summaryLoading ? <Skeleton width={48} height={26} /> : v}</strong>
            </div>
          </Link>
        ))}
      </section>
      <div className={listHeading}>
        <h2>
          {t("yourPRs")} <span>{isLoading ? "—" : (data?.total ?? 0)}</span>
          {isFetching && !isLoading && (
            <small className={backgroundRefresh} role="status">
              <RefreshCw size={13} className={spinning} />
              {t("updatingResults")}
            </small>
          )}
        </h2>
        {repository && (
          <button
            className={searchChip}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.delete("repo");
                next.delete("page");
                return next;
              })
            }
            aria-label={t("clearRepositoryFilter", { repo: repository })}
          >
            {repository}
            <X size={14} className="shrink-0" />
          </button>
        )}
        {search && (
          <button className={searchChip} onClick={clearSearch} aria-label={t("clearFilters")}>
            {search}
            <X size={14} className="shrink-0" />
          </button>
        )}
      </div>
      <div className={toolbar}>
        <form
          className={searchForm}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            updateSearch(draftSearch);
          }}
        >
          <label htmlFor="pr-search">{t("search")}</label>
          <div>
            <input id="pr-search" type="search" maxLength={120} title={t("searchShortcut")} aria-keyshortcuts="/" placeholder={t("searchPlaceholder")} value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} />
            <button aria-label={t("search")} type="submit">
              <Search size={19} />
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  clearSearch();
                }}
              >
                {t("clear")}
              </button>
            )}
          </div>
        </form>
        <div className={`${filters} max-w-full`}>
          {(
            [
              ["open", t("filterAll")],
              ["review-requested", t("filterReview")],
              ["changes-requested", t("filterChanges")],
              ["approved", t("filterApproved")],
              // The two states only the author can clear were the only ones with no pill, so finding them meant scanning fifty rows for a small red chip.
              ["blocked", t("blocked")],
              // "All pull requests" was open-and-unmerged, so nothing the reader had merged could be reached from the route named after all of them — while the same page advertised a merged count. The first pill is now honestly called Open and this is the other half of the pair.
              ["merged", t("filterMerged")],
            ] as [PRView, string][]
          ).map(([value, label]) => (
            <button key={value} ref={view === value ? activeFilterButton : null} onClick={() => showView(value)} className={view === value ? "selected" : ""} aria-pressed={view === value}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {isError && data && (
        <div className={syncStatusError} role="status">
          <span>{t("refreshFailedKeepData")}</span>
          <button className={linkAction} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      )}
      {isLoading && <PRListSkeleton />}
      {!isLoading && (!isError || data) && shown.length === 0 && (
        <div className={emptyState}>
          <Inbox size={28} />
          <h2>{t("emptyResultsTitle")}</h2>
          <p>{t(search || repository || page > 0 ? "emptyResultsDescription" : "noOpenResults")}</p>
          {page > 0 ? (
            <button className={secondaryAction} onClick={() => setPage(0)}>
              {t("firstPage")}
            </button>
          ) : search || repository ? (
            <button
              className={secondaryAction}
              onClick={() => {
                setDraftSearch("");
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  for (const key of ["q", "repo", "page"]) next.delete(key);
                  return next;
                });
              }}
            >
              {t("clearFilters")}
            </button>
          ) : (
            view !== "open" && (
              <button className={secondaryAction} onClick={() => navigate(prViewPath("open"))}>
                {t("navAll")}
              </button>
            )
          )}
        </div>
      )}
      {isError && !data && (
        <div className={emptyState} role="alert">
          <AlertTriangle size={28} />
          <h2>{t("unablePRs")}</h2>
          <button className={secondaryAction} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      )}
      {!isLoading && shown.length > 0 && (
        <>
          <div className={`${tableSurface} table w-full`} role="table" aria-label={t("yourPRs")}>
            <div className={tableHead} role="row">
              <span role="columnheader">{t("pullRequest")}</span>
              <span role="columnheader">{t("repository")}</span>
              <span role="columnheader">{t("status")}</span>
              <span role="columnheader">{t("updated")}</span>
              <span role="columnheader">{t("activity")}</span>
            </div>
            {/* DOM order is the card's reading order — title, activity, repository, status, updated — and the table order is restored by explicit column placement at `row`. Source order used to be the table's, which painted the comment button at the top right of a card while leaving it last in the tab order, two rows below the status pills a reader reaches first. */}
            {shown.map((p) => {
              const followUp = followUpByPR.get(p.id);
              // The chip takes the tone of the row's most urgent reason rather than of the state word, so a conflict reads red here exactly as it does in the workspace; blocked wins outright because the reasons array is not ordered by severity.
              const tones = followUp ? followUp.reasons.map(reasonTone) : [];
              const tone = tones.includes("blocked") ? "blocked" : (tones.find((item) => item !== "neutral") ?? "neutral");
              return (
                <div key={`${p.repo}-${p.number}`} className={tableRow} role="row">
                  <div className={prTitle} role="cell" data-cell="title">
                    <GitPullRequest size={17} className={accentText} />
                    <div>
                      <a className={prTitleLink} href={p.url || `https://github.com/${p.repo}/pull/${p.number}`} target="_blank" rel="noopener noreferrer">
                        {p.title}
                      </a>
                      <small>
                        <em>#{p.number}</em>
                      </small>
                    </div>
                  </div>
                  <div role="cell" data-cell="activity" className={rowActivity}>
                    <button data-testid="pr-activity" className={commentButton} title={t("viewActivity")} aria-label={followUp?.unread ? t("unreadActivity", { number: p.number }) : t("viewPRActivity", { number: p.number })} onClick={(event) => detail.open({ pr: p, followUp }, event.currentTarget)}>
                      <MessageSquare size={15} />
                      {p.comments}
                      {/* The count is a lifetime total and reads the same whether the last comment arrived in March or four minutes ago. A dot is a shape rather than a colour, and the accessible name changes with it, so the signal survives both greyscale and a screen reader. */}
                      {followUp?.unread && <span data-testid="unread-dot" aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
                    </button>
                  </div>
                  <div role="cell" data-cell="repository" className="col-start-1 row-start-2 min-w-0 @row/dashboard:col-start-2 @row/dashboard:row-start-1">
                    {/* Filters this list to the repository rather than leaving for github.com. "Show me just this repo" used to be a two-screen detour through Repositories even though the name was right there under the cursor, and the title link one cell over already covers going to GitHub. The existing chip in the list heading is the way back out. */}
                    <button
                      type="button"
                      className={prRepository}
                      title={p.repo}
                      aria-label={t("filterToRepository", { repo: p.repo })}
                      onClick={() =>
                        setParams((current) => {
                          const next = new URLSearchParams(current);
                          next.set("repo", p.repo);
                          next.delete("page");
                          return next;
                        })
                      }
                    >
                      {p.repo}
                    </button>
                  </div>
                  <div className={prStatus} role="cell" data-cell="status">
                    <span className={p.status === "Draft" ? draftPill : statusPill(p.status)}>{t(statusKey(p.status), { defaultValue: p.status })}</span>
                    {followUp && (
                      <span data-testid="row-follow-up" className={followUpReasonCompact} data-tone={tone}>
                        {t(`followup.${groupOf(followUp, now)}`)}
                      </span>
                    )}
                    {p.conflict && (
                      <span className={conflict}>
                        <AlertTriangle size={13} />
                        {t("conflict")}
                      </span>
                    )}
                    {/* Absence of CI is not a check result. A repository without a pipeline used to print a full-width grey "CI: Unknown" on every row, in the one cell that is supposed to carry the row's urgency. */}
                    {p.checks_status && p.checks_status !== "unknown" && (
                      <span className={`${tableChecks} ${checkToneClass(p.checks_status)}`}>
                        {t("ci")}: {t(p.checks_status, { defaultValue: p.checks_status })}
                      </span>
                    )}
                  </div>
                  <span className={`${muted} ${prUpdated}`} role="cell" data-cell="updated" title={p.updated_at ? new Date(p.updated_at).toLocaleString(i18n.resolvedLanguage) : undefined}>
                    {p.updated_at && !Number.isNaN(Date.parse(p.updated_at)) ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(p.updated_at)) : t("unknown")}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={pagination}>
            {/* Disabled only while a page is actually on its way: a paused fetch, offline or otherwise, would otherwise leave both controls dead with no way back. */}
            <button disabled={page === 0 || (isPlaceholderData && isFetching)} onClick={() => setPage(page - 1)}>
              {t("previous")}
            </button>
            <span>
              {t("page")} {page + 1} · {data?.total ?? 0} {t("results")}
            </span>
            <button disabled={(isPlaceholderData && isFetching) || isError || (page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
              {t("next")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
