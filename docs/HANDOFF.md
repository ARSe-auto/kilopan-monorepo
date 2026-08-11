# Traspaso — 11-ago-2026, 14:35

## Dónde está la plataforma

**90 de 199 ACs cerrados.** Rama `flota/specs-e1`, PR #1 al día
(https://github.com/ARSe-auto/kilopan-monorepo/pull/1). HEAD `2adf1d3`, verde.

Motor autónomo **VIVO** (`arrancar-motor-flota.sh`, watchdog + loop), construyendo AC-FPOD-04
(idempotencia del outbox). Tope de 20 iteraciones por lanzamiento.

## Lo que se cerró hoy, después de las respuestas del dueño

Alexis respondió las tres preguntas que bloqueaban ACs
(`docs/respuestas-dueno-2026-08-11-spec01-spec03.md`), absorbidas en sus specs como RESPONDIDA:

- **spec 03 P1** — máquina de estados del encargo: `solicitado → aceptado → asignado →
  publicado → entregado | no_entregado`, con seguimiento de ruta explícito. Un ítem bajado del
  manifiesto sin DTE es re-planificable el MISMO día, sin `reintento_de`. Desbloquea AC-FRUT-03.
- **spec 01 P4** — passkey al primer uso de «transferir propiedad»; recuperación por el
  break-glass del §7.9 ya aprobado. Desbloquea AC-FIDN-13.
- **spec 01 P8** — ARCO solo por `admin_tenant`, JSON estructurado, retención 30d/90d/1año/1año.
  Desbloquea AC-FIDN-15.

Los tres salieron de `packages/metodo/acs-bloqueados-flota.txt`; siguen ahí solo los dos de
oráculo humano (AC-FVEH-16, AC-FRUT-16), que no bloquean al loop.

## Los tres defectos del arnés que se arreglaron, y por qué importan

1. **Extracción del id de un ítem** (`gate_specs.mjs`, `verify-refs.mjs`): tomaban el PRIMER
   corchete en vez del último, así que un ítem que citaba otro AC a mitad de frase «definía» ese
   AC ajeno y dejaba el suyo huérfano. Caso de regresión 4c en `prueba-arnes.sh`.
2. **Índice de fixture fuera de rango** (`db/flota/ruts-sinteticos.mjs`): `Object.keys(VALIDOS)[11]`
   sobre una lista de 10. El `!` de TypeScript prometía que había algo; en corrida era `undefined`
   y el fixture insertaba una persona SIN RUT — que explotaba lejos, como violación de
   `personas_anonimizacion_completa`. Ahora `rutDeFixture(i)` tira un error que nombra el índice,
   el tamaño y qué hacer. Se sumó `4.444.444-5` AL FINAL de la lista congelada.
3. **La pausa que detenía el motor toda la noche** (`watchdog.sh` + `trabajo-en-curso.sh` nuevo):
   el agente sin presupuesto comitea y deja el AC ABIERTO —lo correcto—, el gate se pone rojo por
   el e2e que él escribió y no corrió, y se pausaba TODO hasta que una persona mirara. Ahora un
   HEAD que trae la línea canónica `AC-ABIERTO: <id>` **y** cuyo AC sigue sin marcar `[x]` no
   pausa. La pausa se mantiene intacta para el verde falso: un AC marcado con gate rojo pausa
   igual. Cuatro casos en `prueba-arnes.sh` (116 verde, 0 rojo).

## Lo único que espera decisión

`~/Library/LaunchAgents/com.flota.ralph-loop.plist` está escrito y correcto —relanza cada 30 min
y se abstiene si hay `PAUSA-REVISION`— pero **launchd nunca lo cargó**, así que cuando el motor
agota sus 20 iteraciones nadie lo levanta. Cargarlo necesita `launchctl`, que está en el `deny` de
`.claude/settings.json`. **No se rodea con un guion envoltorio**: se le pide el sí a Alexis en una
línea, y con el sí se levanta el permiso y se carga.

## Cómo se retoma

```bash
bash db/flota/cluster.sh iniciar
bash packages/metodo/scripts/check.sh --app=flota --full
```

**Ante una pausa del motor, sospechá del ARNÉS antes que del AC.** Van siete de siete. Y antes de
reconstruir nada, verificá si el trabajo YA está hecho y solo quedó sin marcar: pasó dos veces hoy
—AC-FPOD-03 estaba completo y solo faltaba correr su e2e y poner el `[x]`—.
