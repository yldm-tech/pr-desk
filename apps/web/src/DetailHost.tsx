import React from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, RefreshCw } from "lucide-react";
import { ActivityDialog } from "./ActivityDialog";
import { ActivityPanel } from "./ActivityPanel";
import { ActivitySkeleton } from "./LoadingSkeleton";
import { linkAction, secondaryAction } from "./action-styles";
import { spinning } from "./app-styles";
import { useDetail } from "./detail-context";
import { followUpErrorMessage, useFollowUpAction } from "./followup-actions";
import { factsSurvive, groupOf, handledIsUseful, isMuted, type FollowUp } from "./followup-view";
import { useActivity, useAuth, useFollowUps } from "./queries";

// A decision recorded from the table is the same decision recorded in the workspace: both post through useFollowUpAction, so there is one mutation, one optimistic prediction and one set of rules about which verbs can actually do something. Its own component because the hook cannot be called from a branch that exists only while the dialog is open, and because reading the thread is what marks the item read.
function DialogFollowUpActions({ item, now }: { item: FollowUp; now: number }) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = React.useState("");
  // Whether the last action left a step on the server to go back to. Local rather than read off `item.undoable`, because that flag only says the row holds some unconsumed snapshot — it survives a reload, names no action and belongs to whichever surface acted last, so rendering Undo from it would offer to restore a state this reader never saw.
  const [undoable, setUndoable] = React.useState(false);
  const action = useFollowUpAction({
    item,
    onDone: (input) => {
      if (input.action === "read") return;
      if (input.action === "undo") {
        setUndoable(false);
        setFeedback(t("followup.undone"));
        return;
      }
      // Mirrors the server's own snapshot guard at followup_store.go: every action except `read` and `undo` stores the step before it, and none of them bump Version, so the item the refetch returns still carries the version undo has to post.
      setUndoable(true);
      const verb = input.action === "handled" ? t("followup.handled") : input.action === "unsnooze" ? t("followup.cancelReminder") : t("followup.snooze");
      // Handled clears the confirmation but not a conflict or a red build, which presentation() re-derives from GitHub on every read. Saying so is what stops the reader tapping a button that already worked.
      setFeedback(t("followup.announceAction", { action: verb, title: item.pr.title }) + (input.action === "handled" && factsSurvive(item) ? " " + t("followup.stillListed") : ""));
    },
    onFailed: (error) => setFeedback(followUpErrorMessage(error, t)),
  });
  const marked = React.useRef<number | null>(null);
  React.useEffect(() => {
    // Reading every comment here is the demonstration that the item has been seen; without this the workspace went on insisting it was unread and the marker stopped meaning anything. Guarded by the id already posted for, because the invalidation this triggers re-renders with a fresh item object.
    if (!item.unread || marked.current === item.id) return;
    marked.current = item.id;
    action.mutate({ action: "read" });
  }, [action, item.id, item.unread]);
  // The row is finished: merged or closed. collectFollowUps keeps archived rows in the payload and the merged view is built to show them, so the sheet used to offer "Handled · wait for others" and a three-day reminder on a pull request that landed last week — verbs the card withholds outright for the same row and which presentation() cannot act on, because it returns early for a closed PR. The mark-read effect above deliberately stays outside this gate: an archived row can still be unread, the table still paints its dot, and reading the thread is still what clears it.
  const finished = groupOf(item, now) === "archived";
  return (
    <>
      {feedback && (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <p className="m-0 text-[length:0.75rem] text-[var(--muted)]" role="status">
            {feedback}
          </p>
          {/* No timer on this one. The workspace strip clears itself because it sits above a list the reader goes on working through; this is a sheet that exists only until it is dismissed, so the confirmation and its inverse can wait for the reader rather than the other way round. */}
          {undoable && (
            <button className={linkAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "undo" })}>
              {t("followup.undo")}
            </button>
          )}
        </div>
      )}
      {!finished && handledIsUseful(item) && (
        <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "handled" })}>
          {t("followup.handled")}
        </button>
      )}
      {!finished &&
        (isMuted(item, now) ? (
          // The table one row over already shows this row's "Muted" chip, so the only thing the sheet had to offer was muting it again. Cancelling the reminder is the verb the card has here and the sheet did not.
          <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "unsnooze" })}>
            {t("followup.cancelReminder")}
          </button>
        ) : (
          <button className={secondaryAction} disabled={action.isBusy} onClick={() => action.mutate({ action: "snooze", until: new Date(now + 3 * 86400000).toISOString() })}>
            {t("followup.snooze")} · {t("followup.days", { count: 3 })}
          </button>
        ))}
    </>
  );
}

// The one detail surface the shell mounts, opened through useDetail() from any list. It is the activity dialog the pull-request table has always opened, moved out of App.tsx unchanged.
export function DetailHost() {
  const { t } = useTranslation();
  const { target, close } = useDetail();
  const auth = useAuth();
  const followUps = useFollowUps(!!auth.data?.connected);
  const commentsQuery = useActivity(target?.pr.id);
  if (!target) return null;
  const selected = target.pr;
  // Read from the live payload rather than from the target, because acting in the sheet refetches the follow-ups and the buttons have to follow the row's new state. The ids match: collectFollowUps attaches the same PullRequest row the table lists.
  const followUp = followUps.data?.data.find((item) => item.pr.id === selected.id);
  // One reading of "now" per render, so a list cannot straddle a midnight boundary halfway down.
  const now = Date.now();
  return (
    <ActivityDialog key={selected.id} title={`${t("comments")} · ${selected.repo} #${selected.number}`} onClose={close}>
      {commentsQuery.isLoading && <ActivitySkeleton />}
      {commentsQuery.isError && (
        <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-[length:0.8125rem] text-[var(--warning)] [&_ul]:pl-5" role="alert">
          {t("unableComments")}
        </div>
      )}
      {commentsQuery.data && <ActivityPanel data={commentsQuery.data} />}
      {/* Viewport tokens, not container ones: <dialog> is a sibling of <main> and lives in the top layer, so it has no ancestor container and a container query here would match nothing and fall through to base. */}
      {/* The sheet is 100dvh on a phone, so with viewport-fit=cover this row lands on the home indicator unless it carries the inset itself. */}
      <div className="sticky bottom-0 z-[2] mt-auto flex flex-wrap justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-roomy:flex-col max-roomy:items-stretch">
        <a className={secondaryAction} href={selected.url || `https://github.com/${selected.repo}/pull/${selected.number}`} target="_blank" rel="noopener noreferrer">
          {t("viewGitHub")}
          <ExternalLink size={14} />
        </a>
        <button className={secondaryAction} disabled={commentsQuery.isFetching} onClick={() => commentsQuery.refetch()}>
          <RefreshCw size={15} className={commentsQuery.isFetching ? spinning : ""} />
          {commentsQuery.isFetching ? t("refreshing") : t("refresh")}
        </button>
        {/* Only when the row has a follow-up to act on. A PR whose detail sync has not run has no FollowUp row at all, and a disabled button with nothing to explain it is worse than no button. */}
        {followUp && <DialogFollowUpActions item={followUp} now={now} />}
      </div>
    </ActivityDialog>
  );
}
