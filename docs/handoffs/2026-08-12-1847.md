# Traspaso — 11-ago-2026, 14:35

> ## ACTUALIZACIÓN 18:47 — sesión de SUPERVISIÓN (no reemplaza lo de abajo, lo continúa)
>
> **96 de 199 ACs.** El motor sigue **VIVO** desde las 14:30 (pid 98681), **iteración 15 de 20**,
> más de cuatro horas sin una sola pausa. Cerró de corrido el bloque de sincronización offline del
> módulo 04: **AC-FPOD-04, 05, 06, 07, 08, 09 y 10**. Mientras tenga el lock `builder-flota`, NO se
> construye en paralelo ni se corre `check.sh` — el gate leería un árbol que él está escribiendo.
>
> **Y ojo con escribir en este árbol sin comitear en el acto:** al arrancar cada iteración, el loop
> manda a stash TODO lo que encuentre sucio. Esta misma actualización se perdió una vez así
> (`motor-wip-20260811-184540`, a los 40 segundos de escribirla). Editar y comitear por ruta
> explícita, en el mismo minuto, o no editar.
>
> ### El CI dejó de estar rojo, y llevaba días así
>
> Cada commit del motor disparaba DOS runs (push y PR contra main) y los dos fallaban, con su
> correo de «run failed» cada vez. **La causa no estaba en el código sino en el arnés**: el caso
> (c5) de `prueba-arnes.sh` corre `watchdog.sh` sin credencial y exige que se frene POR ESO, pero
> `watchdog.sh` tiene dos frenos ANTES —`claude` y `pnpm` en el PATH— y en un runner de GitHub no
> existe ninguno de los dos. Se frenaba por el primero, la prueba leía ESE mensaje y denunciaba
> que faltaba el guard de la credencial. **Verde en el Mac, rojo en el runner, sin que ninguna de
> las dos mintiera sobre el código.** Arreglado en `cd748ea`: los dos binarios se estuban en un
> PATH temporal, así el freno que se ejerce es el de la credencial en cualquier entorno, y el
> mensaje del rojo ahora lleva la salida REAL con la que se frenó.
>
> Desde ese commit **todos los pushes salieron verdes**, incluidos los del propio motor. La
> lección vale más que el arreglo: **una prueba del arnés que depende de qué binarios tenga la
> máquina no prueba el arnés, prueba la máquina** — y el gate local verde NO es el veredicto de CI.
>
> **`main` sigue rojo desde el 9-ago y se deja así A PROPÓSITO**: por esto mismo más un e2e que en
> la rama ya está arreglado. Nadie empuja a `main`, así que no manda correos; se sanea al mergear
> el PR #1. Un commit suelto ahí dispararía un run que puede fallar por ese e2e viejo — otro correo.
>
> **Para diagnosticar un rojo de CI:** la consola del step solo muestra el resumen `OK/FALLÓ`; el
> detalle lo redirige `check.sh` a `ultimo-check.log`, que el workflow sube como artefacto —
> `gh run download <run-id> --repo ARSe-auto/kilopan-monorepo --dir <tmp>`. Sin ese archivo, un
> `FALLÓ: prueba-arnes` no dice cuál de sus ~111 casos se cayó. Y `gh` no está en el PATH:
> `export PATH="$HOME/.local/bin:$PATH"`.
>
> ### Hoy hubo DOS sesiones vivas sobre este árbol
>
> A las 13:49 los archivos del fixture de AC-FPOD-03 cambiaron solos mientras esta sesión los
> leía. La identificación rápida NO fue `ps aux` —hay quince procesos `claude` y ninguno dice en
> qué árbol escribe— sino `list_sessions`: la única con `isRunning: true` y actividad de hace un
> minuto. Se le pasó lo verificado por `send_message` y esta sesión se retiró del árbol. **Antes
> de escribir, mirar mtimes; si se mueven solos, hay alguien más.**
>
> ### Lo que le toca a la próxima sesión supervisada, en orden
>
> 1. **AC-FPOD-11** — el DDL de `entregas_pod` (write-once + UNIQUE parcial por encargo).
>    **CORRECCIÓN de las 18:50: el motor SÍ lo tomó**, a las 18:45, y escribió
>    `db/migraciones-flota/tenant/0055_entregas_pod.sql`. La prohibición que ejerce `loop.sh`
>    mira `db/migraciones/` —el árbol de KiloPan— y NO `db/migraciones-flota/`, así que en
>    FLOTA el motor sí crea migraciones y ya lo hizo hoy dos veces (0049 y 0055). Antes de
>    tomar este AC, verificar si quedó cerrado. **Cierra el bloqueo de AC-FRUT-23**, uno de los
>    dos atascados, que sigue siendo lo que hay que revisar apenas el 11 esté verde.
> 2. **AC-FIDN-07** — atascado desde el 10-ago; nadie diagnosticó todavía POR QUÉ.
> 3. **Anomalía menor a confirmar:** entre las 14:30 y las 17:30 hubo seis commits con id de AC y
>    el contador subió cinco. `verify-refs` sigue verde (no hay `[x]` sin respaldo), así que es
>    contable, no de fondo — pero conviene mirarlo.
> 4. **Churn:** `apps/flota/next-env.d.ts` lo reescribe `next build` y cada arranque del motor
>    gasta un stash en él. Va al `.gitignore`, como ya está el de kilopan.

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
