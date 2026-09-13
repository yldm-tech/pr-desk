import { Welcome } from "./Welcome";
import { Repositories } from "./Repositories";
import { About } from "./About";
import { FollowUpSummary, FollowUpWorkspace, useFollowUps } from "./FollowUps";
import { FollowUpSettings } from "./FollowUpSettings";
import { projectVersion } from "./project";
import { apiURL } from "./api-url";
import { isChunkLoadError } from "./chunk-error";
import { checkToneClass } from "./activity-model";
import { factsSurvive, groupOf, handledIsUseful, isMuted, reasonTone, type FollowUp } from "./followup-view";
import { followUpErrorMessage, useFollowUpAction } from "./followup-actions";
import { followUpReasonCompact } from "./followup-styles";
import { emptyState, linkAction, secondaryAction } from "./action-styles";
import {
  syncFeedback as syncFeedback_,
  accentText,
  accountBar,
  appShell,
  backgroundRefresh,
  brand,
  brandLogo,
  commentButton,
  conflict,
  filters,
  headerActions,
  headerDate,
  headerTitleSlot,
  listHeading,
  muted,
  nav,
  navButton,
  asideBorder,
  overviewAside,
  overviewCanvas,
  overviewHeading,
  overviewHeaderGap,
  pageHeaderGap,
  pageHeader,
  pageTitle,
  pagination,
  prRepository,
  prStatus,
  prTitle,
  prTitleLink,
  prUpdated,
  rowActivity,
  searchChip,
  searchForm,
  sidebar,
  sidebarAction,
  sidebarActionActive,
  sidebarBottom,
  skipLink,
  spinning,
  stat,
  statIcon,
  stats,
  statusPill,
  syncButton,
  syncFeedbackFloating,
  tableSurface,
  tableChecks,
  tableHead,
  tableRow,
  toolbar,
} from "./app-styles";
import { syncStatusError } from "./status-styles";
import { SyncProgress } from "./SyncProgress";
import { UserMenu } from "./UserMenu";
import Skeleton from "react-loading-skeleton";
import { OverviewSkeleton, PRListSkeleton, ActivitySkeleton, PageSkeleton, AccountSkeleton } from "./LoadingSkeleton";
import i18n from "./i18n";
import { LanguageMenu } from "./LanguageMenu";
import { HardRefresh } from "./HardRefresh";
import { useTranslation } from "react-i18next";
import { ActivityDialog } from "./ActivityDialog";
import { ActivityPanel } from "./ActivityPanel";
import { activitySchema } from "./activity-model";
import React from "react";
import { useQuery, useQueryClient, useMutation, keepPreviousData } from "@tanstack/react-query";

import { GitPullRequest, GitMerge, MessageSquare, AlertTriangle, RefreshCw, Building2, Search, LayoutDashboard, Inbox, FolderGit2, Info, X, ExternalLink, Settings2 } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { parsePRPage, listParameters, oauthBanner, parseRepositoryList, type PR, type RepositorySummary } from "./pr-model";
const Overview = React.lazy(() => import("./Overview"));
const api = ky.create({ credentials: "include", retry: 0, timeout: 30000 });
const filterPaths: Record<string, string> = {
  Overview: "/",
  About: "/about",
  Settings: "/settings",
  All: "/pull-requests",
  Repositories: "/repositories",
  "Needs attention": "/attention",
  "Review requested": "/review-requested",
  "Changes requested": "/changes-requested",
  Approved: "/approved",
  Blocked: "/blocked",
  Merged: "/merged",
};
// Every route the PR table serves, which is also the set the sidebar's Pull requests button returns to. Blocked belongs here or landing on it and clicking that button would send the reader somewhere else.
const prListPaths = [filterPaths.All, filterPaths["Review requested"], filterPaths["Changes requested"], filterPaths.Approved, filterPaths.Blocked, filterPaths.Merged];
// The heading names the scope the list actually has, which is the scope of the pill that is pressed. One heading for six routes meant "My pull requests" sat over an open-and-unmerged list, so searching for a pull request you had already landed returned an empty state whose only offer was to clear the filters — when the answer was that it is not open. These are the pill labels themselves, so the heading and the pressed control cannot drift apart; `navAll` stays as the name of the sidebar entry that leads here.
const listTitleKeys: Record<string, string> = { All: "open", "Review requested": "reviewRequested", "Changes requested": "changesRequested", Approved: "approved", Blocked: "blocked", Merged: "merged" };
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
function CrashFallback() {
  const { t } = useTranslation();
  return (
    <section className={emptyState} role="alert">
      <AlertTriangle size={28} />
      <h2>{t("appCrashed")}</h2>
      <button className={secondaryAction} onClick={() => location.reload()}>
        {t("reloadApp")}
      </button>
    </section>
  );
}
// React 19 unmounts the whole root on an uncaught render error, which leaves a blank page with no way back.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    // React does not log an error a boundary handled, and the stack is what makes a report actionable.
    console.error(error);
    // An upgraded server serves new chunk hashes, so an open tab asks for a file that is gone; one reload adopts the new build, and the flag keeps a permanently broken deploy from looping.
    if (isChunkLoadError(error) && !sessionStorage.getItem("prdesk-chunk-reload")) {
      sessionStorage.setItem("prdesk-chunk-reload", "1");
      location.reload();
    }
  }
  render() {
    return this.state.failed ? <CrashFallback /> : this.props.children;
  }
}
// A decision recorded from the table is the same decision recorded in the workspace: both post through useFollowUpAction, so there is one mutation, one optimistic prediction and one set of rules about which verbs can actually do something. Its own component because the hook cannot be called from a branch that exists only while the dialog is open, and because reading the thread is what marks the item read.
function DialogFollowUpActions({ item, now }: { item: FollowUp; now: number }) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = React.useState("");
  // Whether the last action left a step on the server to go back to. Local rather than read off `item.undoable`, because that flag only says the row holds some unconsumed snapshot — it survives a reload, names no action and belongs to whichever surface acted last, so rendering Undo from it would offer to restore a state this reader never saw.
  const [undoable, setUndoable] = React.useState(false);
  const action = useFollowUpAction({
    item,
    onDone: (input) => {
      if (input.action === "read") return;
      if (input.action === "undo") {
        setUndoable(false);
        setFeedback(t("followup.undone"));
        return;
      }
      // Mirrors the server's own snapshot guard at followup_store.go: every action except `read` and `undo` stores the step before it, and none of them bump Version, so the item the refetch returns still carries the version undo has to post.
      setUndoable(true);
      const verb = input.action === "handled" ? t("followup.handled") : input.action === "unsnooze" ? t("followup.cancelReminder") : t("followup.snooze");
      // Handled clears the confirmation but not a conflict or a red build, which presentation() re-derives from GitHub on every read. Saying so is what stops the reader tapping a button that already worked.
      setFeedback(t("followup.announceAction", { action: verb, title: item.pr.title }) + (input.action === "handled" && factsSurvive(item) ? " " + t("followup.stillListed") : ""));
    },
    onFailed: (error) => setFeedback(followUpErrorMessage(error, t)),
  });
  const marked = React.useRef<number | null>(null);
  React.useEffect(() => {
    // Reading every comment here is the demonstration that the item has been seen; without this the workspace went on insisting it was unread and the marker stopped meaning anything. Guarded by the id already posted for, because the invalidation this triggers re-renders with a fresh item object.
    if (!item.unread || marked.current === item.id) return;
    marked.current = item.id;
    action.mutate({ action: "read" });
  }, [action, item.id, item.unread]);
  // The row is finished: merged or closed. collectFollowUps keeps archived rows in the payload and the /merged route is built to show them, so the sheet used to offer "Handled · wait for others" and a three-day reminder on a pull request that landed last week — verbs the card withholds outright for the same row and which presentation() cannot act on, because it returns early for a closed PR. The mark-read effect above deliberately stays outside this gate: an archived row can still be unread, the table still paints its dot, and reading the thread is still what clears it.
  const finished = groupOf(item, now) === "archived";
  return (
    <>
      {feedback && (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <p className="m-0 text-[length:0.75rem] text-[var(--muted)]" role="status">
            {feedback}
          </p>
          {/* No timer on this one. The workspace strip clears itself because it sits above a list the reader goes on working through; this is a sheet that exists only until it is dismissed, so the confirmation and its inverse can wait for the reader rather than the other way round. */}
          {undoable && (
            <button className={linkAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "undo" })}>
              {t("followup.undo")}
            </button>
          )}
        </div>
      )}
      {!finished && handledIsUseful(item) && (
        <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "handled" })}>
          {t("followup.handled")}
        </button>
      )}
      {!finished &&
        (isMuted(item, now) ? (
          // The table one row over already shows this row's "Muted" chip, so the only thing the sheet had to offer was muting it again. Cancelling the reminder is the verb the card has here and the sheet did not.
          <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "unsnooze" })}>
            {t("followup.cancelReminder")}
          </button>
        ) : (
          <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "snooze", until: new Date(now + 3 * 86400000).toISOString() })}>
            {t("followup.snooze")} · {t("followup.days", { count: 3 })}
          </button>
        ))}
    </>
  );
}
export default function App() {
  const { t } = useTranslation();
  const [oauthError, setOauthError] = React.useState(() => oauthBanner(location.search).error);
  React.useEffect(() => {
    // HashRouter only ever rewrites the fragment, so the OAuth query flag would outlive every navigation and reload.
    const { cleanedSearch } = oauthBanner(location.search);
    if (cleanedSearch !== location.search) window.history.replaceState(window.history.state, "", location.pathname + cleanedSearch + location.hash);
  }, []);
  const queryClient = useQueryClient();
  const route = useLocation();
  const navigate = useNavigate();
  const matchedFilter = Object.keys(filterPaths).find((key) => filterPaths[key] === route.pathname);
  const filter = matchedFilter || "Overview";
  // A stale bookmark or a typo — /pull_requests, /follow-ups, a trailing slash — used to render the contribution overview under whatever address was typed, so the page and the URL disagreed and nothing said the route was wrong. Rewriting the address means a reload lands in the same place and the back button behaves, and `replace` keeps the bad entry out of history.
  React.useEffect(() => {
    if (!matchedFilter && route.pathname !== "/") void navigate("/", { replace: true });
  }, [matchedFilter, route.pathname, navigate]);
  const prListActive = !["Overview", "Needs attention", "Repositories", "About", "Settings"].includes(filter);
  const [params, setParams] = useSearchParams();
  const parsedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 100000 ? parsedPage - 1 : 0;
  const repository = (params.get("repo") || "").slice(0, 256);
  const search = (params.get("q") || "").slice(0, 120);
  const [draftSearch, setDraftSearch] = React.useState(search);
  const visitedRoutes = React.useRef(new Map<string, string>());
  const lastPRRoute = React.useRef(filterPaths.All);
  React.useEffect(() => {
    visitedRoutes.current.set(route.pathname, route.search);
    if (prListPaths.includes(route.pathname)) lastPRRoute.current = route.pathname;
    setDraftSearch(search);
  }, [route.pathname, route.search, search]);
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
  const setFilter = (f: string, preserveSearch = false) => {
    const path = f === "All" && !preserveSearch ? lastPRRoute.current : filterPaths[f] || "/";
    const preserved = new URLSearchParams();
    if (search) preserved.set("q", search);
    if (repository) preserved.set("repo", repository);
    const query = preserveSearch ? (preserved.size ? "?" + preserved : "") : visitedRoutes.current.get(path) || "";
    void navigate(path + query);
  };
  React.useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input,textarea,select,[contenteditable=true],[role=dialog],dialog,[role=combobox]") || document.querySelector("dialog[open],[data-state=open][role=dialog]")) return;
      const input = document.getElementById("pr-search");
      if (input) {
        event.preventDefault();
        input.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const [selected, setSelected] = React.useState<PR | null>(null);
  const [syncFeedback, setSyncFeedback] = React.useState<{ message: string; error: boolean } | null>(null);
  const syncMutation = useMutation({
    onMutate: () => setSyncFeedback(null),
    mutationFn: async (full: boolean | void = false) => {
      const r = await api(apiURL + "/api/v1/sync" + (full ? "?full=1" : ""), { method: "POST", credentials: "include", timeout: 30000 });
      return z.object({ status: z.literal("queued") }).parse(await r.json());
    },
    onSuccess: () => setSyncFeedback(null),
    onSettled: () => {
      // Read durable progress immediately after submission or a lost response.
      for (const key of ["prs", "sync-progress", "stats", "overview", "repositories", "repository-access"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: async (error) => {
      let key = "syncNetworkError";
      if (error instanceof HTTPError) {
        const status = error.response.status;
        const body = z.object({ error: z.string().optional() }).safeParse(error.data);
        const errorBody = body.success ? body.data : undefined;
        const message = errorBody?.error || "";
        key = status === 409 ? "syncAlreadyRunning" : status === 401 ? "syncReconnect" : status === 429 || (status === 403 && /rate/i.test(message)) ? "syncRateLimited" : status === 403 ? "syncForbidden" : message.includes("list data has been saved") ? "syncPartial" : "syncUpstreamError";
      }
      setSyncFeedback({ message: t(key), error: true });
    },
  });
  const logoutMutation = useMutation({
    mutationFn: () => api(apiURL + "/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      setSelected(null);
      queryClient.clear();
      location.reload();
    },
  });
  const [remoteSyncing, setRemoteSyncing] = React.useState(false);
  const syncing = syncMutation.isPending || remoteSyncing;
  React.useEffect(() => {
    if (remoteSyncing) setSyncFeedback(null);
  }, [remoteSyncing]);
  const commentsQuery = useQuery({
    queryKey: ["activity", selected?.id],
    staleTime: 60000,
    gcTime: 30 * 60 * 1000,
    enabled: !!selected,
    queryFn: async () => {
      const r = await api(apiURL + `/api/v1/pull-requests/${selected!.id}/activity`, { credentials: "include" });
      return activitySchema.parse(await r.json());
    },
  });
  const {
    data: auth,
    isPending: authLoading,
    isError: authError,
    refetch: retryAuth,
  } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => api(apiURL + "/api/v1/auth/status", { credentials: "include" }).then(async (r) => z.object({ connected: z.boolean(), username: z.string().optional(), sync_paused: z.boolean().optional(), last_synced_at: z.string().nullable().optional() }).parse(await r.json())),
    staleTime: 30000,
  });
  const followUps = useFollowUps(!!auth?.connected);
  // The whole payload used to be spent on one badge number while the table beside it could not say whether a row was already handled, already snoozed, or sitting in "action". The ids match: collectFollowUps attaches the same PullRequest row the table lists, so the join costs no request.
  const followUpByPR = React.useMemo(() => new Map((followUps.data?.data ?? []).map((item) => [item.pr.id, item])), [followUps.data]);
  // One reading of "now" per render, so a list cannot straddle a midnight boundary halfway down.
  const now = Date.now();
  const attentionCount = followUps.data ? (followUps.data.counts.authored || 0) + (followUps.data.counts.reviewer || 0) + (followUps.data.counts.follow_up || 0) : undefined;
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: retrySummary,
  } = useQuery({
    queryKey: ["stats"],
    enabled: !!auth?.connected,
    queryFn: async () => {
      const r = await api(apiURL + "/api/v1/stats", { credentials: "include" });
      return z.object({ open: z.number(), needs_review: z.number(), conflicts: z.number(), merged: z.number(), attention: z.number() }).parse(await r.json());
    },
    staleTime: 30000,
  });
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = useQuery({
    queryKey: ["prs", filter, page, search, repository],
    retry: 1,
    enabled: !!auth?.connected && !["Overview", "Repositories", "About", "Settings", "Needs attention"].includes(filter),
    gcTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const r = await api(apiURL + "/api/v1/pull-requests?" + listParameters(filter, page, search, repository), { credentials: "include", signal });
      return parsePRPage(await r.json());
    },
    staleTime: 30000,
    refetchInterval: 60000,
    // Paging and filtering mint a new key: keep the rows and the pagination row on screen instead of replacing them with a skeleton under the cursor.
    placeholderData: keepPreviousData,
  });
  const shown = data?.items || [];
  const {
    data: repositoryData,
    isLoading: repositoriesLoading,
    isError: repositoriesError,
    refetch: refetchRepositories,
  } = useQuery<RepositorySummary[]>({
    queryKey: ["repositories"],
    enabled: !!auth?.connected && filter === "Repositories",
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const r = await api(apiURL + "/api/v1/repositories", { credentials: "include" });
      return parseRepositoryList(await r.json());
    },
    staleTime: 30000,
  });
  const clearSearch = () => {
    updateSearch("");
    setDraftSearch("");
  };
  const searchControl = (
    <form
      className={searchForm}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        updateSearch(draftSearch);
      }}
    >
      <label htmlFor="pr-search">{t(filter === "Repositories" ? "searchRepositories" : "search")}</label>
      <div>
        <input id="pr-search" type="search" maxLength={120} title={t("searchShortcut")} aria-keyshortcuts="/" placeholder={t(filter === "Repositories" ? "repositorySearchPlaceholder" : "searchPlaceholder")} value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} />
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
  );
  React.useEffect(() => {
    if (!syncFeedback || syncFeedback.error) return;
    const timer = window.setTimeout(() => setSyncFeedback(null), 6000);
    return () => window.clearTimeout(timer);
  }, [syncFeedback]);
  const activeNavButton = React.useRef<HTMLButtonElement | null>(null);
  const activeFilterButton = React.useRef<HTMLButtonElement | null>(null);
  // Both strips scroll horizontally when they do not fit, and neither has a scroll affordance, so landing on /approved from a bookmark would otherwise show a row of pills that are all unselected. "nearest" leaves a strip that already shows the selection alone.
  React.useEffect(() => {
    activeNavButton.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
    activeFilterButton.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [filter]);
  // The activity sheet is component state with no history entry of its own, so a platform back gesture — which on touch is the habitual "dismiss this" — changed the route underneath and left a full-screen sheet mounted over a different page.
  React.useEffect(() => setSelected(null), [filter]);
  return (
    <div className={`${appShell} ${filter === "Overview" ? overviewCanvas : ""}`}>
      <a
        className={skipLink}
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("skipContent")}
      </a>
      <aside className={`${sidebar} ${filter === "Overview" ? overviewAside : asideBorder}`}>
        {/* Below `roomy` only the mark is shown: the wordmark had 36px to render in and truncated to "PR…", which reads as a bug rather than as a brand. The aria-label is what keeps the link named once the text is gone, and the product name is not translated anywhere else either. */}
        <a href="#/" aria-label="PR Desk" className={`${brand} max-roomy:gap-1.5 max-roomy:text-[length:1.0625rem] max-roomy:[&>span]:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11`}>
          <img className={brandLogo} src="/favicon.svg" alt="" />
          <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
            <span className="truncate">PR Desk</span>
            <span className="text-[length:0.6875rem] font-normal tracking-normal text-[var(--muted)]">{projectVersion}</span>
          </span>
        </a>
        <nav aria-label={t("mainNavigation")} className={nav}>
          <button ref={filter === "Overview" ? activeNavButton : null} className={navButton(filter === "Overview")} aria-current={filter === "Overview" ? "page" : undefined} onClick={() => setFilter("Overview")}>
            <LayoutDashboard size={17} aria-hidden="true" />
            <span>{t("navOverview")}</span>
          </button>
          <button ref={filter === "Needs attention" ? activeNavButton : null} className={navButton(filter === "Needs attention")} aria-current={filter === "Needs attention" ? "page" : undefined} onClick={() => setFilter("Needs attention")}>
            <Inbox size={17} aria-hidden="true" />
            <span>{t("navAttention")}</span>
            {(authLoading || auth?.connected) && (
              <b style={{ visibility: authLoading || followUps.isPending ? "hidden" : undefined }} aria-hidden={authLoading || followUps.isPending || undefined}>
                {/* The count is unbounded and the badge sits beside a label that already has no room to spare, so four digits are spelled as three. */}
                {attentionCount === undefined ? "—" : attentionCount > 99 ? "99+" : attentionCount}
              </b>
            )}
          </button>
          <button ref={prListActive ? activeNavButton : null} className={navButton(prListActive)} aria-current={prListActive ? "page" : undefined} onClick={() => setFilter("All")}>
            <GitPullRequest size={17} aria-hidden="true" />
            <span>{t("navAll")}</span>
          </button>
          <button ref={filter === "Repositories" ? activeNavButton : null} className={navButton(filter === "Repositories")} aria-current={filter === "Repositories" ? "page" : undefined} onClick={() => setFilter("Repositories")}>
            <FolderGit2 size={17} aria-hidden="true" />
            <span>{t("navRepositories")}</span>
          </button>
          <button ref={filter === "About" ? activeNavButton : null} className={navButton(filter === "About")} aria-current={filter === "About" ? "page" : undefined} onClick={() => setFilter("About")}>
            <Info size={17} aria-hidden="true" />
            <span>{t("navAbout")}</span>
          </button>
        </nav>
        <div className={sidebarBottom}>
          {auth?.connected && (
            <button className={filter === "Settings" ? sidebarActionActive : sidebarAction} aria-current={filter === "Settings" ? "page" : undefined} title={t("followup.settings")} aria-label={t("followup.settings")} onClick={() => setFilter("Settings")}>
              <Settings2 size={16} aria-hidden="true" />
              <span>{t("followup.settings")}</span>
            </button>
          )}
          {auth?.connected && (
            <a
              className={sidebarAction}
              title={t("organizationAccess")}
              aria-label={t("organizationAccess")}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const width = Math.min(760, window.screen.availWidth);
                const height = Math.min(820, window.screen.availHeight);
                const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
                const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
                const popup = window.open("about:blank", "_blank", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
                if (!popup) return;
                event.preventDefault();
                popup.opener = null;
                popup.location.href = event.currentTarget.href;
                popup.focus();
              }}
              href={apiURL + "/api/v1/repository-access/install"}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Building2 size={16} aria-hidden="true" />
              <span>{t("organizationAccess")}</span>
            </a>
          )}
          {auth?.connected && (
            <button className={syncButton} disabled={!auth?.connected || syncing} aria-busy={syncing} onClick={() => syncMutation.mutate()}>
              <RefreshCw size={16} className={syncing ? spinning : ""} />
              <span>{syncing ? t("syncing") : t("sync")}</span>
            </button>
          )}
        </div>
      </aside>
      <main
        id="main-content"
        tabIndex={-1}
        className={`min-w-0 focus:outline-none @container/dashboard flex-1 mx-auto max-w-[1600px] py-5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] shell:py-6 shell:pl-[max(clamp(16px,2.5vw,40px),env(safe-area-inset-left))] shell:pr-[max(clamp(16px,2.5vw,40px),env(safe-area-inset-right))] short:py-3`}
      >
        <header className={`${pageHeader} ${filter === "Overview" ? overviewHeaderGap : pageHeaderGap}`}>
          <div className={headerTitleSlot}>
            <h1 className={filter === "Overview" ? `${pageTitle} ${overviewHeading}` : pageTitle}>
              {filter === "About" ? (
                t("navAbout")
              ) : authLoading ? (
                <Skeleton width={120} height={23} />
              ) : !auth?.connected ? (
                t("welcomeHeading")
              ) : filter === "Settings" ? (
                t("followup.settings")
              ) : filter === "Overview" ? (
                // The first words on the landing route named the report at the bottom of it rather than the job. "Contribution overview" is still the heading of the dashboard section further down, where it describes what it sits above.
                t("navOverview")
              ) : filter === "Repositories" ? (
                t("navRepositories")
              ) : filter === "Needs attention" ? (
                t("navAttention")
              ) : (
                t(listTitleKeys[filter] ?? "navAll")
              )}
            </h1>

            {oauthError && (
              <p className="flex items-center gap-2 text-[var(--danger)]" role="alert">
                {t("oauthCancelled")}
                <button className="grid cursor-pointer place-items-center border-0 bg-transparent p-0 text-[length:1.125rem] leading-none text-inherit pointer-coarse:-m-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:p-2" aria-label={t("dismissMessage")} onClick={() => setOauthError(null)}>
                  ×
                </button>
              </p>
            )}
          </div>
          <div className={accountBar}>
            <time className={headerDate}>{new Intl.DateTimeFormat(i18n.language, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</time>
            <div className={headerActions}>
              {/* Renders only in an installed window, where there is no browser reload to reach for. */}
              <HardRefresh />
              <LanguageMenu />
              {authLoading ? <AccountSkeleton /> : auth?.connected || filter === "About" ? <UserMenu connected={!!auth?.connected} username={auth?.username} onDisconnect={() => logoutMutation.mutate()} disconnecting={logoutMutation.isPending} disconnectError={logoutMutation.isError} /> : null}
            </div>
          </div>
        </header>
        <SyncProgress connected={!!auth?.connected} pending={syncMutation.isPending} onRunningChange={setRemoteSyncing} hidden={filter === "About" || filter === "Settings"} />
        {auth?.sync_paused && filter !== "About" && (
          <p className={syncStatusError} role="status">
            {t("followup.paused")} <a href={apiURL + "/api/v1/auth/github"}>{t("followup.reconnect")}</a>
          </p>
        )}
        {filter !== "About" && syncFeedback && !remoteSyncing && (
          <div className={syncFeedback.error ? syncFeedback_ : `${syncFeedback_} ${syncFeedbackFloating}`} role={syncFeedback.error ? "alert" : "status"}>
            <span>{syncFeedback.message}</span>
            <button aria-label={t("dismissMessage")} onClick={() => setSyncFeedback(null)}>
              ×
            </button>
          </div>
        )}
        {filter === "About" ? (
          <About />
        ) : authLoading ? (
          <PageSkeleton page={filter} />
        ) : authError && !auth ? (
          <section className={emptyState} role="alert">
            <AlertTriangle size={28} />
            <h2>{t("apiUnavailable")}</h2>
            <button className={secondaryAction} onClick={() => retryAuth()}>
              {t("retry")}
            </button>
          </section>
        ) : !auth?.connected ? (
          <Welcome />
        ) : filter === "Settings" ? (
          <FollowUpSettings />
        ) : filter === "Needs attention" ? (
          <FollowUpWorkspace />
        ) : filter === "Repositories" ? (
          <Repositories repositories={repositoryData} loading={repositoriesLoading} error={repositoriesError} retry={() => void refetchRepositories()} />
        ) : filter === "Overview" ? (
          <>
            {/* A suspended child replaces every child with the fallback, so the one panel that answers "what do I do now" used to wait on a 146KB chart chunk it shares no data with — its query is already running for the sidebar badge. Outside the boundary it paints from the warm cache on the first frame, and the chart skeleton below it now reserves exactly the space the chart will take. */}
            <FollowUpSummary />
            <ErrorBoundary>
              <React.Suspense fallback={<OverviewSkeleton controls />}>
                <Overview onAccessGranted={() => syncMutation.mutate(true)} />
              </React.Suspense>
            </ErrorBoundary>
          </>
        ) : (
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
                  [t("open"), summary ? String(summary.open) : "—", GitPullRequest, filterPaths.All],
                  [t("needsReview"), summary ? String(summary.needs_review) : "—", MessageSquare, filterPaths["Review requested"]],
                  [t("blocked"), summary ? String(summary.attention) : "—", AlertTriangle, filterPaths.Blocked],
                  [t("mergedMonth"), summary ? String(summary.merged) : "—", GitMerge, filterPaths.Merged],
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
            {filter !== "Repositories" && (
              <>
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
                  {searchControl}
                  {/* "Needs attention" returns FollowUpWorkspace further up, so this branch only ever renders the PR list. */}
                  {
                    <div className={`${filters} max-w-full`}>
                      {[
                        ["All", t("filterAll")],
                        ["Review requested", t("filterReview")],
                        ["Changes requested", t("filterChanges")],
                        ["Approved", t("filterApproved")],
                        // The two states only the author can clear were the only ones with no pill, so finding them meant scanning fifty rows for a small red chip.
                        ["Blocked", t("blocked")],
                        // "All pull requests" was open-and-unmerged, so nothing the reader had merged could be reached from the route named after all of them — while the same page advertised a merged count. The first pill is now honestly called Open and this is the other half of the pair.
                        ["Merged", t("filterMerged")],
                      ].map(([value, label]) => (
                        <button key={value} ref={filter === value ? activeFilterButton : null} onClick={() => setFilter(value, true)} className={filter === value ? "selected" : ""} aria-pressed={filter === value}>
                          {label}
                        </button>
                      ))}
                    </div>
                  }
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
                      filter !== "All" && (
                        <button className={secondaryAction} onClick={() => navigate(filterPaths.All)}>
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
                              <button data-testid="pr-activity" className={commentButton} title={t("viewActivity")} aria-label={followUp?.unread ? t("unreadActivity", { number: p.number }) : t("viewPRActivity", { number: p.number })} onClick={() => setSelected(p)}>
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
            )}
          </>
        )}
      </main>
      {selected && (
        <ActivityDialog title={`${t("comments")} · ${selected.repo} #${selected.number}`} onClose={() => setSelected(null)}>
          {commentsQuery.isLoading && <ActivitySkeleton />}
          {commentsQuery.isError && (
            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-[length:0.8125rem] text-[var(--warning)] [&_ul]:pl-5" role="alert">
              {t("unableComments")}
            </div>
          )}
          {commentsQuery.data && <ActivityPanel data={commentsQuery.data} />}
          {/* Viewport tokens, not container ones: <dialog> is a sibling of <main> and lives in the top layer, so it has no ancestor container and a container query here would match nothing and fall through to base. */}
          {/* The sheet is 100dvh on a phone, so with viewport-fit=cover this row lands on the home indicator unless it carries the inset itself. */}
          <div className="sticky bottom-0 z-[2] mt-auto flex flex-wrap justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-roomy:flex-col max-roomy:items-stretch">
            <a className={secondaryAction} href={selected.url || `https://github.com/${selected.repo}/pull/${selected.number}`} target="_blank" rel="noopener noreferrer">
              {t("viewGitHub")}
              <ExternalLink size={14} />
            </a>
            <button className={secondaryAction} disabled={commentsQuery.isFetching} onClick={() => commentsQuery.refetch()}>
              <RefreshCw size={15} className={commentsQuery.isFetching ? spinning : ""} />
              {commentsQuery.isFetching ? t("refreshing") : t("refresh")}
            </button>
            {/* Only when the row has a follow-up to act on. A PR whose detail sync has not run has no FollowUp row at all, and a disabled button with nothing to explain it is worse than no button. */}
            {followUpByPR.get(selected.id) && <DialogFollowUpActions item={followUpByPR.get(selected.id)!} now={now} />}
          </div>
        </ActivityDialog>
      )}
    </div>
  );
}
