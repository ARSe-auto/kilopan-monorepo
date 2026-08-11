#!/usr/bin/env bash
# publicar-pr.sh — empuja la rama y abre (o actualiza) su PR, sin intervención humana.
#
# POR QUÉ EXISTE. El último tramo de la cadena autónoma se cortaba acá: el trabajo quedaba
# verificado y comiteado, y alguien tenía que empujarlo y abrir el PR a mano. El 10-ago-2026 eso
# costó una vuelta entera de ida y vuelta — y el motivo real no era técnico: `gh` no estaba
# instalado en la máquina, y `git push`/`gh` estaban en el `deny` del arnés.
#
# Las tres piezas quedaron resueltas y este script las usa:
#   1. `gh` vive en ~/.local/bin (instalado desde el release oficial, sin Homebrew).
#   2. `git push` y `gh` salieron del `deny` por decisión del dueño.
#   3. `gh auth` guardó su token en el llavero, con scope `repo`.
#
# LA GARANTÍA QUE NO SE AFLOJA. El criterio original del arnés era «el agente construye y
# verifica, pero no publica». Lo que lo sostenía no era la prohibición de empujar: era que no se
# publicara lo no verificado. Por eso este script exige que `last-green.sha` apunte al HEAD —el
# marcador que estampa `check.sh` con su propio exit code, jamás un agente— antes de tocar el
# remoto. Sin gate verde sobre ESTE commit, no publica y dice por qué.
#
# Uso:  bash packages/metodo/scripts/publicar-pr.sh --app=flota [--titulo="..."] [--cuerpo=archivo]
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/../../.."

APP="flota"
TITULO=""
CUERPO=""
for arg in "$@"; do
  case "$arg" in
    --app=*)    APP="${arg#--app=}" ;;
    --titulo=*) TITULO="${arg#--titulo=}" ;;
    --cuerpo=*) CUERPO="${arg#--cuerpo=}" ;;
    *) echo "publicar-pr: argumento desconocido '$arg'"; exit 2 ;;
  esac
done

RAMA="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"
PANEL="${KILOPAN_PANEL_DIR:-packages/metodo/panel}"
MARCADOR="$PANEL/last-green.sha"

if [ "$RAMA" = "main" ]; then
  echo "publicar-pr: estás en main — un PR necesita una rama propia. NO publico."
  exit 2
fi

# El gate INDEPENDIENTE sobre este HEAD, o nada. El marcador se lee del disco y no de git: no
# hace falta comitearlo (y comitearlo lo rompería, porque HEAD avanzaría más allá de lo que él
# dice — mismo detalle que documenta `empujar-si-verde.sh`).
if [ ! -f "$MARCADOR" ]; then
  echo "publicar-pr: no hay $MARCADOR — el gate nunca corrió acá. NO publico."
  exit 1
fi
if [ "$(cat "$MARCADOR")" != "$HEAD_SHA" ]; then
  echo "publicar-pr: last-green apunta a $(cut -c1-8 < "$MARCADOR") y HEAD es $(echo "$HEAD_SHA" | cut -c1-8)."
  echo "publicar-pr: este commit NO pasó el gate independiente. Corré 'check.sh --app=$APP --full' y volvé."
  exit 1
fi

command -v gh >/dev/null 2>&1 || { echo "publicar-pr: falta 'gh' (esperado en ~/.local/bin)"; exit 127; }
gh auth status >/dev/null 2>&1 || { echo "publicar-pr: 'gh' sin sesión — correr 'gh auth login --web'"; exit 1; }

echo "publicar-pr: gate verde sobre $(echo "$HEAD_SHA" | cut -c1-8) — publicando '$RAMA'"
git push -u origin "$RAMA" || { echo "publicar-pr: el push falló. No reintento solo."; exit 1; }

# Si el PR ya existe, el push de arriba ya lo actualizó: se informa y no se duplica.
EXISTENTE="$(gh pr list --head "$RAMA" --json url --jq '.[0].url' 2>/dev/null)"
if [ -n "${EXISTENTE:-}" ] && [ "$EXISTENTE" != "null" ]; then
  echo "publicar-pr: el PR ya existe y quedó actualizado con el push."
  echo "$EXISTENTE"
  exit 0
fi

[ -n "$TITULO" ] || TITULO="$(git log -1 --pretty=%s)"
if [ -n "$CUERPO" ] && [ -f "$CUERPO" ]; then
  gh pr create --base main --head "$RAMA" --title "$TITULO" --body-file "$CUERPO"
else
  # Sin cuerpo dado, el de los commits de la rama: es lo que de verdad cambió, y cada mensaje ya
  # explica su porqué.
  gh pr create --base main --head "$RAMA" --title "$TITULO" \
    --body "$(git log --reverse --pretty='- %s' origin/main..HEAD 2>/dev/null || git log --reverse --pretty='- %s' -20)"
fi
