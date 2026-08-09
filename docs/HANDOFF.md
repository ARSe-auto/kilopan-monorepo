# HANDOFF — Plataforma FLOTA, hito (a) en curso

**Traspaso por límite de sesión.** Sesión anterior: 08-ago-2026 22:15 → 09-ago 02:55 -04,
Opus 5 esfuerzo alto, rama `flota/specs-e1` en `~/kilopan-monorepo-flota`. Árbol limpio,
todo comiteado, ambos gates en verde.

> Sesión nueva: retomá esto **de inmediato, sin re-preguntar nada**, armá tu propio
> despertador de 4h35m, y archivá este archivo en `docs/handoffs/2026-08-09-0255.md` al
> absorberlo.

## Prompt de arranque

> Seguí construyendo el hito (a) de la Plataforma FLOTA en `~/kilopan-monorepo-flota`
> (rama `flota/specs-e1`), con Opus 5 y esfuerzo alto — el §8 del maestro exige el modelo
> tope para este hito y prohíbe delegarlo a un motor. Leé `docs/HANDOFF.md` completo y
> arrancá por «Próximos pasos», ítem 1. Contrato:
> `specs/flota/00-modelo-datos-tenancy.md` + `IMPLEMENTATION_PLAN_flota.md`; la constitución
> es `docs/PROMPT_MAESTRO_FLOTA.md`. Reglas duras: un AC = un commit con su test naciendo en
> el mismo commit · citar el id del AC en el código o el test · `[x]` solo con test verde y
> marcado en la spec Y en el plan en el mismo commit · nunca inventar la respuesta a un AC
> BLOQUEADO. Verificá con `bash packages/metodo/scripts/check.sh --app=flota` (y `--full`).
> Antes de tocar la base: `bash db/flota/cluster.sh iniciar`. No toques `apps/kilopan/**`,
> `db/migraciones/*.sql` ni el contenido de negocio de `specs/kilopan/**`.

## Estado

**4 de 28 ACs del módulo 00 cerrados.** El plan total pasó de 195 a **197** ACs.

| Commit | Qué |
|---|---|
| `31c61c4` | infra: cluster Postgres de FLOTA en 54331 + pgTAP vendorizado |
| `8c6aa1e` | **AC-FTEN-18** lista KR congelada (N=63), firmada por Alexis |
| `d721671` | **AC-FTEN-28** `db/flota/guardrail.sh`, 3 reglas del §7.1, 9 mutantes |
| `1dd735d` | **AC-FTEN-01** familia canónica de constantes + grep-gate, 21 pruebas |
| `f37eac1` | **AC-FTEN-06** linter de migraciones, 15 mutantes |
| `079c127` | WIP de AC-FTEN-02 (ver abajo) |
| `ac14b67` | arnés: Opus 4.8 → Opus 5, y el fallback que degradaba en silencio |

**Gate:** `check.sh --app=flota` VERDE — 10 OK · 3 saltados (es-CL, standalone y e2e, los
tres porque `apps/flota` todavía no tiene `package.json`). **No crear ese `package.json`
hasta que la app Next exista de verdad:** en cuanto exista, esos 3 saltados se vuelven 3
rojos. `check.sh --app=kilopan` también verde: el arnés se tocó y se verificó por los dos
lados.

## Infraestructura viva

- **Cluster Postgres de FLOTA:** PostgreSQL 18.4, `127.0.0.1:54331`, PGDATA
  `~/.flota-pg/var-18`, superusuario `flota_admin`, pgTAP 1.3.3 vía `extension_control_path`
  desde `~/.flota-pg/share`. Estaba ARRIBA al cerrar. `bash db/flota/cluster.sh {iniciar|parar|estado}`.
- **NO TOCAR:** 54329 es el cluster de **eauto** (mismos binarios de Postgres.app, otros
  datos, otro proyecto). 3300/3301 son de KiloPan. FLOTA tiene 3310 (dev) y 3311 (e2e),
  todavía sin pinear porque la app no existe — pinearlos en `package.json` y
  `playwright.config.ts` ANTES del primer arranque.
- El motor de KiloPan (launchd `com.kilopan.ralph-loop`) trabaja en `~/kilopan-monorepo`
  sobre `main`. No commitear ahí ni matar sus procesos.

## Decisiones tomadas — NO re-litigar

1. **`CHECK (tenant_id = (SELECT id FROM tenant_info))` del §4.1 es imposible en Postgres**
   («cannot use subquery in check constraint», verificado contra 18.4). Se implementa
   `CHECK (tenant_id = tenant_actual())`, con `tenant_actual()` IMMUTABLE y el uuid
   **horneado como literal** en la provisión — además es lo único seguro ante `pg_restore`
   del offboarding. Está en `db/migraciones-flota/LEEME.md` y lo exige el linter.
2. **Cluster propio en 54331** en vez de PGlite (§4.1 pide cosas que PGlite no tiene).
3. **pgTAP vendorizado** en `vendor/pgtap/`, aprobado por Alexis.
4. **Lista KR congelada, N=63**, firmada el 08-ago con sus 7 decisiones: KR-29 y KR-41
   entran a E1 (AC-FRUT-22 y AC-FVEH-22, ya escritos en las specs 03 y 02); KR-34, KR-48 y
   la cláusula «solo primera apertura» de KR-17 descartados; KR-38 y «próximo servicio por
   km» de KR-51 diferidos.
5. **Preguntas 11 y 13 de la spec 00 respondidas: `lot` y `reference_document` son ambas
   CAPTURA.** Ya desbloqueadas las dos cláusulas de AC-FTEN-14.
6. **El hito (a) no se delega a un motor** (§8), y `AGENTS.md` le prohíbe al motor crear
   migraciones — que es todo lo que este hito produce.

## Próximos pasos, en orden

1. **AC-FTEN-02** — `tenant_template` + provisión. **Parcialmente escrito en `079c127`:**
   ya existen `db/flota/conectar.mjs` (una sola fuente de la cadena de conexión, con
   `bdDeTenant`/`rolDeTenant`), `db/flota/aplicar.mjs` (aplica migraciones a UNA base con
   `schema_migrations`, cada una en su transacción y con sha256 para detectar una migración
   editada después de aplicada) y `db/migraciones-flota/tenant/0001_identidad_del_tenant.sql`
   (`tenant_info`, `schema_migrations`, `tenant_actual()`, `tenant_coherente()`).
   **Falta:** `db/flota/provisionar.mjs` — construir/refrescar `tenant_template`, hacer
   `CREATE DATABASE t_<slug> TEMPLATE tenant_template` (ojo: falla si queda alguna conexión
   abierta a la plantilla), sembrar la fila de `tenant_info` con `uuidv7()` del servidor y
   reemplazar `tenant_actual()` con ese uuid literal; más su test provisionando 2 tenants y
   el caso de rebote (migración aplicada a tenants pero no a la plantilla ⇒ exit ≠ 0).
   Y activar la suite con BD en `db/flota/gate.sh`, que hoy la declara SALTADA.
2. **AC-FTEN-07** — runner ×N: canario `t_canary` primero, luego plantilla y cada tenant;
   rol `migrator` separado; BD rezagada ⇒ exit ≠ 0 (centinela 13).
3. **AC-FTEN-03** — rol `app_t_<slug>` NOSUPERUSER/NOBYPASSRLS con CONNECT solo a su BD
   (centinela 3). Incluye pasar el `pg_hba` del cluster a `scram-sha-256` con contraseñas
   por rol, para que el rechazo sea de autenticación y no solo de privilegio.
4. Después: AC-FTEN-08 (UUIDv7 + `client_uuid`) · 24 (DDL transversal del §4.6) · 14 y 15
   (ganchos VIVOS y DDL-only) · 09 y 21 (tipado de dinero y su RLS restrictiva) · 04 y 20
   (`control` + job exportador) · 11, 12, 13, 22 (entitlements, `vertical_template`,
   config versionada, modo) · 16 (reglas estáticas + wrapper tenant-scoped) · 26 (generador
   de la suite HTTP A-contra-B) · 17, 23, 25 (offboarding, instancia dedicada, runbook) ·
   05 y 10 (con su cláusula bloqueada) · **19 al final** (la matriz KR referencia tests que
   todavía no existen).
5. `AC-FTEN-27` queda BLOQUEADO entero por la pregunta 12. No implementar membresía ni
   filtrado por grupos.

## Preguntas al dueño abiertas — JAMÁS inventar la respuesta

| # (spec 00) | Pregunta | Qué bloquea |
|---|---|---|
| 1 | Dominio wildcard de producción | nada todavía |
| 2 | Proveedor Postgres gestionado y dónde corre PgBouncer | nada todavía (local resuelto) |
| 3 | ¿Las 3 tablas de entitlements en `control` o en la BD tenant? | AC-FTEN-11 — la spec **asume `control`** y con eso se avanza |
| 4 | Granularidad de `config_version_id` | AC-FTEN-13 |
| 5 | Claves de `parametros` para E1 | seeds del hito (g) |
| 6 | Matriz feature×plan | seeds del hito (g) |
| 7 | Contraste del acento: ¿contra blanco, contra el dark, o ambos? | el fixture de rechazo de AC-FTEN-10 |
| 8 | Cadencia del job exportador | AC-FTEN-20 (se avanza sin fijarla) |
| 9 | Ruteo: subdominio sin tenant, tenant no activo | el caso de rebote de AC-FTEN-05 |
| 10 | Runbook de brechas: plazos, canales, responsable | una sección de AC-FTEN-25 |
| 12 | Grupos jerárquicos: entidades, superficies, composición con el rol | **AC-FTEN-27 entero** |

Los 16 ACs BLOQUEADOS de todo el contrato están listados en `docs/ARRANQUE_FLOTA.md` §3.7.

## Advertencia de método para la sesión nueva

Este arnés **no ejecuta nada entre turnos**: cada turno termina y espera al usuario. No
prometer «sigo trabajando mientras dormís» — no es cierto y ya costó tres horas ociosas la
noche del 08-ago. La continuidad real es este traspaso, no trabajo de fondo.
