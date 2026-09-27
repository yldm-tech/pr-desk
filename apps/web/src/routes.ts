// The route table as data, so the shell, the pages, the palette and the legacy redirects all read the same answer to "where is this" and none of them keeps its own copy of a path string. Pure on purpose: routes.test.mjs pins every mapping without a router.

export type PRView = "open" | "review-requested" | "changes-requested" | "approved" | "blocked" | "merged";
// The filter names pr-model's listParameters already switches on. They stay the keys of the request builder so moving the list onto /prs/:view changes the address and nothing about what is asked of the API.
export type PRFilter = "All" | "Review requested" | "Changes requested" | "Approved" | "Blocked" | "Merged";
export type Destination = "inbox" | "prs" | "repos" | "insights" | "settings" | "about";

export const prViews: readonly PRView[] = ["open", "review-requested", "changes-requested", "approved", "blocked", "merged"];

export const paths = { inbox: "/inbox", prs: "/prs", repos: "/repos", insights: "/insights", settings: "/settings", about: "/about" } as const;

const filters: Record<PRView, PRFilter> = { open: "All", "review-requested": "Review requested", "changes-requested": "Changes requested", approved: "Approved", blocked: "Blocked", merged: "Merged" };

// The heading names the scope the list actually has, which is the scope of the pill that is pressed. One heading for six routes meant "My pull requests" sat over an open-and-unmerged list, so searching for a pull request you had already landed returned an empty state whose only offer was to clear the filters — when the answer was that it is not open. These are the pill labels themselves, so the heading and the pressed control cannot drift apart; `navAll` stays as the name of the sidebar entry that leads here.
export const prViewTitleKeys: Record<PRView, string> = { open: "open", "review-requested": "reviewRequested", "changes-requested": "changesRequested", approved: "approved", blocked: "blocked", merged: "merged" };

export function prViewPath(view: PRView): string {
  return view === "open" ? paths.prs : `${paths.prs}/${view}`;
}

// `open` has no segment of its own: /prs is the open view, so /prs/open would be a second address for the same list and is treated as unknown.
export function prViewFromPath(pathname: string): PRView | null {
  if (pathname === paths.prs) return "open";
  if (!pathname.startsWith(paths.prs + "/")) return null;
  const segment = pathname.slice(paths.prs.length + 1);
  return segment !== "open" && (prViews as readonly string[]).includes(segment) ? (segment as PRView) : null;
}

export function prFilterOf(view: PRView): PRFilter {
  return filters[view];
}

export function destinationOf(pathname: string): Destination | null {
  if (prViewFromPath(pathname)) return "prs";
  for (const destination of ["inbox", "repos", "insights", "settings", "about"] as const) if (pathname === paths[destination]) return destination;
  return null;
}

// The query parameters the old landing route read for its contribution overview. A bookmarked `#/?repo=x` was a trend-chart link, so its presence decides that `/` meant Insights rather than the new home.
const overviewParams = ["year", "visibility", "repo"];
// The five PR views used to be top-level routes of their own.
const legacyViews: readonly string[] = ["review-requested", "changes-requested", "approved", "blocked", "merged"];

// Where an address that is not canonical belongs, or null when it already is. Every rewrite keeps the query string, because push notifications and digests link to `#/attention?focus=<id>` (apps/api/notifications.go) and that contract is permanent. An unknown path drops its query, the same way the old catch-all did: the parameters of a route that does not exist mean nothing on the one it lands on.
export function legacyRedirect(pathname: string, search: string): { pathname: string; search: string } | null {
  if (destinationOf(pathname)) {
    if (pathname !== paths.settings) return null;
    const params = new URLSearchParams(search);
    // The first settings tab used to be addressable as `tab=schedule`; it is the default tab now and carries no parameter.
    if (params.get("tab") !== "schedule") return null;
    params.delete("tab");
    const rest = params.toString();
    return { pathname: paths.settings, search: rest ? "?" + rest : "" };
  }
  if (pathname === "/") {
    const params = new URLSearchParams(search);
    return { pathname: overviewParams.some((key) => params.has(key)) ? paths.insights : paths.inbox, search };
  }
  if (pathname === "/attention") return { pathname: paths.inbox, search };
  if (pathname === "/pull-requests") return { pathname: paths.prs, search };
  if (pathname === "/repositories") return { pathname: paths.repos, search };
  const segment = pathname.slice(1);
  if (legacyViews.includes(segment)) return { pathname: `${paths.prs}/${segment}`, search };
  // An unknown view keeps the list's own search and repository parameters: the reader asked for pull requests, just not a view that exists.
  if (pathname.startsWith(paths.prs + "/")) return { pathname: paths.prs, search };
  return { pathname: paths.inbox, search: "" };
}
