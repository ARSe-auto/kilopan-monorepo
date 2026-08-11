#!/usr/bin/env bash
# trabajo-en-curso.sh — ¿este HEAD rojo es trabajo a medio camino DECLARADO, o un verde falso?
#
# ─── POR QUÉ EXISTE ───────────────────────────────────────────────────────────────
#
# El agente se queda sin presupuesto a mitad de un AC y hace lo correcto: comitea lo construido
# y deja el AC ABIERTO, porque no alcanzó a correr su e2e. El gate independiente encuentra ese
# HEAD rojo —por el e2e que él mismo escribió y no corrió— y el watchdog pausaba TODO hasta que
# una persona mirara. Nadie mira hasta la mañana siguiente: el motor pasaba la noche detenido
# sobre trabajo sano. Pasó dos veces el 11-ago-2026.
#
# La pausa sigue siendo correcta para el caso que la justifica: el agente que afirma verde sobre
# algo que no lo está (§9.2 — «el verde lo estampa el exit code del gate, jamás un agente»).
#
# ─── LA DISTINCIÓN, Y POR QUÉ HACEN FALTA LAS DOS CONDICIONES ────────────────────
#
#   1 · el mensaje trae la línea canónica `AC-ABIERTO: <id> — <qué falta>`, y
#   2 · ese <id> sigue SIN marcar [x] en el plan.
#
# La primera sola sería un salvoconducto: bastaría escribir la línea para que ningún rojo frene
# nunca al motor. La segunda la ancla a un hecho comprobable — si el agente marcó el AC como
# cerrado Y dejó el gate rojo, está afirmando un verde que no existe, y eso pausa traiga la
# línea que traiga.
#
# ─── POR QUÉ ES SEGURO SEGUIR CONSTRUYENDO SOBRE UN HEAD ROJO ASÍ ────────────────
#
# Porque la publicación no depende de este veredicto: los dos publicadores exigen
# `last-green.sha == HEAD`, y un HEAD rojo nunca estampa ese marcador. El trabajo a medio camino
# se queda local hasta que una vuelta lo termine y lo ponga verde. Lo único que cambia es que el
# motor sigue solo en vez de esperar a una persona.
#
# Uso:  trabajo-en-curso.sh --app=<app> [--mensaje=<texto>] [--plan=<ruta>]
#       Sin --mensaje lee el mensaje de HEAD; sin --plan usa IMPLEMENTATION_PLAN_<app>.md.
#       Los dos existen para que prueba-arnes.sh ejerza esto con fixtures, sin fabricar commits.
# Exit: 0 = trabajo en curso declarado (NO pausar) · 1 = no lo es (pausar).
set -euo pipefail

APP=""
MENSAJE=""
PLAN=""
for arg in "$@"; do
  case "$arg" in
    --app=*)     APP="${arg#*=}" ;;
    --mensaje=*) MENSAJE="${arg#*=}" ;;
    --plan=*)    PLAN="${arg#*=}" ;;
  esac
done
[ -n "$APP" ] || { echo "trabajo-en-curso: falta --app=<app>" >&2; exit 2; }
[ -n "$PLAN" ] || PLAN="IMPLEMENTATION_PLAN_${APP}.md"
[ -n "$MENSAJE" ] || MENSAJE="$(git log -1 --format='%B')"

# El id declarado, de la línea canónica. Ancorada al principio de línea a propósito: una
# explicación en prosa que MENCIONE «AC-ABIERTO» a mitad de un párrafo no es una declaración.
AC=$(printf '%s\n' "$MENSAJE" | sed -nE 's/^AC-ABIERTO:[[:space:]]*(AC-[A-Z0-9]+-[0-9]+).*/\1/p' | head -1)
if [ -z "$AC" ]; then
  echo "trabajo-en-curso: el commit no declara ningún AC abierto — un rojo acá es un verde falso."
  exit 1
fi

if [ ! -f "$PLAN" ]; then
  echo "trabajo-en-curso: no encuentro $PLAN — sin plan no se puede comprobar la declaración."
  exit 1
fi

# ¿El AC declarado sigue abierto en el plan? `grep -c` sobre las líneas ya marcadas.
MARCADO=$(grep -F "[$AC]" "$PLAN" | grep -c '^- \[x\]' || true)
if [ "${MARCADO:-0}" -gt 0 ]; then
  echo "trabajo-en-curso: $AC se declara ABIERTO pero está marcado [x] en $PLAN — eso es " \
       "afirmar un verde que el gate no dio. Pausa."
  exit 1
fi

echo "trabajo-en-curso: $AC declarado abierto y sin marcar — trabajo a medio camino, no un verde falso."
exit 0
