#!/usr/bin/env bash
# Una iteración plan -> build -> verify sobre el siguiente AC abierto de
# IMPLEMENTATION_PLAN.md (P0 antes que P1 antes que P2). Se invoca desde watchdog.sh
# o a mano. Exit 0 = commit nuevo landed; exit 1 = sin avance (el watchdog decide qué
# hacer con eso, ver docs/LECCION_RALPH.md).
set -uo pipefail
export PATH="$HOME/.local/lib/nodejs/current/bin:$PATH"
cd "$(dirname "$0")/../../.."

PLAN="IMPLEMENTATION_PLAN.md"
LOG_DIR="packages/metodo/panel"
MAX_BUDGET_USD="${KILOPAN_MAX_BUDGET_USD:-3}"
MODELO="${KILOPAN_MODELO:-sonnet}"

siguiente_ac() {
  for prioridad in '\(P0' '\(P1' '\(P2'; do
    linea=$(grep -m1 -E "^- \[ \] ${prioridad}" "$PLAN" || true)
    if [ -n "$linea" ]; then
      echo "$linea"
      return 0
    fi
  done
  return 1
}

AC_LINEA="$(siguiente_ac)"
if [ -z "${AC_LINEA:-}" ]; then
  echo "loop: no quedan ACs P0/P1/P2 abiertos — ver criterio DONE en $PLAN"
  exit 0
fi
AC_ID=$(echo "$AC_LINEA" | grep -oE '\[AC-[A-Z0-9-]+\]' | tr -d '[]')
echo "loop: siguiente = ${AC_ID:-sin-id} :: $AC_LINEA"

COMMITS_ANTES=$(git rev-list --count HEAD 2>/dev/null || echo 0)

PROMPT="Estás construyendo KiloPan siguiendo IMPLEMENTATION_PLAN.md al pie de la letra.
Implementá EXACTAMENTE este ítem, nada más:

${AC_LINEA}

Reglas duras:
- Leé el AC completo en IMPLEMENTATION_PLAN.md y, si corresponde, la sección relevante
  de ../KiloPan-propuesta/PROMPT_MAESTRO.md antes de escribir código.
- Un AC = un commit, con su test naciendo en el mismo commit.
- Corré 'bash packages/metodo/scripts/check.sh --full' y NO hagas commit si no queda
  verde (arreglar lo que encuentres es parte del AC).
- Si el gate pasa, marcá esa línea como [x] en IMPLEMENTATION_PLAN.md como parte del
  MISMO commit, con una nota breve de qué se probó.
- No toques ningún otro AC ni refactorices código no relacionado.
- Si el AC ya está hecho o no aplica todavía (depende de algo que no existe aún),
  decilo explícitamente y no inventes trabajo ni marques nada como [x]."

mkdir -p "$LOG_DIR"
claude -p "$PROMPT" \
  --output-format json \
  --max-budget-usd "$MAX_BUDGET_USD" \
  --permission-mode acceptEdits \
  --model "$MODELO" \
  --fallback-model sonnet \
  > "$LOG_DIR/ultimo-resultado.json" 2>>"$LOG_DIR/ultimo-loop.log"

COMMITS_DESPUES=$(git rev-list --count HEAD 2>/dev/null || echo 0)
node "$LOG_DIR/generar.mjs" >/dev/null 2>&1 || true

if [ "$COMMITS_DESPUES" -gt "$COMMITS_ANTES" ]; then
  echo "loop: OK — commit nuevo (${COMMITS_ANTES} -> ${COMMITS_DESPUES}) para ${AC_ID:-?}"
  exit 0
else
  echo "loop: SIN AVANCE para ${AC_ID:-?} — ver $LOG_DIR/ultimo-loop.log y ultimo-resultado.json"
  exit 1
fi
