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

# EN macOS `lsof` VIVE EN /usr/sbin, QUE NO ESTÁ EN EL PATH DEL MOTOR (12-ago-2026). El
# `arrancar-motor-flota.sh` fija PATH=…/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin —
# sin /usr/sbin—, así que bajo el motor este guion se declaraba «sin lsof» y no verificaba
# NADA; en una terminal, con el PATH del usuario, funcionaba. Los cuatro casos de
# prueba-arnes que revisan el TEXTO del aviso quedaban en rojo porque no había aviso, y el
# gate entero se caía por eso. Se busca por ruta absoluta antes de rendirse.
LSOF=""
if command -v lsof >/dev/null 2>&1; then LSOF="$(command -v lsof)"
elif [ -x /usr/sbin/lsof ]; then LSOF=/usr/sbin/lsof
elif [ -x /usr/bin/lsof ]; then LSOF=/usr/bin/lsof
fi
if [ -z "$LSOF" ]; then
  # Declarado en voz alta: un verde por no haber podido mirar no es un verde.
  echo "puerto-e2e-tomado: no hay lsof en esta máquina — NO se verificó el puerto $PUERTO."
  exit 0
fi

# El `|| true` NO es decorativo: `lsof -ti` sale con 1 cuando no encuentra nada, y con
# `set -e` + `pipefail` eso mataba este guion en silencio, con exit 1 y sin imprimir una
# línea. O sea: un puerto LIBRE se reportaba como tomado, y el aviso —que existe para
# decir «no es el AC»— habría gritado en cada corrida hasta que nadie lo mirara. Lo
# encontró su propia prueba, ejerciendo el caso aburrido.
PIDS="$( { "$LSOF" -ti ":$PUERTO" 2>/dev/null || true; } | tr '\n' ' ' | sed 's/ *$//')"
if [ -z "$PIDS" ]; then
  echo "puerto-e2e-tomado: el puerto $PUERTO está libre."
  exit 0
fi

echo "puerto-e2e-tomado: el puerto $PUERTO está TOMADO. Playwright va a abortar con «is already"
echo "puerto-e2e-tomado: used», y ese rojo va a parecer de la prueba y no del puerto: NO es el AC."
echo "puerto-e2e-tomado: quién lo tiene, con su hora de arranque —"
for pid in $PIDS; do
  # LA HORA ABSOLUTA, NO LA EDAD RELATIVA. Esto no es cosmético: el 12-ago-2026 leí el
  # `etime` de este mismo puerto como «1 h 06 min» cuando decía «1 min 06 s» —el formato es
  # [[dd-]hh:]mm:ss— y sobre esa lectura di por muerto un servidor que estaba VIVO,
  # sirviendo la corrida de otra sesión. Estuve a un comando de matarle el trabajo. Una
  # marca de tiempo absoluta no se puede leer mal de esa manera.
  echo "puerto-e2e-tomado:   pid $pid — arrancó $( { ps -p "$pid" -o lstart= 2>/dev/null || true; } | sed 's/^ *//' )"
done
echo "puerto-e2e-tomado: ANTES DE MATAR NADA, mirá esa hora. Si arrancó hace un momento, es una"
echo "puerto-e2e-tomado: corrida VIVA —tuya o de otra sesión en este árbol— y Playwright lo va a"
echo "puerto-e2e-tomado: bajar solo al terminar: esperá. Si es viejo y nadie está corriendo el"
echo "puerto-e2e-tomado: e2e, ahí sí es un residuo. Este guion no lo decide por vos a propósito:"
echo "puerto-e2e-tomado: matar lo que no arrancó este gate es como se pierde el trabajo del vecino."
exit 1
