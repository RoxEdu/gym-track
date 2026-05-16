/* GymTrack service worker — minimal cache + network-first SWR for /api GETs */
const CACHE_VERSION = "gymtrack-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL_CACHE));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // only cache GETs
  const url = new URL(request.url);

  // Network-first SWR for /api GETs
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || new Response(JSON.stringify({offline: true}), {status: 503, headers: {"Content-Type": "application/json"}})))
    );
    return;
  }

  // Cache-first for static shell (same origin)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});

// Listen for outbound queue flush messages from app
self.addEventListener("message", (event) => {
  if (event.data?.type === "FLUSH_QUEUE") {
    // App-side handles actual flush (has access to API_BASE + auth), SW just acknowledges
    event.ports?.[0]?.postMessage({ ok: true });
  }
});
