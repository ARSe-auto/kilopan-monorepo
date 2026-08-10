# HANDOFF — El hito (c) arrancó: 7 de 22 del módulo 02, con el corazón EV en pie

**Traspaso de la sesión del 09-ago-2026 (20:14 → 21:45), rama `flota/specs-e1` en
`~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto.** Árbol limpio salvo el churn de artefacto de
siempre, todo comiteado, `check.sh --app=flota --full` en **VERDE con 14 OK · 0 fallados · 1
saltado declarado** (158 casos e2e).

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-10-0000.md` al
> absorberlo. **Alexis pidió expresamente que NO se creen chips de continuación**: el traspaso
> es este archivo y se retoma solo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 02 (vehículos/energía/agenda) | 0 de 22 | **7 de 22** |
| ACs cerrados de la plataforma | 46 de 197 | **53 de 197** |
| Rutas que sirve `apps/flota` | 20 | **29** |
| Migraciones de tenant | 15 | **21** (última: `0021_bloques_agenda`) |
| Criterios KiloRuta con test | 11 | **15** (entraron KR-04, KR-14, KR-15, KR-44, KR-55) |

Los siete ACs: **AC-FVEH-01** (alta con patente + tipo y su baseline de acciones), **AC-FVEH-02**
(CRUD del dueño y DELETE que desactiva), **AC-FVEH-06** (el vehículo-día con su EXCLUDE),
**AC-FVEH-05** (odómetro y SOC por `reading`), **AC-FVEH-20** (la vista `eevd_semanal`),
**AC-FVEH-09** (la fórmula única de energía) y **AC-FVEH-07** (la agenda por vehículo).

## Lo que hay que saber para seguir, y no se lee del diff

**1. Las proyecciones están cerradas por los dos lados.** `vehiculos.odometro`/`soc` los mueve
SOLO `proyectar_lectura()` (migración 0019), que enciende el GUC `flota.proyectando`; el
guardián de la 0016 rebota a cualquier otro con `23514`. Para tocarlas desde otro trigger hay
que encender ese GUC dentro de la misma transacción. El pgTAP ejerce las dos mitades.

**2. Una lectura llega al vehículo por el TURNO.** `reading` no tiene `vehiculo_id` (§4.6 la
define genérica). Sin turno, la lectura entra igual con flag `sin_turno` y no proyecta nada.

**3. `EVENTOS_OPERACION` en `servidor/gobierno.ts` es la mitad en código del catálogo.** Todo
código que use `registrarEvento` tiene que estar sembrado en `evento_tipo` por una migración, o
el acto entero se deshace. Los del terreno NO llevan prefijo `gobierno.`: la auditoría de
accesos del §3.E1.15 filtra por ese prefijo y se ahogaría.

**4. El orden de limpieza de los fixtures vive en `apps/flota/e2e/limpiar.mjs`.** Una tabla
nueva del módulo se agrega ahí, arriba de la que referencia, y las cinco suites se enteran
solas. No volver a escribir listas de `delete` en un `beforeAll`.

**5. Las suites que tocan tablas append-only miden por DIFERENCIA.** `eventos`, `audit_trail`,
`reading`, `evidence` y `client_metric` rebotan el DELETE con 42501 y acumulan lo que dejó el
fixture de cada suite anterior. Un total esperado se rompe con el AC siguiente.

**6. Hay dos grep-gates de la familia canónica y son complementarios.**
`gate-constantes.mjs` vigila los VALORES; `gate-formula-energia.mjs` vigila la ARITMÉTICA
(decide por operador, no por mención, e ignora los comentarios). Ninguno de los dos se dispara
al CITAR una sección del maestro: el patrón del contraste mínimo (4.5) lleva un lookbehind
porque «(§4.5)» lo activaba.

**7. Las fechas visibles salen de `packages/nucleo-comun/src/fechas.ts`** y de ningún otro
lado. La semana empieza el LUNES, igual que `date_trunc('week', …)` de `eevd_semanal`.

**8. El primer turno de un tenant SELLA su `config_version`** con los entitlements efectivos
leídos de `control` (`servidor/turnos.ts`). Hoy nadie más las sella; AC-FVEH-18 es quien va a
manejar la deriva con turno abierto.

## Próximos pasos, en orden

### 1. AC-FVEH-03 — `vehiculo_documentos` (lo que sigue)

Diseñado y sin bloqueos duros. Lo que hace falta:

1. **Migración 0022** con `vehiculo_documentos`(tipo `text`, `vence_el date`, `sha256`
   write-once §4.6, FK compuesta a `vehiculos`). Clase **PLANIFICACIÓN**. El catálogo de tipos
   es texto y NO enum: la **pregunta 2** (lista cerrada vs filas por tenant) sigue abierta y un
   enum la respondería por el dueño.
2. **El rebote SOLO con feature ON.** El entitlement efectivo se lee de `control`
   (`entitlements_efectivos`, misma vía que `versionVigente` en `servidor/turnos.ts`) — o, mejor
   para un turno abierto, del snapshot que ya viaja en `turnos.config_version_id`. Con OFF no
   rebota NADA: es el mismo patrón que `vehicle_certification` (§4.9).
3. **Dónde rebota:** «planificar/asignar un vehículo con documento vencido» ⇒ hoy eso son
   `POST /api/agenda` y `POST /api/turnos`, las dos puertas de planificación que existen.
4. **Estado con TEXTO, jamás solo color** (§5.1) en `/vehiculos`.

Ojo: el `sha256` write-once necesita su trigger, y el §4.6 dice que el hash viaja ANTES del
binario.

### 2. AC-FVEH-17 — recordatorios de vencimiento

Va justo después de AC-FVEH-03 porque lo consume. La **pregunta 1** deja abiertos el NOMBRE de
la fila de `parametros` y el seed de anticipación: sin eso, «por vencer» no tiene umbral. Una
salida honesta es que sin fila de parámetros solo se muestre «vencido», y que «por vencer»
aparezca en cuanto la fila exista — pero eso hay que declararlo como cláusula, no dejarlo pasar.

### 3. AC-FVEH-12 — tablero «Listos para salir»

La fórmula ya está (AC-FVEH-09). El AC mismo acota lo verificable hoy: fórmula única aplicada,
sugerencia a 1 clic y degradación con estado vacío accionable. La rama «necesario» espera
`rutas.km_presupuesto_energia` del hito (d), y la semántica sugerir-vs-crear es la **pregunta
14**.

### 4. AC-FVEH-04 (chequeos), AC-FVEH-10 (apertura F3) y AC-FVEH-21 (cierre F5)

Los tres son de superficie de terreno y llevan presupuesto de toques del §5.3 (≤9 y ≤6). El
contador de acciones que hay que reusar está en `e2e/vehiculos.spec.ts` (`llenar` y `tocar`
suman 1 cada uno, con la convención cerrada del §5.3) y el artefacto de baseline en
`e2e/baseline-acciones.mjs`.

### 5. AC-FVEH-22 (cierre forzado, KR-41) necesita el estado nuevo del enum

`turno_estado` tiene hoy `abierto|cerrado|anulado` a propósito: el cierre forzado tiene que ser
DISTINGUIBLE de un cierre real y su valor lo agrega su propio AC con `ALTER TYPE … ADD VALUE`.

## Preguntas al dueño que siguen abiertas

- **Spec 02 — nueve**: 1 (canal y anticipación de los recordatorios), 6 (clase de `turnos` si la
  apertura fuera offline), 7 (turno anulado y el denominador), 9 (conteo de SOC), 11 (OCR),
  12 (colisiones al duplicar semana), 13 (método de estimación de consumo), 14 (sugerir vs
  crear el bloque de recarga) y **15 — NUEVA**: el catálogo de tipos de vehículo. El maestro
  pide «tipo (chips)» y no enumera los chips en ninguna parte; mientras tanto los chips salen
  de los tipos que ese tenant ya usó.
- **Spec 01 — dos**: pregunta 4 (passkey del admin, bloquea AC-FIDN-13) y pregunta 8 (export
  ARCO, bloquea AC-FIDN-15).
- Heredadas: **05 · pregunta 3** y **06 · pregunta 1**, ya cerradas por P8 y P5 de la spec 00
  pero sin absorber en su texto.

## Deudas reales, ninguna tapada

- **`tenant_info.id` ≠ `control.tenants.id`.** Se rodea resolviendo por slug. En producción el
  alta la hará el wizard (AC-FMIG-14, hito g); ese día conviene que los dos ids sean el mismo.
- **`scripts/deploy.sh` del §9.1 sigue sin existir**, y `guardrail.sh` sigue sin la regla que
  ponga en rojo toda invocación de `railway` fuera de él.
- **Verificar que el Postgres gestionado de Railway dé PostgreSQL ≥ 18 y
  `CREATE DATABASE … TEMPLATE`** (pregunta 2 de la spec 00). El código usa `RETURNING OLD` y
  ahora además `btree_gist` (confiable desde PG 13, la instala el rol `migrator`).
- **El rechazo de la CAPTURA de un aparato no operable** lo tienen que exigir los endpoints de
  sync del módulo 04 (hito e).
- **`BotonPrimario` de Miga sigue con el acento de KiloPan horneado** (`#C2410C`). El tema del
  tenant entra en el hito g (AC-FMIG-02).
- **KR-09 quedó desactualizado por su propia respuesta** y le corresponde `supersedido`, no
  `bloqueado`. Reclasificar exige la firma de Alexis.
- **En CI no corre un proceso PgBouncer** (no está instalado). Declarado dentro de su AC.
- **`/agenda` y `/vehiculos` no están enlazadas desde ninguna navegación.** El manifest de
  navegación por rol es del §5.5 y vive en el hito (g); hoy se llega por URL.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4 en `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. **Estaba ARRIBA al cerrar.**
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`, las cuatro del
  fixture de ruteo y `t_gobierno`.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan; el e2e de FLOTA usa
  el 3311.
- Al editar una migración YA APLICADA el runner la frena por sha, y tiene razón. Para
  recuperarse: borrar las bases de fixture, `node db/flota/migrar.mjs aplicar`, y volver a
  provisionar (`node --experimental-strip-types apps/flota/e2e/preparar-tenants.mjs`).

## Churn de artefacto que NO se comitea

`apps/kilopan/next-env.d.ts` lo reescribe `next build`.
`packages/metodo/panel/last-green.{sha,tag}` los estampa el gate. Los tres se descartan.

## Coordinación entre sesiones

Sigue vigente: **no usar `git add -A`** en este árbol; agregar siempre por ruta explícita y
mirar `git log --oneline -5` antes de escribir. **Un builder por worktree**: antes de construir,
`ps aux | grep "[l]oop.sh"; git status --short`.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para este hito y
> prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo, archivalo en
> `docs/handoffs/2026-08-10-0000.md`, armá tu despertador de 4h35m y arrancá por «Próximos
> pasos». El hito (c) va **7 de 22**: están el alta y el gobierno de vehículos, el vehículo-día
> con su EXCLUDE, las lecturas con proyección por trigger, la vista `eevd_semanal`, la fórmula
> única de energía con su grep-gate y la agenda con «duplicar semana». Lo que sigue es
> **AC-FVEH-03** (`vehiculo_documentos`), diseñado en el handoff. Contrato: `specs/flota/*.md` +
> `IMPLEMENTATION_PLAN_flota.md`; la constitución es `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas
> duras: un AC = un commit con su test naciendo en el mismo commit · citar el id del AC en el
> código o el test · `[x]` solo con test verde y marcado en la spec Y en el plan en el mismo
> commit · un paso SALTADO no es un paso verde · nunca inventar la respuesta a una pregunta al
> dueño (la spec 02 tiene NUEVE abiertas). Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni el
> contenido de negocio de `specs/kilopan/**`. No uses `git add -A`. Y **no crees chips de
> continuación**: Alexis lo pidió expresamente.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
