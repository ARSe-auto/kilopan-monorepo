# 10 — Administración (personal, catálogo, parámetros)

Fuente: §3

Superficie de admin de los módulos 1 y 2: lo que el dueño necesita poder cambiar sin que
alguien entre a la BD por SQL. Sin esto, contratar a un repartidor o subir el precio de la
marraqueta exige un técnico — y la panadería deja de operar sola.

Todo lo de esta spec es **solo rol `admin`** (regla de rol testeada, §5).

## Criterios de aceptación

- [ ] (P1) Dar de alta, desactivar, cambiar de rol o resetear el PIN de una persona desde
      la propia app (`/admin` + `POST/PATCH /api/usuarios`). Antes esto solo existía por
      SQL directo contra la BD [AC-ADM-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El endpoint está implementado
      (`exigirRol(["admin"])`, valida RUT/PIN/rol, candado de auto-desactivación), pero
      ningún test (unit, e2e o invariante) llama `POST`/`PATCH /api/usuarios` — nadie lo
      ejercita de forma automatizada.
- [ ] (P1) Dar de alta pan nuevo y editar precios desde la app (`/admin` +
      `POST/PATCH /api/productos`), respetando la vigencia histórica de `precios`: cambiar
      un precio crea una fila nueva, jamás edita la vigente [AC-ADM-02]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Ningún test llama
      `POST`/`PATCH /api/productos`, y en particular ninguno verifica la afirmación
      central — que cambiar el precio crea fila nueva sin pisar la vigente.
- [ ] (P2) Edición de `pan.parametros` desde `/admin`: la pantalla lee y escribe
      `/api/parametros`, así que `clp_km_combustible`, `clp_km_ev` y `co2_g_km_evitado`
      se corrigen sin SQL [AC-ADM-03]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Cero referencias a `/api/parametros`
      en `*.test.ts`, `*.spec.ts` o `db/test-invariantes.mjs`.

## Ola 2 — «Marcha atrás»: que un error se pueda deshacer sin SQL

`docs/PROMPT_CORRECTIVO.md` §5. La causa raíz R1: hoy toda corrección de un error de
operación exige entrar a la base por SQL. Mientras eso sea así, la panadería no opera sola
y cada error queda o congelado o arreglado a mano por un técnico.

Regla transversal de esta sección: **toda acción destructiva se confirma escribiendo el
motivo, jamás marcando una casilla** — una casilla se marca sin leer; escribir el motivo
obliga a detenerse y deja el porqué en la auditoría. Y ninguna corrección pisa el dato
original: se registra encima (append-only), como ya hace el POD con `supersede_id`.

- [x] (P0) Pantalla `/arreglar`, **solo rol admin**: existe, lista sus seis acciones, y el
      SERVIDOR rechaza a quien no es admin con 403 — no basta con esconder el enlace, que
      es teatro de cliente (misma lección que `pesaje_foto_obligatoria`) [AC-ADM-04]
      — **Cerrado 3-ago-2026:** Server Component (`app/arreglar/page.tsx`) valida sesión y
      rol en el servidor; no-admin cae en `forbidden()` (`next.config.ts`:
      `experimental.authInterrupts`), nunca un 200 con la pantalla oculta. Repartidor y
      vendedor rebotan con 403 real por HTTP (`e2e/seguridad-arreglar.spec.ts`), admin ve
      las seis acciones. Cada acción cita su AC (AC-ADM-05..09): esta pantalla es su
      índice, las de detalle llegan con sus propios ACs.
- [x] (P0) Anular una venta desde `/arreglar`: exige un motivo escrito y no vacío, escribe
      su evento en `pan.eventos` con quién, cuándo y en qué equipo, y la venta anulada deja
      de sumar al arqueo de su turno [AC-ADM-05]
      — **Cerrado 2-ago-2026:** `POST /api/ventas/anular` (solo admin, 403 al resto por
      HTTP) marca `anulada_at`/`anulada_motivo` sin borrar la venta ni reescribir su monto
      (append-only) y escribe el evento `venta_anulada` con `usuario_id`, `dispositivo_id` y
      `at`, todo en una transacción; motivo en blanco → 400. `/api/cierre-caja` (GET y POST)
      suma solo `anulada_at is null`, así que la venta anulada sale del arqueo de su turno.
      Migración `0020_anular_venta.sql`: CHECK `ventas_anulada_exige_motivo` respalda la
      exigencia en la BD. Probado de verdad: `e2e/anular-venta.spec.ts` (anula por HTTP y el
      esperado del cierre baja exactamente lo anulado; doble-tap → 409; vendedor → 403) e
      invariante que verifica el CHECK, el evento con quién/cuándo/equipo y su inmutabilidad.
      — **Corregido en sesión supervisada (3-ago-2026), `0021`.** La `0020` la escribió el
      motor autónomo violando `docs/PROMPT_CORRECTIVO.md` §7; al revisarla a mano
      aparecieron dos huecos que este AC daba por cubiertos, ambos medidos corriendo las
      migraciones bajo `pan_app`, no leyendo el SQL:
      (1) **anular una venta fiada no bajaba la deuda del cliente** — `pan.saldo_cliente`
      (`0017`) nunca filtró `anulada_at`, así que el arqueo bajaba a 0 y el cliente seguía
      debiendo; la única forma de limpiarlo era marcarla `saldado_at`, o sea registrar en
      falso que pagó. (2) **la anulación era reversible** pese a que la `0020` se declara
      append-only: su `grant` column-level dejaba devolver `anulada_at` a NULL, reviviendo
      la venta y dejando un `venta_anulada` huérfano en `pan.eventos`. Se arregla con la
      vista reescrita y `trg_ventas_anulacion_inmutable` (mismo patrón que
      `trg_entregas_inmutable`, `0004`), con un invariante nuevo por hueco.
      — **Decisión, no olvido:** `pan.conciliacion_diaria` (`0005`) **sí** sigue contando
      los gramos de una venta anulada. El arqueo mide plata y la conciliación mide kilos
      físicos: en el caso dominante («se registró mal») el pan igual salió del local, y
      descontarlo inflaría la merma con pan que nadie perdió. Si algún día se anula
      mayoritariamente por devolución, se revisa acá.
- [ ] (P0) Corregir un cierre de turno desde `/arreglar`, con motivo escrito y su evento.
      El cierre original NO se sobrescribe: la corrección se registra encima y ambos quedan
      legibles, porque un arqueo que cambia sin dejar rastro es indistinguible de un
      faltante tapado [AC-ADM-06]
- [ ] (P1) Cerrar una ruta con odómetro desde `/arreglar`, con motivo escrito y su evento
      [AC-ADM-07]
- [ ] (P1) Revocar un equipo enrolado y desbloquear un PIN desde `/arreglar`, cada uno con
      motivo escrito y su evento [AC-ADM-08]
- [ ] (P1) Quitar un pedido de una ruta desde `/arreglar`, con motivo escrito y su evento
      [AC-ADM-09]
- [ ] (P0) `pan.eventos` pasa a ser obligatoria en TODA operación de plata y de
      configuración —venta, anulación, apertura y cierre de turno, cambio de precio,
      reseteo de PIN, revocación de equipo, merma, anulación de DTE, cierre de ruta— con un
      test por operación. Hoy solo la escriben identidad y parámetros. La tabla ya es
      append-only por `revoke` [AC-ADM-10]
      — **Nota de archivo (3-ago-2026):** por texto de `docs/PROMPT_CORRECTIVO.md` §3
      esto es alcance de Ola 3 ("eventos de auditoría en toda operación de plata"), no
      de Ola 2 — quedó filed acá por ser el prerrequisito de datos de la pantalla de
      auditoría (`AC-DASH-06`) y de la ola entera. No se movió de sección para no
      generar churn en un AC todavía sin construir; el motor lo elige por prioridad
      (P0), no por qué encabezado lo agrupa.
- [ ] (P0) Reparación de los datos que YA están mal contados en producción: el fiado de
      mesón que nunca sumó a ningún saldo y los arqueos firmados por quien no vendió. Se
      produce primero un informe que la dueña **lee y firma**; recién después se corrigen
      los datos. Los turnos sintéticos del respaldo quedan marcados como tales y declarados
      en el informe: no son turnos reales y nadie debe leerlos como tales. **La plata
      histórica no se reescribe en silencio** [AC-ADM-11]
      — **Sesión supervisada, no el motor** (`docs/PROMPT_CORRECTIVO.md` §7): toca datos
      reales con evidencia y necesita la firma de una persona. El motor debe saltarlo.

## Notas de implementación

- Desactivar una persona **nunca** la borra: `activo=false`. Los PODs y pesajes que firmó
  siguen siendo suyos y auditables (§4, los dispositivos tampoco se borran).
- Resetear un PIN debe invalidar la sesión viva de esa persona y quedar como evento
  auditable, igual que `pin_bloqueado` (`AC-SEC-01`).
- Cambiar el precio de un producto no puede alterar el `precio_clp` que ya quedó como
  snapshot en `pedido_lineas` ni en `venta_lineas`.
