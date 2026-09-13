// The repository list. The skeleton that stands in for it while the request is in flight mirrors the same shapes, so they are named once.
//
// Widths branch on the dashboard container rather than the viewport, because this list only ever measures the space <main> gives it. Every branch is mobile-first: the base classes are the phone card layout and `@table/dashboard:` restores the six-column table. Base has to be the narrow layout, not the wide one — a container query whose named ancestor is missing, or a browser without container queries at all, evaluates false and falls back to base, and a six-column table is not a survivable fallback at 320px.
//
// The table threshold is the shared `table` token (880px of content box) rather than the 760 it used to be. <main>'s content width is not monotonic in the viewport: it is 867px at a 899px window and 647px at 900px, where the fixed sidebar appears. Any threshold inside that window makes widening the window *downgrade* the page, which is what 760 did for the 118px above 900, and it left 1024x768 sitting 4.8px from the edge — close enough that the same device flipped layout depending on whether the platform draws a classic scrollbar.
//
// Every variant prefix is written out in full: Tailwind finds classes by scanning the source for complete names, so a prefix held in a variable and joined on at runtime produces a class the stylesheet never gets a rule for.

export const repositorySummary = "grid grid-cols-1 gap-2 @split/dashboard:grid-cols-3 @table/dashboard:gap-3";

export const repositorySummaryItem = [
  "flex flex-col items-start justify-between gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left text-[var(--foreground)] transition-[background,border-color] duration-150",
  "data-[state=active]:border-[var(--accent)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:[&>span]:text-[var(--accent-text)]",
  // A tab label is a translated string in a fixed fraction of the container. `overflow-wrap: anywhere` is the one value that also shrinks the span's min-content contribution, so "Repositorios" wraps inside its card instead of pushing the whole page into horizontal scroll at 320px.
  "[&>span]:flex [&>span]:min-w-0 [&>span]:items-start [&>span]:gap-1.5 [&>span]:text-[length:0.75rem] [&>span]:text-[var(--muted)] [&>span]:[overflow-wrap:anywhere] [&>span>svg]:shrink-0",
  "[&_strong]:text-[length:1.5625rem] [&_strong]:leading-none [&_strong]:font-semibold [&_strong]:[font-variant-numeric:tabular-nums]",
  "@table/dashboard:flex-row @table/dashboard:items-center @table/dashboard:gap-3 @table/dashboard:p-5",
  "@table/dashboard:[&>span]:items-center @table/dashboard:[&>span]:gap-[9px] @table/dashboard:[&>span]:text-[length:0.8125rem]",
  "@table/dashboard:[&_strong]:text-[length:1.75rem]",
].join(" ");

export const repositoryListPanel = "overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]";

export const repositoryControls = "flex flex-wrap items-center gap-2.5 px-3.5 pt-4 pb-3 @table/dashboard:gap-3 @table/dashboard:px-5 @table/dashboard:pt-5";

export const repositorySearch = [
  "flex h-10 min-w-[180px] flex-1 basis-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[var(--muted)]",
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]",
  "[&_input]:w-full [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[length:0.8125rem] [&_input]:text-[var(--foreground)] [&_input]:outline-none",
  "[&_button]:flex [&_button]:border-0 [&_button]:bg-transparent [&_button]:p-[3px] [&_button]:text-[var(--muted)]",
  // iOS Safari zooms the page whenever a focused text control computes under 16px, and index.html deliberately carries no maximum-scale, so it never zooms back out. style.css has the same rule for bare controls, but it sits in the components layer and utilities beat it, so the search field has to restate the escape for itself.
  "pointer-coarse:[&_input]:text-[length:1rem]",
  // The clear X is a 15px icon pinned against the inside edge of the field, i.e. the control closest to the screen edge and the easiest to miss into the input. Its box grows to the 44px floor under a coarse pointer while the icon stays 15px.
  "pointer-coarse:[&_button]:h-11 pointer-coarse:[&_button]:w-11 pointer-coarse:[&_button]:items-center pointer-coarse:[&_button]:justify-center pointer-coarse:[&_button]:-mr-2",
  "@table/dashboard:basis-[0%]",
].join(" ");

export const repositoryControlLabel = [
  "flex min-w-0 flex-1 flex-col items-stretch gap-[5px] text-[length:0.75rem] text-[var(--muted)]",
  "[&_select]:h-10 [&_select]:w-full [&_select]:min-w-0 [&_select]:max-w-full [&_select]:cursor-pointer [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:px-2.5 [&_select]:text-[length:0.8125rem] [&_select]:text-[var(--foreground)]",
  // Same focus-zoom escape as the search field: a native <select> under 16px zooms iOS Safari in on tap and never zooms back out.
  "pointer-coarse:[&_select]:h-11 pointer-coarse:[&_select]:text-[length:1rem]",
  "@table/dashboard:flex-initial @table/dashboard:flex-row @table/dashboard:items-center @table/dashboard:gap-2",
  "@table/dashboard:[&_select]:w-auto @table/dashboard:[&_select]:max-w-[190px]",
].join(" ");

export const repositoryListCaption = [
  "flex justify-between gap-2.5 px-3.5 pb-3.5 text-[length:0.75rem] text-[var(--muted)]",
  "[&_button]:inline-flex [&_button]:items-center [&_button]:gap-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[var(--accent-text)]",
  // While results still exist this button is the only way back to an unfiltered list short of editing the URL, and its hit area is otherwise just the 12px text box. The negative margin keeps the caption's own height unchanged while the target grows around the label.
  "pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:-my-2",
  "@table/dashboard:px-5 @table/dashboard:pb-4",
].join(" ");

export const repositoryColumns = ["hidden grid-cols-[minmax(0,1fr)_88px_88px_88px_88px_116px] items-center gap-3 px-5", "border-t border-[var(--border)] bg-[var(--canvas)] py-[11px] text-[length:0.6875rem] text-[var(--muted)]", "[&>span:not(:first-child)]:text-center", "@table/dashboard:grid"].join(" ");

export const repositoryRows = "m-0 list-none p-0";

export const repositoryRow = [
  "grid grid-cols-2 items-center gap-x-3 gap-y-4 px-3.5",
  "border-t border-[var(--border-subtle)] py-[18px] transition-[background] duration-150 hover:bg-[var(--canvas)]",
  "@table/dashboard:grid-cols-[minmax(0,1fr)_88px_88px_88px_88px_116px] @table/dashboard:gap-3 @table/dashboard:px-5 @table/dashboard:py-[17px]",
].join(" ");

export const repositoryIdentity = [
  "col-span-full flex min-w-0 items-center gap-3",
  "[&_a]:min-w-0 [&_a]:text-[var(--foreground)] [&_a]:no-underline",
  "[&_a>span]:block [&_a>span]:overflow-hidden [&_a>span]:text-[length:0.6875rem] [&_a>span]:text-ellipsis [&_a>span]:whitespace-nowrap [&_a>span]:text-[var(--muted)]",
  "[&_strong]:flex [&_strong]:items-center [&_strong]:gap-1.5 [&_strong]:text-[length:0.875rem] [&_strong]:font-semibold [&_strong]:[overflow-wrap:anywhere]",
  // The arrow is the only signal that this name leaves the app for github.com in a new tab, and neither :hover nor :focus-visible ever fires for a tap. So the *hide* is what gets guarded, not the reveal: without a hover-capable pointer there is no rule to hide it and a touch user simply sees the cue.
  "hoverable:[&_strong_svg]:opacity-0 [&_strong_svg]:shrink-0 [&_strong_svg]:text-[var(--muted)]",
  "[&_a:focus-visible_strong]:text-[var(--accent-text)] hoverable:[&_a:hover_strong]:text-[var(--accent-text)]",
  "[&_a:focus-visible_svg]:opacity-100 hoverable:[&_a:hover_svg]:opacity-100",
  "@table/dashboard:col-auto",
].join(" ");

export const repositoryAvatar = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--canvas)] text-[length:0.6875rem] font-semibold text-[var(--muted)]";

export const repositoryNumber = "text-left text-[length:0.875rem] font-medium text-[var(--foreground)] no-underline [font-variant-numeric:tabular-nums] @table/dashboard:text-center";

export const repositoryNumberLink = `${repositoryNumber} hover:text-[var(--accent-text)] hover:underline`;

// The one tappable badge among four visually identical numbers, so a near miss gives no feedback at all; it keeps its 26x32 box for a mouse and grows to the 44px floor for a finger.
export const repositoryAttention = "inline-flex min-h-[26px] min-w-8 items-center justify-center rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent-text)] no-underline hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11";

export const repositoryZero = "font-normal text-[var(--muted)]";
export const repositoryConflicts = "text-[var(--danger)]";

// In the card layout this is the row's primary action and a full-width strip whose text box would otherwise be 18px tall, sitting directly against the next card's top border. In the table it is a cell again, where the row's own padding sets the height.
export const repositoryAction = [
  "col-span-full flex min-h-11 items-center justify-start gap-1.5 border-t border-[var(--border-subtle)] pt-2.5 text-[length:0.75rem] text-[var(--muted)] no-underline hover:text-[var(--accent-text)]",
  "@table/dashboard:col-auto @table/dashboard:min-h-[auto] @table/dashboard:justify-end @table/dashboard:border-t-0 @table/dashboard:pt-0",
].join(" ");

// The card layout has no column header, so each cell names itself; the table's header row makes the label redundant.
export const repositoryMobileLabel = "mb-1.5 flex items-center gap-[5px] text-[length:0.6875rem] font-normal text-[var(--muted)] @table/dashboard:hidden";

export const repositoryScopeNote = "hidden @table/dashboard:inline";
