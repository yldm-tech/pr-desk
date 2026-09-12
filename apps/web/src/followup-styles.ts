// The follow-up summary on the overview and the workspace that lists the same
// work in full. Variant prefixes are written out: Tailwind finds classes by
// scanning the source for complete names.
const panel = "mb-6 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--foreground)] [@media(max-width:640px)]:p-4";

export const followUpSummary = panel;
export const followUpWorkspace = `${panel} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]`;

export const followUpCounts = ["mb-6 grid grid-cols-4 gap-3 [@media(max-width:640px)]:grid-cols-2", "[&_a]:flex [&_a]:flex-col [&_a]:gap-2 [&_a]:rounded-xl [&_a]:bg-[var(--accent-soft)] [&_a]:p-4 [&_a]:text-[var(--accent-text)] [&_a]:no-underline", "[&_strong]:text-[28px] [&_span]:text-[13px]"].join(" ");

export const followUpPriority = ["mx-0 mt-3 mb-0 list-none p-0", "[&_a]:flex [&_a]:flex-col [&_a]:gap-1.5 [&_a]:border-t [&_a]:border-[var(--border)] [&_a]:py-3 [&_a]:text-[var(--foreground)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere]", "[&_small]:text-[12px] [&_small]:text-[var(--muted)]"].join(" ");

export const followUpPriorityReasons = "flex flex-wrap gap-1.5";

export const followUpCard = "border-t border-[var(--border)] py-5 [scroll-margin-top:20px] [&>h3]:mx-0 [&>h3]:my-2.5 [&>h3]:text-[16px] [&>h3]:[overflow-wrap:anywhere] [&>h3>a]:text-[var(--foreground)] [&>h3>a]:no-underline";

export const followUpCardHeading = "flex flex-wrap justify-between gap-3 text-[12px] text-[var(--muted)]";

export const followUpWait = "text-[12px] text-[var(--muted)]";

export const followUpReasons = "flex flex-wrap items-center gap-2";

// The tone decides the colour; the compact spelling is used in the summary list.
export const followUpReason =
  "rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[12px] leading-[1.5] text-[var(--muted)] data-[tone=action]:bg-[var(--warning-soft)] data-[tone=action]:text-[var(--warning)] data-[tone=blocked]:bg-[var(--danger-soft)] data-[tone=blocked]:text-[var(--danger)] data-[tone=waiting]:bg-[var(--info-soft)] data-[tone=waiting]:text-[var(--info)]";

export const followUpReasonCompact = followUpReason.replace("px-2 py-1", "px-[7px] py-0.5");

export const followUpExcerpt = "mx-0 my-3 max-h-24 overflow-y-auto whitespace-pre-wrap text-[var(--muted)] [overflow-wrap:anywhere]";

export const followUpActions = "mt-3 flex flex-wrap items-center gap-2 text-[12px] [&_summary]:cursor-pointer [&_summary]:p-2";

export const followUpSnooze = [
  "flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-muted)] p-3",
  "[&_label]:flex [&_label]:flex-col [&_label]:gap-2 [&_label]:text-[13px]",
  "[&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--border)] [&_input]:bg-[var(--surface)] [&_input]:px-3 [&_input]:py-[9px] [&_input]:text-[var(--foreground)]",
].join(" ");

export const followUpFilters = [
  "mx-0 my-[18px] flex flex-wrap items-center justify-between gap-2",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2",
  "[&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:px-3 [&_select]:py-[9px] [&_select]:text-[var(--foreground)]",
  "[&_[aria-pressed=true]]:border-[var(--accent)] [&_[aria-pressed=true]]:bg-[var(--accent-soft)] [&_[aria-pressed=true]]:text-[var(--accent-text)]",
].join(" ");
