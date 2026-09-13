import { apiURL } from "./api-url";
import { linkAction } from "./action-styles";
import { autoSyncNote, syncStatusError } from "./status-styles";
import { SyncStatusSkeleton } from "./LoadingSkeleton";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ky from "ky";
import { z } from "zod";
import { shouldRefreshAfterSync, syncPollInterval, syncRunInFlight, type SyncSnapshot } from "./sync-model";

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
export function SyncProgress({ connected, pending, onRunningChange, hidden = false }: { connected: boolean; pending: boolean; onRunningChange: (value: boolean) => void; hidden?: boolean }) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const client = useQueryClient();
  const previous = useRef<SyncSnapshot | undefined>(undefined);
  const query = useQuery({
    queryKey: ["sync-progress"],
    enabled: connected,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/sync/progress", { credentials: "include", signal, retry: 0 })
        .json()
        .then((value) => progressSchema.parse(value)),
    refetchInterval: (q) => syncPollInterval(pending, q.state.data?.status),
    // A hidden tab still has to follow a run it is showing progress for, because the invalidation timer below keeps firing while it does. Idle polling stops instead.
    refetchIntervalInBackground: syncRunInFlight(pending, previous.current?.status),
  });
  const running = connected && (query.data?.status === "queued" || query.data?.status === "running");
  useEffect(() => {
    onRunningChange(running);
    if (shouldRefreshAfterSync(previous.current, query.data)) {
      for (const key of ["overview", "stats", "repositories", "prs", "follow-ups", "auth"]) void client.invalidateQueries({ queryKey: [key] });
    }
    previous.current = query.data;
  }, [running, query.data, onRunningChange, client]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      for (const key of ["overview", "stats", "repositories", "prs", "follow-ups"]) void client.invalidateQueries({ queryKey: [key] });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [running, client]);
  // Keep polling and cache updates active even when this page hides sync status.
  if (hidden) return null;
  const failed = query.data?.status === "failed" || query.data?.status === "interrupted";
  if (connected && query.isPending && !pending) return <SyncStatusSkeleton />;
  if (connected && query.isError && !pending && !running && !failed)
    return (
      <div className={syncStatusError} role="status">
        <span>{t("syncNetworkError")}</span>
        <button className={linkAction} onClick={() => query.refetch()}>
          {t("retry")}
        </button>
      </div>
    );
  if (!pending && !running && !failed) {
    if (!connected) return null;
    const lastSynced = Date.parse(query.data?.last_synced_at ?? "");
    return (
      <div className={autoSyncNote} role="status">
        <p>{query.data?.status === "idle" && !Number.isFinite(lastSynced) ? t("firstSyncQueued") : t("autoSyncSchedule")}</p>
        {Number.isFinite(lastSynced) && <p>{t("lastSynced", { time: new Date(lastSynced).toLocaleString(i18n.resolvedLanguage) })}</p>}
      </div>
    );
  }
  const data = running || failed ? query.data : undefined;
  const total = data?.total ?? 0;
  const completed = Math.min(data?.completed ?? 0, total || Infinity);
  const phase = data?.phase ?? "account";
  const phaseLabel = t(phase === "history" && data?.mode === "incremental" ? "syncPhase_incremental" : `syncPhase_${phase}`);
  const failureKeys: Record<string, string> = { reconnect: "syncReconnect", forbidden: "syncForbidden", rate_limited: "syncRateLimited", network: "syncNetworkError", timeout: "syncTimeout", interrupted: "syncInterrupted", incomplete_history: "syncHistoryChanged", storage: "syncStorageError" };
  const errorLabel = t(failureKeys[data?.error_code ?? ""] ?? (phase === "waiting" ? "syncRateLimited" : "syncUpstreamError"));
  const retryTime = Date.parse(data?.next_auto_sync_at ?? "");
  const activePhase = phase === "waiting" ? data?.resume_phase : phase;
  const stage = activePhase === "details" ? 2 : activePhase === "saving" ? 1 : 0;
  const steps = ["syncCollectStep", "syncSaveStep", "syncDetailsStep"];
  const countKey = activePhase === "details" ? "syncDetailCount" : activePhase === "saving" ? "syncSaveCount" : activePhase === "open" ? "syncOpenCount" : "syncFetchCount";
  return (
    <section
      className="mx-0 mt-0 mb-5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[length:0.8125rem] data-[paused=true]:border-[var(--warning-border)] [&>p[role=alert]]:rounded-md [&>p[role=alert]]:bg-[var(--warning-soft)] [&>p[role=alert]]:px-3 [&>p[role=alert]]:py-2.5 [&>p[role=alert]]:leading-[1.7] [&>p[role=alert]]:text-[var(--warning)]"
      data-paused={failed || phase === "waiting" ? "true" : "false"}
      aria-label={t("syncProgress")}
    >
      {!failed && data?.mode !== "incremental" && <p>{t("firstSyncHelp")}</p>}
      <div className="flex flex-wrap justify-between gap-3 [&>span]:text-[var(--muted)]">
        <strong>{t(data?.mode === "incremental" ? "incrementalSync" : "syncProgress")}</strong>
        <span>{phaseLabel}</span>
      </div>
      {/* Three columns need about 96px each before a step label fits on one line, and this section gets 256px of content on a 320px phone, so the steps stack until <main> is wide enough. The bands measure @container/dashboard because the section renders inside <main>, not against the window. */}
      <ol className="mx-0 my-3 grid list-none grid-cols-1 gap-3 p-0 text-[length:0.75rem] text-[var(--muted)] @split/dashboard:grid-cols-3 @max-split/dashboard:gap-2 [&>li[data-state=active]]:text-[var(--accent-text)] [&>li[data-state=complete]]:text-[var(--accent-text)]" aria-label={t("syncProgress")}>
        {steps.map((key, index) => (
          <li className="group/step" key={key} data-state={index < stage ? "complete" : index === stage ? "active" : "pending"} aria-current={index === stage ? "step" : undefined}>
            <span>
              {index < stage ? "✓" : index + 1} · {t(key)}
            </span>
            <motion.div
              className="mt-2 h-[5px] rounded-[5px] bg-[var(--border)] group-data-[state=active]/step:bg-[var(--accent)] group-data-[state=complete]/step:bg-[var(--accent)]"
              animate={{ opacity: index === stage && !failed && phase !== "waiting" && !reducedMotion ? [0.45, 1, 0.45] : 1 }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </li>
        ))}
      </ol>
      {data?.history_count !== undefined && (
        <p className="mx-0 my-2 text-[length:0.75rem] text-[var(--muted)]">
          {t("syncCollected", { count: data.history_count })}
          {data.open_count !== undefined ? " · " + t("syncOpenSummary", { count: data.open_count }) : ""}
        </p>
      )}
      {failed && <p role="alert">{errorLabel}</p>}
      <div className="flex flex-wrap justify-between gap-3 text-[var(--muted)]" role="status">
        <span>{total > 0 ? t(countKey, { completed: completed.toLocaleString(i18n.resolvedLanguage), total: total.toLocaleString(i18n.resolvedLanguage) }) : t(failed ? "syncStoppedBeforeCount" : "syncDiscovering")}</span>
        {failed && Number.isFinite(retryTime) ? (
          <span>{t("syncNextRetry", { time: new Date(retryTime).toLocaleTimeString(i18n.resolvedLanguage) })}</span>
        ) : phase === "waiting" && data?.retry_at ? (
          <span>{t("syncResumeAt", { time: new Date(data.retry_at * 1000).toLocaleTimeString(i18n.resolvedLanguage) })}</span>
        ) : null}
      </div>
    </section>
  );
}
