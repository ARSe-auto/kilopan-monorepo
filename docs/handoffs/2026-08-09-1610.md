# HANDOFF — Plataforma FLOTA: hito 0 entregado, módulo 00 en 26 de 28

**Traspaso por el límite de 5 horas.** Sesión del 09-ago-2026, 11:36 → 16:10 -04, Opus 5
esfuerzo alto, rama `flota/specs-e1` en `~/kilopan-monorepo-flota`. Árbol limpio, todo
comiteado, `check.sh --app=flota --full` en VERDE.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-09-1610.md`
> al absorberlo.

## Lo que cambió en esta sesión

Cuatro commits, en orden: `6b96ed5` (absorción del traspaso anterior) · `16fd3bc`
[AC-FMIG-01] · `c5bd3c3` (esqueleto de `apps/flota`) · `40425c5` [AC-FTEN-05].

**`apps/flota` EXISTE.** Era la llave de todo lo que faltaba. Con ella,
`check.sh --app=flota --full` pasó de **10 OK / 5 saltados** a **14 OK / 0 fallados / 1
saltado**. El único saltado es «invariantes de BD», y lo está por diseño: los de FLOTA
corren en `db/flota/gate.sh` (12 pasos, cluster real, 82 pruebas + 157 asertos pgTAP).

**Puertos pineados antes del primer arranque**, que era el riesgo declarado del traspaso
anterior: 3310 en `package.json`, 3311 en `playwright.config.ts`.

## Dos decisiones de arquitectura que NO conviene re-litigar

1. **`apps/flota` NO usa `output: standalone`** (KiloPan sí). El ruteo por subdominio tiene
   que decidir entre 404, 503 y servir ANTES de que Next vea el request, y eso exige Node
   con el driver de Postgres. El middleware de Next corre en el Edge y su runtime Node **no
   existe en la versión instalada** (15.5.21: `nodeMiddleware` no está en su esquema de
   config — verificado, no supuesto). De ahí `apps/flota/servidor.mjs`, que es el mismo
   proceso en desarrollo y en producción. Y standalone + servidor propio no conviven: al
   arrancar dentro del standalone, Next se pone a **descargar el paquete de SWC**.
2. **`packages/miga` entró al alcance de `db/flota/gate-constantes.mjs`** con AC-FMIG-01.
   Eso destapó 39 duplicaciones vivas de la familia §0 dentro de los componentes; ninguna
   se tapó relajando un patrón. `packages/miga/src/estructura.ts` publica los tokens
   estructurales del §5.1 en 3 capas y `tokens.ts` deriva su grilla del canónico.

## Próximos pasos, en orden

1. **AC-FTEN-26** — generador de la suite HTTP A-contra-B autogenerada del manifiesto de
   rutas. **Ahora sí se puede empezar**: `apps/flota` tiene sus primeras rutas (`/` y
   `/api/tenant`) y el ruteo por subdominio del AC-FTEN-05 es el mecanismo contra el que la
   suite va a pedir. Sigue en pie la observación del traspaso anterior: **dónde vive el
   manifiesto de rutas y quién define su formato es una decisión que conviene tomar con
   Alexis antes de escribir código** — el AC asigna el generador a este módulo, así que el
   formato es de este módulo, pero definirlo con dos rutas en el árbol es adivinar. Una
   opción honesta: escribirlo derivándolo del `app/` de Next (que es la fuente real de las
   rutas) y declarar el alcance.
2. **AC-FTEN-19** — matriz KiloRuta. Va al final del hito (a) por definición: su gate exige
   que CADA test referenciado EXISTA en el repo, y la mayoría nace en los módulos 01–08.
3. **Hito (b)** — spec 01, identidad y enrolamiento. 21 ACs.
4. Ítem pendiente, anotado y NO supuesto: **verificar que el Postgres gestionado de Railway
   dé PostgreSQL ≥ 18 y `CREATE DATABASE … TEMPLATE` a demanda** (Pregunta 2). E1 no
   despliega, así que hay tiempo — pero es un ítem, no un supuesto.

## Deudas reales que dejó esta sesión (ninguna tapada)

- **`scripts/deploy.sh` del §9.1 no existe.** El hito 0 lo nombra como entrega («clone de
  HEAD, aborta si el SHA difiere, migraciones con `migrator` antes de sustituir la versión
  servida, `railway up` desde el clon») y `guardrail.sh` debería poner en rojo toda
  invocación de `railway` fuera de él. Hoy existe `packages/metodo/scripts/desplegar.sh`
  (de KiloPan) y esa regla de guardrail no está escrita para FLOTA. **No tiene AC**: es
  precondición de proceso, no ítem del plan.
- **La provisión no registra el tenant en `control.tenants`.** `provisionar.mjs` crea la
  base y el rol; el registro lo hacen hoy las suites y el fixture del e2e. En producción lo
  hará el wizard (AC-FMIG-14, hito g). Anotado para que no sorprenda.
- **En CI no corre un proceso PgBouncer** (no está instalado). Declarado dentro del AC.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4, `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. Estaba ARRIBA al cerrar.
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`, y las
  cuatro del fixture de ruteo (`t_ruteo_activo`, `t_ruteo_activo_b`, `t_ruteo_susp`,
  `t_ruteo_arch`), que el e2e recrea en cada corrida.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan.
- El motor de KiloPan (launchd `com.kilopan.ralph-loop`) trabaja en `~/kilopan-monorepo`
  sobre `main`. No commitear ahí ni matar sus procesos. Al cerrar esta sesión NO había
  ningún `loop.sh` corriendo y el 3301 estaba libre.

## Coordinación entre sesiones

Sigue vigente: **no usar `git add -A`** en este árbol (puede haber otra sesión en vuelo);
agregar siempre por ruta explícita, y mirar `git log --oneline -5` antes de escribir.
`apps/kilopan/next-env.d.ts` lo reescribe `next build` según qué distDir se construyó
último: es churn de artefacto, no un cambio de nadie — se descarta, no se comitea.

## Preguntas al dueño

**Ninguna abierta en la spec 00.** Las 13 están respondidas y absorbidas; el registro del
acto está en `docs/respuestas-dueno-2026-08-09.md`. Quedan heredadas en otras specs:
**05 · pregunta 3** (cadencia del exportador, la cierra P8: cada 5 min) y **06 · pregunta 1**
(periodicidad de liquidación, la cierra P5: por TENANT, `semanal` de default).

La que sí conviene hacerle a Alexis antes del próximo AC está en el paso 1 de arriba: el
formato y el hogar del manifiesto de rutas.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para el hito
> (a) y prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo, archivalo en
> `docs/handoffs/2026-08-09-1610.md` y arrancá por «Próximos pasos». El hito 0 está
> entregado y `apps/flota` ya existe con su servidor propio; el módulo 00 va 26 de 28.
> Contrato: `specs/flota/*.md` + `IMPLEMENTATION_PLAN_flota.md`; la constitución es
> `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su test naciendo en
> el mismo commit · citar el id del AC en el código o el test · `[x]` solo con test verde y
> marcado en la spec Y en el plan en el mismo commit · un paso SALTADO no es un paso verde
> · nunca inventar la respuesta a una pregunta al dueño. Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql`
> ni el contenido de negocio de `specs/kilopan/**`. Y no uses `git add -A`.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
