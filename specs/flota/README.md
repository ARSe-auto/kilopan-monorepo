# specs/flota — vacío a propósito (todavía)

Este directorio sigue **deliberadamente vacío de specs de negocio**, y por eso
`node packages/metodo/scripts/gate_specs.mjs --app=flota` está en **rojo**. Es lo
correcto: sin contrato, `apps/flota` no construye funcionalidad de negocio — mismo
criterio que protegió a KiloPan de las tandas A–F de reparación.

## Por qué el vacío NO es "esperar a que KiloPan termine"

El dueño autorizó (08-ago-2026) arrancar el diseño y el esqueleto de la Plataforma FLOTA
**en paralelo** con el cierre de KiloPan — ver `apps/flota/README.md`. Lo que sigue
esperando es la EXTRACCIÓN de `packages/nucleo-*`, no el arranque de `apps/flota`.

## Por qué las specs de este directorio no se escriben "de paso"

`docs/PROMPT_MAESTRO_FLOTA.md` es un documento de 10 secciones + tabla canónica de
constantes, ya sometido a panel de expertos, adversario y dos rondas de verificación
adversarial — traducirlo a `specs/flota/*.md` con el mismo rigor exige un proceso propio
(un agente dedicado por módulo, con verificación adversarial contra el maestro), no un
encargo resumido dentro de otra tarea. Esas specs llegan por esa vía separada.

## Qué hace falta para que este directorio deje de estar vacío

1. `IMPLEMENTATION_PLAN_flota.md` generado por el planner de esa vía — nunca escrito a
   mano acá.
2. Specs derivadas de `docs/PROMPT_MAESTRO_FLOTA.md`, cada una con:
   - línea `Fuente: §N` que resuelva contra un encabezado real de ese maestro,
   - ≥3 ACs con formato `[AC-FAM-NN]`,
   - familias de id que NUNCA choquen con las de KiloPan (ver los prefijos ya usados en
     `specs/kilopan/*.md` antes de elegir una nueva).
3. `apps/flota` recibe su funcionalidad de negocio **con el gate ya en verde** desde el
   primer commit que la construye.
4. `apps/flota` **no importa nada** de `apps/kilopan`. La frontera son los futuros
   `packages/nucleo-*`. Dos despliegues, bases de datos separadas por tenant (§4.1 del
   maestro), cero FK entre productos.

## Antes de la extracción de núcleos

Promover `packages/nucleo-{comun,identidad,pod,dte}` de stub a paquete real, extrayendo
código ya verde de `apps/kilopan` — no reescribiéndolo. Esto sigue esperando a que
KiloPan cierre sus ACs bloqueantes de núcleo: `AC-POD-04` · `AC-H0-12` · `AC-DASH-08` ·
`AC-ADM-08` · `AC-ADM-09` · `AC-DES-03` (el resto de los ítems abiertos de KiloPan NO
bloquea la extracción). Criterio de la extracción: el gate de KiloPan sigue verde sin
tocar sus specs.
