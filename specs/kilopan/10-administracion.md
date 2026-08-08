# 10 — Administración (personal, catálogo, parámetros)

Fuente: §3

Superficie de admin de los módulos 1 y 2: lo que el dueño necesita poder cambiar sin que
alguien entre a la BD por SQL. Sin esto, contratar a un repartidor o subir el precio de la
marraqueta exige un técnico — y la panadería deja de operar sola.

Todo lo de esta spec es **solo rol `admin`** (regla de rol testeada, §5).

## Criterios de aceptación

- [x] (P1) Dar de alta, desactivar, cambiar de rol o resetear el PIN de una persona desde
      la propia app (`/admin` + `POST/PATCH /api/usuarios`). Antes esto solo existía por
      SQL directo contra la BD [AC-ADM-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El endpoint estaba implementado
      (`exigirRol(["admin"])`, valida RUT/PIN/rol, candado de auto-desactivación), pero
      ningún test (unit, e2e o invariante) llamaba `POST`/`PATCH /api/usuarios`.
      — **Cerrado 08-ago-2026 (sesión supervisada):** `e2e/administracion-usuarios.spec.ts`
      (3 tests, verdes), mismo patrón que AC-ADM-02. Alta por HTTP con sesión admin real
      (RUT duplicado → 409; sin nombre, RUT con DV malo, rol inexistente o PIN corto →
      400). La edición se prueba por sus EFECTOS, no por el 200: la persona creada entra
      con su PIN por un equipo desechable enrolado en el propio test (nunca el de la
      semilla — el relevo atómico de AC-ID-06 desplazaría la sesión admin de `page`);
      desactivarla convierte su login en 401 y reactivarla lo devuelve; resetear el PIN
      deja el viejo en 401 y el nuevo entra al tiro; el cambio de rol queda visible en
      `?detalle=1`. El candado de auto-desactivación rebota 400 al admin que intenta
      quitarse su propio acceso (activo=false o bajarse de rol), y un vendedor rebota
      403 en POST y PATCH — decidido por el SERVIDOR.
- [x] (P1) Dar de alta pan nuevo y editar precios desde la app (`/admin` +
      `POST/PATCH /api/productos`), respetando la vigencia histórica de `precios`: cambiar
      un precio crea una fila nueva, jamás edita la vigente [AC-ADM-02]
      — **Cerrado 7-ago-2026:** el HUECO del Anexo D era de test, no de endpoint. El
      `POST`/`PATCH /api/productos` ya existía (`exigirRol(["admin"])`, alta con precio
      inicial en `pan.precios`, PATCH que activa/desactiva y versiona precio con
      `on conflict … vigente_desde`). Ahora dos tests lo ejercitan de verdad, con el mismo
      reparto de responsabilidades que AC-ADM-06: `e2e/administracion-productos.spec.ts`
      ataca el HTTP con sesión admin real (alta → dup 409, sin nombre/tipo/precio inválido
      → 400; PATCH deja el precio nuevo VIGENTE en `?detalle=1`, desactivar saca el
      producto de `/pesar` y reactivar lo devuelve, id inexistente → 404; vendedor rebota
      403 en POST y PATCH). La **afirmación central** —cambiar un precio inserta fila nueva
      sin pisar la vigente, y una fecha pasada sigue viendo su precio de época— vive en
      `db/test-invariantes.mjs` bajo `pan_app` con la MISMA sentencia SQL de la ruta,
      porque por HTTP el catálogo solo expone el precio vigente de hoy (no hay GET de
      historial). Dos ediciones el mismo día sí se pisan (mismo `vigente_desde`).
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
- [x] (P0) Corregir un cierre de turno desde `/arreglar`, con motivo escrito y su evento.
      El cierre original NO se sobrescribe: la corrección se registra encima y ambos quedan
      legibles, porque un arqueo que cambia sin dejar rastro es indistinguible de un
      faltante tapado [AC-ADM-06]
      — **Cerrado 3-ago-2026:** mismo patrón que `pan.entregas`/POD (0004): `pan.cierres_caja`
      gana `supersede_id` + `correccion_motivo` (`0023_corregir_cierre_turno.sql`), con CHECK
      `cierres_caja_correccion_exige_motivo` (motivo no vacío o nada), `trg_cierres_caja_inmutable`
      (ningún UPDATE/DELETE pasa nunca, ni siquiera del cierre original) e índice único
      `cierres_caja_una_correccion_por_original` (doble-tap sobre una misma corrección rebota).
      `cierres_caja_un_cierre_por_turno` (0018) se ajusta con `and supersede_id is null` para que
      la corrección conviva con el original que corrige sin chocar contra esa unicidad.
      `POST /api/cierre-caja/corregir` (solo admin, 403 al resto por HTTP; motivo en blanco → 400;
      cierre inexistente → 404) inserta la fila de corrección y su evento `cierre_caja_corregido`
      en la misma transacción. Probado de verdad: seis tests en `db/test-invariantes.mjs` bajo
      `pan_app` (inmutabilidad, motivo exigido por CHECK, doble-tap, evento con quién/cuándo/
      equipo, y que original+corrección conviven pese a la unicidad por turno) y
      `e2e/corregir-cierre-turno.spec.ts` (403 a vendedor, 400 sin motivo, 404 a id inexistente
      — no hay GET que exponga el id del cierre por HTTP, así que el camino feliz completo se
      prueba contra la BD real).
      — **Corregido en revisión de sesión supervisada (3-ago-2026):** el motor escribió esto
      completo (migración, endpoint, e2e, invariantes) pero nunca comiteó — quedó como trabajo
      sin publicar, preservado en la rama `motor/AC-ADM-06-sin-revisar`. Al revisarlo, uno de
      sus propios seis tests medía el mensaje equivocado: esperaba que editar `declarado_clp`
      o borrar la fila rebotaran con el texto del TRIGGER (`trg_cierres_caja_inmutable`), pero
      `pan_app` nunca tuvo `grant` para ninguno de los dos —`cierres_caja` solo concede
      `insert` (0003) y `update (turno_id)` (0018)— así que ambos rebotan por PERMISO, antes
      de que el trigger llegue a correr. El test medía "permission denied" contra un regex que
      esperaba "inmutable"/"jamás se borra" y fallaba. Corregido para probar lo que de verdad
      pasa: los dos caminos sin grant rebotan por permiso (la garantía más fuerte), y `turno_id`
      —el único con grant, y por eso el único que puede llegar al trigger— rebota por el
      trigger nuevo. Sin ese tercer caso el trigger podía ser código muerto sin que nadie se
      enterara. El esquema y el endpoint en sí no tenían defectos: se verificaron sin cambios.
- [x] (P1) Cerrar una ruta con odómetro desde `/arreglar`, con motivo escrito y su evento
      [AC-ADM-07]
      — **Cerrado 7-ago-2026:** `POST /api/rutas/cerrar` (solo admin, 403 al resto por HTTP)
      exige motivo no vacío (400 en blanco), rechaza un `rutaId` inexistente (404) y cierra
      con `select … for update` + `where estado <> 'cerrada'` para que el doble-tap sobre la
      MISMA ruta rebote 409 en vez de pisar el odómetro ya registrado; el evento
      `ruta_cerrada` (catálogo de AC-ADM-10) va en la misma transacción que el `update`. A
      diferencia de `PATCH /api/rutas` —que ya movía el estado a `cerrada` pero sin exigir
      motivo y sin que ninguna pantalla lo invocara así (Anexo C)— este endpoint es la vía
      real desde `/arreglar`: la tarjeta ya vivía en el índice de esa pantalla (AC-ADM-04),
      apuntando a este AC. Probado de verdad por HTTP con sesión admin real
      (`e2e/cerrar-ruta.spec.ts`): arma una ruta propia con `POST /api/pedidos` +
      `POST /api/rutas`, la cierra por HTTP, confirma en el GET admin que `estado`,
      `km_inicio` y `km_fin` quedaron guardados, y que un vendedor rebota 403 sin llegar a
      tocar la ruta.
- [ ] (P1) Revocar un equipo enrolado y desbloquear un PIN desde `/arreglar`, cada uno con
      motivo escrito y su evento [AC-ADM-08]
- [ ] (P1) Quitar un pedido de una ruta desde `/arreglar`, con motivo escrito y su evento
      [AC-ADM-09]
- [x] (P0) `pan.eventos` pasa a ser obligatoria en TODA operación de plata y de
      configuración —venta, anulación, apertura y cierre de turno, cambio de precio,
      reseteo de PIN, revocación de equipo, merma, anulación de DTE, cierre de ruta— con un
      test por operación. Hoy solo la escriben identidad y parámetros. La tabla ya es
      append-only por `revoke` [AC-ADM-10]
      — **Cerrado 4-ago-2026 (sesión supervisada).** `comun/evento.ts` fija el catálogo
      CERRADO de tipos y `registrarEvento()` los escribe; **9 operaciones cableadas en 9
      rutas**. El evento va SIEMPRE dentro de la misma transacción que la operación: si la
      venta entra y el evento no, la auditoría miente por omisión — y es el caso que menos
      se nota, porque nadie lo mira hasta el día en que hay que reconstruir qué pasó.
      El catálogo existe porque la tabla es append-only: un evento mal nombrado no se
      corrige después, se queda. Dos rutas escribiendo `venta_anulada` y `venta_anulacion`
      dejan una auditoría que no se puede consultar. Por eso `ventas/anular` y
      `cierre-caja/corregir`, que ya escribían su evento con SQL a mano, se migraron al
      helper — el SQL era correcto, el nombre suelto en un string no.
      **Dos tipos quedan declarados SIN ruta y no son deuda oculta:** `equipo_revocado`
      (`AC-ADM-08` abierto) y `dte_anulado` no tienen endpoint todavía, así que no hay
      dónde escribirlos; están en el catálogo para que quien construya esos ACs los
      encuentre y no invente otro nombre.
      Evidencia: `comun/evento.test.ts`, 14 casos. Prueba el helper de verdad (los seis
      valores y su ORDEN — un payload en la posición del usuario dejaría la auditoría
      diciendo que la venta la hizo un JSON), un caso por operación, y **el cierre de
      completitud**: si alguien agrega un `TipoEvento` al catálogo y no lo cablea ni lo
      declara sin ruta, el test se cae nombrándolo. Sin ese cierre, la lista se quedaría
      vieja en silencio — el mismo defecto que este AC vino a cerrar.
      **Nota de honestidad:** los casos por operación son textuales (verifican que la ruta
      llame a `registrarEvento` con su tipo), no ejercen el HTTP. Cubren el olvido, que es
      el modo de fallo real y el que el AC describe; no cubren que el evento sobreviva a un
      rollback. Eso último lo garantiza estar dentro de la transacción, que es una
      propiedad del código, no del test.
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
