# HANDOFF — Plataforma FLOTA, hito (a) en curso

> **Sesión viva.** Este archivo se reescribe después de cada AC cerrado, para que una muerte
> abrupta de la sesión no cueste contexto. Si estás leyendo esto en una sesión NUEVA:
> retomalo de inmediato sin re-preguntar nada, armá tu propio despertador de 4h35m, y
> archivá este archivo en `docs/handoffs/AAAA-MM-DD-HHMM.md` al absorberlo.

**Sesión actual:** iniciada 08-ago-2026 22:15 -04 · despertador de traspaso a las 02:50.
**Rama:** `flota/specs-e1` en `~/kilopan-monorepo-flota`. **Modelo:** Opus 5, esfuerzo alto.
**Orden del dueño (08-ago 23:15):** trabajar toda la noche sin interrupciones; Alexis duerme
y no puede intervenir. **Ninguna pregunta bloquea:** lo que necesite su respuesta se salta y
se anota más abajo.

## Prompt de arranque de la sesión nueva

> Seguí construyendo el hito (a) de la Plataforma FLOTA en `~/kilopan-monorepo-flota`
> (rama `flota/specs-e1`). Leé `docs/HANDOFF.md` y continuá desde «Próximos pasos» sin
> re-preguntar. Contrato: `specs/flota/00-modelo-datos-tenancy.md` +
> `IMPLEMENTATION_PLAN_flota.md`. Reglas: un AC = un commit con su test, citar el id del AC
> en código o test, `[x]` solo con test verde y marcado en spec Y plan en el mismo commit.
> Verificá con `bash packages/metodo/scripts/check.sh --app=flota`. No toques
> `apps/kilopan/**`, `db/migraciones/*.sql` ni el negocio de `specs/kilopan/**`.

## Estado

**Cerrados (4 de 28 del módulo 00):** AC-FTEN-18 (lista KR congelada, firmada) ·
AC-FTEN-28 (guardrail §7.1) · AC-FTEN-01 (constantes canónicas + grep-gate) ·
AC-FTEN-06 (linter de migraciones).

**Gate:** `check.sh --app=flota` VERDE (10 OK · 3 saltados: es-CL, standalone y e2e, los
tres porque `apps/flota` todavía no tiene `package.json` — no crearlo hasta que la app Next
exista de verdad, o esos 3 saltados se vuelven 3 rojos).

## Infraestructura viva (procesos y puertos)

- **Cluster Postgres de FLOTA:** PostgreSQL 18.4, `127.0.0.1:54331`, PGDATA
  `~/.flota-pg/var-18`, superusuario `flota_admin`, pgTAP 1.3.3 vía
  `extension_control_path`. Se maneja con `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- **NO TOCAR:** el 54329 es el cluster de **eauto** (mismos binarios de Postgres.app, otros
  datos). El 3300/3301 son de KiloPan. FLOTA usa 3310 (dev) y 3311 (e2e), todavía sin pinear
  porque la app no existe.
- El motor de KiloPan (launchd `com.kilopan.ralph-loop`) trabaja en `~/kilopan-monorepo`
  sobre `main`. No commitear ahí ni matar sus procesos.

## Decisiones tomadas que la sesión nueva NO debe re-litigar

1. **`CHECK (tenant_id = (SELECT id FROM tenant_info))` del §4.1 es imposible en Postgres**
   («cannot use subquery in check constraint», verificado contra 18.4). Se implementa como
   `CHECK (tenant_id = tenant_actual())`, con `tenant_actual()` IMMUTABLE y el uuid
   **horneado como literal** en la provisión — además es lo único seguro ante `pg_restore`.
   Ver `db/migraciones-flota/LEEME.md`.
2. **Cluster propio en 54331** en vez de PGlite: el §4.1 pide `CREATE DATABASE … TEMPLATE`,
   rol por tenant y `uuidv7()` nativo, y PGlite no da ninguna de las tres.
3. **pgTAP vendorizado** en `vendor/pgtap/` (aprobado por Alexis) y servido desde
   `~/.flota-pg/share` — jamás se escribe dentro del bundle compartido de Postgres.app.
4. **Lista KR congelada con N=63**, firmada el 08-ago. Nacieron AC-FRUT-22 (KR-29, candado
   entrega←manifiesto) y AC-FVEH-22 (KR-41, cierre forzado del turno). El plan pasó a 197 ACs.
5. **Preguntas 11 y 13 de la spec 00 respondidas por Alexis: `lot` y `reference_document`
   son ambas CAPTURA.** Desbloquean las dos cláusulas de AC-FTEN-14.
6. **§8: el hito (a) NO se delega a un motor automático.** Lo escribe el modelo tope. Y
   AGENTS.md le prohíbe al motor crear migraciones, que es todo lo que este hito produce.

## Próximos pasos, en orden

1. **AC-FTEN-02** — `tenant_template` + provisión `CREATE DATABASE t_<slug> TEMPLATE` con
   `tenant_info` sembrada. EN CURSO: ya existe `db/flota/conectar.mjs`.
2. **AC-FTEN-07** — runner ×N con canario `t_canary` primero, `schema_migrations` por BD,
   rol `migrator` separado, BD rezagada ⇒ exit ≠ 0.
3. **AC-FTEN-03** — rol `app_t_<slug>` con CONNECT solo a su BD (centinela 3). Incluye pasar
   el `pg_hba` del cluster a `scram-sha-256` para que el rechazo sea de autenticación.
4. Después: AC-FTEN-08 (UUIDv7 + client_uuid) · 24 (DDL transversal §4.6) · 14 y 15
   (ganchos) · 09 y 21 (dinero y su RLS) · 04 y 20 (control + exportador) · 11, 12, 22
   (entitlements, vertical_template, modo) · 16 (reglas estáticas) · 26 (suite A-contra-B) ·
   17, 23, 25 (offboarding, instancia dedicada, runbook) · 19 (matriz KR, va al final porque
   referencia tests que aún no existen) · 05 y 10 (con su cláusula bloqueada).

## Preguntas al dueño abiertas (JAMÁS inventar la respuesta)

Las de la spec 00 que siguen sin responder y qué bloquean:

| # | Pregunta | Qué bloquea |
|---|---|---|
| 1 | Dominio wildcard de producción | nada hoy |
| 2 | Proveedor Postgres gestionado y dónde corre PgBouncer | nada hoy (local resuelto) |
| 3 | ¿Las 3 tablas de entitlements viven en `control` o en la BD tenant? | AC-FTEN-11; la spec ASUME `control` y con eso se avanza |
| 4 | Granularidad de `config_version_id`: snapshot global por tenant o versión por tabla | AC-FTEN-13 |
| 5 | Lista cerrada de claves de `parametros` para E1 | seeds del hito g |
| 6 | Matriz feature×plan para sembrar `plan_features` | seeds del hito g |
| 7 | Contraste del acento: ¿contra blanco, contra el fondo dark, o ambos? | el fixture de rechazo de AC-FTEN-10 |
| 8 | Cadencia del job exportador a `control` | AC-FTEN-20 (se avanza sin fijar cadencia) |
| 9 | Semántica de fallo del ruteo (subdominio sin tenant, tenant no activo) | el caso de rebote de AC-FTEN-05 |
| 10 | Runbook de brechas: plazos y canales de notificación, responsable nombrado | una sección de AC-FTEN-25 |
| 12 | Grupos jerárquicos: qué entidades, qué superficies, cómo compone con el rol | **AC-FTEN-27 entero** |

Los 16 ACs BLOQUEADOS del contrato siguen listados en `docs/ARRANQUE_FLOTA.md` §3.7.
