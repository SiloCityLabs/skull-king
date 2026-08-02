import { isObsoleteShellCache, isShellRequest } from "./sw-rules.js";

const CACHE = "skull-king-__BUILD_HASH__";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=__BUILD_HASH__",
  "./db.js?v=__BUILD_HASH__",
  "./score.js?v=__BUILD_HASH__",
  "./sw-rules.js?v=__BUILD_HASH__",
  "./app.js?v=__BUILD_HASH__",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
  "./images/Image2_480x480.jpg",
  "./images/Image3_480x480.webp",
  "./haptic.mp3",
];

async function deleteObsoleteCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => isObsoleteShellCache(k, CACHE)).map((k) => caches.delete(k)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(ASSETS);
      } catch (err) {
        await caches.delete(CACHE);
        throw err;
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteObsoleteCaches()
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED", cache: CACHE }));
        })
      )
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "CLEAR_OBSOLETE_CACHES") {
    event.waitUntil(deleteObsoleteCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!isShellRequest(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        if (request.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
