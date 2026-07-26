// Nombre de la cookie de sesión, en su propio archivo SIN ninguna otra dependencia.
// `middleware.ts` corre en el runtime Edge (Next.js 15.5 no deja registrado el
// middleware si declara `runtime: "nodejs"` — el build lo descarta en silencio, sin
// error ni entrada en el manifest) y por lo tanto no puede importar `sesion.ts`, que
// arrastra `comun/db.ts` y con él `node:fs`/`pg`. Aislar la constante acá es lo que
// permite que el middleware la use sin arrastrar esa cadena.
export const NOMBRE_COOKIE = "kp_sesion";
