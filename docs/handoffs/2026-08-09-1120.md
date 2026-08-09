# HANDOFF — Plataforma FLOTA, hito (a): 25 de 28

**Traspaso.** Sesión del 09-ago-2026, 08:54 → 11:20 -04, Opus 5 esfuerzo alto, rama
`flota/specs-e1` en `~/kilopan-monorepo-flota`. Árbol limpio, todo comiteado, gate en verde.

No se traspasó por límite de tiempo: se traspasó porque **el hito (a) llegó hasta donde puede
llegar sin `apps/flota`**. Los tres ACs que faltan necesitan la app o el resto de los módulos.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m, y
> archivá este archivo en `docs/handoffs/2026-08-09-1120.md` al absorberlo.

## Estado

**25 de 28 ACs del módulo 00.** `check.sh --app=flota --full` VERDE: 10 pasos OK y 5 saltados
declarados (los cinco por lo mismo: `apps/flota` todavía no existe). `gate.sh [flota] --full`:
12 OK, 0 fallados, 0 saltados — 82 pruebas contra el cluster real y 157 asertos pgTAP en siete
suites.

Cerrados hoy: **02, 03, 04, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24,
25 y 27**. Venían de antes: 01, 06, 18, 28.

## Lo único que falta, y por qué no se pudo

| AC | Qué falta | Bloqueo real |
|---|---|---|
| **AC-FTEN-05** | ruteo subdominio → `control` → pool de SU BD | Necesita `apps/flota`: no hay nada que responda 404/503/404. La semántica ya está cerrada (Pregunta 9) y `tenants.estado` es el enum contra el que se escribe. |
| **AC-FTEN-26** | generador de la suite HTTP A-contra-B | Necesita un **manifiesto de rutas**, que no existe. **Decisión pendiente que conviene tomar con Alexis antes de escribir código:** dónde vive el manifiesto y quién define su formato. El AC asigna el generador a este módulo, así que el formato es de este módulo — pero definirlo antes de que exista una sola ruta es adivinar. |
| **AC-FTEN-19** | matriz KiloRuta `ID \| tabla/constraint \| test` | Va al final por definición: su gate exige que CADA test referenciado EXISTA en el repo, y la mayoría nace en los módulos 01–08. Hoy la matriz sería 63 filas apuntando a tests que no están. |

## Próximos pasos, en orden

1. **Arrancar el hito 0 / la app.** `apps/flota` con su `package.json` es la llave de los tres
   ACs que faltan y de los cinco pasos saltados del gate. **Ojo:** en cuanto exista ese
   `package.json`, los 5 SALTADOS se vuelven 5 ROJOS (es-CL, build standalone, perf, e2e,
   invariantes). Es lo correcto, pero hay que ir preparado: pinear 3310 (dev) y 3311 (e2e) en
   `package.json` y `playwright.config.ts` ANTES del primer arranque
   (`docs/CONTRATO_PUERTOS.md`).
2. **AC-FTEN-05** en cuanto haya ruteo.
3. **AC-FTEN-26** después de decidir dónde vive el manifiesto.
4. **AC-FTEN-19 al final del hito (a)**, cuando los módulos 01–08 tengan sus tests.
5. Ítem pendiente, anotado y NO supuesto: **verificar que el Postgres gestionado de Railway
   dé PostgreSQL ≥ 18 y `CREATE DATABASE … TEMPLATE` a demanda** (Pregunta 2). Si no los da,
   el §4.1 no se puede implementar ahí y la decisión vuelve al dueño. E1 no despliega, así que
   hay tiempo — pero es un ítem, no un supuesto.

## Cómo está armado lo que ya existe

- **`db/flota/conectar.mjs`** — la ÚNICA fuente de la cadena de conexión y del naming
  (`t_<slug>`, `app_t_<slug>`, `migrator`, `control`, `tenant_template`).
- **`db/flota/aplicar.mjs`** — mecánica de UNA base: una transacción por migración, sha256
  para detectar una migración editada después de aplicada. La contabilidad
  (`schema_migrations`) la crea el runner, no una migración.
- **`db/flota/provisionar.mjs`** — plantilla, alta de tenant, adopción de lo sembrado,
  siembra de constantes de plataforma, auditoría de rezago y de identidades rotas.
- **`db/flota/migrar.mjs`** — runner ×N: `control` primero (destino aparte), después canario →
  plantilla → cada tenant; reasienta privilegios y constantes al terminar. `verificar` es el
  modo que consume el deploy.
- **`db/flota/rol-app.mjs`** — credenciales por tenant, CONNECT acotado, REVOKE de append-only
  derivado del catálogo.
- **`db/flota/exportar.mjs`** — job exportador a `control`, ventana alineada al reloj.
- **`db/flota/offboarding.mjs`** — `pg_dump` plano y sin dueños nuestros, con restore verificado.
- **Gates propios:** `gate.sh` (12 pasos), `lint-migraciones.mjs`, `gate-constantes.mjs`,
  `gate-criterios-kiloruta.mjs`, `gate-documentos.mjs`, `gate-reglas-estaticas.mjs`,
  `pgtap.mjs` + `db/flota/pgtap/*.sql`, `guardrail.sh`.
- **Migraciones:** `db/migraciones-flota/tenant/0001…0010` y `control/0001…0003`.

## Decisiones tomadas — NO re-litigar

1. `CHECK (tenant_id = tenant_actual())` con el uuid HORNEADO como literal, no
   `(SELECT id FROM tenant_info)`, que PostgreSQL rechaza. La suite de offboarding PRUEBA que
   era la única forma segura ante `pg_restore`.
2. Cluster propio en 54331. **54329 es de eauto y no se toca.**
3. `migrator` es dueño de todas las bases; el dueño se fija AL CREARLAS.
4. `pg_hba` en `scram-sha-256` para los roles de app; `flota_admin` y `migrator` siguen en
   `trust` desde 127.0.0.1 (roles de operación del cluster de desarrollo).
5. Las políticas de dinero y de grupo fallan **hacia el cierre**: una transacción que no
   declaró su contexto no ve lo filtrado.
6. El recorte del modo `mi_flota` gana sobre un override ON (§3 dice «OFF y ocultos»).
7. La resolución de entitlements NO impide encender fuera de plan: ese guard es del hito g.
8. `tenant_theme` guarda la variante derivada CON el fondo contra el que se la validó; los
   tokens de fondo son del módulo de diseño y esta base no los inventa.
9. Ningún número de la familia §0 se copia al SQL: se siembra desde `constants.ts`.

## Cuatro trampas que ya costaron caro — que no vuelvan

1. **Una fila sembrada en la plantilla nace con el `tenant_id` centinela.** La provisión la
   adopta, pero si escribís una migración que siembra, acordate de que el CHECK NO se
   revalida al hornear la función: el error aparece recién en un `pg_dump` + restore.
2. **Un UPDATE sobre tabla vacía no dispara un trigger FOR EACH ROW.** Todo rebote de
   append-only tiene que asertar primero que la tabla no esté vacía.
3. **`current_setting(…, true)` devuelve CADENA VACÍA, no NULL**, cuando termina la
   transacción del SET LOCAL. Sin `nullif` sobre `''`, la transacción siguiente del pool
   hereda el permiso.
4. **Dentro de una transacción `now()` está congelado.** Dos filas selladas seguidas comparten
   timestamp: el orden autoritativo es el UUIDv7, no el `timestamptz`.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4, `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. Estaba ARRIBA al cerrar.
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan. FLOTA tiene
  3310/3311, todavía sin pinear.
- El motor de KiloPan (launchd `com.kilopan.ralph-loop`) trabaja en `~/kilopan-monorepo`
  sobre `main`. No commitear ahí ni matar sus procesos.

## Coordinación entre sesiones — leer antes de escribir

Durante esta sesión hubo **otra sesión trabajando en el mismo árbol** (la que entrevistó a
Alexis y levantó las respuestas a las 11 preguntas). No se pisaron porque tocaron archivos
distintos, pero se descubrió a mitad de camino y no por acuerdo previo. Dos consecuencias
prácticas:

- **No usar `git add -A`** en este árbol: barre trabajo en vuelo de la otra sesión. Agregar
  siempre por ruta explícita.
- Antes de escribir, mirar `git log --oneline -5` y `ps aux | grep "[c]laude"`.

## Preguntas al dueño

**Ninguna abierta en la spec 00.** Las 11 se respondieron el 09-ago y están absorbidas, con su
razón, en `specs/flota/00-modelo-datos-tenancy.md`. El registro del acto está en
`docs/respuestas-dueno-2026-08-09.md`.

Quedan heredadas en otras specs: **05 · pregunta 3** (cadencia del exportador, la cierra P8:
cada 5 min) y **06 · pregunta 1** (periodicidad de liquidación, la cierra P5: por TENANT, con
`semanal` de default). Conviene absorberlas ahí cuando se toquen esos módulos.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para el hito (a)
> y prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo y arrancá por «Próximos
> pasos». El módulo 00 va 25 de 28: lo que falta necesita que exista `apps/flota`. Contrato:
> `specs/flota/*.md` + `IMPLEMENTATION_PLAN_flota.md`; la constitución es
> `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su test naciendo en el
> mismo commit · citar el id del AC en el código o el test · `[x]` solo con test verde y
> marcado en la spec Y en el plan en el mismo commit · un paso SALTADO no es un paso verde ·
> nunca inventar la respuesta a una pregunta al dueño. Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni
> el contenido de negocio de `specs/kilopan/**`. Y no uses `git add -A`: puede haber otra
> sesión en el mismo árbol.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
