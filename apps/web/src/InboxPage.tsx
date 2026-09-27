import { AnimatePresence } from "motion/react";
import { Check, Inbox, ListFilter, PanelRight, Search, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DetailPane } from "./DetailPane";
import { useDetail } from "./detail-context";
import { groupItems, inboxRoles, inboxStatuses, inboxSummary, isMuted, matchesReady, matchesStatus, primaryAction, reasonTone, stableOrder, type FollowUp, type FollowUpGroup, type InboxRole } from "./followup-view";
import { InboxRow, type RowCommands, type RowReport } from "./InboxRow";
import { InboxSummary } from "./InboxSummary";
import { ItemRowSkeleton, SummarySkeleton } from "./LoadingSkeleton";
import { useMediaQuery } from "./media-query";
import { useDocumentTitle } from "./page-title";
import { prGitHubURL } from "./pr-model";
import { useFollowUps } from "./queries";
import { useShortcut } from "./shortcuts";
import { useReminderSettings } from "./SnoozePopover";
import { SplitView, useSplitMode } from "./SplitView";
import { showToast } from "./toast";
import { useUndoSlot } from "./undo-slot";
import { REVEAL_SEARCH_EVENT } from "./shortcuts";
import { Button, cx, IconButton, Kbd, LinkButton, SearchField, SegmentedControl, Select } from "./ui-controls";
import { EmptyState, ErrorState, FilterChip, Notice, PageHeader, StaleNotice, Toolbar } from "./ui-display";
import { Popover } from "./ui-overlay";
import { ItemList, ListSection } from "./ui-list";

const DAY = 86400000;
// How long a deep-linked or refreshed row stays highlighted: the length of the highlight animation in style.css, plus a frame.
const HIGHLIGHT_MS = 1300;
// How long the cursor has to rest on a row before the pane loads its activity, so walking the list with j/k does not fire a request per row.
const PANE_DEBOUNCE_MS = 150;

// Oldest first, everywhere the reader chooses nothing. `groupItems` re-buckets whatever order reaches it, so inside one group this is the only order anyone wants and it needs no control.
const waitingAt = (item: FollowUp) => {
  const value = Date.parse(item.waiting_since);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
};

// The pane's id, for the Show activity buttons that fill it in the split view.
const PANE_ID = "inbox-detail";

const detailTarget = (item: FollowUp) => ({ pr: { id: item.pr.id, repo: item.pr.repo, number: item.pr.number, title: item.pr.title, url: item.pr.url, comments: item.pr.comments_count }, followUp: item });

// The home screen: what needs you now, and the verbs to clear it without leaving the page. Every filter is local and lives in the URL (role, status, repo, merged, tone, ready, q, focus), so a bookmark, a push notification's ?focus= link and the navigation memory all reopen exactly this view. On a wide screen the list sits beside the detail of the row under the cursor; elsewhere the detail opens as a sheet.
export function InboxPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const query = useFollowUps();
  const settings = useReminderSettings();
  const detail = useDetail();
  const undo = useUndoSlot();
  // Whether the primary pointer is coarse (touch). On touch there is no cursor to earn the primary style, so the first row of each group takes it instead.
  const coarse = useMediaQuery("(pointer: coarse)");
  const splitRef = useRef<HTMLDivElement>(null);
  const split = useSplitMode(splitRef);
  const region = useRef<HTMLElement>(null);
  const now = new Date();
  const nowMs = now.getTime();

  const role = (inboxRoles as readonly string[]).includes(params.get("role") ?? "") ? (params.get("role") as InboxRole) : "all";
  // `todo` is the default because it is exactly what the nav badge counts.
  const status = (inboxStatuses as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as string) : "todo";
  const repo = params.get("repo") || "";
  const merged = params.get("merged") || "";
  const focus = params.get("focus") || "";
  const tone = params.get("tone") || "";
  const ready = params.get("ready") || "";
  const q = params.get("q") || "";

  // Choosing a filter here drops the ones that were only ever arrived at by a link (focus, merged, tone, ready): leaving them behind meant switching the status to "All" and still reading a list quietly narrowed to two rows.
  const change = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      for (const linked of ["focus", "merged", "tone", "ready"]) next.delete(linked);
      return next;
    });
  const clearParam = (key: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      return next;
    });
  // Typing narrows the list on every keystroke, so it replaces the history entry rather than leaving one per letter.
  const setSearch = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
  const showAll = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["role", "repo", "merged", "focus", "tone", "ready", "q"]) next.delete(key);
      next.set("status", "all");
      return next;
    });

  const data = query.data;
  const summary = data ? inboxSummary(data.data, data.counts, now) : undefined;
  useDocumentTitle([summary ? `${t("inbox.title")} (${summary.total})` : t("inbox.title")]);

  const needle = q.trim().toLowerCase();
  const filtered = (data?.data ?? []).filter(
    (item) =>
      (role === "all" || item.role === role) &&
      (!repo || item.pr.repo === repo) &&
      matchesStatus(item, status, nowMs) &&
      (!merged || (!!item.pr.merged_at && !!item.archived_at && new Date(item.archived_at).getTime() > nowMs - 7 * DAY)) &&
      (!tone || item.reasons.some((reason) => reasonTone(reason) === tone)) &&
      (!ready || matchesReady(item, now)) &&
      (!needle || item.pr.repo.toLowerCase().includes(needle) || item.pr.title.toLowerCase().includes(needle) || `#${item.pr.number}`.includes(needle)),
  );
  filtered.sort((a, b) => waitingAt(a) - waitingAt(b));
  // The order the reader is working in, held still while they work through it: a background poll or the refetch after their own action re-sorts the server's answer, and a row should only move when the reader moves it. New rows are appended.
  const filterKey = [role, status, repo, merged, needle, tone, ready].join("\u0000");
  const frozen = useRef<{ key: string; order: number[] }>({ key: "", order: [] });
  if (frozen.current.key !== filterKey) frozen.current = { key: filterKey, order: [] };
  if (frozen.current.order.length === 0 && filtered.length > 0) frozen.current.order = filtered.map((item) => item.id);
  const { items, added } = stableOrder(filtered, frozen.current.order);
  if (added.length) frozen.current.order = [...frozen.current.order, ...added];
  const groups = groupItems(items, nowMs);
  const ids = items.map((item) => item.id).join(",");

  // The keyboard cursor. It follows focus (a click or Tab onto a row moves it) and resets when the filter combination changes, because the row it pointed at may not be in the new list.
  const [cursor, setCursor] = useState<number | null>(null);
  const [mutedOpen, setMutedOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const cursorKey = useRef(filterKey);
  useEffect(() => {
    if (cursorKey.current === filterKey) return;
    cursorKey.current = filterKey;
    setCursor(null);
  }, [filterKey]);
  useEffect(() => {
    if (highlight === null) return;
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  // The rows the cursor can reach, in the order they are drawn: muted rows only while their disclosure is open, because focus() on a row inside a closed <details> does nothing and the cursor would simply vanish.
  const walk = groups.flatMap(({ group, items: rows }) => (group === "muted" && !mutedOpen ? [] : rows.map((item) => item.id)));
  const cursorItem = cursor === null ? undefined : items.find((item) => item.id === cursor);

  // What the keys drive on a row, registered by each row so the key and the button take the same path.
  const registry = useRef(new Map<number, RowCommands>());
  const register = useCallback((id: number, commands: RowCommands | null) => {
    if (commands) registry.current.set(id, commands);
    else registry.current.delete(id);
  }, []);
  // `read` is posted only on an explicit request to see a row (a click on its body or title, Enter, Show activity), never for moving the cursor or arriving from a link, and at most once per row while the page is open.
  const claimed = useRef(new Set<number>());
  // A claim lasts until the row is seen read: when new activity makes it unread again, opening it is a fresh request to read and posts again.
  useEffect(() => {
    for (const item of query.data?.data ?? []) if (!item.unread) claimed.current.delete(item.id);
  }, [query.data]);
  // Said once on an explicit open in the split view, where the pane beside the list changes and focus stays on the row: nothing else would tell a screen-reader user that anything happened. Walking with j/k is not an explicit open and says nothing.
  const [paneNews, setPaneNews] = useState("");
  const claimRead = (item: FollowUp) => {
    if (!item.unread || claimed.current.has(item.id)) return;
    claimed.current.add(item.id);
    registry.current.get(item.id)?.run({ action: "read" }, { quiet: true });
  };
  const openItem = (item: FollowUp, opener: HTMLElement) => {
    if (split) {
      setCursor(item.id);
      claimRead(item);
      setPaneNews(t("inbox.showingActivity", { title: item.pr.title }) + (paneNews.endsWith(" ") ? "" : " "));
      return;
    }
    // The sheet marks the row read itself when it opens, so the row does not post a second one.
    claimed.current.add(item.id);
    detail.open(detailTarget(item), opener);
  };

  // The pane follows the cursor, a beat behind it, so walking the list does not load every row's activity on the way.
  const [paneId, setPaneId] = useState<number | null>(null);
  useEffect(() => {
    // No cursor, no detail: Esc, a new filter or an emptied list put the pane back to its prompt rather than leaving a row the list no longer points at.
    if (cursor === null) {
      setPaneId(null);
      return;
    }
    if (paneId === null) {
      setPaneId(cursor);
      return;
    }
    const timer = window.setTimeout(() => setPaneId(cursor), PANE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [cursor, paneId]);
  const paneItem = paneId === null ? undefined : data?.data.find((item) => item.id === paneId);

  // Which row holds focus, tracked as it happens: WebKit does not focus a button on click, so "is the body focused" after an action cannot tell a keyboard user from a tap.
  const focusedRow = useRef<number | null>(null);
  const noteFocus = (event: FocusEvent<HTMLElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-testid='follow-up-card']");
    const id = row ? Number(row.id.slice("followup-".length)) : null;
    focusedRow.current = id;
    if (id !== null) setCursor(id);
  };
  // When the row that held focus leaves the list, focus moves to the row that took its index, or to the list itself when none is left, so clearing a queue is one row after another rather than a trip back through the toolbar.
  const previousIds = useRef<number[]>([]);
  useEffect(() => {
    const held = focusedRow.current;
    if (held !== null && !items.some((item) => item.id === held)) {
      const index = previousIds.current.indexOf(held);
      const successor = items.length ? items[Math.min(Math.max(index, 0), items.length - 1)] : undefined;
      // The row, not its first button: every row's controls are disabled while the refetch settles, and focus() on a disabled button is silently dropped.
      const target = successor ? document.getElementById(`followup-${successor.id}`) : null;
      (target ?? region.current)?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
      focusedRow.current = successor ? successor.id : null;
      setCursor(successor ? successor.id : null);
    }
    previousIds.current = items.map((item) => item.id);
  }, [ids, items]);
  // ?focus=<id> (every push notification links here): scroll to the row once, make it the cursor and flash it. It is not a request to read it.
  const arrived = useRef("");
  useEffect(() => {
    if (!focus || arrived.current === focus) return;
    const row = document.getElementById(`followup-${focus}`);
    if (!row) return;
    arrived.current = focus;
    row.scrollIntoView({ block: "center" });
    setCursor(Number(focus));
    setHighlight(Number(focus));
  }, [focus, ids]);

  const report = (result: RowReport) => {
    const slot = result.undo;
    if (slot) undo.set(slot);
    showToast({ text: result.text, tone: result.tone, undo: slot ? { label: t("followup.undo"), name: t("followup.undoFor", { action: slot.action, repo: slot.repo, number: slot.number }), run: () => void undo.run(slot), target: slot } : undefined });
  };
  const showLatest = (item: FollowUp) => {
    void query.refetch();
    setCursor(item.id);
    setHighlight(item.id);
  };

  const moveTo = (id: number) => {
    setCursor(id);
    const row = document.getElementById(`followup-${id}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };
  useShortcut(["j", "k", "Enter", " ", "o", "Escape", "e", "s", "r", "u", "z"], (event) => {
    const key = event.key;
    if (key === "z") {
      if (!undo.target) return false;
      void undo.run();
      return;
    }
    if (key === "j" || key === "k") {
      if (!walk.length) return false;
      const index = cursor === null ? -1 : walk.indexOf(cursor);
      moveTo(walk[Math.min(Math.max(index + (key === "j" ? 1 : -1), 0), walk.length - 1)] ?? walk[0]);
      return;
    }
    if (key === "Escape") {
      if (cursor === null) return false;
      setCursor(null);
      return;
    }
    if (!cursorItem) return false;
    const target = event.target as HTMLElement | null;
    // Enter and Space on a focused button or link are that control's.
    if ((key === "Enter" || key === " ") && target?.closest("a,button,summary,[role=button]")) return false;
    const commands = registry.current.get(cursorItem.id);
    const verbs = primaryAction(cursorItem, now);
    const offered = [verbs.primary, ...verbs.secondary];
    if (key === "Enter" || key === " ") {
      const row = document.getElementById(`followup-${cursorItem.id}`);
      if (row) openItem(cursorItem, row);
    } else if (key === "o") window.open(prGitHubURL(cursorItem.pr), "_blank", "noopener,noreferrer");
    else if (!commands || commands.busy()) return;
    else if (key === "e") {
      if (offered.includes("handled")) commands.run({ action: "handled" });
      else showToast({ text: t("followup.blockedByGitHub"), tone: "success" });
    } else if (key === "s" && offered.includes("snooze")) commands.openSnooze();
    else if (key === "r" && verbs.markRead) commands.run({ action: "read" });
    else if (key === "u" && offered.includes("unsnooze")) commands.run({ action: "unsnooze" });
    else return false;
  });

  // Days until a waiting row becomes overdue, by the same rule the server applies: the repository's own waiting period, or the default one.
  const overdueIn = (item: FollowUp, group: FollowUpGroup) => {
    if (group !== "waiting" || !settings.data) return undefined;
    const started = Date.parse(item.waiting_since);
    if (Number.isNaN(started)) return undefined;
    const days = settings.data.repository_days?.[item.pr.repo] ?? settings.data.wait_days;
    const due = started + days * DAY;
    return due > nowMs ? Math.ceil((due - nowMs) / DAY) : undefined;
  };

  const narrowed = role !== "all" || !!repo || !!merged || !!needle || !!tone || !!ready || (status !== "todo" && status !== "all");
  const toneLabel = tone === "blocked" ? t("followup.blockedPushCount") : t(`followup.${tone}`, { defaultValue: tone });
  const waitingCount = (data?.data ?? []).filter((item) => item.state === "waiting" && !isMuted(item, nowMs)).length;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", month: "short", day: "numeric" }).format(now);
  const reminderSettings = settings.data ? { timezone: settings.data.timezone, digest_time: settings.data.digest_time } : undefined;

  const statusOptions = inboxStatuses.map((value) => ({ value, label: t(`followup.${value}`) }));
  const statusName = statusOptions.find((option) => option.value === status)?.label ?? status;
  const chooseStatus = (value: string) => change("status", value === "todo" ? "" : value);
  const [statusOpen, setStatusOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const focusSearch = useRef(false);
  const revealSearch = () => {
    focusSearch.current = true;
    setSearchOpen(true);
  };
  useEffect(() => {
    if (!searchOpen || !focusSearch.current) return;
    focusSearch.current = false;
    document.getElementById("pr-search")?.focus();
  }, [searchOpen]);
  // The `/` key asks for the search field wherever it is; below `pair` it may be folded away, so the shell asks the page to open it first.
  useEffect(() => {
    const open = () => revealSearch();
    window.addEventListener(REVEAL_SEARCH_EVENT, open);
    return () => window.removeEventListener(REVEAL_SEARCH_EVENT, open);
  }, []);

  // What a search or a filter left in the list, said politely once typing pauses, so a screen-reader user hears that the list changed or emptied. Nothing is said for the default view, which the page heading already counts.
  const [resultNews, setResultNews] = useState("");
  const resultText = narrowed && data ? t("inbox.results", { count: items.length }) : "";
  useEffect(() => {
    const timer = window.setTimeout(() => setResultNews(resultText), 300);
    return () => window.clearTimeout(timer);
  }, [resultText]);

  const list = (() => {
    if (query.isPending)
      return (
        <div className="grid gap-6" aria-busy="true">
          {[0, 1].map((section) => (
            <div key={section} className="grid gap-1">
              <SummarySkeleton />
              <ItemRowSkeleton tracks="list" count={3} />
            </div>
          ))}
        </div>
      );
    if (query.isError && !data) return <ErrorState title={t("followup.unavailable")} error={query.error} onRetry={() => void query.refetch()} />;
    if (!groups.length) {
      if (narrowed)
        return (
          <EmptyState
            icon={Inbox}
            title={t("emptyResultsTitle")}
            description={t("followup.empty")}
            action={
              <Button variant="secondary" onClick={showAll}>
                {t("followup.showAll")}
              </Button>
            }
          />
        );
      // "All clear" would be a claim about PRs the first sync has not looked at yet.
      if (data && !data.baseline_complete) return <EmptyState icon={Inbox} title={t("inbox.inventoryEmpty")} description={t("inbox.inventoryEmptyHelp")} />;
      return (
        <EmptyState
          tone="success"
          title={t("caughtUp")}
          description={t("noActionNeeded")}
          secondary={
            waitingCount > 0 || (summary?.recentMerged ?? 0) > 0 ? (
              // Caught up is not the end of the road: what is still out with other people, and what shipped lately, are one step away.
              <span className="flex flex-wrap justify-center gap-1">
                {waitingCount > 0 && (
                  <LinkButton variant="ghost" size="sm" to="/inbox?status=waiting" className="text-accent-text">
                    {t("inbox.waitingOnOthers", { count: waitingCount })}
                  </LinkButton>
                )}
                {(summary?.recentMerged ?? 0) > 0 && (
                  <LinkButton variant="ghost" size="sm" to="/inbox?status=archived&merged=1" className="text-accent-text">
                    {t("inbox.recentMergedCount", { count: summary?.recentMerged ?? 0 })}
                  </LinkButton>
                )}
              </span>
            ) : undefined
          }
        />
      );
    }
    return (
      <section ref={region} tabIndex={-1} aria-label={t("followup.title")} aria-keyshortcuts="j k Enter e s r u o z" onFocus={noteFocus} className="grid min-w-0 gap-6 outline-none">
        <p className="sr-only">{t("inbox.shortcutsHint")}</p>
        {groups.map(({ group, items: rows }) => (
          <ListSection
            key={group}
            id={`inbox-${group}`}
            heading={t("followup.groupHeading", { label: t(`followup.${group}`), count: rows.length })}
            count={rows.length}
            collapsible={group === "muted"}
            open={group === "muted" ? mutedOpen : undefined}
            onToggle={group === "muted" ? setMutedOpen : undefined}
            note={group === "draft" && status === "draft" ? t("followup.draftHelp") : undefined}
          >
            <ItemList mode="list" containerName="list">
              <AnimatePresence initial={false}>
                {rows.map((item, index) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    group={group}
                    now={now}
                    split={split}
                    active={cursor === item.id}
                    highlight={highlight === item.id}
                    emphasis={cursor === item.id || (coarse && index === 0)}
                    showRole={role === "all"}
                    settings={reminderSettings}
                    overdueIn={overdueIn(item, group)}
                    onReport={report}
                    onOpen={openItem}
                    onTitleRead={claimRead}
                    onRepository={(value) => change("repo", value)}
                    onShowLatest={showLatest}
                    register={register}
                    controls={split ? PANE_ID : undefined}
                  />
                ))}
              </AnimatePresence>
            </ItemList>
          </ListSection>
        ))}
      </section>
    );
  })();

  const pane = (
    <div id={PANE_ID} className="min-w-0">
      {paneItem ? (
        <DetailPane target={detailTarget(paneItem)} mode="pane" />
      ) : (
        <section aria-label={t("inbox.detailLabel")} className="sticky top-4 grid min-h-[min(28rem,calc(100dvh-2rem))] place-items-center rounded-lg bg-bg-subtle">
          <EmptyState
            icon={PanelRight}
            title={t("inbox.selectPrompt")}
            secondary={
              <span className="inline-flex flex-wrap items-center justify-center gap-1 text-fg-muted">
                <Kbd>j</Kbd>
                <Kbd>k</Kbd> {t("inbox.hintMove")} · <Kbd>Enter</Kbd> {t("inbox.hintOpen")}
              </span>
            }
          />
        </section>
      )}
    </div>
  );

  // The search field is always there from `pair` up. Below it the header has no room for a fourth row of controls, so the field waits behind the search button in the title row and opens under the toolbar, focused; it stays open while it holds a query.
  const searchShown = searchOpen || !!q;
  return (
    // Below `pair` every gap is a step tighter, so on a phone the first row is in view under the header without scrolling.
    <div className="grid min-w-0 gap-4 @max-pair/dashboard:gap-3">
      <PageHeader
        title={t("inbox.title")}
        count={summary?.total}
        caption={date}
        captionClassName="@max-pair/dashboard:hidden"
        className="@max-pair/dashboard:gap-2"
        actions={
          <>
            <IconButton icon={Search} label={t("inbox.search")} aria-expanded={searchShown} aria-controls="inbox-search" className="@pair/dashboard:hidden" onClick={() => (searchShown && !q ? setSearchOpen(false) : revealSearch())} />
            {/* Below `pair` the status is chosen here rather than in the toolbar, so the role filter gets the toolbar's whole line and the list starts one control higher. The button is named by the status it holds and tinted while it holds anything but the default. */}
            <Popover
              open={statusOpen}
              onOpenChange={setStatusOpen}
              label={t("status")}
              align="end"
              className="w-[min(240px,calc(100vw-32px))] p-1"
              trigger={<IconButton icon={ListFilter} label={t("inbox.statusButton", { status: statusName })} data-narrowed={status !== "todo" || undefined} className="@pair/dashboard:hidden data-narrowed:bg-accent-subtle data-narrowed:text-accent-text" />}
            >
              <p aria-hidden="true" className="px-2.5 pt-1 pb-1.5 text-caption font-medium text-fg-subtle">
                {t("status")}
              </p>
              <div role="group" aria-label={t("status")} className="grid gap-0.5">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={option.value === status}
                    onClick={() => {
                      chooseStatus(option.value);
                      setStatusOpen(false);
                    }}
                    className="flex min-h-8 items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 text-left text-body text-fg hover:bg-bg-muted aria-pressed:font-medium pointer-coarse:min-h-11"
                  >
                    {option.label}
                    {option.value === status && <Check size={16} aria-hidden="true" className="shrink-0 text-accent-text" />}
                  </button>
                ))}
              </div>
            </Popover>
            <LinkButton variant="ghost" icon={Settings2} to="/settings" title={t("followup.goSettings")} className="@max-pair/dashboard:size-8 @max-pair/dashboard:px-0 pointer-coarse:@max-pair/dashboard:size-11">
              <span className="@max-pair/dashboard:sr-only">{t("followup.goSettings")}</span>
            </LinkButton>
          </>
        }
        summary={query.isPending ? <SummarySkeleton /> : summary && <InboxSummary summary={summary} />}
      />
      {data && !data.baseline_complete && (
        <Notice tone="info" role="status">
          {t("followup.baseline")}
        </Notice>
      )}
      {query.isError && data && <StaleNotice onRetry={() => void query.refetch()} />}
      <div className="grid min-w-0 gap-2">
        {/* Below `pair`: the role filter alone on the line, its items sharing the width so every one of them is read whole, the status behind the header's filter button, and the search, when it is open, on the line under the roles. */}
        <Toolbar>
          <SegmentedControl label={t("inbox.role")} value={role} onChange={(value) => change("role", value === "all" ? "" : value)} items={inboxRoles.map((value) => ({ value, label: t(`followup.${value}`) }))} fill="below-pair" className="min-w-0" />
          <Select label={t("status")} value={status} onChange={(event) => chooseStatus(event.target.value)} options={statusOptions} className="shrink-0 @max-pair/dashboard:hidden" />
          <div id="inbox-search" className={cx("min-w-48 flex-1 basis-56 @max-pair/dashboard:min-w-0 @max-pair/dashboard:basis-full", !searchShown && "@max-pair/dashboard:hidden")}>
            <SearchField id="pr-search" label={t("inbox.search")} value={q} onChange={setSearch} mode="live" placeholder={t("searchPlaceholder")} maxLength={120} kbdHint />
          </div>
        </Toolbar>
        {(repo || merged || tone || ready) && (
          <div role="group" aria-label={t("inbox.appliedFilters")} className="flex flex-wrap items-center gap-2">
            {repo && <FilterChip testId="repository-chip" label={repo} clearLabel={t("clearRepositoryFilter", { repo })} onClear={() => clearParam("repo")} />}
            {merged && <FilterChip testId="merged-chip" label={t("followup.mergedFilter")} clearLabel={t("clearRepositoryFilter", { repo: t("followup.mergedFilter") })} onClear={() => clearParam("merged")} />}
            {tone && <FilterChip testId="tone-chip" label={toneLabel} clearLabel={t("followup.clearTone", { label: toneLabel })} onClear={() => clearParam("tone")} />}
            {ready && <FilterChip testId="ready-chip" label={t("followup.readyToMerge")} clearLabel={t("followup.clearTone", { label: t("followup.readyToMerge") })} onClear={() => clearParam("ready")} />}
          </div>
        )}
      </div>
      <p className="sr-only" role="status">
        {paneNews}
      </p>
      <p className="sr-only" aria-live="polite">
        {resultNews}
      </p>
      {/* The pane is dropped when there is nothing to show beside: an empty list's message then takes the whole width, rather than sitting next to a prompt to select an item that does not exist. */}
      <SplitView ref={splitRef} split={split} list={list} detail={groups.length ? pane : null} />
    </div>
  );
}
