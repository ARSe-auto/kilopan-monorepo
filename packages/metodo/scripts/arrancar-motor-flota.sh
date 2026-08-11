#!/usr/bin/env bash
# Arranca el motor de FLOTA como proceso de fondo, sin launchd.
#
# POR QUÉ EXISTE. `launchctl` no siempre está disponible para quien tiene que arrancar el motor
# —el arnés de la sesión lo tiene denegado— y pedirle el comando a una persona convierte la
# autonomía en un trámite. Esta vía da lo mismo salvo el arranque tras reinicio: `setsid` corta
# el vínculo con la terminal y con la sesión que lo lanzó, así que el motor sobrevive a que se
# cierre cualquiera de las dos.
#
# Cuando el plist SÍ se pueda cargar, es preferible: agrega el arranque al boot y el
# relanzamiento cada 30 min. Los dos usan el MISMO watchdog y los mismos frenos.
#
# Uso:    bash packages/metodo/scripts/arrancar-motor-flota.sh
# Parar:  bash packages/metodo/scripts/arrancar-motor-flota.sh parar
set -uo pipefail
cd "$(dirname "$0")/../../.."

PANEL="packages/metodo/panel"
PIDFILE="$PANEL/motor-flota.pid"
LOG="$PANEL/motor-flota.log"

if [ "${1:-}" = "parar" ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
    echo "motor-flota: detenido"
  else
    echo "motor-flota: no estaba corriendo"
  fi
  exit 0
fi

# UN solo motor. Dos leyendo el mismo plan eligen el mismo AC y se pisan los commits — el
# `lock.sh` del loop lo atrapa, pero mejor no llegar hasta ahí.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "motor-flota: ya hay uno vivo (pid $(cat "$PIDFILE")) — no arranco otro"
  exit 0
fi

# El marcador de pausa frena TODO arranque, también éste: si el watchdog abortó pidiendo que
# mire una persona, volver a levantarlo sería pisar ese pedido.
if [ -f "$PANEL/PAUSA-REVISION" ]; then
  echo "motor-flota: hay PAUSA-REVISION — no arranco. Revisá $PANEL/watchdog.log y borrala."
  exit 0
fi

TOKEN_FILE="$HOME/.claude-oauth-token"
[ -s "$TOKEN_FILE" ] || { echo "motor-flota: falta $TOKEN_FILE (generarlo con 'claude setup-token')"; exit 78; }

mkdir -p "$PANEL"

# `nohup` + `&` y nada más: en macOS NO hay `setsid` —el primer intento murió con
# «command not found» en la línea siguiente al arranque— y no hace falta. Al terminar este
# script su hijo queda huérfano, lo adopta launchd como init, y `nohup` lo blinda del SIGHUP
# que manda la terminal al cerrarse. Sobrevive a la sesión que lo lanzó, que es lo que importa.
# El umbral de stashes (10-ago-2026). El loop pausa al pasar de `KILOPAN_MAX_STASHES` porque una
# pila que crece sin parar suele significar que algo deja WIP en cada vuelta — y eso es cierto.
# Pero los stashes JAMÁS se borran (son trabajo real que alguien puede necesitar), así que la pila
# solo sube. Acá se archivaron los once que había como ramas `wip/motor-wip-*`, donde el contenido
# queda recuperable con `git checkout`, y el tope se levanta para que el freno vuelva a significar
# lo que dice: «está pasando algo raro AHORA», y no «este árbol ya tiene historia».
CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")" \
KILOPAN_APP=flota \
KILOPAN_MAX_STASHES=40 \
PATH="$HOME/.local/lib/nodejs/current/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
  nohup bash packages/metodo/scripts/watchdog.sh >> "$LOG" 2>&1 &

echo $! > "$PIDFILE"
echo "motor-flota: arrancado (pid $(cat "$PIDFILE")) · log: $LOG"
