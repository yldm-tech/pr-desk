// Registers public/sw.js, which is what turns the built application into an installable PWA and lets a previously visited instance open offline. The worker itself is not bundled -- see the comment at the top of public/sw.js for the caching contract it implements.
//
// Development is excluded on purpose. The dev server hands out unhashed module URLs and rewrites them on every edit, so a worker that caches by URL would serve yesterday's module to a hot reload; and a worker registered at localhost outlives the session that installed it, which is a debugging trap nobody asked for.
//
// After `load` rather than during it, because installing fetches the document again to seed the offline copy, and a cold first visit should not spend its bandwidth on that while the page it is about to show is still arriving.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  addEventListener("load", () => {
    // Registration rejects for reasons that are entirely about the browser and never about this app: an insecure origin, storage disabled, a private window that refuses workers. Every one of them means "no offline support", which the application is already built to run without, so the failure is swallowed rather than surfaced.
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// The prefix public/sw.js names its caches with. Deleting by prefix rather than by the two current names on purpose: a worker from an older deploy may have left a `prdesk-` cache this build has no name for, and the point of the button below is to leave nothing of the old build behind.
const CACHE_PREFIX = "prdesk-";

// The reload an installed application does not otherwise have. There is no browser chrome around a standalone window, so there is no address bar, no reload button and no Shift-click on one; the platform's own menu is several steps deep and on some of them absent entirely.
//
// It is a *hard* reload because it sweeps the worker's caches on the way out. In the ordinary case that is belt and braces — the document is served `no-cache` and every asset name is content-hashed, so a plain reload already lands on the current build — but it is the one action that answers "the app is showing me something stale" without asking the reader to reason about which of the three caches is responsible.
//
// Offline, the sweep is skipped rather than the reload refused. The shell cache is the only copy of the application on the device at that moment, and there is no network to refill it from: deleting it would turn "reload" into "close the app until the connection is back". A soft reload is what the reader gets, and it is what they would have got from a reload button anyway.
export async function hardReload(): Promise<void> {
  // `navigator.onLine` is only trustworthy when it is false — true says the interface is up, not that anything answers — which is exactly the direction that matters here: false is the case where the cache must survive.
  if (navigator.onLine && "caches" in self) {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
    } catch {
      // Storage can refuse for reasons that have nothing to do with the reader's request — a private window, a cleared origin, a quota error mid-sweep. Losing the sweep costs a soft reload; losing the reload would cost the click.
    }
  }
  if ("serviceWorker" in navigator) {
    try {
      // Fetches sw.js past the HTTP cache. The worker calls skipWaiting() in install and claims its clients in activate, so a newer one takes over this page rather than sitting in a waiting state with nothing to prompt about it.
      await navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
    } catch {
      // Offline, or no worker to update — neither is a reason to withhold the reload.
    }
  }
  location.reload();
}
