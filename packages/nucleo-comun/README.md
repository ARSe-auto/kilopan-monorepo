# packages/nucleo-comun (vacío a propósito)

Se puebla en el hito de extracción, **después** del DONE de KiloPan (Anexo C /
IMPLEMENTATION_PLAN.md hito 0, AC-H0-07). No escribir lógica de negocio aquí todavía.

Hoy, `round_clp`, `valida_rut`, el formato es-CL y los eventos viven en
`apps/kilopan/src/comun/` como una carpeta con imports unidireccionales. El criterio de
la extracción: el gate de KiloPan sigue verde sin tocar sus specs después de mover el
código aquí.
