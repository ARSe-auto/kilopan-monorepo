// Service worker mínimo para operar por datos móviles.
//
// Alcance deliberadamente ACOTADO: cachea el "app shell" (los archivos estáticos que
// hacen que la app abra) y nada más. NO cachea respuestas de la API — hacerlo sería
// mostrarle al panadero un stock o una TCK viejos como si fueran de ahora, que es peor
// que decirle "sin conexión". Los datos que sí deben sobrevivir sin red van por el
// outbox de IndexedDB, que es explícito sobre lo que está pendiente.

// v2 (Tanda 6 de la auditoría): v1 cacheaba CUALQUIER página, incluidas las
// autenticadas (/caja, /dashboard, /pedidos...). El Cache Storage ignora por diseño
// las cabeceras Cache-Control, así que un `no-store` del servidor no alcanzaba para
// evitarlo — sin señal justo en ese instante, el service worker le servía al SIGUIENTE
// operador de la tablet el HTML (con datos) de la sesión anterior. Subir la versión
// además borra cualquier página autenticada que ya haya quedado cacheada por v1 en
// equipos que ya tenían el service worker instalado (ver `activate` más abajo).
const CACHE = "kilopan-shell-v2";

// Únicas páginas que tiene sentido servir desde caché sin conexión: no tienen datos de
// sesión, así que no importa a quién se las sirva. Todo lo demás (dashboard, caja,
// pedidos, etc.) exige sesión — cachearlas es el bug que esta versión corrige.
const RUTAS_PUBLICAS_CACHEABLES = new Set(["/", "/ingresar", "/vincular"]);

// Cada build de Next nombra sus chunks con un hash nuevo — un chunk cacheado de un
// build viejo no lo vuelve a pedir nadie porque el HTML del build actual ya no lo
// referencia, pero tampoco se borra solo: sin tope, un equipo que queda prendido
// semanas sin que se suba la versión de este archivo (CACHE) acumula cada chunk de
// cada deploy, para siempre. cache.keys() en Chrome devuelve orden de inserción, así
// que recortar por el principio es, en la práctica, LRU-por-inserción.
const TOPE_ESTATICOS = 200;

async function agregarConTope(cache, request, response) {
  await cache.put(request, response);
  const claves = await cache.keys();
  const exceso = claves.length - TOPE_ESTATICOS;
  if (exceso > 0) await Promise.all(claves.slice(0, exceso).map((k) => cache.delete(k)));
}

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
            void caches.open(CACHE).then((c) => agregarConTope(c, evento.request, copia));
            return resp;
          })
      )
    );
    return;
  }

  // Páginas: red primero (para no servir una versión vieja de la app). El caché como
  // red de seguridad sin conexión SOLO aplica a las rutas públicas — cachear /caja o
  // /dashboard es exactamente el bug que esta versión corrige.
  const esPublica = RUTAS_PUBLICAS_CACHEABLES.has(url.pathname);
  evento.respondWith(
    fetch(evento.request)
      .then((resp) => {
        if (esPublica) {
          const copia = resp.clone();
          void caches.open(CACHE).then((c) => c.put(evento.request, copia));
        }
        return resp;
      })
      .catch(() =>
        esPublica
          ? caches.match(evento.request).then((hit) => hit ?? caches.match("/ingresar"))
          // Una página autenticada sin red: nunca desde caché. Redirigir a /ingresar es
          // seguro (esa sí es pública) y el middleware la manda de vuelta si hay sesión.
          : caches.match("/ingresar")
      )
  );
});
