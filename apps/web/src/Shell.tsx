import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { Building2, FolderGit2, GitPullRequest, Inbox, Info, LayoutDashboard, RefreshCw, Settings2 } from "lucide-react";
import i18n from "./i18n";
import { projectVersion } from "./project";
import { apiURL } from "./api-url";
import { oauthBanner } from "./pr-model";
import {
  syncFeedback as syncFeedback_,
  accountBar,
  appShell,
  brand,
  brandLogo,
  headerActions,
  headerDate,
  headerTitleSlot,
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
  sidebar,
  sidebarAction,
  sidebarActionActive,
  sidebarBottom,
  skipLink,
  spinning,
  syncButton,
  syncFeedbackFloating,
} from "./app-styles";
import { syncStatusError } from "./status-styles";
import { SyncProgress } from "./SyncProgress";
import { UserMenu } from "./UserMenu";
import { AccountSkeleton } from "./LoadingSkeleton";
import { LanguageMenu } from "./LanguageMenu";
import { HardRefresh } from "./HardRefresh";
import { DetailHost } from "./DetailHost";
import { openInstallPopup } from "./github-access";
import { useAuth, useFollowUps, useLogout, useSyncFeedback, useSyncMutation, useSyncPending } from "./queries";
import { destinationOf, paths, prViewFromPath, prViewTitleKeys, type Destination } from "./routes";
import { useShortcut } from "./shortcuts";

// The chrome around every page — skip link, sidebar or top bar, page header, sync status and banners — moved out of App.tsx unchanged. The page itself arrives as `children` from the route table.
export function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [oauthError, setOauthError] = React.useState(() => oauthBanner(location.search).error);
  React.useEffect(() => {
    // HashRouter only ever rewrites the fragment, so the OAuth query flag would outlive every navigation and reload.
    const { cleanedSearch } = oauthBanner(location.search);
    if (cleanedSearch !== location.search) window.history.replaceState(window.history.state, "", location.pathname + cleanedSearch + location.hash);
  }, []);
  const route = useLocation();
  const navigate = useNavigate();
  const destination = destinationOf(route.pathname);
  const view = prViewFromPath(route.pathname);
  // Where each destination was last left, path and query together, so the navigation returns the reader to the view and filters they had rather than to a fresh default. For pull requests that is the last /prs view, which is what the old "last PR route" memory held.
  const visitedRoutes = React.useRef(new Map<Destination, string>());
  React.useEffect(() => {
    if (destination) visitedRoutes.current.set(destination, route.pathname + route.search);
  }, [destination, route.pathname, route.search]);
  const go = (target: Destination) => void navigate(visitedRoutes.current.get(target) ?? paths[target]);
  useShortcut("/", () => {
    const input = document.getElementById("pr-search");
    if (!input) return false;
    input.focus();
  });
  const syncMutation = useSyncMutation();
  const pending = useSyncPending();
  const [syncFeedback, setSyncFeedback] = useSyncFeedback();
  const logoutMutation = useLogout();
  const [remoteSyncing, setRemoteSyncing] = React.useState(false);
  const syncing = pending || remoteSyncing;
  React.useEffect(() => {
    if (remoteSyncing) setSyncFeedback(null);
  }, [remoteSyncing, setSyncFeedback]);
  const { data: auth, isPending: authLoading } = useAuth();
  const followUps = useFollowUps(!!auth?.connected);
  const attentionCount = followUps.data ? (followUps.data.counts.authored || 0) + (followUps.data.counts.reviewer || 0) + (followUps.data.counts.follow_up || 0) : undefined;
  React.useEffect(() => {
    if (!syncFeedback || syncFeedback.error) return;
    const timer = window.setTimeout(() => setSyncFeedback(null), 6000);
    return () => window.clearTimeout(timer);
  }, [syncFeedback, setSyncFeedback]);
  const activeNavButton = React.useRef<HTMLButtonElement | null>(null);
  // The strip scrolls horizontally when it does not fit, and has no scroll affordance, so landing on a destination from a bookmark could otherwise leave its entry off screen. "nearest" leaves a strip that already shows the selection alone.
  React.useEffect(() => {
    activeNavButton.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [destination]);
  const insights = destination === "insights";
  const navItem = (target: Destination) => ({ ref: destination === target ? activeNavButton : null, className: navButton(destination === target), "aria-current": destination === target ? ("page" as const) : undefined, onClick: () => go(target) });
  return (
    <div className={`${appShell} ${insights ? overviewCanvas : ""}`}>
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
      <aside className={`${sidebar} ${insights ? overviewAside : asideBorder}`}>
        {/* Below `roomy` only the mark is shown: the wordmark had 36px to render in and truncated to "PR…", which reads as a bug rather than as a brand. The aria-label is what keeps the link named once the text is gone, and the product name is not translated anywhere else either. */}
        <a href={"#" + paths.inbox} aria-label="PR Desk" className={`${brand} max-roomy:gap-1.5 max-roomy:text-[length:1.0625rem] max-roomy:[&>span]:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11`}>
          <img className={brandLogo} src="/favicon.svg" alt="" />
          <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
            <span className="truncate">PR Desk</span>
            <span className="text-[length:0.6875rem] font-normal tracking-normal text-[var(--muted)]">{projectVersion}</span>
          </span>
        </a>
        <nav aria-label={t("mainNavigation")} className={nav}>
          <button {...navItem("insights")}>
            <LayoutDashboard size={17} aria-hidden="true" />
            <span>{t("navOverview")}</span>
          </button>
          <button {...navItem("inbox")}>
            <Inbox size={17} aria-hidden="true" />
            <span>{t("navAttention")}</span>
            {(authLoading || auth?.connected) && (
              <b style={{ visibility: authLoading || followUps.isPending ? "hidden" : undefined }} aria-hidden={authLoading || followUps.isPending || undefined}>
                {/* The count is unbounded and the badge sits beside a label that already has no room to spare, so four digits are spelled as three. */}
                {attentionCount === undefined ? "—" : attentionCount > 99 ? "99+" : attentionCount}
              </b>
            )}
          </button>
          <button {...navItem("prs")}>
            <GitPullRequest size={17} aria-hidden="true" />
            <span>{t("navAll")}</span>
          </button>
          <button {...navItem("repos")}>
            <FolderGit2 size={17} aria-hidden="true" />
            <span>{t("navRepositories")}</span>
          </button>
          <button {...navItem("about")}>
            <Info size={17} aria-hidden="true" />
            <span>{t("navAbout")}</span>
          </button>
        </nav>
        <div className={sidebarBottom}>
          {auth?.connected && (
            <button className={destination === "settings" ? sidebarActionActive : sidebarAction} aria-current={destination === "settings" ? "page" : undefined} title={t("followup.settings")} aria-label={t("followup.settings")} onClick={() => go("settings")}>
              <Settings2 size={16} aria-hidden="true" />
              <span>{t("followup.settings")}</span>
            </button>
          )}
          {auth?.connected && (
            <a className={sidebarAction} title={t("organizationAccess")} aria-label={t("organizationAccess")} onClick={(event) => openInstallPopup(event, event.currentTarget.href)} href={apiURL + "/api/v1/repository-access/install"} target="_blank" rel="noopener noreferrer">
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
        <header className={`${pageHeader} ${insights ? overviewHeaderGap : pageHeaderGap}`}>
          <div className={headerTitleSlot}>
            <h1 className={insights ? `${pageTitle} ${overviewHeading}` : pageTitle}>
              {destination === "about" ? (
                t("navAbout")
              ) : authLoading ? (
                <Skeleton width={120} height={23} />
              ) : !auth?.connected ? (
                t("welcomeHeading")
              ) : destination === "settings" ? (
                t("followup.settings")
              ) : insights ? (
                t("navOverview")
              ) : destination === "repos" ? (
                t("navRepositories")
              ) : destination === "inbox" ? (
                t("navAttention")
              ) : (
                t(view ? prViewTitleKeys[view] : "navAll")
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
              {authLoading ? <AccountSkeleton /> : auth?.connected || destination === "about" ? <UserMenu connected={!!auth?.connected} username={auth?.username} onDisconnect={() => logoutMutation.mutate()} disconnecting={logoutMutation.isPending} disconnectError={logoutMutation.isError} /> : null}
            </div>
          </div>
        </header>
        <SyncProgress connected={!!auth?.connected} pending={pending} onRunningChange={setRemoteSyncing} hidden={destination === "about" || destination === "settings"} />
        {auth?.sync_paused && destination !== "about" && (
          <p className={syncStatusError} role="status">
            {t("followup.paused")} <a href={apiURL + "/api/v1/auth/github"}>{t("followup.reconnect")}</a>
          </p>
        )}
        {destination !== "about" && syncFeedback && !remoteSyncing && (
          <div className={syncFeedback.error ? syncFeedback_ : `${syncFeedback_} ${syncFeedbackFloating}`} role={syncFeedback.error ? "alert" : "status"}>
            <span>{syncFeedback.message}</span>
            <button aria-label={t("dismissMessage")} onClick={() => setSyncFeedback(null)}>
              ×
            </button>
          </div>
        )}
        {children}
      </main>
      <DetailHost />
    </div>
  );
}
