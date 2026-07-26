#!/bin/bash
# Regenera el panel de avance (KiloPan + RutaPan/KiloRuta cuando exista) y lo
# publica en https://kilopan-panel.vercel.app — ver docs/LECCION_RALPH.md:
# el panel manda del git log / IMPLEMENTATION_PLAN.md, nunca de "procesos vivos".
set -euo pipefail
export PATH="/Users/alexismacmini/.local/lib/nodejs/current/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PANEL_DIR="$ROOT/packages/metodo/panel"

cd "$ROOT"
node packages/metodo/panel/generar.mjs

cd "$PANEL_DIR"
vercel deploy --prod --yes --name kilopan-panel
