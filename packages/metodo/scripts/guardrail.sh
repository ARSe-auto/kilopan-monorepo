#!/usr/bin/env bash
# Guardrails como código (PROMPT_MAESTRO.md §7). Aborta el ítem si alguno falla.
set -euo pipefail
cd "$(dirname "$0")/../../.."  # raíz del monorepo
FAIL=0

echo "== guardrail: base de datos =="
# El guardrail original exigía localhost a secas. Con Postgres hospedado eso ya no
# sirve, pero la razón por la que existía SÍ sigue viva: que nadie apunte el entorno
# de desarrollo a la BD de una panadería real por accidente.
if [ -f .env.local ]; then
  # ÚLTIMA definición, no la primera: tanto db.ts como migrar.mjs parsean con
  # `env[clave]=valor`, así que gana la última. Con `head -1` este guardrail leía la
  # línea de ejemplo (localhost) y daba por local un .env.local que en realidad
  # apuntaba a una URL remota pegada más abajo — el patrón exacto de copiar la cadena
  # del dashboard al final del archivo.
  DB_URL="$(grep -E '^DATABASE_URL=' .env.local | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -n "$DB_URL" ] && ! echo "$DB_URL" | grep -qE '(localhost|127\.0\.0\.1)'; then
    if ! grep -qE '^KILOPAN_DB_REMOTA_INTENCIONAL=(1|true)$' .env.local; then
      echo "ABORT: DATABASE_URL es remota pero falta KILOPAN_DB_REMOTA_INTENCIONAL=1"
      echo "       (existe para que apuntar a la BD de una panadería real sea un acto deliberado)"
      FAIL=1
    fi
    # OJO: acá NO se exige sslmode= en la URL, y es a propósito. node-postgres no usa
    # la semántica de libpq: trata `require` como alias de `verify-full` y, si la URL
    # trae sslmode, DESCARTA en silencio el objeto ssl del código. Exigirlo —como hacía
    # la versión anterior de este guardrail— forzaba una configuración que no funciona
    # contra proveedores con certificado autofirmado. La política TLS la decide
    # `politicaTls()` en apps/kilopan/src/comun/db.ts, en un solo lugar.
    if echo "$DB_URL" | grep -qE '[?&]sslmode='; then
      echo "ABORT: DATABASE_URL no debe llevar ?sslmode= — en node-postgres pisa la"
      echo "       configuración TLS del código. Ver docs/OPERACION_5G_Y_POSTGRES.md"
      FAIL=1
    fi
  fi
else
  echo "  (.env.local no existe todavía — copiar desde .env.local.example)"
fi

echo "== guardrail: secretos solo en .env.local (gitignored) =="
# Busca patrones típicos de secreto fuera de .env.local / node_modules / .git
if grep -RInE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{12,}" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sql' \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next . 2>/dev/null | grep -v '\.env\.local'; then
  echo "ABORT: posible secreto hardcodeado fuera de .env.local (ver líneas arriba)"
  FAIL=1
fi

echo "== guardrail: cero cáscaras en src/ =="
if grep -RInE "TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum" \
    --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules --exclude-dir=.next \
    apps/*/src packages/*/src 2>/dev/null; then
  echo "ABORT: cáscaras encontradas (ver líneas arriba)"
  FAIL=1
fi

echo "== guardrail: cero interpolación directa de string en SQL (AC-SEC-06) =="
if grep -RInE '(query|sql)\(\s*[`"'"'"']?\s*(SELECT|INSERT|UPDATE|DELETE)[^,)]*\$\{' \
    --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules --exclude-dir=.next \
    apps/*/src 2>/dev/null; then
  echo "ABORT: posible SQL con interpolación de string — usar consultas parametrizadas"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "guardrail: FALLÓ"
  exit 1
fi
echo "guardrail: OK"
