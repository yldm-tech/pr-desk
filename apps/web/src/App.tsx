import { Welcome } from "./Welcome";
import { Repositories } from "./Repositories";
import { About } from "./About";
import { FollowUpSummary, FollowUpWorkspace, useFollowUps } from "./FollowUps";
import { FollowUpSettings } from "./FollowUpSettings";
import { projectVersion } from "./project";
import { apiURL } from "./api-url";
import { isChunkLoadError } from "./chunk-error";
import { checkToneClass } from "./activity-model";
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
import { useTranslation } from "react-i18next";
import { ActivityDialog } from "./ActivityDialog";
import { ActivityPanel } from "./ActivityPanel";
import { activitySchema } from "./activity-model";
import React from "react";
import { useQuery, useQueryClient, useMutation, keepPreviousData } from "@tanstack/react-query";

import { GitPullRequest, GitMerge, MessageSquare, AlertTriangle, RefreshCw, Building2, Search, LayoutDashboard, Inbox, FolderGit2, Info, X, ExternalLink, Settings2 } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { parsePRPage, listParameters, oauthBanner, parseRepositoryList, type PR, type RepositorySummary } from "./pr-model";
const Overview = React.lazy(() => import("./Overview"));
const api = ky.create({ credentials: "include", retry: 0, timeout: 30000 });
const filterPaths: Record<string, string> = { Overview: "/", About: "/about", Settings: "/settings", All: "/pull-requests", Repositories: "/repositories", "Needs attention": "/attention", "Review requested": "/review-requested", "Changes requested": "/changes-requested", Approved: "/approved" };
function statusKey(status: string) {
  return ({ Open: "openStatus", "Awaiting review": "awaitingReview", "Needs attention": "attention", "Review requested": "reviewRequested", "Changes requested": "changesRequested", Approved: "approved", Merged: "merged", Closed: "closed", Conflict: "conflict" } as Record<string, string>)[status] || status;
}
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
  const filter = Object.keys(filterPaths).find((key) => filterPaths[key] === route.pathname) || "Overview";
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
    if (["/pull-requests", "/review-requested", "/changes-requested", "/approved"].includes(route.pathname)) lastPRRoute.current = route.pathname;
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
      <main id="main-content" tabIndex={-1} className={`min-w-0 focus:outline-none @container/dashboard flex-1 mx-auto max-w-[1600px] px-4 py-5 shell:px-[clamp(16px,2.5vw,40px)] shell:py-6 short:py-3`}>
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
                t("achievements")
              ) : filter === "Repositories" ? (
                t("navRepositories")
              ) : filter === "Needs attention" ? (
                t("navAttention")
              ) : (
                t("navAll")
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
          <ErrorBoundary>
            <React.Suspense fallback={<OverviewSkeleton controls />}>
              <FollowUpSummary />
              <Overview onAccessGranted={() => syncMutation.mutate(true)} />
            </React.Suspense>
          </ErrorBoundary>
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
              {[
                [t("open"), summary ? String(summary.open) : "—", GitPullRequest, "purple"],
                [t("needsReview"), summary ? String(summary.needs_review) : "—", MessageSquare, "blue"],
                [t("conflicts"), summary ? String(summary.conflicts) : "—", AlertTriangle, "red"],
                [t("mergedMonth"), summary ? String(summary.merged) : "—", GitMerge, "green"],
              ].map(([l, v, I]: any) => (
                <div key={l} className={stat}>
                  <div className={statIcon}>
                    <I size={18} />
                  </div>
                  <div className="min-w-0">
                    <span>{l}</span>
                    <strong>{summaryLoading ? <Skeleton width={48} height={26} /> : v}</strong>
                  </div>
                </div>
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
                      {shown.map((p) => (
                        <div key={`${p.repo}-${p.number}`} className={tableRow} role="row">
                          <div className={prTitle} role="cell">
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
                          <div role="cell" className={rowActivity}>
                            <button data-testid="pr-activity" className={commentButton} title={t("viewActivity")} aria-label={t("viewPRActivity", { number: p.number })} onClick={() => setSelected(p)}>
                              <MessageSquare size={15} />
                              {p.comments}
                            </button>
                          </div>
                          <div role="cell" className="col-start-1 row-start-2 min-w-0 @row/dashboard:col-start-2 @row/dashboard:row-start-1">
                            <a className={prRepository} title={p.repo} href={`https://github.com/${p.repo}`} target="_blank" rel="noopener noreferrer">
                              {p.repo}
                            </a>
                          </div>
                          <div className={prStatus} role="cell">
                            <span className={statusPill(p.status)}>{t(statusKey(p.status), { defaultValue: p.status })}</span>
                            {p.conflict && (
                              <span className={conflict}>
                                <AlertTriangle size={13} />
                                {t("conflict")}
                              </span>
                            )}
                            {p.checks_status && (
                              <span className={`${tableChecks} ${checkToneClass(p.checks_status ?? "")}`}>
                                {t("ci")}: {t(p.checks_status, { defaultValue: p.checks_status })}
                              </span>
                            )}
                          </div>
                          <span className={`${muted} ${prUpdated}`} role="cell" title={p.updated_at ? new Date(p.updated_at).toLocaleString(i18n.resolvedLanguage) : undefined}>
                            {p.updated_at && !Number.isNaN(Date.parse(p.updated_at)) ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(p.updated_at)) : t("unknown")}
                          </span>
                        </div>
                      ))}
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
          <div className="sticky bottom-0 z-[2] mt-auto flex flex-wrap justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] py-4 max-roomy:flex-col max-roomy:items-stretch">
            <a className={secondaryAction} href={selected.url || `https://github.com/${selected.repo}/pull/${selected.number}`} target="_blank" rel="noopener noreferrer">
              {t("viewGitHub")}
              <ExternalLink size={14} />
            </a>
            <button className={secondaryAction} disabled={commentsQuery.isFetching} onClick={() => commentsQuery.refetch()}>
              <RefreshCw size={15} className={commentsQuery.isFetching ? spinning : ""} />
              {commentsQuery.isFetching ? t("refreshing") : t("refresh")}
            </button>
          </div>
        </ActivityDialog>
      )}
    </div>
  );
}
