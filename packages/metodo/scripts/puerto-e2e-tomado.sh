#!/usr/bin/env bash
# puerto-e2e-tomado.sh — ¿hay un servidor zombi sentado en el puerto del e2e?
#
# ─── EL BUG QUE LO TRAE (12-ago-2026, AC-FSEM-16) ────────────────────────────────
#
# Una corrida anterior murió sin bajar su servidor y dejó el 3311 tomado. Playwright no usa
# `reuseExistingServer`, así que aborta con «is already used» — y eso llega al resumen del
# gate como un rojo pelado de «e2e móvil 390x844», indistinguible de una prueba que falla.
# El motor pausó, y el diagnóstico apuntaba al AC que acababa de construir. El AC estaba
# bien. Mientras el zombi viva, TODO gate completo sale rojo, así que reintentar no arregla
# nada: hay que decir qué pasa.
#
# Es el patrón que se repitió toda la noche: el arnés frenando trabajo sano y mandando a
# revisar el lugar equivocado. Lo que faltaba no era una comprobación más — era que el rojo
# dijera la verdad.
#
# ─── POR QUÉ NO MATA NADA ────────────────────────────────────────────────────────
#
# Matar procesos que este gate no arrancó es exactamente como se pierde el trabajo de una
# sesión vecina que está corriendo su propio e2e. Este guion MIRA y CUENTA; bajar el
# proceso es una decisión de quien sepa de quién es.
#
# Uso:  puerto-e2e-tomado.sh --app=<app> [--puerto=<n>]
#       Sin --puerto lo lee de `apps/<app>/playwright.config.ts`, que es la fuente: clavarlo
#       acá lo dejaría envejecer aparte del que el e2e usa de verdad.
# Exit: 0 = libre (o no se pudo mirar) · 1 = tomado, con los pids en la salida.
set -euo pipefail

APP=""
PUERTO=""
for arg in "$@"; do
  case "$arg" in
    --app=*)    APP="${arg#*=}" ;;
    --puerto=*) PUERTO="${arg#*=}" ;;
  esac
done

if [ -z "$PUERTO" ]; then
  [ -n "$APP" ] || { echo "puerto-e2e-tomado: falta --app=<app> o --puerto=<n>" >&2; exit 2; }
  CONFIG="apps/$APP/playwright.config.ts"
  [ -f "$CONFIG" ] || { echo "puerto-e2e-tomado: no hay $CONFIG — nada que mirar."; exit 0; }
  PUERTO="$(grep -oE '^const PUERTO = [0-9]+' "$CONFIG" 2>/dev/null | grep -oE '[0-9]+' | head -1)"
fi

if [ -z "$PUERTO" ]; then
  echo "puerto-e2e-tomado: no pude leer el puerto de la config — sigo sin opinar."
  exit 0
fi

if ! command -v lsof >/dev/null 2>&1; then
  # Declarado en voz alta: un verde por no haber podido mirar no es un verde.
  echo "puerto-e2e-tomado: no hay lsof en esta máquina — NO se verificó el puerto $PUERTO."
  exit 0
fi

# El `|| true` NO es decorativo: `lsof -ti` sale con 1 cuando no encuentra nada, y con
# `set -e` + `pipefail` eso mataba este guion en silencio, con exit 1 y sin imprimir una
# línea. O sea: un puerto LIBRE se reportaba como tomado, y el aviso —que existe para
# decir «no es el AC»— habría gritado en cada corrida hasta que nadie lo mirara. Lo
# encontró su propia prueba, ejerciendo el caso aburrido.
PIDS="$( { lsof -ti ":$PUERTO" 2>/dev/null || true; } | tr '\n' ' ' | sed 's/ *$//')"
if [ -z "$PIDS" ]; then
  echo "puerto-e2e-tomado: el puerto $PUERTO está libre."
  exit 0
fi

echo "puerto-e2e-tomado: el puerto $PUERTO YA ESTÁ TOMADO por: $PIDS"
echo "puerto-e2e-tomado: es un servidor de una corrida anterior que no se bajó. Playwright va a"
echo "puerto-e2e-tomado: abortar con «is already used» y el rojo va a parecer de la prueba, no del"
echo "puerto-e2e-tomado: puerto. Bajalo (kill $PIDS) y volvé a correr: NO es el AC."
exit 1
