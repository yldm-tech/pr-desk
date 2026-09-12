// The follow-up summary on the overview and the workspace that lists the same
// work in full. Variant prefixes are written out: Tailwind finds classes by
// scanning the source for complete names.
const panel = "mb-6 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] @row/dashboard:p-6";

export const followUpSummary = panel;
export const followUpWorkspace = `${panel} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]`;

export const followUpCounts = ["mb-6 grid grid-cols-2 gap-3 @row/dashboard:grid-cols-4", "[&_a]:flex [&_a]:flex-col [&_a]:gap-2 [&_a]:rounded-xl [&_a]:bg-[var(--accent-soft)] [&_a]:p-4 [&_a]:text-[var(--accent-text)] [&_a]:no-underline", "[&_strong]:text-[length:1.75rem] [&_span]:text-[length:0.8125rem]"].join(" ");

export const followUpPriority = ["mx-0 mt-3 mb-0 list-none p-0", "[&_a]:flex [&_a]:flex-col [&_a]:gap-1.5 [&_a]:border-t [&_a]:border-[var(--border)] [&_a]:py-3 [&_a]:text-[var(--foreground)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere]", "[&_small]:text-[length:0.75rem] [&_small]:text-[var(--muted)]"].join(" ");

export const followUpPriorityReasons = "flex flex-wrap gap-1.5";

export const followUpCard = "border-t border-[var(--border)] py-5 [scroll-margin-top:20px] [&>h3]:mx-0 [&>h3]:my-2.5 [&>h3]:text-[length:1rem] [&>h3]:[overflow-wrap:anywhere] [&>h3>a]:text-[var(--foreground)] [&>h3>a]:no-underline";

// The first span carries the repository slug, which is user-controlled and may
// have no break opportunity at all. A flex item defaults to min-width:auto, so
// without these a slug longer than the line box cannot shrink, overflows the
// card, and — the panel being in normal flow with no clipping — hands the whole
// document a horizontal scrollbar.
export const followUpCardHeading = "flex min-w-0 flex-wrap justify-between gap-3 text-[length:0.75rem] text-[var(--muted)] [&>span]:min-w-0 [&>span]:[overflow-wrap:anywhere]";

export const followUpWait = "text-[length:0.75rem] text-[var(--muted)]";

export const followUpReasons = "flex flex-wrap items-center gap-2";

// The tone decides the colour; the compact spelling is used in the summary list.
export const followUpReason =
  "rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[length:0.75rem] leading-[1.5] text-[var(--muted)] data-[tone=action]:bg-[var(--warning-soft)] data-[tone=action]:text-[var(--warning)] data-[tone=blocked]:bg-[var(--danger-soft)] data-[tone=blocked]:text-[var(--danger)] data-[tone=waiting]:bg-[var(--info-soft)] data-[tone=waiting]:text-[var(--info)]";

export const followUpReasonCompact = followUpReason.replace("px-2 py-1", "px-[7px] py-0.5");

// The 96px scroller was sized for a desktop-width excerpt. Narrower than a card
// row the same text wraps to roughly twice the lines, so it turns into a scroll
// trap: a swipe that starts on the excerpt scrolls the excerpt rather than the
// page, and touch renders no scrollbar to say why. Below that width it clamps
// by lines instead, which has no hidden interaction to discover.
export const followUpExcerpt =
  "mx-0 my-3 max-h-24 overflow-y-auto whitespace-pre-wrap text-[var(--muted)] [overflow-wrap:anywhere] @max-row/dashboard:max-h-none @max-row/dashboard:overflow-hidden @max-row/dashboard:[display:-webkit-box] @max-row/dashboard:[-webkit-line-clamp:4] @max-row/dashboard:[-webkit-box-orient:vertical]";

// The snooze <summary> is the sole entry point to the snooze controls and sits
// in a wrapping row beside three buttons that post different, mostly
// irreversible mutations, so on a coarse pointer it takes the same 44px floor
// as its neighbours and the row opens up enough that the four targets are not
// flush against each other. Both are keyed off the pointer rather than the
// width: the target size is a property of the finger, not of the viewport, and
// every mouse width stays exactly as it was. inline-flex is what centres the
// label inside that floor; it costs the UA disclosure triangle, which is the
// cheaper loss of the two on a device where the control is otherwise a 34px
// target wedged 8px from "Handled".
export const followUpActions = "mt-3 flex flex-wrap items-center gap-2 text-[length:0.75rem] pointer-coarse:gap-2.5 [&_summary]:cursor-pointer [&_summary]:p-2 pointer-coarse:[&_summary]:inline-flex pointer-coarse:[&_summary]:min-h-11 pointer-coarse:[&_summary]:items-center pointer-coarse:[&_summary]:px-2.5";

export const followUpSnooze = [
  "flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-muted)] p-3",
  "[&_label]:flex [&_label]:flex-col [&_label]:gap-2 [&_label]:text-[length:0.8125rem]",
  "[&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--border)] [&_input]:bg-[var(--surface)] [&_input]:px-3 [&_input]:py-[9px] [&_input]:text-[var(--foreground)]",
].join(" ");

export const followUpFilters = [
  "mx-0 my-[18px] flex flex-wrap items-center justify-between gap-2",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2",
  "[&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:px-3 [&_select]:py-[9px] [&_select]:text-[var(--foreground)]",
  "pointer-coarse:[&_select]:min-h-11",
  "[&_[aria-pressed=true]]:border-[var(--accent)] [&_[aria-pressed=true]]:bg-[var(--accent-soft)] [&_[aria-pressed=true]]:text-[var(--accent-text)]",
].join(" ");
