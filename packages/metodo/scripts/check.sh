#!/usr/bin/env bash
# Gate único (PROMPT_MAESTRO.md §9). `--full` agrega e2e/perf/invariantes de BD; sin
# flag corre lo rápido. axe/lighthouse NO son pasos todavía, ni con --full (AC-H0-10).
# Nunca reporta OK por omisión: cada paso que no corre queda listado en "SALTADOS",
# y el resumen final es explícito sobre qué se verificó de verdad (ver docs/LECCION_RALPH.md).
set -uo pipefail
cd "$(dirname "$0")/../../.."
FULL=0
APP="kilopan"
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --app=*) APP="${arg#--app=}" ;;
    *) echo "check.sh: argumento desconocido '$arg' (uso: [--full] [--app=kilopan|flota])"; exit 2 ;;
  esac
done
[ -d "apps/$APP" ] || { echo "check.sh: apps/$APP no existe"; exit 2; }

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

# Casilla 5 del prevuelo: infra caída NO es árbol rojo. Un gate que devuelve el mismo
# código para «el código está mal» y «falta node_modules» entrena al watchdog a revertir
# commits sanos. Exit 3 = infra: esperar y reintentar, JAMÁS resetear el árbol.
#
# Y no se declara SALTADO: un gate que reporta VERDE sin haber compilado nada miente
# peor que uno rojo. Sin toolchain no hay veredicto.
infra_abort () {
  echo "INFRA: $1" | tee -a "$LOG_FILE"
  echo "check.sh: INFRA NO DISPONIBLE (exit 3) — no es árbol rojo, no revertir nada."
  echo "infra" > "$LOG_DIR/ultimo-check.estado"
  exit 3
}

# Toolchain ANTES que nada: sin esto no hay veredicto posible, y decirlo como SALTADO
# dejaría salir un VERDE que no compiló una línea.
[ -f package.json ]              || infra_abort "no hay package.json en la raíz — ¿cwd equivocado?"
command -v pnpm >/dev/null 2>&1  || infra_abort "pnpm no está en el PATH de este shell"
[ -d node_modules ]              || infra_abort "falta node_modules — correr 'pnpm install'"

bash packages/metodo/scripts/guardrail.sh || FAILED+=("guardrail")

# El arnés también es software: si sus guards no protegen lo que dicen, todo lo que
# venga después es teatro. Corre temprano y barato (casilla 11).
run_step "prueba-arnes: cada guardrail probado contra el caso que protege" \
  bash packages/metodo/scripts/prueba-arnes.sh

# El contrato se verifica ANTES que el código: una spec rota invalida todo lo que venga
# después. Estos dos pasos son lo que faltaba hasta el 26-jul-2026 — gate_specs existía
# como script npm huérfano y nadie lo llamaba.
run_step "gate_specs ($APP): specs con Fuente: que resuelve y >=3 ACs" \
  node packages/metodo/scripts/gate_specs.mjs "--app=$APP"
if [ "$FULL" -eq 1 ]; then
  run_step "verify-refs ($APP, estricto): sin AC huérfano ni [x] sin respaldo" \
    node packages/metodo/scripts/verify-refs.mjs "--app=$APP" --estricto
else
  run_step "verify-refs ($APP): sin AC citado que ninguna spec defina" \
    node packages/metodo/scripts/verify-refs.mjs "--app=$APP"
fi

run_step "es-CL ($APP): kg/CLP/fecha sin bypass, RUT validado al escribir, cero inglés (AC-H0-09)" \
  node packages/metodo/scripts/verifica-es-cl.mjs "--app=$APP"
# packages/metodo no es paquete de workspace (no tiene package.json) — "unit (workspace)"
# de más abajo no lo alcanza. Sin esto, verifica-es-cl.test.mjs quedaría escrito y nunca
# ejecutado, que es precisamente el defecto de AC-H0-05 que este gate existe para evitar.
run_step "unit (packages/metodo/scripts): mutantes de verifica-es-cl.mjs" \
  node --test packages/metodo/scripts/verifica-es-cl.test.mjs

run_step "lint (workspace)" pnpm -r --if-present run lint
run_step "typecheck (workspace)" pnpm -r --if-present run typecheck
run_step "unit (workspace)" pnpm -r --if-present run test
run_step "build (workspace)" pnpm -r --if-present run build
# El standalone de Next.js sirve 200 en TODA ruta aunque le falten los estáticos
# (es SSR puro sin ellos) — un healthcheck normal no lo detecta. Sin esto, la app
# "pasa el gate" y queda completamente muda al tocar cualquier botón en producción.
run_step "build standalone incluye .next/static y public/ (si no, la app no hidrata)" \
  bash -c "test -d apps/$APP/.next/standalone/apps/$APP/.next/static && test -f apps/$APP/.next/standalone/apps/$APP/public/sw.js"
run_step "audit (AC-SEC-03)" pnpm audit --audit-level=high

if [ "$FULL" -eq 1 ]; then
  # AC-PERF-04: las pantallas de la madrugada no pueden colgarse en 4G malo.
  # Se mide ANTES de e2e a propósito: el webServer de playwright.config.ts levanta
  # `next dev`, que reescribe .next en modo dev (bundles sin minificar y manifiesto
  # con solo las rutas que e2e visitó) y clava el gate en rojo aunque la build de
  # producción esté sana.
  if [ -f "apps/$APP/.next/app-build-manifest.json" ]; then
    run_step "presupuesto de performance (gzip del flujo dorado)" \
      node packages/metodo/scripts/presupuesto-perf.mjs "--app=$APP"
  else
    skip_step "presupuesto de performance" "no hay build de $APP todavía"
  fi

  if [ -f "apps/$APP/playwright.config.ts" ]; then
    # P2 (auditoría 1-ago-2026): esta etiqueta decía "+ offline emulado" sin que ningún
    # spec llamara jamás a context.setOffline() — un paso rotulado y no corrido es peor
    # que uno ausente (mismo principio que "PASA"/"EXCEDE" en presupuesto-perf.mjs).
    # Offline real queda para Ola 4 (docs/PROMPT_CORRECTIVO.md §3); hasta entonces la
    # etiqueta dice solo lo que este paso de verdad ejercita.
    # EL LOCK PROTEGE EL RECURSO, NO EL ROL (redefinición 3-ago-2026). `playwright.config.ts`
    # fija el puerto 3301 para TODOS los worktrees, y `lock.sh` solo lo tomaban loop.sh y
    # prueba-arnes.sh — o sea, se protegía al «builder», no al puerto. Dos gates a la vez
    # (una sesión revisando + el motor construyendo) chocaban en 3301 y el perdedor sacaba
    # un rojo espurio que, para el motor, cuenta como AC fallido y suma un strike: se
    # marcan ACs sanos como atascados por una colisión de infraestructura. Pasó de verdad.
    # Quien CONSUME el recurso toma el lock, sin importar quién lo invoque. Un lock propio
    # (e2e-<app>) y no el de builder: el motor ya tiene el de builder tomado y bloquearse
    # a sí mismo sería peor que la colisión.
    # Se ESPERA el turno, pero el e2e SIEMPRE corre. La primera versión de esto salteaba el
    # paso cuando el lock estaba ocupado, y eso es peor que el problema que resuelve: un
    # gate que dice VERDE sin haber ejercido el camino dorado es exactamente el falso verde
    # que esta campaña vino a matar. Un rojo por colisión es recuperable —loop.sh clasifica
    # los rojos ajenos al AC y no le suma strike—; un verde sin probar no se recupera nunca,
    # porque nadie vuelve a mirar.
    lock_e2e=no
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      bash packages/metodo/scripts/lock.sh tomar "e2e-$APP" $$ >/dev/null 2>&1 && { lock_e2e=si; break; }
      [ "$?" = "7" ] || break   # 7 = ocupado (vale esperar). Cualquier otro fallo: no esperar.
      echo "  esperando el puerto 3301 (otro gate lo tiene)…"
      sleep 15
    done
    run_step "e2e móvil 390x844" pnpm --filter "$APP" run e2e
    [ "$lock_e2e" = "si" ] && bash packages/metodo/scripts/lock.sh soltar "e2e-$APP" $$ >/dev/null 2>&1
  else
    skip_step "e2e Playwright" "apps/$APP aún no tiene playwright.config.ts"
  fi
  if [ -f db/migraciones/0001_identidad.sql ]; then
    run_step "invariantes de BD (violar cada CHECK/trigger y esperar rebote)" \
      node db/test-invariantes.mjs
  else
    skip_step "invariantes de BD" "migraciones aún no existen"
  fi
else
  # P2 (auditoría 1-ago-2026): "correr con --full" es engañoso para axe/lighthouse —
  # NI CON --full existe ese paso en este archivo (grep -n "axe\|lighthouse" no
  # encuentra ningún run_step). No es que estén detrás de una bandera: no están
  # implementados, punto — AC-H0-10 (specs/kilopan/09-plataforma-miga.md) sigue
  # abierto por esto, honestamente, y así lo dice el mensaje.
  skip_step "e2e / invariantes de BD" "correr con --full"
  skip_step "axe / lighthouse" "no implementado todavía — AC-H0-10 sigue abierto"
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

# Casilla 20 del prevuelo: el DONE lo declara un MARCADOR EN DISCO, no el juicio de un
# agente. Solo el gate COMPLETO estampa el verde — un --fast en verde no acredita nada,
# porque se saltó e2e e invariantes. El watchdog compara este tag contra HEAD para saber
# si hubo progreso real desde el último verde de verdad.
if [ "$FULL" -eq 1 ] && [ "${#SKIPPED[@]}" -eq 0 ]; then
  TAG="verde-$(date +%Y%m%d-%H%M%S)"
  git tag -f "$TAG" >/dev/null 2>&1 && printf '%s\n' "$TAG" > "$LOG_DIR/last-green.tag"
  printf '%s\n' "$(git rev-parse HEAD 2>/dev/null)" > "$LOG_DIR/last-green.sha"
  echo "  marcador de verde: $TAG ($(git rev-parse --short HEAD 2>/dev/null))"
fi
