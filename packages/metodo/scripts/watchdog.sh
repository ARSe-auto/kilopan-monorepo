#!/usr/bin/env bash
# Supervisor del loop autónomo. Aplica docs/LECCION_RALPH.md al pie de la letra:
#   1. Verifica `claude` en el PATH de ESTE proceso antes de arrancar (no en la
#      terminal interactiva del operador — ese fue el bug real).
#   2. Nunca declara avance por "el proceso está vivo": el criterio de corte es
#      commits/ACs, no la salud del proceso.
#   3. Tiene un techo duro de iteraciones Y de iteraciones-sin-avance-consecutivas —
#      nada de "corrió 15 horas antes de que alguien mirara".
set -uo pipefail
export PATH="$HOME/.local/lib/nodejs/current/bin:$PATH"
cd "$(dirname "$0")/../../.."

# KILOPAN_PANEL_DIR existe para que prueba-arnes.sh pueda ejercer el marcador de pausa
# SIN tocar el panel vivo. Sin esto, la propia suite creaba PAUSA-REVISION en el panel real
# y corría este watchdog contra él: ensuciaba watchdog.log con «EN PAUSA» falsos —que ya me
# hicieron creer que el motor estaba detenido cuando no lo estaba— y, si el gate coincidía
# con el arranque de una iteración, podía pausar el motor de PRODUCCIÓN. Un test que puede
# apagar el sistema que vigila no es un test, es una avería con permiso.
# QUÉ APP construye este motor. Default `kilopan` a propósito: el plist que ya existe no
# declara nada y tiene que seguir haciendo exactamente lo mismo. El de FLOTA la declara, y con
# eso el gate independiente verifica SU app — sin esto, el motor de flota habría corrido el gate
# de KiloPan y declarado verde un HEAD que nunca verificó (§9.2: el auto-reporte no es evidencia).
APP="${KILOPAN_APP:-kilopan}"
LOG_DIR="${KILOPAN_PANEL_DIR:-packages/metodo/panel}"
PIDFILE="$LOG_DIR/loop.pid"
LOG="$LOG_DIR/watchdog.log"
PAUSA="$LOG_DIR/PAUSA-REVISION"
MAX_SIN_AVANCE="${KILOPAN_MAX_SIN_AVANCE:-3}"
MAX_ITERACIONES="${KILOPAN_MAX_ITERACIONES:-20}"

mkdir -p "$LOG_DIR"

# PAUSA PARA REVISIÓN (bug real, 2-ago-2026). Todos los ABORT de abajo dicen «NO
# reintentar solo» y salían con exit 1 — pero el plist tiene KeepAlive/SuccessfulExit=false,
# que relanza ante CUALQUIER salida no-exitosa, incluida ésa. launchd resucitaba el motor
# al instante, éste volvía a abortar, y así indefinidamente: el mensaje pedía intervención
# humana y la máquina lo ignoraba a los 120 s. El motor giró media hora sobre AC-SEC-05.
#
# El marcador es la señal que launchd NO puede pisar: mientras exista, el watchdog sale
# con 0 (salida limpia ⇒ KeepAlive no relanza) y no construye nada. Lo borra una persona
# cuando ya miró el log. Mismo mecanismo que usa com.eauto.ralph-loop.
if [ -f "$PAUSA" ]; then
  echo "watchdog: EN PAUSA para revisión humana — no arranco. Motivo registrado:" | tee -a "$LOG"
  sed 's/^/  /' "$PAUSA" | tee -a "$LOG"
  echo "watchdog: para reanudar, revisar el log y borrar $PAUSA" | tee -a "$LOG"
  exit 0
fi

# Se llama en todo abort que exige que mire una persona. Sale con 0 A PROPÓSITO: el
# veredicto vive en el marcador y en el log, no en el código de salida — con exit 1
# launchd relanzaría y el pedido de intervención humana se perdería.
pausar () { # $1 = motivo
  { echo "$(date -Iseconds) — $1"; } > "$PAUSA"
  echo "watchdog: PAUSA — $1" | tee -a "$LOG"
  echo "watchdog: motor detenido hasta que una persona borre $PAUSA" | tee -a "$LOG"
  # AVISAR, y no solo dejar el marcador (10-ago-2026). El motor de FLOTA pausó a las 14:37 y
  # nadie lo supo hasta las 17: una tarde entera de máquina parada porque el único aviso era un
  # archivo que hay que salir a mirar. La pausa es EL momento en que hace falta una persona, así
  # que es el momento en que hay que ir a buscarla.
  #
  # `osascript` falla solo si no hay sesión gráfica (CI, ssh) y por eso va con `|| true`: un
  # motor que muere porque no pudo avisar sería peor que uno que avisa a nadie.
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$1\" with title \"Motor ${APP} DETENIDO\" sound name \"Basso\"" >/dev/null 2>&1 || true
  fi
  exit 0
}

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Estos dos también pausan en vez de salir con 1: un PATH mal armado no se arregla
# reintentando, y con KeepAlive launchd relanzaría cada 120 s para siempre escribiendo la
# misma línea en el log. Así se perdieron ~15 h en eauto-crm-next — el motor «corría».
if ! command -v claude >/dev/null 2>&1; then
  pausar "'claude' no resuelve en el PATH de este proceso ($PATH). NO es un chequeo cosmético: así se perdieron ~15h en eauto-crm-next."
fi
if ! command -v pnpm >/dev/null 2>&1; then
  pausar "'pnpm' no resuelve en el PATH de este proceso ($PATH)."
fi

# UN SOLO PUNTO DE ARRANQUE (bug real, 3-ago-2026 — lo cometí yo). El motor se lanza por
# launchd, que lee ~/.claude-oauth-token y exporta CLAUDE_CODE_OAUTH_TOKEN antes de exec.
# Lanzarlo a mano desde una terminal hereda el PATH pero NO esa variable: `claude -p` muere
# al instante, cada iteración dura segundos, y loop.sh cuenta cada una como intento fallido
# del AC. En ~10 minutos así se marcaron SIETE ACs sanos como atascados. El daño no se ve
# mientras pasa —el log dice «SIN AVANCE», que es lo mismo que diría un AC difícil— y hay
# que revertirlo a mano después. `command -v claude` no alcanza: el binario está, lo que
# falta es la credencial.
# KILOPAN_LOOP_CMD define el modo prueba (loop estubado, nunca se invoca `claude` de
# verdad): ahí la credencial no hace falta y exigirla rompería el arnés.
if [ -z "${KILOPAN_LOOP_CMD:-}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  pausar "sin CLAUDE_CODE_OAUTH_TOKEN: este watchdog NO viene de launchd. Lanzado a mano, cada iteración falla en segundos y marca ACs sanos como atascados. Arrancar el motor solo por launchd (com.kilopan.ralph-loop)."
fi

echo "watchdog: arrancando — PATH ok, claude=$(command -v claude), tope ${MAX_ITERACIONES} iteraciones, ${MAX_SIN_AVANCE} sin avance seguidas aborta" | tee -a "$LOG"

sin_avance=0
i=0
while [ "$i" -lt "$MAX_ITERACIONES" ]; do
  i=$((i + 1))

  # LA SEÑAL DE PARE SE LEE EN CADA VUELTA, NO SOLO AL ARRANCAR (bug real, 3-ago-2026).
  # El chequeo de arriba corre UNA vez, antes del bucle: impedía que un watchdog NUEVO
  # arrancara, pero no podía detener uno YA ANDANDO. Poner el marcador con el motor en
  # marcha no hacía nada — seguía iterando hasta agotar las 20 vueltas. Quien pausa espera
  # que el motor pare, no que pare el próximo que alguien intente arrancar: sin esto, la
  # única forma de frenarlo era matar el proceso a mano, que es justo lo que el marcador
  # vino a evitar.
  if [ -f "$PAUSA" ]; then
    echo "watchdog: PARE detectado en la iteración $i — dejo de construir. Motivo:" | tee -a "$LOG"
    sed 's/^/  /' "$PAUSA" | tee -a "$LOG"
    echo "watchdog: para reanudar, revisar el log y borrar $PAUSA" | tee -a "$LOG"
    exit 0
  fi

  echo "=== watchdog: iteración $i/$MAX_ITERACIONES — $(date -Iseconds) ===" | tee -a "$LOG"

  # El código de salida del LOOP, no el de tee: sin ${PIPESTATUS[0]} se pierde la
  # distinción entre «no hay avance», «infra caída» y «hay otro builder».
  # KILOPAN_LOOP_CMD (default: loop.sh de verdad) existe para que prueba-arnes.sh pueda
  # sustituir un stub que devuelve un rc exacto — probar el manejo de rc 9 sin gastar en
  # una invocación real de `claude -p` es la única forma honesta de probarlo.
  ${KILOPAN_LOOP_CMD:-bash packages/metodo/scripts/loop.sh --app=$APP} 2>&1 | tee -a "$LOG"
  rc=${PIPESTATUS[0]}

  case "$rc" in
    0)
      sin_avance=0
      # P1 (auditoría 1-ago-2026): loop.sh le pide al AGENTE que corra check.sh --full
      # ANTES de comitear — el marcador last-green que ESE check.sh estampa queda con
      # el HEAD de ANTES del commit (el árbol verificado era el working tree sucio, que
      # recién se vuelve un commit después). "El verde lo estampa el exit code del
      # gate, jamás un agente" (docs/PROMPT_CORRECTIVO.md §9.2) — acá es donde eso se
      # cumple de verdad: watchdog, DUEÑO del proceso y no parte del trabajo del
      # agente, vuelve a correr el gate completo DESPUÉS del commit, sobre el HEAD
      # real. Si no queda verde, el commit que el agente dio por bueno no lo era: se
      # aborta en vez de seguir construyendo sobre algo que nunca se verificó de
      # verdad. No se revierte solo (la lección de camino-dorado.spec.ts:223: un
      # veredicto malo revirtiendo un commit sano es peor que uno rojo esperando).
      echo "watchdog: commit nuevo — re-verificando el gate completo de forma independiente sobre HEAD" | tee -a "$LOG"
      # HEAD, no el árbol (bug real, 06-ago-2026): esta verificación corría sobre el
      # árbol de trabajo, y un WIP ajeno al commit (builder a medio camino, intervención
      # externa) la ponía roja con HEAD sano — «TODOS los DTE» del WIP pausó el motor.
      # Mismo tratamiento que al inicio de iteración: el WIP se guarda en stash con
      # marca — JAMÁS se borra — y el veredicto es sobre lo comiteado.
      # El churn de artefacto es POR APP: `next build` reescribe el `next-env.d.ts` de la que
      # se construyó, y excluir solo el de KiloPan dejaba el de FLOTA contando como WIP ajeno —
      # el motor apartaría en stash un archivo que él mismo acaba de generar, en cada vuelta.
      EXCLUIR_SUCIO_WD=(':!packages/metodo/panel' ':!apps/kilopan/next-env.d.ts' ':!apps/flota/next-env.d.ts')
      if [ -n "$(git status --porcelain -- "${EXCLUIR_SUCIO_WD[@]}" 2>/dev/null)" ]; then
        MARCA_PV="motor-wip-preverify-$(date +%Y%m%d-%H%M%S)"
        if git stash push -u -m "$MARCA_PV (guardado por watchdog.sh — NO borrado)" -- "${EXCLUIR_SUCIO_WD[@]}" >/dev/null 2>&1; then
          echo "watchdog: WIP ajeno al commit apartado en stash '$MARCA_PV' antes de verificar HEAD." | tee -a "$LOG"
          rm -rf apps/*/.next/types apps/*/.next-e2e/types 2>/dev/null || true
        else
          echo "watchdog: no pude apartar el WIP — verifico igual; un rojo aquí puede ser del WIP y no de HEAD." | tee -a "$LOG"
        fi
      fi
      if ! bash packages/metodo/scripts/check.sh --app="$APP" --full 2>&1 | tee -a "$LOG"; then
        pausar "el gate independiente NO dio verde sobre el HEAD que el agente acaba de comitear ($(git rev-parse --short HEAD)). El auto-reporte del agente no es evidencia; revisar a mano."
      fi
      # Publicar lo ya verificado. `loop.sh` comitea local y el agente no tiene permiso de
      # `git push` (.claude/settings.json) — sin este paso el trabajo del motor no llegaba
      # nunca a origin/main ni a CI, y alguien tenía que empujarlo a mano todas las noches:
      # ahí se cortaba la autonomía. Quien publica es este supervisor, no el agente, y sólo
      # el HEAD que el gate independiente acaba de declarar verde (ver empujar-si-verde.sh).
      # Un push fallido (red caída, remoto adelantado) se registra y NO frena el motor:
      # es infraestructura, no un veredicto sobre el código.
      # Dos publicadores, uno por forma de trabajo, y el que corre depende de la rama:
      #
      #   · en `main` → `empujar-si-verde.sh`, que empuja directo.
      #   · en una rama de trabajo → `publicar-pr.sh`, que empuja Y abre o actualiza su PR.
      #
      # Sin el segundo, el motor de una rama construía toda la noche y el trabajo se quedaba
      # local: `empujar-si-verde.sh` se niega a empujar cualquier cosa que no sea `main`, con
      # razón, pero eso dejaba la cadena cortada justo al final. Los dos exigen lo mismo antes
      # de tocar el remoto —`last-green.sha` apuntando al HEAD—, así que la garantía es la misma.
      if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
        PUBLICADOR="packages/metodo/scripts/empujar-si-verde.sh"
      else
        PUBLICADOR="packages/metodo/scripts/publicar-pr.sh"
      fi
      bash "$PUBLICADOR" --app="$APP" 2>&1 | tee -a "$LOG" || \
        echo "watchdog: el push no salió; sigo construyendo, queda para la próxima vuelta." | tee -a "$LOG"
      ;;
    10)
      # CONTRATO ROTO: el motor escribió en db/migraciones/ (bug real, 3-ago-2026,
      # AC-ADM-05). §7 del maestro lo prohíbe en letra grande y nada lo comprobaba nunca.
      # A diferencia de rc 9 (un AC atascado, el motor sigue con el próximo sin drama),
      # esto pausa TODO: ya hay una migración real, sin supervisión, comiteada — alguien
      # con autoridad tiene que mirarla antes de que el motor construya nada más encima.
      pausar "el commit que acaba de landear toca db/migraciones/ — el motor nunca debe escribir ahí (docs/PROMPT_CORRECTIVO.md §7). Revisar qué migración es y decidir si queda, sin relanzar hasta entonces."
      ;;
    9)
      # ATASCADO RECIÉN MARCADO (bug real, 3-ago-2026 — primer AC de Ola 2 que el motor
      # tocó). loop.sh usa rc 9 exactamente UNA vez por AC, en la iteración donde cruza su
      # propio tope y lo anota en acs-atascados.txt. Antes esto salía como rc 1 genérico —
      # indistinguible de «no sé qué hacer» — y como KILOPAN_MAX_FALLOS_AC y
      # MAX_SIN_AVANCE valen 3 los dos, y siguiente_ac() reelige el mismo AC hasta que
      # queda atascado, sus 3 fallos consecutivos eran SIEMPRE también 3 fallos
      # consecutivos para este watchdog: se pausaba en la misma vuelta que el salteo,
      # y «sigo con el siguiente AC» nunca llegaba a probarse.
      # Acá SÍ hay progreso — el motor ya sabe qué va a intentar distinto — así que
      # resetea el contador en vez de sumarlo. NO es rc 3/7: esos no gastan presupuesto
      # de iteración porque el intento no fue real; acá los 3 intentos sí ocurrieron y
      # sí cuestan, así que la iteración se cuenta igual — sólo no empuja hacia la pausa.
      sin_avance=0
      echo "watchdog: AC saltado, no atascamiento del motor — sigo con el siguiente (rc 9)" | tee -a "$LOG"
      ;;
    3)
      # INFRA caída (casilla 5): NO es árbol rojo y NO cuenta como falta de avance.
      # Contarla llevaría a abortar por algo que se arregla solo cuando vuelve la
      # herramienta — y peor, a revertir commits sanos.
      echo "watchdog: INFRA no disponible (rc 3) — espero 3 min y reintento sin penalizar." | tee -a "$LOG"
      sleep 180
      i=$((i - 1))   # el intento no consumió presupuesto de iteraciones
      continue
      ;;
    7)
      # Otro builder vivo (casilla 15). Esperar es lo correcto: dos builders en el
      # mismo worktree eligen el mismo AC y se pisan los commits.
      echo "watchdog: hay otro builder vivo (rc 7) — espero 5 min. No construyo en paralelo." | tee -a "$LOG"
      sleep 300
      i=$((i - 1))
      continue
      ;;
    6)
      # No queda trabajo. Termina LIMPIO (exit 0) para que KeepAlive no lo relance en
      # bucle: el trabajo se acabó, no falló. Si aparecen ACs nuevos, el StartInterval del
      # plist lo vuelve a levantar solo.
      echo "watchdog: DONE — no quedan ACs P0/P1/P2 abiertos. Nada que construir." | tee -a "$LOG"
      exit 0
      ;;
    2)
      # Contrato roto: specs inválidas o AC huérfano. Reintentar no lo arregla.
      pausar "el contrato está roto (rc 2). Corregir specs/ antes de relanzar."
      ;;
    8)
      # Árbol que el loop no controla, o stashes acumulados en serie. Tampoco se arregla
      # girando: el loop ya guardó lo que había, pero alguien tiene que mirar por qué.
      pausar "el loop no pudo dejar el árbol limpio, o hay demasiados stashes acumulados (rc 8). Revisar 'git stash list'."
      ;;
    *)
      sin_avance=$((sin_avance + 1))
      echo "watchdog: sin avance consecutivo #$sin_avance/$MAX_SIN_AVANCE (rc $rc)" | tee -a "$LOG"
      if [ "$sin_avance" -ge "$MAX_SIN_AVANCE" ]; then
        pausar "$MAX_SIN_AVANCE iteraciones sin commit nuevo. Revisar $LOG_DIR/ultimo-loop.log a mano."
      fi
      ;;
  esac

  if ! grep -qE '^- \[ \] \(P[0-9]' IMPLEMENTATION_PLAN.md; then
    echo "watchdog: IMPLEMENTATION_PLAN.md sin ACs P0/P1/P2 abiertos — DONE" | tee -a "$LOG"
    exit 0
  fi

  sleep 10
done

echo "watchdog: tope de $MAX_ITERACIONES iteraciones alcanzado (no es una falla — es la política de 'nunca desatendido indefinidamente'). Revisar el panel y relanzar si corresponde." | tee -a "$LOG"
