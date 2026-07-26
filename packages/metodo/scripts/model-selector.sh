#!/usr/bin/env bash
# model-selector.sh — ruteo de modelo por fase y por naturaleza del ítem (§8 del maestro).
#
# Uso:  model-selector.sh <plan|build|verify|juez>   → imprime el model-id
# cwd = la raíz del monorepo.
#
# LA ADVERTENCIA DEL MAESTRO, LITERAL: «El selector de modelo es un script y se testea
# contra el caso normal (un selector no-op que todo lo manda a Opus quema la ventana en
# silencio — pasó en e-auto)». Por eso prueba-arnes.sh exige que este script DIFERENCIE:
# si todo cayera al mismo modelo, la suite se pone roja aunque el script "funcione".
#
# CONVENCIÓN REAL vs. TEÓRICA: §8 habla de tags [security]/[datos]/[HIG], pero el plan de
# KiloPan etiqueta con sufijo de prioridad — (P0-SEC), (P1-PERF), (P1). Se reconocen AMBAS:
# clasificar solo por la teórica dejaría 9 ítems -SEC ruteados como si fueran rutina.
set -uo pipefail
cd "$(dirname "$0")/../../.."

OPUS="claude-opus-4-8"
SONNET="claude-sonnet-5"
HAIKU="claude-haiku-4-5"   # alias estable: inmune al retiro del snapshot fechado

FASE="${1:-build}"
APP="${2:-kilopan}"

case "$FASE" in
  plan|verify) echo "${PLAN_MODEL:-$SONNET}"; exit 0 ;;   # leen mucho, deciden poco
  juez)        echo "${JUEZ_MODEL:-$OPUS}";   exit 0 ;;   # mandato de refutar
  build)       : ;;
  *)           echo "$SONNET"; exit 0 ;;
esac

[ -n "${BUILD_MODEL:-}" ] && { echo "$BUILD_MODEL"; exit 0; }   # override manual

PLAN="IMPLEMENTATION_PLAN_${APP}.md"
[ -f "$PLAN" ] || PLAN="IMPLEMENTATION_PLAN.md"

# Ítem de cabeza: el primero SIN marcar, que es el que el builder va a tomar. Clasificar
# por cualquier otro rutea el modelo del ítem equivocado (bug real de e-auto: un ítem
# bloqueado vivía primero en el plan y mandó 14/14 builds a Opus en vano).
item="$(grep -E '^- \[ \] \(P[0-9]' "$PLAN" 2>/dev/null | grep -v -E '\[HUMANO\]|\[VIVO\]' | head -1)"

# Fail-safe: sin ítem legible no arriesgamos una regla dura ⇒ Opus.
if [ -z "$item" ]; then
  echo "$(date '+%F %T') model-selector: sin ítem legible en $PLAN — fallback Opus" \
    >> packages/metodo/panel/model-selector-fallback.log 2>/dev/null
  echo "$OPUS"; exit 0
fi

# (1) REGLA DURA ⇒ Opus. Gana sobre todo lo demás.
#     (a) tags: -SEC (convención real del plan) o [security]/[datos] (convención de §8)
#     (b) backstop por tokens INEQUÍVOCOS de regla dura. Nada de substrings comunes
#         («foto», «sesión», «cliente») que sobre-rutearían medio plan a Opus.
# Sin `\b` y sin clases con acentos: `\b` NO es ERE portable (GNU y ugrep lo aceptan,
# el grep BSD de /usr/bin no) y este script correrá bajo launchd, con un PATH donde
# `grep` es /usr/bin/grep. Un selector que clasifica distinto según quién lo invoca es
# peor que uno tonto. Los tokens de abajo son distintivos por sí solos; no necesitan
# frontera de palabra. `migraci` cubre migración/migracion/migraciones sin tocar UTF-8.
DURO='DL-FOLIO|correlativo_pedido|SECURITY DEFINER|round_clp|valida_rut|DTE|folio_sii|pan_app|supersede|write-once|RLS|migraci|trigger|esquema|invariante'
printf '%s' "$item" | grep -qE '\(P[0-9]-SEC\)|\[security\]|\[datos\]' && { echo "$OPUS"; exit 0; }
printf '%s' "$item" | grep -qiE "$DURO"                                && { echo "$OPUS"; exit 0; }

# (2) ESCALACIÓN DE DOS STRIKES (§8): 2 fallos del gate en el mismo AC ⇒ subir un nivel.
#     Solo aplica a ítems no-duros; los duros ya están en Opus, que es el techo.
fallos="$(cat .ralph/build-fails 2>/dev/null | tr -dc 0-9)"; fallos="${fallos:-0}"
[ "$fallos" -ge 2 ] && { echo "$OPUS";   exit 0; }
[ "$fallos" -ge 1 ] && { echo "$SONNET"; exit 0; }   # un fallo ⇒ piso Sonnet, no re-bajar

# (3) RUTEO POR VELOCIDAD (primer intento, ítem no-duro).
#     UI/pulido táctil ⇒ Haiku; si falla, la escalación lo sube solo.
printf '%s' "$item" | grep -qE '\[HIG\]|\(P[0-9]-HIG\)' && { echo "$HAIKU"; exit 0; }
printf '%s' "$item" | grep -qiE 'pantalla|chip|selector en el dashboard|boton|botón|UI de |mapa |skeleton|contraste' \
  && { echo "$HAIKU"; exit 0; }
echo "$SONNET"
