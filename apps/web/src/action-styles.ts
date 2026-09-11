// The two button shapes the application reuses wherever it offers an action.
// They were a shared selector group in the stylesheet and stay shared here.
const actionBase = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium no-underline";

export const primaryAction = `${actionBase} border border-[var(--accent-text)] bg-[var(--accent-text)] text-[var(--surface)] hover:bg-[var(--accent)]`;

// A button that reads as a link: used to retry a request without leaving the
// sentence it sits in.
export const linkAction = "cursor-pointer border-0 bg-none p-0 text-[var(--accent-text)] [font:inherit] underline underline-offset-[3px] disabled:cursor-wait disabled:opacity-50";

export const secondaryAction = `${actionBase} border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]`;

// The panel shown when a list has nothing in it, or could not be loaded.
export const emptyState =
  "flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-9 text-center text-[var(--muted)] [&>h2]:m-0 [&>h2]:text-[16px] [&>h2]:text-[var(--foreground)] [&>p]:m-0 [&>p]:max-w-[380px] [&>p]:text-[13px] [&>p]:leading-[1.7]";
