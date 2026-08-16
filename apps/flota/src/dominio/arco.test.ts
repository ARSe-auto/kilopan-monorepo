// Export ARCO por persona [AC-FIDN-15] — §3.E1.15, §7.8.
//
// Lo que se prueba acá es la SEGUNDA capa: que el armado del documento rebote solo cuando de
// verdad hay una fuga. La primera capa —la lista blanca dentro del SELECT— no se puede probar
// sin base, y por eso su prueba vive en `db/flota/suite-bd/arco.test.mjs`, contra el cluster.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarExportArco,
  camposVedadosEn,
  CAMPOS_VEDADOS,
  FORMATO_ARCO,
  FugaDeTerceros,
  type FilaConDuena,
  type PersonaArco,
  type UsuarioArco,
  type DispositivoArco,
} from "./arco.ts";

const TITULAR_ID = "0197a2e4-0000-7000-8000-000000000001";
const OTRA_ID = "0197a2e4-0000-7000-8000-000000000002";
const GENERADO = new Date("2026-08-15T18:30:00.000Z");

/** RUT sintácticamente válido e IRREAL (§7.8: cero datos personales reales en fixtures). */
const titular = (): PersonaArco => ({
  id: TITULAR_ID,
  rut: "12.345.678-5",
  nombre: "Titular De Prueba",
  contacto: "+56900000000",
  anonimizada_en: null,
  creada_en: "2026-01-02 03:04:05+00",
});

const usuario = (persona_id: string | null): FilaConDuena<UsuarioArco> => ({
  id: "0197a2e4-0000-7000-8000-0000000000a1",
  persona_id,
  rol: "chofer",
  empresa_cliente_id: null,
  activo: true,
  bloqueado_hasta: null,
  creado_en: "2026-01-02 03:04:05+00",
});

const dispositivo = (persona_id: string | null): FilaConDuena<DispositivoArco> => ({
  id: "0197a2e4-0000-7000-8000-0000000000b1",
  persona_id,
  tipo: "personal",
  is_standalone: true,
  storage_persisted: true,
  enrolado_en: "2026-01-02 03:04:05+00",
  revocado_at: null,
  creado_en: "2026-01-02 03:04:05+00",
});

const base = () => ({
  generadoEn: GENERADO,
  tenant: "gate-arco",
  titular: titular(),
  usuarios: [usuario(TITULAR_ID)],
  dispositivos: [dispositivo(TITULAR_ID)],
});

test("[AC-FIDN-15] el documento sale con los datos de la titular y su formato versionado", () => {
  const doc = armarExportArco(base());
  assert.equal(doc.formato, FORMATO_ARCO);
  assert.equal(doc.generado_en, "2026-08-15T18:30:00.000Z");
  assert.equal(doc.titular.rut, "12.345.678-5");
  assert.equal(doc.titular.nombre, "Titular De Prueba");
  assert.equal(doc.titular.contacto, "+56900000000");
  assert.equal(doc.usuarios.length, 1);
  assert.equal(doc.usuarios[0]?.rol, "chofer");
  assert.equal(doc.dispositivos.length, 1);
  assert.equal(doc.dispositivos[0]?.tipo, "personal");
});

test("[AC-FIDN-15] el `persona_id` de verificación NO viaja en el documento", () => {
  const doc = armarExportArco(base());
  // Está en la entrada y sirve para rebotar; en la salida sería la misma cadena repetida en
  // cada fila, y todo campo de más en un documento que se entrega es superficie de más.
  assert.ok(!("persona_id" in (doc.usuarios[0] as object)));
  assert.ok(!("persona_id" in (doc.dispositivos[0] as object)));
});

test("[AC-FIDN-15] una fila de OTRA persona aborta el export entero, sin entregar nada", () => {
  for (const entrada of [
    { ...base(), usuarios: [usuario(TITULAR_ID), usuario(OTRA_ID)] },
    { ...base(), dispositivos: [dispositivo(OTRA_ID)] },
  ]) {
    assert.throws(() => armarExportArco(entrada), FugaDeTerceros);
  }
});

test("[AC-FIDN-15] el andén, que no tiene persona dueña, tampoco entra", () => {
  // `dispositivos.persona_id` es nullable justo para el andén (§4.3, F-D): es un activo del
  // TENANT y no de nadie. Un `null` que pasara la verificación metería el aparato compartido
  // del galpón dentro del export personal de quien lo usó anoche.
  assert.throws(() => armarExportArco({ ...base(), dispositivos: [dispositivo(null)] }), FugaDeTerceros);
});

test("[AC-FIDN-15] un campo vedado en la salida aborta, aunque la fila sea de la titular", () => {
  // Simula la regresión concreta: alguien cambia el SELECT por un `select *` y `pin_hash`
  // llega adentro de la fila. Ni la dueña correcta ni la fila correcta lo salvan.
  const conHash = { ...usuario(TITULAR_ID), pin_hash: "$argon2id$fake" } as FilaConDuena<UsuarioArco>;
  const doc = armarExportArco({ ...base(), usuarios: [conHash] });
  // El armado copia campo por campo, así que el hash ni siquiera llega a la salida...
  assert.ok(!("pin_hash" in (doc.usuarios[0] as object)));
  // ...y si alguien reemplazara ese copiado por un spread, el guardián lo ve.
  assert.deepEqual(camposVedadosEn({ usuarios: [conHash] }), ["usuarios[0].pin_hash"]);
});

test("[AC-FIDN-15] el guardián mira CADA campo vedado, a cualquier profundidad", () => {
  for (const campo of CAMPOS_VEDADOS) {
    assert.deepEqual(
      camposVedadosEn({ a: { b: [{ [campo]: "x" }] } }),
      [`a.b[0].${campo}`],
      `el campo vedado «${campo}» pasó sin verse`,
    );
  }
  assert.deepEqual(camposVedadosEn({ rut: "12.345.678-5", hijo: null }), []);
});
