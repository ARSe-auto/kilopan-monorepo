# Respuestas del dueño — 09-ago-2026

Alexis respondió las **11 preguntas abiertas de `specs/flota/00-modelo-datos-tenancy.md`**.
Este archivo es el registro del acto; **la sesión que construya debe absorberlas en la spec
que corresponda** (tachar la pregunta con su respuesta y su razón, como ya se hizo con las
preguntas 11 y 13 el 08-ago) y desbloquear los ACs que dependían de ellas.

Lo que NO está acá no fue respondido y sigue sin inventarse.

---

## P1 · Dominio de producción → **parametrizado, se decide al desplegar**

El dominio wildcard entra por variable de entorno; ni el código ni las specs lo cablean, y
los tests usan un dominio de fixture. El codename sigue provisional (decisión #4 del
maestro) y el valor real se fija recién cuando haya que comprarlo.

**Desbloquea:** nada estaba bloqueado; cierra el hueco sin comprometer un nombre.

## P2 · Clúster gestionado → **Railway, con PgBouncer en el mismo proyecto**

Coherente con el `railway up` del §9.1 y con el despliegue de KiloPan: una cuenta, una
factura.

> **Condición dura que hay que verificar ANTES de comprometerse** (y escribir en la spec):
> el §0 exige `uuidv7()` nativo, o sea **PostgreSQL ≥ 18**, y el §4.1 exige poder hacer
> `CREATE DATABASE … TEMPLATE` a demanda. Si el Postgres gestionado de Railway no da las
> dos cosas, el §4.1 no se puede implementar ahí y la decisión vuelve al dueño. E1 no
> despliega, así que hay tiempo — pero la verificación es un ítem, no un supuesto.

## P3 · Entitlements → **en `control`**

Las tres tablas (`features`, `plan_features`, `tenant_feature_overrides`) viven en la BD
`control`. El ruteo ya lee `control` para resolver el subdominio (§4.1), así que el bootstrap
no abre un camino cross-database nuevo: viaja por el mismo. El entitlement efectivo se
resuelve ahí y **se congela en el snapshot de config del tenant** (ver P4), con lo cual el
runtime del producto nunca vuelve a consultar `control`.

**Desbloquea:** AC-FTEN-11 (la spec ya lo asumía; ahora está confirmado).

## P4 · `config_version_id` → **snapshot GLOBAL por tenant**

Una fila de `config_version` por cada cambio, que congela TODA la configuración del tenant:
tema, terminología, entitlements efectivos, parámetros y plantilla de vertical.
`turno.config_version_id` apunta ahí.

Es lo único que hace literalmente cierto el «un turno corre entero con UNA versión» del §4.4,
y el drill-down desde un turno viejo es una sola lectura en vez de reconstruir un snapshot
desde N punteros.

**Desbloquea:** AC-FTEN-13 completo.

## P5 · Claves de `parametros` → **las dicta el dueño; PENDIENTE de sus valores**

Alexis eligió dictarla él. **No inventar claves ni valores hasta que los dé.** Lo que ya está
fijado por el maestro y no necesita su decisión:

| Clave | Valor | Fuente |
|---|---|---|
| `reserva_pct` | 15 | §0, fila EV |
| `factor_consumo` | 0,85 | §0, fila EV |

Lo que sí es decisión suya y está esperando: `tarifa_kwh_clp`, `precio_diesel_litro_clp`,
`bultos_max_sin_receptor`, la anticipación de los recordatorios de vencimiento
(02 · AC-FVEH-17), la tolerancia de ETA del semáforo de entregas (Anexo B, mínimo 15 min) y
la periodicidad de la liquidación (06 · pregunta 1). Mientras tanto los seeds del hito (g)
no se cierran con cifras inventadas.

## P6 · Matriz feature×plan → **la deriva el builder, la revisa el dueño con los seeds**

Se arma con todos los `lookup_key` que las 9 specs nombran, repartidos por plan según las
pistas del Anexo A (Partida: 1 vehículo, 300 entregas/mes · Pro: white-label completo + API +
frío básico · Empresa: SSO, compliance, ERP), **con la justificación de cada asignación
escrita en la spec**. Alexis la revisa en el hito (g), cuando los seeds A/B/C la vuelvan
concreta y pueda ver qué ve cada plan en pantalla.

## P7 · Contraste del acento → **cada variante contra SU fondo**

La plataforma deriva una variante del acento por tema y valida **cada una contra el fondo de
ese tema**: la clara contra el fondo claro, la oscura contra el fondo oscuro, ambas ≥ 4,5:1.

> **Por qué NO la propuesta que la propia spec sugería** («rechazar si falla contra
> cualquiera de los dos fondos»): es matemáticamente inservible. El producto del ratio de un
> color contra blanco por su ratio contra negro es exactamente 21, así que exigir ≥4,5:1
> contra ambos deja pasar solo acentos con ratio entre 4,50 y 4,67 contra blanco — una
> rendija tan angosta que casi ningún color de marca entra. La opción elegida siempre se
> puede satisfacer aclarando u oscureciendo la variante, que es justo lo que el §5.1 dice que
> la plataforma hace.

**Desbloquea:** AC-FTEN-10 completo, incluido su fixture de rechazo (un acento que, derivado
para el tema oscuro, no llega a 4,5:1 contra el fondo oscuro).

## P8 · Cadencia del exportador a `control` → **cada 5 minutos**

Hace que los «2 intervalos» del Anexo B sean 10 minutos, coherente con el otro umbral de la
misma tabla («errores >5% por 15 min»). Son agregados pequeños por tenant: el costo es
despreciable y el panel cross-tenant se siente vivo sin ser tiempo real.

**Desbloquea:** AC-FTEN-20 y la pregunta 3 de la spec 05, que dependía de esta.

## P9 · Semántica de fallo del ruteo → **404 · 503 · 404**

`control.tenants.estado ∈ {activo, suspendido, archivado}`.

| Caso | Respuesta |
|---|---|
| subdominio sin tenant en `control` | **404** — no se revela si el subdominio existe (mismo criterio que el recurso ajeno del §0) |
| tenant `suspendido` | **503** con página propia en es-CL y **cero** acceso a su base |
| tenant `archivado` | **404**, como si no existiera |

**Desbloquea:** el caso de rebote de AC-FTEN-05, que estaba explícitamente en espera.

## P10 · Runbook de brechas → **72 h · correo + panel · responsable Alexis**

Aviso al `admin_tenant` registrado **dentro de 72 h de CONFIRMADA** la brecha, por correo y
con aviso persistente en el panel hasta que lo reconozca. Responsable nombrado: **Alexis**.

Las 72 h son el estándar prudente mientras el reglamento de la Ley 21.719 (vigencia plena
01-dic-2026) no fije otra cosa; el runbook queda escrito para poder ajustar el número sin
reescribirse.

**Desbloquea:** la sección que faltaba de AC-FTEN-25.

## P12 · Grupos jerárquicos → **vehículos + usuarios, 3 superficies, intersección con el rol**

Cierra las cuatro partes que faltaban:

- **(a) Qué se adscribe a un grupo:** vehículos y usuarios. Nada más.
- **(b) Qué superficies filtran:** el tablero «Hoy», la bandeja de encargos y el inventario
  de vehículos.
- **(c) Cómo compone con el rol:** por **intersección** — el rol define QUÉ acciones, el
  grupo define QUÉ filas. Ortogonales, como dice el §4.4.
- **(d) Pertenencia y herencia:** un usuario pertenece a **UN** grupo y ve su nodo **y todos
  sus descendientes**.

Es el patrón de tags jerárquicos de Samsara y groups+clearances de Geotab que el §6 ya cita
como referente.

**Desbloquea AC-FTEN-27 ENTERO** — era el único AC de la spec 00 bloqueado de punta a punta.
Antes de implementarlo hay que **reescribir el texto del AC** con su oráculo doble, como la
propia spec exige: pgTAP de la política de visibilidad con el rol de app real (un usuario del
grupo X ⇒ 0 filas de entidades del grupo Y que no sea su ancestro) **más** e2e de la
superficie afectada.

---

## Qué hacer con esto

1. Absorber cada respuesta en la spec que la formuló (tachar la pregunta con su respuesta y
   su razón, igual que las preguntas 11 y 13 del 08-ago).
2. Reescribir el texto de **AC-FTEN-27** antes de implementarlo.
3. Quitar las cláusulas «BLOQUEADO» de **AC-FTEN-05**, **AC-FTEN-10** y **AC-FTEN-25**.
4. Propagar a las specs que dependían de una respuesta ajena: **05 · pregunta 3** (cadencia
   del exportador, hereda P8).
5. **P5 sigue abierta.** Los seeds del hito (g) no se cierran con cifras inventadas.
