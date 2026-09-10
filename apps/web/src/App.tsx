import { About } from "./About";
import { projectVersion } from "./project";
import { apiURL } from "./api-url";
import { SyncProgress } from "./SyncProgress";
import { UserMenu } from "./UserMenu";
import Skeleton from "react-loading-skeleton";
import { OverviewSkeleton, PRListSkeleton, RepositorySkeleton, ActivitySkeleton, PageSkeleton, AccountSkeleton } from "./LoadingSkeleton";
import i18n from "./i18n";
import { LanguageMenu } from "./LanguageMenu";
import { useTranslation } from "react-i18next";
import { ActivityDialog } from "./ActivityDialog";
import { ActivityPanel } from "./ActivityPanel";
import { activitySchema } from "./activity-model";
import React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { GitPullRequest, GitMerge, MessageSquare, AlertTriangle, RefreshCw, Building2, Search, LayoutDashboard, Inbox, FolderGit2, Info, X, ChevronRight, ExternalLink } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { parsePRPage, listParameters, parseRepositoryList, type PR, type RepositorySummary } from "./pr-model";
const Overview = React.lazy(() => import("./Overview"));
const api = ky.create({ credentials: "include", retry: 0, timeout: 30000 });
const filterPaths: Record<string, string> = { Overview: "/", About: "/about", All: "/pull-requests", Repositories: "/repositories", "Needs attention": "/attention", "Review requested": "/review-requested", "Changes requested": "/changes-requested", Approved: "/approved" };
function statusKey(status: string) {
  return ({ Open: "openCount", "Awaiting review": "awaitingReview", "Needs attention": "attention", "Review requested": "reviewRequested", "Changes requested": "changesRequested", Approved: "approved", Merged: "merged", Closed: "closed", Conflict: "conflict" } as Record<string, string>)[status] || status;
}
export default function App() {
  const { t } = useTranslation();
  const oauthError = new URLSearchParams(location.search).get("oauth_error");
  const queryClient = useQueryClient();
  const route = useLocation();
  const navigate = useNavigate();
  const filter = Object.keys(filterPaths).find((key) => filterPaths[key] === route.pathname) || "Overview";
  const [params, setParams] = useSearchParams();
  const parsedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 100000 ? parsedPage - 1 : 0;
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
    const query = preserveSearch ? (search ? "?" + new URLSearchParams({ q: search }) : "") : visitedRoutes.current.get(path) || "";
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
  } = useQuery({ queryKey: ["auth"], queryFn: async () => api(apiURL + "/api/v1/auth/status", { credentials: "include" }).then(async (r) => z.object({ connected: z.boolean(), username: z.string().optional() }).parse(await r.json())), staleTime: 30000 });
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
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["prs", filter, page, search],
    retry: 1,
    enabled: !!auth?.connected && !["Overview", "Repositories", "About"].includes(filter),
    gcTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const r = await api(apiURL + "/api/v1/pull-requests?" + listParameters(filter, page, search), { credentials: "include", signal });
      return parsePRPage(await r.json());
    },
    staleTime: 30000,
    refetchInterval: 60000,
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
  const repositories = repositoryData ?? [];
  const filteredRepositories = repositories.filter((repo) => repo.repo.toLowerCase().includes(search.toLowerCase()));
  const clearSearch = () => {
    updateSearch("");
    setDraftSearch("");
  };
  const searchControl = (
    <form
      className="search-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        updateSearch(draftSearch);
      }}
    >
      <label htmlFor="pr-search">{t(filter === "Repositories" ? "searchRepositories" : "search")}</label>
      <div>
        <input id="pr-search" type="search" maxLength={120} title={t("searchShortcut")} aria-keyshortcuts="/" placeholder={t(filter === "Repositories" ? "repositorySearchPlaceholder" : "searchPlaceholder")} value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} />
        <button className="iconbtn" aria-label={t("search")} type="submit">
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
  return (
    <div className={`app max-[900px]:block ${filter === "Overview" ? "overview-layout" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("skipContent")}
      </a>
      <aside className="min-[901px]:w-[208px] min-[901px]:max-[1200px]:px-3 max-[900px]:static max-[900px]:grid max-[900px]:h-auto max-[900px]:w-full max-[900px]:grid-cols-[minmax(0,1fr)_auto] max-[900px]:gap-3 max-[900px]:overflow-visible max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:p-4">
        <a href="#/" className="brand max-[900px]:p-0 max-[900px]:self-center max-[480px]:text-[17px] max-[480px]:gap-1.5">
          <img className="logo" src="/favicon.svg" alt="" />
          <span className="flex flex-col gap-0.5 leading-tight">
            <span>PR Desk</span>
            <span className="brand-version text-[11px] font-normal tracking-normal text-[var(--muted)]">{projectVersion}</span>
          </span>
        </a>
        <nav
          aria-label={t("mainNavigation")}
          className="max-[900px]:mb-0 max-[900px]:col-span-2 max-[900px]:row-start-2 max-[900px]:grid max-[900px]:grid-cols-5 max-[480px]:grid-cols-5 max-[900px]:[&>button]:px-2 max-[900px]:[&>button]:text-center max-[900px]:[&>button]:justify-center max-[480px]:[&>button]:flex-col max-[480px]:[&>button]:gap-1 max-[480px]:[&>button]:text-[11px]"
        >
          <button className={filter === "Overview" ? "active" : ""} aria-current={filter === "Overview" ? "page" : undefined} onClick={() => setFilter("Overview")}>
            <LayoutDashboard size={17} aria-hidden="true" />
            <span>{t("navOverview")}</span>
          </button>
          <button className={filter === "Needs attention" ? "active" : ""} aria-current={filter === "Needs attention" ? "page" : undefined} onClick={() => setFilter("Needs attention")}>
            <Inbox size={17} aria-hidden="true" />
            <span>{t("navAttention")}</span> <b>{authLoading || summaryLoading ? <Skeleton width={14} height={10} /> : (summary?.attention ?? "—")}</b>
          </button>
          <button className={!["Overview", "Needs attention", "Repositories", "About"].includes(filter) ? "active" : ""} aria-current={!["Overview", "Needs attention", "Repositories", "About"].includes(filter) ? "page" : undefined} onClick={() => setFilter("All")}>
            <GitPullRequest size={17} aria-hidden="true" />
            <span>{t("navAll")}</span>
          </button>
          <button className={filter === "Repositories" ? "active" : ""} aria-current={filter === "Repositories" ? "page" : undefined} onClick={() => setFilter("Repositories")}>
            <FolderGit2 size={17} aria-hidden="true" />
            <span>{t("navRepositories")}</span>
          </button>
          <button className={filter === "About" ? "active" : ""} aria-current={filter === "About" ? "page" : undefined} onClick={() => setFilter("About")}>
            <Info size={17} aria-hidden="true" />
            <span>{t("navAbout")}</span>
          </button>
        </nav>
        <div className="sidebottom max-[900px]:pt-0 max-[900px]:col-start-2 max-[900px]:row-start-1 max-[900px]:m-0 max-[900px]:flex max-[900px]:items-center max-[900px]:gap-2 max-[900px]:[&>a]:m-0 max-[900px]:[&>a]:w-auto max-[900px]:[&>button]:w-auto max-[900px]:[&>*]:whitespace-nowrap max-[480px]:[&>*]:p-2 max-[480px]:[&>*]:text-xs">
          {auth?.connected && (
            <a
              className="organization-access"
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
              <span className="max-[480px]:hidden">{t("organizationAccess")}</span>
            </a>
          )}
          {auth?.connected && (
            <button className="sync" disabled={!auth?.connected || syncing} aria-busy={syncing} onClick={() => syncMutation.mutate()}>
              <RefreshCw size={16} className={syncing ? "spinning" : ""} />
              {syncing ? t("syncing") : t("sync")}
            </button>
          )}
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="@container/dashboard flex-1 mx-auto max-w-[1600px] px-[clamp(16px,2.5vw,40px)] py-6 max-[900px]:px-4 max-[900px]:py-5">
        <header className="page-header">
          <div>
            <h1>{filter === "About" ? t("navAbout") : authLoading ? <Skeleton width={120} height={23} /> : !auth?.connected ? "PR Desk" : filter === "Overview" ? t("achievements") : filter === "Repositories" ? t("navRepositories") : filter === "Needs attention" ? t("navAttention") : t("navAll")}</h1>

            {oauthError && (
              <p className="error" role="alert">
                {t("oauthCancelled")}
              </p>
            )}
          </div>
          <div className="account-bar">
            <time className="header-date">{new Intl.DateTimeFormat(i18n.language, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</time>
            <div className="header-actions">
              <LanguageMenu />
              {authLoading ? <AccountSkeleton /> : <UserMenu connected={!!auth?.connected} username={auth?.username} onDisconnect={() => logoutMutation.mutate()} disconnecting={logoutMutation.isPending} disconnectError={logoutMutation.isError} />}
            </div>
          </div>
        </header>
        <SyncProgress connected={!!auth?.connected} pending={syncMutation.isPending} onRunningChange={setRemoteSyncing} />
        {syncFeedback && !remoteSyncing && (
          <div className={`sync-feedback ${syncFeedback.error ? "sync-feedback-error" : ""}`} role={syncFeedback.error ? "alert" : "status"}>
            <span>{syncFeedback.message}</span>
            <button aria-label={t("close")} onClick={() => setSyncFeedback(null)}>
              ×
            </button>
          </div>
        )}
        {filter === "About" ? (
          <About />
        ) : authLoading ? (
          <PageSkeleton page={filter} />
        ) : authError && !auth ? (
          <section className="empty-state" role="alert">
            <AlertTriangle size={28} />
            <h2>{t("apiUnavailable")}</h2>
            <button className="secondary-action" onClick={() => retryAuth()}>
              {t("retry")}
            </button>
          </section>
        ) : !auth?.connected ? (
          <section className="connection-card">
            <div className="connection-icon">
              <GitPullRequest size={30} />
            </div>
            <h2>{t("welcomeTitle")}</h2>
            <p>{t("welcomeDescription")}</p>
            <a className="primary-action" href={apiURL + "/api/v1/auth/github"}>
              <GitPullRequest size={18} />
              {t("connectGitHub")}
            </a>
            <div className="connection-features">
              <span>
                <LayoutDashboard size={16} />
                {t("navOverview")}
              </span>
              <span>
                <Inbox size={16} />
                {t("navAttention")}
              </span>
              <span>
                <RefreshCw size={16} />
                {t("backgroundUpdates")}
              </span>
            </div>
          </section>
        ) : filter === "Overview" ? (
          <React.Suspense fallback={<OverviewSkeleton controls />}>
            <Overview onAccessGranted={() => syncMutation.mutate(true)} />
          </React.Suspense>
        ) : (
          <>
            {summaryError && (
              <div className="sync-status-error" role="status">
                <span>{t("summaryUnavailable")}</span>
                <button className="access-recheck" onClick={() => retrySummary()}>
                  {t("retry")}
                </button>
              </div>
            )}
            <section className="stats @max-[760px]/dashboard:grid-cols-2 @max-[760px]/dashboard:gap-3" aria-label={t("overview")}>
              {[
                [t("open"), summary ? String(summary.open) : "—", GitPullRequest, "purple"],
                [t("needsReview"), summary ? String(summary.needs_review) : "—", MessageSquare, "blue"],
                [t("conflicts"), summary ? String(summary.conflicts) : "—", AlertTriangle, "red"],
                [t("mergedMonth"), summary ? String(summary.merged) : "—", GitMerge, "green"],
              ].map(([l, v, I, c]: any) => (
                <div key={l} className="stat @max-[620px]/dashboard:min-h-[76px] @max-[620px]/dashboard:p-3.5">
                  <div className={"staticon " + c}>
                    <I size={18} />
                  </div>
                  <div>
                    <span>{l}</span>
                    <strong>{summaryLoading ? <Skeleton width={48} height={26} /> : v}</strong>
                  </div>
                </div>
              ))}
            </section>
            {filter === "Repositories" && (
              <section className="repositories" id="repositories">
                <div className="list-heading">
                  <h2>
                    {t("repositories")} <span>{repositoriesLoading ? <Skeleton width={20} /> : filteredRepositories.length}</span>
                  </h2>
                  {searchControl}
                </div>
                {repositoriesError && repositoryData && (
                  <div className="sync-status-error" role="status">
                    <span>{t("refreshFailedKeepData")}</span>
                    <button className="access-recheck" onClick={() => refetchRepositories()}>
                      {t("retry")}
                    </button>
                  </div>
                )}
                {repositoriesLoading ? (
                  <RepositorySkeleton />
                ) : repositoriesError && !repositoryData ? (
                  <div className="empty-state" role="alert">
                    <AlertTriangle size={28} />
                    <h2>{t("unableRepositories")}</h2>
                    <button className="secondary-action" onClick={() => refetchRepositories()}>
                      {t("retry")}
                    </button>
                  </div>
                ) : filteredRepositories.length === 0 ? (
                  <div className="empty-state">
                    <FolderGit2 size={28} />
                    <h2>{t("emptyResultsTitle")}</h2>
                    <p>{t(search ? "emptyResultsDescription" : "noRepos")}</p>
                    {search && (
                      <button className="secondary-action" onClick={clearSearch}>
                        {t("clearFilters")}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="repo-grid grid grid-cols-1 @[760px]/dashboard:grid-cols-2 @[1250px]/dashboard:grid-cols-3">
                    {filteredRepositories.map((r) => (
                      <article className="repo-card" key={r.repo}>
                        <a className="repo-name" title={r.repo} href={`https://github.com/${r.repo}`} target="_blank" rel="noopener noreferrer">
                          <FolderGit2 size={18} aria-hidden="true" />
                          <span>
                            <small>{r.repo.split("/")[0]}</small>
                            <strong>{r.repo.split("/").slice(1).join("/")}</strong>
                          </span>
                          <ExternalLink size={14} className="repo-external" aria-hidden="true" />
                        </a>
                        <dl className="repo-metrics">
                          {[
                            [t("prs"), r.total],
                            [t("open"), r.open],
                            [t("conflicts"), r.conflicts],
                            [t("navAttention"), r.needs_attention],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <button
                          className="repo-pr-filter"
                          onClick={() => {
                            void navigate(filterPaths.All + "?" + new URLSearchParams({ q: r.repo }));
                          }}
                        >
                          <span>{t("viewRepositoryPRs")}</span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            {filter !== "Repositories" && (
              <>
                <div className="list-heading">
                  <h2>
                    {t("yourPRs")} <span>{isLoading ? "—" : (data?.total ?? 0)}</span>
                    {isFetching && !isLoading && (
                      <small className="background-refresh" role="status">
                        <RefreshCw size={13} className="spinning" />
                        {t("updatingResults")}
                      </small>
                    )}
                  </h2>
                  {search && (
                    <button className="search-chip" onClick={clearSearch} aria-label={t("clearFilters")}>
                      {search}
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="toolbar">
                  {searchControl}
                  {filter !== "Needs attention" && (
                    <div className="filters max-w-full overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
                      {[
                        ["All", t("filterAll")],
                        ["Review requested", t("filterReview")],
                        ["Changes requested", t("filterChanges")],
                        ["Approved", t("filterApproved")],
                      ].map(([value, label]) => (
                        <button key={value} onClick={() => setFilter(value, true)} className={filter === value ? "selected" : ""} aria-pressed={filter === value}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isError && data && (
                  <div className="sync-status-error" role="status">
                    <span>{t("refreshFailedKeepData")}</span>
                    <button className="access-recheck" onClick={() => refetch()}>
                      {t("retry")}
                    </button>
                  </div>
                )}
                {isLoading && <PRListSkeleton />}
                {!isLoading && (!isError || data) && shown.length === 0 && (
                  <div className="empty-state">
                    <Inbox size={28} />
                    <h2>{t(filter === "Needs attention" && !search && page === 0 ? "caughtUp" : "emptyResultsTitle")}</h2>
                    <p>{t(search || page > 0 ? "emptyResultsDescription" : filter === "Needs attention" ? "noActionNeeded" : "noOpenResults")}</p>
                    {page > 0 ? (
                      <button className="secondary-action" onClick={() => setPage(0)}>
                        {t("firstPage")}
                      </button>
                    ) : search ? (
                      <button className="secondary-action" onClick={clearSearch}>
                        {t("clearFilters")}
                      </button>
                    ) : (
                      filter !== "All" && (
                        <button className="secondary-action" onClick={() => navigate(filterPaths.All)}>
                          {t("navAll")}
                        </button>
                      )
                    )}
                  </div>
                )}
                {isError && !data && (
                  <div className="empty-state" role="alert">
                    <AlertTriangle size={28} />
                    <h2>{t("unablePRs")}</h2>
                    <button className="secondary-action" onClick={() => refetch()}>
                      {t("retry")}
                    </button>
                  </div>
                )}
                {!isLoading && shown.length > 0 && (
                  <>
                    <div className="table block w-full" role="table" aria-label={t("yourPRs")}>
                      <div className="thead" role="row">
                        <span role="columnheader">{t("pullRequest")}</span>
                        <span role="columnheader">{t("repository")}</span>
                        <span role="columnheader">{t("status")}</span>
                        <span role="columnheader">{t("updated")}</span>
                        <span role="columnheader">{t("activity")}</span>
                      </div>
                      {shown.map((p) => (
                        <div key={`${p.repo}-${p.number}`} className="row" role="row">
                          <div className="prtitle" role="cell">
                            <GitPullRequest size={17} className="purpletxt" />
                            <div>
                              <a className="pr-title-link" href={p.url || `https://github.com/${p.repo}/pull/${p.number}`} target="_blank" rel="noopener noreferrer">
                                {p.title}
                              </a>
                              <small>
                                <em>#{p.number}</em>
                              </small>
                            </div>
                          </div>
                          <div role="cell" className="min-w-0 max-[640px]:col-start-1 max-[640px]:row-start-2">
                            <a className="pr-repository" title={p.repo} href={`https://github.com/${p.repo}`} target="_blank" rel="noopener noreferrer">
                              {p.repo}
                            </a>
                          </div>
                          <div className="prstatus" role="cell">
                            <span className={"pill " + p.status.toLowerCase().replaceAll(" ", "-")}>{t(statusKey(p.status), { defaultValue: p.status })}</span>
                            {p.conflict && (
                              <span className="conflict">
                                <AlertTriangle size={13} />
                                {t("conflict")}
                              </span>
                            )}
                            {p.checks_status && (
                              <span className={"checks " + p.checks_status}>
                                {t("ci")}: {t(p.checks_status, { defaultValue: p.checks_status })}
                              </span>
                            )}
                          </div>
                          <span className="muted pr-updated" role="cell" title={p.updated_at ? new Date(p.updated_at).toLocaleString(i18n.resolvedLanguage) : undefined}>
                            {p.updated_at && !Number.isNaN(Date.parse(p.updated_at)) ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(p.updated_at)) : t("unknown")}
                          </span>
                          <div role="cell" className="activity">
                            <button className="commentbtn activity" title={t("viewActivity")} aria-label={t("viewPRActivity", { number: p.number })} onClick={() => setSelected(p)}>
                              <MessageSquare size={15} />
                              {p.comments}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pagination flex-wrap">
                      <button disabled={page === 0 || isLoading} onClick={() => setPage(page - 1)}>
                        {t("previous")}
                      </button>
                      <span>
                        {t("page")} {page + 1} · {data?.total ?? 0} {t("results")}
                      </span>
                      <button disabled={isLoading || isError || (page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
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
            <div className="activity-warning" role="alert">
              {t("unableComments")}
            </div>
          )}
          {commentsQuery.data && <ActivityPanel data={commentsQuery.data} />}
          <div className="activity-footer">
            <a className="secondary-action" href={selected.url || `https://github.com/${selected.repo}/pull/${selected.number}`} target="_blank" rel="noopener noreferrer">
              {t("viewGitHub")}
              <ExternalLink size={14} />
            </a>
            <button className="secondary-action" disabled={commentsQuery.isFetching} onClick={() => commentsQuery.refetch()}>
              <RefreshCw size={15} className={commentsQuery.isFetching ? "spinning" : ""} />
              {commentsQuery.isFetching ? t("refreshing") : t("refresh")}
            </button>
          </div>
        </ActivityDialog>
      )}
    </div>
  );
}
