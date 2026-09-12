// The contribution overview: the score card, the outcome ring, the trend and
// repository panels, and the two tab strips above them. The loading skeleton
// mirrors the same shapes.
//
// Variant prefixes are written out in full — Tailwind finds classes by scanning
// the source for complete names, so one joined on at runtime gets no rule.

export const overviewPage =
  "mt-0 [font-variant-numeric:tabular-nums] [&_a:focus-visible]:rounded-[3px] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-[var(--accent)] [&_button:focus-visible]:rounded-[3px] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[var(--accent)] [&_svg_text]:font-[family-name:var(--font-ui)] [&_[data-ts-chart]]:text-[var(--muted)]";

// The columns themselves are set where this is used, by a container query.
export const achievementTop = "gap-[18px] [@media(max-width:1100px)]:min-h-[240px]";

export const achievementBottom = "mt-[18px] gap-[18px]";

// The score card was a dark hero; on this layout it is a plain surface, and the
// hero tokens it still refers to are redefined to match.
export const achievementScore = [
  "relative min-h-[252px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] px-[30px] pt-7 pb-0 text-[var(--foreground)]",
  "[--hero-border:var(--border-subtle)] [--hero-muted:var(--muted)] [--hero-text:var(--foreground)] [--skeleton-hero-base:var(--skeleton-base)] [--skeleton-hero-highlight:var(--skeleton-highlight)]",
  "[@media(max-width:1100px)]:min-h-[240px] [@media(max-width:640px)]:px-6 [@media(max-width:640px)]:pt-6",
].join(" ");

export const scoreLabel = "flex items-center gap-[9px] text-[13px] leading-[1.5] text-[var(--hero-muted)] [&_svg]:text-[var(--accent-text)]";

export const scoreNumber = "relative z-[1] mt-3 text-[60px] leading-[1.15] font-semibold tracking-[-3px] text-[var(--accent-text)] [&>span]:ml-3 [&>span]:text-[13px] [&>span]:font-normal [&>span]:tracking-normal [&>span]:text-[var(--hero-muted)]";

export const scoreRate = "mt-2.5 flex items-center gap-[7px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--hero-muted)] [&_strong]:font-semibold [&_strong]:text-[var(--hero-text)]";

export const scoreDot = "h-[5px] w-[5px] rounded-[50%] bg-[var(--hero-muted)]";

// Hidden on this layout, but still rendered so the markup does not change.
export const scoreWatermark = "hidden";

export const scoreSecondary = [
  "relative mt-[26px] grid grid-cols-2 gap-[18px] border-t border-[var(--hero-border)] py-[18px]",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-[7px] [&>div]:text-[length:var(--text-caption)] [&>div]:leading-[1.5] [&>div]:text-[var(--hero-muted)]",
  "[&_strong]:ml-auto [&_strong]:text-[19px] [&_strong]:font-semibold [&_strong]:text-[var(--hero-text)]",
  "[@media(max-width:640px)]:gap-3 [@media(max-width:640px)]:[&_strong]:text-[17px]",
].join(" ");

const panelSurface = "min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 [@media(max-width:640px)]:px-4 [@media(max-width:640px)]:py-5";

export const achievementPanel = panelSurface;

export const achievementOutcomes = `${panelSurface} [@media(max-width:1100px)]:[&_.outcomes-content]:justify-evenly [@media(max-width:1100px)]:[&_ul]:max-w-[250px]`;

export const panelHeading = "flex items-center justify-between gap-3 [&_h2]:m-0 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:tracking-normal [&_h2]:text-[var(--foreground)] [&_p]:mx-0 [&_p]:mt-[9px] [&_p]:mb-0 [&_p]:text-[length:var(--text-caption)] [&_p]:leading-[1.5] [&_p]:text-[var(--muted)]";

export const panelKicker = "text-[length:var(--text-caption)] leading-[1.5] tracking-normal whitespace-nowrap text-[var(--muted)] [@media(max-width:480px)]:text-right [@media(max-width:480px)]:whitespace-normal";

export const panelDescription = "mx-0 mt-[9px] mb-0 text-[length:var(--text-caption)] leading-[1.7] text-[var(--muted)]";

export const outcomesContent = "outcomes-content mt-4 flex items-center justify-center gap-4 [@media(max-width:640px)]:gap-3";

export const outcomesRing = "outcomes-ring relative h-[166px] w-[166px] min-w-[130px] flex-[0_1_166px]";

export const ringLabel = "pointer-events-none absolute inset-0 flex flex-col items-center justify-center [&_strong]:text-[26px] [&_strong]:font-semibold [&_strong]:tracking-[-1px] [&_span]:mt-1 [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)]";

export const outcomesLegend = [
  "m-0 min-w-[100px] max-w-[190px] flex-1 list-none p-0",
  "[&_li]:flex [&_li]:items-center [&_li]:gap-[9px] [&_li]:border-b [&_li]:border-[var(--border-subtle)] [&_li]:py-3 [&_li]:text-[length:var(--text-caption)] [&_li]:leading-[1.5] [&_li]:text-[var(--muted)]",
  "[&_li:last-child]:border-0 [&_strong]:ml-auto [&_strong]:text-[15px] [&_strong]:font-semibold [&_strong]:text-[var(--foreground)]",
].join(" ");

export const legendDot = "h-[7px] w-[7px] shrink-0 rounded-[2px]";

export const trendTotal = "mx-0 mt-[22px] mb-3 flex items-baseline gap-2 [&_strong]:text-[30px] [&_strong]:font-semibold [&_strong]:tracking-[-1px] [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] [@media(max-width:640px)]:[&_strong]:text-[27px]";

export const achievementFootnote = "mx-[3px] my-[17px] flex items-start gap-[7px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] [&_svg]:mt-px [&_svg]:shrink-0";

export const achievementEmpty = "rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-9 text-[13px] text-[var(--muted)]";

export const yearTabs = "mx-0 mt-0 mb-5 flex max-w-full gap-1 overflow-x-auto border-b border-[var(--border)] px-0.5 pt-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [overscroll-behavior-x:contain]";

export const yearTab = [
  "flex-[0_0_auto] min-h-9 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3.5 py-[11px]",
  "text-[length:var(--text-body)] font-normal text-[var(--muted)] [font-variant-numeric:tabular-nums]",
  "hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]",
  "focus-visible:rounded [focus-visible:outline-2] focus-visible:outline-2 focus-visible:-outline-offset-[3px] focus-visible:outline-[var(--accent)]",
  "data-[state=active]:border-b-[var(--accent)] data-[state=active]:font-semibold data-[state=active]:text-[var(--accent-text)]",
].join(" ");

export const yearPanel = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

export const visibilityTabs = [
  "mb-3 flex w-max gap-1 rounded-lg bg-[var(--surface-muted)] p-1",
  "[&_button]:min-h-9 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-[7px] [&_button]:text-[length:var(--text-body)] [&_button]:font-normal [&_button]:text-[var(--muted)]",
  "[&_button[data-state=active]]:bg-[var(--surface)] [&_button[data-state=active]]:font-semibold [&_button[data-state=active]]:text-[var(--accent-text)] [&_button[data-state=active]]:shadow-[0_1px_3px_var(--shadow)]",
  "[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--accent)]",
  "[&_button_span]:ml-[5px] [&_button_span]:inline-block [&_button_span]:text-[var(--muted)] [&_button_span]:[font-variant-numeric:tabular-nums]",
].join(" ");

export const visibilityFeedback = "mx-0 mt-[-4px] mb-3 max-w-[760px] text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] [&_a]:text-[var(--accent-text)] [&_a]:underline [&_a]:underline-offset-[3px]";

export const authorizedAccounts = ["mx-0 mt-0 mb-4 flex flex-wrap gap-2 text-[12px]", "[&_a]:rounded-md [&_a]:border [&_a]:border-[var(--border)] [&_a]:bg-[var(--accent-soft)] [&_a]:px-[9px] [&_a]:py-[5px] [&_a]:text-[var(--accent-text)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere] [&_a:hover]:underline"].join(
  " ",
);

// Direction and gap come from the container query at the call site.
export const trendHeader = "flex flex-wrap justify-between";

export const trendHeadingSlot = "m-0 min-w-[130px] flex-1";

export const trendRepoTrigger = [
  // Width and its limit are set at the call site by a container query.
  "flex min-w-[160px] flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--foreground)]",
  "[&>span:first-of-type]:min-w-0 [&>span:first-of-type]:flex-1 [&>span:first-of-type]:overflow-hidden [&>span:first-of-type]:text-left [&>span:first-of-type]:text-ellipsis [&>span:first-of-type]:whitespace-nowrap [&_svg]:shrink-0",
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]",
].join(" ");

// Gap and direction come from the container query at the call site.
export const trendSummaryRow = "mx-0 mt-5 mb-2.5 flex items-center justify-between [&_.trend-total]:m-0 [@media(max-width:640px)]:mt-[18px] [@media(max-width:640px)]:flex-col [@media(max-width:640px)]:items-start";

export const trendRepositoryLink = "text-[12px] text-[var(--accent-text)] no-underline [overflow-wrap:anywhere] hover:underline";

export const trendEmpty = "flex min-h-[280px] flex-col items-center justify-center text-[13px] text-[var(--muted)]";

export const trendSkeleton = "pt-2.5";

export const distributionSummary = "mx-0 my-4 flex items-center gap-[18px] [@media(max-width:640px)]:gap-2.5 [@media(max-width:640px)]:[&_.outcomes-ring]:min-w-[120px] [@media(max-width:640px)]:[&_.outcomes-ring]:basis-[130px]";

export const distributionLegend = [
  "m-0 h-[180px] min-w-0 flex-1 list-none overflow-y-auto p-0 [overscroll-behavior-y:contain] [scrollbar-gutter:stable]",
  "[&_li]:mx-0 [&_li]:my-3 [&_li]:flex [&_li]:min-w-0 [&_li]:items-center [&_li]:gap-2 [&_li]:text-[length:var(--text-caption)] [&_li]:leading-[1.5] [&_li]:text-[var(--muted)]",
  "[&_li>span:nth-child(2)]:flex-1 [&_li>span:nth-child(2)]:overflow-hidden [&_li>span:nth-child(2)]:text-ellipsis [&_li>span:nth-child(2)]:whitespace-nowrap",
  "[&_strong]:font-semibold [&_strong]:whitespace-nowrap [&_strong]:text-[var(--foreground)]",
  "[&_li>a]:min-w-0 [&_li>a]:flex-1 [&_li>a]:overflow-hidden [&_li>a]:text-left [&_li>a]:text-ellipsis [&_li>a]:whitespace-nowrap [&_li>a]:text-inherit [&_li>a]:no-underline [&_li>a]:[font:inherit]",
  "[&_a:hover]:text-[var(--accent-text)] [&_a:hover]:underline",
].join(" ");

export const distributionDetails = [
  "max-h-[260px] overflow-auto border-t border-[var(--border)] [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]",
  "[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:text-[length:var(--text-caption)] [&_table]:leading-[1.5]",
  "[&_th]:sticky [&_th]:top-0 [&_th]:bg-[var(--surface-muted)] [&_th]:text-left [&_th]:font-normal [&_th]:text-[var(--muted)]",
  "[&_th]:px-2 [&_th]:py-3 [&_td]:px-2 [&_td]:py-3 [&_th]:border-b [&_th]:border-[var(--border-subtle)] [&_td]:border-b [&_td]:border-[var(--border-subtle)]",
  "[&_th:first-child]:w-[60%] [&_th:not(:first-child)]:text-right [&_th:not(:first-child)]:whitespace-nowrap [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:whitespace-nowrap",
  "[&_a]:text-[var(--accent-text)] [&_a]:no-underline [&_a]:[overflow-wrap:anywhere] [&_a:hover]:underline",
  "[&_tr:hover_td]:bg-[var(--surface-muted)]",
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]",
  "mt-4",
].join(" ");

export const repositoryTooltip = "max-w-[260px] min-w-[170px] leading-[1.6] [&_a]:mb-1.5 [&_a]:block [&_a]:text-[var(--accent-text)] [&_a]:[overflow-wrap:anywhere] [&_a:hover]:text-[var(--accent-text)] [&_a:hover]:underline [&_div]:flex [&_div]:justify-between [&_div]:gap-4";

export const distributionPanel = `${panelSurface} block [&_svg]:cursor-pointer`;
