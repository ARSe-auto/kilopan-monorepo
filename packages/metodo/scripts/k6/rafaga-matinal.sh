#!/usr/bin/env bash
# rafaga-matinal.sh — orquestador del pipeline nightly k6 «ráfaga matinal» [AC-FPOD-15] — §0
# (fila Capacidad), §9.2 («Performance en pipeline aparte […] jamás dentro del gate de 10
# min»). Lo invoca SOLO el workflow con `schedule:` (.github/workflows/rafaga-matinal.yml) o un
# humano a mano — JAMÁS `check.sh`/`check.sh --full`, que no lo referencian.
#
# Encadena, en el MISMO orden que ya prueba `apps/flota/playwright.config.ts` para su e2e
# (sembrar antes de construir — algunas rutas tocan la BD al analizarse en el build):
#   1. Postgres arriba (cluster local de desarrollo, o el que ya haya levantado el caller — ver
#      más abajo) y migraciones al día (plantilla + tenants existentes).
#   2. Siembra el tenant de laboratorio con la receta determinista (`sembrar-carga.mjs`),
#      registrado en `control.tenants` para que el ruteo por subdominio lo encuentre.
#   3. Build de PRODUCCIÓN de apps/flota, dist propio (no pisa el `.next` de `check.sh` ni el
#      `.next-e2e` del e2e — build en paralelo con cualquiera de los dos sin pisarse).
#   4. Servidor real arriba en el puerto fijo del contrato (docs/CONTRATO_PUERTOS.md: 3310).
#   5. `k6 run`, parametrizado 100% desde `parametros.generado.json` (§0): sale con exit ≠ 0 si
#      p95 bootstrap ≥400 ms o p95 sync ≥250 ms — ESE exit code es el que hace fallar el pipeline.
#   6. Limpieza SIEMPRE (trap en EXIT/INT/TERM): servidor abajo, tenant de laboratorio borrado,
#      manifiesto temporal borrado — pase lo que pase con el k6.
set -uo pipefail
cd "$(dirname "$0")/../../../.."   # raíz del repo (packages/metodo/scripts/k6/ → 4 niveles)

K6_DIR="packages/metodo/scripts/k6"
K6_BIN="${K6_BIN:-k6}"
command -v "$K6_BIN" >/dev/null 2>&1 || {
  echo "rafaga-matinal.sh: no encuentro el binario de k6 (\$K6_BIN=$K6_BIN)." >&2
  echo "  Instalalo (https://k6.io/docs/get-started/installation/) o exportá K6_BIN con la ruta." >&2
  exit 3
}

DOMINIO="localhost"
SLUG="k6_rafaga_matinal"
PUERTO="${FLOTA_PUERTO:-3310}"           # el fijo de apps/flota (docs/CONTRATO_PUERTOS.md)
DIST_NIGHTLY=".next-rafaga-matinal"      # propio: no pisa `.next` (check.sh) ni `.next-e2e`
BASE_URL="http://${SLUG}.${DOMINIO}:${PUERTO}"
export FLOTA_DOMINIO_BASE="$DOMINIO"

MANIFIESTO_PATH="$(mktemp -t k6-flota-manifiesto-XXXXXX).json"
# Overrideable: el workflow nightly la fija a una ruta DENTRO del checkout para poder subirla
# como artefacto ("artefacto con tendencia", §9.2) — un mktemp por fuera del workspace no lo
# encuentra `actions/upload-artifact`.
RESUMEN_PATH="${K6_RESUMEN_PATH:-$(mktemp -t k6-flota-resumen-XXXXXX).json}"
export K6_MANIFIESTO_PATH="$MANIFIESTO_PATH"

SERVIDOR_PID=""
CODIGO_K6=""

limpiar () {
  local codigo=$?
  echo "rafaga-matinal.sh: limpiando…"
  if [ -n "$SERVIDOR_PID" ] && kill -0 "$SERVIDOR_PID" 2>/dev/null; then
    kill "$SERVIDOR_PID" 2>/dev/null
    wait "$SERVIDOR_PID" 2>/dev/null
  fi
  node "$K6_DIR/sembrar-carga.mjs" limpiar || echo "rafaga-matinal.sh: la limpieza del laboratorio falló — revisar a mano"
  rm -f "$MANIFIESTO_PATH"
  # El exit code manda el de k6 si llegó a correr (es lo que hace fallar el PIPELINE, §0); si
  # algo previo abortó, manda ese código — nunca un 0 tapando un fallo de infraestructura.
  [ -n "$CODIGO_K6" ] && exit "$CODIGO_K6"
  exit "$codigo"
}
trap limpiar EXIT INT TERM

# Postgres: si quien nos invoca ya dejó `FLOTA_DATABASE_URL` apuntando a un servidor (el
# workflow nightly, con su servicio `postgres:18`), NO tocamos nada — `cluster.sh` está
# escrito para el Postgres.app local de esta máquina y no tiene sentido en un runner ajeno
# (mismo criterio documentado en `db/flota/conectar.mjs`: la env var es la vía de escape).
if [ -z "${FLOTA_DATABASE_URL:-}" ]; then
  echo "rafaga-matinal.sh: sin FLOTA_DATABASE_URL — cluster local de desarrollo…"
  bash db/flota/cluster.sh iniciar || exit 3
else
  echo "rafaga-matinal.sh: FLOTA_DATABASE_URL seteada — asumo que el Postgres ya está arriba"
fi

echo "rafaga-matinal.sh: migraciones al día (plantilla + tenants)…"
node db/flota/migrar.mjs aplicar || exit 1

echo "rafaga-matinal.sh: sembrando ${SLUG} (receta determinista, N según CAPACIDAD §0)…"
node "$K6_DIR/sembrar-carga.mjs" || exit 1

echo "rafaga-matinal.sh: build de producción de apps/flota (dist propio: $DIST_NIGHTLY)…"
(cd apps/flota && NEXT_DIST_DIR="$DIST_NIGHTLY" pnpm exec next build) || exit 1

echo "rafaga-matinal.sh: servidor arriba en $BASE_URL…"
(cd apps/flota && NEXT_DIST_DIR="$DIST_NIGHTLY" NODE_ENV=production PORT="$PUERTO" node servidor.mjs) &
SERVIDOR_PID=$!

node "$K6_DIR/esperar-servidor.mjs" "$BASE_URL" 60000 || { echo "rafaga-matinal.sh: el servidor no levantó"; exit 1; }

echo "rafaga-matinal.sh: k6 run — umbrales del §0 (p95 bootstrap <400 ms, p95 sync <250 ms)…"
K6_BASE_URL="$BASE_URL" K6_MANIFIESTO_PATH="$MANIFIESTO_PATH" \
  "$K6_BIN" run --summary-export="$RESUMEN_PATH" "$K6_DIR/rafaga-matinal.js"
CODIGO_K6=$?

echo "rafaga-matinal.sh: resumen en $RESUMEN_PATH (exit k6 = $CODIGO_K6)"
exit "$CODIGO_K6"
