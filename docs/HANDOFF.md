# HANDOFF — Plataforma FLOTA: hito (b) con el servidor de identidad entero

**Traspaso por el límite de 5 horas.** Sesión del 09-ago-2026, rama `flota/specs-e1` en
`~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto. Árbol limpio salvo churn de artefacto (ver
abajo), todo comiteado, `check.sh --app=flota --full` en VERDE con 14 OK · 0 fallados · 1
saltado declarado.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-09-2000.md`
> al absorberlo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 00 (tenancy) | 26 de 28 | **27 de 28** |
| Módulo 01 (identidad) | 0 de 21 | **13 de 21** |
| Preguntas al dueño de la spec 01 | 10 abiertas | **2 abiertas** (4 y 8, las dos P2) |

Los trece ACs: **AC-FTEN-26** (cierra el módulo 00 salvo AC-FTEN-19) y **AC-FIDN-01, 03, 04,
06, 08, 09, 10, 11, 14, 18, 19, 21**.

**Verificado desde cero al cerrar:** se borraron las 8 bases del cluster —`control`, la
plantilla, el canario y todos los fixtures— y el gate completo se reconstruyó desde el repo
con los 14 pasos en verde. No hay estado escondido ni dependencia de orden entre suites.

## Lo que hay que saber para seguir, y no se lee del diff

**1. El manifiesto de rutas se DERIVA del árbol** (`apps/flota/rutas/`). Se regenera con
`node apps/flota/rutas/generar.mjs --escribir` y el gate lo diffea. **Cada ruta nueva frena el
build hasta que se declara su caso de cruce** — pasó tres veces en esta sesión y funcionó las
tres. No es burocracia: de ese manifiesto cuelgan las pruebas de AUSENCIA de los módulos 06 y
07 (cero endpoint de emisión de DTE, cero línea manual) y la de impersonación de AC-FIDN-11.

**2. La sesión ES el aparato.** `Authorization: Portador <secreto>`, comparado por hash contra
`dispositivos.secreto_hash` en CADA request (`apps/flota/src/servidor/sesion.ts`). No hay
cookie ni token con vencimiento. Por eso revocar corta en el request siguiente. Todo endpoint
nuevo que necesite identidad usa `resolverSesion()`.

**3. El PIN pasa SIEMPRE por `verificarPin`** (`src/servidor/pin.ts`), que trae el lockout por
usuario. Cualquier puerta nueva que acepte un PIN y no pase por ahí es una puerta sin candado
—ya pasó con `/api/reenrolamiento`, y por eso tiene su prueba hasta el 429.

**4. Las suites que escriben en tablas append-only PROVISIONAN SU PROPIA BASE.** Una vez que
hay firmas o eventos apuntando a una persona, ninguna otra suite puede limpiar `personas`: el
DELETE rebota 42501. Lo hacen así `anonimizacion.spec.ts`, `sesion.spec.ts` (su segunda
mitad), `firmas.spec.ts` y `db/flota/suite-bd/ruts.test.mjs`. Las demás comparten
`t_ruteo_activo` y limpian en orden: `dispositivos` ANTES que `usuarios`.

**5. Al editar una migración YA APLICADA, el runner la frena por sha** — y tiene razón. Para
recuperarse hay que borrar y rehacer las bases de fixture (`tenant_template`, `t_canary`,
`t_gate_*`, `t_ruteo_*`), correr `node db/flota/migrar.mjs aplicar` y reponer los tenants con
`node apps/flota/e2e/preparar-tenants.mjs`. Pasó una vez; conviene no editar migraciones
aplicadas.

## Gates nuevos que hay que respetar de acá en adelante

- `db/flota/gate-logs.mjs` — ni PIN (tampoco su hash), ni RUT sin `enmascararRut()`, ni
  secreto de dispositivo en un log.
- `db/flota/gate-pii.mjs` — identificadores solo en `personas`, `empresas_cliente` y
  `solicitudes_acceso`; `nombre` prohibido en tablas de clase CAPTURA.
- `break_glass` y `grants_soporte` viven en `control` y la lista de tablas de ese plano es
  LITERAL (`db/flota/suite-bd/control.test.mjs`): una tabla nueva ahí pone el gate en rojo
  hasta declararla. Pasó hoy y funcionó.
- `db/flota/gate-ruts.mjs` — **todo RUT del árbol tiene que estar en
  `db/flota/ruts-sinteticos.mjs`**. Al escribir un test con un RUT nuevo, agregarlo ahí con su
  razón; si no, el gate frena. (Sí: también dentro del test que prueba que frena.)
- El guardrail rebota la palabra `TODO` en mayúsculas, aunque sea español legítimo. Escribir
  «cada» o «entero» en su lugar.

## Próximos pasos, en orden

1. **AC-FIDN-12, panel de gobierno del dueño.** Es el P1 más grande que queda y ahora está
   DESBLOQUEADO: necesita endpoints con sesión de `admin_tenant` (que ya existe) para emitir,
   pausar y revocar invitaciones, aprobar y rechazar solicitudes, inventario de dispositivos,
   revocar en 1 toque, y rotar PIN/desbloquear —esto último con el **código puente de un solo
   uso** que el dueño respondió hoy—. Rebote exigido: acción de gobierno con rol distinto de
   `admin_tenant` ⇒ 403 y 0 filas. Toda la lógica de dominio está escrita; falta la capa HTTP.
2. **La PWA.** Es lo que bloquea a AC-FIDN-02 (e2e del flujo feliz contando toques), 05
   (standalone + persist), 17 (validación de RUT en vivo) y 20 (sin consentimiento). Hoy
   `apps/flota` sirve el shell de Miga y cuatro rutas de API; no hay una sola pantalla del
   §5.4. Es el trabajo más grande que queda del hito (b).
3. **AC-FIDN-07, andén** — su centinela 9 necesita el outbox offline, que nace en el hito (e).
   Conviene dejarlo para entonces y declararlo, no adelantarlo a medias.
4. **AC-FTEN-19** (matriz KiloRuta) sigue yendo al final del hito (a) por definición: su gate
   exige que cada test referenciado EXISTA, y ahora existen muchos más que ayer.

## Preguntas al dueño que siguen abiertas

- **Spec 01 · pregunta 4** — cuándo se registra la passkey del admin (¿wizard de alta o primer
  uso de «transferir propiedad»?) y cómo se recupera si se pierde. Bloquea AC-FIDN-13 (P2).
- **Spec 01 · pregunta 8** — quién acciona el export ARCO (¿solo `admin_tenant` o también el
  titular?), en qué formato, y los plazos de `retention_policy`. Bloquea AC-FIDN-16 (P2) y
  mantiene la tabla de retención vacía, que es lo correcto hasta tener los valores.
- Heredadas de otras specs: **05 · pregunta 3** y **06 · pregunta 1**, ya cerradas por P8 y P5
  de la spec 00 pero sin absorber en su texto.

## Deudas reales, ninguna tapada

- **`scripts/deploy.sh` del §9.1 sigue sin existir**, y `guardrail.sh` sigue sin la regla que
  ponga en rojo toda invocación de `railway` fuera de él. Es precondición de proceso, no ítem
  del plan: no tiene AC.
- **Verificar que el Postgres gestionado de Railway dé PostgreSQL ≥ 18 y
  `CREATE DATABASE … TEMPLATE`** (pregunta 2 de la spec 00). Ahora pesa más que ayer: el código
  usa `RETURNING OLD`, que es de PostgreSQL 18. E1 no despliega, así que hay tiempo — pero es
  un ítem, no un supuesto.
- **La provisión sigue sin registrar el tenant en `control.tenants`**: lo hacen las suites y el
  fixture; en producción lo hará el wizard (AC-FMIG-14, hito g).
- **En CI no corre un proceso PgBouncer** (no está instalado). Declarado dentro de su AC.
- `apps/flota/e2e/reenrolamiento.spec.ts` y `pin.spec.ts` comparten la base del fixture de
  ruteo y limpian en `beforeAll`. Si una suite futura escribe firmas ahí, hay que darle base
  propia como a las otras cuatro.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4 en `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. **Estaba ARRIBA al cerrar.**
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b` y las cuatro
  del fixture de ruteo. Las bases `t_gate_anonimizacion`, `t_gate_revocacion`, `t_gate_firmas`
  y `t_gate_ruts` las crean y borran sus propias suites.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan.
- El motor de KiloPan (launchd `com.kilopan.ralph-loop`) trabaja en `~/kilopan-monorepo` sobre
  `main`. Al cerrar no había ningún `loop.sh` corriendo.
- **Dependencia nueva:** `@node-rs/argon2` en `apps/flota`. Prebuilt, sin compilador; `pnpm
  audit --audit-level=high` en verde.

## Churn de artefacto que NO se comitea

`apps/kilopan/next-env.d.ts` lo reescribe `next build` según qué distDir se construyó último.
`packages/metodo/panel/last-green.{sha,tag}` los estampa el gate. Los tres se descartan.

## Coordinación entre sesiones

Sigue vigente: **no usar `git add -A`** en este árbol; agregar siempre por ruta explícita y
mirar `git log --oneline -5` antes de escribir.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para el hito y
> prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo, archivalo en
> `docs/handoffs/2026-08-09-2000.md` y arrancá por «Próximos pasos». El módulo 00 va 27 de 28 y
> el 01 va 12 de 21: el servidor de identidad está entero y lo que queda necesita la PWA o una
> de las dos preguntas abiertas. Contrato: `specs/flota/*.md` + `IMPLEMENTATION_PLAN_flota.md`;
> la constitución es `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su
> test naciendo en el mismo commit · citar el id del AC en el código o el test · `[x]` solo con
> test verde y marcado en la spec Y en el plan en el mismo commit · un paso SALTADO no es un
> paso verde · nunca inventar la respuesta a una pregunta al dueño. Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni el
> contenido de negocio de `specs/kilopan/**`. Y no uses `git add -A`.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
