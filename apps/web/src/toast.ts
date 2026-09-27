import { useSyncExternalStore } from "react";

// The single toast slot. One slot, not a stack: every result the app reports replaces the previous one, which is also what makes one Undo button unambiguous about the action it would reverse.
// `undo.target` is the undo-slot entry the button was created for. The slot holds one step for the whole app, so when another surface takes it (the sheet footer, the `z` key) the toast that names the old row is withdrawn rather than left offering to undo a row it does not name.
export type ToastInput = { text: string; tone: "success" | "error"; undo?: { label: string; name: string; run(): void; target?: unknown }; sticky?: boolean };
// `seq` changes on every show, so the region can announce the same sentence twice in a row.
export type ToastState = ToastInput & { seq: number };

// A confirmation with nothing to take back floats for this long. One with an Undo, or an error, stays until it is dismissed or replaced: it is the only route back from the action, and a timer would take it away mid-reach.
export const TOAST_DISMISS_MS = 6000;

let current: ToastState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function showToast(input: ToastInput): void {
  clearTimeout(timer);
  seq += 1;
  current = { ...input, seq };
  if (input.tone === "success" && !input.undo && !input.sticky) timer = setTimeout(dismissToast, TOAST_DISMISS_MS);
  emit();
}

export function dismissToast(): void {
  clearTimeout(timer);
  if (!current) return;
  current = null;
  emit();
}

// Withdraws a toast whose Undo belongs to a step the slot no longer holds. Called by the undo slot on every change of target.
export function retireUndoToast(target: unknown): void {
  if (current?.undo?.target !== undefined && current.undo.target !== target) dismissToast();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToast(): ToastState | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
