# Respuestas del dueño — 09-ago-2026 · spec 01 (identidad y enrolamiento)

Alexis respondió **cuatro** de las diez preguntas abiertas de
`specs/flota/01-identidad-enrolamiento.md`: las que bloqueaban los ACs de la cola inmediata
del hito (b). Este archivo es el registro del acto; la absorción va en la spec, en el plan y
en la familia canónica del §0.

**Lo que no está acá no fue respondido y sigue sin inventarse.** Quedan abiertas las
preguntas **2** (mecánica de rotar PIN), **3** (rol `cliente`), **4** (passkey del admin),
**6** (visibilidad de solicitudes pendientes), **7** (break-glass) y **8** (ARCO y plazos de
retención).

---

## P10 · Solicitud con RUT ya registrado → **rebota al APROBAR, no al solicitar**

La solicitud entra normal y la colisión la ve el dueño en su panel, que decide si es la
misma persona con teléfono nuevo o un homónimo. El 422 sale recién en la aprobación.

**La razón es la misma con la que se eligió `404 · 503 · 404` en AC-FTEN-05:** quien tiene el
link **no está autenticado**, y el link viaja por WhatsApp. Un rebote inmediato le confirma a
cualquiera que ese RUT trabaja en la empresa, y enumerar la nómina queda a un RUT por
intento. Que la respuesta no sea el oráculo.

**Costo aceptado, y explícito:** el trabajador se entera tarde, así que el panel del dueño
tiene que mostrar la colisión con lo que hace falta para decidir en un toque.

**Desbloquea:** AC-FIDN-03 (su caso de rebote pendiente) y la conducta de la aprobación en
AC-FIDN-04.

## P5 · Distribución de la invitación → **share-sheet del dueño; código corto de 8**

Sin pasarela de SMS ni de WhatsApp: el dueño comparte el link/QR desde su propio teléfono con
el share-sheet del sistema, o lo copia. Cero integraciones y cero costo por mensaje,
consistente con lo que el §3 ya deja FUERA de E1 — y sin el modo de falla nuevo que trae un
proveedor de mensajería en el camino crítico del enrolamiento: el mensaje que no llegó.

**Código corto de respaldo: 8 caracteres, en alfabeto sin ambiguos** (sin `0`/`O`, sin
`1`/`I`/`L`). Se dicta en voz alta en un galpón ruidoso y se teclea con guantes; en ese
alfabeto, 8 caracteres son del orden de 10^12 combinaciones para un token que además expira a
los 7 días y es revocable en 1 toque.

**Desbloquea:** AC-FIDN-03 (entrada por código corto) y AC-FIDN-02 (F-A, ≤4 toques).

## P9 · Backoff del PIN → **espera que se duplica desde 30 s, con tope de 15 min**

30 s, 1, 2, 4, 8 y tope en 15 min. Un PIN correcto resetea el contador a cero. Lockout a los
5 intentos POR USUARIO, que ya lo fijaba el §0.

La razón: quien se equivoca de verdad es casi siempre el operario con guantes a las 4am, y
una espera corta que crece sola lo frena sin dejarlo tirado. **El tope existe para que un
aparato de andén no quede inutilizable toda la madrugada** — el bloqueo es por usuario, pero
el que espera es el turno.

**Desbloquea:** AC-FIDN-06. Los valores entran a la familia canónica del §0 y el AC los
asierta mecánicamente contra ella, jamás contra un número escrito en el test.

## P1 · Sesiones → **personal sin caducidad; andén por inactividad**

En el teléfono personal la sesión dura mientras el dispositivo siga enrolado y no revocado:
**no se pide PIN al abrir la PWA**. El PIN queda para lo que significa algo —firmar— y para
rotar identidad en el andén, que sí cierra sesión por inactividad (**3 minutos**).

La razón: el dispositivo personal YA es el segundo factor —está enrolado, tiene secreto
propio y se revoca en 1 toque con efecto inmediato server-side—, así que pedir PIN en cada
apertura suma toques al flujo que el §5.3 presupuesta sin agregar seguridad que la revocación
no dé. Y la fricción no es gratis: empuja a dejar la app abierta todo el turno, que es
exactamente lo que se quería evitar.

**Desbloquea:** la conducta de sesión de AC-FIDN-04 (la sesión arranca sola tras la
aprobación) y el F-D del andén.
