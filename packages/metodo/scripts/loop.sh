#!/usr/bin/env bash
# Una iteración plan -> build -> verify sobre el siguiente AC abierto de
# IMPLEMENTATION_PLAN.md (P0 antes que P1 antes que P2). Se invoca desde watchdog.sh
# o a mano. Exit 0 = commit nuevo landed; exit 1 = sin avance (el watchdog decide qué
# hacer con eso, ver docs/LECCION_RALPH.md).
set -uo pipefail
export PATH="$HOME/.local/lib/nodejs/current/bin:$PATH"
cd "$(dirname "$0")/../../.."

APP="kilopan"
for arg in "$@"; do
  case "$arg" in
    --app=*) APP="${arg#--app=}" ;;
    *) echo "loop.sh: argumento desconocido '$arg' (uso: [--app=kilopan|flota])"; exit 2 ;;
  esac
done

# Un plan por app: `siguiente_ac` no debe cruzar productos.
PLAN="IMPLEMENTATION_PLAN_${APP}.md"
if [ ! -f "$PLAN" ] && [ "$APP" = "kilopan" ] && [ -f "IMPLEMENTATION_PLAN.md" ]; then
  PLAN="IMPLEMENTATION_PLAN.md"   # nombre histórico, previo a la separación por app
fi
[ -f "$PLAN" ] || { echo "loop: falta $PLAN"; exit 2; }
LOG_DIR="packages/metodo/panel"
MAX_BUDGET_USD="${KILOPAN_MAX_BUDGET_USD:-3}"

# UN SOLO BUILDER POR WORKTREE (casilla 15). Se toma ANTES de mirar el plan: dos loops
# que leen el mismo plan eligen el mismo AC y se pisan los commits. El 26-jul-2026 dos
# sesiones construyeron KiloPan a la vez durante horas — este lock es la respuesta.
# Exit 7 = ya hay otro builder vivo; el watchdog lo trata como «esperar», no como rojo.
if ! bash packages/metodo/scripts/lock.sh tomar "builder-$APP" $$; then
  echo "loop: ya hay otro builder vivo en este worktree — no arranco (exit 7)"
  exit 7
fi
trap 'bash packages/metodo/scripts/lock.sh soltar "builder-'"$APP"'" '"$$"' >/dev/null 2>&1' EXIT INT TERM

# EL CONTRATO PRIMERO. Sin specs válidas no se construye — este abort es exactamente lo
# que faltaba hasta el 26-jul-2026 y lo que dejó al motor produciendo tandas A-F de
# reparación en vez de ACs verificados.
if ! node packages/metodo/scripts/gate_specs.mjs "--app=$APP"; then
  echo "ABORT: specs incompletas o sin fuente. Specs primero."
  exit 2
fi
if ! node packages/metodo/scripts/verify-refs.mjs "--app=$APP"; then
  echo "ABORT: hay ACs citados que ninguna spec define."
  exit 2
fi

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

PROMPT="Estudiá AGENTS.md antes de tocar nada. Estás construyendo ${APP} en este monorepo.
Implementá EXACTAMENTE este ítem, nada más:

${AC_LINEA}

Reglas duras:
- El AC vive en specs/${APP}/ — esa es su definición canónica y durable. ${PLAN} solo
  lleva su estado. Leé la spec dueña del AC y la sección del maestro que cita su línea
  'Fuente: §N' (docs/PROMPT_MAESTRO*.md) ANTES de escribir código.
- Un AC = un commit, con su test naciendo en el mismo commit.
- Corré 'bash packages/metodo/scripts/check.sh --full --app=${APP}' y NO hagas commit si
  no queda verde (arreglar lo que encuentres es parte del AC).
- Si el gate pasa, marcá el AC como [x] EN SU SPEC (specs/${APP}/) y en ${PLAN}, en el
  MISMO commit, con una nota breve de qué se probó.
- Un AC no se marca [x] si todavía falta parte de él. Si quedó a medias, partilo: cerrá
  lo hecho y dejá el resto como AC abierto nuevo en la spec. Un [x] cuyo texto dice
  'falta' pone el gate en rojo — y con razón.
- No toques ningún otro AC ni refactorices código no relacionado.
- Si el AC ya está hecho o depende de algo que no existe aún, decilo explícitamente y no
  inventes trabajo ni marques nada como [x]."

mkdir -p "$LOG_DIR"
claude -p "$PROMPT" \
  --output-format json \
  --max-budget-usd "$MAX_BUDGET_USD" \
  --permission-mode acceptEdits \
  --model "$(bash packages/metodo/scripts/model-selector.sh build "$APP")" \
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
