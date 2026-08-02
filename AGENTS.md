# AGENTS.md — kilopan-monorepo (manual operativo; PRESUPUESTO DURO: 80 líneas. Comprimir, no apilar.)

## Qué es esto
Monorepo pnpm de dos productos hermanos. `apps/kilopan` (schema `pan`): control
operacional para panaderías chilenas — del pesaje del pan a la boleta o la entrega con
prueba. `apps/flota` (schema `flota`): KiloRuta, control de flota de reparto — aún no
construido. Dos despliegues, dos BD con dueños distintos, **cero FK entre productos**.
Variable norte de KiloPan: **TCK ≥ 95 %** (tasa de conciliación diaria de kilos, §2).
Filtro de alcance: ¿ayuda a que un kilo pesado hoy quede conciliado hoy y el dueño lo vea
esta noche? Si no, queda fuera. `specs/<app>/` manda; `docs/PROMPT_MAESTRO*.md` es la
constitución de la que derivan.

## Comandos
pnpm check                 # gate rápido (lint+types+unit+build+audit+guardrail)
pnpm check:full            # agrega e2e móvil 390×844 offline, perf, invariantes de BD
pnpm gate:specs            # specs con Fuente: y ≥3 ACs — corre DENTRO de check.sh
pnpm db:migrate            # aplica db/migraciones/*.sql en orden
pnpm db:preflight          # valida migraciones ANTES de desplegar
pnpm panel                 # regenera el panel de estado desde git + specs
node db/test-invariantes.mjs   # intenta violar cada invariante con SET ROLE pan_app

## Reglas duras
- **La BD es la autoridad.** `round_clp()`, `valida_rut()`, `asignar_correlativo()`,
  `es_outlier_pesaje()`, `stock_disponible()`, triggers de sesión y de POD: llamarlas,
  jamás reimplementarlas en TS. Nunca inventar columnas — `specs/kilopan/00-modelo-datos.md`
  y `db/migraciones/` son la verdad.
- **Unidades:** dinero = CLP `integer`; peso = gramos `integer` (1..100000). Jamás float,
  jamás numeric de kilos. La UI formatea `12,450 kg` y `$12.500` (es-CL), con
  `tabular-nums` en TODA cifra. Todo string visible en español de Chile.
- **El folio tributario JAMÁS se genera** (art. 97 N°4 CT). La app solo registra DTE ya
  emitidos. El correlativo interno se llama `correlativo_pedido` y lo asigna la BD.
- **Sin DTE asociado no hay salida a ruta** (art. 55 DL 825): trigger en BD + UI, sin
  override en ningún camino.
- **POD inmutable y foto write-once.** Corrección = fila nueva con `supersede_id`, jamás
  UPDATE. El servidor recalcula el sha256 y rechaza la foto que no coincide.
- **GPS:** permiso denegado bloquea la confirmación y lo dice; precisión mala **nunca**
  bloquea (el pan no espera). `(0,0)` rebota en la BD.
- **Offline es SOLO el módulo de reparto.** Pesaje y mostrador exigen red local.
- **El repartidor jamás ve CLP** — regla de rol, testeada. $/km vive solo en el dashboard.
- TypeScript strict; sin `any`, sin `@ts-ignore`, sin `eslint-disable` sin cita de spec.
- Toda query parametrizada. Cero interpolación de string en SQL.
- **TOKENS VEDADOS en `src/`** (grep bloqueante, comentarios incluidos): `TODO`, `FIXME`,
  `PLACEHOLDER`, `not implemented`, `lorem ipsum`. Escribir código real o achicar el corte.
- **Nunca modificar para poner en verde:** strictness de tsconfig, reglas de eslint,
  `packages/metodo/scripts/*`, aserciones e2e, tests de invariantes, migraciones ya
  aplicadas.
- **Jamás migración destructiva** ni `db:reset` sobre datos con evidencia (fotos de POD).
- **Motor OAuth-only.** Ventana agotada ⇒ ESPERA. Jamás API de pago, jamás recarga
  automática de créditos.
- **UN builder por worktree.** Antes de construir: `ps aux | grep loop.sh` y mtimes. Si a vos te lanzó `loop.sh`, ESE proceso sos vos: es tu padre y ya tiene el lock a tu favor — no te cuentes como rival tuyo ni lo mates. Es el único caso en que ver un `loop.sh` vivo no te frena.

## Proceso
- Loop plan → build → verify sobre `IMPLEMENTATION_PLAN_<app>.md` (vivo, desechable).
  Las specs son durables: un AC nace en `specs/`, no en el plan.
- **Un AC por commit**, con su test naciendo en el mismo commit:
  `feat(modulo): descripción [AC-XXX-NN]`.
- Un AC se marca `[x]` **solo** cuando su test pasa en el gate. Si el texto del AC
  contiene «falta», el AC no está cerrado: se parte en dos.
- Revisión adversarial al cierre de cada hito: datos malformados, doble-tap, red cortada
  a mitad de flujo, sesión ajena, reloj del teléfono adulterado.

## Entorno
Postgres local (ver `docs/CONTRATO_PUERTOS.md`; KiloPan vive en 3300+, nunca en 3000/3100
que reclama eauto). `.env.local` gitignored con `DATABASE_URL` **solo localhost**.
Despliegue: Railway. `railway up` sube el **working tree**, no el último commit — árbol
sucio = despliegue impredecible. Correr `pnpm db:preflight` antes de cada deploy.

## Aprendizajes (comprimir; lo más nuevo arriba; ≤12 líneas)
- Un AC marcado `[x]` cuyo texto dice «falta X» deja al loop sin trabajo y al producto sin
  la función: 21 ACs abiertos vivían escondidos dentro de 52 cerrados (26-jul-2026).
- La foto del POD calculaba sha256 de un texto, no de una imagen, y nunca subía: la
  evidencia central del producto no existía y el gate no lo vio. Todo AC necesita test que
  lo ejercite de verdad, no que compile.
- `pesaje_foto_obligatoria` estuvo `[x]` sin que `/api/pesajes` aceptara el hash: validar
  en la UI es teatro; la exigencia se valida en el SERVIDOR o no existe.
- El standalone de Next sirve 200 en toda ruta aunque le falten los estáticos: un
  healthcheck normal no lo detecta y la app queda muda al primer clic.
- `check.sh` nunca reporta OK por omisión: los pasos que no corren se listan en SALTADOS.
- El índice sobre `creado_at::date` es imposible — castear timestamptz a date no es IMMUTABLE.
- El EXCLUDE de sesiones impedía el relevo de operador en equipo compartido (500 real).
