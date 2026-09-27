import { CheckCheck, PanelRight } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { safeGitHubLink } from "./activity-model";
import type { FollowUpActionHandle } from "./followup-actions";
import { primaryAction, type FollowUp, type RowVerb } from "./followup-view";
import { SnoozePopover } from "./SnoozePopover";
import { Button, cx, IconButton, LinkButton } from "./ui-controls";

// The pull request on GitHub: the server's URL when it is a safe github.com link, otherwise the canonical address built from the repository and number.
export const gitHubURL = (pr: FollowUp["pr"]) => safeGitHubLink(pr.url || "") ?? `https://github.com/${pr.repo}/pull/${pr.number}`;

// Snooze and Mark read wait behind the row on a mouse until it is hovered, focused or under the cursor, so a list of rows reads as titles rather than as a wall of buttons. Only where hover exists: on a touch screen a control that appears on hover never appears.
const reveal = "hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100 hoverable:group-data-active:opacity-100 hoverable:data-[state=open]:opacity-100 transition-opacity duration-[var(--dur-fast)]";

// Every verb a follow-up offers, in one fixed order (the primary, the deferral, then the incidental ones) so the irreversible button never changes place between adjacent rows. What is offered comes from primaryAction(), the same table the keys read. Each accessible name is "{verb} — {repo} #{number}", starting with the words on the button.
// row: an Inbox row in the list; row-split: the same row beside the detail pane, where the rail is narrow and the deferral is an icon; sheet: the footer of the modal detail sheet, where there is room for words and nothing is hidden.
export function FollowUpActions({
  item,
  variant,
  action,
  now,
  emphasis,
  settings,
  snoozeOpen,
  onSnoozeOpenChange,
  snoozeRef,
  onShowActivity,
}: {
  item: FollowUp;
  variant: "row" | "row-split" | "sheet";
  action: FollowUpActionHandle;
  now: Date;
  // Whether the primary is drawn as the page's primary button. Only the row under the cursor gets it, so the list is not four identical purple buttons.
  emphasis: boolean;
  settings?: { timezone: string; digest_time: string };
  snoozeOpen: boolean;
  onSnoozeOpenChange: (open: boolean) => void;
  snoozeRef?: RefObject<HTMLButtonElement | null>;
  onShowActivity?: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const verbs = primaryAction(item, now);
  const busy = action.isBusy;
  const row = variant !== "sheet";
  const size = row ? "sm" : "md";
  const actionFor = (label: string) => t("followup.actionFor", { action: label, repo: item.pr.repo, number: item.pr.number });
  const link = gitHubURL(item.pr);
  const render = (verb: RowVerb, primary: boolean) => {
    const variantName = primary && (emphasis || !row) ? "primary" : "secondary";
    if (verb === "handled")
      return (
        <Button key="handled" size={size} variant={variantName} disabled={busy} aria-label={actionFor(t("followup.handled"))} onClick={() => action.mutate({ action: "handled" })}>
          {t("inbox.handledShort")}
        </Button>
      );
    if (verb === "unsnooze")
      return (
        <Button key="unsnooze" size={size} variant={variantName} disabled={busy} aria-label={actionFor(t("followup.cancelReminder"))} onClick={() => action.mutate({ action: "unsnooze" })}>
          {t("followup.cancelReminder")}
        </Button>
      );
    if (verb === "merge" || verb === "open") {
      const label = t(verb === "merge" ? "inbox.mergeOnGitHub" : "inbox.openOnGitHub");
      return (
        <LinkButton key={verb} size={size} variant={variantName} href={link} external aria-label={actionFor(label)} aria-disabled={busy || undefined}>
          {label}
        </LinkButton>
      );
    }
    return (
      <SnoozePopover
        key="snooze"
        ref={snoozeRef}
        label={actionFor(t("followup.snooze"))}
        compact={variant === "row-split"}
        disabled={busy}
        open={snoozeOpen}
        onOpenChange={onSnoozeOpenChange}
        settings={settings}
        onSnooze={(until) => action.mutate({ action: "snooze", until: until.toISOString() })}
        triggerClassName={row ? reveal : undefined}
      />
    );
  };
  return (
    <div role="group" aria-label={t("inbox.rowActions")} className={cx("flex min-w-0 flex-wrap items-center gap-1.5", variant === "row-split" && "justify-end", variant === "sheet" && "gap-2")}>
      {verbs.primary && render(verbs.primary, true)}
      {verbs.secondary.map((verb) => render(verb, false))}
      {verbs.markRead &&
        (row ? (
          <IconButton icon={CheckCheck} size="sm" label={actionFor(t("followup.read"))} disabled={busy} onClick={() => action.mutate({ action: "read" })} className={reveal} />
        ) : (
          <Button size="md" icon={CheckCheck} disabled={busy} aria-label={actionFor(t("followup.read"))} onClick={() => action.mutate({ action: "read" })}>
            {t("followup.read")}
          </Button>
        ))}
      {row && onShowActivity && <IconButton icon={PanelRight} size="sm" label={actionFor(t("inbox.showActivity"))} onClick={(event) => onShowActivity(event.currentTarget)} />}
    </div>
  );
}
