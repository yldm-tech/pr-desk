import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChartColumn, FolderGit2, GitPullRequest, Inbox, Settings2, type LucideIcon } from "lucide-react";
import { cx } from "./ui-controls";
import type { Destination } from "./routes";

type Primary = "inbox" | "prs" | "repos" | "insights";

const items: { destination: Primary; icon: LucideIcon; nav: string; tab: string }[] = [
  { destination: "inbox", icon: Inbox, nav: "shell.navInbox", tab: "shell.tabInbox" },
  { destination: "prs", icon: GitPullRequest, nav: "shell.navPulls", tab: "shell.tabPulls" },
  { destination: "repos", icon: FolderGit2, nav: "shell.navRepos", tab: "shell.tabRepos" },
  { destination: "insights", icon: ChartColumn, nav: "shell.navInsights", tab: "shell.tabInsights" },
];

// The Inbox badge's number: action rows by role plus every follow-up, the same sum the server's listFollowUps counts and the Inbox's default view lists, so the badge, the Inbox heading and its groups always agree. followup-view.ts gains inboxSummary() with the same formula; this is the copy the shell carries until it can call that.
export function inboxBadgeTotal(counts: Record<string, number> | undefined): number | undefined {
  if (!counts) return undefined;
  return (counts.authored || 0) + (counts.reviewer || 0) + (counts.follow_up || 0);
}

// One set of links for both shells. Below `shell` it is the phone tab bar: fixed to the bottom edge, four equal columns, the short `tab*` label under the icon (beside it from `roomy`, and visually hidden on a landscape phone, where the bar is too short for it). From `shell` it is the sidebar list with the full `nav*` label. Only one of the two labels is ever displayed, so the link's accessible name is always the one on screen.
const linkClass = cx(
  "group/nav relative flex min-h-[var(--tabbar-h)] min-w-0 flex-col items-center justify-center gap-1 px-1 text-fg-muted no-underline transition-colors duration-[var(--dur-fast)] hover:text-fg aria-[current=page]:text-fg",
  // The active tab's accent bar sits on the tab bar's top edge.
  "before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-b-full before:bg-accent before:opacity-0 before:content-[''] aria-[current=page]:before:opacity-100",
  "roomy:flex-row roomy:gap-1.5",
  "shell:min-h-8 shell:justify-start shell:gap-2 shell:rounded-md shell:px-2 shell:text-body shell:before:hidden shell:hover:bg-bg-muted shell:aria-[current=page]:bg-bg-muted shell:aria-[current=page]:font-medium pointer-coarse:shell:min-h-11",
);

// The sidebar-only entries (Settings) share the sidebar half of the look.
export const sidebarLinkClass = "flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-body text-fg-muted no-underline transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted hover:text-fg aria-[current=page]:bg-bg-muted aria-[current=page]:font-medium aria-[current=page]:text-fg pointer-coarse:min-h-11";

export function ShellNav({ current, hrefFor, badge, badgeLoading }: { current: Destination | null; hrefFor: (destination: Destination) => string; badge: number | undefined; badgeLoading: boolean }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("mainNavigation")}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shell:static shell:mt-3 shell:grid-cols-1 shell:gap-0.5 shell:border-t-0 shell:bg-transparent shell:p-0"
    >
      {items.map(({ destination, icon: Icon, nav, tab }) => {
        const active = current === destination;
        return (
          <Link key={destination} to={hrefFor(destination)} aria-current={active ? "page" : undefined} title={t(nav)} className={linkClass}>
            {/* From `shell` the wrapper dissolves (display: contents), so the badge becomes a direct item of the row and can sit at its far end; below it, the badge is pinned to the icon's corner. */}
            <span className="relative inline-flex shrink-0 shell:contents">
              <Icon size={20} aria-hidden="true" className="shrink-0 shell:size-4 shell:text-fg-subtle shell:group-aria-[current=page]/nav:text-fg" />
              {destination === "inbox" && (
                <b
                  data-testid="nav-badge"
                  style={{ visibility: badgeLoading ? "hidden" : undefined }}
                  aria-hidden={badgeLoading || undefined}
                  className="absolute -top-1.5 left-3.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[length:0.6875rem] leading-none font-semibold text-accent-fg tabular-nums ring-2 ring-bg shell:static shell:order-last shell:ml-auto shell:h-5 shell:min-w-5 shell:bg-accent-subtle shell:px-1.5 shell:text-caption shell:font-medium shell:text-accent-text shell:ring-0"
                >
                  {/* The count is unbounded and the badge sits beside a label that already has no room to spare, so four digits are spelled as three. */}
                  {badge === undefined ? "—" : badge > 99 ? "99+" : badge}
                </b>
              )}
            </span>
            <span className="hidden min-w-0 truncate shell:block">{t(nav)}</span>
            <span className="max-w-full truncate text-[length:0.6875rem] leading-tight font-medium roomy:text-small short:sr-only shell:hidden">{t(tab)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsLink({ current, to }: { current: Destination | null; to: string }) {
  const { t } = useTranslation();
  return (
    <Link to={to} aria-current={current === "settings" ? "page" : undefined} title={t("followup.settings")} className={sidebarLinkClass}>
      <Settings2 size={16} aria-hidden="true" className="shrink-0 text-fg-subtle" />
      <span className="min-w-0 truncate">{t("followup.settings")}</span>
    </Link>
  );
}
