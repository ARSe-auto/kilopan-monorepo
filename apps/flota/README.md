# apps/flota — Plataforma FLOTA

**El arranque de esta app está autorizado, en paralelo con el cierre de KiloPan** (orden
explícita de Alexis, 08-ago-2026). Ya no aplica el "no iniciar todavía" del placeholder
anterior — pero el arranque autorizado es SOLO diseño/esqueleto: pnpm workspace propio,
skeleton Next.js, plano de control probado contra pglite local. Construcción de
funcionalidad real contra `specs/flota/*.md` espera a que esas specs existan (ver abajo).

## Qué maestro rige

`docs/PROMPT_MAESTRO_FLOTA.md` — la Plataforma FLOTA ABSORBE a KiloRuta como su primer
vertical configurado (Anexo C de ese documento). `docs/PROMPT_MAESTRO_KILORUTA.md` queda
como referencia histórica; `apps/flota` NO se construye contra él.

## Qué SÍ está autorizado ahora

- Esqueleto de esta app (Next.js propia, puerto 3301, cero imports de `apps/kilopan`).
- El plano de control (`db/migraciones-flota/`) contra PGlite local — jamás producción.
- `packages/metodo/scripts/gate_specs.mjs --app=flota` sigue en rojo hasta que existan
  specs reales en `specs/flota/` — es lo correcto: sin contrato, no se construye
  funcionalidad de negocio.

## Qué espera todavía

**Las specs de negocio (`specs/flota/*.md`) se generan por una vía separada, de mayor
rigor** (un agente dedicado por módulo, con verificación adversarial contra
`docs/PROMPT_MAESTRO_FLOTA.md`) — un encargo resumido no garantiza que el rigor del
maestro (10 secciones, panel de expertos, adversario, verificación final) llegue íntegro
a cada AC. No se improvisan acá.

**La EXTRACCIÓN de `packages/nucleo-{identidad,pod,dte,comun}`** (de stub a paquete real,
sacando código YA VERDE de `apps/kilopan`) sigue esperando a que KiloPan cierre sus ACs
bloqueantes de núcleo — hoy abiertos en `IMPLEMENTATION_PLAN.md`:
`AC-POD-04` · `AC-H0-12` · `AC-DASH-08` · `AC-ADM-08` · `AC-ADM-09` · `AC-DES-03`. El
resto de los ítems abiertos de KiloPan NO bloquea la extracción.

Cero imports entre `apps/kilopan` y `apps/flota` — la frontera son los futuros
`packages/nucleo-*`.
