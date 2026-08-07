# 00 — Modelo de datos e invariantes (schema `pan`)

Fuente: §4

La BD es la autoridad. Las reglas de negocio viven en Postgres y la app las **llama**;
jamás las reimplementa en TypeScript. El gate testea cada invariante **intentando
violarla** con `SET ROLE pan_app` — nunca por el camino del dueño del esquema, que
pasaría por encima de todo `REVOKE`.

Unidades duras: dinero = CLP `integer` vía `pan.round_clp()`; peso = gramos `integer`
con `CHECK (gramos BETWEEN 1 AND 100000)`. Jamás numeric de kilos, jamás float.
El reloj del **servidor** (`recibido_at`) manda para negocio y métricas; el del teléfono
(`capturado_at`) se guarda solo para diagnóstico y TCK.

## Criterios de aceptación

- [x] (P0) Migración `0001_identidad.sql`: `pan.usuarios`, `pan.dispositivos`,
      `pan.sesiones_operador` con `EXCLUDE USING gist` (requiere `btree_gist`),
      `pan.valida_rut()` módulo 11 y `pan.round_clp()` — probado contra pglite en
      `db/test-invariantes.mjs` [AC-ID-01]
- [x] (P1) `productos`, `precios` (2 listas con vigencia histórica), `hornadas` y
      `pesajes` con los CHECK de destino/motivo de §4 — probado [AC-PES-01]
- [x] (P1) `ventas`, `venta_lineas`, `cierres_caja` con invariantes probadas: fiado
      exige cliente; una línea es gramos XOR unidades [AC-VEN-01]
- [x] (P1) `clientes`, `pedidos` (máquina de estados + `correlativo_pedido` asignado
      SOLO por `pan.asignar_correlativo()`, inmutable después), `pedido_lineas` con
      `gramos_pesados` mantenido por trigger y jamás por la app, `rutas`, `ruta_paradas`
      [AC-DES-01]
- [x] (P1) `entregas`: POD inmutable por trigger, `supersede_id` para corrección, GPS
      con rango Chile que rebota `(0,0)` en la BD, flags `gps_degradado` y
      `gps_fuera_de_zona` que **nunca** bloquean, un solo POD vigente por pedido vía
      índice parcial [AC-POD-01]
- [x] (P1) `documento_tributario` (33/39/52/61) con `UNIQUE (tipo, folio, emisor)`,
      neto+IVA cuadrando con `round_clp`, `ind_traslado` solo en guías. La app jamás
      emite [AC-DTE-01]
- [x] (P0-SEC) Rol de aplicación de mínimo privilegio `pan_app`: la app nunca se conecta
      como dueño del esquema. Todo test de invariante hace `SET ROLE pan_app` antes de
      intentar violar algo [AC-SEC-08]
- [x] (P1-PERF) Índices en los filtros calientes: `pesajes.capturado_at`,
      `destino+fecha`, `ventas.creado_at`, `pedidos(fecha,estado)`, `ruta_paradas`,
      `entregas.capturado_at`. Nota: índice sobre `creado_at::date` es imposible —
      castear timestamptz a date no es IMMUTABLE [AC-PERF-01]
      — Cerrado con `db/test-invariantes.mjs` ("AC-PERF-01: EXPLAIN confirma..."):
      siembra ~3000 filas por tabla, corre `ANALYZE` y lee el plan real de `EXPLAIN`
      para cada uno de los 6 filtros calientes, confirmando que el planner elige el
      índice (nunca `Seq Scan`) y no solo que el índice existe.

## Invariantes que el gate debe intentar violar

Cada una es un test en `db/test-invariantes.mjs` que **falla si la BD acepta la
operación**:

1. `UPDATE` o `DELETE` sobre una entrega `cerrada` ⇒ RAISE.
2. `INSERT` de POD sin `foto_sha256` ⇒ rechazo.
3. POD con `lat/lng = (0,0)` ⇒ rechazo por rango Chile.
4. `UPDATE` de `correlativo_pedido` ⇒ RAISE (además de `REVOKE UPDATE`).
5. `SUM(gramos)` de una hornada > `masa_gramos` ⇒ rechazo.
6. `gramos_pesados > gramos_pedidos × 1,10` sin evento `ajuste.autorizado` ⇒ rechazo.
7. `gramos_entregados > gramos_pesados × 1,02` sin ese evento ⇒ rechazo.
8. Escritura de negocio sin sesión de operador viva ⇒ rechazo por trigger.
9. RUT que no cumple módulo 11 ⇒ rechazo.
10. `UPDATE`/`DELETE` sobre `eventos` (append-only) ⇒ rechazo.
