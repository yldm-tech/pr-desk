import { Fragment, useEffect, useRef, useState } from "react";
import { emptyState, inlineAction, linkAction, secondaryAction } from "./action-styles";
import { panelHeading } from "./overview-styles";
import { syncStatusError } from "./status-styles";
import { linkButton, searchChip, searchForm } from "./app-styles";
import {
  followUpActions,
  followUpCard,
  followUpCardHeading,
  followUpCounts,
  followUpFact,
  followUpFacts,
  followUpFilters,
  followUpGroupHeading,
  followUpMutedGroup,
  followUpPrimaryAction,
  followUpPriority,
  followUpPriorityReasons,
  followUpQuote,
  followUpReason,
  followUpReasonCompact,
  followUpReasons,
  followUpSnooze,
  followUpStatusStrip,
  followUpSummary,
  followUpWait,
  followUpWorkspace,
} from "./followup-styles";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clock, Inbox, MessageSquare, Search } from "lucide-react";
import ky from "ky";
import { apiURL } from "./api-url";
import { safeGitHubLink } from "./activity-model";
import { factChips, factsSurvive, groupItems, handledIsUseful, isMuted, matchesStatus, reasonTone, responseSchema, snoozeBounds, waitingLabel, type FollowUp, type FollowUpGroup } from "./followup-view";
import { followUpErrorMessage, useFollowUpAction } from "./followup-actions";

export function useFollowUps(enabled = true) {
  return useQuery({
    queryKey: ["follow-ups"],
    enabled,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/follow-ups", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => responseSchema.parse(data)),
    staleTime: 15000,
    refetchInterval: 60000,
    // Every fetch re-runs the server's presentation against a fresh clock and re-sorts, so a refetch rearranges the list rather than updating it in place. Opening a PR in a new tab, reading it and coming back is the single most common way to leave this page and return, and it was also the surest way to lose the map of it.
    refetchOnWindowFocus: false,
  });
}

// The announcement names the action that was taken. A chain of ternaries sent
// everything that was not a snooze or a read to "Followed up", including
// handled, which is a different thing to say.
const actionLabels: Record<string, string> = { snooze: "snooze", read: "read", handled: "handled", followed_up: "followedUp", unsnooze: "cancelReminder" };

const dateFormat = (iso: string | null | undefined, locale: string | undefined) => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? null : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
};

// Tone is carried by colour alone everywhere else in the card, and two of the four tokens sit close enough in lightness that the grouping is thin even with full colour vision. The shape says the same thing without a word of copy, so the chip's own label stays the only thing announced.
function ReasonIcon({ tone }: { tone: string }) {
  if (tone === "blocked") return <AlertTriangle size={13} aria-hidden="true" />;
  if (tone === "action") return <MessageSquare size={13} aria-hidden="true" />;
  if (tone === "waiting") return <Clock size={13} aria-hidden="true" />;
  return null;
}

function FollowUpCard({ item, group, now, highlight, onChanged }: { item: FollowUp; group: FollowUpGroup; now: number; highlight: boolean; onChanged: (message: string, failed?: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState("");
  // The disclosure is controlled so a successful snooze can close it. It used to stay open around a stale date and a greyed confirm beside a reminder that had already been set, which reads as a step that did not finish.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [rangeHint, setRangeHint] = useState(false);
  const action = useFollowUpAction({
    item,
    onDone: (done) => {
      if (done.action === "snooze") {
        setSnoozeOpen(false);
        setDate("");
        setRangeHint(false);
      }
      // Handled clears the confirmation and nothing else, while conflict and checks_failed are re-derived from GitHub on every read. Saying so is the difference between a button that looks broken and one whose limit is understood.
      const survives = done.action === "handled" && factsSurvive(item);
      onChanged(t("followup.announceAction", { action: t(`followup.${actionLabels[done.action] ?? "followedUp"}`), title: item.pr.title }) + (survives ? " " + t("followup.stillListed") : ""));
    },
    onFailed: (error) => onChanged(followUpErrorMessage(error, t), true),
  });
  const reset = action.reset;
  // A 409 says another version arrived, and onSettled refetches on failure too, so the card is already holding fresh data by the time the sentence is on screen. Keyed on the version, the message clears exactly when the thing it describes stops being true.
  useEffect(() => {
    reset();
  }, [item.version, reset]);
  const githubURL = safeGitHubLink(item.pr.url || "");
  const muted = isMuted(item, now);
  const chips = factChips(item.pr, item.role);
  const waiting = waitingLabel(item.waiting_since, now);
  const waitingExact = Number.isNaN(Date.parse(item.waiting_since)) ? undefined : new Date(item.waiting_since).toLocaleString(i18n.resolvedLanguage);
  const mutedDate = muted ? dateFormat(item.snoozed_until, i18n.resolvedLanguage) : null;
  const outcomeDate = dateFormat(item.pr.merged_at || item.archived_at, i18n.resolvedLanguage);
  const bounds = snoozeBounds(now);
  const outOfRange = !date || date < bounds.min || date > bounds.max;
  const actionFor = (label: string) => t("followup.actionFor", { action: label, repo: item.pr.repo, number: item.pr.number });
  const snooze = (until: string) => action.mutate({ action: "snooze", until });
  return (
    <article data-testid="follow-up-card" className={`${followUpCard} data-[highlight]:bg-[var(--accent-soft)]`} id={`followup-${item.id}`} aria-labelledby={`followup-title-${item.id}`} data-unread={item.unread || undefined} data-highlight={highlight || undefined}>
      <div className={followUpCardHeading}>
        <span>
          {item.pr.repo} #{item.pr.number}
        </span>
        {/* The state word moved to the group heading above. Keeping it here as well produced a card that contradicted itself in Chinese — "awaiting my review · waiting on others" — and said nothing new in any language. */}
        <span>
          {t(item.role === "reviewer" ? "followup.roleReviewerItem" : "followup.roleAuthoredItem")}
          {item.unread && <> · {t("followup.unread")}</>}
        </span>
      </div>
      <h3 id={`followup-title-${item.id}`}>
        <a href={githubURL || undefined} target="_blank" rel="noopener noreferrer" onClick={() => item.unread && action.mutate({ action: "read" })}>
          {item.pr.title}
        </a>
      </h3>
      {(item.reasons.length > 0 || mutedDate) && (
        <div className={followUpReasons}>
          {item.reasons.map((reason) => (
            <span key={reason} className={`${followUpReason} inline-flex items-center gap-1`} data-tone={reasonTone(reason)}>
              <ReasonIcon tone={reasonTone(reason)} />
              {t(`followup.${reason}`)}
            </span>
          ))}
          {mutedDate && (
            <span className={followUpReason} data-tone="waiting">
              {t("followup.mutedUntil", { date: mutedDate })}
            </span>
          )}
        </div>
      )}
      {/* What is true of the pull request, as opposed to why the card exists. All of it has been in the payload since the endpoint existed and all of it was dropped, so a green, approved, conflict-free PR of your own looked exactly like one nobody had opened. */}
      {chips.length > 0 && (
        <div className={followUpFacts}>
          {chips.map((chip) => (
            <span key={chip.key} className={`${followUpFact} ${chip.className ?? ""}`} data-tone={chip.tone}>
              {chip.valueKey ? `${t(chip.i18nKey)}: ${t(chip.valueKey, { defaultValue: chip.valueKey })}` : t(chip.i18nKey, chip.interpolation)}
            </span>
          ))}
        </div>
      )}
      {/* The server cuts the comment at 240 runes with nothing to mark the cut, so the quote usually ends mid-word and reads as if that is what was said. The ellipsis is the client's half of that; the author and the timestamp need a field the response does not carry yet. Array.from counts code points, which is what Go's []rune slice at followup_sync.go:38 counts — a grapheme segmenter would disagree with the server on exactly the emoji and combining marks it is supposed to help with. */}
      {item.excerpt && <blockquote className={followUpQuote}>{Array.from(item.excerpt).length >= 240 ? item.excerpt + "…" : item.excerpt}</blockquote>}
      {group === "archived" ? (
        <p className={followUpWait}>{t("followup.outcomeAt", { outcome: t(item.pr.merged_at ? "merged" : "closed"), date: outcomeDate ?? t("unknown") })}</p>
      ) : (
        // A draft is not waiting on anybody, so the line said nothing there; elsewhere it is the duration rather than the instant, with the instant kept on hover.
        group !== "draft" &&
        waiting && (
          <p className={followUpWait}>
            <time dateTime={item.waiting_since} title={waitingExact}>
              {t(waiting.key, { count: waiting.count })}
            </time>
          </p>
        )
      )}
      {action.isError && (
        <div className={syncStatusError} role="alert">
          <span>{followUpErrorMessage(action.error, t)}</span>
          <button className={linkAction} type="button" onClick={() => action.variables && action.mutate(action.variables)}>
            {t("retry")}
          </button>
        </div>
      )}
      {/* Fixed order, so the irreversible button never changes position between adjacent cards: the primary, then the deferral, then the incidental one. */}
      <div className={followUpActions}>
        {group !== "archived" && (
          <>
            {handledIsUseful(item) ? (
              <button className={followUpPrimaryAction} type="button" disabled={action.isBusy} aria-label={actionFor(t("followup.handled"))} onClick={() => action.mutate({ action: "handled" })}>
                {t("followup.handled")}
              </button>
            ) : (
              <p className={`${followUpWait} m-0`}>{t("followup.blockedByGitHub")}</p>
            )}
            {muted ? (
              <button className={inlineAction} type="button" disabled={action.isBusy} aria-label={actionFor(t("followup.cancelReminder"))} onClick={() => action.mutate({ action: "unsnooze" })}>
                {t("followup.cancelReminder")}
              </button>
            ) : (
              <details open={snoozeOpen} onToggle={(event) => setSnoozeOpen(event.currentTarget.open)}>
                {/* The pill skin the summary now carries costs it the UA disclosure triangle, so the caret is a character here; it is hidden from assistive technology, which already gets the open state from the element. */}
                <summary>
                  <span aria-hidden="true">{snoozeOpen ? "▾" : "▸"}</span>
                  {t("followup.snooze")}
                </summary>
                <div className={followUpSnooze}>
                  {[3, 7].map((days) => (
                    <button key={days} className={inlineAction} type="button" disabled={action.isBusy} aria-label={actionFor(t("followup.days", { count: days }))} onClick={() => snooze(new Date(now + days * 86400000).toISOString())}>
                      {t("followup.days", { count: days })}
                    </button>
                  ))}
                  <label>
                    {t("followup.custom")}
                    {/* The bounds are the server's own — it refuses anything past a year — so the OS picker can no longer offer a value that comes back as a save error. */}
                    <input type="datetime-local" min={bounds.min} max={bounds.max} value={date} onChange={(event) => setDate(event.target.value)} />
                  </label>
                  {/* Enabled whatever the field holds: a disabled confirm drops out of the tab order and gives a keyboard user no way to find out why it is refusing. */}
                  <button className={inlineAction} type="button" disabled={action.isBusy} aria-label={actionFor(t("followup.confirmSnooze"))} onClick={() => (outOfRange ? setRangeHint(true) : snooze(new Date(date).toISOString()))}>
                    {t("followup.confirmSnooze")}
                  </button>
                  {outOfRange && (rangeHint || !!date) && (
                    <p className={`${followUpWait} m-0 basis-full`} role="alert">
                      {t("followup.reminderRange")}
                    </p>
                  )}
                </div>
              </details>
            )}
          </>
        )}
        {item.unread && (
          <button className={linkAction} type="button" disabled={action.isBusy} aria-label={actionFor(t("followup.read"))} onClick={() => action.mutate({ action: "read" })}>
            {t("followup.read")}
          </button>
        )}
      </div>
    </article>
  );
}

export function FollowUpSummary() {
  const { t, i18n } = useTranslation();
  const query = useFollowUps();
  const now = Date.now();
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  // One failed poll out of a minute's worth is not a reason to blank counts
  // that are at most a minute old; only an empty cache leaves nothing to show.
  if (query.isError && !query.data)
    return (
      <p role="alert">
        {t("followup.unavailable")}{" "}
        <button className={secondaryAction} onClick={() => query.refetch()}>
          {t("followup.retry")}
        </button>
      </p>
    );
  // The server sorts by last activity inside its state rank, so the five shown were the five most recently changed — by construction the three-week-old conflict nobody has touched can never re-enter the top five, which is the item that most needs the reminder. filter() already copies, so this sorts its own array and not the query cache.
  const started = (item: FollowUp) => {
    const value = Date.parse(item.waiting_since);
    return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
  };
  const todo = query.data.data.filter((item) => item.state === "action" || item.state === "follow_up").sort((a, b) => (a.state === b.state ? 0 : a.state === "action" ? -1 : 1) || started(a) - started(b));
  const priority = todo.slice(0, 5);
  return (
    <section className={followUpSummary} aria-label={t("followup.priority")}>
      {query.isError && (
        <div className={syncStatusError} role="status">
          <span>{t("refreshFailedKeepData")}</span>
          <button className={linkAction} onClick={() => query.refetch()}>
            {t("retry")}
          </button>
        </div>
      )}
      {!query.data.baseline_complete && <p role="status">{t("followup.baseline")}</p>}
      <div className={followUpCounts}>
        {["authored", "reviewer", "follow_up", "recent_merged"].map((key) => (
          <Link key={key} to={`/attention?${key === "authored" || key === "reviewer" ? `role=${key}&status=action` : `status=${key === "recent_merged" ? "archived&merged=1" : key}`}`}>
            <span>{t(`followup.${key === "authored" || key === "reviewer" ? key + "_action" : key}`)}</span>
            <strong>{query.data.counts[key] || 0}</strong>
          </Link>
        ))}
      </div>
      <div className={panelHeading}>
        <h2>{t("followup.priority")}</h2>
        {/* Five of forty used to read exactly like five of five. */}
        <Link to="/attention">{t("followup.viewAllCount", { count: todo.length })}</Link>
      </div>
      <ul data-testid="priority-list" className={followUpPriority}>
        {priority.map((item) => {
          const waiting = waitingLabel(item.waiting_since, now);
          return (
            <li key={item.id}>
              <Link to={`/attention?focus=${item.id}`}>
                <span>
                  {item.pr.repo} #{item.pr.number} · {item.pr.title}
                </span>
                <small data-testid="priority-reasons" className={followUpPriorityReasons}>
                  {item.reasons.map((reason) => (
                    <span key={reason} className={followUpReasonCompact} data-tone={reasonTone(reason)}>
                      {t(`followup.${reason}`)}
                    </span>
                  ))}
                  {waiting && (
                    <time dateTime={item.waiting_since} title={Number.isNaN(Date.parse(item.waiting_since)) ? undefined : new Date(item.waiting_since).toLocaleString(i18n.resolvedLanguage)}>
                      {t(waiting.key, { count: waiting.count })}
                    </time>
                  )}
                </small>
              </Link>
            </li>
          );
        })}
      </ul>
      {priority.length === 0 && <p>{t("followup.empty")}</p>}
    </section>
  );
}

export function FollowUpWorkspace() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // An action can remove the card that held the focus, and nothing announced
  // the result, so a screen reader user was left with no feedback and the focus
  // on the document body. The counter makes repeating the same action announce
  // again; the check runs after the render that removed the card, because
  // before it the focus is still on a button that is about to disappear.
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  // The visible half of the same sentence, kept in its own state so that dismissing it — by hand or on the timer — never rewrites the live region and never re-runs the focus effect above.
  const [strip, setStrip] = useState<{ text: string; failed: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const region = useRef<HTMLElement>(null);
  const announce = (text: string, failed = false) => {
    setAnnouncement((previous) => ({ text, id: previous.id + 1 }));
    setStrip({ text, failed });
  };
  const query = useFollowUps();
  const now = Date.now();
  const role = params.get("role") || "all",
    // The badge sums action and follow_up, and no single option showed that set, so the number the application nags with could only be cleared in two passes.
    status = params.get("status") || "todo",
    repo = params.get("repo") || "",
    merged = params.get("merged") || "",
    focus = params.get("focus") || "";
  const change = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      next.delete("focus");
      next.delete("merged");
      return next;
    });
  const clearParam = (key: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      return next;
    });
  const showAll = () => {
    setSearch("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["role", "repo", "merged", "focus"]) next.delete(key);
      next.set("status", "all");
      return next;
    });
  };
  const needle = search.trim().toLowerCase();
  const items = (query.data?.data || []).filter(
    (item) =>
      (role === "all" || item.role === role) &&
      (!repo || item.pr.repo === repo) &&
      matchesStatus(item, status, now) &&
      (!merged || (item.pr.merged_at && item.archived_at && new Date(item.archived_at).getTime() > now - 7 * 86400000)) &&
      (!needle || item.pr.repo.toLowerCase().includes(needle) || item.pr.title.toLowerCase().includes(needle) || `#${item.pr.number}`.includes(needle)),
  );
  const ids = items.map((item) => item.id).join(",");
  // `items.length` was the proxy for "the set changed", so a refetch that dropped the acted-on card and added another one kept the length equal and the effect never ran — exactly the case it exists to prevent.
  useEffect(() => {
    if (announcement.id && document.activeElement === document.body) region.current?.focus({ preventScroll: true });
  }, [announcement, ids]);
  // `focus` used to hide the other nineteen cards, with nothing on the page saying so; the card has carried an id and a scroll margin for exactly this since it was written. The list is a dependency because the card does not exist on the render that reads the parameter, and the ref keeps a later refetch from dragging the viewport back while the reader is working further down.
  const scrolled = useRef("");
  useEffect(() => {
    if (!focus || scrolled.current === focus) return;
    const card = document.getElementById(`followup-${focus}`);
    if (!card) return;
    scrolled.current = focus;
    card.scrollIntoView({ block: "nearest" });
  }, [focus, ids]);
  useEffect(() => {
    // A failure keeps its strip until it is dismissed: the same rule the sync banner follows, because the message is the only route to understanding what to do next.
    if (!strip || strip.failed) return;
    const timer = window.setTimeout(() => setStrip(null), 6000);
    return () => window.clearTimeout(timer);
  }, [strip]);
  const groups = groupItems(items, now);
  const narrowed = role !== "all" || !!repo || !!merged || !!needle || (status !== "todo" && status !== "all");
  return (
    <section className={followUpWorkspace} ref={region} tabIndex={-1} aria-label={t("followup.title")}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text}
      </p>
      {query.data && !query.data.baseline_complete && <p role="status">{t("followup.baseline")}</p>}
      {/* The result of an action, for the people the live region above has never been able to reach. It is aria-hidden on purpose: two regions holding the same sentence announce it twice. */}
      {strip && (
        <div className={strip.failed ? syncStatusError : followUpStatusStrip} aria-hidden="true">
          <span>{strip.text}</span>
          <button type="button" tabIndex={-1} onClick={() => setStrip(null)}>
            ×
          </button>
        </div>
      )}
      <div className={panelHeading}>
        <h2>
          {t("followup.title")} <span className="ml-1.5 inline-flex min-w-6 items-center justify-center rounded-md bg-[var(--surface-muted)] px-[7px] py-0.5 text-[length:0.75rem] text-[var(--muted)]">{items.length}</span>
        </h2>
        <Link to="/settings">{t("followup.goSettings")}</Link>
      </div>
      {repo && (
        <p data-testid="repository-chip" className={searchChip}>
          <span>{repo}</span>
          {/* linkButton is p-0 at the chip's 12px, so the bare glyph is about a 7x18px target, and this is the only control in the page that clears the repo= parameter — missing it on a phone leaves the reader stuck in a filtered view. The negative margin cancels the padding, so the chip keeps its compact shape while the button reaches 44px. */}
          <button className={`${linkButton} inline-flex items-center justify-center pointer-coarse:-m-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:p-2`} type="button" onClick={() => clearParam("repo")} aria-label={t("clearRepositoryFilter", { repo })}>
            ×
          </button>
        </p>
      )}
      {merged && (
        <p data-testid="merged-chip" className={searchChip}>
          <span>{t("followup.mergedFilter")}</span>
          <button className={`${linkButton} inline-flex items-center justify-center pointer-coarse:-m-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:p-2`} type="button" onClick={() => clearParam("merged")} aria-label={t("clearRepositoryFilter", { repo: t("followup.mergedFilter") })}>
            ×
          </button>
        </p>
      )}
      {query.isError && query.data && (
        <div className={syncStatusError} role="status">
          <span>{t("refreshFailedKeepData")}</span>
          <button className={linkAction} onClick={() => query.refetch()}>
            {t("retry")}
          </button>
        </div>
      )}
      <div className={followUpFilters}>
        <div role="group" aria-label={t("followup.title")}>
          {["all", "authored", "reviewer"].map((value) => (
            <button key={value} className={secondaryAction} aria-pressed={role === value} onClick={() => change("role", value)}>
              {t(`followup.${value}`)}
            </button>
          ))}
        </div>
        <select aria-label={t("status")} value={status} onChange={(e) => change("status", e.target.value)}>
          {["todo", "all", "action", "follow_up", "muted", "waiting", "draft", "archived"].map((value) => (
            <option key={value} value={value}>
              {t(`followup.${value}`)}
            </option>
          ))}
        </select>
        {/* The id is the whole keyboard change: the application's one shortcut already focuses `#pr-search` with a correct guard, and it has been inert on the only page where state can be changed because that id rendered nowhere else. Narrowing is live and local, so the URL — which the navigation memory replays — keeps meaning the filters and not a half-typed word. */}
        <form className={searchForm} role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="pr-search">{t("search")}</label>
          <div>
            <input id="pr-search" type="search" maxLength={120} title={t("searchShortcut")} aria-keyshortcuts="/" placeholder={t("searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} />
            <button aria-label={t("search")} type="submit">
              <Search size={19} />
            </button>
            {search && (
              <button type="button" onClick={() => setSearch("")}>
                {t("clear")}
              </button>
            )}
          </div>
        </form>
      </div>
      {status === "draft" && <p>{t("followup.draftHelp")}</p>}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.isError && !query.data ? (
        <p role="alert">
          {t("followup.unavailable")}{" "}
          <button className={secondaryAction} onClick={() => query.refetch()}>
            {t("followup.retry")}
          </button>
        </p>
      ) : groups.length ? (
        // Always grouped, even when one group is all there is: the heading is where the state word lives now, and its count is the confirmation that survives a missed status strip.
        groups.map(({ group, items: rows }) =>
          group === "muted" ? (
            <details key={group} className={followUpMutedGroup}>
              <summary>{t("followup.groupHeading", { label: t("followup.muted"), count: rows.length })}</summary>
              {rows.map((item) => (
                <FollowUpCard key={item.id} item={item} group={group} now={now} highlight={String(item.id) === focus} onChanged={announce} />
              ))}
            </details>
          ) : (
            <Fragment key={group}>
              <h3 className={followUpGroupHeading}>{t("followup.groupHeading", { label: t(`followup.${group}`), count: rows.length })}</h3>
              {rows.map((item) => (
                <FollowUpCard key={item.id} item={item} group={group} now={now} highlight={String(item.id) === focus} onChanged={announce} />
              ))}
            </Fragment>
          ),
        )
      ) : (
        <div className={emptyState}>
          <Inbox size={28} />
          {narrowed ? (
            <>
              <h2>{t("emptyResultsTitle")}</h2>
              <p>{t("followup.empty")}</p>
              <button className={secondaryAction} type="button" onClick={showAll}>
                {t("followup.showAll")}
              </button>
            </>
          ) : (
            <>
              <h2>{t("caughtUp")}</h2>
              <p>{t("noActionNeeded")}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
