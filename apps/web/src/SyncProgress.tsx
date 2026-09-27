import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, Clock, LoaderCircle, RefreshCw, type LucideIcon } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { SyncStatusSkeleton } from "./LoadingSkeleton";
import { lastSyncedAt, shouldRefreshAfterSync, syncHealth, syncPollInterval, syncRunInFlight, type SyncHealth, type SyncSnapshot } from "./sync-model";
import { Button, cx, TextLink } from "./ui-controls";
import { formatDateTime } from "./ui-display";
import { Popover } from "./ui-overlay";
import type { Auth } from "./queries";

const progressSchema = z.object({
  last_synced_at: z.string().nullable().optional(),
  mode: z.string().optional(),
  history_count: z.number().optional(),
  open_count: z.number().optional(),
  resume_phase: z.string().optional(),
  error_code: z.string().optional(),
  next_auto_sync_at: z.string().optional(),
  updated_at: z.string().optional(),
  status: z.enum(["idle", "queued", "running", "complete", "failed", "interrupted"]),
  phase: z.enum(["account", "history", "open", "saving", "details", "waiting"]),
  completed: z.number(),
  total: z.number(),
  retry_at: z.number(),
});
export type SyncProgressData = z.infer<typeof progressSchema>;
export type SyncProgressQuery = UseQueryResult<SyncProgressData>;

const syncProgressKey = ["sync-progress"];
const fetchSyncProgress = ({ signal }: { signal: AbortSignal }) =>
  ky
    .get(apiURL + "/api/v1/sync/progress", { credentials: "include", signal, retry: 0 })
    .json()
    .then((value) => progressSchema.parse(value));

// Whether a sync is in flight from anywhere: a request this tab sent, or a run the server reports as queued or running, whoever started it. It is the one condition every "Sync now" is disabled on, so no surface can post a second run the server would refuse with a 409. It reads the shell's poll from the cache and never fetches on its own.
export function useSyncInFlight(pending: boolean): boolean {
  const { data } = useQuery({ queryKey: syncProgressKey, queryFn: fetchSyncProgress, enabled: false });
  return syncRunInFlight(pending, data?.status);
}

// The poll behind every sync surface, mounted once by the shell on every route so the invalidation below keeps running whichever page is open. The query options, the poll interval and the invalidation rules are the ones the old inline progress line had, unchanged; it stays idle while signed out, as before. `running` is a run the server reports as queued or running, whoever started it.
export function useSyncProgress({ connected, pending }: { connected: boolean; pending: boolean }): { query: SyncProgressQuery; running: boolean } {
  const client = useQueryClient();
  const previous = useRef<SyncSnapshot | undefined>(undefined);
  const query = useQuery({
    queryKey: syncProgressKey,
    enabled: connected,
    queryFn: fetchSyncProgress,
    refetchInterval: (q) => syncPollInterval(pending, q.state.data?.status),
    // A hidden tab still has to follow a run it is showing progress for, because the invalidation timer below keeps firing while it does. Idle polling stops instead.
    refetchIntervalInBackground: syncRunInFlight(pending, previous.current?.status),
  });
  const running = connected && (query.data?.status === "queued" || query.data?.status === "running");
  useEffect(() => {
    if (shouldRefreshAfterSync(previous.current, query.data)) {
      for (const key of ["overview", "stats", "repositories", "prs", "follow-ups", "auth"]) void client.invalidateQueries({ queryKey: [key] });
    }
    previous.current = query.data;
  }, [query.data, client]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      for (const key of ["overview", "stats", "repositories", "prs", "follow-ups"]) void client.invalidateQueries({ queryKey: [key] });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [running, client]);
  return { query, running };
}

// A clock that ticks once a minute, so "Synced 4 min ago" keeps counting while the page sits open.
function useNow(interval = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

// "4 min ago", "2 hr ago", "yesterday" in the active language, or null under a minute: that case has its own sentence, because Intl's "this minute" reads as a schedule rather than as a time.
export function relativeSince(at: number, now: number, language: string | undefined): string | null {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return null;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

const failureKeys: Record<string, string> = { reconnect: "syncReconnect", forbidden: "syncForbidden", rate_limited: "syncRateLimited", network: "syncNetworkError", timeout: "syncTimeout", interrupted: "syncInterrupted", incomplete_history: "syncHistoryChanged", storage: "syncStorageError" };

// The sentence a failed run is explained with. Shared by the popover and by the reconnect banner, so the two can never word the same failure differently.
export function syncFailureKey(data: SyncProgressData | undefined): string {
  return failureKeys[data?.error_code ?? ""] ?? (data?.phase === "waiting" ? "syncRateLimited" : "syncUpstreamError");
}

// The first sync imports the whole history and is the one run a reader waits on, so it earns a banner; an incremental run only earns the pill.
export function isFirstSyncRunning(data: SyncProgressData | undefined): boolean {
  return (data?.status === "queued" || data?.status === "running") && data.mode !== "incremental";
}

const healthIcon: Record<SyncHealth, LucideIcon> = { paused: CircleAlert, failed: CircleAlert, syncing: LoaderCircle, unknown: CircleHelp, stale: Clock, fresh: CircleCheck, first: CircleDashed };
// Each state has its own glyph as well as its own colour, so the pill still says which one it is to a reader who cannot tell the hues apart, and below `roomy`, where the words are visually hidden.
const healthTone: Record<SyncHealth, string> = { paused: "text-tone-blocked", failed: "text-tone-blocked", syncing: "text-accent-text", unknown: "text-tone-neutral", stale: "text-tone-action", fresh: "text-tone-ready", first: "text-tone-neutral" };

function useHealthLabel(health: SyncHealth, data: SyncProgressData | undefined, auth: Auth | undefined, now: number) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const last = lastSyncedAt(data, auth);
  const since = last === null ? null : relativeSince(last, now, i18n.resolvedLanguage);
  switch (health) {
    case "paused":
      return t("shell.syncPausedShort");
    case "failed":
      return t("shell.syncFailed");
    case "syncing":
      return data && data.total > 0 ? t("shell.syncingCount", { completed: number.format(Math.min(data.completed, data.total)), total: number.format(data.total) }) : t("syncing");
    case "unknown":
      return t("shell.syncUnknown");
    case "stale":
      return t("shell.syncStale", { time: since ?? "" });
    case "fresh":
      return since === null ? t("shell.syncFreshNow") : t("shell.syncFresh", { time: since });
    case "first":
      return t("shell.syncFirst");
  }
}

// The run itself: which of the three steps it is on, how far through it is, what it has collected, and why it stopped when it did. `compact` is the banner's version, which has the width of the page to lay the steps out in and leaves the retry time to the popover.
export function SyncDetail({ data, compact = false }: { data: SyncProgressData; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const language = i18n.resolvedLanguage;
  const number = new Intl.NumberFormat(language);
  const time = new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" });
  const failed = data.status === "failed" || data.status === "interrupted";
  const total = data.total ?? 0;
  const completed = Math.min(data.completed ?? 0, total || Infinity);
  const phase = data.phase ?? "account";
  const phaseLabel = t(phase === "history" && data.mode === "incremental" ? "syncPhase_incremental" : `syncPhase_${phase}`);
  const retryTime = Date.parse(data.next_auto_sync_at ?? "");
  const activePhase = phase === "waiting" ? data.resume_phase : phase;
  const stage = activePhase === "details" ? 2 : activePhase === "saving" ? 1 : 0;
  const steps = ["syncCollectStep", "syncSaveStep", "syncDetailsStep"];
  const countKey = activePhase === "details" ? "syncDetailCount" : activePhase === "saving" ? "syncSaveCount" : activePhase === "open" ? "syncOpenCount" : "syncFetchCount";
  return (
    <div className="grid min-w-0 gap-2.5 text-small">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <strong className="font-semibold text-fg">{t(data.mode === "incremental" ? "incrementalSync" : "syncProgress")}</strong>
        <span className="text-fg-muted">{phaseLabel}</span>
      </div>
      {/* Three columns need about 96px each before a step label fits on one line. The banner measures <main>'s content box; the popover is portalled and always about 300px wide, so it simply keeps three narrow columns. */}
      <ol className={cx("m-0 grid list-none gap-2 p-0 text-caption text-fg-muted", compact ? "grid-cols-1 @split/dashboard:grid-cols-3 @split/dashboard:gap-3" : "grid-cols-3")} aria-label={t("syncProgress")}>
        {steps.map((key, index) => {
          const state = index < stage ? "complete" : index === stage ? "active" : "pending";
          return (
            <li key={key} data-state={state} aria-current={index === stage ? "step" : undefined} className={cx("min-w-0", state !== "pending" && "text-accent-text")}>
              <span>
                {index < stage ? "✓" : number.format(index + 1)} · {t(key)}
              </span>
              <motion.div className={cx("mt-1.5 h-1 rounded-full", state === "pending" ? "bg-line" : "bg-accent")} animate={{ opacity: index === stage && !failed && phase !== "waiting" && !reducedMotion ? [0.45, 1, 0.45] : 1 }} transition={{ duration: 1.5, repeat: Infinity }} />
            </li>
          );
        })}
      </ol>
      {data.history_count !== undefined && (
        <p className="text-caption text-fg-muted">
          {t("syncCollected", { count: data.history_count })}
          {data.open_count !== undefined ? " · " + t("syncOpenSummary", { count: data.open_count }) : ""}
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md bg-tone-blocked-soft px-2.5 py-2 text-tone-blocked">
          {t(syncFailureKey(data))}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-caption text-fg-muted">
        <span className="tabular-nums">{total > 0 ? t(countKey, { completed: number.format(completed), total: number.format(total) }) : t(failed ? "syncStoppedBeforeCount" : "syncDiscovering")}</span>
        {!compact && failed && Number.isFinite(retryTime) ? <span>{t("syncNextRetry", { time: time.format(new Date(retryTime)) })}</span> : !compact && phase === "waiting" && data.retry_at ? <span>{t("syncResumeAt", { time: time.format(new Date(data.retry_at * 1000)) })}</span> : null}
      </div>
    </div>
  );
}

// The sync pill and its popover. The pill says in a few words whether the data on screen can be trusted; the popover holds the whole story and the one control that starts a run by hand. Below `roomy` the words are visually hidden and the glyph carries the state, but they stay the button's accessible name.
export function SyncStatus({ progress, auth, pending, onSync, align }: { progress: SyncProgressQuery; auth: Auth | undefined; pending: boolean; onSync: () => void; align: "start" | "end" }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const data = progress.data;
  const health = syncHealth(data, auth, now, { pending, pollError: progress.isError });
  const label = useHealthLabel(health, data, auth, now);
  // Announced once per change of state, never on the minute tick: the relative time in the label moves every minute and a live region that repeated it would talk over everything else on the page.
  const sawRun = useRef(false);
  if (health === "syncing") sawRun.current = true;
  const phaseLabel = data ? t(data.phase === "history" && data.mode === "incremental" ? "syncPhase_incremental" : `syncPhase_${data.phase}`) : "";
  const announcement = health === "syncing" ? phaseLabel : health === "failed" || health === "paused" ? label : health === "fresh" && sawRun.current ? t("shell.syncCompleted") : "";
  if (progress.isPending && !pending) return <SyncStatusSkeleton />;
  const Icon = healthIcon[health];
  const syncing = health === "syncing";
  // Separate from the health glyph: a failed or paused state wins the pill, but a run still in flight (a retry this tab just sent, or one the server has queued) must keep the button disabled all the same.
  const inFlight = syncRunInFlight(pending, data?.status);
  const last = lastSyncedAt(data, auth);
  const failed = data?.status === "failed" || data?.status === "interrupted";
  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align={align}
        label={t("shell.syncStatus")}
        className="[&_p]:m-0"
        trigger={
          <button
            type="button"
            data-health={health}
            title={label}
            className={cx(
              "inline-flex min-h-8 min-w-8 shrink-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-small text-fg-muted transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              "min-w-0 justify-center max-roomy:px-0 shell:w-full shell:justify-start",
            )}
          >
            <Icon size={14} strokeWidth={2.25} aria-hidden="true" className={cx("shrink-0", healthTone[health], syncing && "animate-spin")} />
            <span className="min-w-0 truncate whitespace-nowrap max-roomy:sr-only">{label}</span>
          </button>
        }
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Icon size={16} strokeWidth={2.25} aria-hidden="true" className={cx("shrink-0", healthTone[health], syncing && "animate-spin")} />
            <strong className="min-w-0 font-semibold text-fg">{label}</strong>
          </div>
          {auth?.sync_paused && (
            <p className="text-small text-fg-muted">
              {t("followup.paused")}{" "}
              <TextLink inline href={apiURL + "/api/v1/auth/github"}>
                {t("followup.reconnect")}
              </TextLink>
            </p>
          )}
          {data && (syncing || failed) ? (
            <SyncDetail data={data} />
          ) : progress.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-small text-fg-muted">
              <span>{t("syncNetworkError")}</span>
              <Button size="sm" variant="ghost" onClick={() => void progress.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-1 text-small text-fg-muted">
              <p>{data?.status === "idle" && last === null ? t("firstSyncQueued") : t("autoSyncSchedule")}</p>
              {last !== null && <p>{t("lastSynced", { time: formatDateTime(new Date(last), i18n.resolvedLanguage) })}</p>}
            </div>
          )}
          <Button variant="secondary" icon={RefreshCw} busy={inFlight} onClick={onSync} className="w-full">
            {inFlight ? t("syncing") : t("sync")}
          </Button>
        </div>
      </Popover>
    </>
  );
}
