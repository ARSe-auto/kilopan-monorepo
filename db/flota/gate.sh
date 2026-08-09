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

paso "reglas estáticas del §7.2: privilegio, SET de sesión, cross-database y wrapper" \
  node db/flota/gate-reglas-estaticas.mjs

paso "documentos del contrato: runbook de brechas con sus secciones y sus exigencias" \
  node db/flota/gate-documentos.mjs

# El scan de logs del §9.2: cero PIN en cualquier forma, cero RUT sin máscara, cero secreto
# de dispositivo. Estático y no sobre la salida de los tests, porque la línea que filtra un
# PIN es casi siempre la del `catch` que nadie ejerció. [AC-FIDN-06]
paso "scan de logs: ni PIN, ni RUT sin máscara, ni secreto de dispositivo (§7.8, §9.2)" \
  node db/flota/gate-logs.mjs

# 21.719 estructural: los identificadores viven en `personas` y los hechos la referencian por
# ID opaco. Un RUT dentro de una tabla append-only hace imposible la supresión. [AC-FIDN-14]
paso "PII estructural: cero identificadores fuera del plano de identidad (§7.8)" \
  node db/flota/gate-pii.mjs

paso "linter de migraciones: las cinco exigencias de toda tabla de dominio (§4.2, §9.2)" \
  node db/flota/lint-migraciones.mjs

# Glob explícito: `node --test <directorio>` no descubre los .test.mjs, los trata como un
# módulo único y muere con MODULE_NOT_FOUND.
paso "unit (db/flota): mutantes de los guardianes" \
  node --test db/flota/*.test.mjs

# --- Con base de datos ----------------------------------------------------------------
# El cluster es un recurso real, no un mock: la provisión de un tenant es `CREATE DATABASE …
# TEMPLATE` y no existe sin servidor (§4.1). Si no arranca, esto se pone ROJO — nunca saltado.
if [ "$FULL" -eq 1 ]; then
  paso "cluster de FLOTA arriba (127.0.0.1:54331)" \
    bash db/flota/cluster.sh iniciar

  # El runner de verdad, no una simulación: recorre canario, plantilla y cada tenant vivo y
  # se declara rojo si alguno queda rezagado (§4.1, centinela 13). [AC-FTEN-07]
  paso "runner ×N: canario primero, plantilla y cada tenant, como rol migrator" \
    node db/flota/migrar.mjs aplicar

  # pgTAP contra el canario: las verificaciones de CATÁLOGO (tipo y DEFAULT de cada PK, forma
  # de los índices de idempotencia) se escriben DENTRO de la base, que es lo único que no
  # puede quedar desfasado de la base. [AC-FTEN-08]
  paso "pgTAP contra el canario: catálogo de PKs UUIDv7 e idempotencia por client_uuid" \
    node db/flota/pgtap.mjs

  # El job exportador de verdad, contra el cluster (§4.1: la ÚNICA vía por la que un dato sale
  # de la BD de un tenant). [AC-FTEN-20]
  paso "job exportador: agregados técnicos de cada tenant activo hacia control" \
    node db/flota/exportar.mjs

  # En serie a propósito: las suites comparten UN cluster, y `node --test` corre los archivos
  # en paralelo por omisión — dos suites creando y borrando las mismas bases se pisan.
  paso "suite de tenancy contra el cluster: plantilla, provisión ×2 y rezago (§4.1)" \
    node --test --test-concurrency=1 db/flota/suite-bd/*.test.mjs
else
  saltar "suite de tenancy contra el cluster" "correr con --full"
fi

echo "gate.sh [flota]: OK ${#PASSED[@]} · FALLÓ ${#FAILED[@]} · SALTADO ${#SKIPPED[@]}"
[ "${#FAILED[@]}" -gt 0 ] && exit 1
exit 0
