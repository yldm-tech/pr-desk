import { useEffect, useState } from "react";
import { useIsFetching, useMutation, useQueryClient } from "@tanstack/react-query";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import type { TFunction } from "i18next";
import { apiURL } from "./api-url";
import type { FollowUp, FollowUpResponse } from "./followup-view";

// The one mutation both surfaces post through. The workspace and the PR table now offer the same verbs on the same rows, and two copies of this would drift on the first change to either — the optimistic prediction in particular has to be identical or the two screens disagree about work the user has already done.
export type FollowUpActionInput = { action: "read" | "handled" | "followed_up" | "snooze" | "unsnooze"; until?: string };

const queryKey = ["follow-ups"] as const;

// The server answers a rejected snooze with the sentence the reader needs — "Choose a future reminder within one year" — and only on 400. Every other failure (404, the 409 optimistic-concurrency refusal, a 500, offline) comes back with generic prose or nothing at all, so it keeps the generic copy. Reading the body off ky's HTTPError is the same shape addErrorMessage already uses for destinations.
export function followUpErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof HTTPError && error.response.status === 400) {
    const body = z.object({ error: z.string().optional() }).safeParse(error.data);
    if (body.success && body.data.error) return body.data.error;
  }
  return t("followup.saveError");
}

export type FollowUpActionHandle = {
  mutate: (action: FollowUpActionInput) => void;
  // True from the click until the list has actually been refetched, not until the POST resolves. The two are a whole round trip apart, and in that gap the old card showed stale data behind fully live controls.
  isBusy: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  variables: FollowUpActionInput | undefined;
  reset: () => void;
};

export function useFollowUpAction({ item, onDone, onFailed }: { item: FollowUp; onDone?: (action: FollowUpActionInput) => void; onFailed?: (error: unknown, action: FollowUpActionInput) => void }): FollowUpActionHandle {
  const client = useQueryClient();
  const [settling, setSettling] = useState(false);
  const fetching = useIsFetching({ queryKey }) > 0;
  useEffect(() => {
    if (settling && !fetching) setSettling(false);
  }, [settling, fetching]);
  const mutation = useMutation({
    mutationFn: (action: FollowUpActionInput) => ky.post(apiURL + `/api/v1/follow-ups/${item.id}`, { credentials: "include", retry: 0, json: { ...action, version: item.version } }),
    // Only read and snooze are predicted, because for those two the prediction is exactly the column the server writes. The state that results from `handled` is derived from GitHub facts the browser cannot evaluate, so guessing it would mean showing a card in a state the next refetch contradicts.
    onMutate: async (action) => {
      if (action.action !== "read" && action.action !== "snooze") return undefined;
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<FollowUpResponse>(queryKey);
      if (!previous) return undefined;
      client.setQueryData<FollowUpResponse>(queryKey, { ...previous, data: previous.data.map((row) => (row.id !== item.id ? row : action.action === "read" ? { ...row, unread: false } : { ...row, snoozed_until: action.until ?? null })) });
      return { previous };
    },
    onSuccess: (_result, action) => onDone?.(action),
    onError: (error, action, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
      onFailed?.(error, action);
    },
    // The refetch is the reconciliation for the prediction above and the only feedback for the actions that have none, so the promise is returned: the mutation stays pending until the list it invalidated has settled.
    onSettled: () => {
      setSettling(true);
      return client.invalidateQueries({ queryKey });
    },
  });
  return { mutate: mutation.mutate, isBusy: mutation.isPending || settling, isPending: mutation.isPending, isError: mutation.isError, error: mutation.error, variables: mutation.variables, reset: mutation.reset };
}
