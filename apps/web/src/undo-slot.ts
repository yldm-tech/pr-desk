import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useBulkFollowUpAction } from "./followup-actions";
import { showToast } from "./toast";

// What Undo would put back: the row, the version its snapshot was taken at, and enough to name it ("Undo Handled · wait for others — fixture/calendar #17").
export type UndoTarget = { id: number; version: number; repo: string; number: number; action: string };

// One slot for the whole application. The server keeps one step of history per row and every action a reader takes replaces the last one, so the toast, the sheet footer and the `z` key all point at the same place and can never disagree about what Undo would restore. `read` and `undo` never fill it: neither leaves a step behind on the server.
let current: UndoTarget | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const setTarget = (target: UndoTarget | null) => {
  if (current === target) return;
  current = target;
  for (const listener of listeners) listener();
};

export function useUndoSlot(): { target: UndoTarget | null; set(t: UndoTarget | null): void; run(): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const target = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  // A batch of one through the fan-out runner: it only needs id and version, and it brings the single invalidation and the settling state with it.
  const bulk = useBulkFollowUpAction({
    onDone: (outcome) => {
      const failed = outcome.failed.length > 0;
      showToast({ text: t(failed ? "followup.saveError" : "followup.undone"), tone: failed ? "error" : "success" });
    },
  });
  const run = () =>
    new Promise<void>((resolve) => {
      const slot = current;
      if (!slot) return resolve();
      // Emptied before the request, not after: the step is spent the moment it is asked for, and a second press while it is in flight must not post a second undo that the server would answer by restoring nothing.
      setTarget(null);
      // A failed undo leaves the step on the server, so the slot is handed back and the reader can try again.
      bulk.run({ items: [{ id: slot.id, version: slot.version }], action: { action: "undo" } }, { onSuccess: (outcome) => outcome.failed.length > 0 && setTarget(current ?? slot), onSettled: () => resolve() });
    });
  return { target, set: setTarget, run, busy: bulk.isBusy };
}
