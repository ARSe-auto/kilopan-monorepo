#!/usr/bin/env bash
# verifica-standalone.sh <app> [distDir]
#
# El standalone de Next.js sirve 200 en TODA ruta aunque le falten los estáticos (es SSR
# puro sin ellos), así que un healthcheck normal pasa perfecto mientras la app nunca
# hidrata y NINGÚN botón hace nada. `next build` NO copia `.next/static/` ni `public/`
# adentro del standalone: es un paso manual que se olvida, y el síntoma no se ve en un
# `curl` ni en una captura de pantalla.
#
# Hasta el 09-ago-2026 este chequeo vivía en línea dentro de `check.sh` y estaba cableado
# a KiloPan: exigía `public/sw.js`, el service worker de ESA app. Con `apps/flota` en el
# monorepo eso obligaba a una de dos cosas malas — inventarle a la app nueva un service
# worker vacío solo para satisfacer al gate, o relajar el chequeo. Se generaliza: se exige
# que TODO lo que la app tiene en `public/` haya llegado al standalone, sea lo que sea.
# Es más estricto que el testigo único, no menos.
set -uo pipefail
cd "$(dirname "$0")/../../.."

APP="${1:?uso: verifica-standalone.sh <app> [distDir]}"
DIST="${2:-.next}"
RAIZ="apps/$APP"
DESTINO="$RAIZ/$DIST/standalone/apps/$APP"

fallo=0
malo () { echo "verifica-standalone: $1"; fallo=1; }

[ -d "$DESTINO" ] || { malo "no existe $DESTINO — ¿el build corrió con output:\"standalone\"?"; exit 1; }
[ -d "$DESTINO/$DIST/static" ] || malo "falta $DESTINO/$DIST/static — la app respondería 200 sin hidratar jamás"

# `public/` vacío o ausente haría que el bucle de abajo no mirara nada y este script
# dijera OK sin haber verificado la mitad de lo que promete: el verde vacuo que el gate
# existe para matar.
if [ ! -d "$RAIZ/public" ]; then
  malo "$RAIZ/public no existe: no hay con qué comprobar que la copia de estáticos ocurrió"
else
  # Dos contadores y no uno: con uno solo, un archivo que NO se copió dejaba el contador
  # en cero y el script agregaba «public/ está vacío» encima del error real — un mensaje
  # falso justo cuando alguien está diagnosticando. `en_origen` responde «¿hay algo que
  # copiar?»; `copiados` responde «¿llegó?».
  en_origen=0
  copiados=0
  for origen in "$RAIZ"/public/*; do
    [ -e "$origen" ] || continue
    en_origen=$((en_origen + 1))
    nombre="$(basename "$origen")"
    if [ -e "$DESTINO/public/$nombre" ]; then
      copiados=$((copiados + 1))
    else
      malo "falta $DESTINO/public/$nombre — está en public/ y no llegó al standalone"
    fi
  done
  [ "$en_origen" -gt 0 ] || malo "$RAIZ/public está vacío: la comprobación de la copia no miraría nada"
fi

[ "$fallo" -eq 0 ] || exit 1
echo "verifica-standalone: OK ($APP · $DIST/static y $copiados archivo(s) de public/ dentro del standalone)"
