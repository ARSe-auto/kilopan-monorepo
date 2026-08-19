// Mutantes del gate «la app JAMÁS emite DTE» [AC-FTAR-08] — spec 06 §7.3, §4.6, §3.E2.
//
// Este gate va a estar años en verde sin disparar, que es justo lo que lo vuelve peligroso: una
// lista de expresiones regulares mal escritas se ve EXACTAMENTE igual que una buena mientras
// nadie la viole. Así que acá se ejerce por partida doble, el mismo estándar del linter de
// migraciones (AC-FTEN-06) y del manifiesto de rutas (AC-FTEN-26):
//
//   · cada firma tiene que atrapar su propio POSITIVO —el código que existiría si alguien
//     hubiera empezado a emitir— y ninguna puede ser un no-op;
//   · ningún NEGATIVO —cadenas reales del registro manual, que es la función legítima— puede
//     disparar, porque un gate que muerde lo que sí se puede hacer termina desactivado, y ahí
//     sí se pierde la protección de verdad.
//
// El costo de equivocarse acá no es un test rojo: es el art. 97 N°4 del Código Tributario.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LISTA,
  firmasCompiladas,
  escanearTexto,
  escanearArbol,
  archivosDe,
  revisarManifiesto,
} from "./gate-jamas-emite.mjs";

const APP = join(import.meta.dirname, "..");
const MANIFIESTO = JSON.parse(readFileSync(join(APP, "rutas", "manifiesto.json"), "utf8"));

test("[AC-FTAR-08] `apps/flota/src` no tiene ni una firma de estructura de DTE", () => {
  const hallazgos = escanearArbol();
  assert.deepEqual(
    hallazgos.map((h) => `${h.archivo}:${h.linea} (${h.firma})`),
    [],
    "hay código con forma de emisión de DTE en el árbol",
  );
});

test("[AC-FTAR-08] el escaneo mira archivos de verdad: la ausencia no es por no haber leído nada", () => {
  // El verde vacuo de este AC: con un walker roto, «cero firmas» sería trivialmente cierto.
  const archivos = archivosDe(join(APP, "src"));
  assert.ok(archivos.length > 100, `solo ${archivos.length} archivos escaneados en src/`);
  assert.ok(
    archivos.some((a) => a.endsWith("servidor/manifiestos.ts")),
    "el walker no alcanzó el módulo que MÁS habla de DTE — si algo se le escapa, es ese",
  );
});

test("[AC-FTAR-08] cada firma de la lista versionada atrapa su propio positivo", () => {
  for (const f of firmasCompiladas()) {
    assert.ok(
      f.regex.test(f.positivo),
      `la firma «${f.id}» no atrapa ni su propio positivo: es un no-op y nadie lo notaría`,
    );
  }
});

test("[AC-FTAR-08] ninguna firma muerde el registro MANUAL de folio, que es legítimo", () => {
  const lista = firmasCompiladas();
  for (const legal of LISTA.negativos) {
    const hallazgos = escanearTexto("negativo", legal, lista);
    assert.deepEqual(
      hallazgos.map((h) => h.firma),
      [],
      `«${legal}» es registro manual (§7.3, camino paralelo permanente) y el gate lo rebotaría`,
    );
  }
});

test("[AC-FTAR-08] el gate atrapa el código que existiría si la app empezara a emitir", () => {
  // Cada mutante es un archivo verosímil, no una cadena de laboratorio: así se lee lo que el
  // gate tendría que decir el día que alguien lo escriba de verdad.
  const mutantes = [
    ['const sobre = `<DTE version="1.0"><Documento ID="F${folio}">`;', "tag-dte"],
    ['const envio = "<EnvioDTE xmlns=\\"http://www.sii.cl/SiiDte\\">";', "tag-envio-dte"],
    ['xml += "<TED version=\\"1.0\\">" + dd + "</TED>";', "tag-ted"],
    ['const caf = "<CAF version=\\"1.0\\">" + autorizacion;', "tag-caf"],
    ['nodo += "<FRMT algoritmo=\\"SHA1withRSA\\">" + firma;', "tag-interno-del-timbre"],
    ['const NS = "http://www.w3.org/2000/09/xmldsig#";', "namespace-xmldsig"],
    ['import { SignedXml } from "xml-crypto";', "libreria-de-firma-xml"],
    ['const API = "https://api.openfactura.cl/v2/dte/document";', "proveedor-de-emision"],
    ["export function generarTimbre(documento: Documento) {", "timbre-generado"],
    ["const folio = await asignarFolio(pool, 33);", "folio-generado"],
    ["const { rows } = await c.query(\"select nextval('folio_33_seq')\");", "rango-de-folios"],
    ['const cert = leerCertificado("firma.p12", clave);', "certificado-de-firma"],
    ["const trackId = respuesta.TRACKID;", "acuse-del-sii"],
  ];
  const lista = firmasCompiladas();
  for (const [codigo, firmaEsperada] of mutantes) {
    const hallazgos = escanearTexto("src/mutante.ts", codigo, lista);
    assert.ok(
      hallazgos.some((h) => h.firma === firmaEsperada),
      `el mutante «${codigo}» pasó sin que la firma «${firmaEsperada}» lo viera`,
    );
  }
});

test("[AC-FTAR-08] la lista es un artefacto versionado y legible, no un montón de regex", () => {
  // Lo que la hace auditable por una persona: versión, ids únicos, y una razón escrita por
  // firma. Sin el «porqué», el día que una dispare nadie sabrá si borrar código o la regla.
  assert.equal(typeof LISTA.version, "number");
  assert.ok(LISTA.firmas.length >= 10, `solo ${LISTA.firmas.length} firmas`);
  const ids = LISTA.firmas.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids de firma repetidos");
  for (const f of LISTA.firmas) {
    assert.ok(f.porque && f.porque.length >= 40, `la firma «${f.id}» no explica por qué existe`);
    assert.ok(f.positivo, `la firma «${f.id}» no trae el código que dice atrapar`);
  }
});

test("[AC-FTAR-08] el manifiesto de rutas no declara NINGÚN endpoint de emisión", () => {
  assert.deepEqual(
    revisarManifiesto(MANIFIESTO),
    [],
    "hay una puerta HTTP con forma de emisión de DTE: en E1 no existe, y en E2 va por el " +
      "puerto EmisorDTE contra un proveedor autorizado (§3.E2)",
  );
});

test("[AC-FTAR-08] el manifiesto tiene rutas que revisar: la ausencia no es por estar vacío", () => {
  assert.ok(MANIFIESTO.rutas.length > 0, "el manifiesto está vacío");
});

test("[AC-FTAR-08] la regla del manifiesto atrapa las puertas que alguien abriría de verdad", () => {
  const emisoras = [
    "/api/dte",
    "/api/dte/[id]",
    "/api/liquidaciones/[id]/emitir",
    "/api/liquidaciones/[id]/emitir-33",
    "/api/facturacion/emision",
    "/api/liquidaciones/[id]/timbrar",
    "/api/sii/envio-dte",
    "/api/caf",
    "/api/folios",
    "/api/dte/xml",
  ];
  const atrapadas = revisarManifiesto({ rutas: emisoras.map((ruta) => ({ ruta })) }).map((s) => s.ruta);
  assert.deepEqual(atrapadas, emisoras, "alguna puerta de emisión pasaría sin que nadie la note");
});

test("[AC-FTAR-08] la regla del manifiesto NO toca el registro manual ni el resto del panel", () => {
  // La frontera exacta del §7.3: `documento` y `folio` en singular son el camino paralelo
  // permanente —lo que la app sí hace— y tienen que poder existir sin pelear con el gate. Que
  // `/api/liquidaciones/[id]/folio` esté en esta lista es deliberado: es la puerta del registro
  // manual del folio de la liquidación, y el día que se abra no puede encontrar el gate cerrado.
  const legitimas = [
    "/api/manifiesto-items/[id]/documento",
    "/api/liquidaciones/[id]/folio",
    "/api/liquidaciones/[id]",
    "/api/liquidacion-lineas/[id]/evidencia",
    "/api/manifiestos",
    "/api/encargos",
    "/",
  ];
  assert.deepEqual(
    revisarManifiesto({ rutas: legitimas.map((ruta) => ({ ruta })) }),
    [],
    "el gate rebotaría una ruta legítima del producto",
  );
});
