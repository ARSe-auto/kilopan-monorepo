#!/usr/bin/env bash
# Guardrails como código (PROMPT_MAESTRO.md §7). Aborta el ítem si alguno falla.
set -euo pipefail
cd "$(dirname "$0")/../../.."  # raíz del monorepo
FAIL=0

echo "== guardrail: base de datos =="
# El guardrail original exigía localhost a secas. Con Postgres hospedado eso ya no
# sirve, pero la razón por la que existía SÍ sigue viva: que nadie apunte el entorno
# de desarrollo a la BD de una panadería real por accidente.
#
# KILOPAN_ENV_FILE (P1, auditoría 1-ago-2026): por defecto es .env.local, el real. Solo
# existe para que prueba-arnes.sh pueda ejercer este guard contra un archivo DESECHABLE
# — antes esas pruebas escribían y restauraban el .env.local real, y una interrupción a
# mitad de camino lo dejaba con el fixture puesto. El propio arreglo del prompt
# correctivo (docs/PROMPT_CORRECTIVO.md §7) es que el archivo real nunca se toque, ni
# un instante.
ENV_FILE="${KILOPAN_ENV_FILE:-.env.local}"
if [ -f "$ENV_FILE" ]; then
  # ÚLTIMA definición, no la primera: tanto db.ts como migrar.mjs parsean con
  # `env[clave]=valor`, así que gana la última. Con `head -1` este guardrail leía la
  # línea de ejemplo (localhost) y daba por local un .env.local que en realidad
  # apuntaba a una URL remota pegada más abajo — el patrón exacto de copiar la cadena
  # del dashboard al final del archivo.
  DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -n "$DB_URL" ] && ! echo "$DB_URL" | grep -qE '(localhost|127\.0\.0\.1)'; then
    if ! grep -qE '^KILOPAN_DB_REMOTA_INTENCIONAL=(1|true)$' "$ENV_FILE"; then
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
  echo "  ($ENV_FILE no existe todavía — copiar desde .env.local.example)"
fi

echo "== guardrail: sin .env.local de worktree de agente en el árbol =="
# P1 (auditoría 1-ago-2026): cada worktree de agente (.claude/worktrees/*) es su propio
# checkout con su propio .env.local — cuatro, verificados, cada uno con su propia
# cadena de conexión. .dockerignore ya los excluye del contexto de build (doble patrón,
# ver ese archivo), pero un guard que solo actúa en build time no sirve de nada si nadie
# corre el build antes de, por ejemplo, empujar una imagen a mano. Esto lo detecta ANTES.
if find .claude/worktrees -mindepth 2 -maxdepth 2 -name '.env.local' 2>/dev/null | grep -q .; then
  echo "ABORT: hay .env.local dentro de .claude/worktrees/*/ — cada uno es un secreto"
  echo "       de conexión propio que no debería sobrevivir fuera de su worktree."
  FAIL=1
fi

echo "== guardrail: railway up solo sobre árbol limpio y empujado =="
# P1 (auditoría 1-ago-2026): `railway up` sube el ÁRBOL DE TRABAJO completo, no HEAD.
# Un árbol sucio (trabajo de otra sesión, un experimento a medio terminar) se despliega
# tal cual, y nadie puede saber después qué versión quedó corriendo en producción.
if [ "${1:-}" = "--antes-de-railway-up" ]; then
  # SIN --untracked-files=no (bug encontrado en CI, Ola 1 2-ago-2026): `railway up`
  # sube el árbol de trabajo tal cual lo ve el filesystem, así que un archivo nuevo
  # sin trackear se despliega igual que uno commiteado — excluirlo de este chequeo
  # dejaba pasar exactamente lo que el guard existe para bloquear. Pasó inadvertido en
  # local porque el árbol de desarrollo casi siempre tiene OTRO cambio tracked que
  # disparaba el guard por la razón equivocada; un runner de CI recién clonado (sin
  # ningún cambio tracked) lo expuso.
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "ABORT: el árbol de trabajo no está limpio — 'railway up' subiría cambios sin commitear."
    FAIL=1
  fi
  AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')"
  if [ "$AHEAD" != "0" ]; then
    echo "ABORT: HEAD tiene commits sin empujar a origin — 'railway up' desplegaría algo"
    echo "       que no existe en el remoto, y nadie más podría reconstruirlo desde git."
    FAIL=1
  fi
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
# docs/PROMPT_CORRECTIVO.md §7 (Ola 1): este grep era case-sensitive y no podía
# disparar contra `select`/`insert`/`update`/`delete` en minúsculas — que es como se
# escribe SQL en TODO este repo (ver db/migraciones/*.sql, db/test-invariantes.mjs).
# `-Ei` en vez de `-E` a secas.
if grep -RInEi '(query|sql)\(\s*[`"'"'"']?\s*(SELECT|INSERT|UPDATE|DELETE)[^,)]*\$\{' \
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
