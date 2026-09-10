export type SyncSnapshot = { status: string; updated_at?: string };

// A short sync can start and finish between polls. Refresh on a new completion
// timestamp as well as when an observed running task stops.
export function shouldRefreshAfterSync(previous: SyncSnapshot | undefined, current: SyncSnapshot | undefined): boolean {
  if (!current) return false;
  return (previous?.status === "running" && current.status !== "running") || (current.status === "complete" && (previous?.status !== "complete" || previous.updated_at !== current.updated_at));
}
