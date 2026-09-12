// The application shell — sidebar, navigation, page header — and the pull
// request table it frames. The loading skeleton mirrors the table.
//
// Variant prefixes are written out in full: Tailwind finds classes by scanning
// the source for complete names, so one joined on at runtime gets no rule.

export const appShell = "flex min-h-screen";

// Only shown on the contribution overview, which asks for a wider measure and a
// quieter heading than the rest of the application.
export const overviewCanvas = "bg-[var(--canvas)] text-[var(--foreground)]";
// The width and padding this route asked for were already being overridden by
// the utilities on the element itself, so only the header gap survives.
export const overviewMain = "";
export const pageHeaderGap = "mb-[18px]";
export const overviewHeaderGap = "mb-5 [@media(max-width:640px)]:mb-[18px]";
// The overview heading is the same as every other: a later rule names both.
export const overviewHeading = "";
export const asideBorder = "border-r-[var(--border-subtle)] [@media(max-width:640px)]:border-b-[var(--border)]";
export const overviewAside = "border-[var(--border)]";

export const sidebar = ["sticky top-0 flex h-[100dvh] shrink-0 flex-col self-start overflow-y-auto border-r bg-[var(--surface)] px-[18px] py-7 [overscroll-behavior:contain]", "[&>*]:shrink-0"].join(" ");

export const brand = "flex items-center gap-2.5 px-3 pt-0 pb-7 text-[19px] font-bold tracking-[-0.4px] whitespace-nowrap text-[var(--foreground)] no-underline";

export const brandLogo = "grid h-[29px] w-[29px] place-items-center rounded-lg bg-[var(--accent)] text-white";

export const nav = "flex flex-col gap-1";

const navButtonBase = [
  "flex min-h-11 items-center gap-2.5 rounded-lg border-0 px-3 py-[11px] text-left text-[length:var(--text-body)] font-[family-name:inherit]",
  "transition-[background-color,color] duration-150 motion-reduce:transition-none",
  "[&_svg]:shrink-0 [&_svg]:opacity-80",
  "[&_b]:float-none [&_b]:ml-auto [&_b]:min-w-[22px] [&_b]:rounded-[10px] [&_b]:bg-[var(--accent)] [&_b]:px-1.5 [&_b]:py-px [&_b]:text-center [&_b]:text-[11px] [&_b]:text-[var(--surface)]",
  "[@media(max-width:480px)]:relative [@media(max-width:480px)]:min-h-14 [@media(max-width:640px)]:min-w-0",
  "[@media(max-width:480px)]:[&_b]:absolute [@media(max-width:480px)]:[&_b]:top-0.5 [@media(max-width:480px)]:[&_b]:right-1 [@media(max-width:480px)]:[&_b]:min-w-4 [@media(max-width:480px)]:[&_b]:px-1 [@media(max-width:480px)]:[&_b]:py-0 [@media(max-width:480px)]:[&_b]:text-[9px]",
].join(" ");

// Hover is only offered where it leads somewhere: the open page does not react.
export const navButton = (active: boolean) => (active ? `${navButtonBase} bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]` : `${navButtonBase} bg-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]`);

export const sidebarBottom = "mt-auto pt-6";

const sidebarActionBase = "mb-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border p-2.5 text-[length:var(--text-body)] font-medium no-underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] [@media(max-width:480px)]:min-w-9";

export const sidebarAction = `${sidebarActionBase} border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]`;

export const sidebarActionActive = `${sidebarActionBase} border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]`;

export const syncButton =
  "flex min-h-10 w-full justify-center gap-2 rounded-lg border border-[var(--accent-text)] bg-[var(--accent-text)] p-2.5 text-[length:var(--text-body)] font-medium text-[var(--surface)] hover:not-disabled:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export const spinning = "animate-[spin_0.9s_linear_infinite] motion-reduce:animate-none";

export const skipLink = "fixed top-3 left-3 z-[200] rounded-lg bg-[var(--accent-text)] px-4 py-2.5 text-[var(--surface)] no-underline [transform:translateY(-160%)] focus:[transform:translateY(0)]";

export const pageHeader = ["grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-x-5 gap-y-3", "[@media(max-width:640px)_and_(min-width:481px)]:gap-3", "[@media(max-width:480px)]:grid-cols-[minmax(0,1fr)_auto] [@media(max-width:480px)]:gap-2"].join(" ");

export const pageTitle = "m-0 text-[23px] font-semibold tracking-[-0.6px] [@media(max-width:480px)]:text-[20px]";

export const accountBar = [
  "m-0 flex min-h-0 items-center justify-end gap-4",
  "[@media(max-width:800px)]:gap-2.5",
  "[@media(max-width:640px)_and_(min-width:481px)]:col-span-full [@media(max-width:640px)]:row-start-1 [@media(max-width:640px)]:flex-wrap [@media(max-width:640px)]:gap-3 [@media(max-width:640px)_and_(min-width:481px)]:justify-between",
  "[@media(max-width:480px)]:col-start-2 [@media(max-width:480px)]:row-start-1 [@media(max-width:480px)]:justify-end",
].join(" ");

export const headerTitleSlot = "[@media(max-width:640px)_and_(min-width:481px)]:col-span-full [@media(max-width:480px)]:col-start-1 [@media(max-width:480px)]:row-start-1";

export const headerDate = "text-[12px] leading-[1.5] whitespace-nowrap text-[var(--muted)] [@media(max-width:640px)]:flex-1 [@media(max-width:480px)]:hidden";

export const headerActions = "flex min-w-0 items-center gap-2.5 [@media(max-width:800px)_and_(min-width:481px)]:gap-2 [@media(max-width:640px)]:ml-auto [@media(max-width:480px)]:gap-1.5";

export const listHeading =
  "mx-0 mt-0 mb-3.5 flex flex-wrap items-center justify-between gap-4 [&_h2]:m-0 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2>span]:ml-1.5 [&_h2>span]:inline-flex [&_h2>span]:min-w-6 [&_h2>span]:items-center [&_h2>span]:justify-center [&_h2>span]:rounded-md [&_h2>span]:bg-[var(--surface-muted)] [&_h2>span]:px-[7px] [&_h2>span]:py-0.5 [&_h2>span]:text-[12px] [&_h2>span]:text-[var(--muted)]";

export const backgroundRefresh = "ml-3 inline-flex items-center gap-[5px] text-[11px] font-normal text-[var(--muted)]";

export const toolbar = "mx-0 mt-0 mb-4 flex flex-wrap items-center justify-between gap-4 [@media(max-width:640px)]:block";

export const searchForm = [
  "max-w-[360px] min-w-[200px] flex-1",
  "[&>label]:absolute [&>label]:mb-1.5 [&>label]:block [&>label]:h-px [&>label]:w-px [&>label]:overflow-hidden [&>label]:text-[12px] [&>label]:whitespace-nowrap [&>label]:text-[var(--muted)] [&>label]:[clip-path:inset(50%)]",
  "[&>div]:flex [&>div]:items-center [&>div]:gap-1.5",
  "[&_input]:min-h-10 [&_input]:w-full [&_input]:min-w-0 [&_input]:flex-1 [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--border)] [&_input]:bg-[var(--surface)] [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-[length:var(--text-body)] [&_input]:[font-family:inherit]",
  "[&_button]:flex [&_button]:min-h-10 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-lg [&_button]:border [&_button]:border-[var(--border)] [&_button]:bg-white [&_button]:px-2.5 [&_button]:py-2 [&_button]:text-[var(--foreground)] [&_button:hover]:bg-[var(--surface-muted)]",
  "[@media(max-width:640px)]:w-full [@media(max-width:640px)]:[&_input]:w-full",
].join(" ");

export const filters = [
  "flex gap-0.5 rounded-[9px] bg-[var(--surface-muted)] p-1",
  "[&_button]:min-h-9 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:py-[7px] [&_button]:text-[12px] [&_button]:text-[var(--muted)]",
  "[&_button:hover:not(.selected)]:text-[var(--foreground)]",
  "[&_.selected]:bg-[var(--surface)] [&_.selected]:font-semibold [&_.selected]:text-[var(--accent-text)] [&_.selected]:shadow-[0_1px_3px_var(--shadow)]",
  "[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--accent)]",
  "[@media(max-width:640px)]:mt-2.5 [@media(max-width:640px)]:overflow-auto",
].join(" ");

export const searchChip = "inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-[9px] py-[5px] text-[12px] text-[var(--accent-text)] [overflow-wrap:anywhere]";

export const linkButton = "cursor-pointer border-0 bg-transparent p-0 text-[var(--accent)] [font:inherit]";

export const tableSurface = "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]";

const rowGrid = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_0.5fr] items-center gap-[15px] px-5 [@media(max-width:900px)_and_(min-width:641px)]:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_0.5fr] [@media(max-width:900px)_and_(min-width:641px)]:gap-2.5";

export const tableHead = `${rowGrid} border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] py-3 text-[length:var(--text-caption)] leading-[1.5] text-[var(--muted)] [@media(max-width:900px)]:[&>span:nth-child(4)]:hidden [@media(max-width:640px)]:hidden`;

export const tableRow = [
  rowGrid,
  "min-h-[90px] border-b border-[var(--border-subtle)] py-[18px] transition-[background-color] duration-150 last:border-0 hover:bg-[var(--surface-muted)] focus-within:bg-[var(--surface-muted)] motion-reduce:transition-none",
  "[@media(max-width:640px)]:grid-cols-[1fr_auto] [@media(max-width:640px)]:gap-2 [@media(max-width:640px)]:px-3",
].join(" ");

export const prTitle = "flex items-start gap-[11px] [&>svg]:mt-[3px] [&>svg]:shrink-0 [&>div]:min-w-0 [&_small]:mt-1 [&_small]:block [&_small]:text-[length:var(--text-caption)] [&_small]:leading-[1.5] [&_small]:text-[var(--muted)] [&_em]:text-[var(--muted)] [&_em]:not-italic";

export const prTitleLink =
  "block text-[length:var(--text-body)] leading-[1.6] font-semibold text-[var(--foreground)] no-underline [overflow-wrap:anywhere] hover:text-[var(--accent-text)] hover:underline focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]";

export const prRepository = "min-w-0 text-[12px] leading-[1.6] text-[var(--muted)] no-underline [overflow-wrap:anywhere] hover:text-[var(--accent-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)]";

export const prStatus = "flex flex-wrap items-start gap-1.5 [@media(max-width:640px)]:col-span-full [@media(max-width:640px)]:row-start-3";

export const pill = "inline-flex items-center rounded-[5px] px-[7px] py-[3px] text-[12px] leading-[1.6] whitespace-nowrap";

export const conflict = "[@media(max-width:640px)]:ml-1.5 m-0 inline-flex items-center gap-[3px] rounded-[5px] bg-[var(--danger-soft)] px-1.5 py-[3px] text-[12px] text-[var(--danger)]";

export const prUpdated = "text-[12px] leading-[1.7] [font-variant-numeric:tabular-nums]";

export const rowActivity = "[@media(max-width:640px)]:col-start-2 [@media(max-width:640px)]:row-start-1 flex items-center justify-center gap-[5px] text-[12px] text-[var(--muted)]";

export const commentButton =
  "flex min-h-10 min-w-10 cursor-pointer items-center justify-center gap-[5px] rounded-[7px] border border-transparent bg-transparent p-1.5 text-[12px] text-[var(--muted)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:border-[var(--accent-border)] focus-visible:bg-[var(--accent-soft)] focus-visible:text-[var(--accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

// The tone of a check result, for the table where it sits under the status.
export const tableChecks = "block w-full items-center text-[12px] capitalize";

export const pagination =
  "mx-0 my-0 flex items-center justify-end gap-3 py-3.5 text-[12px] text-[var(--muted)] [&_button]:min-h-9 [&_button]:rounded-[7px] [&_button]:border [&_button]:border-[var(--border)] [&_button]:bg-white [&_button]:px-3 [&_button]:py-2 [&_button]:text-[var(--foreground)] [&_button:hover:not(:disabled)]:bg-[var(--surface-muted)] [&_button:disabled]:cursor-default [&_button:disabled]:opacity-45";

export const stats = "mx-0 mt-0 mb-7 grid grid-cols-4 gap-3.5 [@media(max-width:900px)]:grid-cols-2";

export const stat =
  "flex min-h-[88px] items-center gap-[13px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-[18px] shadow-none [&_span]:mb-1 [&_span]:block [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] [&_strong]:text-[26px] [&_strong]:leading-[1.3] [&_strong]:font-semibold [&_strong]:[font-variant-numeric:tabular-nums]";

export const statIcon = "rounded-lg bg-[var(--surface-muted)] p-[9px] text-[var(--muted)]";

export const syncFeedback =
  "mx-0 mt-0 mb-[18px] flex items-start justify-between gap-4 rounded-[9px] border border-[var(--success-border)] bg-[var(--success-soft)] px-4 py-3 text-[12px] leading-[1.6] text-[var(--success)] [&_button]:cursor-pointer [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[20px] [&_button]:leading-none [&_button]:text-inherit";

// The success notice floats; the failure notice stays in the flow.
export const syncFeedbackFloating = "fixed right-5 bottom-5 z-[25] m-0 w-[min(420px,calc(100vw-40px))] shadow-[0_8px_28px_var(--shadow)]";

export const muted = "text-[var(--muted)] [@media(max-width:900px)]:hidden";

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
export const prListSkeletonRow = "hover:bg-[var(--surface)] [&_.prstatus>span:last-child]:w-full";

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

export const eyebrow = "mx-0 mt-0 mb-2 text-[12px] text-[var(--muted)]";
export const overviewEyebrow = "mx-0 mt-0 mb-3 text-[11px] text-[var(--muted)]";
export const accentText = "text-[var(--accent)]";
