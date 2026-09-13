// The popup chrome three selects share: the language switch, the repository
// filter and the trend repository menu. It was one pair of CSS classes, so it
// stays one pair of exported strings rather than being pasted into each of
// them; a component adds its own utilities after these. The gap is deliberately
// absent: a second gap utility in the same attribute does not override the
// first — the generated stylesheet decides — so each menu states the one it
// wants. The same applies to the minimum width, which the trend menu ties to
// its trigger instead.
export const selectContent = "z-[100] max-h-[var(--radix-select-content-available-height)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 font-[family-name:var(--font-ui)] text-[length:var(--text-body)] text-[var(--foreground)] shadow-[0_12px_36px_var(--shadow)]";

// The rows are flush against each other and resolve to about 39.5px, so one touch floor here covers every Radix menu in the application. It is written against the pointer rather than the width because the popover portals to document.body and has no container to measure; `items-center` is already set, so a 44px floor costs a fine pointer nothing.
export const selectOption =
  "flex cursor-pointer items-center justify-between rounded-[7px] px-3 py-2.5 outline-none select-none pointer-coarse:min-h-11 data-[highlighted]:bg-[var(--surface-muted)] data-[state=checked]:bg-[var(--accent-soft)] data-[state=checked]:font-semibold data-[state=checked]:text-[var(--accent-text)]";
