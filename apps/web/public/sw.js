// The service worker that makes PR Desk installable and lets an already-visited instance open offline. It lives in public/ rather than src/ so it is copied to the dist root verbatim: a worker's scope is capped by the directory it is served from, and only a file at "/" can control "/". That also means it is never bundled, so everything here is plain browser JavaScript with no imports.
//
// There is deliberately no precache manifest. The bundler's output names are content-hashed and unknown until the build runs, and reproducing them here would mean either a build plugin or a list that goes stale silently. Runtime caching gets the same result from facts the worker can check at request time: /assets/ is immutable, the document is not.
//
// What is NOT touched, and why it is an early `return` rather than a pass-through fetch: the API (all state, all auth, all of it same-origin in production), cross-origin requests, and anything that is not a GET. Declining to call respondWith leaves the request entirely to the browser, which is both faster and the only way to be sure a worker bug can never corrupt a mutation.

const VERSION = "v1";
const SHELL_CACHE = `prdesk-shell-${VERSION}`;
const ASSET_CACHE = `prdesk-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];
// Hashed names accumulate one full set per deploy and nothing ever evicts them by name, so the asset cache is trimmed oldest-first. The Cache API iterates keys in insertion order, which makes "oldest" answerable without storing timestamps. A build is a few dozen entries; 200 leaves several deploys' worth of back-navigation working and still bounds the origin's storage.
const ASSET_LIMIT = 200;

// The document every route resolves to. The router is a HashRouter and the Go server answers every non-API document route with index.html, so one cache entry is the offline fallback for the whole application rather than one entry per visited path.
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  // `cache: "reload"` so a fresh worker cannot adopt the HTTP cache's copy of the document it is about to become the offline fallback for.
  event.waitUntil(self.caches.open(SHELL_CACHE).then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" }))));
  // Activating immediately is safe here and it is what keeps the worker honest: assets are content-hashed so two builds cannot collide, the document is network-first so the new worker serves the new build, and the one case an open tab can still hit -- a lazy chunk the new build deleted -- is already handled by the single reload in App.tsx's ErrorBoundary. An update prompt would be a fourth mechanism for a problem three already cover.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("prdesk-") && !CURRENT_CACHES.includes(name)).map((name) => self.caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/swagger" || url.pathname.startsWith("/swagger/")) return;
  // `mode: "navigate"` rather than an Accept sniff: it is set by the browser for top-level and iframe document loads only, so a same-origin fetch() for HTML is not mistaken for a page load.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isPublicFile(url.pathname)) event.respondWith(staleWhileRevalidate(event));
});

// Everything the build copies verbatim: icons, the favicon, the manifest. Stable names, so unlike /assets/ these cannot be cached forever -- a replaced icon would never be seen again. Matched by extension because the set is small and closed, and because an unknown path with an extension is a 404 the worker has no reason to store.
function isPublicFile(pathname) {
  return /\.(?:png|svg|ico|webmanifest|json|woff2?)$/.test(pathname);
}

// The document. Network wins whenever there is one, so a deploy is picked up by the next load and no reader is ever pinned to a stale build; the cache is the offline copy, refreshed on every successful load.
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await self.caches.open(SHELL_CACHE);
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await self.caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw error;
  }
}

// Content-hashed and served `immutable` by the Go handler, so a hit needs no revalidation and a miss can only mean a build this device has not loaded yet.
async function cacheFirst(request) {
  const cache = await self.caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache, ASSET_LIMIT);
  }
  return response;
}

// Answer from the cache at once and replace it in the background, so a stable name is still instant offline and still no more than one load behind. The refresh is handed to waitUntil because it outlives the response it was started for, and a worker with nothing left to answer can be killed mid-write.
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await self.caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
        await trim(cache, ASSET_LIMIT);
      }
      return response;
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });
  if (!cached) return network;
  event.waitUntil(network);
  return cached;
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}
