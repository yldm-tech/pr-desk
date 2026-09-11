// Status strips the application shows above a page: a warning when a refresh
// failed, and the quiet note about the next automatic sync. Both appear in more
// than one component, so they are named here rather than repeated.
export const syncStatusError = "m-0 mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] text-[var(--warning)]";

// The leading dot is a pseudo-element, and the skeleton that stands in for this
// note suppresses it rather than drawing a dot next to a grey bar.
export const autoSyncNote =
  "mx-0 mt-0 mb-5 flex items-center gap-[7px] text-[12px] text-[var(--muted)] before:h-[5px] before:w-[5px] before:shrink-0 before:rounded-[50%] before:bg-[var(--success)] before:content-[''] has-[.skeleton-sync-note]:before:hidden [@media(max-width:480px)]:text-[11px] [@media(max-width:480px)]:leading-[1.6]";
