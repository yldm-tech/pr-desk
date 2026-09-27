import React from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MotionConfig } from "motion/react";
import { Command, Search } from "lucide-react";
import { apiURL } from "./api-url";
import { projectVersion } from "./project";
import { oauthBanner } from "./pr-model";
import { AccountSkeleton } from "./LoadingSkeleton";
import { LanguageSelect } from "./LanguageMenu";
import { HardRefresh } from "./HardRefresh";
import { useMediaQuery } from "./media-query";
import { DetailHost } from "./DetailHost";
import { Banners } from "./Banners";
import { ShellNav, SettingsLink } from "./ShellNav";
import { inboxSummary } from "./followup-view";
import { SyncStatus, useSyncProgress } from "./SyncProgress";
import { AccountMenu, ThemeSwitch } from "./UserMenu";
import { useAuth, useFollowUps, useLogout, useSyncFeedback, useSyncMutation, useSyncPending } from "./queries";
import { destinationOf, paths, type Destination } from "./routes";
import { overlays, REVEAL_SEARCH_EVENT, useShortcut } from "./shortcuts";
import { dismissToast, showToast, useToast } from "./toast";
import { cx, Kbd, LinkButton } from "./ui-controls";
import { ToastRegion } from "./ui-overlay";

// Both overlays are their own chunks: neither is needed for the first paint, and the palette brings cmdk with it.
const CommandPalette = React.lazy(() => import("./CommandPalette"));
const ShortcutsSheet = React.lazy(() => import("./ShortcutsSheet"));

// Whether the sidebar is showing. Layout never reads this (CSS does that from the same 900px token); only the popovers do, because a menu anchored at the foot of the sidebar opens from its start edge while one anchored in the top bar's right corner opens from its end.
const SHELL_QUERY = "(min-width: 900px)";

// The page heading each destination has when its page does not print one of its own. Pages rebuilt on PageHeader carry their own h1, and this one then hides itself (the `:has()` rule on it), so a page is never without a heading and never has two.
const headingKeys: Record<Destination, string> = { inbox: "shell.navInbox", prs: "shell.navPulls", repos: "shell.navRepos", insights: "shell.navInsights", settings: "followup.settings", about: "shell.aboutTitle" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// The chrome around every page: the skip link, one <aside> that is the top bar below `shell` and the 208px sidebar from it, the tab bar (the same <nav>, fixed to the bottom edge on a phone), the banners, and the app-wide overlays. The page arrives as `children` from the route table. Nothing on or above the <aside> may take a transform, filter or backdrop-filter: any of them makes it the containing block of the fixed tab bar, which would then scroll away with the top bar.
export function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [oauthError, setOauthError] = React.useState(() => oauthBanner(location.search).error);
  React.useEffect(() => {
    // HashRouter only ever rewrites the fragment, so the OAuth query flag would outlive every navigation and reload.
    const { cleanedSearch } = oauthBanner(location.search);
    if (cleanedSearch !== location.search) window.history.replaceState(window.history.state, "", location.pathname + cleanedSearch + location.hash);
  }, []);
  const route = useLocation();
  const destination = destinationOf(route.pathname);
  // Where each destination was last left, path and query together, so the navigation returns the reader to the view and filters they had rather than to a fresh default. Written during render rather than in an effect so the links rendered in the same pass already point where the reader is now; for pull requests it is the last /prs view, which is what the old "last PR route" memory held.
  const visitedRoutes = React.useRef(new Map<Destination, string>());
  if (destination) visitedRoutes.current.set(destination, route.pathname + route.search);
  const hrefFor = (target: Destination) => visitedRoutes.current.get(target) ?? paths[target];
  useShortcut("/", () => {
    const input = document.getElementById("pr-search");
    if (!input) return false;
    // A field that is in the page but folded away has no box to focus; the page opens it and focuses it itself.
    if (!input.getClientRects().length) window.dispatchEvent(new Event(REVEAL_SEARCH_EVENT));
    else input.focus();
  });

  const { data: auth, isPending: authLoading } = useAuth();
  const connected = !!auth?.connected;
  // Signed out is a definite answer. While the session is still being checked, or the check failed with nothing cached, the shell keeps its signed-in shape so the page does not jump when the answer arrives.
  const signedOut = !authLoading && !!auth && !auth.connected;
  const syncMutation = useSyncMutation();
  const pending = useSyncPending();
  const { query: progress, running } = useSyncProgress({ connected, pending });
  const followUps = useFollowUps(connected);
  const logoutMutation = useLogout();
  const sidebar = useMediaQuery(SHELL_QUERY);

  // The result of a manual sync is reported in the one toast slot. A success floats and goes; an error stays until dismissed. A run the server reports as started clears a result that was about the request, because the run itself is now the news and the pill is telling it.
  const [syncFeedback, setSyncFeedback] = useSyncFeedback();
  const toast = useToast();
  const syncToastText = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!syncFeedback) return;
    syncToastText.current = syncFeedback.message;
    showToast({ text: syncFeedback.message, tone: syncFeedback.error ? "error" : "success" });
  }, [syncFeedback]);
  React.useEffect(() => {
    if (!running) return;
    setSyncFeedback(null);
    if (toast && toast.text === syncToastText.current) dismissToast();
  }, [running, toast, setSyncFeedback]);

  const onAbout = destination === "about";
  const heading = signedOut && !onAbout ? t("welcomeHeading") : t(headingKeys[destination ?? "inbox"]);
  const bar =
    "sticky top-0 z-30 flex h-[calc(var(--topbar-h)+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-[max(8px,env(safe-area-inset-right))] pl-[max(10px,env(safe-area-inset-left))] roomy:gap-2 roomy:pr-[max(16px,env(safe-area-inset-right))] roomy:pl-[max(16px,env(safe-area-inset-left))]";
  const column = "shell:h-dvh shell:w-(--sidebar-w) shell:flex-col shell:items-stretch shell:gap-0 shell:overflow-y-auto shell:border-r shell:border-b-0 shell:bg-bg-subtle shell:px-3 shell:pt-[max(12px,env(safe-area-inset-top))] shell:pb-3";

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx("min-h-dvh bg-bg text-fg", !signedOut && "shell:flex")}>
        <a
          className="fixed top-[max(12px,env(safe-area-inset-top))] left-[max(12px,env(safe-area-inset-left))] z-50 rounded-md bg-accent px-4 py-2.5 text-body font-medium text-accent-fg no-underline shadow-1 [transform:translateY(calc(-100%-48px))] focus:[transform:translateY(0)]"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          {t("skipContent")}
        </a>
        <aside className={cx(bar, !signedOut && column)}>
          {/* Below `roomy` only the mark is shown: the wordmark would not fit beside the controls on a 320px phone. The aria-label keeps the link named once the text is gone, and the product name is not translated anywhere. */}
          <a href={"#" + paths.inbox} aria-label="PR Desk" className={cx("inline-flex min-h-8 min-w-8 shrink-0 items-center gap-2 rounded-md px-1 text-body font-semibold text-fg no-underline pointer-coarse:min-h-11 pointer-coarse:min-w-11", !signedOut && "shell:self-start shell:px-2")}>
            <img className="size-5 shrink-0" src="/favicon.svg" alt="" />
            <span className="hidden roomy:inline">PR Desk</span>
            {!signedOut && <span className="hidden text-caption font-normal text-fg-subtle tabular-nums shell:inline">{projectVersion}</span>}
          </a>
          {signedOut ? (
            <div className="ml-auto flex min-w-0 items-center gap-1 roomy:gap-2">
              {onAbout && (
                <LinkButton variant="primary" size="sm" href={apiURL + "/api/v1/auth/github"}>
                  {t("connectGitHub")}
                </LinkButton>
              )}
              <LanguageSelect hideLabel />
              <ThemeSwitch variant="compact" />
              <HardRefresh />
            </div>
          ) : (
            <>
              {/* The palette's trigger. In the top bar it is an icon beside a page that may have a search of its own (the Inbox's follow-up search), so there it wears the command glyph rather than a second magnifier and is named for what it searches, everything; in the sidebar it is the labelled field with its shortcut. The shortcut is never part of the name: it is shown only where there is a keyboard to press it, and said by aria-keyshortcuts. */}
              <button
                type="button"
                onClick={overlays.openPalette}
                aria-keyshortcuts="Meta+K Control+K"
                title={t("shell.searchEverything")}
                className="ml-auto inline-grid size-8 shrink-0 place-items-center rounded-md border border-transparent bg-transparent p-0 text-fg-muted transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted hover:text-fg pointer-coarse:size-11 shell:mt-3 shell:ml-0 shell:flex shell:size-auto shell:min-h-8 shell:items-center shell:gap-2 shell:border-line shell:bg-bg shell:px-2 shell:text-fg-subtle pointer-coarse:shell:min-h-11"
              >
                <Command size={16} aria-hidden="true" className="shrink-0 shell:hidden" />
                <Search size={16} aria-hidden="true" className="hidden shrink-0 shell:block" />
                <span className="sr-only shell:hidden">{t("shell.searchEverything")}</span>
                <span className="hidden text-small shell:inline shell:flex-1 shell:text-left">{t("shell.search")}</span>
                <span aria-hidden="true" className="hidden pointer-fine:shell:inline-flex">
                  <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
                </span>
              </button>
              <ShellNav current={destination} hrefFor={hrefFor} badge={followUps.data ? inboxSummary(followUps.data.data, followUps.data.counts).total : undefined} badgeLoading={authLoading || followUps.isPending} />
              <div className="hidden shell:mt-auto shell:grid shell:gap-0.5 shell:pt-3">{connected && <SettingsLink current={destination} to={hrefFor("settings")} />}</div>
              {connected ? (
                <div className="flex min-w-0 items-center gap-0.5 shell:mt-1 shell:border-t shell:border-line shell:pt-2">
                  <div className="min-w-0 shell:flex-1">
                    <SyncStatus progress={progress} auth={auth} pending={pending} onSync={() => syncMutation.mutate()} align={sidebar ? "start" : "end"} />
                  </div>
                  {/* Renders only in an installed window, where there is no browser reload to reach for. */}
                  <HardRefresh />
                </div>
              ) : (
                // The session check failed with nothing cached. The reader still needs the language and theme they read the page in and, in an installed window whose shell may be the stale one, the reload that is the way out.
                !authLoading && (
                  <div className="flex min-w-0 items-center gap-1 shell:mt-1 shell:flex-wrap shell:border-t shell:border-line shell:pt-2">
                    <LanguageSelect hideLabel />
                    <ThemeSwitch variant="compact" />
                    <HardRefresh />
                  </div>
                )
              )}
              <div className="shrink-0 shell:mt-1">{authLoading ? <AccountSkeleton /> : connected ? <AccountMenu username={auth?.username} onDisconnect={() => logoutMutation.mutate()} disconnecting={logoutMutation.isPending} disconnectError={logoutMutation.isError} align={sidebar ? "start" : "end"} /> : null}</div>
            </>
          )}
        </aside>
        <main
          id="main-content"
          tabIndex={-1}
          className={cx(
            "min-w-0 flex-1 pt-4 pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))] focus:outline-none roomy:pr-[max(24px,env(safe-area-inset-right))] roomy:pl-[max(24px,env(safe-area-inset-left))] wide:pr-[max(32px,env(safe-area-inset-right))] wide:pl-[max(32px,env(safe-area-inset-left))]",
            // Below `shell` the tab bar is fixed over the bottom of the page, so <main> reserves its height plus the home-indicator inset, and the last row can always be scrolled clear of it.
            signedOut ? "pb-[max(32px,env(safe-area-inset-bottom))]" : "pb-[calc(var(--tabbar-h)+max(16px,env(safe-area-inset-bottom)))] shell:pt-6 shell:pb-10",
          )}
        >
          <div className="mx-auto w-full max-w-(--content-max) @container/dashboard">
            {!onAbout && <Banners auth={auth} progress={connected ? progress.data : undefined} oauthError={!!oauthError} onDismissOAuth={() => setOauthError(null)} />}
            <h1 data-shell-heading="" className="mb-4 text-page font-semibold tracking-[var(--tracking-page)] text-fg [main:has(h1:not([data-shell-heading]))_&]:hidden">
              {heading}
            </h1>
            {children}
          </div>
        </main>
        <ToastRegion />
        <DetailHost />
        <React.Suspense fallback={null}>
          <CommandPalette />
          <ShortcutsSheet />
        </React.Suspense>
      </div>
    </MotionConfig>
  );
}
