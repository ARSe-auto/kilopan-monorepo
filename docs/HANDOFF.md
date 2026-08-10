# HANDOFF — Hito (c) cerrado (21 de 22) y el (d) en 2 de 22

**Traspaso de la sesión del 09-ago-2026 (20:14 →), rama `flota/specs-e1` en
`~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto.** Árbol limpio salvo el churn de artefacto de
siempre, todo comiteado, `check.sh --app=flota --full` en **VERDE con 14 OK · 0 fallados · 1
saltado declarado** (158 casos e2e).

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-10-0010.md` al
> absorberlo. **Alexis pidió expresamente que NO se creen chips de continuación**: el traspaso
> es este archivo y se retoma solo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 02 (vehículos/energía/agenda) | 0 de 22 | **21 de 22** |
| ACs cerrados de la plataforma | 46 de 197 | **69 de 197** |
| Rutas que sirve `apps/flota` | 20 | **48** |
| Migraciones de tenant | 15 | **36** (última: `0036_encargos`) |
| Criterios KiloRuta con test | 11 | **23** |

**Presupuestos de toques medidos, cada uno con su artefacto y su regresión bloqueante:** alta
de vehículo **3**, apertura de turno **7** (presupuesto 9), cierre **6** (presupuesto 6).

**Lo único que queda del módulo 02:** AC-FVEH-16, de oráculo HUMANO (DONE-adopción, dueño
nombrado: Alexis). Por contrato JAMÁS bloquea al loop y no se cierra con código.

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

### 0. Lo aprendido a fuerza de rojos, que ahorra media hora en el AC siguiente

- **Una vista de PostgreSQL NO hereda la RLS**: toda vista nueva va con `security_invoker =
  true`, y hay un invariante en `pgtap/0016` que lo exige. El defecto real: `energia_semanal`
  le devolvía al chofer el TOTAL de las filas que no podía ver.
- **`ON CONFLICT` necesita LEER la fila en conflicto.** Sobre una tabla con RLS de dinero, el
  upsert del chofer rebota. Se resuelve con función `SECURITY DEFINER` (`registrar_recarga`).
- **Los hechos append-only no se borran NI con el dueño del esquema**, y lo que cuelga de ellos
  tampoco: `e2e/limpiar.mjs` excluye turnos con chequeos y vehículos con recargas.
- **Las suites que dejan hechos usan el tenant `hechos`** con URL absoluta
  (`http://hechos.localhost:3311`). El primer activo tiene que poder quedar VACÍO.
- **Un entitlement ausente NO es «apagado»** (`estadoDeFeature` da los tres estados).
- **El grep-gate de constantes muerde al CITAR el maestro**: no escribir sus números en
  comentarios (pasó con «máx 3 capturas» y con «(§4.5)»).
- **`guardrail.sh` rebota TODO en mayúsculas** — y también «MÉTODO», porque el acento en UTF-8
  parte la palabra y deja «TODO» suelto en la locale del grep.
- **Una migración aplicada no se edita**: el runner frena por sha. Se escribe la siguiente.
- **Dos tecladas propias en la misma pantalla** obligan a acotar el `getByRole` del e2e por
  contenedor, o el «8» es ambiguo.

### 1. El hito (c) está CERRADO salvo su AC humano

Solo queda **AC-FVEH-16**: validación en vivo del dueño (alta real cronometrada en <2 min y
lectura sin ayuda del semáforo y del tablero). Es DONE-adopción con dueño nombrado —Alexis— y
por contrato JAMÁS bloquea al loop (§9.2/§10). No se cierra con código.

### 2. El hito (d) ya arrancó: 1 de 22 (módulo 03)

**AC-FRUT-01 y AC-FRUT-02 cerrados**: `empresas_cliente`, `destinos`, `encargos`, la bandeja
en 4 acciones (baseline fijado) y la importación CSV con lector propio
(`apps/flota/src/dominio/csv.ts`) e idempotencia derivada del CONTENIDO de cada fila — no por
lote ni al azar, o el reintento duplicaría todo.

Lo que sigue, en el orden que menos depende de respuestas: **AC-FRUT-06** (rutas maestras),
**AC-FRUT-04/05** (agrupación multi-empresa y publicar el día en ≤15 clics, que INCLUYE en el
conteo el tablero del módulo 02 — ya construido, `/listos`), **AC-FRUT-21** (devoluciones).
**AC-FRUT-03** (máquina de estados) espera la **pregunta 1 de la spec 03**: el enum de
`encargos.estado` tiene HOY solo `solicitado` y `aceptado`, los dos que el maestro fija
literalmente, y el pgTAP lo asierta para que nadie los amplíe sin respuesta.

### 2b. Contexto del hito (d)

`specs/flota/03-encargos-rutas-custodia.md`, 22 ACs. Es el que le SUMINISTRA a este módulo el
dato que dejó pendientes tres cláusulas: `rutas.km_presupuesto_energia` (§4.5), sin el cual el
semáforo «Alcanza/No alcanza» y el «necesario» del tablero no tienen contra qué comparar. Al
cerrarlo hay que volver a AC-FVEH-10 y AC-FVEH-12 y cerrar esas cláusulas.

Lo que ese módulo va a encontrar ya construido y puede reusar sin pensarlo: `enActo` +
`registrarEvento` para toda mutación con rastro, `limpiar.mjs` para el orden de fixtures,
`baseline-acciones.mjs` para los presupuestos del §5.3, `config.ts` para features congeladas,
`fechas.ts` para es-CL y `energia.ts` para todo lo que toque energía.

### 3. Cláusulas de este módulo que se cierran cuando llegue su respuesta

- **pregunta 3** → la aserción numérica del ahorro vs diésel (AC-FVEH-13).
- **pregunta 9** → el conteo exacto de capturas de SOC (AC-FVEH-19).
- **pregunta 12** → la colisión al duplicar semana (AC-FVEH-07): hoy no procede y lo dice.
- **pregunta 13** → el método de estimación (AC-FVEH-11): los DOS implementados, sin default.
- **pregunta 14** → sugerir-vs-crear el bloque de recarga (AC-FVEH-12): hoy solo sugiere.
- **pregunta 15 (NUEVA)** → el catálogo de tipos de vehículo (AC-FVEH-01): hoy los chips salen
  de los tipos que el propio tenant ya usó.
- **pregunta 7** → turno anulado y el denominador de la EEVD (AC-FVEH-20).
- **pregunta 6** → la clase de `turnos` si la apertura fuera offline (AC-FVEH-06).
- **pregunta 1** → el canal y el SEED de anticipación (AC-FVEH-17): el nombre de la fila ya
  estaba cerrado por la P5 de la spec 00.
- **pregunta 2** → el catálogo de tipos de documento (AC-FVEH-03): hoy es texto.

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
> `docs/handoffs/2026-08-10-0010.md`, armá tu despertador de 4h35m y arrancá por «Próximos
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
