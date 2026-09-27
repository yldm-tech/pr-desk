import { CheckCheck, PanelRight } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { FollowUpActionHandle } from "./followup-actions";
import { primaryAction, type FollowUp, type RowVerb } from "./followup-view";
import { prGitHubURL } from "./pr-model";
import { SnoozePopover } from "./SnoozePopover";
import { useMediaQuery } from "./media-query";
import { Button, IconButton, LinkButton } from "./ui-controls";

// Snooze and Mark read wait behind the row on a mouse until it is hovered, focused or under the cursor, so a list of rows reads as titles rather than as a wall of buttons. They wait out of the layout, in an overlay anchored to the left of the verbs that are always shown, so the always-shown verbs end at the same x in every row whichever hidden ones a row has. Only where hover exists: on a touch screen a control that appears on hover never appears, so there every verb is in the line.
const reveal =
  "absolute top-1/2 right-full mr-1.5 flex -translate-y-1/2 items-center gap-1 rounded-md bg-bg opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:bg-bg-subtle group-hover:opacity-100 group-focus-within:opacity-100 group-data-active:bg-bg-muted group-data-active:opacity-100 has-[[data-state=open]]:opacity-100";

// Every verb a follow-up offers. What is offered comes from primaryAction(), the same table the keys read. Each accessible name is "{verb} — {repo} #{number}", starting with the words on the button.
// row: an Inbox row in the list; row-split: the same row beside the detail pane. On a row the deferral and Mark read are icons: on a mouse they sit in the hover overlay to the left of the primary, so the DOM order is the order on screen (deferral, read, primary, detail); on touch they follow the primary in the line. sheet: the footer of the modal detail sheet, where there is room for words and nothing is hidden.
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
  controls,
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
  // The id of the region Show activity fills, when it fills one on the page (the split view's pane) rather than opening a sheet.
  controls?: string;
}) {
  const { t } = useTranslation();
  // A mouse or trackpad: hover can reveal the overlay. Paired with a fine pointer because touch devices with a stylus or emulation can report hover while a finger is what taps the row.
  const hover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const verbs = primaryAction(item, now);
  const busy = action.isBusy;
  const row = variant !== "sheet";
  const size = row ? "sm" : "md";
  const actionFor = (label: string) => t("followup.actionFor", { action: label, repo: item.pr.repo, number: item.pr.number });
  const link = prGitHubURL(item.pr);
  const group = useRef<HTMLDivElement>(null);
  // Mark read only exists while the row is unread, so the button a keyboard user just pressed disappears once the read lands and focus would fall to <body>. When it does, focus goes to a neighbour that stays: the row itself (the list's own focus target), or in the sheet the first verb left in the footer.
  const readPressed = useRef(false);
  useEffect(() => {
    if (item.unread || !readPressed.current) return;
    readPressed.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const container = group.current;
    const target = row ? container?.closest<HTMLElement>("[data-testid='follow-up-card']") : container?.querySelector<HTMLElement>("button:not(:disabled), a[href]");
    target?.focus({ preventScroll: true });
  }, [item.unread, row]);
  const markRead = () => {
    readPressed.current = true;
    action.mutate({ action: "read" });
  };
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
    return <SnoozePopover key="snooze" ref={snoozeRef} label={actionFor(t("followup.snooze"))} compact={row} disabled={busy} open={snoozeOpen} onOpenChange={onSnoozeOpenChange} settings={settings} onSnooze={(until) => action.mutate({ action: "snooze", until: until.toISOString() })} />;
  };
  const shown = [verbs.primary, ...verbs.secondary.filter((verb) => verb !== "snooze")].filter((verb): verb is RowVerb => !!verb);
  const snooze = verbs.secondary.includes("snooze") && render("snooze", false);
  const read =
    verbs.markRead &&
    (row ? (
      <IconButton key="read" icon={CheckCheck} size="sm" label={actionFor(t("followup.read"))} disabled={busy} onClick={markRead} />
    ) : (
      <Button key="read" size="md" icon={CheckCheck} disabled={busy} aria-label={actionFor(t("followup.read"))} onClick={markRead}>
        {t("followup.read")}
      </Button>
    ));
  // On a narrow touch row the whole row opens the sheet, so the detail button would only be a fourth icon forcing the line to wrap; from the list's `row` width, and wherever there is a pointer, it stays.
  const detail = row && onShowActivity && (
    <IconButton icon={PanelRight} size="sm" label={actionFor(t("inbox.showActivity"))} aria-controls={controls} onClick={(event) => onShowActivity(event.currentTarget)} className={variant === "row" && !hover ? "@max-row/list:hidden" : undefined} />
  );
  if (!row)
    return (
      <div ref={group} role="group" aria-label={t("inbox.rowActions")} className="flex min-w-0 flex-wrap items-center gap-2">
        {shown.map((verb, index) => render(verb, index === 0 && verb === verbs.primary))}
        {snooze}
        {read}
      </div>
    );
  if (!hover)
    return (
      <div ref={group} role="group" aria-label={t("inbox.rowActions")} className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown.map((verb, index) => render(verb, index === 0 && verb === verbs.primary))}
        {snooze}
        {read}
        {detail}
      </div>
    );
  return (
    <div ref={group} role="group" aria-label={t("inbox.rowActions")} className="flex min-w-0 items-center justify-end gap-1.5">
      <span className="relative inline-flex min-w-0 items-center gap-1.5">
        {(snooze || read) && (
          <span className={reveal}>
            {snooze}
            {read}
          </span>
        )}
        {shown.map((verb, index) => render(verb, index === 0 && verb === verbs.primary))}
      </span>
      {detail}
    </div>
  );
}
