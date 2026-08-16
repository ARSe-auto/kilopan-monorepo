# packages/nucleo-comun

## Extracción de KiloPan: pendiente (sigue vacío a propósito)

Se puebla en el hito de extracción, **después** del DONE de KiloPan (Anexo C /
IMPLEMENTATION_PLAN.md hito 0, AC-H0-07). No escribir lógica de negocio aquí todavía.

Hoy, `round_clp`, `valida_rut`, el formato es-CL y los eventos viven en
`apps/kilopan/src/comun/` como una carpeta con imports unidireccionales. El criterio de
la extracción: el gate de KiloPan sigue verde sin tocar sus specs después de mover el
código aquí.

## Excepción acotada: la familia canónica de constantes de FLOTA (08-ago-2026)

`src/constants.ts` es la fuente **ÚNICA** de la familia del §0 de
`docs/PROMPT_MAESTRO_FLOTA.md`, para componentes Y tests. `constants.md` se **genera**
desde ahí y no se edita a mano.

No contradice la advertencia de arriba: son **datos**, no lógica — cero funciones, cero
consultas, cero condicionales. Y viven en un paquete, y no en `apps/flota`, porque
`packages/miga` tiene que poder importarlos sin depender de una app (`packages/miga`
deriva de aquí sus tokens estructurales; ver la spec 08 de FLOTA).

```bash
node packages/nucleo-comun/scripts/generar-constants-md.mjs   # regenera constants.md
node db/flota/gate-constantes.mjs                             # grep-gate de números mágicos
```

El grep-gate implementa la regla del §0: **un número mágico de la familia escrito fuera del
archivo canónico pone el build en rojo**. La lista de cifras vigiladas vive dentro del
propio `constants.ts`, para que agregar una constante y olvidar su vigilancia se vea en el
mismo diff.
