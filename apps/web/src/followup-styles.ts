// The follow-up summary on the overview and the workspace that lists the same
// work in full. Variant prefixes are written out: Tailwind finds classes by
// scanning the source for complete names.
import { syncFeedbackFloating } from "./app-styles";

const panel = "mb-6 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] @row/dashboard:p-6";

export const followUpSummary = panel;
export const followUpWorkspace = `${panel} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]`;

export const followUpCounts = [
  "mb-6 grid grid-cols-2 gap-3 @row/dashboard:grid-cols-4",
  "[&_a]:flex [&_a]:flex-col [&_a]:gap-2 [&_a]:rounded-xl [&_a]:bg-[var(--accent-soft)] [&_a]:p-4 [&_a]:text-[var(--accent-text)] [&_a]:no-underline",
  // The blocked tile borrows the tone the reason chips already use, so the count that matters most is legible before its label is read. Written as a data attribute rather than a second class so the tile list stays data and the styling stays here.
  "[&_a[data-tone=blocked]]:bg-[var(--danger-soft)] [&_a[data-tone=blocked]]:text-[var(--danger)]",
  "[&_strong]:text-[length:1.75rem] [&_span]:text-[length:0.8125rem]",
].join(" ");

// Finished work, kept reachable and kept quiet: a caption-weight row under the list rather than a quarter of the tile grid.
export const followUpMergedLink = "mx-0 mt-4 mb-0 flex items-center gap-2 text-[length:0.75rem] text-[var(--muted)] [&_a]:text-[var(--muted)] [&_a]:underline [&_a]:underline-offset-[3px] [&_span]:[font-variant-numeric:tabular-nums] hoverable:[&_a:hover]:text-[var(--accent-text)]";

export const followUpPriority = ["mx-0 mt-3 mb-0 list-none p-0", "[&_a]:flex [&_a]:flex-col [&_a]:gap-1.5 [&_a]:border-t [&_a]:border-[var(--border)] [&_a]:py-3 [&_a]:text-[var(--foreground)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere]", "[&_small]:text-[length:0.75rem] [&_small]:text-[var(--muted)]"].join(" ");

export const followUpPriorityReasons = "flex flex-wrap gap-1.5";

// `unread` is row.Version > row.ReadVersion — genuinely new activity, and the one signal on the card that saves the reader time. It used to be the third item in a 12px muted run-on line, indistinguishable from the role beside it, so twenty cards meant reading twenty headings. The accent rule turns the unread rows into a column down the left edge that is legible without reading anything; the word stays in the heading for assistive technology.
export const followUpCard =
  "border-t border-[var(--border)] py-5 [scroll-margin-top:20px] data-[unread]:border-l-2 data-[unread]:border-l-[var(--accent)] data-[unread]:pl-3 [&>h3]:mx-0 [&>h3]:my-2.5 [&>h3]:text-[length:1rem] [&>h3]:[overflow-wrap:anywhere] [&>h3>a]:text-[var(--foreground)] [&>h3>a]:no-underline data-[unread]:[&>h3]:font-semibold";

// A heading for each non-empty group, carrying its own count. The count is what survives a missed status strip: acting on a card drops it out of the group and the number beside the heading goes down, so the result of an action is visible even when the confirmation is not.
export const followUpGroupHeading = "mt-6 mb-0 flex min-w-0 flex-wrap items-baseline gap-2 text-[length:0.75rem] font-semibold text-[var(--muted)] first:mt-0";

// The collapsed <details> the Muted group lives in: deferred work should be reachable without being in the way. The summary takes the same coarse-pointer floor as every other control on the page, because opening it is the only route back to Cancel reminder.
export const followUpMutedGroup =
  "mt-6 first:mt-0 [&>summary]:flex [&>summary]:min-w-0 [&>summary]:cursor-pointer [&>summary]:flex-wrap [&>summary]:items-center [&>summary]:gap-2 [&>summary]:rounded-lg [&>summary]:border [&>summary]:border-[var(--border)] [&>summary]:bg-[var(--surface-muted)] [&>summary]:px-3 [&>summary]:py-2 [&>summary]:text-[length:0.75rem] [&>summary]:font-semibold [&>summary]:text-[var(--muted)] pointer-coarse:[&>summary]:min-h-11";

// The result of an action. Visually the same treatment the settings page uses for a saved change — same border, surface, padding and type — but spelled out here rather than aliased to `syncFeedback`, because that banner's descendant rules were written for a lone dismiss glyph: `[&_button]:grid [&_button]:place-items-center [&_button]:text-[length:1.25rem] [&_button]:text-inherit` is a class plus a type selector, so it beats the plain single-class utilities of anything placed inside and drew Undo — the only route back from a waiting clock that `handled` has already overwritten — as a 20px grid box in the success green, reading as part of the "it worked" sentence rather than as the way out of it. Scoping the glyph rules to `[&_button[aria-label]]` keeps them on the dismiss control, which is the only button here that names itself that way, and leaves a labelled action button with `linkAction`'s accent colour and inherited font.
// Only the sentence inside is aria-hidden at the call site, never the strip: the workspace announces through its own sr-only live region and a second copy would say everything twice, but an interactive control inside an aria-hidden subtree is unreachable entirely.
export const followUpStatusStrip = [
  "mx-0 mt-0 mb-[18px] flex items-start justify-between gap-4 rounded-[9px] border border-[var(--success-border)] bg-[var(--success-soft)] px-4 py-3 text-[length:0.75rem] leading-[1.6] text-[var(--success)]",
  "[&_button[aria-label]]:grid [&_button[aria-label]]:cursor-pointer [&_button[aria-label]]:place-items-center [&_button[aria-label]]:border-0 [&_button[aria-label]]:bg-transparent [&_button[aria-label]]:text-[length:1.25rem] [&_button[aria-label]]:leading-none [&_button[aria-label]]:text-inherit",
  "pointer-coarse:[&_button[aria-label]]:-m-2 pointer-coarse:[&_button[aria-label]]:min-h-11 pointer-coarse:[&_button[aria-label]]:min-w-11",
].join(" ");

// The success strip floats, the failure strip stays in the flow — the rule the sync notice already follows, for a stronger reason here. In normal flow this sits above the heading, the filter row and every card, while the successor-focus effect deliberately leaves the reader down at the card they just acted on: act on the sixth row and the confirmation and its Undo render several hundred pixels off the top of the viewport, are never seen, and are gone before the reader scrolls back. Pinned bottom-right it is where the eyes are at the moment the mistake registers.
export const followUpStatusStripFloating = `${followUpStatusStrip} ${syncFeedbackFloating}`;

// The first span carries the repository slug, which is user-controlled and may
// have no break opportunity at all. A flex item defaults to min-width:auto, so
// without these a slug longer than the line box cannot shrink, overflows the
// card, and — the panel being in normal flow with no clipping — hands the whole
// document a horizontal scrollbar.
export const followUpCardHeading = "flex min-w-0 flex-wrap justify-between gap-3 text-[length:0.75rem] text-[var(--muted)] [&>span]:min-w-0 [&>span]:[overflow-wrap:anywhere]";

export const followUpWait = "text-[length:0.75rem] text-[var(--muted)]";

export const followUpReasons = "flex flex-wrap items-center gap-2";

// The tone decides the colour; the compact spelling is used in the summary list. `ready` is here rather than on a chip type of its own now that the second chip row is gone: "Ready to merge" is the one thing a card can say that is worth a positive colour, and the reason tones had no green until it moved in. The compact variant derives by replacing the padding, which is still the single occurrence of `px-2 py-1` in the string — keep it that way when adding a tone.
export const followUpReason =
  "rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[length:0.75rem] leading-[1.5] text-[var(--muted)] data-[tone=action]:bg-[var(--warning-soft)] data-[tone=action]:text-[var(--warning)] data-[tone=blocked]:bg-[var(--danger-soft)] data-[tone=blocked]:text-[var(--danger)] data-[tone=waiting]:bg-[var(--info-soft)] data-[tone=waiting]:text-[var(--info)] data-[tone=ready]:bg-[var(--success-soft)] data-[tone=ready]:text-[var(--success)]";

export const followUpReasonCompact = followUpReason.replace("px-2 py-1", "px-[7px] py-0.5");

// The 96px scroller was sized for a desktop-width excerpt. Narrower than a card
// row the same text wraps to roughly twice the lines, so it turns into a scroll
// trap: a swipe that starts on the excerpt scrolls the excerpt rather than the
// page, and touch renders no scrollbar to say why. Below that width it clamps
// by lines instead, which has no hidden interaction to discover.
export const followUpExcerpt =
  "mx-0 my-3 max-h-24 overflow-y-auto whitespace-pre-wrap text-[var(--muted)] [overflow-wrap:anywhere] @max-row/dashboard:max-h-none @max-row/dashboard:overflow-hidden @max-row/dashboard:[display:-webkit-box] @max-row/dashboard:[-webkit-line-clamp:4] @max-row/dashboard:[-webkit-box-orient:vertical]";

// The excerpt is somebody else's sentence sitting between the reader's own reason chips and the buttons that act on them, and as a bare paragraph it reads as the application talking. A left rule and the quotation element say whose words they are without adding a word of copy. The clamp behaviour above is kept exactly: the scroll trap it avoids on a narrow card is unrelated to whose voice this is.
// The attribution sits above the words as a caption rather than beside them: at 320px a name and a date on the same line as the quote push it into a two-character column.
export const followUpQuote = `${followUpExcerpt} border-l-2 border-[var(--border)] pl-3 [&_cite]:mb-1 [&_cite]:block [&_cite]:text-[length:0.75rem] [&_cite]:not-italic [&_cite]:text-[var(--muted)]`;

// The snooze <summary> is the sole entry point to the snooze controls and sits
// in a wrapping row beside buttons that post irreversible mutations, so on a
// coarse pointer it takes the same 44px floor as its neighbours and the row
// opens up enough that the targets are not flush against each other. Both are
// keyed off the pointer rather than the width: the target size is a property of
// the finger, not of the viewport, and every mouse width stays exactly as it
// was. inline-flex is what centres the label inside that floor; it costs the UA
// disclosure triangle, which is the cheaper loss of the two on a device where
// the control is otherwise a 34px target wedged 8px from "Handled".
//
// That loss is now paid for rather than merely accepted. The summary carries
// the secondary button skin — the same border, surface and radius as the pills
// beside it — at every pointer, because it was the one recoverable control on
// the card and the only one that did not look like a control at all: bare text
// next to an accent-filled Handled reads as a label, not as the way out. The
// caret it replaces the triangle with is written at the call site, since a
// pseudo-element cannot rotate with the open state as cheaply as a character can
// be swapped.
export const followUpActions = [
  "mt-3 flex flex-wrap items-center gap-2 text-[length:0.75rem] pointer-coarse:gap-2.5",
  "[&_summary]:inline-flex [&_summary]:min-h-10 [&_summary]:cursor-pointer [&_summary]:items-center [&_summary]:gap-1.5 [&_summary]:rounded-lg [&_summary]:border [&_summary]:border-[var(--border)] [&_summary]:bg-[var(--surface)] [&_summary]:px-2.5 [&_summary]:py-[7px] [&_summary]:font-medium [&_summary]:text-[var(--foreground)] [&_summary]:[list-style:none]",
  "hoverable:[&_summary]:hover:bg-[var(--surface-muted)]",
  "pointer-coarse:[&_summary]:min-h-11",
].join(" ");

// One accent-filled button per card, for Handled, at a fixed position. Everything on the card used to be the same neutral grey pill, and the leading "Mark read" was conditional, so the same screen coordinate meant "mark read" on one card and the unrecoverable "handled" on the one below it. Geometry is inlineAction's and the skin is primaryAction's, both spelled out rather than composed, because a second padding utility in the same class attribute does not override the first.
export const followUpPrimaryAction = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--accent-text)] bg-[var(--accent-text)] px-2.5 py-[7px] text-[length:0.75rem] font-medium text-[var(--surface)] no-underline hover:bg-[var(--accent)] pointer-coarse:min-h-11";

export const followUpSnooze = [
  "flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-muted)] p-3",
  "[&_label]:flex [&_label]:flex-col [&_label]:gap-2 [&_label]:text-[length:0.8125rem]",
  "[&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--border)] [&_input]:bg-[var(--surface)] [&_input]:px-3 [&_input]:py-[9px] [&_input]:text-[var(--foreground)]",
  // A datetime-local picker is the fiddliest control on the card, which makes 38px the wrong height for it above all others. The sweep in tests/browser/layout.spec.ts queries `input` as of this pass, so this floor is now discoverable rather than merely asserted here — it stays written because the picker's own answer to "how tall should this be" is the UA's, not the design's.
  "pointer-coarse:[&_input]:min-h-11",
].join(" ");

export const followUpFilters = [
  "mx-0 my-[18px] flex flex-wrap items-center justify-between gap-2",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2",
  "[&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:px-3 [&_select]:py-[9px] [&_select]:text-[var(--foreground)]",
  "pointer-coarse:[&_select]:min-h-11",
  "[&_[aria-pressed=true]]:border-[var(--accent)] [&_[aria-pressed=true]]:bg-[var(--accent-soft)] [&_[aria-pressed=true]]:text-[var(--accent-text)]",
].join(" ");
