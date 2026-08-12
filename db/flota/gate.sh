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

# El consumo MECÁNICO de esa lista: cada criterio mapeado a su constraint y a su test, y cada
# test referenciado tiene que EXISTIR. Un criterio que apunta a un test borrado se lee como
# cubierto, que es peor que uno sin mapear. [AC-FTEN-19]
paso "matriz KiloRuta: N filas, IDs únicos y cada test referenciado existe" \
  node db/flota/gate-matriz-kiloruta.mjs

paso "familia canónica de constantes: cero números mágicos duplicados (§0)" \
  node db/flota/gate-constantes.mjs

# La otra mitad del §0: `gate-constantes` vigila los VALORES de la familia de energía; este
# vigila la ARITMÉTICA. Nadie copia el factor de consumo a mano —el otro gate lo atrapa—, pero
# cualquiera escribe la multiplicación en la pantalla que está armando, y a partir de ahí hay
# dos fórmulas y la reserva se resta dos veces. [AC-FVEH-09]
paso "fórmula de energía: implementada en UN solo archivo (§0)" \
  node db/flota/gate-formula-energia.mjs

paso "reglas estáticas del §7.2: privilegio, SET de sesión, cross-database y wrapper" \
  node db/flota/gate-reglas-estaticas.mjs

paso "documentos del contrato: runbook de brechas con sus secciones y sus exigencias" \
  node db/flota/gate-documentos.mjs

# Los ganchos del §4.9 en su ESTADO exacto, que se pierde de dos formas que ningún test de base
# atrapa: una pantalla para un gancho DDL-only (su UI es de E3) o una segunda implementación de
# telemetría (E1 solo admite `declarada`). Las dos entran sin tocar una migración. [AC-FVEH-14]
paso "ganchos §4.9: DDL-only sin pantalla y una sola implementación de telemetría" \
  node db/flota/gate-ganchos-e1.mjs

# `pin_destinatario` está VIVO en el enum y NINGÚN seed lo pone (§5.2 F4). Un test de base
# prueba que una base está limpia hoy; lo que se pierde es más silencioso: sembrado en la
# plantilla de un vertical, la derivación del publicar lo copia a todas las paradas de ese tipo
# de carga y el operario del andén termina pidiendo un PIN que nadie configuró. [AC-FRUT-20]
paso "seeds: nadie siembra el gancho pin_destinatario, y sigue vivo en el DDL (§4.9)" \
  node db/flota/gate-seeds-pin-destinatario.mjs

# Mismo criterio que el de arriba, gancho hermano del mismo enum: `escaneo_codigo` es DDL desde
# E1 y su UI es de E3 (§3.E3); ningún seed E1 lo pone. [AC-FPOD-17]
paso "seeds: nadie siembra el gancho escaneo_codigo, y sigue vivo en el DDL (§4.9, §3.E3)" \
  node db/flota/gate-seeds-escaneo-codigo.mjs

# «Archivo PICT versionado; agregar un flag sin regenerarlo ⇒ gate rojo» (§9.2): recalcula el
# covering array 2-way desde covering-array-parada.pict y lo compara contra el .json comiteado
# que el e2e de la pantalla de parada ejerce. [AC-FPOD-18]
paso "covering array 2-way de la pantalla de parada: .pict y .generado.json sincronizados" \
  node db/flota/gate-covering-array-parada.mjs

# La app REFERENCIA documentos de terceros y JAMÁS los emite (§7.3). No es preferencia de
# arquitectura: emitir algo con apariencia de DTE sin ser emisor autorizado es el art. 97 N°4 del
# Código Tributario. El gate no busca la palabra «emitir» —nadie la va a escribir— sino las
# capacidades: generar folios, armar el XML, construir el TED, el CAF. [AC-FRUT-08]
paso "la app jamás emite un DTE: cero folios, cero TED, cero XML del SII (§7.3)" \
  node db/flota/gate-jamas-emite-dte.mjs

# El scan de logs del §9.2: cero PIN en cualquier forma, cero RUT sin máscara, cero secreto
# de dispositivo. Estático y no sobre la salida de los tests, porque la línea que filtra un
# PIN es casi siempre la del `catch` que nadie ejerció. [AC-FIDN-06]
paso "scan de logs: ni PIN, ni RUT sin máscara, ni secreto de dispositivo (§7.8, §9.2)" \
  node db/flota/gate-logs.mjs

# 21.719 estructural: los identificadores viven en `personas` y los hechos la referencian por
# ID opaco. Un RUT dentro de una tabla append-only hace imposible la supresión. [AC-FIDN-14]
paso "PII estructural: cero identificadores fuera del plano de identidad (§7.8)" \
  node db/flota/gate-pii.mjs

# La base de licitud es la EJECUCIÓN DEL CONTRATO y no el consentimiento del trabajador (§7.8):
# ni checkbox ni «al continuar aceptás» en ninguna pantalla del enrolamiento. [AC-FIDN-20]
paso "consentimiento: ninguna pantalla de enrolamiento se lo pide al trabajador (§7.8)" \
  node db/flota/gate-consentimiento.mjs

# Cero datos personales reales en seeds (§7.8): todo RUT del árbol tiene que estar en la lista
# congelada. Que pase el módulo 11 NO alcanza — un RUT real y válido es justo el problema.
paso "RUTs sembrados: solo los de la lista congelada de fixtures (§7.8, §10)" \
  node db/flota/gate-ruts.mjs

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
