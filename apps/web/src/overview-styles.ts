// The contribution overview: the score card, the outcome ring, the trend and
// repository panels, and the two tab strips above them. The loading skeleton
// mirrors the same shapes.
//
// Variant prefixes are written out in full — Tailwind finds classes by scanning
// the source for complete names, so one joined on at runtime gets no rule.

export const overviewPage =
  "mt-0 [font-variant-numeric:tabular-nums] [&_a:focus-visible]:rounded-[3px] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-[var(--accent)] [&_button:focus-visible]:rounded-[3px] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[var(--accent)] [&_svg_text]:font-[family-name:var(--font-ui)] [&_[data-ts-chart]]:text-[var(--muted)]";

// The columns themselves are set where this is used, by a container query. The height floor keys on this section's own width rather than on the window's, because it describes a cramped panel and not a small screen: the same 1100px window that used to trigger it hands a 1024px tablet a 765px column, which is not cramped at all.
export const achievementTop = "min-h-[240px] gap-[18px] @row/overview:min-h-0";

export const achievementBottom = "mt-[18px] gap-[18px]";

// The score card was a dark hero; on this layout it is a plain surface, and the
// hero tokens it still refers to are redefined to match.
export const achievementScore = [
  "relative min-h-[240px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 pt-6 pb-0 text-[var(--foreground)]",
  "[--hero-border:var(--border-subtle)] [--hero-muted:var(--muted)] [--hero-text:var(--foreground)] [--skeleton-hero-base:var(--skeleton-base)] [--skeleton-hero-highlight:var(--skeleton-highlight)]",
  "@row/overview:min-h-[252px] @row/overview:px-[30px] @row/overview:pt-7",
].join(" ");

export const scoreLabel = "flex items-center gap-[9px] text-[length:0.8125rem] leading-[1.5] text-[var(--hero-muted)] [&_svg]:text-[var(--accent-text)]";

export const scoreNumber = "relative z-[1] mt-3 text-[length:3.75rem] leading-[1.15] font-semibold tracking-[-3px] text-[var(--accent-text)] [&>span]:ml-3 [&>span]:text-[length:0.8125rem] [&>span]:font-normal [&>span]:tracking-normal [&>span]:text-[var(--hero-muted)]";

export const scoreRate = "mt-2.5 flex items-center gap-[7px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--hero-muted)] [&_strong]:font-semibold [&_strong]:text-[var(--hero-text)]";

export const scoreDot = "h-[5px] w-[5px] rounded-[50%] bg-[var(--hero-muted)]";

// Hidden on this layout, but still rendered so the markup does not change.
export const scoreWatermark = "hidden text-[var(--hero-muted)]";

export const scoreSecondary = [
  "relative mt-[26px] grid grid-cols-2 gap-3 border-t border-[var(--hero-border)] py-[18px]",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-[7px] [&>div]:text-[length:var(--text-caption)] [&>div]:leading-[1.5] [&>div]:text-[var(--hero-muted)]",
  "[&_strong]:ml-auto [&_strong]:text-[length:1.0625rem] [&_strong]:font-semibold [&_strong]:text-[var(--hero-text)]",
  "@row/overview:gap-[18px] @row/overview:[&_strong]:text-[length:1.1875rem]",
].join(" ");

// Split into the two axes rather than the `p-6` shorthand: a shorthand and a longhand that both carry one class of specificity are resolved by the order the stylesheet happens to put them in, while a variant always sorts after the unvariated rule it overrides.
const panelSurface = "min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-5 @row/overview:px-6 @row/overview:py-6";

export const achievementPanel = panelSurface;

export const achievementOutcomes = `${panelSurface} [&_.outcomes-content]:justify-evenly [&_ul]:max-w-[250px] @row/overview:[&_.outcomes-content]:justify-center @row/overview:[&_ul]:max-w-[190px]`;

export const panelHeading = "flex items-center justify-between gap-3 [&_h2]:m-0 [&_h2]:text-[length:0.875rem] [&_h2]:font-semibold [&_h2]:tracking-normal [&_h2]:text-[var(--foreground)] [&_p]:mx-0 [&_p]:mt-[9px] [&_p]:mb-0 [&_p]:text-[length:var(--text-caption)] [&_p]:leading-[1.5] [&_p]:text-[var(--muted)]";

// The kicker shares a row with the panel heading, so it is the part that has to give way; it queries the dashboard because "is there a second line's worth of room next to a heading" is a question about the page, not about whichever panel happens to host it. The wide branch states `text-left` because the base state it overrides is inherited rather than declared.
export const panelKicker = "text-right text-[length:var(--text-caption)] leading-[1.5] tracking-normal whitespace-normal text-[var(--muted)] @split/dashboard:text-left @split/dashboard:whitespace-nowrap";

export const panelDescription = "mx-0 mt-[9px] mb-0 text-[length:var(--text-caption)] leading-[1.7] text-[var(--muted)]";

// Stacking below the split width is what gives the ring its 166px box back: side by side, the ring's 130px floor and the legend's 100px floor add up to more than a phone's panel holds, so the flex algorithm froze the legend at its minimum and squeezed the ring out of square.
export const outcomesContent = "outcomes-content mt-4 flex items-center justify-center gap-3 @max-split/dashboard:flex-col @row/overview:gap-4";

export const outcomesRing = "outcomes-ring relative h-[166px] w-[166px] min-w-[130px] flex-[0_1_166px]";

export const ringLabel = "pointer-events-none absolute inset-0 flex flex-col items-center justify-center [&_strong]:text-[length:1.625rem] [&_strong]:font-semibold [&_strong]:tracking-[-1px] [&_span]:mt-1 [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)]";

export const outcomesLegend = [
  "m-0 min-w-[100px] max-w-[190px] flex-1 list-none p-0 @max-split/dashboard:min-w-0",
  "[&_li]:flex [&_li]:items-center [&_li]:gap-[9px] [&_li]:border-b [&_li]:border-[var(--border-subtle)] [&_li]:py-3 [&_li]:text-[length:var(--text-caption)] [&_li]:leading-[1.5] [&_li]:text-[var(--muted)]",
  // The label is the only part of the row that may lose characters; the count next to it is the number the row exists to show, and a translated status ("Fusionado") is long enough to push that count through the card border without this.
  "[&_li>span:nth-child(2)]:min-w-0 [&_li>span:nth-child(2)]:overflow-hidden [&_li>span:nth-child(2)]:text-ellipsis [&_li>span:nth-child(2)]:whitespace-nowrap",
  "[&_li:last-child]:border-0 [&_strong]:ml-auto [&_strong]:text-[length:0.9375rem] [&_strong]:font-semibold [&_strong]:text-[var(--foreground)]",
].join(" ");

export const legendDot = "h-[7px] w-[7px] shrink-0 rounded-[2px]";

export const trendTotal = "mx-0 mt-[22px] mb-3 flex items-baseline gap-2 [&_strong]:text-[length:1.6875rem] [&_strong]:font-semibold [&_strong]:tracking-[-1px] [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] @row/overview:[&_strong]:text-[length:1.875rem]";

export const achievementFootnote = "mx-[3px] my-[17px] flex items-start gap-[7px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] [&_svg]:mt-px [&_svg]:shrink-0";

export const achievementEmpty = "rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-9 text-[length:0.8125rem] text-[var(--muted)]";

export const yearTabs = "mx-0 mt-0 mb-5 flex max-w-full gap-1 overflow-x-auto border-b border-[var(--border)] px-0.5 pt-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [overscroll-behavior-x:contain]";

export const yearTab = [
  // The strip pans horizontally, so a mis-tap here does not merely miss: it selects a neighbouring year and refetches the whole overview. The floor is written against the pointer because a 36px target is wrong on a 1024px tablet and right in a 480px desktop window.
  "flex-[0_0_auto] min-h-9 pointer-coarse:min-h-11 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3.5 py-[11px]",
  "text-[length:var(--text-body)] font-normal text-[var(--muted)] [font-variant-numeric:tabular-nums]",
  "hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]",
  "focus-visible:rounded [focus-visible:outline-2] focus-visible:outline-2 focus-visible:-outline-offset-[3px] focus-visible:outline-[var(--accent)]",
  "data-[state=active]:border-b-[var(--accent)] data-[state=active]:font-semibold data-[state=active]:text-[var(--accent-text)]",
].join(" ");

export const yearPanel = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

export const visibilityTabs = [
  // `w-max` alone sizes this track to its three triggers, about 520px in English and more in Spanish, and nothing between here and <html> clips it — so on a phone the whole document gained a horizontal scrollbar and the third trigger started off-screen with nothing to suggest it was there. The track only hugs its content once the dashboard is wide enough to hold it; below that it fills the available width and the triggers wrap onto a second row. `flex-wrap` is left on at every width on purpose: paired with `max-w-full` it is what stops a longer translation from reopening the same bug on a desktop that is merely narrow.
  "mb-3 flex max-w-full flex-wrap gap-1 rounded-lg bg-[var(--surface-muted)] p-1 @row/dashboard:w-max",
  "[&_button]:min-h-9 pointer-coarse:[&_button]:min-h-11 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-[7px] [&_button]:text-[length:var(--text-body)] [&_button]:font-normal [&_button]:text-[var(--muted)]",
  "[&_button[data-state=active]]:bg-[var(--surface)] [&_button[data-state=active]]:font-semibold [&_button[data-state=active]]:text-[var(--accent-text)] [&_button[data-state=active]]:shadow-[0_1px_3px_var(--shadow)]",
  "[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--accent)]",
  "[&_button_span]:ml-[5px] [&_button_span]:inline-block [&_button_span]:text-[var(--muted)] [&_button_span]:[font-variant-numeric:tabular-nums]",
].join(" ");

export const visibilityFeedback = "mx-0 mt-[-4px] mb-3 max-w-[760px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] [&_a]:text-[var(--accent-text)] [&_a]:underline [&_a]:underline-offset-[3px]";

export const authorizedAccounts = [
  "mx-0 mt-0 mb-4 flex flex-wrap gap-2 text-[length:0.75rem]",
  "[&_a]:rounded-md [&_a]:border [&_a]:border-[var(--border)] [&_a]:bg-[var(--accent-soft)] [&_a]:px-[9px] [&_a]:py-[5px] [&_a]:text-[var(--accent-text)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere] hoverable:[&_a:hover]:underline",
  // These chips are links into github.com, so they need a real tap target rather than the 38px the padding gives them. inline-flex is what lets the minimum apply at all: min-height does nothing to the inline box an anchor defaults to.
  "pointer-coarse:[&_a]:inline-flex pointer-coarse:[&_a]:min-h-11 pointer-coarse:[&_a]:items-center",
].join(" ");

// Direction and gap come from the container query at the call site.
export const trendHeader = "flex flex-wrap justify-between";

export const trendHeadingSlot = "m-0 min-w-[130px] flex-1";

export const trendRepoTrigger = [
  // Width and its limit are set at the call site by a container query.
  "flex min-w-[160px] flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[length:0.8125rem] text-[var(--foreground)] pointer-coarse:min-h-11",
  "[&>span:first-of-type]:min-w-0 [&>span:first-of-type]:flex-1 [&>span:first-of-type]:overflow-hidden [&>span:first-of-type]:text-left [&>span:first-of-type]:text-ellipsis [&>span:first-of-type]:whitespace-nowrap [&_svg]:shrink-0",
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]",
].join(" ");

// Gap and wrapping come from the container query at the call site.
export const trendSummaryRow = "mx-0 mt-[18px] mb-2.5 flex flex-col items-start justify-between [&_.trend-total]:m-0 @row/overview:mt-5 @row/overview:flex-row @row/overview:items-center";

export const trendRepositoryLink = "text-[length:0.75rem] text-[var(--accent-text)] no-underline [overflow-wrap:anywhere] hover:underline";

export const trendEmpty = "flex min-h-[280px] flex-col items-center justify-center text-[length:0.8125rem] text-[var(--muted)]";

export const trendSkeleton = "pt-2.5";

// Stacked below the split width, the ring keeps its full 166px box and the legend gets the panel's whole width, which is what the two shrink overrides used to buy at the cost of an out-of-square ring. Above it there is room for both at their natural size, so there is nothing left to override.
export const distributionSummary = "mx-0 my-4 flex items-center gap-2.5 @max-split/dashboard:flex-col @row/overview:gap-[18px]";

export const distributionLegend = [
  // A cap rather than a height: a contributor with two repositories should not be shown 180px of empty list. On a phone the panel is the page, so a nested scroll region here would swallow a vertical swipe and — with `overscroll-behavior` containing it — refuse to hand the gesture back to the page at the end of the list.
  "m-0 max-h-[180px] min-w-0 flex-1 list-none overflow-y-auto p-0 [overscroll-behavior-y:contain] [scrollbar-gutter:stable] @max-split/dashboard:max-h-none @max-split/dashboard:overflow-visible",
  "[&_li]:mx-0 [&_li]:my-3 [&_li]:flex [&_li]:min-w-0 [&_li]:items-center [&_li]:gap-2 [&_li]:text-[length:var(--text-caption)] [&_li]:leading-[1.5] [&_li]:text-[var(--muted)]",
  // Every row is a link that leaves the application for github.com, and at 12px/1.5 the anchor alone is an 18px target; the padding grows the anchor so the enlarged row is all hit area rather than mostly dead space. 13px a side is what reaches 44 from an 18px line — `min-h-11` on the anchor would get the same box but leave the text sitting 6px above its centre, because the anchor lays its own text out as a block.
  "pointer-coarse:[&_li]:min-h-11 pointer-coarse:[&_li>a]:py-[0.8125rem]",
  "[&_li>span:nth-child(2)]:flex-1 [&_li>span:nth-child(2)]:overflow-hidden [&_li>span:nth-child(2)]:text-ellipsis [&_li>span:nth-child(2)]:whitespace-nowrap",
  "[&_strong]:font-semibold [&_strong]:whitespace-nowrap [&_strong]:text-[var(--foreground)]",
  "[&_li>a]:min-w-0 [&_li>a]:flex-1 [&_li>a]:overflow-hidden [&_li>a]:text-left [&_li>a]:text-ellipsis [&_li>a]:whitespace-nowrap [&_li>a]:text-inherit [&_li>a]:no-underline [&_li>a]:[font:inherit]",
  "hoverable:[&_a:hover]:text-[var(--accent-text)] hoverable:[&_a:hover]:underline",
].join(" ");

export const distributionDetails = [
  "max-h-[260px] overflow-auto border-t border-[var(--border)] [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] @max-split/dashboard:max-h-none",
  // A fixed layout with the first column pinned at 60% leaves the share column about 29px between its cell padding, and "37,04 %" does not fit in it. Letting the browser measure the columns is only right where the space is genuinely short; on a wide panel the fixed layout is what keeps the three columns from jumping as rows load.
  "[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:text-[length:var(--text-caption)] [&_table]:leading-[1.5] @max-split/dashboard:[&_table]:table-auto",
  "[&_th]:sticky [&_th]:top-0 [&_th]:bg-[var(--surface-muted)] [&_th]:text-left [&_th]:font-normal [&_th]:text-[var(--muted)]",
  "[&_th]:px-2 [&_th]:py-3 [&_td]:px-2 [&_td]:py-3 [&_th]:border-b [&_th]:border-[var(--border-subtle)] [&_td]:border-b [&_td]:border-[var(--border-subtle)]",
  "[&_th:first-child]:w-[60%] [&_th:not(:first-child)]:text-right [&_th:not(:first-child)]:whitespace-nowrap [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:whitespace-nowrap",
  "@max-split/dashboard:[&_th:first-child]:w-auto @max-split/dashboard:[&_td:not(:first-child)]:whitespace-normal",
  "[&_a]:text-[var(--accent-text)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere] hoverable:[&_a:hover]:underline",
  "hoverable:[&_tr:hover_td]:bg-[var(--surface-muted)]",
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]",
  "mt-4",
].join(" ");

export const repositoryTooltip = "max-w-[260px] min-w-[170px] leading-[1.6] [&_a]:mb-1.5 [&_a]:block [&_a]:text-[var(--accent-text)] [&_a]:[overflow-wrap:anywhere] hoverable:[&_a:hover]:text-[var(--accent-text)] hoverable:[&_a:hover]:underline [&_div]:flex [&_div]:justify-between [&_div]:gap-4";

export const distributionPanel = `${panelSurface} block [&_svg]:cursor-pointer`;
