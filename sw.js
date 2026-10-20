// Service worker: tiene una copia dell'interfaccia per aprirla anche senza rete. I dati passano sempre dal server (mai in cache qui).
const CACHE = "top-shell-v1";
const SHELL = ["/", "/index.html", "/app.js", "/platform.js", "/login.html", "/login.js", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/_blob/")) return; // dati: sempre dal server
  // interfaccia: prima la rete (per avere l'ultima versione), poi la copia in cache se la rete manca
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && r.type === "basic" && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || (u.pathname === "/" ? caches.match("/index.html") : undefined))));
});
