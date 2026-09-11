// The repository list. The skeleton that stands in for it while the request is
// in flight mirrors the same shapes, so they are named once.
//
// Widths branch on the dashboard container rather than the viewport. Every
// variant prefix is written out in full: Tailwind finds classes by scanning the
// source for complete names, so a prefix held in a variable and joined on at
// runtime produces a class the stylesheet never gets a rule for.
//
// The breakpoint carries a hundredth of a pixel because the variant compiles to
// a strict "less than" while the `(max-width: 760px)` it replaces included 760.

export const repositorySummary = "grid grid-cols-3 gap-3 @max-[760.02px]/dashboard:gap-2";

export const repositorySummaryItem = [
  "flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left text-[var(--foreground)] transition-[background,border-color] duration-150",
  "data-[state=active]:border-[var(--accent)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:[&>span]:text-[var(--accent-text)]",
  "[&>span]:flex [&>span]:items-center [&>span]:gap-[9px] [&>span]:text-[13px] [&>span]:text-[var(--muted)]",
  "[&_strong]:text-[28px] [&_strong]:leading-none [&_strong]:font-semibold [&_strong]:[font-variant-numeric:tabular-nums]",
  "@max-[760.02px]/dashboard:flex-col @max-[760.02px]/dashboard:items-start @max-[760.02px]/dashboard:gap-3.5 @max-[760.02px]/dashboard:p-3.5",
  "@max-[760.02px]/dashboard:[&>span]:items-start @max-[760.02px]/dashboard:[&>span]:gap-1.5 @max-[760.02px]/dashboard:[&>span]:text-[12px] @max-[760.02px]/dashboard:[&>span>svg]:shrink-0",
  "@max-[760.02px]/dashboard:[&_strong]:text-[25px]",
].join(" ");

export const repositoryListPanel = "overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]";

export const repositoryControls = "flex flex-wrap items-center gap-3 px-5 pt-5 pb-3 @max-[760.02px]/dashboard:gap-2.5 @max-[760.02px]/dashboard:px-3.5 @max-[760.02px]/dashboard:pt-4";

export const repositorySearch = [
  "flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[var(--muted)]",
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]",
  "[&_input]:w-full [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[13px] [&_input]:text-[var(--foreground)] [&_input]:outline-none",
  "[&_button]:flex [&_button]:border-0 [&_button]:bg-transparent [&_button]:p-[3px] [&_button]:text-[var(--muted)]",
  "@max-[760.02px]/dashboard:basis-full",
].join(" ");

export const repositoryControlLabel = [
  "flex min-w-0 items-center gap-2 text-[12px] text-[var(--muted)]",
  "[&_select]:h-10 [&_select]:min-w-0 [&_select]:max-w-[190px] [&_select]:cursor-pointer [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:px-2.5 [&_select]:text-[13px] [&_select]:text-[var(--foreground)]",
  "@max-[760.02px]/dashboard:flex-1 @max-[760.02px]/dashboard:flex-col @max-[760.02px]/dashboard:items-stretch @max-[760.02px]/dashboard:gap-[5px]",
  "@max-[760.02px]/dashboard:[&_select]:w-full @max-[760.02px]/dashboard:[&_select]:max-w-full",
].join(" ");

export const repositoryListCaption = [
  "flex justify-between gap-2.5 px-5 pb-4 text-[12px] text-[var(--muted)]",
  "[&_button]:inline-flex [&_button]:items-center [&_button]:gap-[5px] [&_button]:border-0 [&_button]:bg-none [&_button]:text-[var(--accent-text)]",
  "@max-[760.02px]/dashboard:px-3.5 @max-[760.02px]/dashboard:pb-3.5",
].join(" ");

export const repositoryColumns = ["grid grid-cols-[minmax(0,1fr)_88px_88px_88px_116px] items-center gap-3 px-5", "border-t border-[var(--border)] bg-[var(--canvas)] py-[11px] text-[11px] text-[var(--muted)]", "[&>span:not(:first-child)]:text-center @max-[760.02px]/dashboard:hidden"].join(" ");

export const repositoryRows = "m-0 list-none p-0";

export const repositoryRow = [
  "grid grid-cols-[minmax(0,1fr)_88px_88px_88px_116px] items-center gap-3 px-5",
  "border-t border-[var(--border-subtle)] py-[17px] transition-[background] duration-150 hover:bg-[var(--canvas)]",
  "@max-[760.02px]/dashboard:grid-cols-3 @max-[760.02px]/dashboard:gap-x-3 @max-[760.02px]/dashboard:gap-y-4 @max-[760.02px]/dashboard:px-3.5 @max-[760.02px]/dashboard:py-[18px]",
].join(" ");

export const repositoryIdentity = [
  "flex min-w-0 items-center gap-3",
  "[&_a]:min-w-0 [&_a]:text-[var(--foreground)] [&_a]:no-underline",
  "[&_a>span]:block [&_a>span]:overflow-hidden [&_a>span]:text-[11px] [&_a>span]:text-ellipsis [&_a>span]:whitespace-nowrap [&_a>span]:text-[var(--muted)]",
  "[&_strong]:flex [&_strong]:items-center [&_strong]:gap-1.5 [&_strong]:text-[14px] [&_strong]:font-semibold [&_strong]:[overflow-wrap:anywhere]",
  "[&_strong_svg]:shrink-0 [&_strong_svg]:opacity-0 [&_strong_svg]:text-[var(--muted)]",
  "[&_a:focus-visible_strong]:text-[var(--accent-text)] [&_a:hover_strong]:text-[var(--accent-text)]",
  "[&_a:focus-visible_svg]:opacity-100 [&_a:hover_svg]:opacity-100",
  "@max-[760.02px]/dashboard:col-span-full",
].join(" ");

export const repositoryAvatar = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--canvas)] text-[11px] font-semibold text-[var(--muted)]";

export const repositoryNumber = "text-center text-[14px] font-medium text-[var(--foreground)] no-underline [font-variant-numeric:tabular-nums] @max-[760.02px]/dashboard:text-left";

export const repositoryNumberLink = `${repositoryNumber} hover:text-[var(--accent-text)] hover:underline`;

export const repositoryAttention = "inline-flex min-h-[26px] min-w-8 items-center justify-center rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent-text)] no-underline hover:underline";

export const repositoryZero = "font-normal text-[var(--muted)]";
export const repositoryConflicts = "text-[var(--danger)]";

export const repositoryAction = [
  "flex items-center justify-end gap-1.5 text-[12px] text-[var(--muted)] no-underline hover:text-[var(--accent-text)]",
  "@max-[760.02px]/dashboard:col-span-full @max-[760.02px]/dashboard:border-t @max-[760.02px]/dashboard:border-[var(--border-subtle)] @max-[760.02px]/dashboard:pt-2.5",
].join(" ");

export const repositoryMobileLabel = ["hidden", "@max-[760.02px]/dashboard:mb-1.5 @max-[760.02px]/dashboard:flex @max-[760.02px]/dashboard:items-center @max-[760.02px]/dashboard:gap-[5px] @max-[760.02px]/dashboard:text-[11px] @max-[760.02px]/dashboard:font-normal @max-[760.02px]/dashboard:text-[var(--muted)]"].join(
  " ",
);

export const repositoryScopeNote = "@max-[760.02px]/dashboard:hidden";
