# HANDOFF — Plataforma FLOTA: el panel del dueño y las tres primeras pantallas

**Traspaso por el límite de 5 horas.** Sesión del 09-ago-2026 (17:15 →), rama `flota/specs-e1`
en `~/kilopan-monorepo-flota`, Opus 5 esfuerzo alto. Árbol limpio salvo churn de artefacto (ver
abajo), todo comiteado, `check.sh --app=flota --full` en VERDE con 14 OK · 0 fallados · 1
saltado declarado.

> Sesión nueva: retomá esto **sin re-preguntar nada**, armá tu propio despertador de 4h35m
> (tarea Bash en background) y archivá este archivo en `docs/handoffs/2026-08-09-2200.md`
> al absorberlo.

## Dónde quedó todo

| | Antes | Ahora |
|---|---|---|
| Módulo 00 (tenancy) | 27 de 28 | 27 de 28 (falta AC-FTEN-19) |
| Módulo 01 (identidad) | 13 de 21 | **17 de 21** |
| Rutas que sirve `apps/flota` | 5 | **18** |
| Preguntas al dueño de la spec 01 | 2 abiertas | 2 abiertas (4 y 8, las dos P2) |

Los cuatro ACs: **AC-FIDN-12** (panel de gobierno del dueño), **AC-FIDN-17** (RUT en vivo y la
primera pantalla de la PWA), **AC-FIDN-20** (cero consentimiento + pantalla F-E) y
**AC-FIDN-05** (standalone + persist).

## Lo que hay que saber para seguir, y no se lee del diff

**1. La PWA ya existe, y tiene tres pantallas.** `/solicitar` (F-B, con su estado «Esperando
aprobación» y la guía A2HS) y `/ya-tengo-cuenta` (F-E). Las dos usan el teclado PROPIO de Miga
—el RUT y el PIN van en un `output`, jamás en un `input`, porque un input abre el teclado del
sistema— y las dos las vigila `db/flota/gate-consentimiento.mjs`.

**2. El código del navegador vive en `apps/flota/src/cliente/`.** `dominio/secretos.ts` y
`dominio/invitaciones.ts` son del SERVIDOR: abren con `node:crypto` y usan `Buffer`, así que
importarlos desde una pantalla mete un polyfill de Node en el bundle. La privada del aparato
queda NO EXTRAÍBLE en IndexedDB (`cliente/aparato.ts`), que es lo que hace que «nunca salió del
teléfono» sea una propiedad del navegador.

**3. `tenant_info.id` NO es `control.tenants.id`.** Provisionar genera el uuid dentro de la base
del tenant; el alta en `control` la hace otro con su propio default. Cualquier cosa que hable
con `control` tiene que resolver el id **por slug** (`tenantIdEnControl` en
`servidor/gobierno.ts`), y el slug sale de la cabecera que `servidor.mjs` sobrescribe con el
veredicto del ruteo. Leerlo de `tenant_info` da violación de FK.

**4. Toda acción de gobierno escribe su evento DENTRO de la transacción de la mutación.** Para
que la aprobación de AC-FIDN-04 no quedara fuera, `aprobar()` y `rechazar()` recibieron un
gancho `registrar` que corre antes del commit. Cualquier acto de gobierno nuevo usa `enActo()`
de `servidor/gobierno.ts` y `registrarEvento()`; el código del evento tiene que estar en el
catálogo que siembra `0014` o la escritura rebota y deshace el acto.

**5. Las suites que tocan tablas append-only miden por DIFERENCIA.** `client_metric` es
append-only igual que `eventos` y `audit_trail`: el DELETE rebota 42501. `e2e/entorno.spec.ts`
cuenta deltas en vez de totales por eso. El tenant `gobierno` del fixture existe porque
`gobierno.spec.ts` deja `codigos_puente` con FK a `usuarios` y rompería el `beforeAll` de otra
suite.

**6. El vecino del centinela 2 ahora tiene identidad sembrada.** `preparar-tenants.mjs` siembra
persona/usuario/dispositivo/invitación/solicitud en el tenant marcado `vecino: true`, porque de
ahí salen los `ids_de_b` de las rutas de tipo `recurso`. Sin esas filas, la suite autogenerada
se pone roja diciendo que el cruce no probaría nada.

## Gates nuevos que hay que respetar

- `db/flota/gate-consentimiento.mjs` — ninguna pantalla que llame a `/api/solicitudes` o
  `/api/reenrolamiento` puede tener checkbox ni texto de consentimiento. El alcance se DERIVA
  de esos endpoints, con piso de 2 pantallas.
- El **oráculo diferencial del RUT** (`db/flota/suite-bd/ruts.test.mjs`): el módulo 11 del
  cliente y el de la base tienen que dar el mismo veredicto sobre la lista congelada entera.
  Tocar uno solo pone el gate en rojo nombrando el RUT en el que difieren.
- Sigue vigente: cada ruta nueva frena el build hasta declarar su cruce; todo RUT del árbol
  tiene que estar en `db/flota/ruts-sinteticos.mjs`; el guardrail rebota `TODO` en mayúsculas.
- **Cuidado con las guardias anti-vacuidad sin anclar.** `/0 migraciones/` casaba con «20
  migraciones». Si escribís una, anclala al separador.

## Próximos pasos, en orden

### 1. AC-FIDN-02 — el flujo feliz contando toques. Es el único P1 construible del módulo 01.

Está DISEÑADO y no empezado. Lo que hace falta, en orden:

1. **Abrir el sobre en el navegador.** `dominio/secretos.ts::abrir()` usa `Buffer`; hace falta
   su gemelo en `cliente/aparato.ts` con WebCrypto puro (ECDH P-256 → HKDF-SHA256 →
   AES-256-GCM, mismos parámetros, y base64 con `atob`). Es la pieza que hace que «la sesión
   arranca sola» sea cierta.
2. **Endpoint de retiro del sobre.** `retirarSobre()` ya existe pero toma `solicitudId`, y ese
   id NO se le devuelve al aparato a propósito (AC-FIDN-03). Hace falta la variante por
   `clave_publica`, igual que hizo `/api/entorno`. Un `GET`/`POST` público que devuelve el
   sobre UNA vez.
3. **Store de sesión en la PWA**: guardar el secreto en IndexedDB al abrir el sobre y un
   envoltorio de `fetch` que agregue `Authorization: Portador <secreto>`.
4. **Polling en «Esperando aprobación»**: el §7.6 prohíbe depender de push, así que el aparato
   PREGUNTA. Ya hay un `useEffect` con «Revisar» donde colgarlo.
5. **Pantallas del dueño**: bandeja de solicitudes con aprobar en 1 toque, y emitir invitación
   por rol en ≤4 toques. Los endpoints ya existen todos (`/api/gobierno/**`).
6. **El QR.** No hay librería de QR en el monorepo y el AC pide «QR + link firmado + código
   corto». Es una decisión de dependencia sobre un módulo `[security]`: **preguntarle a Alexis
   antes de agregar una**, o generarlo con un codificador propio. El link y el código corto no
   necesitan nada.
7. **e2e contando acciones** con la convención del §5.3, selectores solo por `data-testid`, y
   axe/targets. Ojo: el conteo de toques del dueño incluye el share-sheet.

### 2. AC-FTEN-19 — la matriz KiloRuta cierra el módulo 00 (27 → 28).

`docs/matriz-kiloruta.md` como tabla MD `ID | tabla/constraint | test (ruta::nombre)` con gate
de tres verificaciones. **La decisión que hay que tomar y declarar:** la mayoría de los 63
criterios apuntan a ACs de los hitos c–g, cuyos tests todavía no existen, y el gate exige que
«cada test REFERENCIADO exista». La lectura coherente es que una fila sin test referenciado se
cuenta pero no se resuelve —con un marcador de pendiente declarado y contado, como las
exenciones de rutas—, y las filas de los módulos 00 y 01 (44 ACs cerrados) sí llevan test real.
El mapeo ID → AC ya está escrito en `docs/criterios-kiloruta.txt`: lo que la matriz agrega es
la tabla/constraint y el test.

### 3. AC-FIDN-07 (andén) sigue esperando el outbox del hito (e). No adelantarlo a medias.

## Preguntas al dueño que siguen abiertas

- **Spec 01 · pregunta 4** — cuándo se registra la passkey del admin y cómo se recupera si se
  pierde. Bloquea AC-FIDN-13 (P2).
- **Spec 01 · pregunta 8** — quién acciona el export ARCO, en qué formato, y los plazos de
  `retention_policy`. Bloquea AC-FIDN-15 (P2) y mantiene la tabla de retención vacía.
- **NUEVA, de esta sesión (no bloqueante todavía):** ¿se agrega una dependencia de QR al
  monorepo para AC-FIDN-02, o se escribe un codificador propio? Es un módulo `[security]` y la
  decisión es de cadena de suministro.
- Heredadas: **05 · pregunta 3** y **06 · pregunta 1**, ya cerradas por P8 y P5 de la spec 00
  pero sin absorber en su texto.

## Deudas reales, ninguna tapada

- **`tenant_info.id` ≠ `control.tenants.id`.** Hoy se rodea resolviendo por slug. La provisión
  sigue sin registrar el tenant en `control.tenants`; en producción lo hará el wizard
  (AC-FMIG-14, hito g), y ese día conviene que los dos ids sean el MISMO.
- **`scripts/deploy.sh` del §9.1 sigue sin existir**, y `guardrail.sh` sigue sin la regla que
  ponga en rojo toda invocación de `railway` fuera de él. Precondición de proceso, sin AC.
- **Verificar que el Postgres gestionado de Railway dé PostgreSQL ≥ 18 y
  `CREATE DATABASE … TEMPLATE`** (pregunta 2 de la spec 00). El código usa `RETURNING OLD`,
  que es de PostgreSQL 18.
- **El rechazo de la CAPTURA de un aparato no operable** (sin standalone o sin persist) lo
  tienen que exigir los endpoints de sync del módulo 04 (hito e). AC-FIDN-05 dejó la condición
  y su visibilidad; la puerta que rebota nace allá y está declarado en la spec.
- **`BotonPrimario` de Miga sigue con el acento de KiloPan horneado** (`#C2410C`). El tema del
  tenant entra como CSS custom properties en el hito g (AC-FMIG-02); no se adelantó ni un color.
- **En CI no corre un proceso PgBouncer** (no está instalado). Declarado dentro de su AC.

## Infraestructura viva

- **Cluster de FLOTA:** PostgreSQL 18.4 en `127.0.0.1:54331`, PGDATA `~/.flota-pg/var-18`,
  superusuario `flota_admin`, pgTAP 1.3.3. **Estaba ARRIBA al cerrar.**
  `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- Bases vivas: `control`, `tenant_template`, `t_canary`, `t_gate_a`, `t_gate_b`, las cuatro del
  fixture de ruteo y **`t_gobierno`** (nueva). Las `t_gate_*` de las suites las crean y borran
  ellas mismas.
- **NO TOCAR:** 54329 es el cluster de **eauto**. 3300/3301 son de KiloPan; el e2e de FLOTA usa
  el 3311.
- Última migración aplicada: **`0015_entorno_del_aparato`** en 9 bases.
- Al editar una migración YA APLICADA el runner la frena por sha, y tiene razón. Para
  recuperarse hay que borrar y rehacer las bases de fixture y correr `node db/flota/migrar.mjs`.
  Pasó una vez esta sesión (índice faltante que el linter exigió); conviene no editarlas.

## Churn de artefacto que NO se comitea

`apps/kilopan/next-env.d.ts` lo reescribe `next build`. `packages/metodo/panel/last-green.{sha,tag}`
los estampa el gate. Los tres se descartan.

## Coordinación entre sesiones

Sigue vigente: **no usar `git add -A`** en este árbol; agregar siempre por ruta explícita y
mirar `git log --oneline -5` antes de escribir.

## Prompt de arranque de la sesión nueva

> Seguí construyendo la Plataforma FLOTA en `~/kilopan-monorepo-flota` (rama
> `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 exige el modelo tope para el hito y
> prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo, archivalo en
> `docs/handoffs/2026-08-09-2200.md` y arrancá por «Próximos pasos». El módulo 00 va 27 de 28 y
> el 01 va 17 de 21: la PWA ya tiene tres pantallas y el panel de gobierno del dueño está
> entero. El próximo P1 es AC-FIDN-02, que está DISEÑADO en el handoff y no empezado — y trae
> una decisión de dependencia (el QR) que hay que consultarle a Alexis antes de agregar nada.
> Contrato: `specs/flota/*.md` + `IMPLEMENTATION_PLAN_flota.md`; la constitución es
> `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su test naciendo en el
> mismo commit · citar el id del AC en el código o el test · `[x]` solo con test verde y
> marcado en la spec Y en el plan en el mismo commit · un paso SALTADO no es un paso verde ·
> nunca inventar la respuesta a una pregunta al dueño. Verificá con
> `bash packages/metodo/scripts/check.sh --app=flota --full`. Antes de tocar la base:
> `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`, `db/migraciones/*.sql` ni el
> contenido de negocio de `specs/kilopan/**`. Y no uses `git add -A`.

## Advertencia de método

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís». La continuidad real es este traspaso.
