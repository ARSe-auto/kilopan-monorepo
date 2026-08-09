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
- [ ] (P1) e2e del flujo feliz §5.4 contando ACCIONES (convención §5.3): dueño emite
      invitación por rol en ≤4 toques (QR + link firmado + código corto fallback);
      trabajador completa RUT auto-formateado `12.345.678-5` + nombre + PIN ×2 con
      teclado numérico PROPIO (jamás el del sistema) + «Solicitar acceso» sin campo de
      email; pantalla «Esperando aprobación» con guía A2HS; dueño aprueba en 1 toque y
      la sesión arranca sola. Selectores solo por data-testid/term_key; axe/targets §0
      verdes; cero strings en inglés — oráculo: CI [AC-FIDN-02]
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
- [ ] (P1) La aprobación (1 toque) empareja persona+dispositivo+rol y RECIÉN AHÍ emite
      el secreto UNA vez contra la clave pública registrada en la solicitud: en BD
      queda solo `secreto_hash`; una segunda petición de emisión para el mismo
      dispositivo rebota y no re-emite; el rechazo deja `rechazada` y no emite nada;
      aprobación de rol `cliente` sin `empresa_cliente_id` rebota 422 (§4.3). Y el rebote
      que la pregunta 10 trasladó hasta acá (respondida el 09-ago-2026): aprobar una solicitud
      cuyo RUT ya pertenece a una persona del tenant ⇒ 422 tipado y 0 filas nuevas, con la
      colisión IDENTIFICADA en la respuesta —quién es el titular actual— para que el dueño
      decida en 1 toque si es la misma persona con teléfono nuevo (F-E) o un homónimo; acá sí
      se puede nombrar, porque quien aprueba es el `admin_tenant` y ya conoce su nómina —
      oráculo: CI [AC-FIDN-04]
- [ ] (P1) El enrolamiento NO se completa sin display-mode standalone Y persist()
      concedido: con cualquiera de los dos ausente el dispositivo no queda operable y
      la UI lo dice (degradación visible, no silencio); `persist_denegado` se registra
      en `client_metric`; al concederse ambos, el dispositivo queda activo con
      `is_standalone=true` y `storage_persisted=true` (§4.3, §5.4, §4.6) — oráculo: CI
      [AC-FIDN-05]
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
- [ ] (P1) Dispositivo de andén: enrolado por el admin como activo del tenant (tipo
      `anden`, sin persona dueña); los operarios rotan por PIN; al autenticarse otra
      identidad se purga SOLO el snapshot (re-descargable) y el outbox del usuario
      anterior persiste firmado por el enrolamiento y se replayea al volver la red —
      test centinela 9: A captura 3 mutaciones offline, B se autentica, vuelve la red,
      count=3 filas de A (§4.3, §4.7, §5.4, §9.3) — oráculo: CI [AC-FIDN-07]
- [ ] (P1) Re-enrolamiento como flujo normal: «Ya tengo cuenta» → RUT+PIN → solicitud
      de enrolamiento del teléfono nuevo; la aprobación del dueño revoca el dispositivo
      anterior EN EL MISMO ACTO (transacción única: nuevo activo + anterior con
      revocado_at); el constraint de 1 dispositivo personal activo por operario se
      cumple antes, durante y después (jamás 2 activos, jamás 0 tras aprobar) (§4.3,
      §5.4) — oráculo: CI [AC-FIDN-08]
- [ ] (P1) Revocación soft con efecto inmediato server-side (siguiente request del
      dispositivo revocado: sesión inválida; el dueño lo hace en 1 toque desde el
      inventario). Capturas offline del dispositivo revocado — caso de degradación,
      JAMÁS rebote (§4.2): llegan ≤72 h ⇒ 2xx + cuarentena con flag `post_revocacion`;
      llegan >72 h ⇒ 2xx + flag `post_revocacion_tardia` + review_queue severidad alta
      + evento; rechazos = 0 (centinela 4 §9.3) — oráculo: CI [AC-FIDN-09]
- [ ] (P1) Firmas con significado según rol (enum {recibio_conforme, libero, rechazo,
      verifico, aprobo}): la firma puntual por PIN en dispositivo ajeno NO abre sesión
      ni desplaza la del titular — test centinela 12: chofer firma por PIN en el
      dispositivo del responsable_carga (fixture sobre `objeto_ref` de custodia cuando
      exista el módulo de encargos/rutas/custodia, hito 9.1(4)(d) — ver Dependencias;
      hasta entonces, `objeto_ref` genérico sembrable: §9.3.12 solo exige «firma en
      dispositivo ajeno + PODs posteriores válidos», no custodia), la sesión del
      responsable sigue intacta y sus PODs posteriores sincronizan válidos; la firma llegada por sync de dispositivo
      revocado entra 2xx con los flags de AC-FIDN-09 (clase CAPTURA) (§4.3, §9.3) —
      oráculo: CI [AC-FIDN-10]
- [ ] (P1) Soporte sin god-mode: sin grant vigente, el personal de plataforma tiene
      CERO visibilidad del tenant (0 filas, 0 rutas); el grant del dueño lleva alcance
      (solo-lectura|módulos) y expiración 24 h|7 d con caída AUTOMÁTICA al vencer (sin
      acción humana) y revocación anticipada; registro en `control` (§4.1) y begin/end
      de cada acceso en la auditoría visible del tenant; NO existe endpoint de
      impersonación (verificado contra el manifiesto de rutas) (§0, §4.3, §7.9). El
      break-glass se verifica aparte en AC-FIDN-18: su mecánica depende de Preguntas
      al dueño #7 y no cabe todavía en un oráculo CI — oráculo: CI [AC-FIDN-11]
- [ ] (P1) Panel de gobierno exclusivo del dueño: emitir/pausar/revocar invitaciones,
      aprobar/rechazar solicitudes, inventario vivo de dispositivos, revocar 1 toque,
      rotar PIN/desbloquear, auditoría de accesos (incluidas sesiones de soporte),
      grants. Rebotes: cada acción de gobierno con rol `operador` (o cualquier rol no
      admin) ⇒ 403 y 0 filas; recurso de identidad de OTRO tenant ⇒ 404 siempre y BD
      ajena sin cambios (suite HTTP A-contra-B autogenerada, centinela 2); toda acción
      de gobierno escribe audit_trail + evento (§0, §5.4, §9.3) — oráculo: CI
      [AC-FIDN-12]
- [ ] (P2) Transferir propiedad del tenant exige passkey/WebAuthn del admin — única
      passkey del sistema (prohibido WebAuthn en cualquier otro flujo, grep del
      manifiesto de rutas): sin ceremonia passkey válida ⇒ rebote 422 y 0 cambios; con
      ella, el nuevo dueño queda `admin_tenant`, el anterior pierde el gobierno y todo
      queda en audit_trail; e2e con virtual authenticator (§5.4) — oráculo: CI
      [AC-FIDN-13]
- [ ] (P1) 21.719 estructural: ninguna tabla de HECHOS lleva PII — las tablas de
      hechos/append-only y operativas (eventos, reading, evidence, firmas,
      entregas_pod, custody_transfer, audit_trail, review_queue, client_metric)
      referencian ID opaco (§7.8); el linter lo mecaniza con whitelist CERRADA:
      columnas de nombre/rut/contacto permitidas SOLO en `personas` (§4.3) y en
      `empresas_cliente` (§4.5 — rut/contacto de la persona jurídica contratante,
      MANDADOS por el maestro; jamás pueden poner el gate en rojo); cualquier otra
      tabla con esas columnas ⇒ rojo (§7.8, §4.5, §3.E1.15). La anonimización, la UI
      sin consentimiento y los seeds se verifican aparte (AC-FIDN-19/20/21) —
      oráculo: CI [AC-FIDN-14]
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
- [ ] (P1) Rebote de PLANIFICACIÓN por RUT inválido (§4.2): POST de solicitud de
      acceso con RUT que no pasa módulo 11 ⇒ 422 tipado en servidor y 0 filas en
      `solicitudes_acceso` y `personas`; y e2e de que el cliente valida módulo 11 EN
      LÍNEA sobre el RUT auto-formateado `12.345.678-5` y no envía mientras sea
      inválido (el 422 del servidor se ejercita por request directo, saltándose el
      cliente) (§0, §4.2, §4.3, §5.4) — oráculo: CI [AC-FIDN-17]
- [ ] (P1) Break-glass de soporte (§4.3, §7.9): doble control + notificación forzosa
      + registro inmutable. BLOQUEADO hasta la respuesta a Preguntas al dueño #7
      (quiénes son los DOS controles y por qué canal llega la notificación sin
      depender de push, §7.6): contra actores y canal indefinidos no hay test
      escribible; resuelta la pregunta, el test se parametriza con los dos controles
      y el canal concretos y el AC entra al plan del build — oráculo: CI
      (condicionado a Pregunta #7) [AC-FIDN-18]
- [ ] (P1) Anonimización 21.719 sin tocar el ledger (§4.3, §7.8): anonimizar una
      persona con historial ⇒ `anonimizada_en` set y campos identificantes
      nulificados en `personas`, con el ledger INTACTO — mismos counts de eventos,
      PODs y firmas, todos válidos referenciando el ID opaco; centinela 6 no se
      viola — oráculo: CI [AC-FIDN-19]
- [ ] (P1) La UI de enrolamiento NO presenta consentimiento a trabajadores (base de
      licitud = ejecución de contrato, §7.8): e2e sobre F-B/F-C/F-E sin checkbox ni
      texto de consentimiento + grep de strings del flujo — oráculo: CI [AC-FIDN-20]
- [ ] (P1) Seeds y fixtures solo con RUTs sintéticos de LISTA CONGELADA versionada en
      fixtures — mecaniza el «irreales» de §7.8/§10, que no tiene oráculo directo:
      test CI que verifica que TODO RUT sembrado (a) pasa módulo 11 y (b) pertenece a
      la lista congelada; un RUT fuera de la lista ⇒ rojo (§7.8, §9.2, §10) —
      oráculo: CI [AC-FIDN-21]

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
2. **«Rotar PIN»:** el maestro nombra la capacidad (§5.4) pero no la mecánica. Si el
   trabajador olvidó su PIN, ¿cómo se restablece sin que el dueño conozca el valor
   nuevo (argon2id, jamás en logs)? ¿Código puente de un solo uso mostrado al dueño y
   PIN nuevo definido en el dispositivo enrolado?
3. **Rol `cliente`:** ¿la invitación de rol `cliente` lleva `empresa_cliente_id`
   embebido (emitida desde la ficha de la empresa contratante) o el dueño lo asigna al
   aprobar? ¿El usuario del portal exige dispositivo enrolado standalone+persist como
   los operarios, o basta sesión web (usará escritorio)? El maestro define el flujo
   §5.4 solo para «trabajador».
4. **Passkey del admin:** ¿cuándo se registra (wizard de alta vs primer uso de
   «transferir propiedad») y cuál es la vía de recuperación si se pierde (¿break-glass
   §7.9)? El maestro no lo dice.
5. ~~**Distribución de la invitación** y formato del código corto.~~ **RESPONDIDA** por
   Alexis el 09-ago-2026: **share-sheet del propio teléfono del dueño** (o copiar), SIN
   pasarela de SMS ni de WhatsApp — cero integraciones, cero costo por mensaje, y sin meter en
   el camino crítico del enrolamiento el modo de falla de un proveedor de mensajería: el
   mensaje que no llegó. **Código corto de 8 caracteres en alfabeto sin ambiguos** (sin 0/O,
   sin 1/I/L): se dicta en voz alta en un galpón ruidoso y se teclea con guantes; en ese
   alfabeto son del orden de 10^12 combinaciones para un token que además expira a los 7 días
   y se revoca en 1 toque. Absorbida en `INVITACION` del canónico §0.
6. **Visibilidad de solicitudes pendientes:** ¿generan señal en el semáforo
   «Hoy»/«Por revisar» o solo badge dentro del panel de enrolamiento? El Anexo B no
   trae señal de enrolamiento y el maestro prohíbe depender de push.
7. **Break-glass (§7.9):** ¿quiénes son los DOS controles (dos personas de la
   plataforma, o plataforma + dueño del tenant) y por qué canal llega la «notificación
   forzosa» al tenant sin depender de push (§7.6)?
8. **ARCO y retención:** ¿QUIÉN acciona el export ARCO — solo `admin_tenant` como
   acto de gobierno (§5.4), o también autoservicio del titular? (el maestro solo dice
   «export ARCO» sin actor, §3.E1.15; bajo la Ley 21.719 el titular del derecho es la
   persona). Además: formato (¿JSON/CSV/PDF?) y alcance exacto; y plazos de
   `retention_policy` para invitaciones vencidas, solicitudes rechazadas,
   dispositivos revocados y grants expirados — el DDL de la tabla nace en este módulo
   (AC-FIDN-01) pero el maestro no fija valores.
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
