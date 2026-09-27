import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

// The one guard every single-key shortcut goes through, moved unchanged from the "/" handler App.tsx used to carry. True means "leave this key alone": a held modifier belongs to the browser or the OS, a key typed into a field or a native picker is text, and while any dialog is open the keys belong to it.
export function isShortcutTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (target?.closest?.("input,textarea,select,[contenteditable=true],[role=dialog],dialog,[role=combobox]")) return true;
  return !!document.querySelector("dialog[open],[data-state=open][role=dialog]");
}

// Sent by the `/` key when the page's search field exists but is folded away (the Inbox below `pair`), so the page can open it before it is focused.
export const REVEAL_SEARCH_EVENT = "prdesk:reveal-search";

// Whether letter, digit and punctuation keys act as shortcuts (WCAG 2.1.4). On by default and switchable per device, from the shortcuts sheet and the palette, for a speech-input user or anyone who types into the page by accident. Modified keys (⌘K), Enter, Space and Escape are not character-key shortcuts and are never switched off. Kept in localStorage because it belongs to the device, like the theme; storage that throws simply leaves the default on.
const SINGLE_KEYS_STORAGE_KEY = "prdesk-single-key-shortcuts";
const readSingleKeys = () => {
  try {
    return window.localStorage.getItem(SINGLE_KEYS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};
let singleKeys = typeof window === "undefined" ? true : readSingleKeys();
const singleKeyListeners = new Set<() => void>();
const subscribeSingleKeys = (listener: () => void) => {
  singleKeyListeners.add(listener);
  return () => void singleKeyListeners.delete(listener);
};
export function setSingleKeyShortcuts(on: boolean) {
  singleKeys = on;
  try {
    if (on) window.localStorage.removeItem(SINGLE_KEYS_STORAGE_KEY);
    else window.localStorage.setItem(SINGLE_KEYS_STORAGE_KEY, "off");
  } catch {
    // The choice still holds for this page; it just will not survive a reload.
  }
  for (const listener of singleKeyListeners) listener();
}
export const useSingleKeyShortcuts = () => useSyncExternalStore(subscribeSingleKeys, () => singleKeys);
// A key the switch covers: one printable character (a letter, a digit, punctuation), which is what a stray keystroke or a speech command produces. Space is left out, as it is a control's own activation key.
const isCharacterKey = (key: string) => key.length === 1 && key !== " ";

type Stroke = { key: string; at: number };
// How long the second key of a `g` sequence may follow the first.
const SEQUENCE_WINDOW_MS = 1000;

// Pure half of a key sequence such as "g i". The buffer is the strokes still inside the window; a stroke that completes a binding returns it and empties the buffer, one that could still grow into a binding is kept, and anything else is dropped from the front until what is left is a prefix again, so "x g i" still matches "g i".
export function matchSequence(buffer: Stroke[], key: string, now: number, bindings: string[]): { match: string | null; buffer: Stroke[] } {
  let strokes = [...buffer.filter((stroke) => now - stroke.at <= SEQUENCE_WINDOW_MS), { key, at: now }];
  while (strokes.length) {
    const typed = strokes.map((stroke) => stroke.key).join(" ");
    if (bindings.includes(typed)) return { match: typed, buffer: [] };
    if (bindings.some((binding) => binding.startsWith(typed + " "))) return { match: null, buffer: strokes };
    strokes = strokes.slice(1);
  }
  return { match: null, buffer: [] };
}

// "mod+k" is Command on Apple platforms and Control elsewhere; both are accepted everywhere because a Mac user on a PC keyboard presses Control.
const isModBinding = (binding: string) => binding.startsWith("mod+");
const modMatches = (binding: string, e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === binding.slice(4).toLowerCase();

type ShortcutOptions = { enabled?: boolean; scope?: "global" | "sheet"; element?: RefObject<HTMLElement | null>; allowInInputs?: boolean };

// When the first key of a still-open global sequence was pressed. Every binding is its own window listener and they run in registration order, so without this the Inbox's `s` (snooze) or `r` (mark read) would also fire on the second key of `g s` or `g r` whenever the page registered before the palette did. A single-key global binding stands down while a sequence is open; the sequence listener closes it on a match, on a miss, or once the window has run out.
let sequenceOpenedAt = Number.NEGATIVE_INFINITY;

// Binds one or more keys: a single key ("j", "/", "?"), a sequence ("g i") or a modified key ("mod+k"). Global bindings listen on the window behind isShortcutTarget. Sheet bindings listen on the sheet element itself, which is the one place a single key is allowed while a dialog is open, and still ignore modifiers and typing in a field. The handler is read through a ref, so an inline arrow does not rebind the listener on every render; a handler that returns false declines the key, which is then left to the browser.
export function useShortcut(keys: string | string[], handler: (e: KeyboardEvent) => void | boolean, opts: ShortcutOptions = {}): void {
  const { enabled = true, scope = "global", element, allowInInputs = false } = opts;
  const latest = useRef(handler);
  latest.current = handler;
  const buffer = useRef<Stroke[]>([]);
  const bindings = Array.isArray(keys) ? keys : [keys];
  const signature = bindings.join("\u0000");
  useEffect(() => {
    if (!enabled) return;
    const list = signature.split("\u0000");
    const sequences = list.filter((binding) => binding.includes(" "));
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = list.find((binding) => isModBinding(binding) && modMatches(binding, e));
      if (mod) {
        const target = e.target as HTMLElement | null;
        if (!allowInInputs && target?.closest?.("input,textarea,select,[contenteditable=true]")) return;
        if (latest.current(e) !== false) e.preventDefault();
        return;
      }
      if (!singleKeys && isCharacterKey(e.key)) return;
      if (scope === "sheet") {
        const target = e.target as HTMLElement | null;
        if (e.metaKey || e.ctrlKey || e.altKey || target?.closest?.("input,textarea,select,[contenteditable=true],[role=combobox]")) return;
        // A popover open inside the sheet (the Remind me later menu) owns the keys while it is open, exactly as the global guard stands down for one on the page: `e` pressed in the reminder menu must not mark the row handled behind it.
        if (element?.current?.querySelector("[role=dialog][data-state=open]")) return;
      } else if (allowInInputs ? e.metaKey || e.ctrlKey || e.altKey : isShortcutTarget(e)) return;
      if (sequences.length) {
        const result = matchSequence(buffer.current, e.key, e.timeStamp, sequences);
        buffer.current = result.buffer;
        if (scope === "global") sequenceOpenedAt = result.buffer.length ? result.buffer[0].at : Number.NEGATIVE_INFINITY;
        if (result.match) {
          if (latest.current(e) !== false) e.preventDefault();
          return;
        }
        if (result.buffer.length) return;
      } else if (scope === "global" && e.timeStamp - sequenceOpenedAt <= SEQUENCE_WINDOW_MS) return;
      if (list.includes(e.key) && latest.current(e) !== false) e.preventDefault();
    };
    const target: HTMLElement | Window | null = scope === "sheet" ? (element?.current ?? null) : window;
    if (!target) return;
    target.addEventListener("keydown", onKey as EventListener);
    return () => target.removeEventListener("keydown", onKey as EventListener);
  }, [enabled, scope, element, allowInInputs, signature]);
}

// Open state of the two app-wide overlays, so the palette and the shortcuts sheet can be opened from a key, a button or each other without a provider threading them through the tree.
const overlayState = { palette: false, shortcuts: false };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const set = (key: keyof typeof overlayState, value: boolean) => {
  if (overlayState[key] === value) return;
  overlayState[key] = value;
  for (const listener of listeners) listener();
};

export const overlays = {
  openPalette: () => set("palette", true),
  closePalette: () => set("palette", false),
  openShortcuts: () => set("shortcuts", true),
  closeShortcuts: () => set("shortcuts", false),
  usePaletteOpen: () => useSyncExternalStore(subscribe, () => overlayState.palette),
  useShortcutsOpen: () => useSyncExternalStore(subscribe, () => overlayState.shortcuts),
};
