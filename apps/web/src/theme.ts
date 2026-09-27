import { useCallback, useSyncExternalStore } from "react";

// The reader's theme choice. public/theme-init.js reads the same key before the first paint, so the two must agree on the name and on the values it may hold.
export const THEME_STORAGE_KEY = "prdesk-theme";
export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

// The browser chrome colour for each theme: the --bg of style.css, which is what the sticky top bar paints directly under the status bar. index.html ships the same pair as two media-scoped metas.
export const themeColors: Record<ResolvedTheme, string> = { light: "#FFFFFF", dark: "#0F0F12" };

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

export function parseThemePref(value: unknown): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

// The last choice made on this page, which is the answer when storage cannot give one: without it a choice made under blocked storage was applied to the page while the switch snapped back to "system".
let memoryPref: ThemePref | null = null;

// Storage can throw outright (Safari private windows, blocked site data), and a theme is never worth an error screen.
function readPref(): ThemePref {
  try {
    return parseThemePref(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return memoryPref ?? "system";
  }
}

function writePref(pref: ThemePref) {
  memoryPref = pref;
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // The choice still applies to this page; it just will not survive a reload.
  }
}

// Mirrors theme-init.js: an explicit choice pins data-theme and both metas to one colour, "system" hands both back to their media queries.
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement) {
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = themeColors[pref === "system" ? scheme : pref];
  }
}

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  // Another tab changed the choice: follow it here too, so two windows of the app never disagree.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPref());
    listener();
  };
  media.addEventListener("change", listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", onStorage);
  };
}

const systemDark = () => window.matchMedia(DARK_QUERY).matches;

export function useTheme(): { pref: ThemePref; resolved: ResolvedTheme; setPref: (pref: ThemePref) => void } {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePref);
  const dark = useSyncExternalStore(subscribe, systemDark, () => false);
  const setPref = useCallback((next: ThemePref) => {
    writePref(next);
    applyTheme(next);
    notify();
  }, []);
  return { pref, resolved: resolveTheme(pref, dark), setPref };
}
