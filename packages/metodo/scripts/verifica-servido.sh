#!/usr/bin/env bash
# verifica-servido.sh <app> [distDir]
#
# El artefacto que se despliega tiene que estar COMPLETO. El modo de fallo que este paso
# existe para matar es mudo: la app responde 200 en toda ruta por SSR aunque sus estáticos
# no estén donde el servidor los busca, así que un healthcheck pasa perfecto mientras la app
# nunca hidrata y NINGÚN botón hace nada. Se ve bien en una captura y está muerta al tocarla.
# Un `curl` no puede detectarlo.
#
# Las dos apps del monorepo se sirven distinto y el chequeo lo sabe, en vez de exigirle a una
# la forma de la otra:
#
#   · STANDALONE (apps/kilopan): `next build` NO copia `.next/static` ni `public/` dentro del
#     standalone — es un paso manual que se olvida. Se exige que TODO lo que la app tiene en
#     `public/` haya llegado. Hasta el 09-ago-2026 esto estaba cableado a `public/sw.js`, el
#     service worker de ESA app, lo que obligaba a inventarle uno vacío a cualquier app nueva.
#   · SERVIDOR PROPIO (apps/flota): sirve `.next` en su sitio, así que no hay copia que se
#     olvide; lo que SÍ puede romperse en silencio es que el build no haya producido los
#     estáticos, que `public/` esté vacío, o que el `start` apunte a un archivo de servidor
#     que no existe. Eso se verifica acá. La otra mitad —que los estáticos se sirvan DE
#     VERDAD— la cubre su e2e, que cuenta los 404 de `/_next/static` en un navegador real:
#     una comprobación más fuerte que la de existencia de archivos, no más débil.
set -uo pipefail
cd "$(dirname "$0")/../../.."

APP="${1:?uso: verifica-servido.sh <app> [distDir]}"
DIST="${2:-.next}"
RAIZ="apps/$APP"

fallo=0
malo () { echo "verifica-servido: $1"; fallo=1; }

[ -d "$RAIZ/$DIST" ] || { malo "no existe $RAIZ/$DIST — ¿corrió el build?"; exit 1; }

# `public/` vacío o ausente haría que el bucle de abajo no mirara nada y este script dijera
# OK sin haber verificado la mitad de lo que promete: el verde vacuo que el gate mata.
en_origen=0
if [ ! -d "$RAIZ/public" ]; then
  malo "$RAIZ/public no existe: no hay estáticos propios que verificar"
else
  for origen in "$RAIZ"/public/*; do
    [ -e "$origen" ] || continue
    en_origen=$((en_origen + 1))
  done
  [ "$en_origen" -gt 0 ] || malo "$RAIZ/public está vacío: la comprobación no miraría nada"
fi

if [ -d "$RAIZ/$DIST/standalone" ]; then
  MODO="standalone"
  DESTINO="$RAIZ/$DIST/standalone/apps/$APP"
  [ -d "$DESTINO/$DIST/static" ] || malo "falta $DESTINO/$DIST/static — la app respondería 200 sin hidratar jamás"
  copiados=0
  for origen in "$RAIZ"/public/*; do
    [ -e "$origen" ] || continue
    nombre="$(basename "$origen")"
    if [ -e "$DESTINO/public/$nombre" ]; then
      copiados=$((copiados + 1))
    else
      malo "falta $DESTINO/public/$nombre — está en public/ y no llegó al standalone"
    fi
  done
  DETALLE="$copiados de $en_origen archivo(s) de public/ dentro del standalone"
else
  MODO="servidor propio"
  [ -d "$RAIZ/$DIST/static" ] || malo "falta $RAIZ/$DIST/static — el build no produjo estáticos"
  # El `start` del package.json es el contrato de arranque del despliegue. Si nombra un
  # archivo que no existe, el contenedor muere al primer intento y el gate no se enteró.
  entrada="$(node -e "
    const s = require('./$RAIZ/package.json').scripts?.start ?? '';
    const m = s.match(/([\\w./-]+\\.(?:mjs|cjs|js))/);
    process.stdout.write(m ? m[1] : '');
  ")"
  if [ -z "$entrada" ]; then
    malo "el script \`start\` de $RAIZ/package.json no nombra un archivo de servidor: no hay contrato de arranque que verificar"
  elif [ ! -f "$RAIZ/$entrada" ]; then
    malo "el script \`start\` arranca $entrada y ese archivo no existe en $RAIZ"
  fi
  DETALLE="$en_origen archivo(s) en public/ y entrada de arranque «$entrada»"
fi

[ "$fallo" -eq 0 ] || exit 1
echo "verifica-servido: OK ($APP · $MODO · $DIST/static y $DETALLE)"
