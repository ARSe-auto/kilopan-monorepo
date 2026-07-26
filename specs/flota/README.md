# specs/flota — KiloRuta (aún no arranca)

Este directorio está **deliberadamente vacío de specs**, y por eso
`node packages/metodo/scripts/gate_specs.mjs --app=flota` se pone en **rojo**. Es lo
correcto: `apps/flota` no tiene contrato todavía, así que no debe poder construirse.

## Orden fijado por el maestro (Anexo C)

> KiloPan COMPLETO hasta su DONE → hito de extracción a `packages/nucleo-*` →
> `apps/flota` → contrato de integración.

Hay **un solo motor OAuth**. Arrancar KiloRuta antes del DONE de KiloPan compite por esa
ventana y deja los dos productos a medias.

## Qué hace falta para arrancar (cuando toque)

1. `IMPLEMENTATION_PLAN_flota.md` generado por el planner — nunca escrito a mano.
2. Specs derivadas de `docs/PROMPT_MAESTRO_KILORUTA.md`, cada una con:
   - línea `Fuente: §N` que resuelva como encabezado real de ese maestro,
   - ≥3 ACs con formato `[AC-FAM-NN]`,
   - ids que no colisionen con los de KiloPan (usar familias propias, p. ej. `AC-FLO-*`).
3. `apps/flota` recibe su primer commit **con el gate ya en verde**. El objetivo entero de
   este directorio es que KiloRuta nunca viva un día sin criterios de aceptación —
   que es lo que produjo las tandas A–F de reparación en KiloPan.
4. Un AC de integración explícito: `apps/flota` **no importa nada** de `apps/kilopan`.
   La frontera son los `packages/nucleo-*`. Dos despliegues, dos BD, cero FK entre
   productos.

## Antes de todo eso

Promover `packages/nucleo-{comun,identidad,pod,dte}` de stub a paquete real **extrayendo
código ya verde** de `apps/kilopan` — no reescribiéndolo. Criterio de la extracción
(Anexo C): el gate de KiloPan sigue verde sin tocar sus specs.
