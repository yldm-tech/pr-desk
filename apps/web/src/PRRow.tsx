import { CircleX, Clock, MessageSquare } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { groupOf, reasonTone, type FollowUp } from "./followup-view";
import { checksChip, prGitHubURL, prTone, statusKey, type PR } from "./pr-model";
import { reasonIcon, type Tone } from "./tone";
import { Button, cx } from "./ui-controls";
import { FactChip, StateGlyph, Time } from "./ui-display";
import { ItemRow, itemTracks } from "./ui-list";

// Where each cell sits in the two bands of the table track contract (2 tracks below `row`, 5 from it). The DOM order is the column order, so a screen reader's table navigation pairs every cell with its own header; the narrow card is arranged by placement alone. Every band states both start and end, because a longhand only unsets what the shorthand below it wrote when both are given.
// Narrow: a two-column card. The title with its age at the right, the repository with the comment count at the right, then the status and its chips across the width, all indented to the title past the glyph (20px plus the 8px gap). From `row`: one line, five columns.
const cell = {
  repository: "col-start-1 col-end-2 row-start-2 min-w-0 self-center pl-7 @row/dashboard:pl-0 @row/dashboard:col-start-2 @row/dashboard:col-end-3 @row/dashboard:row-start-1 @row/dashboard:self-start",
  status: "col-start-1 col-end-3 row-start-3 flex min-w-0 flex-wrap items-center gap-1.5 pl-7 @row/dashboard:pl-0 @row/dashboard:col-start-3 @row/dashboard:col-end-4 @row/dashboard:row-start-1",
  updated: "col-start-2 col-end-3 row-start-1 justify-self-end pt-0.5 text-caption whitespace-nowrap text-fg-muted tabular-nums @row/dashboard:col-start-4 @row/dashboard:col-end-5 @row/dashboard:text-right",
  activity: "col-start-2 col-end-3 row-start-2 self-center justify-self-end @row/dashboard:col-start-5 @row/dashboard:col-end-6 @row/dashboard:row-start-1 @row/dashboard:self-start @row/dashboard:-mt-1",
};

// The same visually-hidden recipe ItemList's own header uses: in the accessibility tree at every width, painted only once the columns exist.
const hiddenUntilRow = "absolute h-px w-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)] @row/dashboard:static @row/dashboard:h-auto @row/dashboard:w-auto @row/dashboard:overflow-visible @row/dashboard:whitespace-normal @row/dashboard:[clip-path:none]";

// The column headers, always five and always in the accessibility tree, painted from `row` where every column has its own track.
export function PRTableHeader({ labels }: { labels: [string, string, string, string, string] }) {
  const [pullRequest, repository, status, updated, activity] = labels;
  return (
    <div role="row" className={cx("grid gap-x-3 text-small font-medium text-fg-muted @row/dashboard:border-b @row/dashboard:border-line @row/dashboard:px-3 @row/dashboard:py-2", itemTracks.table, hiddenUntilRow)}>
      <span role="columnheader" className="min-w-0 truncate @row/dashboard:pl-7">
        {pullRequest}
      </span>
      <span role="columnheader" className="min-w-0 truncate">
        {repository}
      </span>
      <span role="columnheader" className="min-w-0 truncate">
        {status}
      </span>
      <span role="columnheader" className="min-w-0 truncate text-right">
        {updated}
      </span>
      <span role="columnheader" className="min-w-0 text-right">
        {activity}
      </span>
    </div>
  );
}

// The follow-up chip takes the tone of the row's most urgent reason rather than of the state word, so a conflict reads the same here as it does in the Inbox; blocked wins outright because the reasons array is not ordered by severity.
function followUpTone(item: FollowUp): Tone {
  const tones = item.reasons.map(reasonTone) as Tone[];
  return tones.includes("blocked") ? "blocked" : (tones.find((tone) => tone !== "neutral") ?? "neutral");
}

export function PRRow({ pr, followUp, now, active, onFilterRepository, onOpen, ref }: { pr: PR; followUp?: FollowUp; now: number; active: boolean; onFilterRepository: (repo: string) => void; onOpen: (opener: HTMLElement | null) => void; ref?: Ref<HTMLElement> }) {
  const { t } = useTranslation();
  const { tone, kind } = prTone(pr);
  const href = prGitHubURL(pr);
  const group = followUp ? groupOf(followUp, now) : null;
  // Say it once: a draft follow-up on a draft row, or an archived one on a merged or closed row, repeats the status word beside it.
  const groupChip = followUp && group !== "draft" && group !== "archived";
  const checks = checksChip(pr.checks_status);
  const chipTone = followUp ? followUpTone(followUp) : "neutral";
  return (
    <ItemRow
      ref={ref}
      as="div"
      role="row"
      tracks="table"
      id={`pr-row-${pr.id}`}
      tabIndex={-1}
      aria-keyshortcuts="j k Enter o"
      active={active}
      onBodyClick={() => onOpen(document.querySelector<HTMLElement>(`#pr-row-${pr.id} [data-testid="pr-activity"]`))}
      className="focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      glyph={<StateGlyph tone={tone} kind={kind} />}
      title={
        <>
          <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-sm text-fg no-underline decoration-1 underline-offset-2 hover:text-accent-text hover:underline">
            {pr.title}
            <span className="sr-only"> ({t("prs.newTab")})</span>
          </a>
          <span className="ml-1.5 font-normal whitespace-nowrap text-fg-subtle tabular-nums">#{pr.number}</span>
        </>
      }
    >
      <div role="cell" className={cell.repository}>
        {/* Filters this list to the repository rather than leaving for github.com: the title link already covers going to GitHub, and the repository chip above the table is the way back out. */}
        <button
          type="button"
          title={pr.repo}
          aria-label={t("filterToRepository", { repo: pr.repo })}
          onClick={() => onFilterRepository(pr.repo)}
          className="max-w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left text-caption text-fg-muted [overflow-wrap:anywhere] hover:text-fg hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          {pr.repo}
        </button>
      </div>
      <div role="cell" className={cell.status}>
        <span className="text-small font-medium text-fg">{t(statusKey(pr.status), { defaultValue: pr.status })}</span>
        {groupChip && (
          <span data-testid="row-follow-up" className="inline-flex min-w-0">
            <FactChip tone={chipTone} icon={reasonIcon[chipTone]}>
              {t(`followup.${group}`)}
            </FactChip>
          </span>
        )}
        {pr.conflict && (
          <FactChip tone="blocked" icon={reasonIcon.blocked}>
            {t("conflict")}
          </FactChip>
        )}
        {checks && (
          <FactChip tone={checks === "failing" ? "blocked" : "neutral"} icon={checks === "failing" ? CircleX : Clock}>
            {t(checks === "failing" ? "prs.ciFailing" : "prs.ciPending")}
          </FactChip>
        )}
      </div>
      <div role="cell" className={cell.updated}>
        {pr.updated_at && !Number.isNaN(Date.parse(pr.updated_at)) ? <Time value={pr.updated_at} mode="age" /> : t("unknown")}
      </div>
      <div role="cell" className={cell.activity}>
        {/* The count is a lifetime total and reads the same whether the last comment arrived in March or four minutes ago. The unread dot is a shape rather than a colour, and the accessible name changes with it, so the signal survives both greyscale and a screen reader. */}
        {/* The count leads the accessible name, as it leads what is on screen, and the repository makes the name unique across repositories that reuse a number. The unread dot always has its slot, so the counts line up down the column whether a row is unread or not. */}
        <Button data-testid="pr-activity" variant="ghost" size="sm" icon={MessageSquare} title={t("viewActivity")} aria-label={t(followUp?.unread ? "prs.activityUnread" : "prs.activity", { count: pr.comments ?? 0, repo: pr.repo, number: pr.number })} onClick={(event) => onOpen(event.currentTarget)} className="tabular-nums">
          {pr.comments}
          {followUp?.unread ? <span data-testid="unread-dot" aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" /> : <span aria-hidden="true" className="size-1.5 shrink-0" />}
        </Button>
      </div>
    </ItemRow>
  );
}
