import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Command } from "cmdk";
import { Building2, ChartColumn, Check, FolderGit2, GitPullRequest, Inbox, Info, Keyboard, Languages, LoaderCircle, Monitor, Moon, RefreshCw, RotateCw, Search, Settings2, Sun, type LucideIcon } from "lucide-react";
import { apiURL } from "./api-url";
import { resources } from "./i18n";
import { openInstallPopup } from "./github-access";
import { hardReload } from "./service-worker";
import { INSTALLED, iosStandalone } from "./HardRefresh";
import { groupOf, reasonTone, type FollowUp } from "./followup-view";
import { useAuth, useFollowUps, useSyncMutation, useSyncPending } from "./queries";
import { paths, prViewPath, prViews, prViewTitleKeys, type Destination } from "./routes";
import { overlays, useShortcut } from "./shortcuts";
import { useTheme, type ThemePref } from "./theme";
import type { GlyphKind, Tone } from "./tone";
import { cx, Kbd } from "./ui-controls";
import { StateGlyph } from "./ui-display";
import { Sheet } from "./ui-overlay";

// The second key of each `g` sequence and where it goes. `n` is Insights because `i` is taken by the Inbox, the destination people reach for most.
const goKeys: Record<string, Destination> = { i: "inbox", p: "prs", r: "repos", n: "insights", s: "settings" };

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// The palette's own registration point: ⌘K / Ctrl K toggles it (inside text fields too, which is what makes it reachable from a focused search box), and the `g` sequences jump between destinations. Both are bound here rather than in the shell so the shell never carries keyboard logic of its own. The dialog itself mounts only while open, so every opening starts from an empty query and a fresh selection.
export function CommandPalette() {
  const open = overlays.usePaletteOpen();
  const navigate = useNavigate();
  useShortcut(
    "mod+k",
    () => {
      if (open) return overlays.closePalette();
      overlays.closeShortcuts();
      overlays.openPalette();
    },
    { allowInInputs: true },
  );
  useShortcut(
    Object.keys(goKeys).map((key) => `g ${key}`),
    (event) => {
      const destination = goKeys[event.key];
      if (!destination) return false;
      void navigate(paths[destination]);
    },
  );
  return open ? <PaletteDialog /> : null;
}

type Entry = { id: string; label: string; context?: string; keywords?: string; icon: LucideIcon; keys?: string[]; current?: boolean; disabled?: boolean; run: () => void };

// Every whitespace-separated word must appear somewhere in the entry, case-insensitively. Deliberately plain substring matching rather than cmdk's fuzzy score: "#35" has to find pull request #35 and nothing that merely contains a 3 and a 5, and the results keep the order the groups are written in, so the same query always puts the same row first.
const matcher = (query: string) => {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (haystack: string) => {
    const text = haystack.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
};

// The glyph a follow-up row carries in the Inbox, reduced to what fits a one-line result: blocked beats everything that is still open, then the row's group.
function followUpGlyph(item: FollowUp, now: number): { tone: Tone; kind: GlyphKind } {
  const group = groupOf(item, now);
  if (group === "archived") return { tone: "neutral", kind: item.pr.merged_at ? "merged" : "closed" };
  if (group === "draft") return { tone: "neutral", kind: "draft" };
  if (group === "muted") return { tone: "neutral", kind: "muted" };
  if (item.reasons.some((reason) => reasonTone(reason) === "blocked")) return { tone: "blocked", kind: "blocked" };
  return group === "action" ? { tone: "action", kind: "action" } : { tone: "waiting", kind: "waiting" };
}

// Which Inbox view actually shows the row, so `focus` lands on a row that is on screen: the default view holds only what needs doing, and muted and archived rows each live behind their own status.
function focusPath(item: FollowUp, now: number): string {
  const group = groupOf(item, now);
  const status = group === "action" || group === "follow_up" ? null : group === "muted" ? "muted" : group === "archived" ? "archived" : "all";
  return `${paths.inbox}?${status ? `status=${status}&` : ""}focus=${item.id}`;
}

const FOLLOW_UP_LIMIT = 8;
const PR_QUERY_MAX = 120;

const itemClass = "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-body text-fg outline-none select-none data-[selected=true]:bg-bg-muted data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 pointer-coarse:min-h-11";
const groupClass = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle first:[&_[cmdk-group-heading]]:pt-0";

function Row({ entry, coarse, currentLabel }: { entry: Entry; coarse: boolean; currentLabel: string }) {
  const Icon = entry.icon;
  return (
    <Command.Item value={entry.id} disabled={entry.disabled} onSelect={entry.run} className={itemClass}>
      <Icon size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
        {entry.context && <span className="text-fg-muted">{entry.context}</span>}
        {entry.context && (
          <span aria-hidden="true" className="text-fg-subtle">
            ›
          </span>
        )}
        <span className="min-w-0 [overflow-wrap:anywhere]">{entry.label}</span>
        {entry.current && <span className="sr-only">{currentLabel}</span>}
      </span>
      {entry.current && <Check size={16} aria-hidden="true" className="shrink-0 text-accent-text" />}
      {entry.keys && !coarse && (
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          {entry.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}

function PaletteDialog() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const auth = useAuth();
  const connected = !!auth.data?.connected;
  const followUps = useFollowUps(connected);
  const sync = useSyncMutation();
  const syncing = useSyncPending();
  const theme = useTheme();
  // Only an installed window gets "Reload the app", the same display modes HardRefresh.tsx answers to, because a browser tab already has a reload button.
  const installed = useMediaQuery(INSTALLED) || iosStandalone();
  const coarse = useMediaQuery("(pointer: coarse)");
  // The Sheet opens the <dialog> in its own effect, which runs before this one; focusing here puts the caret in the query field rather than on the close button, while the Sheet still remembers the real opener to return focus to.
  useEffect(() => input.current?.focus(), []);

  const close = overlays.closePalette;
  // Closing and acting in one event, so the dialog's return of focus to the opener happens in the same commit and before whatever the action focuses next (the Inbox row a `focus` link scrolls to).
  const act = (run: () => void) => () => {
    close();
    run();
  };
  const go = (to: string) => act(() => void navigate(to));
  const matches = matcher(query);
  const trimmed = query.trim();

  const goTo: Entry[] = [
    { id: "go-inbox", label: t("palette.inbox"), icon: Inbox, keys: ["g", "i"], run: go(paths.inbox) },
    ...prViews.map((view): Entry => ({ id: `go-prs-${view}`, context: t("palette.pulls"), label: t(prViewTitleKeys[view]), icon: GitPullRequest, keys: view === "open" ? ["g", "p"] : undefined, run: go(prViewPath(view)) })),
    { id: "go-repos", label: t("palette.repos"), icon: FolderGit2, keys: ["g", "r"], run: go(paths.repos) },
    { id: "go-insights", label: t("palette.insights"), icon: ChartColumn, keys: ["g", "n"], run: go(paths.insights) },
    ...[
      { tab: "", label: t("followup.tabSchedule") },
      { tab: "notifications", label: t("followup.tabNotifications") },
      { tab: "github", label: t("settings.tabGitHub") },
      { tab: "access", label: t("followup.tabAccess") },
    ].map(({ tab, label }): Entry => ({ id: `go-settings-${tab || "reminders"}`, context: t("palette.settings"), label, icon: Settings2, keys: tab ? undefined : ["g", "s"], run: go(tab ? `${paths.settings}?tab=${tab}` : paths.settings) })),
    { id: "go-about", label: t("palette.about"), icon: Info, run: go(paths.about) },
  ].filter((entry) => connected || entry.id === "go-about");

  const themes: { pref: ThemePref; label: string; icon: LucideIcon }[] = [
    { pref: "system", label: t("palette.themeSystem"), icon: Monitor },
    { pref: "light", label: t("palette.themeLight"), icon: Sun },
    { pref: "dark", label: t("palette.themeDark"), icon: Moon },
  ];
  // The language names each option under its own name, which is how a reader finds their language in an interface they cannot read, and keeps the name in the current language as a search keyword ("japanese" finds 日本語).
  const names = new Intl.DisplayNames([i18n.resolvedLanguage || "en"], { type: "language" });
  const actions: Entry[] = [
    ...(connected ? [{ id: "sync", label: syncing ? t("syncing") : t("sync"), icon: syncing ? LoaderCircle : RefreshCw, disabled: syncing, run: act(() => sync.mutate()) }] : []),
    ...themes.map(({ pref, label, icon }): Entry => ({ id: `theme-${pref}`, context: t("palette.theme"), label, icon, current: theme.pref === pref, run: act(() => theme.setPref(pref)) })),
    ...Object.keys(resources).map((code): Entry => ({ id: `language-${code.toLowerCase()}`, context: t("language"), label: t("nativeName", { lng: code }), keywords: `${code} ${names.of(code) ?? ""}`, icon: Languages, current: (i18n.resolvedLanguage || "en") === code, run: act(() => void i18n.changeLanguage(code)) })),
    ...(connected ? [{ id: "install", label: t("palette.installApp"), icon: Building2, run: act(openInstall) }] : []),
    ...(installed ? [{ id: "reload", label: t("hardRefresh"), icon: RotateCw, run: act(() => void hardReload()) }] : []),
    { id: "shortcuts", label: t("palette.shortcuts"), icon: Keyboard, keys: ["?"], run: act(overlays.openShortcuts) },
  ];

  const visible = (entries: Entry[]) => entries.filter((entry) => matches(`${entry.context ?? ""} ${entry.label} ${entry.keywords ?? ""}`));
  const shownGoTo = visible(goTo);
  const shownActions = visible(actions);
  const now = Date.now();
  const foundFollowUps = trimmed && followUps.data ? followUps.data.data.filter((item) => matches(`${item.pr.repo} #${item.pr.number} ${item.pr.title}`)) : [];
  const shownFollowUps = foundFollowUps.slice(0, FOLLOW_UP_LIMIT);
  const prQuery = trimmed.slice(0, PR_QUERY_MAX);
  const searchPRs = connected && prQuery !== "";
  // "Nothing" means nothing local: the pull request search is offered for any query, as the fallback for text that names no page, action or follow-up.
  const nothing = trimmed !== "" && !shownGoTo.length && !shownActions.length && !shownFollowUps.length;
  // The selection is held here rather than left to cmdk, which with its own filtering switched off keeps pointing at an option the new query has just removed, so Enter did nothing. A query change clears it and the first visible option takes over, in the order the groups are drawn.
  const ids = [...shownGoTo.map((entry) => entry.id), ...shownFollowUps.map((item) => `follow-up-${item.id}`), ...shownActions.filter((entry) => !entry.disabled).map((entry) => entry.id), ...(searchPRs ? ["search-prs"] : [])];
  const value = ids.includes(selected) ? selected : (ids[0] ?? "");

  // Said once, above the results, only while a query could have matched a follow-up: what is missing from the list and why.
  let note: ReactNode = null;
  if (connected && trimmed) {
    if (followUps.isError && !followUps.data) note = <p className="text-tone-action">{t("palette.followUpsUnavailable")}</p>;
    else if (followUps.data && !followUps.data.baseline_complete) note = <p>{t("palette.followUpsPartial")}</p>;
  }

  return (
    <Command label={t("palette.inputLabel")} shouldFilter={false} loop value={value} onValueChange={setSelected} className="contents">
      <Sheet
        open
        onClose={close}
        side="center"
        labelledBy={titleId}
        closeLabel={t("close")}
        className="shell:mt-[max(48px,12dvh)]"
        header={
          <div className="flex min-h-8 items-center gap-2">
            <h2 id={titleId} className="sr-only">
              {t("palette.title")}
            </h2>
            <Search size={16} aria-hidden="true" className="shrink-0 text-fg-subtle" />
            <Command.Input
              ref={input}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setSelected("");
              }}
              placeholder={t("palette.placeholder")}
              className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none pointer-coarse:text-[length:1rem]"
            />
          </div>
        }
        footer={
          coarse ? undefined : (
            <p aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                {t("palette.hintMove")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Enter</Kbd>
                {t("palette.hintSelect")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
                {t("palette.hintClose")}
              </span>
            </p>
          )
        }
      >
        {note && (
          <div role="status" className="mb-3 rounded-md bg-bg-subtle px-3 py-2 text-caption text-fg-muted">
            {note}
          </div>
        )}
        {nothing && (
          <p role="status" className="px-2 py-8 text-center text-body text-fg-muted">
            {t("palette.empty", { query: trimmed })}
          </p>
        )}
        <Command.List className="-mx-2 shell:min-h-64">
          {shownGoTo.length > 0 && (
            <Command.Group heading={t("palette.groupGoTo")} className={groupClass}>
              {shownGoTo.map((entry) => (
                <Row key={entry.id} entry={entry} coarse={coarse} currentLabel={t("palette.current")} />
              ))}
            </Command.Group>
          )}
          {connected && trimmed && followUps.isPending && <Command.Loading className="px-2 py-2 text-caption text-fg-muted">{t("palette.loadingFollowUps")}</Command.Loading>}
          {shownFollowUps.length > 0 && (
            <Command.Group heading={t("palette.groupFollowUps")} className={cx(groupClass, "mt-2")}>
              {shownFollowUps.map((item) => {
                const glyph = followUpGlyph(item, now);
                return (
                  <Command.Item key={item.id} value={`follow-up-${item.id}`} onSelect={go(focusPath(item, now))} className={itemClass}>
                    <StateGlyph tone={glyph.tone} kind={glyph.kind} unread={item.unread} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cx("truncate", item.unread && "font-semibold")}>{item.pr.title}</span>
                      <span className="truncate text-caption text-fg-muted">
                        {item.pr.repo} <span className="tabular-nums">#{item.pr.number}</span>
                      </span>
                    </span>
                    {item.unread && <span className="sr-only">{t("followup.unread")}</span>}
                  </Command.Item>
                );
              })}
              {foundFollowUps.length > shownFollowUps.length && <p className="px-2 pt-1 pb-2 text-caption text-fg-subtle">{t("palette.moreFollowUps", { count: foundFollowUps.length - shownFollowUps.length })}</p>}
            </Command.Group>
          )}
          {shownActions.length > 0 && (
            <Command.Group heading={t("palette.groupActions")} className={cx(groupClass, "mt-2")}>
              {shownActions.map((entry) => (
                <Row key={entry.id} entry={entry} coarse={coarse} currentLabel={t("palette.current")} />
              ))}
            </Command.Group>
          )}
          {searchPRs && (
            <Command.Group heading={t("palette.groupPulls")} className={cx(groupClass, "mt-2")}>
              <Command.Item value="search-prs" onSelect={go(`${paths.prs}?${new URLSearchParams({ q: prQuery })}`)} className={itemClass}>
                <Search size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("palette.searchPulls", { query: prQuery })}</span>
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Sheet>
    </Command>
  );
}

// The install page as the sidebar link opens it: a centred popup where the browser allows one, a new tab where it does not. openInstallPopup reads its decision off a click on a link, so the palette gives it one, on a detached anchor whose default action (the new tab) is what happens if the popup is refused.
function openInstall() {
  const link = document.createElement("a");
  link.href = apiURL + "/api/v1/repository-access/install";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.addEventListener("click", (event) => openInstallPopup(event as unknown as MouseEvent<HTMLAnchorElement>, link.href));
  link.click();
}

export default CommandPalette;
