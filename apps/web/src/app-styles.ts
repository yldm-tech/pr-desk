// The application shell — sidebar, navigation, page header — and the pull
// request table it frames. The loading skeleton mirrors the table.
//
// Variant prefixes are written out in full: Tailwind finds classes by scanning
// the source for complete names, so one joined on at runtime gets no rule.
//
// Two variant families live in this file and the question that picks between them is "what sets this element's width": the shell (`appShell`, `sidebar`, `brand`, `nav`, the sidebar actions, `skipLink`) is sized by the browser window and uses the viewport tokens `roomy`/`shell`/`wide`, while everything from `pageHeader` down renders inside <main> and is sized by <main>'s content box, so it queries `@container/dashboard` with `split`/`row`/`table`. The two boxes differ by the 208px sidebar and <main>'s padding, which is why mixing them inverts: <main> is 647px wide at a 900px viewport but 867px at 899px.
//
// Every branch is mobile-first. A container query with no matching ancestor — and every query in a browser without container support — evaluates false and falls through to the base classes, so base has to be the layout that works at 320px.

// The shell is a plain block stack until the sidebar exists, so `flex` is itself a shell-band decision. `min-h-dvh` rather than `min-h-screen`: 100vh on mobile Safari is the toolbar-retracted height, which left every short route with a phantom scroll that the sidebar, already on `dvh`, did not have.
export const appShell = "block min-h-dvh shell:flex";

// Only shown on the contribution overview, which asks for a wider measure and a
// quieter heading than the rest of the application.
export const overviewCanvas = "bg-[var(--canvas)] text-[var(--foreground)]";
// The width and padding this route asked for were already being overridden by
// the utilities on the element itself, so only the header gap survives.
export const overviewMain = "";
export const pageHeaderGap = "mb-[18px]";
export const overviewHeaderGap = "mb-[18px] @row/dashboard:mb-5";
// The overview heading is the same as every other: a later rule names both.
export const overviewHeading = "";
// Both colours are set unconditionally and the border widths decide which edge is actually drawn. style.css imports only theme.css and utilities.css, so preflight's `border-color` reset is absent: a width with no colour resolves to currentColor, which drew a near-black rule under the top bar for every viewport between 641 and 900.
export const asideBorder = "border-b-[var(--border)] border-r-[var(--border-subtle)]";
export const overviewAside = "border-[var(--border)]";

// Base is the phone top bar: a sticky two-column grid holding the brand, the action cluster and a full-width nav strip underneath. It is sticky rather than static because the list below runs to thousands of pixels and there is no bottom tab bar, no back-to-top and no second copy of the navigation — scrolling it away costs phone users a capability desktop users keep. From `shell` up it is the 208px column instead, and `w-52` is 13rem, which is 208px exactly. `short` folds the bar back into one row: a landscape phone is 390px tall and a two-row bar plus the page header spent over half of it on chrome.
export const sidebar = [
  "sticky top-0 z-20 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 self-start overflow-visible border-b bg-[var(--surface)] p-4 [&>*]:shrink-0",
  // Below `roomy` the two tracks swap roles. An `auto` action track takes its max-content width — 271px for the three labelled controls, which does not change with the viewport — so on a 320px screen the `1fr` brand track absorbs the entire shortfall and the wordmark collapses to a 5px sliver. Giving the brand the `auto` track (a 44px mark, wordmark hidden) and the actions `minmax(0,1fr)` makes the cluster the thing that compresses, which it can do: its labels wrap.
  "max-roomy:grid-cols-[auto_minmax(0,1fr)]",
  "shell:flex shell:h-dvh shell:w-52 shell:shrink-0 shell:flex-col shell:gap-0 shell:overflow-y-auto shell:border-r shell:border-b-0 shell:px-3 shell:py-7 shell:[overscroll-behavior:contain]",
  "wide:px-[18px]",
  "short:grid-cols-[auto_1fr_auto] short:gap-2 short:p-2",
].join(" ");

export const brand = "flex min-w-0 items-center gap-2.5 self-center p-0 text-[length:1.1875rem] font-bold tracking-[-0.4px] whitespace-nowrap text-[var(--foreground)] no-underline shell:self-auto shell:px-3 shell:pt-0 shell:pb-7 short:col-start-1 short:row-start-1";

export const brandLogo = "grid h-[29px] w-[29px] place-items-center rounded-lg bg-[var(--accent)] text-white";

// A horizontally scrollable strip on a phone, a column in the sidebar. The five fixed grid columns this replaces could never hold "Repositories" in the 38px a 320px screen leaves them, and no threshold below 640 changes that — `wrap-anywhere` only turned the overflow into words broken at arbitrary letters. A strip that scrolls keeps every label whole at every width.
export const nav = [
  "col-span-2 row-start-2 mb-0 flex gap-1 overflow-x-auto [overscroll-behavior-x:contain]",
  "[&>button]:shrink-0 [&>button]:justify-center [&>button]:px-2 [&>button]:text-center [&>button]:whitespace-nowrap",
  "shell:col-auto shell:row-auto shell:flex-col shell:overflow-visible shell:[&>button]:justify-start shell:[&>button]:px-3 shell:[&>button]:text-left shell:[&>button]:whitespace-normal",
  "short:col-start-2 short:col-end-3 short:row-start-1",
].join(" ");

const navButtonBase = [
  "flex min-h-11 items-center gap-2.5 rounded-lg border-0 px-3 py-[11px] text-left text-[length:var(--text-body)] font-[family-name:inherit]",
  "transition-[background-color,color] duration-150 motion-reduce:transition-none",
  "[&_svg]:shrink-0 [&_svg]:opacity-80",
  // The badge keeps its inline form at every width. It used to become a 9px absolutely-positioned chip below 480px, which is a deliberate reduction on exactly the devices held furthest from the eye, and a three-digit count overflowed its 16px box onto the icon.
  "[&_b]:float-none [&_b]:ml-auto [&_b]:min-w-[22px] [&_b]:rounded-[10px] [&_b]:bg-[var(--accent)] [&_b]:px-1.5 [&_b]:py-px [&_b]:text-center [&_b]:text-[length:0.6875rem] [&_b]:text-[var(--surface)]",
].join(" ");

// Hover is only offered where it leads somewhere: the open page does not react.
export const navButton = (active: boolean) => (active ? `${navButtonBase} bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]` : `${navButtonBase} bg-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]`);

// The three shell actions: a row in the top bar's `auto` track, a stack at the bottom of the sidebar. Below `roomy` they render icon-above-label rather than icon-only — a bare Building2 glyph whose only label is a `title` tooltip is unreadable on a touch device, which never hovers, and the labels are what stopped the cluster from starving the brand column.
export const sidebarBottom = [
  "col-start-2 row-start-1 m-0 flex items-center gap-2 pt-0 [&>*]:min-w-0",
  "max-roomy:gap-3 max-roomy:[&>*]:flex-col max-roomy:[&>*]:items-center max-roomy:[&>*]:gap-0.5 max-roomy:[&>*]:px-1.5 max-roomy:[&>*]:text-center max-roomy:[&>*]:text-[length:0.6875rem] max-roomy:[&_span]:wrap-anywhere",
  // The children carry their own `pointer-coarse:min-w-11`, but `[&>*]:min-w-0` above is a child selector and outranks a class on the child itself, so the floor has to be restated here at the same specificity to survive. It only shows up in a locale whose label is short enough to leave the button under 44px — Japanese 設定 measures 36px wide where English "Settings" does not.
  "pointer-coarse:[&>*]:min-w-11",
  // Equal tracks rather than content-proportional ones. Sharing the row by content length lets "Organization access" take what "Settings" needs, and `wrap-anywhere` then breaks the short label mid-word into "Settin gs"; an equal third is wide enough for every label in every locale to break at a space instead.
  "max-roomy:[&>*]:basis-0 max-roomy:[&>*]:grow",
  "shell:mt-auto shell:block shell:pt-6",
  "short:col-start-3",
].join(" ");

const sidebarActionBase =
  "flex min-h-10 w-auto items-center justify-center gap-2 rounded-lg border p-2.5 text-[length:var(--text-body)] font-medium no-underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 shell:mb-2 shell:w-full";

export const sidebarAction = `${sidebarActionBase} border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]`;

export const sidebarActionActive = `${sidebarActionBase} border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]`;

export const syncButton =
  "flex min-h-10 w-auto justify-center gap-2 rounded-lg border border-[var(--accent-text)] bg-[var(--accent-text)] p-2.5 text-[length:var(--text-body)] font-medium text-[var(--surface)] hover:not-disabled:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] pointer-coarse:min-h-11 shell:w-full";

export const spinning = "animate-[spin_0.9s_linear_infinite] motion-reduce:animate-none";

export const skipLink = "fixed top-3 left-3 z-[200] rounded-lg bg-[var(--accent-text)] px-4 py-2.5 text-[var(--surface)] no-underline [transform:translateY(-160%)] focus:[transform:translateY(0)]";

export const pageHeader = ["grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-2", "@max-row/dashboard:@split/dashboard:gap-3", "@row/dashboard:gap-x-5 @row/dashboard:gap-y-3"].join(" ");

// `[overflow-wrap:anywhere]` because the title shares its row with an account bar whose width is set by its content: Spanish "contribuciones" alone is about as wide as the whole title column at 320px, and without a break opportunity it painted under the language and avatar controls.
export const pageTitle = "m-0 text-[length:1.25rem] font-semibold tracking-[-0.6px] [overflow-wrap:anywhere] @split/dashboard:text-[length:1.4375rem]";

export const accountBar = [
  "col-start-2 row-start-1 m-0 flex min-h-0 flex-wrap items-center justify-end gap-3",
  "@max-row/dashboard:@split/dashboard:col-span-full @max-row/dashboard:@split/dashboard:justify-between",
  "@row/dashboard:col-auto @row/dashboard:row-auto @row/dashboard:flex-nowrap @row/dashboard:justify-end @row/dashboard:gap-4",
].join(" ");

export const headerTitleSlot = "col-start-1 row-start-1 min-w-0 @max-row/dashboard:@split/dashboard:col-span-full @row/dashboard:col-auto @row/dashboard:row-auto";

export const headerDate = "hidden text-[length:0.75rem] leading-[1.5] whitespace-nowrap text-[var(--muted)] @split/dashboard:inline @max-row/dashboard:@split/dashboard:flex-1";

export const headerActions = "ml-auto flex min-w-0 items-center gap-1.5 @split/dashboard:gap-2 @row/dashboard:ml-0 @row/dashboard:gap-2.5";

export const listHeading =
  "mx-0 mt-0 mb-3.5 flex flex-wrap items-center justify-between gap-4 [&_h2]:m-0 [&_h2]:text-[length:0.9375rem] [&_h2]:font-semibold [&_h2>span]:ml-1.5 [&_h2>span]:inline-flex [&_h2>span]:min-w-6 [&_h2>span]:items-center [&_h2>span]:justify-center [&_h2>span]:rounded-md [&_h2>span]:bg-[var(--surface-muted)] [&_h2>span]:px-[7px] [&_h2>span]:py-0.5 [&_h2>span]:text-[length:0.75rem] [&_h2>span]:text-[var(--muted)]";

export const backgroundRefresh = "ml-3 inline-flex items-center gap-[5px] text-[length:0.6875rem] font-normal text-[var(--muted)]";

export const toolbar = "mx-0 mt-0 mb-4 flex flex-wrap items-center justify-between gap-4 @max-row/dashboard:block";

export const searchForm = [
  "max-w-[360px] min-w-[200px] flex-1",
  "[&>label]:absolute [&>label]:mb-1.5 [&>label]:block [&>label]:h-px [&>label]:w-px [&>label]:overflow-hidden [&>label]:text-[length:0.75rem] [&>label]:whitespace-nowrap [&>label]:text-[var(--muted)] [&>label]:[clip-path:inset(50%)]",
  "[&>div]:flex [&>div]:items-center [&>div]:gap-1.5",
  "[&_input]:min-h-10 [&_input]:w-full [&_input]:min-w-0 [&_input]:flex-1 [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--border)] [&_input]:bg-[var(--surface)] [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-[length:var(--text-body)] [&_input]:[font-family:inherit]",
  "[&_button]:flex [&_button]:min-h-10 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-lg [&_button]:border [&_button]:border-[var(--border)] [&_button]:bg-white [&_button]:px-2.5 [&_button]:py-2 [&_button]:text-[var(--foreground)] hoverable:[&_button:hover]:bg-[var(--surface-muted)]",
  // iOS Safari zooms the page whenever a focused text control computes under 16px and never zooms back out. style.css carries that floor for every bare control, but Tailwind utilities live in a later layer and would beat it, so the input has to restate its own size here.
  "pointer-coarse:[&_input]:min-h-11 pointer-coarse:[&_input]:text-[length:1rem] pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11",
  "@max-row/dashboard:w-full @max-row/dashboard:[&_input]:w-full",
].join(" ");

// The pills wrap when the container cannot hold them and only become a nowrap scroller once there is room for most of them; the selected pill is scrolled into view by App, because a strip whose visible portion is entirely unselected pills gives no clue which filter is active.
export const filters = [
  "flex flex-wrap gap-0.5 rounded-[9px] bg-[var(--surface-muted)] p-1",
  "[&_button]:min-h-9 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:py-[7px] [&_button]:text-[length:0.75rem] [&_button]:text-[var(--muted)]",
  "hoverable:[&_button:hover:not(.selected)]:text-[var(--foreground)]",
  "[&_.selected]:bg-[var(--surface)] [&_.selected]:font-semibold [&_.selected]:text-[var(--accent-text)] [&_.selected]:shadow-[0_1px_3px_var(--shadow)]",
  "[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--accent)]",
  "pointer-coarse:[&_button]:min-h-11",
  "@max-row/dashboard:mt-2.5",
  "@split/dashboard:flex-nowrap @split/dashboard:overflow-x-auto @split/dashboard:[&>button]:shrink-0 @split/dashboard:[&>button]:whitespace-nowrap",
].join(" ");

export const searchChip = "inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-[9px] py-[5px] text-[length:0.75rem] text-[var(--accent-text)] [overflow-wrap:anywhere] pointer-coarse:min-h-11";

// `p-0` keeps this reading as text inside its sentence; on a coarse pointer the padding grows and an equal negative margin gives it back, so the hit area reaches 44px without the label moving.
export const linkButton = "cursor-pointer border-0 bg-transparent p-0 text-[var(--accent)] [font:inherit] pointer-coarse:-m-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:p-2";

export const tableSurface = "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]";

// Two bands, not three. The card and the table share one edge at `row`, so there is no width that matches neither, and the five-track template at `row` is the value the desktop table has always used.
const rowGrid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 @row/dashboard:grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_0.5fr] @row/dashboard:gap-2.5 @row/dashboard:px-5 @table/dashboard:gap-[15px]";

// `sr-only` rather than `hidden`: the row holds five role="columnheader" spans and the rows below keep role="table"/role="cell", so removing it from the accessibility tree left a screen reader announcing four nameless cells. `not-sr-only` zeroes padding, which is why the vertical padding is restated inside the same band.
export const tableHead = `${rowGrid} sr-only border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] py-3 text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] @row/dashboard:not-sr-only @row/dashboard:py-3`;

export const tableRow = [rowGrid, "min-h-[90px] border-b border-[var(--border-subtle)] py-[18px] transition-[background-color] duration-150 last:border-0 hover:bg-[var(--surface-muted)] focus-within:bg-[var(--surface-muted)] motion-reduce:transition-none"].join(" ");

// Every cell in the row places itself explicitly. DOM order is the card's reading order — title, activity, repository, status, updated — and the table order is restored by column placement at `row`, so the comment button is no longer painted top-right while sitting last in the tab order.
export const prTitle = "col-start-1 row-start-1 flex items-start gap-[11px] [&>svg]:mt-[3px] [&>svg]:shrink-0 [&>div]:min-w-0 [&_small]:mt-1 [&_small]:block [&_small]:text-[length:var(--text-caption)] [&_small]:leading-[1.5] [&_small]:text-[var(--muted)] [&_em]:text-[var(--muted)] [&_em]:not-italic";

export const prTitleLink =
  "block text-[length:var(--text-body)] leading-[1.6] font-semibold text-[var(--foreground)] no-underline [overflow-wrap:anywhere] hover:text-[var(--accent-text)] hover:underline focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]";

export const prRepository = "min-w-0 text-[length:0.75rem] leading-[1.6] text-[var(--muted)] no-underline [overflow-wrap:anywhere] hover:text-[var(--accent-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]";

// `col-end-4` and not `col-span-1`: the base state is the `grid-column` shorthand, and only a longhand end is guaranteed to unset the `-1` it wrote.
export const prStatus = "col-span-full row-start-3 flex flex-wrap items-start gap-1.5 @row/dashboard:col-start-3 @row/dashboard:col-end-4 @row/dashboard:row-start-1";

export const pill = "inline-flex items-center rounded-[5px] px-[7px] py-[3px] text-[length:0.75rem] leading-[1.6] whitespace-nowrap";

export const conflict = "@max-row/dashboard:ml-1.5 m-0 inline-flex items-center gap-[3px] rounded-[5px] bg-[var(--danger-soft)] px-1.5 py-[3px] text-[length:0.75rem] text-[var(--danger)]";

export const prUpdated = "col-start-2 row-start-2 justify-self-end text-[length:0.75rem] leading-[1.7] [font-variant-numeric:tabular-nums] @row/dashboard:col-start-4 @row/dashboard:row-start-1 @row/dashboard:justify-self-auto";

export const rowActivity = "col-start-2 row-start-1 flex items-center justify-center gap-[5px] text-[length:0.75rem] text-[var(--muted)] @row/dashboard:col-start-5";

export const commentButton =
  "flex min-h-10 min-w-10 cursor-pointer items-center justify-center gap-[5px] rounded-[7px] border border-transparent bg-transparent p-1.5 text-[length:0.75rem] text-[var(--muted)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:border-[var(--accent-border)] focus-visible:bg-[var(--accent-soft)] focus-visible:text-[var(--accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] pointer-coarse:min-h-11 pointer-coarse:min-w-11";

// The tone of a check result, for the table where it sits under the status.
export const tableChecks = "block w-full items-center text-[length:0.75rem] capitalize";

// Narrow, the result count takes a line of its own above a Previous/Next pair that stays together; wide, it goes back to sitting between them on one right-aligned line.
export const pagination = [
  "mx-0 my-0 flex flex-wrap items-center justify-between gap-3 py-3.5 text-[length:0.75rem] text-[var(--muted)]",
  "[&>span]:order-first [&>span]:basis-full [&>span]:text-center",
  "[&_button]:min-h-9 [&_button]:rounded-[7px] [&_button]:border [&_button]:border-[var(--border)] [&_button]:bg-white [&_button]:px-3 [&_button]:py-2 [&_button]:text-[var(--foreground)] hoverable:[&_button:hover:not(:disabled)]:bg-[var(--surface-muted)] [&_button:disabled]:cursor-default [&_button:disabled]:opacity-45",
  "pointer-coarse:[&_button]:min-h-11",
  "@row/dashboard:justify-end @row/dashboard:[&>span]:order-none @row/dashboard:[&>span]:basis-auto @row/dashboard:[&>span]:text-left",
].join(" ");

// Four cards only where four fit. `short` is a height query and cannot be a container one: a landscape phone is wide enough for two columns and would spend 210px of its 390px on two rows of stat cards.
export const stats = "mx-0 mt-0 mb-7 grid grid-cols-2 gap-3.5 @table/dashboard:grid-cols-4 short:mb-3 short:grid-cols-4";

export const stat =
  "flex min-h-[76px] items-center gap-[13px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3.5 shadow-none @row/dashboard:min-h-[88px] @row/dashboard:px-5 @row/dashboard:py-[18px] [&_span]:mb-1 [&_span]:block [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] [&_strong]:text-[length:1.625rem] [&_strong]:leading-[1.3] [&_strong]:font-semibold [&_strong]:[font-variant-numeric:tabular-nums]";

// `shrink-0` because an 18px glyph in 9px of padding otherwise sets a 36px floor the flex line cannot give back; below `split` the icon goes entirely, so the count and its label get the whole card.
export const statIcon = "shrink-0 rounded-lg bg-[var(--surface-muted)] p-[9px] text-[var(--muted)] @max-split/dashboard:hidden";

// The error variant of this banner never auto-dismisses, so its × is the only way out of it. `grid place-items-center` gives the glyph a box to be centred in; on a coarse pointer that box reaches 44px and an equal negative margin keeps the banner's density.
export const syncFeedback =
  "mx-0 mt-0 mb-[18px] flex items-start justify-between gap-4 rounded-[9px] border border-[var(--success-border)] bg-[var(--success-soft)] px-4 py-3 text-[length:0.75rem] leading-[1.6] text-[var(--success)] [&_button]:grid [&_button]:cursor-pointer [&_button]:place-items-center [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[length:1.25rem] [&_button]:leading-none [&_button]:text-inherit pointer-coarse:[&_button]:-m-2 pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11";

// The success notice floats; the failure notice stays in the flow.
export const syncFeedbackFloating = "fixed right-5 bottom-5 z-[25] m-0 w-[min(420px,calc(100vw-40px))] shadow-[0_8px_28px_var(--shadow)]";

// Colour only. This used to hide the Updated cell below 900px, which took the list's one recency signal — and the full timestamp in its `title` — away from every phone, every tablet in portrait and every desktop at 200% zoom.
export const muted = "text-[var(--muted)]";

export const iconButton = "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5";

// The skeletons that stand in for the table and the overview.
export const skeletonControls = "mb-[22px] grid gap-4";
export const skeletonYears = "flex gap-[22px] overflow-hidden border-b border-[var(--border)] py-3.5";
export const skeletonScore = "mx-0 mt-5 mb-3.5";
export const skeletonLegend = "min-w-0 flex-1 leading-[2.4]";
export const skeletonRows = "mt-[22px] leading-[2]";
export const skeletonFlex = "min-w-0 flex-1";
export const skeletonSyncNote = "skeleton-sync-note block w-[260px] max-w-[70vw]";
export const accessSkeleton = "mb-4";
export const skeletonSearch = "block max-w-[360px] min-w-[200px] flex-1";
export const skeletonFilters = "block w-[280px] max-w-full";
export const prListSkeletonRow = "hover:bg-[var(--surface)]";

// The status pill. Its tone used to be a class name built at runtime from the
// label — which is why a plain search for the class in the source called one of
// them unused. The mapping is explicit now.
const pillTones: Record<string, string> = {
  "Awaiting review": "bg-[var(--surface-muted)] text-[var(--muted)]",
  Open: "bg-[var(--surface-muted)] text-[var(--muted)]",
  "Review requested": "bg-[var(--warning-soft)] text-[var(--warning)]",
  "Changes requested": "bg-[var(--danger-soft)] text-[var(--danger)]",
  Approved: "bg-[var(--success-soft)] text-[var(--success)]",
  Merged: "bg-[var(--accent-soft)] text-[var(--accent)]",
};

export const statusPill = (status: string) => `${pill} ${pillTones[status] ?? ""}`.trim();

export const eyebrow = "mx-0 mt-0 mb-2 text-[length:0.75rem] text-[var(--muted)]";
export const overviewEyebrow = "mx-0 mt-0 mb-3 text-[length:0.6875rem] text-[var(--muted)]";
export const accentText = "text-[var(--accent)]";
