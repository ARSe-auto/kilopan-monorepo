#!/usr/bin/env bash
# Única puerta sancionada para `railway up` (P1, auditoría 1-ago-2026).
#
# `railway up` sube el ÁRBOL DE TRABAJO tal cual está en disco, NO el HEAD de git — un
# árbol sucio (trabajo de otra sesión, un experimento a medio terminar) se despliega
# igual, y nadie puede reconstruir después qué versión quedó corriendo en producción
# porque nunca existió como commit. Este script es el ÚNICO lugar que invoca
# `railway up`; llamarlo directo salta estas comprobaciones.
#
# Uso: bash packages/metodo/scripts/desplegar.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."

echo "== desplegar: árbol limpio y empujado =="
bash packages/metodo/scripts/guardrail.sh --antes-de-railway-up

echo "== desplegar: gate completo sobre HEAD =="
bash packages/metodo/scripts/check.sh --full

echo "== desplegar: railway up =="
railway up
