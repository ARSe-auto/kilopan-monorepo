import { test, expect } from "@playwright/test";
import { request as pedir } from "node:http";
import { TENANTS } from "./preparar-tenants.mjs";
import { PUERTO_E2E } from "./puerto.ts";
import { derivarTema, PROPIEDAD_CSS } from "../../../packages/miga/src/tema.ts";

// AC-FMIG-02 — Theming por filas: el tema del tenant (logo + acento con derivados
// pressed/disabled/dark) entra como CSS custom properties desde el bootstrap; un UPDATE de
// `tenant_theme` lo sirve el PRÓXIMO bootstrap sin build ni deploy (§5.1, §2 métrica 3).
//
// Este es el oráculo declarado de «cero forks/builds por cliente» (§5, encabezado): dos
// tenants sirviendo temas DISTINTOS desde el MISMO build. Por eso, igual que ruteo.spec.ts
// (AC-FTEN-05), se usa `node:http` con la cabecera `Host` contra el MISMO `servidor.mjs` de
// producción que levanta el `webServer` de Playwright — un solo proceso, un solo `next build`,
// dos subdominios.

const PUERTO = PUERTO_E2E;
const DOMINIO = "localhost";
const hostDe = (slug: string) => `${slug}.${DOMINIO}:${PUERTO}`;

type Respuesta = { status: number; cuerpo: string };

function pedirComo(
  host: string,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: string } = {},
): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const payload = opciones.cuerpo;
    const req = pedir(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: ruta,
        method: opciones.metodo ?? "GET",
        headers: {
          Host: host,
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let cuerpo = "";
        res.setEncoding("utf8");
        res.on("data", (trozo) => (cuerpo += trozo));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo }));
      },
    );
    req.on("error", rechazar);
    if (payload) req.write(payload);
    req.end();
  });
}

// Dos activos, no uno: con uno solo «tenants distintos sirven temas distintos» se cumpliría
// por accidente. Se reutilizan los del fixture de ruteo — `tenant_theme` es una tabla que
// ninguna otra suite toca, así que compartir estos dos slugs no le pisa el `beforeAll` a nadie.
const ACTIVOS = TENANTS.filter((t) => t.estado === "activo");
const [A, B] = ACTIVOS as [(typeof ACTIVOS)[0], (typeof ACTIVOS)[0]];

test.beforeAll(async () => {
  // Cada tenant propone su acento por la ruta REAL, no por INSERT directo: este e2e ejerce
  // el mismo camino que va a usar el panel admin white-label del hito g.
  const ra = await pedirComo(hostDe(A.slug), "/api/tema", {
    metodo: "PUT",
    cuerpo: JSON.stringify({ accent_color: "#1D4ED8" }),
  });
  const rb = await pedirComo(hostDe(B.slug), "/api/tema", {
    metodo: "PUT",
    cuerpo: JSON.stringify({ accent_color: "#0B6E4F" }),
  });
  expect(ra.status).toBe(200);
  expect(rb.status).toBe(200);
});

test("dos tenants sirven CSS custom properties de tema DISTINTAS desde el MISMO build [AC-FMIG-02]", async () => {
  const ra = await pedirComo(hostDe(A.slug), "/");
  const rb = await pedirComo(hostDe(B.slug), "/");
  expect(ra.status).toBe(200);
  expect(rb.status).toBe(200);

  const temaA = derivarTema("#1D4ED8");
  const temaB = derivarTema("#0B6E4F");
  // El acento crudo puede repetirse por azar entre tenants; la variante DERIVADA (la que de
  // verdad se sirve como custom property) es lo que este AC promete que difiere por fila.
  expect(ra.cuerpo).toContain(`${PROPIEDAD_CSS.acento}: ${temaA.accentClaro};`);
  expect(rb.cuerpo).toContain(`${PROPIEDAD_CSS.acento}: ${temaB.accentClaro};`);
  expect(ra.cuerpo).not.toContain(temaB.accentClaro);
  expect(rb.cuerpo).not.toContain(temaA.accentClaro);
});

test("un UPDATE de tenant_theme lo sirve el PRÓXIMO bootstrap, sin build ni deploy [AC-FMIG-02]", async () => {
  const antes = await pedirComo(hostDe(A.slug), "/");
  expect(antes.cuerpo).toContain(derivarTema("#1D4ED8").accentClaro);

  const put = await pedirComo(hostDe(A.slug), "/api/tema", {
    metodo: "PUT",
    cuerpo: JSON.stringify({ accent_color: "#C2410C" }),
  });
  expect(put.status).toBe(200);

  const despues = await pedirComo(hostDe(A.slug), "/");
  const temaNuevo = derivarTema("#C2410C");
  expect(despues.cuerpo).toContain(`${PROPIEDAD_CSS.acento}: ${temaNuevo.accentClaro};`);
  expect(despues.cuerpo).not.toContain(derivarTema("#1D4ED8").accentClaro);
});

test("accent_color con contraste insuficiente ⇒ 422 tipado es-CL y la fila NO cambia [AC-FMIG-02]", async () => {
  const antes = await pedirComo(hostDe(B.slug), "/api/tema");

  const r = await pedirComo(hostDe(B.slug), "/api/tema", {
    metodo: "PUT",
    cuerpo: JSON.stringify({ accent_color: "#FDF2E9" }),
  });
  expect(r.status).toBe(422);
  const cuerpo = JSON.parse(r.cuerpo) as { error: string; mensaje: string };
  expect(cuerpo.error).toBe("contraste_insuficiente");
  expect(cuerpo.mensaje).toMatch(/contraste m[ií]nimo/);

  const despues = await pedirComo(hostDe(B.slug), "/api/tema");
  expect(despues.cuerpo).toBe(antes.cuerpo);
});

test("un accent_color mal formado ⇒ 422 tipado es-CL [AC-FMIG-02]", async () => {
  const r = await pedirComo(hostDe(B.slug), "/api/tema", {
    metodo: "PUT",
    cuerpo: JSON.stringify({ accent_color: "azul" }),
  });
  expect(r.status).toBe(422);
  const cuerpo = JSON.parse(r.cuerpo) as { error: string };
  expect(cuerpo.error).toBe("accent_invalido");
});
