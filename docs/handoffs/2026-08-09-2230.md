# HANDOFF — Hito (a) cerrado, hito (b) terminado, y la PWA funcionando de punta a punta

**Traspaso por el límite de 5 horas.** Sesión del 09-ago-2026 (17:15 →), rama `flota/specs-e1`
en `~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto. Árbol limpio salvo churn de artefacto (ver
abajo), todo comiteado, `check.sh --app=flota --full` en VERDE con 14 OK · 0 fallados · 1
saltado declarado — **verificado desde cero**: se borraron las 9 bases del cluster y el gate
completo se reconstruyó desde el repo.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-09-2230.md`
> al absorberlo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 00 (tenancy) | 27 de 28 | **28 de 28 — CERRADO** |
| Módulo 01 (identidad) | 13 de 21 | **18 de 21** |
| Rutas que sirve `apps/flota` | 5 | **20** |
| ACs cerrados de la plataforma | 41 | **46 de 197** |

Los seis ACs de la sesión: **AC-FTEN-19** (matriz KiloRuta, cierra el módulo 00), **AC-FIDN-12**
(panel de gobierno del dueño), **AC-FIDN-17** (RUT en vivo), **AC-FIDN-20** (cero
consentimiento), **AC-FIDN-05** (standalone + persist) y **AC-FIDN-02** (el flujo feliz entero,
contando acciones).

**El hito (b) está terminado en todo lo que no depende de otro hito ni de una respuesta.** Los
tres ACs abiertos del módulo 01 no son construibles hoy: AC-FIDN-07 (andén) espera el outbox
del hito (e), y AC-FIDN-13 y AC-FIDN-15 esperan las preguntas 4 y 8.

## Lo que hay que saber para seguir, y no se lee del diff

**1. La PWA existe y el enrolamiento funciona de punta a punta.** `/panel` (el dueño: emitir en
3 acciones con QR + link + código, y aprobar en 1), `/solicitar` (F-B, con «Esperando
aprobación» y la guía A2HS) y `/ya-tengo-cuenta` (F-E). Medido: **F-A 3 acciones, F-B 5, F-C 1,
y la sesión del trabajador arranca con CERO acciones suyas.**

**2. El código del navegador vive en `apps/flota/src/cliente/`.** `dominio/secretos.ts` y
`dominio/invitaciones.ts` son del SERVIDOR (abren con `node:crypto`, usan `Buffer`). En
`cliente/aparato.ts` está la mitad del navegador: par de claves con la privada NO EXTRAÍBLE en
IndexedDB, apertura del sobre, el store del secreto de sesión y `pedir()` —el `fetch` que pone
`Authorization: Portador`—. Toda pantalla que necesite sesión usa `pedir()`.

**3. `tenant_info.id` NO es `control.tenants.id`.** Cualquier cosa que hable con `control`
resuelve el id **por slug** (`tenantIdEnControl` en `servidor/gobierno.ts`). Leerlo de
`tenant_info` da violación de FK.

**4. Toda acción de gobierno escribe su evento DENTRO de la transacción de la mutación**
(`enActo()` + `registrarEvento()` de `servidor/gobierno.ts`). El código del evento tiene que
estar en el catálogo que siembra `0014` o la escritura rebota y deshace el acto.

**5. El codificador de QR es propio** (`packages/nucleo-comun/src/qr.ts`, modo byte, nivel M,
versiones 1–6). Decisión de Alexis: nada de dependencias en el módulo que guarda RUTs y PINs.
Sus tests no llevan vectores recordados —prueban propiedades matemáticas—, y las tablas de
bloques por versión, que no se derivan, **se validaron contra el decodificador del sistema
operativo**: `node packages/nucleo-comun/scripts/verificar-qr.mjs` (14 casos, versiones 1 a 6).
Correrlo a mano al tocar una tabla; no está en el gate porque necesita macOS.

**6. Las suites que tocan tablas append-only miden por DIFERENCIA.** `client_metric`, `eventos`
y `audit_trail` rebotan el DELETE con 42501. El tenant `gobierno` del fixture existe porque
`gobierno.spec.ts` deja `codigos_puente` con FK a `usuarios`.

**7. VERIFICAR DESDE CERO significa borrar las bases Y volver a provisionarlas.** Borrar las
bases sin tocar `control.tenants` deja el plano de control apuntando a bases que no existen, y
el exportador se pone rojo NOMBRÁNDOLAS — que es exactamente lo que AC-FTEN-20 promete. La
secuencia correcta es: borrar las bases → `node db/flota/migrar.mjs` →
`node --experimental-strip-types apps/flota/e2e/preparar-tenants.mjs` → el gate.

## Gates nuevos que hay que respetar

- `db/flota/gate-matriz-kiloruta.mjs` — cada criterio KiloRuta mapeado, y cada test referenciado
  tiene que existir. **Al cerrar un AC, convertí su fila de «pendiente» a test real**, en el
  mismo commit. El gate imprime la lista de pendientes en cada corrida.
- `db/flota/gate-consentimiento.mjs` — ninguna pantalla que llame a `/api/solicitudes` o
  `/api/reenrolamiento` puede tener checkbox ni texto de consentimiento.
- El **oráculo diferencial del RUT** (`db/flota/suite-bd/ruts.test.mjs`): el módulo 11 del
  cliente y el de la base tienen que dar el mismo veredicto sobre la lista congelada.
- Sigue vigente: cada ruta nueva frena el build hasta declarar su cruce; todo RUT del árbol
  tiene que estar en `db/flota/ruts-sinteticos.mjs`; el guardrail rebota `TODO` en mayúsculas
  (me mordió con «TODO-CEROS» dentro de un comentario del QR).
- **Cuidado con las guardias anti-vacuidad sin anclar.** `/0 migraciones/` casaba con «20
  migraciones» y se rompió sola al llegar a la vigésima.

## Próximos pasos, en orden

### 1. Hito (c) — vehículos EV. Decisión de Alexis (09-ago-2026): es lo que sigue.

Es el **primer módulo operativo**: de él nace `eevd_semanal`, la variable norte de la
plataforma (§2), y de ahí cuelga el exportador. Arranca por **AC-FVEH-01** (alta de vehículo).
Lo que hace falta, en orden:

1. **La migración `0016` con `vehiculos`** (§4.5, clase PLANIFICACIÓN): patente UNIQUE POR
   TENANT, tipo, `capacidad_bultos`/`capacidad_kg`, los datos EV (`bateria_wh`,
   `autonomia_nominal_km`, `wh_por_km_base`, `soh_pct`), `external_ids jsonb`, `activo` para la
   desactivación, y `odometro`/`soc` como PROYECCIONES —mantenidas SOLO por trigger, con el
   CHECK 0–100 del SOC viviendo únicamente acá y no en `reading`—. Ojo con el linter: cada FK
   compuesta necesita su índice que la encabece.
2. **`POST /api/vehiculos`** con patente + tipo y nada más obligatorio: el resto es progresivo,
   y el AC dice «operable de inmediato». Patente duplicada ⇒ 422 tipado con 0 filas.
3. **CRUD exclusivo del dueño** (centinela 15): POST/PATCH/DELETE de `operador` ⇒ 403 y 0
   filas. **La guardia ya existe**: `guardia()` de `servidor/gobierno.ts` hace exactamente eso,
   y el barrido de AC-FIDN-12 sale del manifiesto — o sea que una ruta de vehículos declarada
   bajo `/api/gobierno/**` entraría sola al barrido. Vale la pena decidir si el gobierno de
   vehículos vive ahí o en `/api/vehiculos` con su propia guardia; si es lo segundo, hay que
   extender el barrido, porque el rebote del centinela 15 es el mismo.
4. **La pantalla de alta** y su e2e, que **REGISTRA el conteo de acciones como baseline en el
   primer verde** —el maestro no fija presupuesto para el alta— y una feature que lo suba no se
   mergea. El contador de `e2e/enrolamiento.spec.ts` ya está escrito y es el que hay que reusar;
   el artefacto de tendencia se puede modelar como el contador de exenciones de rutas
   (`packages/metodo/panel/exenciones-rutas.json` + su `.historico.jsonl`).

Preguntas abiertas de la spec 02 que NO hay que inventar: 1 (canal y anticipación de los
recordatorios), 6 (clase de `turnos`), 7 (turno anulado y el denominador), 9 (conteo de SOC),
11 (OCR), 12 (colisiones al duplicar semana), 13 (método de estimación de consumo), 14 (si la
sugerencia de recarga crea el bloque o pide confirmación).

### 2. AC-FIDN-07 (andén) sigue esperando el outbox del hito (e). No adelantarlo a medias.

### 3. La matriz KiloRuta se llena sola con cada hito

`docs/matriz-kiloruta.md` tiene los 63 criterios: 11 con test verificado y 52 con su clase
declarada. Varios criterios del hito (c) —KR-14, KR-15, KR-16, KR-18, KR-19, KR-20, KR-44,
KR-51, KR-55, KR-62— se cierran ahí.

## Preguntas al dueño que siguen abiertas

- **Spec 01 · pregunta 4** — cuándo se registra la passkey del admin y cómo se recupera.
  Bloquea AC-FIDN-13 (P2).
- **Spec 01 · pregunta 8** — quién acciona el export ARCO, en qué formato, y los plazos de
  `retention_policy`. Bloquea AC-FIDN-15 (P2).
- **Spec 02** — las ocho listadas arriba, que entran en juego con el hito (c).
- **RESPONDIDA esta sesión:** el QR se escribe propio, sin dependencia (y así se hizo).
- Heredadas: **05 · pregunta 3** y **06 · pregunta 1**, ya cerradas por P8 y P5 de la spec 00
  pero sin absorber en su texto.

## Deudas reales, ninguna tapada

- **`tenant_info.id` ≠ `control.tenants.id`.** Hoy se rodea resolviendo por slug. En producción
  el alta la hará el wizard (AC-FMIG-14, hito g); ese día conviene que los dos ids sean el mismo.
- **`scripts/deploy.sh` del §9.1 sigue sin existir**, y `guardrail.sh` sigue sin la regla que
  ponga en rojo toda invocación de `railway` fuera de él. Precondición de proceso, sin AC.
- **Verificar que el Postgres gestionado de Railway dé PostgreSQL ≥ 18 y
  `CREATE DATABASE … TEMPLATE`** (pregunta 2 de la spec 00). El código usa `RETURNING OLD`.
- **El rechazo de la CAPTURA de un aparato no operable** (sin standalone o sin persist) lo tienen
  que exigir los endpoints de sync del módulo 04 (hito e). Declarado en la spec de AC-FIDN-05.
- **`BotonPrimario` de Miga sigue con el acento de KiloPan horneado** (`#C2410C`). El tema del
  tenant entra en el hito g (AC-FMIG-02); no se adelantó ni un color.
- **KR-09 quedó desactualizado por su propia respuesta** y le corresponde `supersedido`, no
  `bloqueado`. La lista está congelada: reclasificar exige la firma de Alexis. Anotado en
  `docs/matriz-kiloruta.md`.
- **En CI no corre un proceso PgBouncer** (no está instalado). Declarado dentro de su AC.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4 en `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. **Estaba ARRIBA al cerrar.**
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`, las cuatro del
  fixture de ruteo y `t_gobierno`. Las `t_gate_*` de las suites las crean y borran ellas mismas.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan; el e2e de FLOTA usa
  el 3311.
- Última migración aplicada: **`0015_entorno_del_aparato`**.
- Al editar una migración YA APLICADA el runner la frena por sha, y tiene razón. Para
  recuperarse: borrar las bases de fixture, `node db/flota/migrar.mjs`, y volver a provisionar.

## Churn de artefacto que NO se comitea

`apps/kilopan/next-env.d.ts` lo reescribe `next build`.
`packages/metodo/panel/last-green.{sha,tag}` los estampa el gate. Los tres se descartan.

## Coordinación entre sesiones

Sigue vigente: **no usar `git add -A`** en este árbol; agregar siempre por ruta explícita y
mirar `git log --oneline -5` antes de escribir.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para el hito y
> prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo, archivalo en
> `docs/handoffs/2026-08-09-2230.md` y arrancá por «Próximos pasos». El módulo 00 está CERRADO
> (28 de 28) y el 01 va 18 de 21: el hito (b) está terminado en todo lo que no depende de otro
> hito ni de una pregunta abierta, y el enrolamiento funciona de punta a punta con las acciones
> medidas. Lo que sigue es el **hito (c), vehículos EV** —decisión de Alexis— empezando por
> AC-FVEH-01, que está diseñado en el handoff. Contrato: `specs/flota/*.md` +
> `IMPLEMENTATION_PLAN_flota.md`; la constitución es `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas
> duras: un AC = un commit con su test naciendo en el mismo commit · citar el id del AC en el
> código o el test · `[x]` solo con test verde y marcado en la spec Y en el plan en el mismo
> commit · un paso SALTADO no es un paso verde · nunca inventar la respuesta a una pregunta al
> dueño (la spec 02 tiene ocho abiertas). Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni el
> contenido de negocio de `specs/kilopan/**`. Y no uses `git add -A`.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
