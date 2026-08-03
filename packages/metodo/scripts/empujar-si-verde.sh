#!/usr/bin/env bash
# empujar-si-verde.sh — cierra el último hueco de la cadena autónoma.
#
# `loop.sh` comitea LOCAL y nunca empuja (a propósito: el agente no tiene permiso de
# `git push`, ver .claude/settings.json). Sin nadie que empuje, el trabajo del motor no
# llega a `origin/main` ni a CI, y «tres corridas verdes» deja de darse solo. Eso lo venía
# haciendo una persona a mano — o sea, la autonomía se cortaba ahí todas las noches.
#
# Este script NO es el agente y no decide nada de código: solo publica lo que el gate
# INDEPENDIENTE ya declaró verde. La regla es una sola y es verificable:
#
#     se empuja únicamente si `last-green.sha` == HEAD
#
# `last-green.sha` lo estampa `check.sh` con su propio exit code (jamás un agente,
# docs/PROMPT_CORRECTIVO.md §9.2), y el watchdog re-corre el gate completo sobre el HEAD
# real después de cada commit. Si el marcador apunta al HEAD, ese HEAD pasó el gate
# entero de forma independiente. Si no, no se empuja y se dice por qué.
#
# Uso: bash packages/metodo/scripts/empujar-si-verde.sh
# Exit: 0 empujado o nada que empujar · 1 hay algo que empujar pero NO está verificado.
set -uo pipefail
export PATH="$HOME/.local/lib/nodejs/current/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/../../.."

PANEL="packages/metodo/panel"
RAMA="$(git rev-parse --abbrev-ref HEAD)"

if [ "$RAMA" != "main" ]; then
  echo "empujar: la rama es '$RAMA', no main — no empujo."
  exit 0
fi

PENDIENTES="$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')"
if [ "${PENDIENTES:-0}" -eq 0 ]; then
  echo "empujar: nada pendiente, origin/main ya está al día."
  exit 0
fi

# Árbol sucio = hay trabajo a medias encima del commit que se quiere publicar. Se excluye
# lo que está sucio SIEMPRE por construcción, igual que en loop.sh.
SUCIO="$(git status --porcelain -- ':!packages/metodo/panel' ':!apps/kilopan/next-env.d.ts' 2>/dev/null)"
if [ -n "$SUCIO" ]; then
  echo "empujar: NO empujo — el árbol tiene cambios sin comitear encima:"
  echo "$SUCIO" | sed 's/^/  /'
  exit 1
fi

VERDE="$(cat "$PANEL/last-green.sha" 2>/dev/null | tr -dc '0-9a-f')"
HEAD_SHA="$(git rev-parse HEAD)"

if [ -z "$VERDE" ]; then
  echo "empujar: NO empujo — no hay marcador de verde ($PANEL/last-green.sha vacío o ausente)."
  exit 1
fi

if [ "$VERDE" != "$HEAD_SHA" ]; then
  echo "empujar: NO empujo — el marcador de verde apunta a ${VERDE:0:7} y HEAD es ${HEAD_SHA:0:7}."
  echo "empujar: ese HEAD no pasó el gate independiente. Correr 'bash packages/metodo/scripts/check.sh --full' y revisar."
  exit 1
fi

echo "empujar: HEAD ${HEAD_SHA:0:7} verificado por el gate independiente — empujando $PENDIENTES commit(s)."
if git push origin main 2>&1 | sed 's/^/  /'; then
  echo "empujar: OK."
  exit 0
fi
echo "empujar: el push FALLÓ (¿remoto adelantado, o red caída?). No reintento solo."
exit 1
