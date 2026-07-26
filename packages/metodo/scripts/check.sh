#!/usr/bin/env bash
# Gate único (PROMPT_MAESTRO.md §9). `--full` agrega e2e/axe/perf; sin flag corre lo rápido.
# Nunca reporta OK por omisión: cada paso que no corre queda listado en "SALTADOS",
# y el resumen final es explícito sobre qué se verificó de verdad (ver docs/LECCION_RALPH.md).
set -uo pipefail
cd "$(dirname "$0")/../../.."
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

LOG_DIR="packages/metodo/panel"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ultimo-check.log"
: > "$LOG_FILE"

PASSED=()
FAILED=()
SKIPPED=()

run_step () {
  local name="$1"; shift
  echo "== $name ==" | tee -a "$LOG_FILE"
  if "$@" >>"$LOG_FILE" 2>&1; then
    echo "  OK: $name"
    PASSED+=("$name")
  else
    echo "  FALLÓ: $name (ver $LOG_FILE)"
    FAILED+=("$name")
  fi
}

skip_step () {
  echo "== $1 == (SALTADO: $2)" | tee -a "$LOG_FILE"
  SKIPPED+=("$1 ($2)")
}

bash packages/metodo/scripts/guardrail.sh || FAILED+=("guardrail")

if [ -f pnpm-lock.yaml ] || [ -f package.json ]; then
  if command -v pnpm >/dev/null 2>&1; then
    if [ -d node_modules ]; then
      run_step "lint (workspace)" pnpm -r --if-present run lint
      run_step "typecheck (workspace)" pnpm -r --if-present run typecheck
      run_step "unit (workspace)" pnpm -r --if-present run test
      run_step "build (workspace)" pnpm -r --if-present run build
      # El standalone de Next.js sirve 200 en TODA ruta aunque le falten los estáticos
      # (es SSR puro sin ellos) — un healthcheck normal no lo detecta. Sin esto, la app
      # "pasa el gate" y queda completamente muda al tocar cualquier botón en producción.
      run_step "build standalone incluye .next/static y public/ (si no, la app no hidrata)" \
        bash -c 'test -d apps/kilopan/.next/standalone/apps/kilopan/.next/static && test -f apps/kilopan/.next/standalone/apps/kilopan/public/sw.js'
      run_step "audit (AC-SEC-03)" pnpm audit --audit-level=high
    else
      skip_step "lint/typecheck/unit/build/audit" "node_modules no existe — correr 'pnpm install' primero"
    fi
  else
    skip_step "lint/typecheck/unit/build" "pnpm no está en PATH de este shell"
  fi
else
  skip_step "lint/typecheck/unit/build" "package.json raíz no encontrado"
fi

if [ "$FULL" -eq 1 ]; then
  # AC-PERF-04: las pantallas de la madrugada no pueden colgarse en 4G malo.
  # Se mide ANTES de e2e a propósito: el webServer de playwright.config.ts levanta
  # `next dev`, que reescribe .next en modo dev (bundles sin minificar y manifiesto
  # con solo las rutas que e2e visitó) y clava el gate en rojo aunque la build de
  # producción esté sana.
  if [ -f apps/kilopan/.next/app-build-manifest.json ]; then
    run_step "presupuesto de performance (gzip del flujo dorado)" \
      node packages/metodo/scripts/presupuesto-perf.mjs
  else
    skip_step "presupuesto de performance" "no hay build todavía"
  fi

  if [ -d apps/kilopan ] && [ -f apps/kilopan/playwright.config.ts ]; then
    run_step "e2e móvil 390x844 + offline emulado" pnpm --filter kilopan run e2e
  else
    skip_step "e2e Playwright" "apps/kilopan aún no tiene playwright.config.ts"
  fi
  if [ -f db/migraciones/0001_identidad.sql ]; then
    run_step "invariantes de BD (violar cada CHECK/trigger y esperar rebote)" \
      node db/test-invariantes.mjs
  else
    skip_step "invariantes de BD" "migraciones aún no existen"
  fi
else
  skip_step "e2e / axe / invariantes de BD / lighthouse" "correr con --full"
fi

echo
echo "=================== RESUMEN ==================="
echo "OK      (${#PASSED[@]}): ${PASSED[*]:-ninguno}"
echo "FALLÓ   (${#FAILED[@]}): ${FAILED[*]:-ninguno}"
echo "SALTADO (${#SKIPPED[@]}): ${SKIPPED[*]:-ninguno}"
echo "================================================="

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "check.sh: ROJO"
  echo "rojo" > "$LOG_DIR/ultimo-check.estado"
  exit 1
fi
echo "check.sh: VERDE (con ${#SKIPPED[@]} pasos saltados — no confundir con 'todo probado')"
echo "verde" > "$LOG_DIR/ultimo-check.estado"
