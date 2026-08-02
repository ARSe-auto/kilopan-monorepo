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

LOG_DIR="packages/metodo/panel"
PIDFILE="$LOG_DIR/loop.pid"
LOG="$LOG_DIR/watchdog.log"
MAX_SIN_AVANCE="${KILOPAN_MAX_SIN_AVANCE:-3}"
MAX_ITERACIONES="${KILOPAN_MAX_ITERACIONES:-20}"

mkdir -p "$LOG_DIR"
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

if ! command -v claude >/dev/null 2>&1; then
  echo "watchdog: ABORT — 'claude' no resuelve en el PATH de este proceso ($PATH)." | tee -a "$LOG"
  echo "watchdog: esto NO es un chequeo cosmético — así se perdieron ~15h en eauto-crm-next." | tee -a "$LOG"
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "watchdog: ABORT — 'pnpm' no resuelve en el PATH de este proceso." | tee -a "$LOG"
  exit 1
fi

echo "watchdog: arrancando — PATH ok, claude=$(command -v claude), tope ${MAX_ITERACIONES} iteraciones, ${MAX_SIN_AVANCE} sin avance seguidas aborta" | tee -a "$LOG"

sin_avance=0
i=0
while [ "$i" -lt "$MAX_ITERACIONES" ]; do
  i=$((i + 1))
  echo "=== watchdog: iteración $i/$MAX_ITERACIONES — $(date -Iseconds) ===" | tee -a "$LOG"

  # El código de salida del LOOP, no el de tee: sin ${PIPESTATUS[0]} se pierde la
  # distinción entre «no hay avance», «infra caída» y «hay otro builder».
  bash packages/metodo/scripts/loop.sh 2>&1 | tee -a "$LOG"
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
      if ! bash packages/metodo/scripts/check.sh --full 2>&1 | tee -a "$LOG"; then
        echo "watchdog: ABORT — el gate independiente NO dio verde sobre el HEAD que el agente acaba de comitear ($(git rev-parse --short HEAD)). El auto-reporte del agente no es evidencia; revisar a mano, NO reintentar solo." | tee -a "$LOG"
        exit 1
      fi
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
    2)
      # Contrato roto: specs inválidas o AC huérfano. Reintentar no lo arregla.
      echo "watchdog: ABORT — el contrato está roto (rc 2). Corregir specs/ antes de relanzar." | tee -a "$LOG"
      exit 1
      ;;
    *)
      sin_avance=$((sin_avance + 1))
      echo "watchdog: sin avance consecutivo #$sin_avance/$MAX_SIN_AVANCE (rc $rc)" | tee -a "$LOG"
      if [ "$sin_avance" -ge "$MAX_SIN_AVANCE" ]; then
        echo "watchdog: ABORT — $MAX_SIN_AVANCE iteraciones sin commit nuevo. Revisar $LOG_DIR/ultimo-loop.log a mano, NO reintentar solo." | tee -a "$LOG"
        exit 1
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
