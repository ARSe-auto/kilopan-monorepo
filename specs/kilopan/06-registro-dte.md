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
- [x] (P2) Consolidación de guías en una factura + saldo por cliente (decisión #2):
      `documento_tributario.consolidado_en_id` (self-FK con índice único — ninguna guía
      se factura dos veces), vista `pan.saldo_cliente` derivada de eventos (nunca tabla
      editable a mano), `estado_pago` con «marcar pagada» — probado de punta a punta
      [AC-FIA-01]
- [x] (P2) UI «Consolidar y facturar»: admin elige cliente, ve sus guías sueltas, las
      marca y registra la factura que las cubre (monto = suma de las guías, no un número
      tecleado aparte). Probado: doble facturación rebota con 409 [AC-FIA-02]
- [ ] (P1) Captura del DTE: escaneo del TED con zxing-js como mejora progresiva **y
      captura manual tipo+folio+RUT como camino primario en iOS** (§7, AC probado en
      iPhone real). Hoy la tabla existe y nada la alimenta desde pantalla — el bloqueo
      del art. 55 (`AC-DES-02`) no se puede satisfacer sin salir de la app [AC-DTE-03]

## Notas de implementación

- `ted_xml` se guarda crudo para poder re-verificarlo contra el CAF más adelante.
- El TED no trae neto ni IVA. Invariante: si ambos vienen no-nulos, `neto+iva=total` con
  `round_clp`; si no, quedan NULL sin bloquear el registro.
- No hay ciclo de emisión ni estados intermedios: `registrado` | `anulado`. La emisión
  ante el SII (OpenFactura/LibreDTE) está FUERA del MVP (§3); el modelo ya queda listo.
