#!/usr/bin/env bash
# guardrail.sh de la plataforma FLOTA — las TRES reglas del §7.1 del maestro, como código.
# Corre antes de cada iteración: `db/flota/gate.sh` lo invoca primero, y ese gate corre
# dentro de `check.sh --app=flota` antes de cualquier paso de código. [AC-FTEN-28]
#
#   1. `DATABASE_URL` SOLO localhost en desarrollo.
#   2. Secretos SOLO en `.env.local`, y `.env.local` cubierto por `.gitignore`.
#   3. Grep bloqueante de cáscaras en el código de FLOTA.
#
# POR QUÉ NO ES EL guardrail.sh DE KILOPAN. Aquel guard, correctamente para su producto,
# admite una BD remota cuando el dueño la declara intencional
# (`KILOPAN_DB_REMOTA_INTENCIONAL=1`), porque KiloPan corre contra Postgres hospedado. El
# §7.1 de FLOTA no tiene esa puerta: dice «SOLO localhost en desarrollo», y FLOTA además
# tiene su propio cluster local (docs/CONTRATO_PUERTOS.md, 54331). Meter la excepción de
# KiloPan acá sería relajar un guardrail ajeno por comodidad.
#
# Uso:  bash db/flota/guardrail.sh
# Exit: 0 limpio · 1 alguna regla violada.
set -uo pipefail
cd "$(dirname "$0")/../.."

# Archivo de entorno de FLOTA. La variable existe SOLO para que la suite de mutantes pueda
# ejercer la regla 1 contra un archivo DESECHABLE: el `.env.local` real jamás se escribe,
# ni un instante (misma lección que KILOPAN_ENV_FILE — ya se destruyó el de tres worktrees).
ENV_FILE="${FLOTA_ENV_FILE:-apps/flota/.env.local}"

# Árboles que son de FLOTA. `apps/kilopan` y `db/migraciones` NO se miran: son de otro
# producto y tiene su propio guardrail.
ARBOLES=(apps/flota db/flota db/migraciones-flota)

FALLO=0
abortar () { echo "ABORT: $1"; FALLO=1; }

# Directorios que NO son código escrito por nadie. `.next` a secas no alcanzaba: el e2e de
# `apps/flota` construye en un distDir propio (`.next-e2e`, ver su playwright.config.ts) y
# los chunks minificados de Next contienen literalmente las palabras que la regla 3 busca
# —el gate se puso rojo por un artefacto de build, con el árbol sano, apenas nació el
# esqueleto (09-ago-2026)—. El comodín cubre cualquier distDir presente y futuro.
SIN_ARTEFACTOS=(
  --exclude-dir=node_modules
  --exclude-dir='.next*'
  --exclude-dir=test-results
  --exclude-dir=playwright-report
  --exclude-dir=blob-report
)

# --- Regla 1: DATABASE_URL solo localhost en desarrollo (§7.1) -------------------------
echo "== guardrail flota: DATABASE_URL solo localhost =="
if [ -f "$ENV_FILE" ]; then
  # La ÚLTIMA definición, no la primera: el modo de fallo real es pegar la cadena del
  # dashboard al final de un archivo que arriba dice localhost.
  URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r')"
  if [ -n "$URL" ] && ! printf '%s' "$URL" | grep -qE '@(localhost|127\.0\.0\.1|\[::1\])[:/]'; then
    abortar "DATABASE_URL de FLOTA apunta fuera de localhost ($ENV_FILE).
       El §7.1 no admite excepción: en desarrollo la BD es local. El cluster de FLOTA
       vive en 127.0.0.1:54331 (docs/CONTRATO_PUERTOS.md)."
  fi
else
  echo "  ($ENV_FILE no existe todavía)"
fi

# --- Regla 2: secretos solo en .env.local, y .env.local gitignored (§7.1) --------------
echo "== guardrail flota: secretos solo en .env.local gitignored =="
# 2a. Todo archivo de entorno real tiene que estar fuera del control de versiones. Un
#     `.env.local` versionado es un secreto publicado, aunque hoy tenga un placeholder.
while IFS= read -r archivo; do
  case "$archivo" in *.example) continue ;; esac
  if ! git check-ignore -q "$archivo" 2>/dev/null; then
    abortar "$archivo no está cubierto por .gitignore — un archivo de entorno versionado
       es un secreto publicado."
  fi
done < <(find . -name '.env*' -not -path './node_modules/*' -not -path './.git/*' \
          -not -path './.claude/*' -type f 2>/dev/null)

# 2b. Secretos con pinta de tal, escritos en el código de FLOTA en vez de en el entorno.
# `-i`: el código real escribe `apiKey`, `API_KEY` y `Token`, no solo minúsculas. Sin la
# insensibilidad el guard solo atrapaba la forma que nadie usa.
if grep -RInEi "(api[_-]?key|secret|password|passwd|token)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9/+_-]{12,}" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sql' --include='*.sh' \
    "${SIN_ARTEFACTOS[@]}" \
    "${ARBOLES[@]}" 2>/dev/null; then
  abortar "posible secreto escrito en el código de FLOTA (líneas arriba) — va a .env.local."
fi

# --- Regla 3: cero cáscaras en el código de FLOTA (§7.1) --------------------------------
echo "== guardrail flota: cero cáscaras =="
# `-w` (palabra completa) por el bug real del 06-ago-2026: «TODOS los DTE» es español
# legítimo y sin -w disparaba el guard, pausando el motor con el árbol sano.
# Este archivo se excluye de su propio grep por razones obvias: para buscar los tokens
# hay que nombrarlos. Sus mutantes los arman en tiempo de ejecución, así que ningún otro
# archivo del repo necesita la excepción.
if grep -RInwE "TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sql' --include='*.sh' \
    --exclude='guardrail.sh' \
    "${SIN_ARTEFACTOS[@]}" \
    "${ARBOLES[@]}" 2>/dev/null; then
  abortar "cáscaras encontradas (líneas arriba) — escribir código real o achicar el corte."
fi

if [ "$FALLO" -ne 0 ]; then
  echo "guardrail flota: FALLÓ"
  exit 1
fi
echo "guardrail flota: OK"
