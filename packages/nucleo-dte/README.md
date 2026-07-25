# packages/nucleo-dte (vacío a propósito)

Se puebla en el hito de extracción, **después** del DONE de KiloPan (Anexo C /
IMPLEMENTATION_PLAN.md hito 0, AC-H0-07). No escribir lógica de negocio aquí todavía.

Hoy, el registro de DTE (TED scan + manual, jamás emisión) vive en
`apps/kilopan/src/dte/`. Recordatorio duro: esta app **nunca** genera un folio, PDF o
número con apariencia de DTE (art. 97 N°4 CT) — solo registra folios que el SII ya
emitió.
