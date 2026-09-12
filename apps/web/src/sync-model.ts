export type SyncSnapshot = { status: string; updated_at?: string };

// A short sync can start and finish between polls. Refresh on a new completion
// timestamp as well as when an observed running task stops.
export function shouldRefreshAfterSync(previous: SyncSnapshot | undefined, current: SyncSnapshot | undefined): boolean {
  if (!current) return false;
  // The first poll has nothing to compare against. Treating it as a transition
  // refetched every list on mount, for a sync that may have ended hours ago.
  if (!previous) return false;
  return (previous?.status === "running" && current.status !== "running") || (current.status === "complete" && (previous?.status !== "complete" || previous.updated_at !== current.updated_at));
}
