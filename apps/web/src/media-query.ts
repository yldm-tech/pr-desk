import { useSyncExternalStore } from "react";

// One subscribe function per query string, made once and kept, so a component that asks the same question on every render subscribes once rather than tearing its listener down and adding it back each time.
const subscribers = new Map<string, (listener: () => void) => () => void>();
function subscribeTo(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}

// Whether a media query matches, kept current. Layout never reads this (CSS answers the same questions from the same tokens); it is for behaviour that has to know, such as which DOM order a row's verbs take, which edge a popover opens from, or whether the window is installed.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
