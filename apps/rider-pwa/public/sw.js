/* Mallaka service worker: small, dependency-free.
 * - App shell and static assets: cache-first (works offline after the first visit).
 * - GET /api/v1/leases*: network-first, falling back to the last cached response so the
 *   last-known lease state still shows offline. The app labels it "last updated".
 * - Never caches POSTs, auth, or webhook calls. */
const SHELL = "mallaka-shell-v1";
const DATA = "mallaka-data-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/v1/leases")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && (url.pathname.startsWith("/_next/static/") || SHELL_URLS.includes(url.pathname))) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match("/"))
    )
  );
});
