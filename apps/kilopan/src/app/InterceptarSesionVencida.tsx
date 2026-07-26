"use client";
import { useEffect } from "react";

// Un GET a /api/* que responde 401 significa que la sesión venció mientras el
// operador tenía la pantalla abierta (AC-ID-05, expiración por inactividad). Sin
// esto, una pantalla que no revisa r.ok a mano (la mayoría no lo hacía) seguía
// mostrando lo último que había cargado como si la sesión siguiera viva, para
// siempre — "F5" era la única salida. Centralizado acá una vez, en vez de en cada
// fetch: la alternativa es que cada pantalla nueva tenga que acordarse de revisarlo.
//
// Solo GET, y solo /api/*: los POST del outbox (pod/outbox.ts) ya distinguen 401/403
// ellos mismos —encolan y reintentan sin perder la mutación— y una redirección
// forzada a mitad de un ciclo de sync en segundo plano le cortaría al operador lo que
// esté tecleando ahora mismo, sin necesidad (esos datos ya están a salvo en
// IndexedDB). /api/auth/me también queda afuera: esa llamada existe justo para
// preguntar "¿hay sesión?" y un 401 ahí es una respuesta normal que la propia
// pantalla ("/") ya sabe manejar con su propio router.
export function InterceptarSesionVencida() {
  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const respuesta = await original(input, init);
      const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = input instanceof Request ? input.url : String(input);
      const pathname = new URL(url, window.location.origin).pathname;
      if (respuesta.status === 401 && metodo === "GET" && pathname.startsWith("/api/") && pathname !== "/api/auth/me") {
        window.location.assign("/ingresar");
      }
      return respuesta;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}
