/**
 * sw.js — Service worker for TypeRaider PWA.
 *
 * Strategies:
 * - Precache app shell (HTML, CSS, JS)
 * - Runtime cache Tesseract CDN assets on first use
 * - Network-only for IIIF images (random, not worth caching)
 * - Share target: intercept POST, stash image, redirect to app
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `typeraider-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `typeraider-runtime-${CACHE_VERSION}`;
const SHARE_CACHE = "typeraider-share";

const SHELL_URLS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/repertoire.js",
  "/js/type-editor.js",
  "/js/fragment.js",
  "/icons/icon.svg",
];

// ── Install: precache app shell ──

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ──

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== SHARE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch handler ──

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Share target: intercept POST to "/" — stash the shared image
  if (event.request.method === "POST" && url.pathname === "/") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only handle GET requests from here on
  if (event.request.method !== "GET") return;

  // IIIF images: network-only (random pages, not worth caching)
  if (url.hostname === "iiif.archive.org") return;

  // Tesseract CDN assets: cache on first use (runtime cache)
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("tesseract")) {
    event.respondWith(cacheFirst(event.request, RUNTIME_CACHE));
    return;
  }

  // Google Fonts: runtime cache
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(event.request, RUNTIME_CACHE));
    return;
  }

  // App shell: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE));
    return;
  }
});

// ── Caching strategies ──

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// ── Share target handler ──

async function handleShareTarget(request) {
  const formData = await request.formData();
  const file = formData.get("image");

  if (file) {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put("/shared-image", new Response(file));
    return Response.redirect("/?shared=1", 303);
  }

  // No file in the share — just redirect to app
  return Response.redirect("/", 303);
}
