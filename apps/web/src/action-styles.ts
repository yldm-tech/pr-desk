// The two button shapes the application reuses wherever it offers an action.
// They were a shared selector group in the stylesheet and stay shared here.
const actionBase = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium no-underline";

export const primaryAction = `${actionBase} border border-[var(--accent-text)] bg-[var(--accent-text)] text-[var(--surface)] hover:bg-[var(--accent)]`;
