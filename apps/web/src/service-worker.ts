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
