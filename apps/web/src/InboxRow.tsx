import { HTTPError } from "ky";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { BellOff, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FollowUpActions } from "./FollowUpActions";
import { prGitHubURL } from "./pr-model";
import { followUpErrorMessage, useFollowUpAction, type FollowUpActionInput } from "./followup-actions";
import { factsSurvive, handledIsUseful, isMuted, isReadyToMerge, reasonTone, waitingLabel, type FollowUp, type FollowUpGroup } from "./followup-view";
import { reasonIcon, type GlyphKind, type Tone } from "./tone";
import type { UndoTarget } from "./undo-slot";
import { Button, cx } from "./ui-controls";
import { FactChip, formatAge, formatDate, formatDateTime, StateGlyph } from "./ui-display";
import { ItemRow } from "./ui-list";

// What a row reports after an action: the sentence for the toast and, for every action that leaves a step on the server, what Undo would restore.
export type RowReport = { text: string; tone: "success" | "error"; undo?: UndoTarget };

// The verbs the page's keys drive on the row under the cursor, registered by each row so the key and the button are the same code path.
// `quiet` is for a read the page posts because the row was opened: the reader asked to see the row, not to be told it was marked read.
export type RowCommands = { run: (action: FollowUpActionInput, options?: { quiet?: boolean }) => void; openSnooze: () => void; busy: () => boolean };

// The announcement names the action that was taken, in the words of the verb.
const actionLabels: Record<string, string> = { snooze: "snooze", read: "read", handled: "handled", followed_up: "followedUp", unsnooze: "cancelReminder" };

const toneRank: Tone[] = ["blocked", "action", "waiting"];

// The row's glyph: its most urgent tone, in a shape that says the same thing without colour.
export function rowGlyph(item: FollowUp, group: FollowUpGroup, now: number): { tone: Tone; kind: GlyphKind } {
  if (group === "archived") return { tone: "neutral", kind: item.pr.merged_at ? "merged" : "closed" };
  if (group === "muted") return { tone: "neutral", kind: "muted" };
  if (group === "draft") return { tone: "neutral", kind: "draft" };
  const tone = toneRank.find((candidate) => item.reasons.some((reason) => reasonTone(reason) === candidate));
  if (tone === "blocked") return { tone, kind: "blocked" };
  if (isReadyToMerge(item.pr, item.role) && !isMuted(item, now)) return { tone: "ready", kind: "ready" };
  if (tone === "action" || item.state === "action") return { tone: "action", kind: "action" };
  return { tone: "waiting", kind: "waiting" };
}

// ItemRow with motion's props, so a row leaving the list can collapse instead of vanishing. It forwards `ref` to the article, which is what motion measures.
const MotionItemRow = motion.create(ItemRow);

const isStale = (error: unknown) => error instanceof HTTPError && error.response.status === 409;

// One follow-up in the Inbox: why it is here (reason chips and the attributed excerpt), how long it has waited, and the verbs that can move it. The article is the focus target of j/k and of the focus rescue after a removal, so it carries the id and the label; it gives both up while it animates out, so nothing can find or focus a row that is leaving.
export function InboxRow({
  item,
  group,
  now,
  split,
  active,
  highlight,
  emphasis,
  showRole,
  settings,
  overdueIn,
  onReport,
  onOpen,
  onTitleRead,
  onRepository,
  onShowLatest,
  register,
  controls,
}: {
  item: FollowUp;
  group: FollowUpGroup;
  now: Date;
  split: boolean;
  active: boolean;
  highlight: boolean;
  emphasis: boolean;
  showRole: boolean;
  settings?: { timezone: string; digest_time: string };
  // Days until a waiting row becomes overdue, when the reminder settings have loaded and it is not overdue yet.
  overdueIn?: number;
  onReport: (report: RowReport) => void;
  onOpen: (item: FollowUp, opener: HTMLElement) => void;
  onTitleRead: (item: FollowUp) => void;
  onRepository: (repo: string) => void;
  onShowLatest: (item: FollowUp) => void;
  register: (id: number, commands: RowCommands | null) => void;
  // The id of the detail pane Show activity fills in the split view.
  controls?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const exiting = !present;
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLButtonElement>(null);
  const quiet = useRef(false);
  const action = useFollowUpAction({
    item,
    onDone: (done) => {
      if (done.action === "snooze") setSnoozeOpen(false);
      if (done.action === "read" && quiet.current) {
        quiet.current = false;
        return;
      }
      const label = t(`followup.${actionLabels[done.action] ?? "followedUp"}`);
      // Handled clears the confirmation and nothing else, while conflict and checks_failed are re-derived from GitHub on every read; saying so is the difference between a button that looks broken and one whose limit is understood.
      const survives = done.action === "handled" && factsSurvive(item);
      // A reminder takes the row out of the default view the moment it is set, so this sentence is the only record of the day that was chosen.
      const until = done.action === "snooze" && done.until ? new Date(done.until) : null;
      const reminder = until && !Number.isNaN(until.getTime()) ? new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(until) : null;
      const text = reminder ? t("followup.reminderSetFor", { date: reminder }) : t("followup.announceAction", { action: label, title: item.pr.title }) + (survives ? " " + t("followup.stillListed") : "");
      // `read` and `undo` leave no step on the server to go back to, so they never take the undo slot.
      const undo = done.action === "undo" || done.action === "read" ? undefined : { id: item.id, version: item.version, repo: item.pr.repo, number: item.pr.number, action: label };
      onReport({ text, tone: "success", undo });
    },
    onFailed: (error) => {
      // A 409 is not a failure the reader can retry: the row moved on under them. The row says so in place and offers the fresh copy; a toast would only repeat it.
      if (!isStale(error)) onReport({ text: followUpErrorMessage(error, t), tone: "error" });
    },
  });
  const { reset, mutate, isBusy } = action;
  // A 409 comes back after onSettled has already refetched, so the row holds the newer version by the time the message shows; keyed on the version, the message clears exactly when what it describes stops being true.
  useEffect(() => reset(), [item.version, reset]);
  const commands = useRef<RowCommands | null>(null);
  commands.current = {
    run: (input, options) => {
      quiet.current = !!options?.quiet;
      mutate(input);
    },
    openSnooze: () => setSnoozeOpen(true),
    busy: () => isBusy,
  };
  useEffect(() => {
    if (exiting) return;
    register(item.id, { run: (input, options) => commands.current?.run(input, options), openSnooze: () => commands.current?.openSnooze(), busy: () => commands.current?.busy() ?? false });
    return () => register(item.id, null);
  }, [exiting, item.id, register]);

  const nowMs = now.getTime();
  const muted = isMuted(item, nowMs);
  const ready = isReadyToMerge(item.pr, item.role) && group !== "archived" && !muted;
  const glyph = rowGlyph(item, group, nowMs);
  const titleId = `followup-title-${item.id}`;
  const started = Date.parse(item.waiting_since);
  const waiting = waitingLabel(item.waiting_since, nowMs);
  const outcomeISO = item.pr.merged_at || item.archived_at;
  const outcome = outcomeISO && !Number.isNaN(Date.parse(outcomeISO)) ? new Date(outcomeISO) : null;
  const excerptAt = item.excerpt_at && !Number.isNaN(Date.parse(item.excerpt_at)) ? formatDate(new Date(item.excerpt_at), language, now) : null;
  const mutedUntil = muted && item.snoozed_until ? formatDate(new Date(item.snoozed_until), language, now) : null;
  const blockedOnly = !handledIsUseful(item) && group !== "archived";
  const stale = action.isError && isStale(action.error);

  // The first <time> in the row is always the one on the title's line: the age of a waiting row, the outcome of an archived one. Nothing earlier in the row is a <time>, so "the row's time" has one answer. The age is printed compact ("26d") and read out in full ("Waiting 26 days"), because a screen reader says the compact form letter by letter.
  const time =
    group === "archived" ? (
      outcome && (
        <time dateTime={outcome.toISOString()} title={formatDateTime(outcome, language)} className="text-caption text-fg-muted tabular-nums">
          {t("followup.outcomeAt", { outcome: t(item.pr.merged_at ? "merged" : "closed"), date: formatDate(outcome, language, now) })}
        </time>
      )
    ) : group === "draft" || Number.isNaN(started) ? null : (
      <time dateTime={new Date(started).toISOString()} title={`${waiting ? t(waiting.key, { count: waiting.count }) : ""} · ${formatDateTime(new Date(started), language)}`} className="text-caption font-medium whitespace-nowrap text-fg-muted tabular-nums">
        <span aria-hidden="true">{formatAge(new Date(started), now, language)}</span>
        {waiting && <span className="sr-only">{t(waiting.key, { count: waiting.count })}</span>}
      </time>
    );

  return (
    <MotionItemRow
      as="article"
      tracks={split ? "list-split" : "list"}
      data-testid="follow-up-card"
      id={`followup-${item.id}`}
      tabIndex={-1}
      aria-labelledby={titleId}
      active={active}
      unread={item.unread}
      highlight={highlight}
      exiting={exiting}
      onBodyClick={() => {
        const element = document.getElementById(`followup-${item.id}`);
        if (element) onOpen(item, element);
      }}
      initial={false}
      exit={{ opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: reduced ? 0 : 0.24, ease: [0.4, 0, 1, 1] }}
      style={exiting ? { overflow: "hidden" } : undefined}
      className="group scroll-mt-24 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      glyph={<StateGlyph tone={glyph.tone} kind={glyph.kind} unread={item.unread} busy={isBusy} />}
      title={
        <h3 id={titleId} className="m-0 text-[length:inherit] leading-[inherit] font-[inherit]">
          <a href={prGitHubURL(item.pr)} target="_blank" rel="noopener noreferrer" className="text-fg no-underline decoration-fg-subtle underline-offset-2 hover:underline" onClick={() => onTitleRead(item)}>
            {item.pr.title}
            <span className="sr-only"> ({t("inbox.newTab")})</span>
          </a>
          {item.unread && <span className="sr-only"> · {t("followup.unread")}</span>}
        </h3>
      }
      meta={
        <>
          <span className="inline-flex min-w-0 items-baseline gap-1">
            <button
              type="button"
              aria-label={t("filterToRepository", { repo: item.pr.repo })}
              title={t("filterToRepository", { repo: item.pr.repo })}
              onClick={() => onRepository(item.pr.repo)}
              className="min-w-0 truncate rounded-sm border-0 bg-transparent p-0 text-caption text-fg-muted hover:text-fg hover:underline pointer-coarse:-my-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              {item.pr.repo}
            </button>
            <span className="shrink-0 text-fg-subtle tabular-nums">#{item.pr.number}</span>
          </span>
          {showRole && (
            <>
              <span aria-hidden="true" className="text-fg-subtle">
                ·
              </span>
              <span>{t(item.role === "reviewer" ? "followup.roleReviewerItem" : "followup.roleAuthoredItem")}</span>
            </>
          )}
          {overdueIn !== undefined && (
            <>
              <span aria-hidden="true" className="text-fg-subtle">
                ·
              </span>
              <span>{t("inbox.overdueIn", { count: overdueIn })}</span>
            </>
          )}
          {/* No min-w-0: the chips wrap as a group onto their own line rather than letting the group shrink beside the repository until each chip is cut to a fragment. */}
          {(item.reasons.length > 0 || ready || mutedUntil) && (
            <span data-testid="reasons" className="inline-flex max-w-full flex-wrap items-center gap-1">
              {item.reasons.map((reason) => {
                const tone = reasonTone(reason) as Tone;
                return (
                  <FactChip key={reason} tone={tone} icon={reasonIcon[tone]}>
                    {t(`followup.${reason}`)}
                  </FactChip>
                );
              })}
              {ready && (
                <FactChip tone="ready" icon={Check}>
                  {t("followup.readyToMerge")}
                </FactChip>
              )}
              {mutedUntil && (
                <FactChip tone="neutral" icon={BellOff}>
                  {t("followup.mutedUntil", { date: mutedUntil })}
                </FactChip>
              )}
            </span>
          )}
          {blockedOnly && <span className="text-fg-muted">{t("followup.blockedByGitHub")}</span>}
        </>
      }
      excerpt={
        <>
          {item.excerpt && (
            <blockquote className={cx("m-0 min-w-0 border-l-2 border-line pl-2 text-caption text-fg-muted [overflow-wrap:anywhere]", split ? "line-clamp-2" : "line-clamp-1 @row/list:line-clamp-2")}>
              <span className="text-fg">“{item.excerpt}”</span>{" "}
              <cite className="text-fg-subtle not-italic">
                — {item.excerpt_by || t("unknown")}
                {excerptAt && <> · {excerptAt}</>}
              </cite>
            </blockquote>
          )}
          {action.isError && (
            <p role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-tone-blocked">
              <span>{stale ? t("inbox.staleVersion") : followUpErrorMessage(action.error, t)}</span>
              {stale ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-accent-text"
                  onClick={() => {
                    reset();
                    onShowLatest(item);
                  }}
                >
                  {t("inbox.showLatest")}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => action.variables && mutate(action.variables)}>
                  {t("retry")}
                </Button>
              )}
            </p>
          )}
        </>
      }
      aside={time}
      rail={<FollowUpActions item={item} variant={split ? "row-split" : "row"} action={action} now={now} emphasis={emphasis} settings={settings} snoozeOpen={snoozeOpen} onSnoozeOpenChange={setSnoozeOpen} snoozeRef={snoozeRef} onShowActivity={(opener) => onOpen(item, opener)} controls={controls} />}
    />
  );
}
