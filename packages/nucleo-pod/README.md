# packages/nucleo-pod (vacío a propósito)

Se puebla en el hito de extracción, **después** del DONE de KiloPan (Anexo C /
IMPLEMENTATION_PLAN.md hito 0, AC-H0-07). No escribir lógica de negocio aquí todavía.

Hoy, el outbox idempotente (`client_uuid`, cola local, reintento) vive en
`apps/kilopan/src/pod/`. Es un outbox de **mutaciones operativas genérico** — el mismo
motor sirve para el POD de reparto (offline real) y para la cola de reintento de
pesaje/mostrador (AC-RED-01, mismo LAN); no dupliques el mecanismo.
