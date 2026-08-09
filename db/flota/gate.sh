#!/usr/bin/env bash
# Gate propio de la plataforma FLOTA. Lo invoca `packages/metodo/scripts/check.sh
# --app=flota` (hay un gancho genérico: si existe `db/<app>/gate.sh`, se corre).
#
# Sin `--full`: todo lo que NO necesita base de datos — estático y barato, corre en cada
# iteración. Con `--full`: además la suite contra el cluster local (docs/CONTRATO_PUERTOS.md).
#
# Nunca reporta OK por omisión: cada paso que no corre se lista como SALTADO, igual que
# check.sh (docs/LECCION_RALPH.md).
set -uo pipefail
cd "$(dirname "$0")/../.."

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    *) echo "gate.sh: argumento desconocido '$arg' (uso: [--full])"; exit 2 ;;
  esac
done

PASSED=(); FAILED=(); SKIPPED=()

paso () {
  local nombre="$1"; shift
  if "$@"; then PASSED+=("$nombre"); else echo "  FALLÓ: $nombre"; FAILED+=("$nombre"); fi
}
saltar () { echo "  SALTADO: $1 ($2)"; SKIPPED+=("$1"); }

# --- Estático (sin BD) ---------------------------------------------------------------
# Primero de todo, «antes de cada iteración» como pide el §7.1: si hay un secreto suelto o
# la BD de desarrollo apunta afuera, nada de lo que venga después importa. [AC-FTEN-28]
paso "guardrail (§7.1): DATABASE_URL local, secretos en .env.local, cero cáscaras" \
  bash db/flota/guardrail.sh

paso "lista congelada de criterios KiloRuta" \
  node db/flota/gate-criterios-kiloruta.mjs

paso "familia canónica de constantes: cero números mágicos duplicados (§0)" \
  node db/flota/gate-constantes.mjs

paso "linter de migraciones: las cinco exigencias de toda tabla de dominio (§4.2, §9.2)" \
  node db/flota/lint-migraciones.mjs

# Glob explícito: `node --test <directorio>` no descubre los .test.mjs, los trata como un
# módulo único y muere con MODULE_NOT_FOUND.
paso "unit (db/flota): mutantes de los guardianes" \
  node --test db/flota/*.test.mjs

# --- Con base de datos ----------------------------------------------------------------
if [ "$FULL" -eq 1 ]; then
  saltar "suite de tenancy contra el cluster" "todavía no hay migraciones (hito (a) en curso)"
else
  saltar "suite de tenancy contra el cluster" "correr con --full"
fi

echo "gate.sh [flota]: OK ${#PASSED[@]} · FALLÓ ${#FAILED[@]} · SALTADO ${#SKIPPED[@]}"
[ "${#FAILED[@]}" -gt 0 ] && exit 1
exit 0
