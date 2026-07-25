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

  if bash packages/metodo/scripts/loop.sh 2>&1 | tee -a "$LOG"; then
    sin_avance=0
  else
    sin_avance=$((sin_avance + 1))
    echo "watchdog: sin avance consecutivo #$sin_avance/$MAX_SIN_AVANCE" | tee -a "$LOG"
    if [ "$sin_avance" -ge "$MAX_SIN_AVANCE" ]; then
      echo "watchdog: ABORT — $MAX_SIN_AVANCE iteraciones sin commit nuevo. Revisar $LOG_DIR/ultimo-loop.log a mano, NO reintentar solo." | tee -a "$LOG"
      exit 1
    fi
  fi

  if ! grep -qE '^- \[ \] \(P[0-9]' IMPLEMENTATION_PLAN.md; then
    echo "watchdog: IMPLEMENTATION_PLAN.md sin ACs P0/P1/P2 abiertos — DONE" | tee -a "$LOG"
    exit 0
  fi

  sleep 10
done

echo "watchdog: tope de $MAX_ITERACIONES iteraciones alcanzado (no es una falla — es la política de 'nunca desatendido indefinidamente'). Revisar el panel y relanzar si corresponde." | tee -a "$LOG"
