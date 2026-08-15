# 01 — Identidad, roles y enrolamiento gobernado por el dueño

Fuente: §4.3 (identidad, enrolamiento y actores) · §5.4 (flujo de enrolamiento en la GUI)
· §7.8/§7.9 (Ley 21.719 y soporte sin god-mode) · §3.E1 ítems 2 y 15 (alcance E1) ·
transversales: §0 (constantes), §4.1 (contrato multi-tenant), §4.2 (regla de oro),
§4.7 (outbox), §5.3 (presupuesto de toques), §5.7 (estados y AA), §9.2–§9.3 (oráculos y
centinelas). Todas las citas resuelven contra `docs/PROMPT_MAESTRO_FLOTA.md`.

Módulo del hito §9.1(4)(b) «identidad/enrolamiento», tag `[security]` → Opus (§8).
Todo es Chile: RUT con dígito
verificador módulo 11, formato `12.345.678-5` (§0), es-CL en el 100% de los strings
visibles, Ley 21.719 desde E1 (§3.E1.15). Cero consideraciones fuera de Chile.

**Clase de las operaciones (§4.2):** todas las tablas y endpoints de este módulo son
PLANIFICACIÓN (validan online y rebotan 422 tipado) **excepto `firmas`**, que es
CAPTURA: la firma por PIN ocurre en terreno (custodia F2, POD F4) y JAMÁS rebota al
sincronizar — degrada a flag + evento + `review_queue`. La clasificación va en
`COMMENT ON TABLE`, exigida por el linter de migraciones (§4.2).

## Alcance E1 (lista cerrada, §3.E1.2 + §3.E1.15)

1. Invitación QR/link firmado por ROL, compartible por WhatsApp/SMS, con código corto
   fallback; multi-uso, expira 7 días, pausable y revocable en 1 toque (§0, §4.3, §5.4).
2. Solicitud→aprobación en 1 toque: la invitación da derecho a SOLICITAR, jamás a
   entrar; la aprobación del dueño empareja usuario+dispositivo+rol y RECIÉN AHÍ emite
   el secreto UNA vez contra la clave pública del aparato (§4.3).
3. Dispositivo enrolado personal (1 activo por operario) y dispositivo compartido de
   andén como activo del tenant con rotación por PIN (§4.3, §5.4).
4. Re-enrolamiento («Ya tengo cuenta», teléfono nuevo) como flujo de primera clase que
   revoca el anterior en el mismo acto (§4.3, §5.4).
5. Revocación soft con efecto inmediato server-side; capturas post-revocación entran
   igual con flags de severidad (§4.3, centinela 4 §9.3).
6. Roles enum FIJO de 6 valores (§0): `admin_tenant · operador · chofer ·
   responsable_carga · responsable_tecnico · cliente` — los packs verticales JAMÁS
   crean roles. Mapeo cerrado §4.3: dueño=`admin_tenant`, responsable de
   carga=`responsable_carga`, QF/calidad=`responsable_tecnico`, contratante=`cliente`
   con `empresa_cliente_id NOT NULL`.
7. PIN 4 dígitos argon2id, lockout 5 intentos POR USUARIO (jamás por dispositivo),
   backoff server-side (§0).
8. Soporte sin god-mode: grant del dueño con alcance y expiración 24 h|7 d, apagado
   por defecto, sin impersonación; break-glass con doble control (§4.3, §7.9).
9. Plano de control exclusivo del dueño (§5.4): gobierno completo de invitaciones,
   solicitudes, dispositivos, PIN, auditoría de accesos, grants y transferencia de
   propiedad con passkey/WebAuthn (única passkey del sistema).
10. Cumplimiento 21.719 sobre identidad: `personas` separada con ID opaco,
    anonimización sin tocar el ledger, RUT enmascarado en logs, export ARCO,
    tabla `retention_policy` (solo DDL aquí; plazos en Preguntas al dueño #8),
    base de licitud = ejecución de contrato (§3.E1.15, §7.8).

**FUERA de este módulo (explícito):** SSO (plan Empresa, no E1 — Anexo A); passkeys
para cualquier flujo distinto de transferir propiedad (§5.4: «única passkey del
sistema»); push como dependencia de cualquier paso (§7.6); emails en el enrolamiento
(§5.4: «CERO emails»); alta de vehículos en <2 min (vive en §5.4 pero es del módulo de
vehículos); pantalla «Funciones» (§5.5, módulo de panel admin); multi-idioma
(prohibido, §3 FUERA de E1); OCR de patente/padrón (módulo vehículos); **DPA en
términos del tenant** (§3.E1.15, §7.8) — módulo del panel admin white-label + wizard
(hito 9.1(4)(g), spec 08), donde ya tiene AC propio: **AC-FMIG-22**; **runbook de
brechas** (§7.8) — módulo 00/plano de control (documento operativo de plataforma),
donde ya tiene AC propio: **AC-FTEN-25**. El maestro exige DPA y runbook en E1 sin fijar
módulo dueño: la asignación es de esta spec y queda explícita aquí para que ninguno
quede huérfano entre specs.

## Modelo de datos (§4.3; todas las tablas con PK UUIDv7 de servidor, `tenant_id uuid NOT NULL` + `CHECK (tenant_id = (SELECT id FROM tenant_info))`, FKs compuestas `(tenant_id, id)` — §0, §4.1)

- **personas**(id, tenant_id, nombre, rut UNIQUE por tenant + CHECK módulo 11,
  contacto, anonimizada_en NULL) — separada de todo hecho operativo; los eventos
  referencian ID opaco; supresión 21.719 = anonimizar la fila sin tocar el ledger
  (§4.3, §7.8).
- **usuarios**(persona_id, rol enum FIJO, `empresa_cliente_id NOT NULL` cuando
  rol=`cliente` (CHECK), pin_hash argon2id, intentos_fallidos, bloqueado_hasta,
  activo) (§4.3). La matriz rol × ve-dinero × firma es contrato de este módulo:
  chofer y responsable_carga JAMÁS ven CLP (enforcement RLS en §4.8, centinela 10 —
  módulo de datos/dinero); cliente ve SOLO su liquidación vía vistas (módulo portal);
  firmas con significado según rol (aquí).
- **invitaciones**(rol, token_hash, expira_at +7 d, revocada_at, multi-uso) — dan
  derecho a SOLICITAR, jamás a entrar (§4.3). La capacidad «pausar» (§5.4) exige
  estado de pausa reanudable sin alterar `expira_at`; su representación exacta de
  columna la fija el build dentro de esta tabla.
- **solicitudes_acceso**(persona propuesta, dispositivo huella pública, estado
  pendiente→aprobada|rechazada) — la aprobación (1 toque) empareja
  usuario+dispositivo+rol y emite el secreto contra la clave pública (§4.3).
- **dispositivos**(tipo personal|anden, secreto_hash emitido UNA vez,
  storage_persisted bool, is_standalone bool, enrolado_por, revocado_at soft) —
  el enrolamiento NO se completa sin display-mode standalone Y persist() concedido
  (§4.3, corrección del adversario). 1 dispositivo personal activo por operario
  (índice UNIQUE parcial `WHERE tipo='personal' AND revocado_at IS NULL`).
- **firmas** append-only (persona, dispositivo, objeto_ref, significado enum
  {recibio_conforme, libero, rechazo, verifico, aprobo}, ts_servidor) — REVOKE
  UPDATE/DELETE + trigger (§7.4); la firma puntual por PIN en dispositivo ajeno NO
  abre sesión ni desplaza la del propio (§4.3, centinela 12).
- **grants_soporte**(otorgado_por dueño, alcance solo-lectura|módulos, expira
  24h|7d) — el registro vive en la BD `control` (§4.1: el plano de control guarda los
  grants de soporte); el begin/end de cada acceso queda en la auditoría VISIBLE del
  tenant (§4.3), es decir espejado en el `audit_trail` de la BD del tenant.
- **retention_policy** (§3.E1.15): el maestro crea la tabla en E1 sin fijar columnas
  ni plazos; el DDL nace aquí (este módulo es el dueño del cumplimiento 21.719 de
  identidad) cubriendo al menos los registros de este módulo (invitaciones vencidas,
  solicitudes rechazadas, dispositivos revocados, grants expirados). Los plazos son
  Preguntas al dueño #8: la tabla se crea, ninguna purga se activa sin esos valores
  (y jamás sobre append-only, §7.4).
- Mutaciones idempotentes con `client_uuid` UUIDv7 + `UNIQUE(tenant_id, client_uuid)`
  + `ON CONFLICT DO NOTHING` donde aplique sync offline (firmas) (§0).
- Toda acción de gobierno escribe `audit_trail` por trigger + evento append-only
  (§3.E1.14, §4.6); la bitácora de accesos del admin (§3.E1.15) se alimenta de ahí.

## Flujos de GUI (§5.4; pantallas con los 4 estados obligatorios, targets §0, teclado numérico propio, es-CL — §5.7)

- **F-A Emitir invitación (dueño, ≤4 toques):** elegir rol → se genera QR + link
  firmado + código corto fallback → compartir por WhatsApp/SMS. Emisión, pausa y
  revocación en el panel del dueño.
- **F-B Solicitar acceso (trabajador, ~90 s, CERO emails):** abre link/QR → RUT
  auto-formateado `12.345.678-5` (validación módulo 11 en cliente Y servidor; RUT
  inválido rebota 422 — PLANIFICACIÓN §4.2) → nombre → PIN ×2 con teclado propio
  (teclas ≥64 px) → «Solicitar acceso» → pantalla «Esperando aprobación» + guía A2HS
  obligatoria: el enrolamiento no se completa sin standalone + persist() (§5.4).
- **F-C Aprobar (dueño, 1 toque):** empareja usuario+dispositivo+rol, emite el
  secreto cifrado contra la clave pública del aparato, la sesión del trabajador
  arranca sola. Total del ciclo <5 min (§5.4). Las capturas del outbox quedan
  firmadas por el enrolamiento (§4.7).
- **F-D Andén (dispositivo compartido):** el admin lo enrola como activo del tenant
  (sin persona dueña); los operarios rotan por PIN; lockout POR USUARIO — el bloqueo
  de uno jamás bloquea el aparato (§0, §5.4). Al autenticarse otra identidad se purga
  SOLO el snapshot; el outbox del usuario anterior persiste y se replayea (§4.7,
  centinela 9).
- **F-E Teléfono nuevo («Ya tengo cuenta»):** RUT+PIN → solicitar enrolamiento →
  aprobación del dueño revoca el dispositivo anterior en el mismo acto (§5.4).
- **F-F Revocar (dueño, 1 toque):** efecto inmediato server-side. Capturas offline
  del dispositivo revocado: ≤72 h ⇒ cuarentena con flag `post_revocacion`; >72 h ⇒
  flag `post_revocacion_tardia` + review_queue severidad alta + evento. La distinción
  es SOLO severidad de revisión — jamás se descartan ni rebotan (§4.3, centinela 4).
- **F-G Grant de soporte (dueño):** otorgar con alcance y expiración 24 h|7 d;
  expiración automática; revocable; begin/end visibles en la auditoría del tenant
  (§4.3, §7.9).
- **F-H Transferir propiedad (dueño):** exige passkey/WebAuthn del admin — única
  passkey del sistema (§5.4).

## Plano de control exclusivo del dueño (`admin_tenant`, §5.4)

Emitir/pausar/revocar invitaciones · aprobar/rechazar cada acceso y cada dispositivo ·
inventario vivo de dispositivos · revocar en 1 toque · rotar PIN/desbloquear ·
auditoría de accesos (incluidas sesiones de soporte) · otorgar/revocar grant de
soporte · transferir propiedad. El gobierno de VEHÍCULOS solo-dueño (§5.4, centinela
15) usa este mismo RBAC pero sus endpoints y tests viven en el módulo de vehículos.
Regla HTTP (§0): acción de gobierno con rol distinto de `admin_tenant` ⇒ 403 y 0
filas; recurso de identidad de OTRO tenant ⇒ 404 siempre (centinela 2).

## Seguridad, sesiones y 21.719 (§7)

- Lo que el maestro fija de sesiones: arranque automático post-aprobación (§5.4);
  la firma por PIN en dispositivo ajeno no abre ni desplaza sesión (§4.3); rotación
  por PIN en andén (§5.4); lockout 5 por usuario con backoff (§0). Duración y
  re-autenticación las fijó Alexis el 09-ago-2026 (pregunta 1, absorbida en `SESION` del
  canónico §0): sesión PERSONAL sin caducidad mientras el dispositivo siga enrolado y sin
  revocar —cero PIN al abrir la PWA—, y ANDÉN con cierre por inactividad a los 3 minutos.
- `set_config('app.current_role', …, true)` por transacción (SET LOCAL siempre, §4.1)
  se alimenta del rol de la sesión que este módulo establece; las políticas RLS de rol
  (§4.8) las implementa el módulo de datos/dinero.
- 21.719 (§7.8): identificadores solo en `personas` con ID opaco DESDE LOS HECHOS
  (§7.8; las columnas rut/contacto de `empresas_cliente` §4.5 son de la persona
  jurídica contratante y las MANDA el maestro); PIN jamás en logs; RUT enmascarado en
  logs (scan de logs del gate: §9.2); base de licitud = ejecución de contrato — JAMÁS
  checkbox de consentimiento a trabajadores; cero datos personales reales en seeds
  (RUTs sintácticamente válidos pero irreales; mecánica en AC-FIDN-21); secreto de
  dispositivo jamás en logs — extensión derivada de §4.3 (el secreto se emite UNA vez
  y en BD queda solo `secreto_hash`), no requisito literal del maestro.
- Soporte (§7.9): cero visibilidad por defecto; sin endpoint de impersonación;
  break-glass = doble control + notificación forzosa + registro inmutable.

## Criterios de aceptación

- [x] (P1) Esquema §4.3 completo en `tenant_template`: personas (rut UNIQUE por tenant
      + CHECK módulo 11, anonimizada_en), usuarios (rol enum FIJO de 6 valores; CHECK
      `empresa_cliente_id NOT NULL` si rol=`cliente`; pin_hash argon2id), invitaciones,
      solicitudes_acceso, dispositivos (is_standalone, storage_persisted, revocado_at
      soft; UNIQUE parcial 1 personal activo por operario), firmas append-only (REVOKE
      UPDATE/DELETE + trigger; UPDATE/DELETE como rol de app ⇒ 42501, centinela 6),
      retention_policy (§3.E1.15 — solo DDL; plazos pendientes de Preguntas al dueño
      #8, ninguna purga activa sin esos valores). Todas con PK UUIDv7 de servidor, tenant_id + CHECK contra `tenant_info`, FK
      compuesta, índice y `COMMENT ON TABLE` PLANIFICACIÓN (CAPTURA solo `firmas`);
      linter de esquema y pgTAP verdes (§0, §4.1, §4.2). Evidencia:
      `db/migraciones-flota/tenant/0011_identidad_y_enrolamiento.sql`, con el linter de
      AC-FTEN-06 en verde sobre sus 7 tablas, 33 pruebas pgTAP en
      `db/flota/pgtap/0008_identidad_y_enrolamiento.sql` y 11 contra el cluster real con el
      rol `app_t_<slug>` en `db/flota/suite-bd/identidad.test.mjs`. El reparto no es
      cosmético: al catálogo —enums con sus valores exactos, el predicado del índice parcial,
      los CHECK por nombre, la clase de cada COMMENT— se le pregunta desde DENTRO de la base,
      que es lo único que no puede quedar desfasado de la base; el append-only y el
      aislamiento se prueban con el rol de app REAL, porque pgTAP corre como superusuario y a
      un superusuario un REVOKE no le aplica nunca — probarlo ahí sería un verde que no
      ejerció ninguna de las dos capas del §7.4. **El RUT se valida por módulo 11 en la BD**
      (`rut_valido(text)` IMMUTABLE) y no solo en el formulario: la app valida AL ESCRIBIR
      (§4.3) para que la persona lo vea antes de enviar, pero un RUT inválido que llega por un
      script, una carga masiva o un endpoint futuro es igual de inválido y la BD es la
      autoridad sobre las reglas de negocio. Se exige el formato canónico EXACTO del §0
      (`12.345.678-5`): aceptar además la forma pelada guardaría dos representaciones de la
      misma persona y `UNIQUE (tenant_id, rut)` dejaría de significar «una persona». DECISIONES
      DECLARADAS: (a) la anonimización de la 21.719 es un CHECK de todo-o-nada —una fila con
      `anonimizada_en` que conserva el RUT no está anonimizada, es una fila con una fecha
      puesta; y una persona viva sin RUT ni nombre no se puede volver a identificar—, y al
      anonimizar el RUT vuelve a quedar disponible porque el UNIQUE no queda tomado por una
      fila sin identificadores; (b) la pausa de la invitación es un `pausada_at` nullable y no
      un enum de estado, porque el §5.4 pide que reanudar NO altere `expira_at` y una marca de
      tiempo es exactamente eso —con un enum habría que decidir qué pasa al reanudar una
      vencida, y la respuesta ya está: vence igual, porque la pausa nunca movió la fecha—;
      (c) `invitaciones.expira_at` NO lleva DEFAULT con el plazo horneado: el número es del
      canónico §0 (`INVITACION.expira_dias`) y escribirlo también en el DDL sería la segunda
      copia de una cifra canónica, que es lo que el gate de constantes existe para impedir;
      (d) el índice de «un personal activo por operario» es PARCIAL (`WHERE tipo='personal' AND
      revocado_at IS NULL`) y su predicado se verifica, no solo su existencia: uno total
      pasaría un `has_index` y bloquearía el teléfono nuevo (F-E), que es un flujo de primera
      clase y no una excepción; (e) `retention_policy` nace vacía y con la purga apagada POR
      CONSTRUCCIÓN —un CHECK, no una promesa: una política activa sin plazo no se puede ni
      insertar—, y su lista de registros purgables es cerrada y excluye lo append-only, porque
      del ledger no se purga nada (§7.4). ALCANCE DECLARADO, no olvido:
      `usuarios.empresa_cliente_id` lleva el CHECK del §4.3 pero **no** su FK, porque
      `empresas_cliente` nace en el módulo de encargos; la FK compuesta se agrega en la
      migración de ese módulo, que es cuando existe la tabla a la que apuntar. El enum
      `rol_usuario` se compara valor a valor contra `ROLES` de `packages/nucleo-comun/src/constants.ts`
      desde la suite de node —dos listas iguales escritas en dos lenguajes se separan el día
      que alguien toca una sola— y en la BD es un TIPO y no una tabla de catálogo, para que
      agregar un rol sea una migración visible y no un INSERT de madrugada — oráculo: CI
      [AC-FIDN-01]
- [x] (P1) e2e del flujo feliz §5.4 contando ACCIONES (convención §5.3): dueño emite
      invitación por rol en ≤4 toques (QR + link firmado + código corto fallback);
      trabajador completa RUT auto-formateado `12.345.678-5` + nombre + PIN ×2 con
      teclado numérico PROPIO (jamás el del sistema) + «Solicitar acceso» sin campo de
      email; pantalla «Esperando aprobación» con guía A2HS; dueño aprueba en 1 toque y
      la sesión arranca sola. Selectores solo por data-testid/term_key; axe/targets §0
      verdes; cero strings en inglés. Evidencia: la pantalla del dueño
      `apps/flota/src/app/panel/page.tsx`, el codificador de QR propio
      `packages/nucleo-comun/src/qr.ts` con 12 mutantes, `POST /api/sobre`, el store de sesión
      y la apertura del sobre en `apps/flota/src/cliente/aparato.ts`, y 2 pruebas de navegador
      en `apps/flota/e2e/enrolamiento.spec.ts`. **MEDIDO: F-A en 3 acciones (presupuesto 4),
      F-B en 5 —una por paso del formulario— y F-C en 1. La sesión del trabajador arranca con
      CERO acciones suyas.**
      **EL PRESUPUESTO SE CUENTA, NO SE PROMETE.** Un contador envuelve cada toque que el test
      le pide a la pantalla, así que agregar un paso al flujo sube el número solo — con un
      número escrito a mano, el día que alguien meta una confirmación de más el test seguiría
      diciendo lo de antes. Y los toques del TECLADO PROPIO no entran al presupuesto: los
      dígitos de un RUT o de un PIN son el dato, no decisiones; contarlos convertiría un RUT
      largo en un rebote de diseño.
      **DÓNDE SE FUERON LOS TOQUES DE F-A.** «Invitar» (1) → el rol, que EMITE en ese mismo
      toque (2) → «Compartir» (3). El paso de confirmación intermedio se sacó a propósito: una
      invitación de más se revoca en 1 toque, así que confirmar protege menos de lo que cuesta.
      Y aprobar es 1 acción porque el rol NO se elige al aprobar —sale de la invitación
      (AC-FIDN-04)—: elegirlo ahí convertiría un toque en una decisión de permisos tomada sin
      mirar.
      **EL QR SE ESCRIBIÓ, NO SE INSTALÓ.** Decisión de Alexis (09-ago-2026) ante la
      alternativa de agregar una dependencia: el QR vive en la pantalla del módulo que guarda
      RUTs y PINs, y una librería de terceros ahí es superficie de cadena de suministro y peso
      en el bundle que un teléfono baja con la señal de un galpón, a cambio de un algoritmo
      cerrado desde 2006. Alcance declarado: modo byte, nivel M, versiones 1 a 6 — un texto que
      no entra REBOTA con el máximo en el mensaje, porque un QR truncado escanea igual y lleva
      a otro lado. **CÓMO SE VERIFICA ALGO QUE NO SE PUEDE LEER A OJO**, que fue el problema de
      fondo: un QR mal codificado se ve idéntico a uno bueno, y comparar contra una matriz
      escrita de memoria probaría la memoria de quien la escribió. Los 12 mutantes no llevan un
      solo vector recordado: verifican PROPIEDADES —que el mensaje sea divisible por el
      generador de Reed-Solomon (la definición del código), que α^255 vuelva a 1 en GF(256),
      que los 32 formatos conserven la distancia de Hamming ≥ 7 del BCH(15,5), y que el zigzag
      sea una permutación—. Lo único que ninguna propiedad puede probar son las tablas de
      bloques por versión, que son datos de la norma: se validaron contra un decodificador
      INDEPENDIENTE, el del sistema operativo, codificando y volviendo a leer —14 casos,
      versiones 1 a 6, leídos idénticos— con
      `packages/nucleo-comun/scripts/verificar-qr.mjs`, que NO está en el gate porque necesita
      macOS y un paso que solo corre en una máquina en otra queda saltado.
      **«LA SESIÓN ARRANCA SOLA» ES LITERAL Y EL §7.6 LA HACE ASÍ.** Nada puede depender de
      push, así que el aparato PREGUNTA: la pantalla de espera consulta `/api/sobre` hasta que
      hay algo, lo abre con la privada no extraíble que guardó al solicitar, y guarda el
      secreto. El e2e lo prueba con DOS contextos de navegador —dos teléfonos de verdad—, y
      comprueba que el secreto abierto es EL que la aprobación emitió comparando su hash contra
      la fila del aparato: sin eso, «arrancó sola» podría ser una pantalla que cambia de estado
      sola. El sobre se retira por CLAVE PÚBLICA y no por id de solicitud, porque ese id no se
      le devuelve al aparato a propósito (AC-FIDN-03) — y lo que se lleva quien intercepte la
      clave pública es un sobre que solo abre la privada del teléfono de la persona.
      **HALLAZGO DEL CAMINO:** volver de «Compartir» al panel no recargaba la lista, y entre
      compartir el link y volver a mirar pasa JUSTO el rato en que la persona completa sus
      datos — el dueño veía «no hay nadie esperando» con alguien esperando. Lo destapó el e2e
      del flujo completo, que es el único que recorre los dos teléfonos en orden — oráculo: CI
      [AC-FIDN-02]
- [x] (P1) La invitación da derecho a SOLICITAR, jamás a entrar: token válido nunca
      abre sesión ni emite secreto, solo crea solicitud `pendiente`. Multi-uso: N
      solicitudes del mismo token ⇒ N filas. Rebotes 422 tipados (PLANIFICACIÓN §4.2):
      token expirado (>7 días), pausado o revocado. Pausar/reanudar no altera
      `expira_at`; revocar en 1 toque tiene efecto inmediato y NO afecta a usuarios ya
      aprobados por ese token. Entrada por código corto fallback (§5.4): una solicitud
      iniciada DIGITANDO el código —sin abrir link ni escanear QR— llega a «Esperando
      aprobación» igual que por link/QR; el código es de 8 caracteres en el alfabeto sin
      ambiguos que fija `INVITACION` del canónico §0 (respuesta del dueño del 09-ago-2026 a la
      pregunta 5), y el test lo asierta contra la constante y no contra el número. La
      invitación se comparte SOLO desde el teléfono del dueño con el share-sheet del sistema:
      no hay pasarela de SMS ni de WhatsApp que testear ni que caerse. CASO DE REBOTE que
      cierra la pregunta 10, respondida el 09-ago-2026: una solicitud NUEVA con un RUT que ya
      está registrado en el tenant **ENTRA** —queda `pendiente` como cualquier otra— y el 422
      sale recién al aprobar (AC-FIDN-04); el test lo prueba en los dos tiempos: la solicitud
      responde 2xx y crea su fila, y ninguna respuesta del endpoint de solicitud permite
      distinguir un RUT registrado de uno que no lo está —ni por código, ni por cuerpo, ni por
      latencia declarada—, porque quien tiene el link no está autenticado y el link viaja por
      WhatsApp (§0, §4.3, §5.4). Evidencia: `apps/flota/src/dominio/invitaciones.ts` con 13
      mutantes en su `.test.ts`, el endpoint público `POST /api/solicitudes` y 8 pruebas HTTP
      contra el servidor y la base de verdad en `apps/flota/e2e/invitaciones.spec.ts`.
      DECISIÓN DECLARADA — **una credencial en TRES envoltorios**: el §5.4 pide QR, link
      firmado y código corto de respaldo, y la salida cómoda era tres secretos distintos, o
      sea tres cosas que revocar, tres que expirar y tres que se desincronizan. Acá el código
      corto ES la credencial: el link lo lleva como parámetro y el QR codifica el link. Lo
      «firmado» lo da el propio código —8 caracteres del alfabeto del §0, del orden de 10^12
      combinaciones, del que en la BD queda solo su SHA-256— así que nadie puede fabricar uno
      válido ni leerlo de la base: exactamente lo que daría una firma, con una sola cosa que
      revocar. El generador usa `randomInt` y no un módulo sobre bytes, porque 31 no divide a
      256 y el sesgo le regala entropía a quien adivina; hay un mutante que verifica que el
      alfabeto se use ENTERO, porque un borde corrido deja un carácter inalcanzable y los
      códigos siguen pareciendo códigos. Al normalizar se aceptan minúsculas, espacios y
      guiones —el código se dicta en un galpón y se teclea con guantes— pero NO se «corrige»
      un carácter ambiguo mapeando O→0: el alfabeto ya los excluye, así que una O no es un
      cero mal escrito sino un carácter que no existe en ningún código emitido, y aceptarlo
      abriría códigos que nadie emitió. El módulo 11 tiene UNA implementación y vive en la BD
      (AC-FIDN-01): el endpoint TRADUCE su rebote al 422 tipado en vez de repetir el algoritmo
      y que los dos se separen. ALCANCE DECLARADO, no olvido: emitir, pausar y revocar desde
      el panel exigen sesión de `admin_tenant`, que nace con AC-FIDN-04 — las tres operaciones
      existen como funciones de dominio con sus mutantes (incluida la consecuencia que el
      §5.4 pide de frente: pausada el día 6 y reanudada el día 9 está vencida, porque el plazo
      acota la VENTANA y no cuenta tiempo de uso), y su presupuesto de toques es de
      AC-FIDN-02. La ruta nueva puso a trabajar el arnés de AC-FTEN-26 en serio: el manifiesto
      frenó el build hasta que se declaró su caso de cruce, y al ser la primera ruta MUTANTE
      encendió el comparador de huella de la BD de B — con su límite escrito en el manifiesto,
      porque el caso autogenerado no lleva payload y por eso el cruce CON datos válidos lo
      prueba la suite de este módulo — oráculo: CI [AC-FIDN-03]
- [x] (P1) La aprobación (1 toque) empareja persona+dispositivo+rol y RECIÉN AHÍ emite
      el secreto UNA vez contra la clave pública registrada en la solicitud: en BD
      queda solo `secreto_hash`; una segunda petición de emisión para el mismo
      dispositivo rebota y no re-emite; el rechazo deja `rechazada` y no emite nada;
      aprobación de rol `cliente` sin `empresa_cliente_id` rebota 422 (§4.3). Y el rebote
      que la pregunta 10 trasladó hasta acá (respondida el 09-ago-2026): aprobar una solicitud
      cuyo RUT ya pertenece a una persona del tenant ⇒ 422 tipado y 0 filas nuevas, con la
      colisión IDENTIFICADA en la respuesta —quién es el titular actual— para que el dueño
      decida en 1 toque si es la misma persona con teléfono nuevo (F-E) o un homónimo; acá sí
      se puede nombrar, porque quien aprueba es el `admin_tenant` y ya conoce su nómina.
      Evidencia: `apps/flota/src/dominio/secretos.ts` con 9 mutantes, la transacción en
      `apps/flota/src/servidor/aprobacion.ts` con 7 pruebas contra el cluster real en
      `apps/flota/e2e/aprobacion.spec.ts`, y la migración
      `db/migraciones-flota/tenant/0012_sobre_de_emision.sql`. **EL SOBRE SELLADO**, que es la
      decisión de fondo: el dueño aprueba desde SU teléfono y el trabajador espera en el suyo,
      así que el secreto tiene que cruzar sin que exista un instante en que el servidor —o
      quien mire una respuesta, un log o una fila— lo pueda leer. Se sella contra la clave
      pública que el aparato registró al solicitar, con par efímero + ECDH P-256 +
      HKDF-SHA256 + AES-256-GCM; el servidor tira su privada efímera al sellar, así que ni él
      puede reabrirlo. P-256 y no RSA por una razón de terreno: el par lo genera la PWA en el
      teléfono del trabajador y un RSA-2048 en un Android de galpón se come segundos que el
      flujo de 90 s del §5.4 no tiene. Todo con `crypto.subtle`, la MISMA API del navegador,
      de modo que el test abre el sobre con el código exacto que va a correr en el teléfono y
      con la privada NO EXTRAÍBLE — «nunca salió del aparato» es una propiedad del navegador
      verificada, no una promesa. Los mutantes cubren lo que importa: que otro aparato NO
      abra, que el secreto no viaje a la vista ni en base64, que dos sobres del mismo secreto
      difieran en sal, nonce y clave efímera (reusar el nonce de AES-GCM rompe el cifrado, no
      es estética), y que tocar un byte lo invalide entero. DECISIONES DECLARADAS: (a) el
      sobre se GUARDA en la solicitud —columna nueva— porque el §7.6 prohíbe depender de push
      y el aparato pregunta; no contradice «en BD queda solo `secreto_hash`», porque lo
      guardado es opaco sin la privada del teléfono y la credencial sigue viviendo como hash
      en `dispositivos`; (b) es de UN SOLO USO, con un CHECK que hace imposible «hay sobre y
      además dice que se retiró»: un sobre retirable dos veces es un secreto que viaja dos
      veces, la segunda por un canal que ya nadie mira; (c) el rol sale de la INVITACIÓN y no
      de quien aprueba — dejarlo elegir al aprobar convertiría un toque en una decisión de
      permisos tomada sin mirar; (d) `for update` sobre la solicitud es lo que hace cierto el
      «UNA vez» ante dos toques simultáneos. HALLAZGO DEL CAMINO: el retiro usaba
      `RETURNING sobre`, que devuelve el valor NUEVO —el null que el propio UPDATE acaba de
      escribir—, así que borraba el sobre sin entregarlo y el trabajador habría quedado
      esperando una sesión que nunca iba a arrancar; se corrigió con `RETURNING OLD`, de
      PostgreSQL 18, que el §0 ya exige por `uuidv7()`. ALCANCE DECLARADO: los endpoints HTTP
      de aprobar, rechazar y retirar exigen sesión de `admin_tenant` y la pantalla
      «Esperando aprobación» que consulta; ambos son de AC-FIDN-02 con su presupuesto de
      toques. Acá está el acto completo, probado contra la base y contra un aparato con claves
      de verdad — oráculo: CI [AC-FIDN-04]
- [x] (P1) El enrolamiento NO se completa sin display-mode standalone Y persist()
      concedido: con cualquiera de los dos ausente el dispositivo no queda operable y
      la UI lo dice (degradación visible, no silencio); `persist_denegado` se registra
      en `client_metric`; al concederse ambos, el dispositivo queda activo con
      `is_standalone=true` y `storage_persisted=true` (§4.3, §5.4, §4.6). Evidencia:
      `db/migraciones-flota/tenant/0015_entorno_del_aparato.sql`,
      `apps/flota/src/cliente/entorno.ts`, `apps/flota/src/servidor/entorno.ts`, la ruta
      `POST /api/entorno`, la guía A2HS de «Esperando aprobación» y 3 pruebas de navegador en
      `apps/flota/e2e/entorno.spec.ts`.
      **DÓNDE VIVE EL ENTORNO, que es la decisión de fondo.** El aparato existe recién cuando el
      dueño aprueba (AC-FIDN-04), y las dos condiciones se cumplen ANTES: es mientras la persona
      mira «Esperando aprobación» cuando sigue la guía A2HS y agrega la app a su pantalla de
      inicio. Por eso el entorno se declara sobre la SOLICITUD y de ahí viaja al aparato en la
      misma aprobación. Guardarlo solo en `dispositivos` dejaría al dueño aprobando a ciegas
      —sin saber si lo que habilita sirve para trabajar— y la comprobación ocurriría después de
      emitido el secreto, que es tarde. Y se puede REDECLARAR mientras la solicitud está
      pendiente: una sola foto al momento de solicitar dejaría en `false` a todo el que hizo las
      cosas bien treinta segundos después.
      **EL APARATO INCOMPLETO TIENE SESIÓN, y eso ES la degradación visible.** Negarle la sesión
      sería el silencio que este AC prohíbe con esas palabras: no habría ninguna pantalla donde
      decirle qué le queda pendiente. `GET /api/sesion` reporta `enrolamiento_completo: false`,
      con las dos condiciones por separado, y la pantalla dice qué le queda, qué hacer y POR QUÉ
      importa — en palabras y no en un ícono (§5.7). ALCANCE DECLARADO: el rechazo de la CAPTURA
      de un aparato no operable lo exigen los endpoints de sync del módulo 04 (hito e), que es
      donde nacen; acá está la condición y su visibilidad.
      **`persist()` SE PIDE, NO SE CONSULTA**, y esa distinción decide el AC: en los navegadores
      que lo implementan la concesión depende de que la app la solicite, así que un
      `persisted()` a secas devuelve `false` en un aparato que jamás preguntó — y la pantalla
      mostraría «denegado» sin que nadie hubiera negado nada. Lo mismo con standalone: se lee de
      `matchMedia` de ESTA ventana y no de «la app está instalada», porque alguien puede tenerla
      instalada y estar mirándola en una pestaña —donde el navegador sí la puede cerrar—; y se
      mira además `navigator.standalone`, que es la vía de iOS, sin lo cual media flota quedaría
      en rojo haciendo todo bien.
      **LA MÉTRICA ES IDEMPOTENTE POR `client_uuid`**, uno por intento de enrolamiento y no uno
      por chequeo: el operario vuelve a tocar «Revisar» hasta que el navegador conceda, y una
      métrica por reintento convertiría «cuántos aparatos no consiguen persistencia» —la
      pregunta que dice si la flota está a un vaciado de caché de perder trabajo— en «cuántas
      veces alguien insistió». El test lo verifica reintentando. **Y un `false` por omisión no
      se confunde con una medición**: `entorno_visto_en` distingue «nunca reportó» de «reportó
      que no», y un CHECK impide la tercera lectura que dejaría a las dos anteriores idénticas.
      **CÓMO SE PRUEBA ALGO QUE DEPENDE DEL NAVEGADOR:** ni el display-mode ni la concesión se
      pueden forzar desde un test, así que se sustituyen las DOS respuestas del navegador y se
      verifica qué hace NUESTRO código con cada una. Que Chrome conteste la verdad no es algo
      que nos toque verificar.
      **HALLAZGO DEL CAMINO, y estaba latente:** la guardia anti-vacuidad de `gate-pii.test.mjs`
      comparaba contra `/0 migraciones/` sin anclar, y esa expresión también casa con «20
      migraciones» — se rompió sola, con el gate sano, el día que el repo llegó a la vigésima
      migración, que fue esta. Quedó anclada al separador. Una guardia que falla por contar bien
      es peor que no tenerla: enseña a ignorarla — oráculo: CI [AC-FIDN-05]
- [x] (P1) PIN de 4 dígitos hasheado argon2id server-side; 5 intentos fallidos bloquean
      AL USUARIO (`bloqueado_hasta` server-side), jamás al dispositivo: en el andén,
      con el usuario A bloqueado, el usuario B entra con su PIN sin fricción; el
      desbloqueo/rotación por el dueño reabre el acceso y queda en audit_trail. El
      lockout a los 5 intentos es mecánico desde ya, y el backoff se asierta contra la curva
      que fijó Alexis el 09-ago-2026 (pregunta 9, absorbida en `PIN` del canónico §0): la
      espera se duplica desde medio minuto y se topa en un cuarto de hora, y un PIN correcto
      resetea el contador. Bloqueos sucesivos ⇒ `bloqueado_hasta` creciente según esa curva,
      y el test lee la constante en vez de repetir los números. El tope se prueba: la enésima
      racha NO produce una espera mayor al tope, porque el bloqueo es por usuario pero el que
      espera es el turno. Scan de
      logs del gate (§9.2): cero PIN en cualquier forma, cero RUT sin máscara; cero
      secreto de dispositivo en logs — extensión derivada de §4.3 (en BD queda solo
      `secreto_hash`), no requisito literal del maestro (§0, §5.4, §7.8, §9.2). Evidencia:
      `apps/flota/src/dominio/pin.ts` con 10 mutantes puros, `apps/flota/src/servidor/pin.ts`
      con 8 pruebas contra el cluster real en `apps/flota/e2e/pin.spec.ts`, y el scan de logs
      en `db/flota/gate-logs.mjs` con 8 mutantes, enganchado a `db/flota/gate.sh`. Reparto:
      la CURVA y el conteo se prueban puros —sin cluster, sin reloj real y sin esperar un
      cuarto de hora para ver el tope—, y contra la base se prueba lo que eso no puede dar:
      que el estado sobreviva en la fila, que argon2id verifique de verdad y que en el andén
      el bloqueo de un operario NO le cierre el aparato al siguiente, con DOS operarios sobre
      el mismo aparato porque con uno solo eso sería cierto por no haber a quién bloquear.
      DECISIONES DECLARADAS: (a) **la racha se cuenta sin agregarle una columna a la tabla** —
      `intentos_fallidos` no se reinicia al bloquear, así que el bloqueo cae en cada múltiplo
      del umbral y el número de bloqueo sale de ahí; (b) **durante el bloqueo el intento no se
      cuenta ni se verifica el hash**: contarlo dejaría que quien ya no puede entrar siga
      empujando la espera del legítimo hacia el tope —castigar al bloqueado por intentar es
      castigar al operario que se confundió— y verificar gastaría un argon2id por golpe, que
      es lo que el ataque quiere; un PIN correcto durante el bloqueo tampoco abre; (c) la
      transacción usa `SELECT … FOR UPDATE` y no un `UPDATE … SET intentos = intentos + 1`,
      porque la decisión depende del estado leído: sin el candado, cinco golpes en paralelo
      leen todos «0 fallidos» y ninguno llega al umbral — el ataque exacto que el lockout
      existe para frenar, y que un contador optimista deja pasar sin que nada se ponga rojo;
      (d) el `audit_trail` del desbloqueo lo escribe el TRIGGER de la tabla y no la función,
      para que quede auditado cualquier cambio de la fila y no solo el que pase por esa
      puerta. El scan de logs es ESTÁTICO y no sobre la salida de los tests, con su razón
      escrita: un scan del texto impreso solo ve las ramas que los tests recorrieron, y la
      línea que filtra un PIN es casi siempre la del `catch` que nadie ejerció. El hash del
      PIN cuenta COMO PIN —el espacio de un PIN tan corto se recorre en un rato de cómputo—,
      y el RUT solo puede salir por `enmascararRut()` de `packages/nucleo-comun`, que deja el
      cuerpo entero enmascarado y solo el dígito verificador: dejar los últimos dígitos, la
      costumbre en otros documentos, acá sería un error porque el DV se DERIVA del cuerpo y el
      espacio por probar bajaría a miles. La frontera de palabra de la regla tiene su propio
      mutante, porque `ruteo` contiene «rut» y el `console.error("ruteo: …")` de `servidor.mjs`
      es sano: un gate que lo marcara sería un gate apagado a la semana — oráculo: CI
      [AC-FIDN-06]
- [x] (P1) Dispositivo de andén: enrolado por el admin como activo del tenant (tipo
      `anden`, sin persona dueña); los operarios rotan por PIN; al autenticarse otra
      identidad se purga SOLO el snapshot (re-descargable) y el outbox del usuario
      anterior persiste firmado por el enrolamiento y se replayea al volver la red —
      test centinela 9: A captura 3 mutaciones offline, B se autentica, vuelve la red,
      count=3 filas de A (§4.3, §4.7, §5.4, §9.3) — oráculo: CI. Evidencia: migración
      `db/migraciones-flota/tenant/0057_sesiones_de_anden.sql` (tabla `sesiones_anden`,
      catálogo de gobierno a 20 eventos), la ruta `POST /api/anden/identidad`, la rama de
      andén en `apps/flota/src/servidor/aprobacion.ts` y
      `apps/flota/e2e/anden-centinela-9.spec.ts`, verde en aislamiento y dentro de
      `check.sh --full --app=flota`. El verde completo estaba bloqueado por una colisión
      ajena a este AC: `entrega-candado-servidor.spec.ts` (AC-FRUT-23) tomaba
      `Object.keys(VALIDOS)[10]` directo en vez de `rutDeFixture`, el mismo índice que
      `pod-offline.spec.ts` (AC-FPOD-03) ya tenía asignado — las dos comparten la base
      `hechos` y ninguna limpia su fixture, así que una corrida completa donde la primera
      corriera antes rebotaba «duplicate key» en la segunda. Se le dio a
      `entrega-candado-servidor.spec.ts` su propio RUT (`rutDeFixture(26)`,
      `15.973.428-5` en la lista congelada), sin tocar el alcance de AC-FRUT-23 [AC-FIDN-07]
- [x] (P1) Re-enrolamiento como flujo normal: «Ya tengo cuenta» → RUT+PIN → solicitud
      de enrolamiento del teléfono nuevo; la aprobación del dueño revoca el dispositivo
      anterior EN EL MISMO ACTO (transacción única: nuevo activo + anterior con
      revocado_at); el constraint de 1 dispositivo personal activo por operario se
      cumple antes, durante y después (jamás 2 activos, jamás 0 tras aprobar) (§4.3,
      §5.4). Evidencia: la migración `db/migraciones-flota/tenant/0013_reenrolamiento.sql`, el
      endpoint público `POST /api/reenrolamiento`, la rama de re-enrolamiento de
      `apps/flota/src/servidor/aprobacion.ts` y 6 pruebas en
      `apps/flota/e2e/reenrolamiento.spec.ts`. La marca en la fila (`tipo`) no es burocracia:
      sin ella, el mismo hecho —un RUT que YA está registrado— pediría dos conductas opuestas.
      En una solicitud NUEVA es un homónimo o un error y rebota al aprobar (AC-FIDN-04,
      pregunta 10); en un re-enrolamiento TIENE que estar, porque la persona ya trabaja acá y
      solo cambió de teléfono. La invitación deja de ser obligatoria para este camino: exigirla
      habría obligado a inventar una invitación fantasma por cada teléfono nuevo, filas que
      nadie emitió y que el dueño vería en su panel sin poder explicar. Se entra con RUT + PIN
      —lo que la persona ya sabe— y el PIN pasa por el MISMO camino que el resto (AC-FIDN-06),
      con su lockout: sin eso, «Ya tengo cuenta» sería la puerta sin candado para probar PINs
      de a diez mil por más que la otra tuviera candado; hay una prueba que lo ejerce hasta el
      429. RUT desconocido y PIN equivocado responden EXACTAMENTE lo mismo, byte a byte, por la
      misma razón que la pregunta 10: si difirieran, este endpoint sería un buscador de RUTs de
      la empresa. La aprobación revoca y crea en UNA transacción —revocar primero, porque al
      revés el índice único parcial de AC-FIDN-01 rebotaría el INSERT antes de que el UPDATE
      libere el lugar— y las pruebas cubren el invariante en los tres momentos: uno antes, uno
      después, y jamás cero. El índice hace imposible que sean dos; lo que este AC agrega es
      que no queden cero, que es la falla que dejaría a alguien sin poder trabajar. El aparato
      viejo queda REVOCADO y no borrado: su historia es lo que permite clasificar una captura
      post-revocación en vez de descartarla (AC-FIDN-09), y su sesión muere en el request
      siguiente. El secreto del aparato nuevo es OTRO — reusar el del perdido sería no haber
      cambiado nada. Una segunda solicitud de cambio no se apila sobre la pendiente: con varias,
      aprobar una dejaría a las otras apuntando a un aparato que ya no es el activo y el dueño
      tendría que resolver una cola que él no creó. ALCANCE DECLARADO: la pantalla «Ya tengo
      cuenta» y su presupuesto de toques son de AC-FIDN-02 — oráculo: CI [AC-FIDN-08]
- [x] (P1) Revocación soft con efecto inmediato server-side (siguiente request del
      dispositivo revocado: sesión inválida; el dueño lo hace en 1 toque desde el
      inventario). Capturas offline del dispositivo revocado — caso de degradación,
      JAMÁS rebote (§4.2): llegan ≤72 h ⇒ 2xx + cuarentena con flag `post_revocacion`;
      llegan >72 h ⇒ 2xx + flag `post_revocacion_tardia` + review_queue severidad alta
      + evento; rechazos = 0 (centinela 4 §9.3). Evidencia:
      `apps/flota/src/servidor/sesion.ts`, `apps/flota/src/dominio/revocacion.ts` con 6
      mutantes puros, la ruta `GET /api/sesion` y 5 pruebas en `apps/flota/e2e/sesion.spec.ts`
      —cuatro por HTTP contra el servidor de producción y una contra el cluster—. **QUÉ ES UNA
      SESIÓN, que es la decisión de fondo y estaba sin tomar**: el secreto que la aprobación
      emitió al aparato (AC-FIDN-04), presentado en cada request como `Authorization: Portador
      <secreto>` y comparado por HASH. No hay cookie, no hay token con vencimiento propio, no
      hay refresh — la sesión ES el aparato, y por eso el dueño la corta con un `UPDATE`. Es
      la forma exacta que pide la respuesta del dueño a la pregunta 1 (sesión personal sin
      caducidad mientras el dispositivo siga enrolado) y la ÚNICA que hace literal el «efecto
      inmediato» del §5.4 F-F: un token con vencimiento propio tendría que caducar para que la
      revocación surtiera efecto, y esa ventana es justo la que no puede existir cuando alguien
      perdió el teléfono en la calle. El costo, declarado: una consulta por request contra la
      BD del tenant, que ya está abierta. El corte se prueba en el REQUEST SIGUIENTE, con las
      palabras del AC: 200, un UPDATE, 401 — sin reiniciar nada y sin lista de revocados que
      sincronizar. Las CUATRO formas de no tener sesión —sin credencial, credencial
      desconocida, aparato revocado y usuario desactivado por la anonimización (AC-FIDN-19)—
      responden byte a byte lo mismo: a un teléfono robado no le sirve enterarse de que lo
      dieron de baja, y la diferencia sería un oráculo, el mismo criterio con que AC-FTEN-05
      hace idénticos el 404 del archivado y el del inexistente. El fixture ENROLA de verdad
      —invitación → solicitud → aprobación → sobre abierto con la privada del aparato— en vez
      de sembrar un `secreto_hash` a mano, que probaría la consulta y no el enrolamiento que la
      produce. Hay además una prueba del centinela 2 con la credencial REAL, que el caso
      autogenerado de AC-FTEN-26 no puede montar porque no sabe cómo se ve un secreto. Del lado
      de la captura: la ventana se mide desde la revocación hasta que la captura LLEGA y con el
      reloj del SERVIDOR —el del dispositivo es el único de los dos que se corre cambiando la
      hora del teléfono, y un reloj atrasado convertiría una captura tardía en reciente, justo
      la que hay que mirar—; las dos entran (rechazos = 0), cada una con su flag, y SOLO la
      tardía abre `review_queue` con severidad alta, porque si cada captura demorada abriera
      una fila la bandeja se llenaría de ruido el día que un camión pasa la noche en un valle
      sin cobertura y la que importa se perdería entre ellas. ALCANCE DECLARADO: la parte de
      captura se prueba contra la base y no por HTTP porque el endpoint de sync nace en el
      módulo 04 (hito e) — acá están la clasificación, el flag, el evento y la fila de revisión
      que ese endpoint va a escribir. La ventana entró al canónico §0 como `REVOCACION`; su
      patrón de vigilancia exige la palabra de la revocación al lado, porque en el repo ya vive
      OTRO 72 con otro significado —el plazo de aviso de brecha del AC-FTEN-25— y un patrón que
      solo mirara el número los confundiría — oráculo: CI [AC-FIDN-09]
- [x] (P1) Firmas con significado según rol (enum {recibio_conforme, libero, rechazo,
      verifico, aprobo}): la firma puntual por PIN en dispositivo ajeno NO abre sesión
      ni desplaza la del titular — test centinela 12: chofer firma por PIN en el
      dispositivo del responsable_carga (fixture sobre `objeto_ref` de custodia cuando
      exista el módulo de encargos/rutas/custodia, hito 9.1(4)(d) — ver Dependencias;
      hasta entonces, `objeto_ref` genérico sembrable: §9.3.12 solo exige «firma en
      dispositivo ajeno + PODs posteriores válidos», no custodia), la sesión del
      responsable sigue intacta y sus PODs posteriores sincronizan válidos; la firma llegada por sync de dispositivo
      revocado entra 2xx con los flags de AC-FIDN-09 (clase CAPTURA) (§4.3, §9.3).
      Evidencia: `apps/flota/src/servidor/firmas.ts` y 7 pruebas contra el cluster real en
      `apps/flota/e2e/firmas.spec.ts`. LO QUE HACE CIERTO AL CENTINELA no es una comprobación
      sino una AUSENCIA: `firmarConPin` devuelve una firma y nada más — no emite credencial, no
      toca `dispositivos` y no tiene por dónde cambiar quién está autenticado, porque la sesión
      es el secreto del aparato (AC-FIDN-09) y acá no se lee ni se escribe. El caso se monta
      con el del terreno: el chofer firma «recibí conforme» en el aparato del responsable de
      carga —dos personas distintas en la misma fila, que es lo que la parada necesita— y las
      pruebas verifican las tres consecuencias: la sesión del titular sigue válida y con SU rol,
      el chofer sigue sin aparato (firmar tampoco enrola), y lo que el responsable firma DESPUÉS
      sigue atribuido a él. Sin eso, el responsable quedaría afuera de su propio teléfono a
      mitad de un turno — o peor, seguiría trabajando mientras el sistema cree que es otro, y
      sus capturas posteriores quedarían firmadas por la persona equivocada. El PIN es la única
      comprobación que puede impedir una firma, y pasa por el MISMO lockout que el resto: sin
      ella la firma no significaría nada, y el §4.5 hace que el significado sea quién responde
      por la carga. ALCANCE DECLARADO, con el permiso del propio AC: el `objeto_ref` es genérico
      —`paradas`— porque la custodia nace en el hito (d); el §9.3.12 exige «firma en dispositivo
      ajeno + PODs posteriores válidos» y no custodia, y los PODs nacen en el hito (e), así que
      la segunda mitad se ejerce con la firma, que es la evidencia de este módulo y tiene la
      misma forma. La firma de un aparato REVOCADO entra igual con su flag (§4.2: la captura no
      rebota — una firma hecha cuando el aparato estaba habilitado no deja de haber ocurrido
      porque después lo dieran de baja), y el replay devuelve LA MISMA firma en vez de un
      silencio, que haría al aparato reintentar para siempre — oráculo: CI [AC-FIDN-10]
- [x] (P1) Soporte sin god-mode: sin grant vigente, el personal de plataforma tiene
      CERO visibilidad del tenant (0 filas, 0 rutas); el grant del dueño lleva alcance
      (solo-lectura|módulos) y expiración 24 h|7 d con caída AUTOMÁTICA al vencer (sin
      acción humana) y revocación anticipada; registro en `control` (§4.1) y begin/end
      de cada acceso en la auditoría visible del tenant; NO existe endpoint de
      impersonación (verificado contra el manifiesto de rutas) (§0, §4.3, §7.9). El
      break-glass se verifica aparte en AC-FIDN-18: su mecánica depende de Preguntas
      al dueño #7 y no cabe todavía en un oráculo CI. Evidencia:
      `db/migraciones-flota/control/0004_alcance_del_soporte.sql`,
      `apps/flota/src/servidor/soporte.ts`, 8 pruebas contra el cluster en
      `apps/flota/e2e/soporte.spec.ts` y 3 contra el manifiesto de rutas en
      `apps/flota/rutas/impersonacion.test.mjs`. **La caída al vencer es LITERAL**: no hay job
      de expiración, no hay barrido nocturno, no hay nada que se pueda olvidar de correr —
      `vigente()` compara contra el reloj de la base en cada consulta, así que un grant vencido
      deja de servir en el instante exacto en que vence aunque nadie toque nada nunca más. Un
      vencimiento que depende de un proceso es un vencimiento que un día no ocurre. El estado
      por omisión es CERO y al revés de como suele estar: no hay un permiso que se pueda
      quitar, no hay permiso. Las dos duraciones del §4.3 se cierran con un CHECK sobre la
      DIFERENCIA de fechas y no con un campo aparte —que podría decir «24h» y vencer en un
      año—, y el alcance es un enum sin ningún valor que signifique «todo»: eso sería el
      god-mode que este AC existe para que no exista. Extender un acceso obliga a otorgar otro
      grant, que queda registrado; con un campo libre, el día que alguien tenga apuro va a
      poner un año y nadie va a mirar esa fila. El begin/end se espeja en el `audit_trail` del
      TENANT y no solo en `control`: si viviera solo del lado de la plataforma, el dueño
      tendría que pedirle a la plataforma el listado de las veces que la plataforma lo miró, y
      eso no es una auditoría sino un favor — y una prueba verifica que esas filas no se pueden
      borrar ni con el rol dueño de la base (§7.4). La AUSENCIA del endpoint de impersonación
      se prueba contra el manifiesto de rutas, que es la primera vez que se usa como oráculo lo
      que AC-FTEN-26 construyó: derivado del árbol, «no hay una ruta que haga esto» no es
      compatible con «alguien la agregó y no la declaró». Los patrones son de FORMA y no de
      nombre exacto —quien agregue una ruta así no va a llamarla `/api/impersonar` sino
      `/api/soporte/entrar-como`— y tienen su propio mutante contra seis nombres plausibles,
      más el positivo de que las rutas legítimas no disparan. El §7.9 no pide que la
      impersonación esté apagada: pide que no exista, porque una ruta apagada por una bandera
      es una ruta que alguien enciende. HALLAZGO DEL CAMINO: el CHECK de duración cerrada
      impidió que el propio test falseara un vencimiento moviendo solo `expira_en` — hubo que
      simular un grant otorgado ocho días antes, corriendo las dos fechas. La restricción
      hizo su trabajo contra quien la escribió — oráculo: CI [AC-FIDN-11]
- [x] (P1) Panel de gobierno exclusivo del dueño: emitir/pausar/revocar invitaciones,
      aprobar/rechazar solicitudes, inventario vivo de dispositivos, revocar 1 toque,
      rotar PIN/desbloquear, auditoría de accesos (incluidas sesiones de soporte),
      grants. Rebotes: cada acción de gobierno con rol `operador` (o cualquier rol no
      admin) ⇒ 403 y 0 filas; recurso de identidad de OTRO tenant ⇒ 404 siempre y BD
      ajena sin cambios (suite HTTP A-contra-B autogenerada, centinela 2); toda acción
      de gobierno escribe audit_trail + evento (§0, §5.4, §9.3). Evidencia:
      `db/migraciones-flota/tenant/0014_gobierno_del_dueno.sql`,
      `apps/flota/src/servidor/gobierno.ts`, **diez rutas** bajo `src/app/api/gobierno/**`
      más `api/pin/puente`, 15 pruebas HTTP contra el cluster en
      `apps/flota/e2e/gobierno.spec.ts` y 9 de catálogo en
      `db/flota/pgtap/0009_gobierno_del_dueno.sql`.
      **LOS DOS BARRIDOS SALEN DEL MANIFIESTO, no de una lista escrita a mano.** El AC dice
      «CADA acción de gobierno», y una lista en el spec se queda corta el día que alguien
      agrega la undécima ruta — ese día el rebote deja de estar probado sin que nada se ponga
      rojo. El barrido lee `rutas/manifiesto.json` (AC-FTEN-26), que se deriva del árbol: una
      ruta de gobierno nueva entra sola a los dos barridos, o el gate la frena antes por no
      tener cruce declarado. Y cada caso va con un identificador REAL de la base: contra un
      uuid inventado, un handler que mirara el recurso antes que el rol respondería 404 y el
      barrido pasaría en verde sin haber probado el 403 que el AC pide.
      **TRES RESPUESTAS Y NO UNA, y la asimetría es la decisión.** Sin sesión ⇒ **404 pelado**
      (no 401): sobre `/api/gobierno/invitaciones/<id>` un 401 confirma que ese uuid es una
      invitación real de alguien, que es el oráculo de enumeración que el §0 cierra con «404
      jamás 403». Con sesión y rol distinto de `admin_tenant` ⇒ **403 y cero filas**, leídas
      del catálogo tabla por tabla: el operador SÍ es de la casa, y esconderle la puerta lo
      dejaría reportando «no me anda» sobre algo que funciona. Recurso de otro tenant ⇒ **404**,
      y sale por construcción y no por una rama que lo contemple: cada tenant es su propia base
      (§4.1) y el id del vecino no está ahí. Estas son las **PRIMERAS rutas de tipo `recurso`
      del producto**: hasta hoy el «404 jamás 403» solo se juzgaba contra respuestas de
      laboratorio en `veredicto.test.mjs`, y ahora la suite autogenerada lo ejerce de verdad
      —por eso el fixture del vecino pasó a llevar identidad sembrada, sin la cual ese caso no
      probaría nada—.
      **EL CÓDIGO PUENTE NO LLEVA PLAZO, y la ausencia es deliberada.** La Pregunta 2 la
      respondió Alexis el 09-ago-2026 —el dueño emite un código de un solo uso, se lo dicta, y
      el operario define su PIN nuevo en SU aparato— pero no fija vencimiento, y ni el maestro
      tampoco: inventar uno habría sido inventar la respuesta a una pregunta que nadie hizo. Se
      acota por los tres ejes que sí están definidos: un solo uso, **uno vivo por usuario**
      (índice único parcial; emitir otro anula el anterior, que es lo que hace que el segundo
      intento del dueño no rebote contra una restricción) y sobre todo la SESIÓN del propio
      operario — quien escuche el código dictado en un galpón no tiene el aparato enrolado de
      esa persona, y sin él el código no abre nada. Encaja con la respuesta a la Pregunta 1: la
      sesión personal no caduca, así que quien olvidó el PIN sigue teniendo su teléfono adentro.
      El dueño JAMÁS conoce el PIN, y una prueba lo verifica sobre el hash: tras la rotación el
      `pin_hash` sigue siendo el viejo hasta que el operario canjea.
      **DOS ROLES NO SE INVITAN DESDE ACÁ**, y no es un olvido. `cliente` se emite desde la
      ficha de la empresa con su id embebido (Pregunta 3), porque desde este panel nacería sin
      empresa y el CHECK rebotaría recién al aprobar, con la persona esperando. Y `admin_tenant`
      se transfiere con passkey (§5.4 F-H, AC-FIDN-13): si el panel pudiera fabricar un segundo
      dueño con una invitación, esa ceremonia sería decorativa y el camino corto para tomar la
      cuenta sería no usarla.
      **EL EVENTO ENTRA EN LA MISMA TRANSACCIÓN QUE LA MUTACIÓN.** `audit_trail` lo escriben los
      triggers de AC-FIDN-01; el evento lo escribe el acto, y para que la aprobación de
      AC-FIDN-04 no quedara fuera se le agregó un gancho `registrar` que corre ANTES del commit.
      Un evento escrito después del commit es un evento que un fallo de red deja sin escribir, y
      una auditoría con menos filas de las que ocurrieron es peor que ninguna, porque se la lee
      con confianza.
      Se prueba sin esperar a un fallo real: se hace una mutación y se le pide un evento de un
      tipo que no está en el catálogo — el acto entero se deshace. El ACTOR viaja en
      `eventos.actor_id` y no en `audit_trail`, declarado: el trigger escribe la FILA, y hacerle
      llegar la identidad de la sesión exigiría un GUC por transacción en cada puerta, o sea una
      más que olvidar. Los grants son la única costura entre dos bases (`control` y el tenant) y
      va con **compensación explícita**: si el registro falla, el grant se revoca — un rastro de
      más se explica, uno de menos no se descubre.
      **HALLAZGO DEL CAMINO, y es una deuda que recién muerde acá:** `tenant_info.id` y
      `control.tenants.id` NO coinciden hoy. `provisionar()` genera el uuid dentro de la base
      del tenant y el alta en `control` la hace otro con su propio default. Este es el primer
      endpoint que necesita el id del plano de control —la FK de `grants_soporte` apunta ahí—
      y leerlo de `tenant_info` habría dado una violación de FK en el primer grant emitido en
      producción, no en una prueba. Se resuelve por slug contra `control`, y el slug tampoco
      llega de afuera: lo sobrescribe `servidor.mjs` con el veredicto del ruteo. SEGUNDO
      HALLAZGO: el linter del §9.2 frenó la migración por la segunda FK de `codigos_puente` sin
      índice que la encabece — dos FK al mismo padre por columnas distintas necesitan dos
      índices, y es la clase de costo que no se ve hasta que la tabla tiene años. **Queda
      FUERA, con su AC:** transferir propiedad (AC-FIDN-13, bloqueado por la Pregunta 4) —
      oráculo: CI [AC-FIDN-12]
- [x] (P2) Transferir propiedad del tenant exige passkey/WebAuthn del admin — única
      passkey del sistema (prohibido WebAuthn en cualquier otro flujo, grep del
      manifiesto de rutas): sin ceremonia passkey válida ⇒ rebote 422 y 0 cambios; con
      ella, el nuevo dueño queda `admin_tenant`, el anterior pierde el gobierno y todo
      queda en audit_trail; e2e con virtual authenticator (§5.4) — oráculo: CI. Probado:
      `apps/flota/e2e/transferencia-propiedad.spec.ts` (5/5 verde) con virtual
      authenticator real de Playwright 1.62 y `src/dominio/passkey.test.ts` (14/14,
      verificación WebAuthn propia sin librería de terceros); gate completo de flota en
      verde (verde-20260815-195901)
      [AC-FIDN-13]
- [x] (P1) 21.719 estructural: ninguna tabla de HECHOS lleva PII — las tablas de
      hechos/append-only y operativas (eventos, reading, evidence, firmas,
      entregas_pod, custody_transfer, audit_trail, review_queue, client_metric)
      referencian ID opaco (§7.8); el linter lo mecaniza con whitelist CERRADA:
      columnas de nombre/rut/contacto permitidas SOLO en `personas` (§4.3) y en
      `empresas_cliente` (§4.5 — rut/contacto de la persona jurídica contratante,
      MANDADOS por el maestro; jamás pueden poner el gate en rojo); cualquier otra
      tabla con esas columnas ⇒ rojo (§7.8, §4.5, §3.E1.15). La anonimización, la UI
      sin consentimiento y los seeds se verifican aparte (AC-FIDN-19/20/21). Evidencia:
      `db/flota/gate-pii.mjs` con 11 mutantes en `gate-pii.test.mjs`, dentro de
      `db/flota/gate.sh` sin `--full` — se mecaniza sobre las MIGRACIONES y no sobre el
      cluster, porque el momento de atrapar una columna así es cuando se escribe y no diez
      minutos después. DESVIACIÓN DECLARADA respecto del texto del AC, que nombra la whitelist
      como «personas y empresas_cliente»: entra una tercera, `solicitudes_acceso`. Guarda el
      RUT y el nombre de la persona PROPUESTA y tiene que guardarlos, porque el §4.3 hace que
      la identidad se cree recién al aprobar (AC-FIDN-04) justamente para que cualquiera con
      un link no pueda sembrar filas en `personas`; es plano de IDENTIDAD y no de hechos, y la
      purga la alcanza por `retention_policy`. SEGUNDA DECISIÓN, y es la que hace que la regla
      sirva: `nombre` NO se prohíbe en todas partes. Es la palabra más reusada del esquema
      —la tienen los grupos, los tipos de carga y los planes, y ninguno es una persona— así
      que prohibirla en bloque obligaría a declarar una exención por catálogo, y una regla con
      doce exenciones es una regla que nadie lee y que alguien termina apagando. Se juzga por
      la CLASE que la tabla ya declara en su `COMMENT ON TABLE`: un `nombre` en una tabla
      CAPTURA es el de una persona dentro del ledger append-only, y ahí sí es rojo. La clase
      no es una lista nueva que mantener: es la que AC-FTEN-06 ya obliga a escribir. Los
      identificadores INEQUÍVOCOS —rut, contacto, teléfono, correo, dirección, apellido— sí
      valen en cualquier tabla fuera del plano de identidad. El plano de `control` queda fuera
      del alcance y se DICE en la salida del gate: guarda a los clientes de la plataforma, no
      a las personas de la operación. Se cerró además la vía de escape obvia: un `ALTER TABLE
      … ADD COLUMN` cuenta igual que una columna del `CREATE`, porque si no la forma de meter
      un RUT en `eventos` sería escribir la migración siguiente. Las exenciones se declaran en
      la propia migración (`-- pii: exenta <tabla>.<columna> — <razón>`), son de UNA columna y
      no de la tabla entera, y el gate las CUENTA e imprime; hoy son cero — oráculo: CI
      [AC-FIDN-14]
- [ ] (P2) Export ARCO por persona: entrega los datos personales de UNA persona (fila
      de `personas` + sus vínculos de usuario y dispositivos) sin incluir datos de
      terceros; el acceso queda en la bitácora de accesos del admin (§3.E1.15, §7.8).
      El maestro NO fija quién lo acciona (§3.E1.15 solo dice «export ARCO»; bajo la
      Ley 21.719 el titular del derecho es la persona): actor, formato y alcance fino
      pendientes de Preguntas al dueño #8 — el AC queda condicionado a esa respuesta —
      oráculo: CI [AC-FIDN-15]
- [ ] (P2) Validación en vivo (DONE-adopción §10, jamás bloquea al loop): enrolamiento
      real de un trabajador de punta a punta — emisión, solicitud (~90 s), aprobación,
      sesión activa — en <5 min total, en un teléfono real con guía A2HS seguida sin
      ayuda (§5.4) — oráculo: humano [AC-FIDN-16]
- [x] (P1) Rebote de PLANIFICACIÓN por RUT inválido (§4.2): POST de solicitud de
      acceso con RUT que no pasa módulo 11 ⇒ 422 tipado en servidor y 0 filas en
      `solicitudes_acceso` y `personas`; y e2e de que el cliente valida módulo 11 EN
      LÍNEA sobre el RUT auto-formateado `12.345.678-5` y no envía mientras sea
      inválido (el 422 del servidor se ejercita por request directo, saltándose el
      cliente) (§0, §4.2, §4.3, §5.4). Evidencia:
      `packages/nucleo-comun/src/rut.ts` con 8 mutantes puros en `rut.test.ts`, la PRIMERA
      pantalla de la PWA (`apps/flota/src/app/solicitar/page.tsx`, F-B del §5.4),
      `apps/flota/src/cliente/aparato.ts`, y 3 pruebas de navegador en
      `apps/flota/e2e/rut.spec.ts` más 2 contra el cluster en `db/flota/suite-bd/ruts.test.mjs`.
      **DOS IMPLEMENTACIONES DEL MÓDULO 11, Y ES LO CORRECTO — pero no de a gratis.**
      AC-FIDN-21 dejó escrito que hay UNA y vive en la base, para que dos algoritmos no se
      separen; este AC pide validar «al escribir», o sea tecla a tecla y sin red. Preguntarle a
      la base por cada dígito no es una alternativa: es otro producto. Así que la divergencia se
      cierra con un ORÁCULO en vez de con una promesa — la suite pasa la lista congelada ENTERA
      por las dos implementaciones y exige el mismo veredicto RUT por RUT, más los bordes donde
      dos algoritmos se separan de verdad (la forma pelada, el cuerpo cortado, el dígito de
      más). El día que alguien toque una sola, el gate dice en cuál RUT difieren. Y como la
      lista crece con cada caso raro que el gate obliga a declarar, el oráculo crece con ella.
      **EL RUT NO ES UN `input`, Y ESO ES LA MITAD DE LA PANTALLA.** El §5.4 exige teclado
      PROPIO; un `<input>` abriría el del sistema al enfocarlo, con autocorrector y sugerencias
      del navegador sobre un identificador nacional. Va en un `output` alimentado por el teclado
      de Miga, y el test lo verifica leyendo el `tagName` — sin eso, «teclado propio» es una
      intención que la primera refactorización se lleva puesta. El teclado ganó `permitirK` con
      la misma forma que `permitirGuion` ya tenía: sin esa tecla, quien tiene K de dígito
      verificador no puede tipear su propio RUT y la pantalla tendría que abrir el teclado del
      sistema justo donde el maestro lo prohíbe.
      **EL VEREDICTO SE DICE CON TEXTO Y NO SOLO CON COLOR** (§5.7): a pleno sol un borde rojo
      no se ve, y a quien no distingue rojo de verde no le dice nada. La prueba negativa va con
      su POSITIVO en el mismo test —se corrige el dígito verificador y la pantalla deja seguir—
      porque un botón que nunca se habilita pasaría el negativo solo. Y se cuenta que NO salió
      ni un request: «no envía mientras sea inválido» se verifica interceptando la red, no
      mirando el botón.
      **LAS DOS CAPAS NO SE REEMPLAZAN.** El 422 del servidor se ejercita por request DIRECTO,
      salteándose el cliente: con solo la prueba de pantalla, borrar la validación del servidor
      dejaría todo verde. Se cuentan cero filas también en `personas`, que este endpoint no toca
      nunca — el día que alguien mueva la creación de la persona a la solicitud, que es el atajo
      obvio, esa línea es la que se pone roja.
      **HALLAZGO DEL CAMINO:** `dominio/invitaciones.ts` abre con `import … from "node:crypto"`,
      así que la pantalla no podía usar su `normalizarCodigo` sin arrastrar un polyfill de Node
      al bundle que el teléfono baja con señal de galpón. Se PARTIÓ en `dominio/codigo-corto.ts`
      —puro— en vez de copiarse: una segunda normalización en el cliente y un día el código que
      la persona teclea se acepta en pantalla y rebota en el servidor. Lo mismo con las claves
      del aparato: `dominio/secretos.ts` es del servidor y usa `Buffer`, así que la mitad del
      navegador vive en `cliente/aparato.ts`, con la privada NO EXTRAÍBLE en IndexedDB — que es
      lo que convierte «nunca salió del teléfono» en una propiedad del navegador y no en una
      promesa nuestra. **Queda FUERA, con su AC:** el conteo de toques del flujo completo y la
      pantalla de espera que abre sesión sola (AC-FIDN-02) — oráculo: CI [AC-FIDN-17]
- [x] (P1) Break-glass de soporte (§4.3, §7.9): doble control + notificación forzosa
      + registro inmutable. DESBLOQUEADO el 09-ago-2026 (respuesta a la pregunta 7: dos
      personas de la PLATAFORMA, y aviso por correo + panel persistente hasta reconocerlo)
      (quiénes son los DOS controles y por qué canal llega la notificación sin
      depender de push, §7.6): contra actores y canal indefinidos no hay test
      escribible; resuelta la pregunta, el test se parametriza con los dos controles
      y el canal concretos y el AC entra al plan del build. Evidencia:
      `db/migraciones-flota/control/0005_break_glass.sql`,
      `apps/flota/src/servidor/breakglass.ts` y 7 pruebas contra el cluster en
      `apps/flota/e2e/breakglass.spec.ts`. Las tres exigencias del §7.9 quedan como
      RESTRICCIONES y no como costumbre: (1) el doble control es un CHECK
      (`solicitado_por <> aprobado_por`) además del rebote tipado, porque si viviera solo en el
      código que llama bastaría con invocar el INSERT desde otro lado para tener god-mode de
      una persona; (2) la notificación es FORZOSA en el sentido literal — `aviso_id` es NOT
      NULL y el aviso se escribe ANTES que la fila, así que no hay camino que abra el acceso y
      notifique después, ni forma de olvidarse; si algo falla a mitad queda un aviso sin acceso
      (ruido descartable) y jamás un acceso sin aviso; (3) el registro es append-only con las
      dos capas del §7.4, porque lo que audita es el acceso de quien tiene todos los permisos y
      un registro editable no auditaría nada. El aviso vive en `review_queue` del TENANT, que
      ya tiene la forma exacta que el dueño pidió —persistente hasta reconocerlo, con estados
      nueva → reconocida → resuelta— y la nota nombra a los dos y el motivo: un aviso que no
      dice quién entró ni por qué obliga al dueño a pedir explicaciones, que es lo contrario de
      notificar. DECISIÓN DECLARADA: la tabla **no tiene FK a `tenants`**, y no es un olvido —
      con una FK, un tenant que alguna vez tuvo un acceso de emergencia quedaría imposible de
      borrar para siempre, y el offboarding del §4.1 es un derecho del tenant, no un favor. El
      registro tiene que SOBREVIVIR al tenant en vez de impedir que se vaya, y por eso viaja
      también su slug: cuando la fila de `tenants` ya no esté, el registro tiene que seguir
      siendo legible. Lo destapó el gate — el primer intento con FK dejó un tenant registrado
      sin base que el exportador denunció, y después bloqueó la limpieza de otra suite.
      ALCANCE DECLARADO: la mitad de CORREO del canal no se implementa: no hay proveedor de
      correo en el proyecto y E1 no despliega, así que queda como ítem igual que en el runbook
      de brechas. Lo construido y probado es la mitad que no depende de nadie — oráculo: CI
      [AC-FIDN-18]
- [x] (P1) Anonimización 21.719 sin tocar el ledger (§4.3, §7.8): anonimizar una
      persona con historial ⇒ `anonimizada_en` set y campos identificantes
      nulificados en `personas`, con el ledger INTACTO — mismos counts de eventos,
      PODs y firmas, todos válidos referenciando el ID opaco; centinela 6 no se
      viola. Evidencia: `apps/flota/src/servidor/anonimizacion.ts` y 7 pruebas contra el
      cluster real en `apps/flota/e2e/anonimizacion.spec.ts`, sobre una persona CON historial
      —3 eventos y 2 firmas— porque sin hechos previos «el ledger quedó intacto» sería cierto
      por no haber ledger, que es el verde vacuo más fácil de escribir en este AC. Lo que hace
      intacto al ledger no es una promesa: es que la función NI SIQUIERA NOMBRA `eventos`,
      `firmas`, `evidence` ni `audit_trail` — y una prueba aparte verifica que tampoco se
      PODRÍAN tocar (UPDATE y DELETE ⇒ 42501), porque si el append-only se hubiera relajado
      para que la supresión pasara, todo lo demás seguiría en verde y el ledger habría dejado
      de ser prueba de nada. La otra mitad, que es la que le da sentido: los hechos siguen
      apuntando al MISMO ID opaco y las FK siguen resolviendo — si la supresión cortara el
      vínculo, el ledger estaría «intacto» y a la vez inservible para reconstruir una entrega,
      que es para lo que existe. Suprimir no es borrar la fila. DECISIÓN DECLARADA: la
      supresión además REVOCA los aparatos de esa persona y desactiva su usuario. El AC pide
      la fila y el ledger; esto es la consecuencia que no se puede dejar afuera sin romper
      algo — un aparato que siguiera capturando en nombre de una identidad suprimida
      escribiría hechos nuevos atribuidos a alguien que ya no se puede nombrar. ALCANCE
      DECLARADO: el historial se arma con `eventos` y `firmas`, las tablas de hechos que
      existen hoy; los PODs que el AC también nombra nacen en el hito (e) y se suman a este
      mismo conteo sin cambiar el mecanismo. NOTA DE ARNÉS: esta suite provisiona su PROPIA
      base y no usa la del fixture de ruteo, porque escribe en tablas append-only — una vez
      que hay firmas apuntando a una persona, ninguna otra suite puede volver a limpiar
      `personas` (el DELETE rebota 42501, que es justo lo que el §7.4 promete) y la base
      compartida queda inservible para todas. El aislamiento del ledger no puede volverse el
      problema de la suite siguiente — oráculo: CI [AC-FIDN-19]
- [x] (P1) La UI de enrolamiento NO presenta consentimiento a trabajadores (base de
      licitud = ejecución de contrato, §7.8): e2e sobre F-B/F-C/F-E sin checkbox ni
      texto de consentimiento + grep de strings del flujo. Evidencia:
      `db/flota/gate-consentimiento.mjs` con 7 mutantes en su `.test.mjs` (dentro de
      `db/flota/gate.sh` sin `--full`), la pantalla F-E `apps/flota/src/app/ya-tengo-cuenta/page.tsx`
      —que nace acá— y 3 pruebas de navegador en `apps/flota/e2e/consentimiento.spec.ts`.
      **EL CHECKBOX NO SOBRA: HACE DAÑO, y esa es la razón de fondo.** La base de licitud del
      tratamiento de los datos de un trabajador es la EJECUCIÓN DEL CONTRATO. Pedirle
      consentimiento le finge una opción que no tiene —necesita el teléfono para trabajar— y
      bajo la Ley 21.719 un consentimiento que no se puede negar sin costo no es consentimiento:
      es un vicio que además DEBILITA la posición del tenant, porque invita a discutir si el
      tratamiento tenía base legal. No se trata de una casilla de más.
      **EL ALCANCE DEL GREP SE DERIVA, NO SE ESCRIBE.** Una lista de pantallas a mano se queda
      corta el día que alguien agrega la cuarta, y ese día el AC deja de estar probado sin que
      nada se ponga rojo. El flujo de enrolamiento son LAS PANTALLAS QUE LLAMAN A LOS ENDPOINTS
      DE ENROLAMIENTO (`/api/solicitudes`, `/api/reenrolamiento`): una pantalla que postea ahí
      ES el flujo, la llame como la llame quien la escribió. Con un piso declarado de dos
      pantallas, porque un gate que no encuentra qué revisar pasa en verde sin haber leído nada.
      **Y NO BARRE LA APP ENTERA, a propósito:** los términos del tenant y el DPA del §3.E1.15
      SÍ existen y sí se aceptan —los acepta el ADMIN en el wizard de alta (AC-FMIG-22, hito g),
      que es una persona jurídica contratando un servicio, no un trabajador entregando su RUT
      para poder trabajar—. Un gate que los marcara chocaría con ese AC y alguien lo apagaría;
      su mutante lo fija.
      **DOS ORÁCULOS QUE NO SE SOLAPAN.** El gate estático ve TODAS las ramas, incluidas las que
      ningún test recorre; el navegador ve lo que la persona ve —un checkbox que llega dentro de
      un componente importado, un texto armado por concatenación— que el grep no puede alcanzar.
      La suite recorre F-B paso a paso, incluido el del NOMBRE, que es donde un formulario de
      alta pone la casilla por costumbre, y termina en F-C «Esperando aprobación», la pantalla
      más fácil de olvidar en una revisión. De paso se verifica CERO campo de correo (§5.4), que
      es la otra cosa que un alta arrastra por costumbre. Y un tercer test comprueba que la
      solicitud LLEGÓ a la base: sin él, los dos primeros pasarían igual con un botón que no
      hace nada, y el AC estaría probado sobre un flujo que no funciona.
      **La pantalla F-E nace en este AC** porque el texto lo exige por nombre y no existía: hasta
      hoy «Ya tengo cuenta» era solo un endpoint. El §5.4 lo llama flujo de primera clase, así
      que tiene pantalla propia y no un enlace en letra chica — oráculo: CI [AC-FIDN-20]
- [x] (P1) Seeds y fixtures solo con RUTs sintéticos de LISTA CONGELADA versionada en
      fixtures — mecaniza el «irreales» de §7.8/§10, que no tiene oráculo directo:
      test CI que verifica que TODO RUT sembrado (a) pasa módulo 11 y (b) pertenece a
      la lista congelada; un RUT fuera de la lista ⇒ rojo (§7.8, §9.2, §10) —
      Evidencia: `db/flota/ruts-sinteticos.mjs` (la lista, con la razón de existir de cada
      RUT), `db/flota/gate-ruts.mjs` con 7 mutantes, y 5 pruebas contra el cluster en
      `db/flota/suite-bd/ruts.test.mjs`. LA LISTA INVIERTE LA CARGA, que es todo el punto: el
      default pasa a ser que un RUT NO se puede sembrar. Un test que solo verificara el módulo
      11 diría que un RUT real y válido está perfecto — y un RUT real en un seed es exactamente
      el problema; «irreal» no tiene oráculo, ningún test puede mirar un RUT y decidir si le
      pertenece a alguien, así que lo que se mecaniza es lo de al lado y alcanza. Las dos
      mitades del AC se reparten sin duplicar nada: la pertenencia la verifica el gate estático
      (sin base, en cada iteración) y el módulo 11 lo verifica la suite pasando la lista por la
      ÚNICA implementación que existe, la de la base (`rut_valido()`, AC-FIDN-01), en vez de
      escribir una segunda en JavaScript que un día se separe de la primera. La lista tiene DOS
      mitades declaradas: los válidos y los INVÁLIDOS A PROPÓSITO —los fixtures que prueban que
      el validador rechaza—, y una prueba verifica que esos sigan fallando de verdad: si alguno
      pasara, sería un fixture que ya no prueba lo que dice y el test del rebote seguiría en
      verde sin que nada rebote. Cada entrada exige su razón escrita, porque una lista sin
      razones se vuelve un cajón donde todo entra. HALLAZGO DEL CAMINO, y el gate atrapó a
      quien lo escribió: la prueba de que «un RUT válido pero no declarado se rechaza igual»
      llevaba el RUT escrito literal, y el propio gate lo marcó — hubo que armarlo en tiempo de
      ejecución. Un RUT no declarado no puede estar en el árbol ni siquiera dentro del test que
      prueba que no puede estar. De paso se corrigió un RUT inválido que se había colado sin
      querer en el test de la máscara (AC-FIDN-06), reemplazado por dos válidos que comparten
      dígito verificador, que es lo que esa prueba necesitaba — oráculo: CI [AC-FIDN-21]

## Dependencias

- **Módulo 00 — núcleo multi-tenant (§4.1, hito 9.1(4)(a)):** obligatoria. Provee
  `tenant_template` (donde nacen las tablas de este módulo), BD `control` (registro de
  grants de soporte), ruteo por subdominio, credenciales por tenant, linter de
  migraciones con clases §4.2, suite HTTP A-contra-B autogenerada (centinela 2),
  `set_config('app.current_role')` por transacción y runner de migraciones ×N.
- **Módulo 00 — DDL transversal del §4.6 (AC-FTEN-24), obligatoria y RESUELTA:**
  `eventos`, `evidence`, `audit_trail`, `client_metric` y `review_queue` nacen en
  `tenant_template` con el hito (a), antes que este hito (b); este módulo los CONSUME
  como oráculo (toda acción de gobierno escribe audit_trail por trigger + evento —
  ACs FIDN-12/13/14/19) y jamás los crea. La conducta de degradación y la ingesta de
  `client_metric` son del módulo 04 (hito e).
- **Módulo encargos/rutas/custodia (hito 9.1(4)(d)):** consumidor y sede del fixture
  del centinela 12. Consume `firmas` en el traspaso de custodia F2 (§5.2) y aporta el
  `objeto_ref` de custodia del test de AC-FIDN-10; hasta que exista, ese fixture corre
  sobre un `objeto_ref` genérico sembrable (§9.3.12 no exige custodia, solo «firma en
  dispositivo ajeno + PODs posteriores válidos»).
- **Módulo POD offline / nucleo-pod (hito 9.1(4)(e)):** compartida. El outbox
  particionado por (tenant, usuario) e imborrable (§4.7) y el endpoint de sync 2xx
  ejecutan la parte de replay de AC-FIDN-07/09/10; `client_metric` (persist_denegado)
  y `review_queue` viven en su esquema (§4.6). Los centinelas 4 y 9 se ejercitan en
  conjunto.
- **Módulo vehículos (hito 9.1(4)(c)):** consumidor. El gobierno solo-dueño de
  vehículos (centinela 15) usa el RBAC de este módulo; sus tests viven allá.
- **Módulo tarifas/liquidación/portal (hito 9.1(4)(f)):** consumidor. El rol `cliente`
  scoped por `empresa_cliente_id` y la matriz ve-dinero (RLS §4.8, centinelas 3 y 10)
  se apoyan en los roles y sesiones de aquí.
- **Módulo panel admin white-label + wizard (hito 9.1(4)(g)):** consumidor. El wizard
  siembra el `admin_tenant` inicial y usa las invitaciones; la pantalla «Funciones»
  (§5.5) NO es de este módulo; los seeds §10 (usuarios de los tenants A, B y C con
  RUTs irreales) materializan estas tablas.
- **Semáforo «Hoy» (hito 9.1(4)(e), §5.6):** posible consumidor — ver Preguntas al
  dueño #6 (señal de solicitudes pendientes no existe en el Anexo B).

## Preguntas al dueño

1. ~~**Sesiones:** duración, caducidad y re-autenticación.~~ **RESPONDIDA** por Alexis el
   09-ago-2026: en el teléfono PERSONAL la sesión no caduca mientras el dispositivo siga
   enrolado y sin revocar — **no se pide PIN al abrir la PWA**—; el PIN queda para firmar y
   para rotar identidad en el ANDÉN, que sí cierra sesión por inactividad (3 min). Razón: el
   aparato personal YA es el segundo factor (enrolado, secreto propio, revocable en 1 toque
   con efecto inmediato), así que el PIN en cada apertura sumaría toques al presupuesto del
   §5.3 sin agregar seguridad que la revocación no dé — y la fricción empuja a dejar la app
   abierta todo el turno, que es lo que se quería evitar. Absorbida en `SESION` del canónico
   §0. Registro: `docs/respuestas-dueno-2026-08-09-spec01.md`.
2. ~~**«Rotar PIN»:** la mecánica del restablecimiento.~~ **RESPONDIDA** por Alexis el
   09-ago-2026: **código puente de un solo uso mostrado al dueño**, que se lo dicta al
   operario; el operario lo tipea EN SU aparato enrolado y ahí define el PIN nuevo. Razón: si
   el dueño eligiera el PIN, lo conocería — y una firma por PIN dejaría de probar quién firmó,
   que es para lo que existe (§4.5). Reusa el mecanismo de código corto de AC-FIDN-03, ya
   construido y probado. Se implementa en AC-FIDN-12.
3. ~~**Rol `cliente`:** de dónde sale su empresa y con qué entra.~~ **RESPONDIDA** por Alexis
   el 09-ago-2026: la invitación de rol `cliente` se emite DESDE la ficha de la empresa
   contratante y lleva su id **embebido**, así que aprobar sigue siendo 1 toque y no una
   decisión con un selector — justo donde el §5.4 cuenta toques. Y el contratante entra por
   **sesión web**, sin PWA instalada ni `persist()`: esas exigencias existen porque el operario
   captura offline en terreno, y el contratante solo lee su liquidación. Fija además que el
   portal de la spec 07 no exige enrolamiento de aparato.
4. ~~**Passkey del admin:** ¿cuándo se registra y cuál es la vía de recuperación?~~
   **RESPONDIDA** por Alexis el 11-ago-2026: se registra **al primer uso de «transferir
   propiedad»** —el alta del tenant queda liviana—, y si se pierde se recupera por
   **break-glass del §7.9**: el mismo mecanismo ya aprobado el 09-ago para soporte, dos
   personas DISTINTAS de la plataforma con aviso por correo y panel persistente. No nace un
   secreto de recuperación nuevo que administrar. Registro:
   `docs/respuestas-dueno-2026-08-11-spec01-spec03.md`. Se implementa en AC-FIDN-13.
5. ~~**Distribución de la invitación** y formato del código corto.~~ **RESPONDIDA** por
   Alexis el 09-ago-2026: **share-sheet del propio teléfono del dueño** (o copiar), SIN
   pasarela de SMS ni de WhatsApp — cero integraciones, cero costo por mensaje, y sin meter en
   el camino crítico del enrolamiento el modo de falla de un proveedor de mensajería: el
   mensaje que no llegó. **Código corto de 8 caracteres en alfabeto sin ambiguos** (sin 0/O,
   sin 1/I/L): se dicta en voz alta en un galpón ruidoso y se teclea con guantes; en ese
   alfabeto son del orden de 10^12 combinaciones para un token que además expira a los 7 días
   y se revoca en 1 toque. Absorbida en `INVITACION` del canónico §0.
6. ~~**Visibilidad de solicitudes pendientes.**~~ **RESPONDIDA** por Alexis el 09-ago-2026:
   **solo badge en el panel de enrolamiento**, nada en el semáforo «Hoy». El semáforo es de la
   OPERACIÓN y tiene un máximo de 6 tarjetas (§0): meterle enrolamiento le quita el lugar a
   algo que sí detiene un camión, y el día que entran cinco personas nuevas tapa el tablero. El
   enrolamiento pasa cuando entra gente, no todos los días, y el ciclo del §5.4 es menor a 5
   minutos con el dueño presente — quien invitó está esperando la solicitud.
7. ~~**Break-glass (§7.9):** quiénes son los dos controles y por qué canal el aviso.~~
   **RESPONDIDA** por Alexis el 09-ago-2026: **dos personas distintas de la PLATAFORMA** —hoy
   Alexis y una segunda que él nombre—, no plataforma + dueño. La razón define al mecanismo: el
   break-glass existe para cuando el dueño NO está disponible, así que exigirle uno de los dos
   controles lo convierte en un grant normal con otro nombre y deja sin cubrir el único caso
   que lo justifica. El aviso va por el mismo canal que las brechas (P10 de la spec 00):
   **correo Y aviso persistente en el panel hasta que lo reconozca**, sin depender de push.
   Con esto, AC-FIDN-18 deja de estar bloqueado.
8. ~~**ARCO y retención.**~~ **RESPONDIDA** por Alexis el 11-ago-2026: el export lo
   acciona **solo `admin_tenant`, como acto de gobierno (§5.4)** — el trabajador lo pide
   por fuera de la app y el dueño lo genera; sin autoservicio nuevo que asegurar. Formato:
   **JSON estructurado**, completo y auditable; PDF/CSV se generan desde ahí con otra
   herramienta si hace falta. `retention_policy`: invitaciones vencidas **30 días**,
   solicitudes rechazadas **90 días**, dispositivos revocados **1 año**, grants expirados
   **1 año**. Registro: `docs/respuestas-dueno-2026-08-11-spec01-spec03.md`. Se implementa
   en AC-FIDN-15.
9. ~~**Curva del backoff del PIN.**~~ **RESPONDIDA** por Alexis el 09-ago-2026: la espera se
   DUPLICA a partir de medio minuto (30 s, 1, 2, 4, 8 min) y se topa en un cuarto de hora; un
   PIN correcto resetea el contador a cero. Razón: quien se equivoca de verdad es casi siempre
   el operario con guantes a las 4am, y una espera corta que crece sola lo frena sin dejarlo
   tirado; el tope existe porque el bloqueo es por usuario pero **el que espera es el turno**,
   y sin él un aparato de andén queda inutilizable toda la madrugada. Absorbida en `PIN` del
   canónico §0 — AC-FIDN-06 asierta contra la constante, jamás contra el número.
10. ~~**Solicitud con RUT ya registrado en el tenant.**~~ **RESPONDIDA** por Alexis el
    09-ago-2026: **la solicitud ENTRA y el rebote 422 sale recién al APROBAR**; la colisión la
    ve el dueño en su panel y decide si es la misma persona con teléfono nuevo o un homónimo.
    Razón, y es la misma con que se eligió `404 · 503 · 404` en AC-FTEN-05: quien tiene el link
    NO está autenticado y el link viaja por WhatsApp, así que un rebote inmediato le confirma a
    cualquiera que ese RUT trabaja en la empresa — enumerar la nómina quedaría a un RUT por
    intento. **Costo aceptado y explícito:** el trabajador se entera tarde, de modo que el
    panel del dueño debe mostrar la colisión con lo necesario para decidir en un toque.
