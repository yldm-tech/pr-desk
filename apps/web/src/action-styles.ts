// The button shapes the application reuses wherever it offers an action.
//
// Size is part of each exported name rather than something a caller appends: a
// second padding utility in the same class attribute does not override the
// first — the generated stylesheet decides the order, not the writing.
//
// Every size here carries a `pointer-coarse:` floor of 44px. The floor is a function of the pointer rather than of the width because a 34px button is wrong on a 1024px tablet and right in a 480px desktop window, and because the variant is registered after every width variant it wins over them wherever both apply. A fine pointer keeps the existing 34/40px shapes untouched.
const actionShape = "inline-flex items-center justify-center gap-2 rounded-lg font-medium no-underline";
const actionSize = "min-h-10 px-4 py-2.5 pointer-coarse:min-h-11";
const secondaryFrame = "border border-[var(--border)] bg-[var(--surface)]";
const secondarySkin = `${secondaryFrame} text-[var(--foreground)] hover:bg-[var(--surface-muted)]`;

export const primaryAction = `${actionShape} ${actionSize} border border-[var(--accent-text)] bg-[var(--accent-text)] text-[var(--surface)] hover:bg-[var(--accent)]`;

export const secondaryAction = `${actionShape} ${actionSize} ${secondarySkin}`;

// Inside a list row, and beside the field it acts on, the same button is smaller. This and dangerAction are the confirm/cancel pair of every destructive step in the application, sitting a 10px gap apart, so the touch floor also has to grow the padding: min-height alone would centre the same 34px of content in 44px and leave the two labels as close together as before.
export const compactAction = `${actionShape} min-h-[34px] px-3 py-1.5 text-[length:0.75rem] pointer-coarse:min-h-11 pointer-coarse:py-2.5 ${secondarySkin}`;

// Inside a follow-up card, where several sit in a row under the text.
export const inlineAction = `${actionShape} min-h-10 px-2.5 py-[7px] text-[length:0.75rem] pointer-coarse:min-h-11 ${secondarySkin}`;

// Beside a block of text to copy: full height, small label.
export const copyAction = `${actionShape} min-h-10 shrink-0 px-3 py-2 text-[length:0.75rem] pointer-coarse:min-h-11 ${secondarySkin}`;

// Removing something: the same compact shape, in the colour of a warning.
export const dangerAction = `${actionShape} min-h-[34px] px-3 py-1.5 text-[length:0.75rem] pointer-coarse:min-h-11 pointer-coarse:py-2.5 ${secondaryFrame} text-[var(--danger)] hover:bg-[var(--danger-soft)]`;

// A button that reads as a link: used to retry a request without leaving the
// sentence it sits in.
//
// This is the recovery control on every failed-fetch path, and `p-0` makes its hit area exactly the text box — roughly 18px tall at the 12px font it usually inherits. Every call site is a <button>, so the floor needs `inline-flex items-center` beside it: a min-height on the default inline-block grows the box downwards and strands the label at the top of it, while a flex box keeps the label centred and the sentence reading as it did. The negative margin cancels the horizontal padding for the same reason.
export const linkAction = "cursor-pointer border-0 bg-transparent p-0 text-[var(--accent-text)] underline underline-offset-[3px] disabled:cursor-wait disabled:opacity-50 [font:inherit] pointer-coarse:-mx-1 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:px-1";

// The panel shown when a list has nothing in it, or could not be loaded.
export const emptyState =
  "flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-9 text-center text-[var(--muted)] [&>h2]:m-0 [&>h2]:text-[length:1rem] [&>h2]:text-[var(--foreground)] [&>p]:m-0 [&>p]:max-w-[380px] [&>p]:text-[length:0.8125rem] [&>p]:leading-[1.7]";
