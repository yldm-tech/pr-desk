// Status strips the application shows above a page: a warning when a refresh
// failed, and the quiet note about the next automatic sync. Both appear in more
// than one component, so they are named here rather than repeated.
export const syncStatusError = "m-0 mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2.5 text-[length:0.75rem] text-[var(--warning)]";

// The leading dot is a pseudo-element, and the skeleton that stands in for this
// note suppresses it rather than drawing a dot next to a grey bar.
//
// Both strips render inside <main>, so the narrow branch measures @container/dashboard rather than the window: the same 1024px window gives <main> either 765px or 647px of content depending on whether the sidebar is up, and only the container knows which.
export const autoSyncNote =
  "mx-0 mt-0 mb-5 flex items-center gap-[7px] text-[length:0.75rem] text-[var(--muted)] before:h-[5px] before:w-[5px] before:shrink-0 before:rounded-[50%] before:bg-[var(--success)] before:content-[''] has-[.skeleton-sync-note]:before:hidden @max-split/dashboard:text-[length:0.6875rem] @max-split/dashboard:leading-[1.6]";
