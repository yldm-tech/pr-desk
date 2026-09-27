import { useSyncExternalStore } from "react";
import { keepPreviousData, useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { activitySchema } from "./activity-model";
import { responseSchema } from "./followup-view";
import { listParameters, parsePRPage, parseRepositoryList, type RepositorySummary } from "./pr-model";
import { prFilterOf, type PRView } from "./routes";

// Every query and mutation the shell and the pages share, moved here from App.tsx and FollowUps.tsx with their keys, request options and cache options unchanged. The retry and timeout on each one are part of how the product behaves offline and under a flaky network, so a new caller gets exactly what the old one had.
const api = ky.create({ credentials: "include", retry: 0, timeout: 30000 });

const authSchema = z.object({ connected: z.boolean(), username: z.string().optional(), sync_paused: z.boolean().optional(), last_synced_at: z.string().nullable().optional() });
export type Auth = z.infer<typeof authSchema>;

export function useAuth() {
  return useQuery({ queryKey: ["auth"], queryFn: async () => api(apiURL + "/api/v1/auth/status", { credentials: "include" }).then(async (r) => authSchema.parse(await r.json())), staleTime: 30000 });
}

const statsSchema = z.object({ open: z.number(), needs_review: z.number(), conflicts: z.number(), merged: z.number(), attention: z.number() });

export function useStats() {
  const auth = useAuth();
  return useQuery({
    queryKey: ["stats"],
    enabled: !!auth.data?.connected,
    queryFn: async () => {
      const r = await api(apiURL + "/api/v1/stats", { credentials: "include" });
      return statsSchema.parse(await r.json());
    },
    staleTime: 30000,
  });
}

// `page` is zero-based, as the offset the request carries is. The key keeps the filter name the list has always been cached under, so switching between /prs/:view addresses reuses the same cache entries the old routes filled.
export function usePRList({ view, page, q, repo }: { view: PRView; page: number; q: string; repo: string }) {
  const auth = useAuth();
  const filter = prFilterOf(view);
  return useQuery({
    queryKey: ["prs", filter, page, q, repo],
    retry: 1,
    enabled: !!auth.data?.connected,
    gcTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const r = await api(apiURL + "/api/v1/pull-requests?" + listParameters(filter, page, q, repo), { credentials: "include", signal });
      return parsePRPage(await r.json());
    },
    staleTime: 30000,
    refetchInterval: 60000,
    // Paging and filtering mint a new key: keep the rows and the pagination row on screen instead of replacing them with a skeleton under the cursor.
    placeholderData: keepPreviousData,
  });
}

// Enabled by the caller rather than by the route, because the one caller that renders the list is the only one that knows it is on screen.
export function useRepositories(enabled: boolean) {
  const auth = useAuth();
  return useQuery<RepositorySummary[]>({
    queryKey: ["repositories"],
    enabled: !!auth.data?.connected && enabled,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const r = await api(apiURL + "/api/v1/repositories", { credentials: "include" });
      return parseRepositoryList(await r.json());
    },
    staleTime: 30000,
  });
}

export function useFollowUps(enabled = true) {
  return useQuery({
    queryKey: ["follow-ups"],
    enabled,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/follow-ups", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => responseSchema.parse(data)),
    staleTime: 15000,
    // The refetch a returning reader gets is safe because `stableOrder` holds the list still: the flag that used to suppress it was written before the freeze existed and afterwards only cost freshness, on a page with no refresh control where the interval does not run while the tab is hidden. Coming back from the pull request you just fixed is the most common way anyone arrives here.
    refetchInterval: 60000,
  });
}

// One pull request's comments, threads and checks. `id` is the PullRequest primary key the list and the follow-up both carry (followup_store.go, activity.go), never the PR number.
export function useActivity(id: number | undefined) {
  return useQuery({
    queryKey: ["activity", id],
    staleTime: 60000,
    gcTime: 30 * 60 * 1000,
    enabled: id !== undefined,
    queryFn: async () => {
      const r = await api(apiURL + `/api/v1/pull-requests/${id}/activity`, { credentials: "include" });
      return activitySchema.parse(await r.json());
    },
  });
}

// The outcome of the last manual sync, shared by every surface that can start one. It used to be component state beside the one mutation App.tsx owned; the sync button and the private-access grant on Insights each call the hook now, and both results still have to land in the one strip the shell shows.
export type SyncFeedback = { message: string; error: boolean } | null;
let syncFeedback: SyncFeedback = null;
const feedbackListeners = new Set<() => void>();
const setSyncFeedback = (value: SyncFeedback) => {
  syncFeedback = value;
  for (const listener of feedbackListeners) listener();
};
const subscribeFeedback = (listener: () => void) => {
  feedbackListeners.add(listener);
  return () => void feedbackListeners.delete(listener);
};

export function useSyncFeedback(): [SyncFeedback, (value: SyncFeedback) => void] {
  return [useSyncExternalStore(subscribeFeedback, () => syncFeedback), setSyncFeedback];
}

const syncKey = ["sync"];

// True while any caller's sync request is in flight, which is what the shell's button and progress line used to read off the single mutation.
export function useSyncPending(): boolean {
  return useIsMutating({ mutationKey: syncKey }) > 0;
}

export function useSyncMutation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: syncKey,
    onMutate: () => setSyncFeedback(null),
    mutationFn: async (full: boolean | void = false) => {
      const r = await api(apiURL + "/api/v1/sync" + (full ? "?full=1" : ""), { method: "POST", credentials: "include", timeout: 30000 });
      return z.object({ status: z.literal("queued") }).parse(await r.json());
    },
    onSuccess: () => setSyncFeedback(null),
    onSettled: () => {
      // Read durable progress immediately after submission or a lost response.
      for (const key of ["prs", "sync-progress", "stats", "overview", "repositories", "repository-access"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: async (error) => {
      let key = "syncNetworkError";
      if (error instanceof HTTPError) {
        const status = error.response.status;
        const body = z.object({ error: z.string().optional() }).safeParse(error.data);
        const errorBody = body.success ? body.data : undefined;
        const message = errorBody?.error || "";
        key = status === 409 ? "syncAlreadyRunning" : status === 401 ? "syncReconnect" : status === 429 || (status === 403 && /rate/i.test(message)) ? "syncRateLimited" : status === 403 ? "syncForbidden" : message.includes("list data has been saved") ? "syncPartial" : "syncUpstreamError";
      }
      setSyncFeedback({ message: t(key), error: true });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(apiURL + "/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      location.reload();
    },
  });
}
