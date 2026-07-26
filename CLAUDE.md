# CLAUDE.md — kilopan-monorepo

Lee PRIMERO `AGENTS.md` (manual operativo del harness, presupuesto duro de 80 líneas) y
`docs/PROMPT_MAESTRO.md` (la constitución de KiloPan; `specs/kilopan/` deriva de él).
Para KiloRuta: `docs/PROMPT_MAESTRO_KILORUTA.md` → `specs/flota/`.

## Jerarquía de verdad

1. `docs/PROMPT_MAESTRO*.md` — constitución. No se contradice; se cita con `Fuente: §N`.
2. `specs/<app>/*.md` — contrato **durable**. Cada AC vive aquí con su id estable.
3. `IMPLEMENTATION_PLAN_<app>.md` — plan **desechable**. El planner lo regenera desde
   cero. Nunca es la única copia de nada.
4. `db/migraciones/` — la BD es la autoridad sobre reglas de negocio.

Si algo no está en el maestro ni en `specs/`, **no existe**.

## Gate único

```
pnpm check          # rápido: gate_specs + verify-refs + lint + types + unit + build + audit
pnpm check:full     # agrega e2e móvil offline + perf + invariantes de BD
```

`gate_specs` y `verify-refs` corren **primero** y abortan: sin specs válidas no se
construye nada. Una spec sin `Fuente:` que resuelva en el maestro, o con menos de 3 ACs,
pone el gate en rojo.

## Regla de sesión

**Una sesión, un proyecto.** Lo de e-auto se hace en la sesión de e-auto; lo de KiloPan
aquí. Si trabajando aquí aparece algo de otro proyecto —incluso un defecto real con
arreglo trivial— reportarlo y proponer que se atienda en su sesión: no editar sus
archivos ni matar sus procesos.

**Un builder por worktree.** Antes de construir, verificar que no hay motor activo:

```bash
ps aux | grep "[l]oop.sh"; git status --short
```

## Puertos

KiloPan vive en **3300+**. Nunca 3000 ni 3100 — eauto los reclama y mata lo que encuentre.
Detalle en `docs/CONTRATO_PUERTOS.md`.

## Despliegue

Railway. `railway up` sube el **working tree**, no el último commit: un árbol sucio
despliega código que nadie revisó. Antes de cada deploy: árbol limpio + `pnpm db:preflight`
+ `pnpm check:full` en verde.
