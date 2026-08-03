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
# $3 = el AC que el builder REALMENTE va a construir. Opcional y retrocompatible: sin él
# este script vuelve a adivinarlo leyendo el plan, que es lo que hacía —y hacía mal—.
AC_ID="${3:-}"

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
#
# EL MISMO BUG VOLVIÓ POR OTRA PUERTA (3-ago-2026). `loop.sh` saltea los ACs anotados en
# `panel/acs-atascados.txt`; este script no los conocía, así que con 8 atascados en la
# lista clasificaba un AC que el builder no iba a tocar. Se arregla por los dos lados:
# `loop.sh` ahora pasa el AC_ID que eligió —fuente de verdad, sin adivinar—, y el
# fallback saltea los atascados igual que él.
item=""
if [ -n "$AC_ID" ]; then
  item="$(grep -E "^- \[ \].*\[${AC_ID}\]" "$PLAN" 2>/dev/null | head -1)"
fi
if [ -z "$item" ]; then
  ATASCADOS="packages/metodo/panel/acs-atascados.txt"
  item="$(grep -E '^- \[ \] \(P[0-9]' "$PLAN" 2>/dev/null | grep -v -E '\[HUMANO\]|\[VIVO\]' \
    | { if [ -s "$ATASCADOS" ]; then grep -v -F -f "$ATASCADOS"; else cat; fi; } | head -1)"
fi

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
#
# BUCLE DE MUERTE (bug real, 3-ago-2026 — el motor quemó ~2 h y 9 iteraciones en él).
# Esta regla dice «en el MISMO AC» pero leía `.ralph/build-fails`, que es GLOBAL y sólo
# vuelve a cero cuando ALGÚN commit entra (`loop.sh`). Sin commits nunca baja: llegó a 14.
# Con `>= 2 ⇒ Opus`, TODO build salía a Opus para siempre, Opus agotaba el presupuesto de
# la iteración (`budget_exhausted` a los ~18 min) antes de poder comitear, y no comitear
# subía el contador otra vez. Ciclo cerrado: el motor no podía salir solo, y cada vuelta
# dejaba un stash más hasta pausarse por `rc 8`. `loop.sh` ya lleva el contador POR AC en
# `.ralph/fallos/<AC_ID>` —y lo borra al cerrarlo—: ese es el que esta regla siempre quiso
# leer. El global queda como fallback para cuando nadie nos dice qué AC es.
# Con AC_ID el contador es SIEMPRE el de ese AC, exista el archivo o no: que no exista
# significa CERO fallos propios (nunca se intentó), no «preguntale al global». Caer al
# global ahí reintroduce el mismo bucle por la puerta de atrás — pasó al escribir este
# arreglo y sólo se vio ejecutándolo contra un AC sin fallos.
if [ -n "$AC_ID" ]; then
  fallos="$(cat ".ralph/fallos/$AC_ID" 2>/dev/null | tr -dc 0-9)"
else
  fallos="$(cat .ralph/build-fails 2>/dev/null | tr -dc 0-9)"
fi
fallos="${fallos:-0}"
[ "$fallos" -ge 2 ] && { echo "$OPUS";   exit 0; }
[ "$fallos" -ge 1 ] && { echo "$SONNET"; exit 0; }   # un fallo ⇒ piso Sonnet, no re-bajar

# (3) RUTEO POR VELOCIDAD (primer intento, ítem no-duro).
#     UI/pulido táctil ⇒ Haiku; si falla, la escalación lo sube solo.
printf '%s' "$item" | grep -qE '\[HIG\]|\(P[0-9]-HIG\)' && { echo "$HAIKU"; exit 0; }
printf '%s' "$item" | grep -qiE 'pantalla|chip|selector en el dashboard|boton|botón|UI de |mapa |skeleton|contraste' \
  && { echo "$HAIKU"; exit 0; }
echo "$SONNET"
