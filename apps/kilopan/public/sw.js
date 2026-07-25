// Service worker mínimo para operar por datos móviles.
//
// Alcance deliberadamente ACOTADO: cachea el "app shell" (los archivos estáticos que
// hacen que la app abra) y nada más. NO cachea respuestas de la API — hacerlo sería
// mostrarle al panadero un stock o una TCK viejos como si fueran de ahora, que es peor
// que decirle "sin conexión". Los datos que sí deben sobrevivir sin red van por el
// outbox de IndexedDB, que es explícito sobre lo que está pendiente.

const CACHE = "kilopan-shell-v1";

self.addEventListener("install", (evento) => {
  // No se precachea una lista fija de chunks: sus nombres llevan hash y cambian en
  // cada build, así que una lista escrita a mano quedaría obsoleta en silencio.
  // Se cachea sobre la marcha (abajo) lo que la app realmente pide.
  self.skipWaiting();
  evento.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);

  // Solo GET del mismo origen. Las mutaciones (POST) jamás pasan por acá: son del
  // outbox, que sabe reintentarlas sin duplicar.
  if (evento.request.method !== "GET" || url.origin !== self.location.origin) return;

  // La API SIEMPRE va a la red. Un dato viejo servido como fresco es un engaño.
  if (url.pathname.startsWith("/api/")) return;

  // Estáticos: caché primero (son inmutables, llevan hash en el nombre).
  if (url.pathname.startsWith("/_next/static/")) {
    evento.respondWith(
      caches.match(evento.request).then(
        (hit) =>
          hit ??
          fetch(evento.request).then((resp) => {
            const copia = resp.clone();
            void caches.open(CACHE).then((c) => c.put(evento.request, copia));
            return resp;
          })
      )
    );
    return;
  }

  // Páginas: red primero (para no servir una versión vieja de la app), con el caché
  // como red de seguridad cuando no hay señal.
  evento.respondWith(
    fetch(evento.request)
      .then((resp) => {
        const copia = resp.clone();
        void caches.open(CACHE).then((c) => c.put(evento.request, copia));
        return resp;
      })
      .catch(() => caches.match(evento.request).then((hit) => hit ?? caches.match("/ingresar")))
  );
});
