import { apiURL } from "./api-url";
import { SyncStatusSkeleton } from "./LoadingSkeleton";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ky from "ky";
import { z } from "zod";
import { shouldRefreshAfterSync, type SyncSnapshot } from "./sync-model";

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
export function SyncProgress({ connected, pending, onRunningChange }: { connected: boolean; pending: boolean; onRunningChange: (value: boolean) => void }) {
  const { t } = useTranslation();
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
    refetchInterval: (q) => (pending || q.state.data?.status === "queued" || q.state.data?.status === "running" ? 1000 : 5000),
    refetchIntervalInBackground: true,
  });
  const running = connected && (query.data?.status === "queued" || query.data?.status === "running");
  useEffect(() => {
    onRunningChange(running);
    if (shouldRefreshAfterSync(previous.current, query.data)) {
      for (const key of ["overview", "stats", "repositories", "prs"]) void client.invalidateQueries({ queryKey: [key] });
    }
    previous.current = query.data;
  }, [running, query.data, onRunningChange, client]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      for (const key of ["overview", "stats", "repositories", "prs"]) void client.invalidateQueries({ queryKey: [key] });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [running, client]);
  const failed = query.data?.status === "failed" || query.data?.status === "interrupted";
  if (connected && query.isPending && !pending) return <SyncStatusSkeleton />;
  if (connected && query.isError && !pending && !running && !failed)
    return (
      <div className="sync-status-error" role="status">
        <span>{t("syncNetworkError")}</span>
        <button className="access-recheck" onClick={() => query.refetch()}>
          {t("retry")}
        </button>
      </div>
    );
  if (!pending && !running && !failed) {
    if (!connected) return null;
    const lastSynced = Date.parse(query.data?.last_synced_at ?? "");
    return (
      <div className="auto-sync-note" role="status">
        <p>{query.data?.status === "idle" && !Number.isFinite(lastSynced) ? t("firstSyncQueued") : t("autoSyncSchedule")}</p>
        {Number.isFinite(lastSynced) && <p>{t("lastSynced", { time: new Date(lastSynced).toLocaleString() })}</p>}
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
    <section className="sync-progress-panel" data-paused={failed || phase === "waiting" ? "true" : "false"} aria-label={t("syncProgress")}>
      {!failed && data?.mode !== "incremental" && <p>{t("firstSyncHelp")}</p>}
      <div className="sync-progress-heading">
        <strong>{t(data?.mode === "incremental" ? "incrementalSync" : "syncProgress")}</strong>
        <span>{phaseLabel}</span>
      </div>
      <ol className="sync-steps" aria-label={t("syncProgress")}>
        {steps.map((key, index) => (
          <li key={key} data-state={index < stage ? "complete" : index === stage ? "active" : "pending"} aria-current={index === stage ? "step" : undefined}>
            <span>
              {index < stage ? "✓" : index + 1} · {t(key)}
            </span>
            <motion.div className="sync-step-line" animate={{ opacity: index === stage && !failed && phase !== "waiting" && !reducedMotion ? [0.45, 1, 0.45] : 1 }} transition={{ duration: 1.5, repeat: Infinity }} />
          </li>
        ))}
      </ol>
      {data?.history_count !== undefined && (
        <p className="sync-collected">
          {t("syncCollected", { count: data.history_count })}
          {data.open_count !== undefined ? " · " + t("syncOpenSummary", { count: data.open_count }) : ""}
        </p>
      )}
      {failed && <p role="alert">{errorLabel}</p>}
      <div className="sync-progress-detail" role="status">
        <span>{total > 0 ? t(countKey, { completed: completed.toLocaleString(), total: total.toLocaleString() }) : t(failed ? "syncStoppedBeforeCount" : "syncDiscovering")}</span>
        {failed && Number.isFinite(retryTime) ? <span>{t("syncNextRetry", { time: new Date(retryTime).toLocaleTimeString() })}</span> : phase === "waiting" && data?.retry_at ? <span>{t("syncResumeAt", { time: new Date(data.retry_at * 1000).toLocaleTimeString() })}</span> : null}
      </div>
    </section>
  );
}
