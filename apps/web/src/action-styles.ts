// The two button shapes the application reuses wherever it offers an action.
// They were a shared selector group in the stylesheet and stay shared here.
const actionBase = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium no-underline";

export const primaryAction = `${actionBase} border border-[var(--accent-text)] bg-[var(--accent-text)] text-[var(--surface)] hover:bg-[var(--accent)]`;

// A button that reads as a link: used to retry a request without leaving the
// sentence it sits in.
export const linkAction = "cursor-pointer border-0 bg-none p-0 text-[var(--accent-text)] [font:inherit] underline underline-offset-[3px] disabled:cursor-wait disabled:opacity-50";
