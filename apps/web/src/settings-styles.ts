// The settings surfaces: the card each section sits in, the fields inside it,
// and the rows that list destinations and authorised clients. The reminder form
// and the agent access panel are separate components that share all of it.
//
// Variant prefixes are written out in full — Tailwind finds classes by scanning
// the source for complete names, so one joined on at runtime never gets a rule.

// A card. The form controls are described from here rather than at each field,
// which is how the stylesheet had it and what keeps a control that a caller
// renders through a child callback looking like the rest.
//
// None of them restate the font: the global control rule already gives them the
// family and size, and the shorthand would reset the line height the textarea
// sets below it.
export const settingsCard = [
  "grid min-w-0 gap-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] @row/dashboard:p-6",
  "[&_fieldset]:min-w-0 [&_fieldset]:border-0 [&_fieldset]:p-0",
  // Chrome keeps a 2px inline offset on a legend box even with padding removed.
  "[&_legend]:mx-0 [&_legend]:mt-0 [&_legend]:mb-1.5 [&_legend]:-ml-0.5 [&_legend]:p-0 [&_legend]:text-[length:0.9375rem] [&_legend]:font-semibold",
  "[&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:rounded-lg [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-[var(--border)] [&_input:not([type=checkbox])]:bg-[var(--surface)] [&_input:not([type=checkbox])]:px-3 [&_input:not([type=checkbox])]:py-[9px] [&_input:not([type=checkbox])]:text-[var(--foreground)]",
  "[&_input:not([type=checkbox])]:min-h-10 [&_input:not([type=checkbox])]:w-full",
  "[&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border [&_select]:border-[var(--border)] [&_select]:bg-[var(--surface)] [&_select]:py-[9px] [&_select]:pr-[34px] [&_select]:pl-3 [&_select]:text-[var(--foreground)]",
  "[&_select]:min-h-10 [&_select]:w-full [&_select]:cursor-pointer [&_select]:appearance-none",
  "[&_select]:bg-[image:var(--select-chevron)] [&_select]:bg-[position:right_12px_center] [&_select]:bg-no-repeat",
  "[&_textarea]:min-w-0 [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[var(--border)] [&_textarea]:bg-[var(--surface)] [&_textarea]:px-3 [&_textarea]:py-[9px] [&_textarea]:text-[var(--foreground)]",
  "[&_textarea]:min-h-[108px] [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:leading-[1.7]",
  // A :hover written inside an arbitrary selector gets no (hover: hover) guard of its own — only the `hover:` variant is wrapped by the compiler — so on touch the border stays accent-coloured after the tap that focused the control.
  "hoverable:[&_input:hover:not(:disabled)]:border-[var(--accent-border)] hoverable:[&_select:hover:not(:disabled)]:border-[var(--accent-border)] hoverable:[&_textarea:hover:not(:disabled)]:border-[var(--accent-border)]",
  "[&_input[aria-invalid=true]]:border-[var(--danger)] [&_select[aria-invalid=true]]:border-[var(--danger)] [&_textarea[aria-invalid=true]]:border-[var(--danger)]",
].join(" ");

export const settingsGroup = "grid min-w-0 gap-4 border-t border-[var(--border-subtle)] pt-[22px] first:border-t-0 first:pt-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

export const settingsHeading = "grid gap-1.5 [&_h2]:m-0 [&_h2]:text-[length:0.9375rem] [&_h2]:font-semibold [&_p]:m-0 [&_p]:text-[length:0.75rem] [&_p]:leading-[1.7] [&_p]:text-[var(--muted)]";

export const settingsNote = "m-0 text-[length:0.75rem] leading-[1.7] text-[var(--muted)]";

export const settingsFields = "grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 @row/dashboard:grid-cols-2";

export const settingsFieldWide = "col-span-full";

export const settingsField = "grid min-w-0 content-start gap-1.5 [&>label]:text-[length:0.75rem] [&>label]:font-medium [&_small]:text-[length:0.75rem] [&_small]:leading-[1.6] [&_small]:text-[var(--muted)]";

export const settingsFieldError = "m-0 text-[length:0.75rem] text-[var(--danger)]";

export const settingsWarning = "m-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2.5 text-[length:0.75rem] text-[var(--warning)]";

export const settingsEmptyNote = "m-0 rounded-[10px] border border-dashed border-[var(--border)] p-[18px] text-center text-[length:0.75rem] text-[var(--muted)]";

export const settingsActions = "flex flex-wrap items-center gap-3.5 border-t border-[var(--border-subtle)] pt-[22px]";

export const settingsSaveStatus = "m-0 flex items-center gap-1.5 text-[length:0.75rem] text-[var(--success)]";

export const teamList = "grid grid-cols-1 gap-2 @row/dashboard:grid-cols-2";

export const teamOption = [
  "m-0 flex cursor-pointer flex-row items-center gap-2.5 rounded-lg border border-[var(--border)] px-3 py-2.5 text-[length:0.8125rem] [overflow-wrap:anywhere]",
  "hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] has-[:checked]:border-[var(--accent-border)] has-[:checked]:bg-[var(--accent-soft)]",
  "[&_input]:shrink-0 [&_input]:[accent-color:var(--accent)] [&_span]:min-w-0 [&_small]:block [&_small]:text-[length:0.6875rem] [&_small]:text-[var(--muted)]",
].join(" ");

// Destinations and issued tokens are the same row with different contents.
export const rowList = "m-0 grid list-none gap-2 p-0";

// Once the row is narrow enough to wrap, a destructive Remove/Revoke and its Cancel end up side by side on a wrapped line, so the separation grows there rather than staying at the 10px an unwrapped row can afford. The wide value is today's, which is why it is the base one and the narrow state is spelled as an upper bound.
export const row = "flex flex-wrap items-center gap-2.5 rounded-[10px] border border-[var(--border)] px-3 py-2.5 @max-row/dashboard:gap-3 [&>strong]:min-w-0 [&>strong]:text-[length:0.8125rem] [&>strong]:[overflow-wrap:anywhere]";

// Composed on top of `row`, whose items-center it has to undo, so the narrow state cannot be the base one here.
export const rowNarrow = `${row} @max-row/dashboard:items-start @max-row/dashboard:[&>strong]:basis-full`;

export const rowTag = "mr-auto rounded-[5px] bg-[var(--accent-soft)] px-2 py-[3px] text-[length:0.75rem] whitespace-nowrap text-[var(--accent-text)]";

export const rowState = "rounded-[5px] bg-[var(--success-soft)] px-2 py-[3px] text-[length:0.75rem] text-[var(--success)] data-[state=disabled]:bg-[var(--surface-muted)] data-[state=disabled]:text-[var(--muted)]";

export const rowFailing = "rounded-[5px] bg-[var(--danger-soft)] px-2 py-[3px] text-[length:0.75rem] whitespace-nowrap text-[var(--danger)]";

// flex-1 is flex: 1 1 0%, so the prompt's hypothetical size is zero and it never claims a line of its own: in a wrapped row it takes whatever the two buttons leave, which is enough for four ragged words. The sentence that says what is about to be destroyed gets its own line instead.
export const rowConfirm = "min-w-0 flex-1 text-[length:0.75rem] text-[var(--muted)] @max-row/dashboard:basis-full @max-row/dashboard:flex-none";

export const destinationForm = "grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 @row/dashboard:grid-cols-2";

export const destinationActions = "col-span-full flex flex-wrap items-center gap-3.5";
