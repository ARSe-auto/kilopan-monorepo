# Runbook de brechas de seguridad — Plataforma FLOTA

Fuente: §7.8 del maestro (obligación de E1) · Ley 21.719 sobre protección de datos personales
(vigencia plena 01-dic-2026) · plazos, canales y responsable dictados por Alexis el
09-ago-2026 (`docs/respuestas-dueno-2026-08-09.md` §P10). Entregable de AC-FTEN-25.

Este documento se sigue **en el orden en que está escrito**. Cada sección termina en algo que
alguien hace, no en un principio.

## Responsable

**Alexis Rodríguez** es el responsable nombrado del runbook: decide si un incidente es brecha,
autoriza la comunicación al tenant y firma el cierre. Si no está disponible, el incidente NO
se cierra solo: escala y espera, porque un cierre sin firma es un incidente que nadie recuerda
haber cerrado.

## Detección

Un incidente entra por cualquiera de estas puertas, y todas terminan en la misma bandeja:

- El **canario de aislamiento** contra producción en rojo (§10, §9.3): es la señal más grave
  de todas y no se degrada por histéresis ni por edición de umbral.
- Una fila de `review_queue` con severidad alta cuyo origen sea acceso o autenticación.
- El semáforo cross-tenant leyendo `control`: errores de sync fuera de banda, actividad
  anómala, dispositivos en versiones que nadie desplegó.
- Un aviso externo: el tenant, un usuario, el proveedor de infraestructura o un investigador.

Todo lo que entra se anota con hora, quién lo vio y por qué puerta. **La hora de detección es
la que después cuenta el plazo**, así que se anota antes de investigar nada.

## Contención

Primero cortar, después entender. En este orden:

1. **Revocar credenciales del alcance sospechado.** El rol `app_t_<slug>` de un tenant se
   revoca sin tocar a los demás: cada tenant tiene el suyo y ninguno alcanza la base de otro
   (§4.1). Un grant de soporte vivo se revoca en `control.grants_soporte`.
2. **Suspender el tenant si hace falta.** `control.tenants.estado = 'suspendido'` deja el
   ruteo respondiendo 503 con cero acceso a su base, sin borrar nada.
3. **Rotar secretos** del plano afectado, empezando por los del cluster.
4. **No apagar nada que registre.** Los logs y `audit_trail` son evidencia; detener la
   escritura para «que no se llene» es destruir la prueba mientras se contiene.

## Evaluación de alcance POR TENANT

La separación física del §4.1 **acota el radio y hay que usarla**: una base por tenant
significa que el alcance se evalúa tenant por tenant y que «todos» nunca es la respuesta por
omisión.

- ¿Qué bases de datos alcanzaba la credencial comprometida? Un rol `app_t_<slug>` alcanza
  **una** base y ninguna más; el rol `migrator` y el superusuario alcanzan el cluster.
- ¿Hubo consultas cross-database? No puede haberlas en el runtime del producto (§7.2), así que
  encontrar una ES parte del incidente y no un detalle.
- ¿Qué datos personales hay en el alcance? RUTs, nombres, teléfonos, firmas y fotos de POD.
  Los montos, tarifas y datos comerciales del tenant **no salen de su base** y jamás están en
  `control` (centinela 14), lo que acota el alcance comercial a la base del tenant afectado.
- El resultado se escribe como una lista de tenants con lo que a cada uno le tocó. Un tenant
  que no está en la lista es un tenant al que se verificó que no le tocó, no uno que no se
  miró.

## Preservación de evidencia y registro inmutable

- `eventos`, `evidence`, `audit_trail` y `client_metric` son **append-only** por REVOKE y por
  trigger (§7.4): no se editan ni se borran durante la investigación, y el intento queda
  rechazado con 42501 en vez de pasar callado.
- Se toma un `pg_dump` de la base de cada tenant en el alcance **antes** de cualquier
  remediación, y se guarda fuera del cluster.
- Los logs de la ventana se copian tal cual. Los logs de FLOTA llevan RUT enmascarado y jamás
  PIN (§7.8): si aparece un RUT completo o un PIN en un log, **eso también es un hallazgo del
  incidente** y va al informe.
- El incidente se registra con su línea de tiempo: detección, contención, alcance,
  comunicación, cierre. Ese registro no se edita después de firmado; una corrección es una
  entrada nueva que supersede a la anterior, con motivo y autor (§7.4).

## Comunicación al tenant afectado

- **Plazo: dentro de 72 horas de CONFIRMADA la brecha.** El reloj corre desde la confirmación,
  no desde la detección, y la confirmación tiene hora y firma del responsable.
- **Canales: los dos.** Correo al `admin_tenant` registrado en `control`, y aviso persistente
  en el panel que no se puede descartar hasta que el `admin_tenant` lo reconozca.
- El aviso dice, en es-CL y sin eufemismos: qué pasó, qué datos de ESE tenant estuvieron en el
  alcance, qué se hizo para contenerlo, qué tiene que hacer el tenant, y a quién escribirle.
- Las 72 horas son el estándar prudente mientras el reglamento de la Ley 21.719 no fije otra
  cosa. **El número vive acá y en un solo lugar**, para poder ajustarlo cuando el reglamento
  salga sin reescribir el runbook.

## Después: qué se revisa siempre

- Segregación por tenant de **cache keys, colas, jobs, logs y backups** (§7.2, AC-FTEN-16): si
  el incidente tocó alguno de esos planos, se verifica que la segregación siguiera vigente y
  no solo que estuviera escrita.
- Backups por BD tenant: que existan, que sean de la base correcta y que restauren.
- Enmascarado de RUT y ausencia de PIN en logs (§7.8).
- Qué guardrail o qué test habría atrapado esto antes, y si no existe, se escribe. Un
  incidente que no deja un test nuevo es un incidente que va a volver.
