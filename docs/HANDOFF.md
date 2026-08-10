# HANDOFF — El módulo 03 va en 12 de 22

**Traspaso de la sesión del 10-ago-2026 (05:20 →), rama `flota/specs-e1` en
`~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto.** Once commits, diez ACs cerrados, un defecto
propio corregido y **la deuda de `app.current_role` SALDADA**. `check.sh --app=flota --full` en **VERDE con 14 OK · 0 fallados · 1
saltado declarado**.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h30m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-10-0930.md` al
> absorberlo. **Alexis pidió expresamente que NO se creen chips de continuación**: el traspaso
> es este archivo y se retoma solo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 03 (encargos, rutas, custodia) | 2 de 22 | **12 de 22** |
| ACs cerrados de la plataforma | 69 de 197 | **79 de 197** |
| Rutas que sirve `apps/flota` | 48 | **60** |
| Migraciones de tenant | 36 | **40** (última: `0040_confinamiento_del_cliente`) |

**Cerrados en esta sesión:** AC-FRUT-04 (agrupación multi-empresa), 05 (publicar el día en 6
clics), 15 (destino sin geo), 18 (bloque de recarga como parada), 20 (seeds de
`pin_destinatario`), 17 (repetir el día de ayer), 13 (motivos), 14 (empresa implícita y
selector de modo), 06 (rutas maestras) y **12 (aislamiento y confinamiento del rol `cliente`)**.

**Presupuesto medido:** publicar el día **6 clics** contra 15, recorriendo la secuencia F1
COMPLETA con el tablero del módulo 02 incluido en el conteo. Baseline en
`packages/metodo/panel/acciones-publicar-dia.json`, con regresión bloqueante.

## Lo que hay que saber para seguir, y no se lee del diff

**1. La agrupación es un invariante de la BD.** El índice único parcial
`paradas_una_entrega_por_destino` (`where tipo = 'entrega'`) hace imposible la segunda parada de
entrega al mismo destino en la misma ruta. El servidor busca la existente antes de crear otra
porque es lo correcto; si se equivocara, la base lo rebota igual.

**2. Derivar `stop_requirement` es COPIAR.** `cargo_type_requirement` tiene el MISMO shape que su
destino a propósito. Si alguien le agrega una columna a uno, agrégasela al otro: el pgTAP 0020
compara los dos shapes y se pone rojo. Entre plantilla y parada no puede haber reglas de
traducción — son los condicionales por vertical que el §4.6 prohíbe.

**3. `items.empresa_cliente_id` la estampa un trigger, y no se manda desde el código.** El insert
la deja NULL a propósito: el NOT NULL se evalúa después del BEFORE INSERT. Que el servidor no
PUEDA escribirla distinta es el punto.

**4. El solape al publicar ya NO usa el EXCLUDE de `bloques_agenda`.** Se pregunta explícitamente
por `mantencion`, `descanso` y otra ruta publicada del mismo camión ese día, detrás de un
`for update` sobre el vehículo. Los bloques de `recarga` quedan FUERA: son una parada más
(§5.2 F4), y tratarlos como choque hace imposible publicar el día de cualquier camión que cargue
de noche.

**5. `limpiarBandeja` en `e2e/limpiar.mjs` es la contraparte de `limpiarOperacion`** para rutas,
encargos, destinos y empresas. Una tabla nueva del módulo se agrega ahí y las siete suites se
enteran solas. Y `rutas` va PRIMERO en `limpiarOperacion` porque apunta a `vehiculos`.

**6. `rutas.spec.ts` tiene un `beforeEach` que deja el día libre.** Desde AC-FRUT-05 publicar
ocupa la agenda, así que sin él el primer caso que publica le rebota el resto de la suite. Toda
suite nueva que publique necesita lo mismo, o su propio vehículo.

**7. Los motivos NO se borran ni para armar un fixture.** `motivos.spec.ts` los apaga
(`update motivos set activo = false`). El trigger `motivos_no_se_borran` rebota el DELETE también
para el dueño del esquema.

**8. `tenant_info` ganó `modo`, `rut_de_la_empresa` y `razon_social`.** El modo es una RÉPLICA de
`control.tenants.modo`: la autoridad sigue siendo `control`, y la réplica existe solo para que el
trigger de la empresa implícita pueda leerla sin cruzar bases (§7.2).

## Próximos pasos, en orden

### 0. Lo aprendido a fuerza de rojos, que ahorra media hora

- **Un backtick dentro de un template SQL en TypeScript CIERRA la cadena.** Escribir
  `` -- comentario con `columna` `` dentro de un `` `...` `` rompe el parser con un error que no
  apunta al lugar. Usar comillas angulares o nada.
- **Un backtick en el texto de un `paso "..."` de `gate.sh` lo EJECUTA bash.** Salió como
  `pin_destinatario: command not found` en medio de un gate verde.
- **El gate de PII muerde cualquier columna llamada `rut`.** Tiene razón: renombrar a algo que
  diga de quién es (`rut_de_la_empresa`) Y declarar la exención en el MISMO archivo.
- **`guardrail.sh` sigue rebotando TODO en mayúsculas.** Pasó otra vez, en un comentario.
- **`max(uuid)` no existe en PostgreSQL.** Va `max(id::text)`.
- **Playwright: contar elementos del DOM justo después de `toBeVisible()` del contenedor mide el
  marco vacío.** Esperar primero un hijo real (`[data-testid^="parada-"]`).
- **Una migración aplicada no se edita**: o se escribe la siguiente, o se borran las bases de
  fixture y se reconstruye. Reconstruir toma dos minutos y es lo correcto mientras la migración
  no esté comiteada:
  ```
  # borrar t_* y tenant_template, después:
  node db/flota/provisionar.mjs plantilla
  node db/flota/migrar.mjs aplicar
  node db/flota/provisionar.mjs tenant gate_a   # y gate_b
  node --experimental-strip-types apps/flota/e2e/preparar-tenants.mjs
  ```
- **Todo evento `gobierno.*` nuevo rompe el pgTAP 0009**, que cuenta y lista los de esa familia en
  orden ALFABÉTICO. Hoy son diecinueve.
- **Toda ruta nueva pide su `cruce` en `apps/flota/rutas/manifiesto.json`**, y las de tipo
  `recurso` además su `ids_de_b` con la tabla de la que sale el identificador. Si la tabla es
  nueva, hay que sembrarle una fila al vecino en `preparar-tenants.mjs` o el caso no prueba nada.

### 1. Lo que sigue: el bloque de CUSTODIA (AC-FRUT-07/08/09/10)

Es el más grande que queda y son cuatro ACs que se sostienen entre sí: traen `manifiestos`,
`manifiesto_items` y `custody_transfer`, más la creación de filas en `reference_document` (cuya
tabla ya existe, del módulo 00).

- **AC-FRUT-07** — sub-manifiesto por parada de carga y POR EMPRESA, ≤4 acciones, cifra en 96 px
  con `tabular-nums` (test tipográfico que falla si falta), «Conforme» con undo de 8 s.
- **AC-FRUT-08** — DTE gate: sin `reference_document` asociado no hay mercadería a bordo, con la
  vía explícita «bajar del manifiesto». Incluye un grep-gate: cero rutas de emisión de DTE, XML,
  TED o folios — la app JAMÁS emite.
- **AC-FRUT-09 y 10** — custodia inmutable y la captura que jamás rebota. **Los dos dependen de
  la pregunta 7** (si el `pin_hash` argon2id de OTRO usuario viaja en el snapshot del dispositivo
  ajeno): sin esa respuesta, el oráculo offline de la firma no se puede fijar sin inventar el
  mecanismo. Se puede construir todo lo demás y dejar esa cláusula declarada.

Cuando nazcan esas tablas, **la que lleve `empresa_cliente_id` tiene que llevar su política de
confinamiento**: el invariante de `db/flota/suite-bd/confinamiento.test.mjs` se pone rojo solo si
falta. No hace falta acordarse — hace falta no ignorarlo.

### 2. Lo que sigue después, en orden de dependencia

- **AC-FRUT-11 y 21** (ecuación de cierre y `devoluciones`): el 11 necesita `entregas_pod`
  fixtureada del módulo 04.
- **AC-FRUT-19** (telemetría `toques_flujo` a `client_metric`): necesita el endpoint de sync del
  módulo 04, fixtureado en CI.
- **AC-FRUT-22** (ninguna entrega se abre sin su manifiesto confirmado): después del 07/08.
- **AC-FRUT-03** (máquina de estados) espera la **pregunta 1**. El enum sigue con `solicitado` y
  `aceptado`, y el pgTAP lo asierta para que nadie los amplíe sin respuesta.
- **AC-FRUT-16** es de oráculo HUMANO (piloto B en producción, dueño: Alexis). Jamás bloquea.

### 3. Cláusulas de OTROS módulos que ya se pueden cerrar

`rutas.km_presupuesto_energia` **ya existe** (columna de la 0037) pero **ningún flujo la llena
todavía**. En cuanto algo la escriba —al armar o al publicar—, hay que volver al módulo 02 y
cerrar las cláusulas diferidas de **AC-FVEH-10** y **AC-FVEH-12**: el semáforo «Alcanza / No
alcanza» y el «necesario» del tablero `/listos`, que hoy dicen qué falta porque no tienen contra
qué comparar.

## Preguntas al dueño que siguen abiertas

- **Spec 03 — cuatro que tocan lo que viene**: 1 (máquina de estados, bloquea AC-FRUT-03), 2
  (día-desde-maestra: se implementó COPIA y está declarado), 7 (PIN del chofer sin red, bloquea
  el oráculo offline de AC-FRUT-09/10), 9 (origen de una devolución además del descuadre) y
  **10 — NUEVA**: de dónde se siembra la lista de requisitos de cada cargo_type.
- **Spec 02 — nueve**: 1, 6, 7, 9, 11, 12, 13, 14 y 15 (catálogo de tipos de vehículo).
- **Spec 01 — dos**: 4 (passkey del admin, bloquea AC-FIDN-13) y 8 (export ARCO, bloquea
  AC-FIDN-15).

## Deudas reales, ninguna tapada

- **La app se conecta con el superusuario del cluster en local.** Las políticas de RLS
  —dinero (§4.8) y empresa (§7.2)— solo rigen contra un rol NOBYPASSRLS, y `app_t_<slug>` existe
  desde AC-FTEN-03 pero la cadena local apunta a `flota_admin`. En producción `DATABASE_URL`
  apunta al rol de app, así que la política SÍ rige allá; lo que no puede es ejercerse desde el
  e2e, y por eso toda RLS se prueba en `suite-bd`. Vale la pena hacer que el e2e también use el
  rol de app: sería la única forma de que una regresión de RLS se vea en el camino feliz.
- **`tenant_info.id` ≠ `control.tenants.id`.** Se rodea resolviendo por slug.
- **`scripts/deploy.sh` del §9.1 sigue sin existir**, y `guardrail.sh` sigue sin la regla que
  ponga en rojo toda invocación de `railway` fuera de él.
- **Verificar que el Postgres de Railway dé PG ≥ 18 y `CREATE DATABASE … TEMPLATE`** (pregunta 2
  de la spec 00).
- **`BotonPrimario` de Miga sigue con el acento de KiloPan horneado** (`#C2410C`).
- **KR-09 quedó desactualizado por su propia respuesta**; le corresponde `supersedido`.
- **Las pantallas nuevas no están en ninguna navegación**: `/rutas`, `/maestras`, `/agenda` y
  `/vehiculos` se alcanzan por URL. El manifest de navegación por rol es del §5.5, hito (g).

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4 en `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. **Estaba ARRIBA al cerrar.**
  `bash db/flota/cluster.sh {iniciar|parar|estado}`. El binario de `psql` está en
  `/Users/alexismacmini/apps/Postgres.app/Contents/Versions/18/bin`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`, las cuatro del
  fixture de ruteo, `t_gobierno` y `t_hechos`.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan; el e2e de FLOTA usa
  el 3311.

## Churn de artefacto que NO se comitea

`apps/kilopan/next-env.d.ts` lo reescribe `next build`.
`packages/metodo/panel/last-green.{sha,tag}`, `acciones-*.historico.jsonl` y
`exenciones-rutas.{json,historico.jsonl}` los estampa el gate.

## ATENCIÓN — un cambio en el árbol que NO es de esta sesión

`packages/metodo/panel/generar.mjs` aparece modificado (07:15, durante esta sesión) con una
mejora real y pequeña: el título del panel llevaba «KiloPan» horneado y ahora sale del `--app`.
**No lo escribió esta sesión y por eso quedó SIN COMITEAR.** Es casi seguro de otra sesión
trabajando sobre el mismo árbol. Antes de comitearlo, confirmar con Alexis de quién es; y si hay
otra sesión activa acá, pactar el protocolo antes de seguir escribiendo (`ps aux | grep claude`
mostró 34 procesos).

## Coordinación entre sesiones

**No usar `git add -A`** en este árbol; agregar siempre por ruta explícita y mirar
`git log --oneline -5` antes de escribir. **Un builder por worktree**: antes de construir,
`ps aux | grep "[l]oop.sh"; git status --short`.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama `flota/specs-e1`),
> con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para este hito y prohíbe delegarlo a
> un motor automático. Leé `docs/HANDOFF.md` COMPLETO, archivalo en
> `docs/handoffs/2026-08-10-0930.md`, armá tu propio despertador de 4h30m (tarea Bash en
> background) y arrancá por «Próximos pasos».
>
> **Estado: 79 de 197 ACs.** El hito (c) —vehículos EV, módulo 02— está cerrado en 21 de 22 (el
> único abierto es de oráculo humano y jamás bloquea). El hito (d) —encargos, rutas y custodia,
> módulo 03— va en **12 de 22**: están `rutas`, `paradas` e `items`, la agrupación multi-empresa
> garantizada por índice único parcial, publicar el día en 6 clics con sus cuatro rebotes, las
> rutas maestras, los motivos, la empresa implícita del modo `mi_flota`, el bloque de recarga
> como parada y el confinamiento del rol `cliente` a su empresa por política de BD.
>
> **Lo que sigue es el bloque de CUSTODIA: AC-FRUT-07/08/09/10.** Traen `manifiestos`,
> `manifiesto_items` y `custody_transfer`. El 09 y el 10 dependen de la **pregunta 7** al dueño
> —si el `pin_hash` de otro usuario viaja en el snapshot del dispositivo ajeno— y sin esa
> respuesta su oráculo offline no se puede fijar sin inventar el mecanismo: construí todo lo
> demás y dejá esa cláusula declarada. Y cuando crees una tabla con `empresa_cliente_id`,
> acordate de su política de confinamiento — el invariante de
> `db/flota/suite-bd/confinamiento.test.mjs` te lo va a decir en rojo si falta.
>
> Contrato: `specs/flota/*.md` + `IMPLEMENTATION_PLAN_flota.md`; la constitución es
> `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su test naciendo en el
> MISMO commit · citar el id del AC en el código o el test · `[x]` solo con evidencia de test
> verde, marcado en la spec Y en el plan en el mismo commit · un paso SALTADO no es un paso
> verde · **nunca inventar la respuesta a una pregunta al dueño** — hay cinco abiertas en la spec
> 03 (1, 2, 7, 9 y la 10 nueva), nueve en la 02 y dos en la 01. Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni el
> contenido de negocio de `specs/kilopan/**`. No uses `git add -A`. Y **no crees chips de
> continuación**: Alexis lo pidió expresamente.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No prometer
«sigo trabajando mientras dormís». La continuidad real es este traspaso.
