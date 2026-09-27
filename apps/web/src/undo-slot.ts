import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useBulkFollowUpAction } from "./followup-actions";
import { retireUndoToast, showToast } from "./toast";

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
  retireUndoToast(target);
  for (const listener of listeners) listener();
};

// The undo in flight, kept beside the slot rather than in the caller: TanStack drops `mutate`'s per-call callbacks once the component that called it unmounts, so a toast's Undo pressed on the Inbox and answered after the reader moved to another page would never hand a failed step back. The mutation's own onDone still runs, and it reads this.
let inFlight: { slot: UndoTarget; resolve(done: boolean): void } | null = null;

// `run(expected)` undoes only while the slot still holds `expected`: a control that names one row (the toast's Undo) must never restore a different one that took the slot after it was drawn.
export function useUndoSlot(): { target: UndoTarget | null; set(t: UndoTarget | null): void; run(expected?: UndoTarget): Promise<boolean>; busy: boolean } {
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
      const pending = inFlight;
      inFlight = null;
      // A failed undo leaves the step on the server, so the slot is handed back and the reader can try again, unless a newer action has taken it meanwhile.
      if (failed && pending) setTarget(current ?? pending.slot);
      pending?.resolve(!failed);
    },
  });
  const run = (expected?: UndoTarget) =>
    // Resolves true only when the undo reached the server and was accepted, so a caller that confirms it ("Undone") never says so over a refusal or a no-op.
    new Promise<boolean>((resolve) => {
      const slot = current;
      if (!slot || (expected && slot !== expected)) return resolve(false);
      // Emptied before the request, not after: the step is spent the moment it is asked for, and a second press while it is in flight must not post a second undo that the server would answer by restoring nothing.
      setTarget(null);
      inFlight = { slot, resolve };
      // The per-call onSettled only covers a mutation that ends without onDone while its caller is still mounted; by then onDone has already resolved any answer that arrived.
      bulk.run({ items: [{ id: slot.id, version: slot.version }], action: { action: "undo" } }, { onSettled: () => resolve(false) });
    });
  return { target, set: setTarget, run, busy: bulk.isBusy };
}
