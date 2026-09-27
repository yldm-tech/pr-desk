export type SyncSnapshot = { status: string; updated_at?: string };

// Progress is worth a second-by-second poll only while a run is in flight; an idle tab is waiting for a scheduled run that starts at most once every five minutes.
export function syncRunInFlight(pending: boolean, status?: string): boolean {
  return pending || status === "queued" || status === "running";
}
export function syncPollInterval(pending: boolean, status?: string): number {
  return syncRunInFlight(pending, status) ? 1000 : 30000;
}

// A short sync can start and finish between polls. Refresh on a new completion timestamp as well as when an observed running task stops.
export function shouldRefreshAfterSync(previous: SyncSnapshot | undefined, current: SyncSnapshot | undefined): boolean {
  if (!current) return false;
  // The first poll has nothing to compare against. Treating it as a transition refetched every list on mount, for a sync that may have ended hours ago.
  if (!previous) return false;
  return (previous?.status === "running" && current.status !== "running") || (current.status === "complete" && (previous?.status !== "complete" || previous.updated_at !== current.updated_at));
}

// How old the last completed sync may be before the pill stops calling it fresh. The scheduler runs every five minutes, so an hour without a completion means several runs in a row did not finish, which is worth the reader's attention even when nothing reported an error.
export const SYNC_STALE_AFTER_MS = 60 * 60 * 1000;

// What the shell's sync pill says, in the order the checks run: the first match wins. `first` is the idle state before any sync has ever completed.
export type SyncHealth = "paused" | "failed" | "syncing" | "unknown" | "stale" | "fresh" | "first";

export type SyncHealthProgress = { status: string; last_synced_at?: string | null };

// One answer for the pill, the banner and the palette. `pending` is a manual sync request still in flight and `pollError` is a failed /sync/progress poll; the last completion time falls back to the one /auth/status reports, because the progress poll does not run until the session is known.
export function syncHealth(progress: SyncHealthProgress | undefined, auth: { sync_paused?: boolean; last_synced_at?: string | null } | undefined, now: number, options: { pending?: boolean; pollError?: boolean } = {}): SyncHealth {
  if (auth?.sync_paused) return "paused";
  const status = progress?.status;
  if (status === "failed" || status === "interrupted") return "failed";
  if (syncRunInFlight(options.pending ?? false, status)) return "syncing";
  if (options.pollError) return "unknown";
  const last = lastSyncedAt(progress, auth);
  if (last === null) return "first";
  return now - last > SYNC_STALE_AFTER_MS ? "stale" : "fresh";
}

// The last completed sync as epoch milliseconds, or null when there has never been one (or the server sent something unparseable).
export function lastSyncedAt(progress: SyncHealthProgress | undefined, auth: { last_synced_at?: string | null } | undefined): number | null {
  const value = Date.parse(progress?.last_synced_at ?? auth?.last_synced_at ?? "");
  return Number.isFinite(value) ? value : null;
}
