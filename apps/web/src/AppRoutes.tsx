import React from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { About } from "./About";
import { Welcome } from "./Welcome";
import { Repositories } from "./Repositories";
import { FollowUpSettings } from "./FollowUpSettings";
import { InboxPage } from "./InboxPage";
import { PullRequestsPage } from "./PullRequestsPage";
import { ErrorBoundary } from "./ErrorBoundary";
import { OverviewSkeleton, PageSkeleton } from "./LoadingSkeleton";
import { ErrorState } from "./ui-display";
import { useAuth, useRepositories } from "./queries";
import { destinationOf, legacyRedirect, paths, prViewFromPath, prViewTitleKeys, type Destination } from "./routes";
import { useDocumentTitle } from "./page-title";

const Overview = React.lazy(() => import("./Overview"));

// Rewrites an address that is not canonical before anything renders under it, so a page never reads the parameters of the route it is about to leave and the shell never paints a heading for an address that is going away. `replace` keeps the old entry out of history, so Back still leaves the app rather than bouncing between the old address and the new one.
export function LegacyRedirect({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation();
  const target = legacyRedirect(pathname, search);
  if (target) return <Navigate to={{ pathname: target.pathname, search: target.search }} replace />;
  return children;
}

// The skeleton each destination has always shown while the session is being checked, keyed by the page names LoadingSkeleton was written against.
const skeletonPage: Record<Destination, string> = { inbox: "Needs attention", prs: "All", repos: "Repositories", insights: "Overview", settings: "Settings", about: "About" };

function PageTitle({ parts }: { parts: string[] }) {
  useDocumentTitle(parts);
  return null;
}

// Every route except About needs a session. The order is the one the shell has always used: a skeleton while the session is checked, the API error only when nothing is cached, and the welcome page when the answer is "not connected".
function Connected() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: auth, isPending, isError, refetch } = useAuth();
  if (isPending) return <PageSkeleton page={skeletonPage[destinationOf(pathname) ?? "inbox"]} />;
  if (isError && !auth) return <ErrorState title={t("apiUnavailable")} onRetry={() => void refetch()} />;
  if (!auth?.connected)
    return (
      <>
        <PageTitle parts={[t("welcomeHeading")]} />
        <Welcome />
      </>
    );
  return <Outlet />;
}

function RepositoriesRoute() {
  const { data, isLoading, isError, refetch } = useRepositories(true);
  return <Repositories repositories={data} loading={isLoading} error={isError} retry={() => void refetch()} />;
}

// The full sync a newly granted installation needs is started by useRepositoryAccess inside the page, once per grant however many pages read the access check.
function InsightsRoute() {
  return (
    <ErrorBoundary>
      <React.Suspense fallback={<OverviewSkeleton controls />}>
        <Overview />
      </React.Suspense>
    </ErrorBoundary>
  );
}

// The tab title every route falls back to; a page that knows something more specific, such as a count, sets its own and wins. The words are the page headings the shell prints.
const titleKeys: Record<Destination, string> = { inbox: "shell.navInbox", prs: "shell.navPulls", repos: "shell.navRepos", insights: "shell.navInsights", settings: "followup.settings", about: "navAbout" };

function useRouteTitle() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const destination = destinationOf(pathname);
  const view = prViewFromPath(pathname);
  const parts = !destination ? [] : view && view !== "open" ? [t(prViewTitleKeys[view]), t(titleKeys.prs)] : [t(titleKeys[destination])];
  useDocumentTitle(parts, { fallback: true });
}

// The whole route table. Every route is wired to its final page file here, so a page can be rebuilt without touching the table.
export function AppRoutes() {
  useRouteTitle();
  return (
    <Routes>
      <Route path={paths.about} element={<About />} />
      <Route element={<Connected />}>
        <Route path={paths.inbox} element={<InboxPage />} />
        {/* One route with an optional segment rather than two, so moving between views keeps the page mounted and the list's previous rows on screen while the next view loads. */}
        <Route path={`${paths.prs}/:view?`} element={<PullRequestsPage />} />
        <Route path={paths.repos} element={<RepositoriesRoute />} />
        <Route path={paths.insights} element={<InsightsRoute />} />
        <Route path={paths.settings} element={<FollowUpSettings />} />
      </Route>
      <Route path="*" element={<Navigate to={paths.inbox} replace />} />
    </Routes>
  );
}
