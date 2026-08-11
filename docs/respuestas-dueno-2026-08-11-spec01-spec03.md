# Respuestas del dueño — 11-ago-2026 · spec 01 (P4, P8) y spec 03 (P1)

Alexis respondió las **tres** preguntas que bloqueaban ACs de la cola: la máquina de estados
del encargo (spec 03, P1, con sus dos sub-decisiones) y las dos que quedaban abiertas de la
spec 01 desde el 09-ago (P4 passkey, P8 ARCO), cada una con su segunda mitad. Este archivo es
el registro del acto; la absorción va en cada spec, marcada `RESPONDIDA`.

Preguntadas y respondidas por `AskUserQuestion` en la sesión del motor autónomo, con opciones
razonadas y su «Otro» siempre disponible — Alexis eligió la recomendada en las siete.

---

## Spec 03 · P1 — Máquina de estados del encargo → **CON seguimiento de ruta**

`solicitado → aceptado → asignado → publicado → entregado | no_entregado`

Cada paso queda explícito en el propio encargo, no solo derivable de `paradas`/`items`: el
portal del contratante (módulo 07) va a preguntar «¿dónde está mi pedido?» y con esto no
necesita unir tablas para responder. El costo es mantener cada transición sincronizada con lo
que de verdad pasa en `rutas`/`paradas` — es trabajo del AC, no una decisión que se difiere.

Los finales siguen siendo solo-por-trigger (§4.5, ya fijado); lo que esta respuesta agrega son
los DOS intermedios que el maestro no nombraba.

### Sub-decisión: ítem bajado del manifiesto sin DTE → **re-planificable el MISMO día**

Un ítem bajado por AC-FRUT-08 (sin `reference_document`) NO cierra su encargo como
`no_entregado`: el encargo se desasigna de la parada y el operador lo puede re-asignar a otra
ruta en lo que queda del día, sin pasar por `reintento_de`. Se trata como un contratiempo
operativo del día — la mercadería sigue en el andén, no en la calle — y no como un fracaso de
entrega. `reintento_de` queda reservado para cuando el camión SALIÓ y no entregó.

---

## Spec 01 · P4 — Passkey del admin → **al primer uso de «transferir propiedad»**

El alta del tenant queda liviana; el passkey se registra recién cuando hace falta, no antes.

### Sub-decisión: recuperación si se pierde → **break-glass del §7.9**

Mismo mecanismo ya aprobado el 09-ago para el acceso de soporte: **dos personas DISTINTAS de
la plataforma**, aviso por correo y panel persistente hasta que se reconozca. No nace un
mecanismo nuevo — un código de recuperación propio sería un secreto más que administrar y sin
la doble revisión humana que el break-glass ya tiene.

---

## Spec 01 · P8 — ARCO: quién acciona → **solo `admin_tenant`, acto de gobierno (§5.4)**

El trabajador pide su export por fuera de la app; el dueño lo genera desde el panel. Coherente
con que el §5.4 ya reserva esa clase de actos para él — el trabajador no gana una superficie de
autoservicio nueva que asegurar, y en el andén, con el aparato compartido, autoservicio abriría
la pregunta de quién puede pedir el export de quién.

### Sub-decisión: formato → **JSON estructurado**

Todo lo que el sistema tiene de esa persona —datos y eventos que la nombran— en un formato
máquina-legible, completo y auditable por diseño. Si algún día hace falta PDF o CSV para
entregar directo, se genera desde este JSON con una herramienta aparte; ir al revés —mantener
un PDF legible completo a medida que se agregan tablas— es el camino caro.

### Sub-decisión: retention_policy → **cortos: 30 d / 90 d / 1 año / 1 año**

| Categoría | Plazo |
|---|---|
| Invitaciones vencidas | 30 días |
| Solicitudes rechazadas | 90 días |
| Dispositivos revocados | 1 año |
| Grants expirados | 1 año |

Invitaciones vencidas son ruido casi de inmediato. Solicitudes rechazadas, 90 días por si hay
reclamo. Dispositivos revocados y grants expirados son rastro de auditoría de seguridad — con
más razón para conservarlos un año.

---

## Lo que no está acá no fue respondido y sigue sin inventarse

Quedan abiertas: spec 03 **P2** (instanciación día-desde-maestra — ya declarada como COPIA por
el implementador, provisional), **P3** (encargo creado en andén: planificación o captura),
**P4** (ETA vivo en E1), **P5** (campo `sello` obligatorio o no), **P6** (columnas del CSV y
granularidad del rebote — ya declarada todo-o-nada, provisional), **P7** (PIN del chofer sin
red en el milk-run), **P9** (origen de una devolución fuera del descuadre de F5) y **P10**
(de dónde se siembra `cargo_type_requirement`, nueva del 10-ago). Ninguna bloquea un AC hoy.
