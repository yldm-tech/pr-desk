import { HTTPError } from "ky";
import { MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityPanel } from "./ActivityPanel";
import { useDetail, type DetailTarget } from "./detail-context";
import { FollowUpActions } from "./FollowUpActions";
import { prGitHubURL } from "./pr-model";
import { followUpErrorMessage, useFollowUpAction } from "./followup-actions";
import { factsSurvive, groupOf, handledIsUseful, primaryAction, reasonTone, type FollowUp, type FollowUpGroup } from "./followup-view";
import { ActivitySkeleton } from "./LoadingSkeleton";
import { useAuth, useActivity, useFollowUps } from "./queries";
import { useShortcut } from "./shortcuts";
import { useReminderSettings } from "./SnoozePopover";
import { reasonIcon, toneText, type Tone } from "./tone";
import { useUndoSlot } from "./undo-slot";
import { Button, cx, IconButton, LinkButton } from "./ui-controls";
import { FactChip, formatDate, Notice, Time } from "./ui-display";
import { Sheet } from "./ui-overlay";

// The tone a follow-up's group is shown in on the detail's state chip.
const groupTone: Record<FollowUpGroup, Tone> = { action: "action", follow_up: "waiting", muted: "neutral", waiting: "waiting", draft: "neutral", archived: "neutral" };

const actionLabels: Record<string, string> = { snooze: "snooze", handled: "handled", unsnooze: "cancelReminder" };

// The follow-up verbs in the sheet's footer, with the feedback line and the way back. Its own component because the action hook needs a row to act on and a PR opened from the table may have none. Opening the sheet is the explicit "show me this" the read rule asks for, so it posts `read` once per row when the row is unread.
function SheetFollowUp({ item, now }: { item: FollowUp; now: Date }) {
  const { t, i18n } = useTranslation();
  const [feedback, setFeedback] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const settings = useReminderSettings();
  const undo = useUndoSlot();
  const footer = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const action = useFollowUpAction({
    item,
    onDone: (done) => {
      if (done.action === "read") return;
      if (done.action === "snooze") setSnoozeOpen(false);
      const label = t(`followup.${actionLabels[done.action] ?? "followedUp"}`);
      const until = done.action === "snooze" && done.until ? new Date(done.until) : null;
      const text = until
        ? t("followup.reminderSetFor", { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(until) })
        : t("followup.announceAction", { action: label, title: item.pr.title }) + (done.action === "handled" && factsSurvive(item) ? " " + t("followup.stillListed") : "");
      setFeedback(text);
      // The same slot the toast and `z` use, so undoing here and undoing from the list can never restore two different steps.
      undo.set({ id: item.id, version: item.version, repo: item.pr.repo, number: item.pr.number, action: label });
    },
    onFailed: (error) => setFeedback(error instanceof HTTPError && error.response.status === 409 ? t("inbox.staleVersion") : followUpErrorMessage(error, t)),
  });
  const marked = useRef<number | null>(null);
  const { mutate } = action;
  useEffect(() => {
    // Guarded by the id already posted for, because the invalidation this triggers re-renders with a fresh item object.
    if (!item.unread || marked.current === item.id) return;
    marked.current = item.id;
    mutate({ action: "read" });
  }, [mutate, item.id, item.unread]);
  // The sheet's own keys: the same verbs as on a row, bound to the dialog element so they work while the sheet is modal and never reach the list behind it.
  useLayoutEffect(() => {
    dialog.current = footer.current?.closest("dialog") ?? null;
  }, []);
  useShortcut(
    ["e", "s", "r", "u"],
    (event) => {
      if (action.isBusy) return;
      const verbs = primaryAction(item, now);
      const offered = [verbs.primary, ...verbs.secondary];
      if (event.key === "e" && offered.includes("handled")) mutate({ action: "handled" });
      else if (event.key === "e" && !handledIsUseful(item)) setFeedback(t("followup.blockedByGitHub"));
      else if (event.key === "s" && offered.includes("snooze")) setSnoozeOpen(true);
      else if (event.key === "r" && verbs.markRead) mutate({ action: "read" });
      else if (event.key === "u" && offered.includes("unsnooze")) mutate({ action: "unsnooze" });
      else return false;
    },
    { scope: "sheet", element: dialog },
  );
  const canUndo = undo.target?.id === item.id;
  return (
    <div ref={footer} className="grid basis-full gap-2">
      {groupOf(item, now.getTime()) !== "archived" && <FollowUpActions item={item} variant="sheet" action={action} now={now} emphasis settings={settings.data} snoozeOpen={snoozeOpen} onSnoozeOpenChange={setSnoozeOpen} />}
      {(feedback || canUndo) && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="min-w-0 text-caption text-fg-muted">
            {feedback}
          </p>
          {/* No timer: the sheet exists only until it is dismissed, so the confirmation and its inverse can wait for the reader. */}
          {canUndo && (
            <Button size="sm" variant="ghost" className="text-accent-text" busy={undo.busy} aria-label={t("followup.undoFor", { action: undo.target!.action, repo: item.pr.repo, number: item.pr.number })} onClick={() => void undo.run(undo.target ?? undefined).then((done) => done && setFeedback(t("followup.undone")))}>
              {t("followup.undo")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// One pull request's detail: why it is in the Inbox, then what GitHub says about it (checks, review threads, comments). `pane` is the column beside the Inbox list on a wide screen, which follows the cursor and offers no follow-up verbs, because the row beside it already has them and two buttons with one name would be one too many. `sheet` is the same content in a modal <dialog> for every other opener, and it carries the verbs in its footer.
export function DetailPane({ target, mode }: { target: DetailTarget; mode: "pane" | "sheet" }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const detail = useDetail();
  const auth = useAuth();
  const followUps = useFollowUps(!!auth.data?.connected);
  const activity = useActivity(target.pr.id);
  const titleId = useId();
  const nameId = useId();
  const pr = target.pr;
  // Read from the live payload rather than from the target, so acting in the sheet shows the row's new state. The ids match: a follow-up carries the same PullRequest row the table lists.
  const followUp = followUps.data?.data.find((item) => item.pr.id === pr.id) ?? target.followUp;
  const now = new Date();
  const group = followUp ? groupOf(followUp, now.getTime()) : null;
  const link = prGitHubURL(followUp?.pr ?? pr);
  const comments = activity.data ? (activity.data.conversation?.length ?? 0) + (activity.data.review_comments?.length ?? 0) : pr.comments;
  const waitingSince = followUp && group !== "archived" && group !== "draft" && !Number.isNaN(Date.parse(followUp.waiting_since)) ? followUp.waiting_since : null;
  const excerptAt = followUp?.excerpt_at && !Number.isNaN(Date.parse(followUp.excerpt_at)) ? formatDate(new Date(followUp.excerpt_at), language, now) : null;
  const header = (
    <div className="grid min-w-0 gap-1.5">
      {/* The dialog's name, as it has always been: "Comments · repo #n". */}
      <span id={nameId} hidden>
        {`${t("comments")} · ${pr.repo} #${pr.number}`}
      </span>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-caption text-fg-muted">
          {pr.repo} <span className="text-fg-subtle tabular-nums">#{pr.number}</span>
        </p>
        {/* The pane's and the sheet's own tools sit in the header, where they are on screen however long the activity below runs, and the sheet's footer is left to the follow-up verbs alone. */}
        <div className="-my-1 flex shrink-0 items-center gap-1">
          <LinkButton href={link} external newTabLabel={t("inbox.newTab")} size="sm" variant="ghost">
            {t("viewGitHub")}
          </LinkButton>
          <IconButton icon={RefreshCw} size="sm" label={activity.isFetching ? t("refreshing") : t("refresh")} busy={activity.isFetching} onClick={() => void activity.refetch()} />
        </div>
      </div>
      <h2 id={titleId} className="text-title font-semibold text-fg [overflow-wrap:anywhere]">
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-fg no-underline decoration-fg-subtle underline-offset-2 hover:underline">
          {pr.title}
          <span className="sr-only"> ({t("inbox.newTab")})</span>
        </a>
      </h2>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
        {group && <FactChip tone={groupTone[group]}>{t(`followup.${group}`)}</FactChip>}
        {waitingSince && <Time value={waitingSince} mode="age" />}
        {comments !== undefined && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquare size={12} aria-hidden="true" />
            <span aria-hidden="true">{comments}</span>
            <span className="sr-only">{t("inbox.commentCount", { count: comments })}</span>
          </span>
        )}
      </div>
    </div>
  );
  const why = followUp && (followUp.reasons.length > 0 || followUp.excerpt) && (
    <section className="grid min-w-0 gap-2">
      <h3 className="text-small font-semibold text-fg">{t("inbox.whyHere")}</h3>
      {followUp.reasons.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {followUp.reasons.map((reason) => {
            const tone = reasonTone(reason) as Tone;
            const Icon = reasonIcon[tone];
            return (
              <li key={reason} className="flex items-center gap-2 text-body text-fg">
                <Icon size={14} aria-hidden="true" className={cx("shrink-0", toneText[tone])} />
                {t(`followup.${reason}`)}
              </li>
            );
          })}
        </ul>
      )}
      {!handledIsUseful(followUp) && <p className="text-caption text-fg-muted">{t("followup.blockedByGitHub")}</p>}
      {followUp.excerpt && (
        <blockquote className="m-0 grid gap-1 border-l-2 border-line py-0.5 pl-3">
          <p className="text-body whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">“{followUp.excerpt}”</p>
          <cite className="text-caption text-fg-subtle not-italic">
            — {followUp.excerpt_by || t("unknown")}
            {excerptAt && <> · {excerptAt}</>}
          </cite>
        </blockquote>
      )}
    </section>
  );
  const body = (
    <div className="grid min-w-0 gap-6">
      {why}
      {activity.isLoading && <ActivitySkeleton />}
      {activity.isError && !activity.data && (
        <Notice
          tone="danger"
          role="alert"
          actions={
            <Button size="sm" onClick={() => void activity.refetch()}>
              {t("retry")}
            </Button>
          }
        >
          {t("unableComments")}
        </Notice>
      )}
      {activity.data && <ActivityPanel data={activity.data} />}
    </div>
  );
  if (mode === "pane")
    return (
      <section aria-labelledby={titleId} data-testid="detail-pane" className="sticky top-4 flex max-h-[calc(100dvh-32px)] min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <header className="shrink-0 border-b border-line px-4 py-3">{header}</header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{body}</div>
      </section>
    );
  return (
    <Sheet open onClose={detail.close} side="right" labelledBy={nameId} returnFocusTo={detail.opener} closeLabel={t("close")} header={header} footer={followUp && <SheetFollowUp item={followUp} now={now} />}>
      {body}
    </Sheet>
  );
}
