# 06 — Registro DTE y fiado

Fuente: §3

Módulo 6 de los siete. **La app JAMÁS emite documentos tributarios.** Registra y asocia
los DTE ya emitidos (factura 33, boleta 39, guía 52, NC 61 como anulación) por escaneo del
TED (PDF417) o ingreso manual tipo+folio+RUT — el manual es el camino primario en iOS.

Generar un número con apariencia de DTE es delito (art. 97 N°4 CT, documento falso). Por
eso el correlativo interno se llama `correlativo_pedido` y nunca «folio».

## Criterios de aceptación

- [x] (P0-SEC) La app no puede reescribir un folio ni un RUT ya registrado: `pan_app`
      solo tiene UPDATE en (`consolidado_en_id`, `estado_pago`) — probado. No existe
      ninguna función que genere folios [AC-DTE-02]
- [ ] (P2) Consolidación de guías en una factura + saldo por cliente (decisión #2):
      `documento_tributario.consolidado_en_id` (self-FK con índice único — ninguna guía
      se factura dos veces), vista `pan.saldo_cliente` derivada de eventos (nunca tabla
      editable a mano), `estado_pago` con «marcar pagada» — probado de punta a punta
      [AC-FIA-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El "índice único" que la afirmación
      cita no existe: `db/migraciones/0004_despacho_dte_pod.sql:148` crea
      `dte_consolidado_idx` como índice NO único sobre `consolidado_en_id`. Lo único
      único ahí es la PK de la tabla, que no impide que la misma guía se consolide dos
      veces por dos UPDATE sucesivos. Los tests reales que sí existen
      (`db/test-invariantes.mjs:749,785`) prueban el saldo derivado de eventos, no la
      prevención de doble consolidación.
- [ ] (P2) UI «Consolidar y facturar»: admin elige cliente, ve sus guías sueltas, las
      marca y registra la factura que las cubre (monto = suma de las guías, no un número
      tecleado aparte). Probado: doble facturación rebota con 409 [AC-FIA-02]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El guard 409 existe en código
      (`apps/kilopan/src/app/api/facturar/route.ts:123`), pero ningún test
      (`db/test-invariantes.mjs`, `e2e/*.spec.ts`, `**/*.test.ts`) ejercita el escenario
      de doble facturación descrito — nadie lo ha corrido de verdad.
- [x] (P1) Escaneo del TED con zxing-js como mejora progresiva. La captura MANUAL —el
      camino primario en iOS según §7— ya existe: panel «Registrar documento del SII» en
      `/pedidos`. El escaneo del PDF417 rellena tipo+folio+RUT+monto y guarda el `ted_xml`
      crudo — probado: `parsearTed` (src/comun/ted.ts) con 6 tests unitarios (guía real,
      sin receptor, texto no-TED, tipo fuera de dominio 33/39/52/61, sin monto, folio/monto
      en cero); `EscanerTed.tsx` decodifica con `BrowserPDF417Reader` y degrada a manual
      ante cualquier fallo (el botón solo aparece si hay cámara). Editar un campo a mano
      descarta el `ted_xml` para que lo registrado coincida con lo timbrado [AC-DTE-03]

## Notas de implementación

- `ted_xml` se guarda crudo para poder re-verificarlo contra el CAF más adelante.
- El TED no trae neto ni IVA. Invariante: si ambos vienen no-nulos, `neto+iva=total` con
  `round_clp`; si no, quedan NULL sin bloquear el registro.
- No hay ciclo de emisión ni estados intermedios: `registrado` | `anulado`. La emisión
  ante el SII (OpenFactura/LibreDTE) está FUERA del MVP (§3); el modelo ya queda listo.
