// The button shapes the application reuses wherever it offers an action.
//
// Size is part of each exported name rather than something a caller appends: a
// second padding utility in the same class attribute does not override the
// first — the generated stylesheet decides the order, not the writing.
const actionShape = "inline-flex items-center justify-center gap-2 rounded-lg font-medium no-underline";
const actionSize = "min-h-10 px-4 py-2.5";
const secondaryFrame = "border border-[var(--border)] bg-[var(--surface)]";
const secondarySkin = `${secondaryFrame} text-[var(--foreground)] hover:bg-[var(--surface-muted)]`;

export const primaryAction = `${actionShape} ${actionSize} border border-[var(--accent-text)] bg-[var(--accent-text)] text-[var(--surface)] hover:bg-[var(--accent)]`;

export const secondaryAction = `${actionShape} ${actionSize} ${secondarySkin}`;

// Inside a list row, and beside the field it acts on, the same button is smaller.
export const compactAction = `${actionShape} min-h-[34px] px-3 py-1.5 text-[12px] ${secondarySkin}`;

// Inside a follow-up card, where several sit in a row under the text.
export const inlineAction = `${actionShape} min-h-10 px-2.5 py-[7px] text-[12px] ${secondarySkin}`;

// Beside a block of text to copy: full height, small label.
export const copyAction = `${actionShape} min-h-10 shrink-0 px-3 py-2 text-[12px] ${secondarySkin}`;

// Removing something: the same compact shape, in the colour of a warning.
export const dangerAction = `${actionShape} min-h-[34px] px-3 py-1.5 text-[12px] ${secondaryFrame} text-[var(--danger)] hover:bg-[var(--danger-soft)]`;

// A button that reads as a link: used to retry a request without leaving the
// sentence it sits in.
export const linkAction = "cursor-pointer border-0 bg-none p-0 text-[var(--accent-text)] underline underline-offset-[3px] disabled:cursor-wait disabled:opacity-50 [font:inherit]";

// The panel shown when a list has nothing in it, or could not be loaded.
export const emptyState =
  "flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-9 text-center text-[var(--muted)] [&>h2]:m-0 [&>h2]:text-[16px] [&>h2]:text-[var(--foreground)] [&>p]:m-0 [&>p]:max-w-[380px] [&>p]:text-[13px] [&>p]:leading-[1.7]";
