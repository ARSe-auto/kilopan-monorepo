#!/usr/bin/env node
// El servidor de FLOTA: el ruteo por subdominio va ACÁ, delante de Next [AC-FTEN-05].
//
// POR QUÉ NO ES UN MIDDLEWARE DE NEXT, que sería el lugar obvio. Los tres desenlaces que
// dictó el dueño (Pregunta 9: 404 · 503 · 404) son CÓDIGOS HTTP, y para elegirlos hay que
// consultar `control` con el driver de Postgres. El middleware de Next corre en el Edge, sin
// sockets TCP; el runtime Node para middleware es experimental y ni siquiera existe en la
// versión instalada (15.5.21: `nodeMiddleware` no está en su esquema de configuración,
// verificado antes de escribir esto). Las salidas que quedaban eran dos, y las dos peores:
//
//   · Poner el gate en un layout. Un Server Component NO puede fijar el status: un tenant
//     suspendido habría respondido 200 con un cartel. Para un monitor, un buscador o un
//     reintento automático eso es «todo bien» — el mismo teatro de cliente que el método
//     rechaza en el resto del producto.
//   · Middleware Edge que consulta un endpoint interno. Además del salto extra por request,
//     ese endpoint queda siendo un oráculo de qué subdominios existen — exactamente lo que
//     el 404-para-los-dos-casos de la Pregunta 9 vino a impedir.
//
// Un servidor propio no tiene ninguno de los dos problemas: es el proceso que ya es dueño
// del socket, corre en Node, y decide el status antes de que Next vea el request. Y es el
// MISMO camino en desarrollo y en producción — un gate que solo corre en producción es un
// gate que se descubre roto en producción.
import { createServer } from "node:http";
import next from "next";
import { resolverHost } from "./src/servidor/ruteo.ts";
import { respuestaSinTenant, respuestaSuspendido, respuestaPortalApagado } from "./src/servidor/paginas-estado.ts";
import { esRutaDelPortalCliente } from "./src/dominio/portal-ruta.ts";
import { portalClienteEncendido } from "./src/servidor/portal.ts";
import { poolDe } from "./src/servidor/conexion.ts";

const dev = process.env.NODE_ENV !== "production";
const puerto = Number(process.env.PORT || 3310);
const hostname = process.env.HOSTNAME || "0.0.0.0";

/** Vuelca una `Response` del gate sobre la respuesta de `node:http`. */
async function responder(res, respuesta) {
  res.statusCode = respuesta.status;
  respuesta.headers.forEach((valor, clave) => res.setHeader(clave, valor));
  res.end(await respuesta.text());
}

const app = next({ dev, dir: import.meta.dirname });
await app.prepare();
const atender = app.getRequestHandler();

createServer(async (req, res) => {
  try {
    const veredicto = await resolverHost(req.headers.host);

    // `archivado` responde IGUAL que un subdominio sin tenant, y esa igualdad ES el punto:
    // si difirieran, la diferencia diría cuáles subdominios existieron alguna vez.
    if (veredicto.tipo === "sin_tenant" || veredicto.tipo === "archivado") {
      return await responder(res, respuestaSinTenant());
    }
    if (veredicto.tipo === "suspendido") {
      return await responder(res, respuestaSuspendido());
    }

    // Tenant activo: recién acá se deja pasar el request, con su identidad resuelta. Las
    // cabeceras se SOBRESCRIBEN siempre: si se aceptaran las de afuera, cualquiera elegiría
    // tenant mandando una cabecera y todo el aislamiento del §4.1 se caería por ahí.
    req.headers["x-flota-tenant-slug"] = veredicto.slug;
    req.headers["x-flota-tenant-bd"] = veredicto.bd;

    // El portal del contratante [AC-FPOR-04] — spec 07 §1: apagado (mi_flota u override) ⇒
    // 403 en TODA ruta `/cliente/*`, antes de que Next vea el request. Mismo motivo que el
    // 404/503 de arriba (comentario de cabecera): un Server Component no puede fijar el
    // status, así que el candado no puede vivir en un layout.
    if (esRutaDelPortalCliente(req.url)) {
      const pool = poolDe(veredicto.bd);
      if (!(await portalClienteEncendido(pool, veredicto.slug))) {
        return await responder(res, respuestaPortalApagado());
      }
    }

    await atender(req, res);
  } catch (error) {
    // Un fallo del plano de control no puede terminar sirviendo la base de nadie: si no se
    // sabe de quién es el request, no se atiende. 503 y no 500 porque es indisponibilidad,
    // no una petición mala.
    console.error("ruteo: fallo resolviendo el host", error);
    if (!res.headersSent) await responder(res, respuestaSuspendido());
    else res.end();
  }
}).listen(puerto, hostname, () => {
  console.log(`FLOTA escuchando en http://${hostname}:${puerto} (dev=${dev})`);
});
