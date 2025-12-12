const CACHE_NAME = "splitsync-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./favicon.png",
  "./icon-192.png",
  "./icon-512.png"
];

// Install Event: Cache files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event: Serve from cache first, then network
self.addEventListener("fetch", (event) => {
  // We only cache local files, not the Firebase data requests
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});