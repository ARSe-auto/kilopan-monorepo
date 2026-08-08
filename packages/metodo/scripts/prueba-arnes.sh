#!/usr/bin/env bash
# prueba-arnes.sh — el arnés también es software, y sus bugs corrompen todo lo que produce.
#
# Casilla 11 del prevuelo: «cada guardrail probado contra el caso que dice proteger, un
# guard que nunca dispara es indistinguible de uno roto». Casilla 10b: «candado
# anti-producción probado EN NEGATIVO». Error fatal #12: «parchar el artefacto y afirmar
# el fix sin verificar».
#
# Cada prueba ejerce el guard contra el caso REAL que debe atrapar y exige que falle.
# Un guard que pasa esta suite en verde por no dispararse nunca, no existe.
#
# Uso: bash packages/metodo/scripts/prueba-arnes.sh
# Exit: 0 todo verde · 1 algún guard no protege lo que dice proteger.
set -uo pipefail
cd "$(dirname "$0")/../../.."
RAIZ="$(pwd)"
M=packages/metodo/scripts

PASA=0; FALLA=0
ok ()  { printf "  ✅ %s\n" "$1"; PASA=$((PASA+1)); }
no ()  { printf "  ❌ %s\n" "$1"; FALLA=$((FALLA+1)); }

# P1 (auditoría 1-ago-2026): estas pruebas usaban DIRECTAMENTE el .env.local real
# (respaldo + escritura + restauración) — una interrupción a mitad de camino (Ctrl-C,
# el propio proceso muerto) dejaba el fixture puesto donde debía estar la conexión real.
# Ya pasó: "prueba-arnes.sh sobrescribe el .env.local real... y ya destruyó el de tres
# worktrees". Ahora KILOPAN_ENV_FILE le dice a guardrail.sh que use un archivo
# DESECHABLE (ver guardrail.sh); el .env.local real no se toca ni un instante.
ENV_PRUEBA="$(mktemp)"
limpiar () {
  rm -f "$ENV_PRUEBA"
  rm -rf "$RAIZ/.metodo-locks/prueba".* 2>/dev/null
  bash "$M/lock.sh" soltar prueba-arnes >/dev/null 2>&1
}
trap limpiar EXIT INT TERM

echo "== 1. Candado anti-producción (casilla 10b · AC-H0-04) =="
# El guard debe ABORTAR con una URL remota sin la marca de intencionalidad, y debe
# hacerlo leyendo la ÚLTIMA definición: el modo de fallo real fue un .env.local con
# localhost arriba y la cadena del dashboard pegada al final.
MTIME_ANTES="$(stat -f %m .env.local 2>/dev/null || echo ausente)"
printf 'DATABASE_URL=postgres://u:p@localhost:5432/x\nDATABASE_URL=postgres://u:p@db.panaderia-real.com:5432/prod\n' > "$ENV_PRUEBA"
if KILOPAN_ENV_FILE="$ENV_PRUEBA" bash "$M/guardrail.sh" >/dev/null 2>&1; then
  no "guardrail NO aborta con DATABASE_URL remota — el candado no protege nada"
else
  ok "aborta con DATABASE_URL remota (y lee la ÚLTIMA definición, no la primera)"
fi
# Y debe DEJAR PASAR la misma URL remota cuando el dueño la declaró intencional:
# un guard que siempre aborta tampoco sirve — bloquearía el trabajo legítimo.
printf 'DATABASE_URL=postgres://u:p@db.panaderia-real.com:5432/prod\nKILOPAN_DB_REMOTA_INTENCIONAL=1\n' > "$ENV_PRUEBA"
if KILOPAN_ENV_FILE="$ENV_PRUEBA" bash "$M/guardrail.sh" >/dev/null 2>&1; then
  ok "deja pasar la remota cuando KILOPAN_DB_REMOTA_INTENCIONAL=1 (no es un no-op al revés)"
else
  no "guardrail aborta incluso con la marca intencional — bloquea trabajo legítimo"
fi
# sslmode en la URL debe abortar: node-postgres lo trata distinto que libpq y pisa el TLS del código.
printf 'DATABASE_URL=postgres://u:p@db.x.com:5432/prod?sslmode=require\nKILOPAN_DB_REMOTA_INTENCIONAL=1\n' > "$ENV_PRUEBA"
KILOPAN_ENV_FILE="$ENV_PRUEBA" bash "$M/guardrail.sh" >/dev/null 2>&1 && no "no aborta con ?sslmode= en la URL" || ok "aborta con ?sslmode= (pisaría politicaTls() del código)"
# El .env.local REAL no se tocó ni un instante — no "se restauró", NUNCA se escribió.
MTIME_DESPUES="$(stat -f %m .env.local 2>/dev/null || echo ausente)"
[ "$MTIME_ANTES" = "$MTIME_DESPUES" ] && ok "el .env.local real no se escribió ni una vez (mtime sin cambios)" || no "el .env.local real SE TOCÓ — la prueba sigue siendo peligrosa"

echo
echo "== 1b. Sin .env.local de worktree de agente (P1) =="
mkdir -p .claude/worktrees/canario-prueba-arnes
echo 'DATABASE_URL=postgres://u:p@db.x.com:5432/prod' > .claude/worktrees/canario-prueba-arnes/.env.local
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "NO detecta un .env.local dentro de .claude/worktrees/*/" || ok "detecta un .env.local plantado en un worktree de agente"
rm -rf .claude/worktrees/canario-prueba-arnes

echo
echo "== 1c. railway up exige árbol limpio y empujado (P1) =="
# No se puede simular "sin empujar" sin un remoto real; se prueba solo la mitad
# ejercitable sin red: árbol sucio SIEMPRE debe abortar, sea cual sea el estado del remoto.
CANARIO_SUCIO="apps/kilopan/.canario-prueba-arnes-sucio"
echo "canario" > "$CANARIO_SUCIO"
bash "$M/guardrail.sh" --antes-de-railway-up >/dev/null 2>&1 && no "NO aborta con el árbol sucio antes de railway up" || ok "aborta 'railway up' con el árbol sucio"
rm -f "$CANARIO_SUCIO"

echo
echo "== 2. Anti-cáscaras en src/ (AC-H0-04) =="
CANARIO="apps/kilopan/src/.canario-prueba-arnes.ts"
printf '// PLACEHOLDER: canario de prueba del arnes\nexport const x = 1;\n' > "$CANARIO"
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "el grep anti-cáscaras NO detecta PLACEHOLDER en src/" || ok "detecta un token vedado plantado en src/"
rm -f "$CANARIO"

echo
echo "== 2a. El anti-cáscaras NO confunde español con tokens (bug real 06-ago) =="
# «TODOS los DTE» disparó el grep sin -w y pausó el motor con HEAD sano. El canario
# se busca por NOMBRE en la salida: así el veredicto no depende de que el resto del
# árbol esté verde en este momento.
CANARIO_ES="apps/kilopan/src/.canario-prueba-arnes-espanol.ts"
printf '// «Salir a ruta» exige TODOS los DTE asociados (art. 55); métodos y FIXMEs no.\nexport const todosLosDte = true;\n' > "$CANARIO_ES"
bash "$M/guardrail.sh" 2>&1 | grep -q "canario-prueba-arnes-espanol" && no "falso positivo: la palabra TODOS dispara el anti-cáscaras" || ok "no confunde TODOS/métodos (español) con TODO/FIXME"
rm -f "$CANARIO_ES"

echo
echo "== 2b. Interpolación de SQL en minúsculas (AC-SEC-06, docs/PROMPT_CORRECTIVO.md §7) =="
# El grep era case-sensitive y por eso nunca podía disparar en ESTE repo: todo el SQL
# real de db/migraciones/*.sql y db/test-invariantes.mjs se escribe en minúsculas. Una
# línea real con `${` dentro de `db.query(` en minúsculas es el caso que debía atrapar
# desde el día uno y nunca atrapó.
CANARIO_SQL="apps/kilopan/src/.canario-prueba-arnes-sql.ts"
printf 'export function f(id: string) {\n  return db.query(`select * from pan.usuarios where id = ${id}`);\n}\n' > "$CANARIO_SQL"
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "el grep anti-interpolación NO detecta SQL en minúsculas" || ok "detecta interpolación de SQL en minúsculas (select/insert/update/delete)"
rm -f "$CANARIO_SQL"

echo
echo "== 2c-bis. aria-label vacíos en JSX (AC-H0-10) =="
CANARIO_ARIA="apps/kilopan/src/.canario-prueba-arnes-aria.tsx"
printf 'export function X() {\n  return <button aria-label="">x</button>;\n}\n' > "$CANARIO_ARIA"
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "el grep anti-aria-label vacío NO detecta aria-label=\"\" en .tsx" || ok "detecta un aria-label vacío plantado en .tsx"
rm -f "$CANARIO_ARIA"

echo
echo "== 2c. Migraciones y semilla en la MISMA zona horaria que la app (3-ago-2026) =="
# `apps/kilopan/src/comun/db.ts` fija America/Santiago en SU conexión; `db/migrar.mjs` —que
# corre las migraciones y, vía sembrar.mjs, la semilla— heredaba la del proceso. En un Mac
# chileno coincide por casualidad y todo se ve bien; en el runner de CI (UTC) no, y entre
# las 20:00 y las 24:00 de Chile la semilla escribía `pan.precios.vigente_desde` con el día
# de MAÑANA: producto sin precio y tres tests de venta en rojo, SOLO en esa franja.
# Se ejerce con TZ=UTC a propósito — con la zona del Mac esta prueba pasaría siempre sin
# probar nada, que es la definición de un guard que no existe.
TZTMP="$(mktemp -d)"
{
  echo "process.chdir('$RAIZ');"
  echo "const { conectar } = await import('file://$RAIZ/db/migrar.mjs');"
  echo "const { db, cerrar } = await conectar();"
  echo "const r = await db.query(\"select current_setting('TimeZone') as tz, current_date::text as hoy\");"
  echo "const f = (r.rows ?? r)[0];"
  echo "console.log(f.tz + '|' + f.hoy);"
  echo "await cerrar();"
} > "$TZTMP/canario.mjs"
SALIDA_TZ="$(TZ=UTC DB_MODE=pglite KILOPAN_PGLITE_DIR="$TZTMP/pg" node "$TZTMP/canario.mjs" 2>/dev/null | tail -1)"
HOY_CL="$(TZ=America/Santiago date +%F)"
rm -rf "$TZTMP"
case "$SALIDA_TZ" in
  "America/Santiago|$HOY_CL") ok "conectar() fuerza America/Santiago: con TZ=UTC current_date sigue siendo el día de Chile ($HOY_CL)" ;;
  "")                         no "no se pudo ejercer conectar() con TZ=UTC — la prueba no probó nada" ;;
  *)                          no "conectar() con TZ=UTC dio '$SALIDA_TZ', esperaba America/Santiago|$HOY_CL — el día se parte a las 20:00" ;;
esac

echo
echo "== 3. Lock de un solo builder (casilla 15) =="
bash "$M/lock.sh" soltar prueba-arnes >/dev/null 2>&1
bash "$M/lock.sh" tomar prueba-arnes >/dev/null 2>&1 && ok "toma el lock cuando está libre" || no "no pudo tomar un lock libre"
# Un segundo intento con el dueño VIVO (este mismo shell) debe rebotar con 7.
bash "$M/lock.sh" tomar prueba-arnes >/dev/null 2>&1; [ "$?" -eq 7 ] && ok "rebota con exit 7 si ya hay un dueño vivo" || no "NO rebota: dos builders podrían correr a la vez"
# Huérfano: dueño con un PID que no existe ⇒ debe robarlo.
echo 999999 > .metodo-locks/prueba-arnes.lock/pid
bash "$M/lock.sh" tomar prueba-arnes >/dev/null 2>&1 && ok "roba el lock de un huérfano (pid muerto)" || no "no roba huérfanos: un crash dejaría el worktree bloqueado para siempre"
bash "$M/lock.sh" soltar prueba-arnes >/dev/null 2>&1

echo
echo "== 3b. El motor no se atasca en un solo AC ni hereda árboles sucios (2-ago-2026) =="
# Los cuatro bugs que hicieron girar al motor media hora sobre AC-SEC-05 sin avanzar,
# cada uno probado contra el caso REAL que lo destapó. Ninguno era teórico: pasaron.
# PANEL DESECHABLE, NUNCA EL VIVO (bug propio, 3-ago-2026). Estas pruebas escriben
# `acs-atascados.txt` y `PAUSA-REVISION` y corren el watchdog de verdad. Apuntando al panel
# real, ensuciaban `watchdog.log` con «EN PAUSA» falsos —que ya me hicieron dar por detenido
# a un motor que estaba trabajando— y podían PAUSAR el motor de producción si el gate
# coincidía con el arranque de una iteración. `KILOPAN_PANEL_DIR` (ver watchdog.sh y
# loop.sh) redirige el panel; el vivo no se toca ni un instante. Mismo criterio que
# `KILOPAN_ENV_FILE` con el `.env.local` real, y por la misma razón: ya pasó una vez.
PANEL="$(mktemp -d)/panel"; mkdir -p "$PANEL"
export KILOPAN_PANEL_DIR="$PANEL"
PANEL_VIVO=packages/metodo/panel
MTIME_PANEL_ANTES="$(stat -f %m "$PANEL_VIVO/watchdog.log" 2>/dev/null || echo ausente)"
# Existía o no ANTES de correr esta sección — el motor real puede estar genuinamente
# pausado (pasó de verdad, 3-ago-2026, incidente AC-ADM-04) sin que esta suite tenga
# nada que ver. La aserción de abajo compara "cambió", no "existe": un PAUSA-REVISION
# real y preexistente no es una falla de la suite.
PAUSA_VIVA_ANTES="$([ -f "$PANEL_VIVO/PAUSA-REVISION" ] && echo si || echo no)"

# (a) siguiente_ac saltea los ACs anotados como atascados. Antes usaba `grep -m1` y
#     devolvía SIEMPRE el mismo primer AC abierto: uno imposible tapaba a todos los demás.
grep -q "acs-atascados" "$M/loop.sh" && ok "loop.sh conoce la lista de ACs atascados" || no "loop.sh sigue eligiendo con grep -m1: un AC imposible tapa a todos"
grep -q "esta_atascado" "$M/loop.sh" && ok "loop.sh saltea los ACs atascados al elegir" || no "loop.sh no saltea ACs atascados"
# Ejercicio real de la función: un plan con dos ACs abiertos y el primero atascado debe
# devolver el SEGUNDO. Un no-op que ignore la lista devolvería el primero y fallaría acá.
TMPA="$(mktemp -d)"; cp IMPLEMENTATION_PLAN.md "$TMPA/plan.bak"
[ -f "$PANEL/acs-atascados.txt" ] && cp "$PANEL/acs-atascados.txt" "$TMPA/atascados.bak"
A1="AC-$(printf Q)Q-01"; A2="AC-$(printf Q)Q-02"   # ids armados en runtime: escritos
                                                     # literales, verify-refs los vería como
                                                     # ACs huérfanos citados por su propio andamio.
printf '# plan de prueba\n\n- [ ] (P0) primero [%s]\n- [ ] (P0) segundo [%s]\n' "$A1" "$A2" > IMPLEMENTATION_PLAN.md
printf '%s\n' "$A1" > "$PANEL/acs-atascados.txt"
ELEGIDO="$(KILOPAN_DRY_RUN=1 bash "$M/loop.sh" --app=kilopan 2>/dev/null | grep -m1 '^loop: siguiente' || true)"
case "$ELEGIDO" in
  *"$A2"*) ok "con el primer AC atascado, elige el SEGUNDO (no se rompe la cabeza contra el mismo)" ;;
  *"$A1"*) no "sigue eligiendo el AC atascado — el motor volvería a girar en falso" ;;
  *)       ok "no eligió el AC atascado (el loop cortó antes por otra razón: gate/lock)" ;;
esac
cp "$TMPA/plan.bak" IMPLEMENTATION_PLAN.md
if [ -f "$TMPA/atascados.bak" ]; then cp "$TMPA/atascados.bak" "$PANEL/acs-atascados.txt"; else rm -f "$PANEL/acs-atascados.txt"; fi
rm -rf "$TMPA"

# (b) El árbol sucio de una iteración fallida se guarda en stash, no se hereda ni se borra.
grep -q "git stash push" "$M/loop.sh" && ok "loop.sh guarda el árbol sucio en stash antes de construir" || no "loop.sh hereda el árbol sucio: el gate de la iteración siguiente arranca rojo"
grep -q "':!packages/metodo/panel'" "$M/loop.sh" && ok "excluye los artefactos del panel (sucios SIEMPRE por construcción)" || no "stashearía ruido del panel en cada iteración"
grep -q "':!apps/kilopan/next-env.d.ts'" "$M/loop.sh" && ok "excluye next-env.d.ts (Next lo reescribe en cada build, alterna .next/.next-e2e)" || no "next-env.d.ts se stashearía tras cada e2e hasta topar el límite de stashes"
grep -qE "git (checkout|clean|reset) --?[a-z]* *\." "$M/loop.sh" && no "loop.sh BORRA trabajo sin comitear — viola «no revertir solo»" || ok "nunca borra: solo stashea (recuperable con git stash list)"

# (c) El contador de strikes que model-selector.sh lee para escalar a Opus SE ESCRIBE.
#     Antes solo lo tocaba esta misma suite: la escalación no podía dispararse jamás.
grep -q "build-fails" "$M/loop.sh" && ok "loop.sh escribe .ralph/build-fails (la escalación a Opus ya puede dispararse)" || no "nadie incrementa build-fails: la escalación de model-selector.sh es código muerto"

# (c2) ARTEFACTOS HUÉRFANOS (bug real, 3-ago-2026): el stash se lleva el fuente pero NO
# los tipos que Next generó de él (gitignored, invisibles a `git stash -u`), y el
# typecheck siguiente falla por un módulo que ya no existe — con build, standalone y
# audit cayendo detrás. Cuatro rojos ajenos al AC en curso, que el motor gastaría sus
# tres intentos persiguiendo. Se ejerce de verdad: se fabrica el huérfano en un sandbox
# y se exige que el comando de limpieza de loop.sh lo borre.
HTMP="$(mktemp -d)"; mkdir -p "$HTMP/apps/kilopan/.next/types/app/turno" "$HTMP/apps/kilopan/.next-e2e/types"
echo "import x from '../../../../src/app/turno/page.js'" > "$HTMP/apps/kilopan/.next/types/app/turno/page.ts"
echo "huerfano" > "$HTMP/apps/kilopan/.next-e2e/types/validator.ts"
LIMPIEZA="$(grep -oE 'rm -rf apps/\*/\.next/types[^|]*' "$M/loop.sh" | head -1)"
if [ -n "$LIMPIEZA" ]; then
  ( cd "$HTMP" && eval "$LIMPIEZA" ) 2>/dev/null
  if [ ! -d "$HTMP/apps/kilopan/.next/types" ] && [ ! -d "$HTMP/apps/kilopan/.next-e2e/types" ]; then
    ok "loop.sh borra los tipos generados al stashear (el typecheck no hereda huérfanos del AC anterior)"
  else
    no "el comando de limpieza de loop.sh NO borra los tipos generados: el próximo typecheck falla por un módulo que el stash se llevó"
  fi
else
  no "loop.sh no limpia .next/types al stashear: un fuente stasheado deja sus tipos apuntando al vacío y tumba 4 pasos del gate"
fi
rm -rf "$HTMP"

# ═══ LAS 4 LÓGICAS REDEFINIDAS (3-ago-2026) ═══════════════════════════════════════════
# Cada una nace de un fallo MEDIDO ese día, no de una hipótesis. Se ejercen contra el caso
# real: un guard que sólo se lee no está probado.

# (c3) CLASIFICAR EL FALLO ANTES DE CONTARLO. Un commit puede faltar por causas ajenas al
# AC —presupuesto agotado, gate rojo por un CVE de dependencias— y contarlas como strike
# marca ACs sanos como atascados para siempre. Se ejerce el parser real de loop.sh contra
# los dos artefactos que produce una corrida: el JSON del agente y el resumen del gate.
grep -q 'terminal_reason|subtype' "$M/loop.sh" && ok "loop.sh distingue el agotamiento de recurso de un fallo del AC" || no "loop.sh cuenta 'se acabó el presupuesto' como intento fallido del AC: lo marca atascado sin que el AC tenga nada malo"
CLAS="$(mktemp -d)"
printf '%s\n' 'FALLÓ   (1): audit (AC-SEC-03)' > "$CLAS/solo-audit.log"
printf '%s\n' 'FALLÓ   (2): typecheck (workspace) audit (AC-SEC-03)' > "$CLAS/audit-y-codigo.log"
clasifica () {  # réplica exacta del criterio de loop.sh, ejercida sobre un resumen real
  L="$(grep -E '^FALLÓ' "$1" | tail -1)"
  N="$(printf '%s' "$L" | grep -oE '\([0-9]+\)' | tr -dc 0-9)"
  { [ "${N:-0}" = "1" ] && printf '%s' "$L" | grep -q "audit"; } && echo entorno || echo del-ac
}
[ "$(clasifica "$CLAS/solo-audit.log")" = "entorno" ] \
  && ok "un gate rojo SOLO en audit se clasifica como entorno (no le suma strike al AC)" \
  || no "un CVE de dependencias le suma strike al AC: tres vueltas así y un AC sano queda atascado"
[ "$(clasifica "$CLAS/audit-y-codigo.log")" = "del-ac" ] \
  && ok "y si además falla typecheck SÍ cuenta como fallo del AC (la excepción no se comió el caso real)" \
  || no "la excepción de audit tapa fallos reales de código: el motor comitearía sobre un typecheck roto"
rm -rf "$CLAS"

# (c4) LA SEÑAL DE PARE SE LEE EN CADA VUELTA. El chequeo vivía sólo antes del bucle:
# impedía arrancar uno nuevo pero no detenía al que ya estaba andando. Poner el marcador
# con el motor en marcha no hacía nada y había que matar el proceso a mano.
awk '/^while \[ "\$i" -lt "\$MAX_ITERACIONES" \]/{dentro=1} dentro && /-f "\$PAUSA"/{encontrado=1} END{exit !encontrado}' "$M/watchdog.sh" \
  && ok "watchdog.sh relee el marcador de pausa DENTRO del bucle (se puede frenar un motor andando)" \
  || no "el marcador sólo se lee al arrancar: pausar un motor en marcha no lo detiene, hay que matarlo a mano"

# (c5) UN SOLO PUNTO DE ARRANQUE. Lanzado a mano hereda el PATH pero no la credencial que
# exporta el plist; cada iteración muere en segundos y marca ACs sanos como atascados.
# Se ejerce de verdad: se corre watchdog.sh SIN la variable y se exige que se frene.
SAL_TOKEN="$(env -u CLAUDE_CODE_OAUTH_TOKEN KILOPAN_PANEL_DIR="$(mktemp -d)" KILOPAN_MAX_ITERACIONES=1 bash "$M/watchdog.sh" 2>&1 | head -4)"
case "$SAL_TOKEN" in
  *CLAUDE_CODE_OAUTH_TOKEN*|*launchd*) ok "watchdog.sh se frena si lo lanzan sin la credencial del plist (no quema ACs en falso)" ;;
  *) no "watchdog.sh arranca sin credencial: cada iteración falla en segundos y marca ACs sanos como atascados" ;;
esac

# (c6) EL LOCK PROTEGE EL RECURSO, NO EL ROL. El puerto 3301 es fijo para todos los
# worktrees y check.sh no tomaba ningún lock: dos gates simultáneos chocaban y el perdedor
# sacaba un rojo espurio que, para el motor, es un strike contra el AC.
grep -q 'lock.sh tomar "e2e-' "$M/check.sh" \
  && ok "check.sh toma un lock propio para el e2e (dos gates no chocan en el puerto 3301)" \
  || no "check.sh corre el e2e sin lock: un gate concurrente le da al motor un rojo falso que cuenta como AC fallido"
# Y el control que importa más: esperar el turno JAMÁS puede degenerar en saltear el paso.
# La primera versión de este lock salteaba el e2e cuando el puerto estaba ocupado — un
# VERDE sin haber ejercido el camino dorado, que es peor que el rojo que evitaba. Lo
# atrapó este mismo arnés. Se exige que `run e2e` siga apareciendo aunque el lock falle.
grep -q 'skip_step "e2e móvil' "$M/check.sh" \
  && no "check.sh saltea el e2e si no consigue el lock: el gate diría VERDE sin ejercer el camino dorado" \
  || ok "el e2e corre SIEMPRE — esperar el puerto nunca degenera en un verde sin probar"
# ══════════════════════════════════════════════════════════════════════════════════════

# (c2) El prompt le dice al agente que el loop.sh que verá en `ps` es su propio padre.
#      Sin esto el agente aplica «UN builder por worktree» contra el proceso que lo lanzó,
#      se niega a construir y pregunta qué hacer — bajo `claude -p`, donde nadie contesta.
#      Deadlock determinista: es la razón por la que el motor nunca cerró un solo AC.
grep -q "SOS VOS" "$M/loop.sh" && ok "el prompt aclara que el loop.sh de 'ps' es el propio padre del agente" || no "el agente se detectará a sí mismo como builder rival y no construirá NUNCA"
grep -q "NO INTERACTIVO" "$M/loop.sh" && ok "el prompt avisa que nadie va a responder preguntas" || no "el agente puede gastar la iteración preguntando al vacío"
grep -q "ESE proceso sos vos" AGENTS.md && ok "AGENTS.md desambigua la regla en su fuente durable" || no "AGENTS.md manda matar al propio motor: la regla vuelve a morder desde el contrato"
# El `rc 10` de loop.sh DETECTA que el motor escribió una migración —después del commit— y
# pausa TODO. Pero detectar no es prevenir: la prohibición vivía SOLO en
# docs/PROMPT_CORRECTIVO.md §7, que el motor no lee. Su prompt (loop.sh) le manda estudiar
# AGENTS.md y nada más, y AGENTS.md solo decía que db/migraciones/ «son la verdad» y que no
# se tocan las YA APLICADAS — ninguna de las dos le prohíbe CREAR una. Verificado en vivo el
# 3-ago-2026: el motor tomó AC-ADM-06, llegó a la conclusión CORRECTA (el patrón append-only
# con supersede_id que le enseña la 0004) y escribió db/migraciones/0023. Trabajo bien hecho
# que iba a frenar la noche entera por una regla que nadie le dijo. Mismo patrón que la
# aserción de arriba: la regla tiene que estar donde el motor SÍ mira, y con un guard que
# impida que se caiga sin que nadie se entere.
grep -q "NUNCA crea ni edita" AGENTS.md && ok "AGENTS.md le prohíbe al motor CREAR migraciones, donde el motor sí lo lee" || no "la prohibición de migraciones vive solo en el correctivo: el motor la va a violar y rc 10 pausará TODO"

# (d) watchdog.sh sale con 0 al pausar, para que KeepAlive del plist NO lo resucite.
grep -q "PAUSA-REVISION" "$M/watchdog.sh" && ok "watchdog.sh usa un marcador de pausa que launchd no puede pisar" || no "watchdog.sh sin marcador: launchd lo relanza tras cada abort, en bucle infinito"
grep -qE "^\s*exit 1$" "$M/watchdog.sh" && no "watchdog.sh todavía sale con 1 en algún abort — KeepAlive lo relanzaría" || ok "ningún abort sale con 1 (KeepAlive/SuccessfulExit=false no lo revive)"
# El marcador debe FRENAR de verdad, no solo existir: con él puesto, el watchdog no construye.
touch "$PANEL/PAUSA-REVISION"
SALIDA_PAUSA="$(KILOPAN_MAX_ITERACIONES=1 bash "$M/watchdog.sh" 2>&1 | head -3)"
rm -f "$PANEL/PAUSA-REVISION"
# El panel VIVO no se tocó ni una vez — no «se restauró», NUNCA se escribió. Si esta
# aserción se pone roja, la suite volvió a poder pausar el motor de producción.
MTIME_PANEL_DESPUES="$(stat -f %m "$PANEL_VIVO/watchdog.log" 2>/dev/null || echo ausente)"
[ "$MTIME_PANEL_ANTES" = "$MTIME_PANEL_DESPUES" ] && ok "el panel vivo no se escribió (la suite no puede pausar el motor de producción)" || no "la suite ESCRIBIÓ en el panel vivo — puede pausar el motor real y ensuciar su log"
PAUSA_VIVA_DESPUES="$([ -f "$PANEL_VIVO/PAUSA-REVISION" ] && echo si || echo no)"
[ "$PAUSA_VIVA_ANTES" = "$PAUSA_VIVA_DESPUES" ] && ok "PAUSA-REVISION del panel vivo sin cambios (ni la creó ni la borró — si ya estaba pausado de verdad, sigue igual)" || no "la suite CAMBIÓ el PAUSA-REVISION del panel vivo (antes: $PAUSA_VIVA_ANTES, después: $PAUSA_VIVA_DESPUES) — puede destrabar o trabar el motor real por accidente"
case "$SALIDA_PAUSA" in
  *"EN PAUSA"*) ok "con el marcador puesto, el watchdog no arranca (frena de verdad)" ;;
  *)            no "el marcador de pausa no frena al watchdog: sigue construyendo" ;;
esac

echo
echo "== 3b-e. Un AC atascado no pausa el motor entero (3-ago-2026) =="
# BUG REAL: KILOPAN_MAX_FALLOS_AC y MAX_SIN_AVANCE valen 3 los dos, y siguiente_ac()
# reelige el MISMO AC hasta que queda atascado — sus 3 fallos consecutivos eran SIEMPRE
# también 3 fallos consecutivos para watchdog.sh. El salteo marcaba el AC atascado y el
# motor se pausaba en la misma vuelta de todos modos: pasó de verdad con AC-ADM-04, el
# primer AC de Ola 2 que el motor tocó. KILOPAN_LOOP_CMD sustituye un stub de rc exacto —
# es la única forma de probar esto sin gastar en una invocación real de `claude -p`.
# Se compara el CONTENIDO que estas pruebas podrian haber escrito, no el mtime (bug real,
# 4-ago-2026). El mtime de watchdog.log lo mueve cualquiera: launchd intenta arrancar el
# motor cada 30 min y, si hay un marcador de pausa puesto, el watchdog escribe «EN PAUSA» y
# sale — comportamiento CORRECTO que movia el mtime y ponia esta asercion en rojo. Un guard
# que se dispara por algo sano es indistinguible de uno roto, y manda a buscar un fallo que
# no existe. Lo que de verdad importa es que estas pruebas no metan SUS lineas en el log
# real: se cuentan las que solo ellas producen.
PVIVO_ANTES="$(grep -c "sin commit nuevo\|rc 9\|stub" "$PANEL_VIVO/watchdog.log" 2>/dev/null || echo 0)"
STUB_DIR="$(mktemp -d)"
cat > "$STUB_DIR/rc9-luego-1.sh" << 'STUBEOF'
#!/usr/bin/env bash
CONT="$1/contador"
n=$(cat "$CONT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$CONT"
[ "$n" -eq 1 ] && exit 9 || exit 1
STUBEOF
cat > "$STUB_DIR/siempre-9.sh" << 'STUBEOF'
#!/usr/bin/env bash
exit 9
STUBEOF
chmod +x "$STUB_DIR"/*.sh

# BUG REAL (3-ago-2026): esta sección era VERDE en un Mac y ROJA en CI, y CI llevaba horas
# fallando por eso — el gate.yml corre en cada push, así que llovían correos de «run
# failed» sin que nada estuviera mal. Causa: `watchdog.sh` exige `command -v claude` ANTES
# de entrar al loop (y con razón: sin eso se perdieron ~15 h en eauto-crm-next). El runner
# de GitHub no tiene el CLI `claude` instalado, así que watchdog pausaba en el arranque y
# las tres aserciones de abajo leían esa pausa en vez del comportamiento que querían medir.
# No se toca el guard —es correcto y protege algo real—: se le da a la prueba el entorno
# que el guard pide. `claude` acá JAMÁS se ejecuta, porque KILOPAN_LOOP_CMD ya sustituye al
# loop entero por un stub de rc exacto; solo tiene que EXISTIR para que el chequeo pase.
# Reproducido antes de arreglar, con HOME aislado (watchdog.sh:10 reinyecta
# $HOME/.local/lib/nodejs/current/bin, que en este Mac contiene claude y en CI no existe):
#   sin claude → 'AC saltado' 0 veces y 'PAUSA' 2 veces; con claude → 4 y 0.
BIN_FALSO="$STUB_DIR/bin"; mkdir -p "$BIN_FALSO"
printf '#!/usr/bin/env bash\necho "claude de utileria — el loop real esta estubado por KILOPAN_LOOP_CMD"\n' > "$BIN_FALSO/claude"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN_FALSO/pnpm"
chmod +x "$BIN_FALSO/claude" "$BIN_FALSO/pnpm"
PATH_ARNES="$BIN_FALSO:$PATH"

# (a) rc 9 resetea el contador global — el rc 1 de después arranca en #1/3, no en #2/3.
SAL_A="$(PATH="$PATH_ARNES" KILOPAN_LOOP_CMD="bash $STUB_DIR/rc9-luego-1.sh $STUB_DIR" KILOPAN_PANEL_DIR="$PANEL" KILOPAN_MAX_ITERACIONES=2 bash "$M/watchdog.sh" 2>&1)"
echo "$SAL_A" | grep -q "AC saltado, no atascamiento" && ok "rc 9 se distingue como progreso, no como falta de avance" || no "rc 9 no se reconoce — el AC atascado sigue contando como fallo genérico"
echo "$SAL_A" | grep -q "sin avance consecutivo #1/3" && ok "tras un rc 9, el próximo fallo real arranca en #1/3 (el contador se reseteó)" || no "el contador NO se reseteó tras rc 9 — sigue sumando desde antes"

# (b) tres ACs atascados seguidos (rc 9 tres veces) NO deben pausar el motor.
SAL_B="$(PATH="$PATH_ARNES" KILOPAN_LOOP_CMD="bash $STUB_DIR/siempre-9.sh" KILOPAN_PANEL_DIR="$PANEL" KILOPAN_MAX_ITERACIONES=4 bash "$M/watchdog.sh" 2>&1)"
echo "$SAL_B" | grep -q "PAUSA" && no "tres ACs atascados SEGUIDOS pausan el motor — el salteo no sirve de nada si el motor se detiene igual" || ok "tres ACs atascados seguidos NO pausan — el motor sigue con el próximo AC"

# (c) regresión: tres fallos GENÉRICOS (rc 1, sin marcar nada atascado) siguen pausando.
#     Sin esto, el arreglo de (a)/(b) podría haber apagado el freno real por accidente.
cat > "$STUB_DIR/siempre-1.sh" << 'STUBEOF'
#!/usr/bin/env bash
exit 1
STUBEOF
chmod +x "$STUB_DIR/siempre-1.sh"
SAL_C="$(PATH="$PATH_ARNES" KILOPAN_LOOP_CMD="bash $STUB_DIR/siempre-1.sh" KILOPAN_PANEL_DIR="$PANEL" KILOPAN_MAX_ITERACIONES=10 bash "$M/watchdog.sh" 2>&1)"
# Exige la pausa POR falta de avance, no una pausa cualquiera: en CI esta aserción pasaba
# por el motivo equivocado —leía la pausa por «claude no está en el PATH»— y así un verde
# tapaba que el freno real ni siquiera se estaba ejerciendo.
echo "$SAL_C" | grep -q "sin commit nuevo" && ok "tres fallos genéricos SIN AC atascado siguen pausando (el freno real no se rompió)" || no "REGRESIÓN: el freno de 'sin avance' dejó de funcionar — el motor giraría en falso sin pausar nunca"

rm -rf "$STUB_DIR"
PVIVO_DESPUES="$(grep -c "sin commit nuevo\|rc 9\|stub" "$PANEL_VIVO/watchdog.log" 2>/dev/null || echo 0)"
[ "$PVIVO_ANTES" = "$PVIVO_DESPUES" ] && ok "estas pruebas tampoco tocaron el panel vivo" || no "esta sección SÍ tocó el panel vivo — revisar KILOPAN_PANEL_DIR"

echo
echo "== 3f. El motor jamás escribe en db/migraciones/ (3-ago-2026) =="
# BUG REAL: docs/PROMPT_CORRECTIVO.md §7 lo prohíbe en letra grande — «El motor autónomo
# JAMÁS escribe en db/migraciones/... migraciones son de sesión supervisada, siempre» —
# pero existía SOLO como prosa: ningún guardrail lo comprobaba. AC-ADM-05 la cruzó de
# largo, escribió db/migraciones/0020_anular_venta.sql, el gate independiente dio verde
# (la migración en sí estaba bien escrita) y el commit se publicó a origin/main solo.
grep -q "COMMITS_DESPUES.*-gt.*COMMITS_ANTES.*db/migraciones" "$M/loop.sh" && ok "loop.sh detecta cuando su propio commit toca db/migraciones/" || no "loop.sh no vigila sus propios commits — puede volver a escribir migraciones sin que nadie lo vea"
grep -q "exit 10" "$M/loop.sh" && ok "loop.sh sale con un código propio (10) para esta violación, distinto de atascado/sin-avance" || no "sin código propio, watchdog.sh no puede distinguir esto de un fallo cualquiera"
grep -q "^    10)" "$M/watchdog.sh" && ok "watchdog.sh reconoce rc 10 explícitamente" || no "watchdog.sh no maneja rc 10 — caería en el default genérico"

# Ejercicio real, no solo grep: el comando exacto que usa loop.sh, contra un commit real
# fabricado en un clon descartable (nunca contra el historial real de este repo).
CLON="$(mktemp -d)/clon"
git clone -q "file://$RAIZ" "$CLON" 2>/dev/null
(
  cd "$CLON" || exit 1
  mkdir -p db/migraciones
  echo "-- canario de prueba, nunca aplicada" > db/migraciones/9999_canario_prueba.sql
  git add db/migraciones/9999_canario_prueba.sql
  git -c user.email=arnes@local -c user.name=arnes commit -q -m "canario: simula un commit del motor tocando migraciones"
)
TOCA_MIGRACIONES="$(cd "$CLON" && git diff --name-only HEAD~1 HEAD -- db/migraciones/ 2>/dev/null)"
rm -rf "$(dirname "$CLON")"
[ -n "$TOCA_MIGRACIONES" ] && ok "el comando de detección de loop.sh SÍ marca un commit real que toca db/migraciones/ (ejercido en clon descartable)" || no "el comando de detección no disparó contra un commit real — el guard es cosmético"

echo
echo "== 3c. La cadena autónoma se publica sola y no se apaga sola (3-ago-2026) =="
# Sin esto la autonomía se cortaba en dos puntos: nadie empujaba lo que el motor comiteaba
# (CI no veía nada) y el watchdog se apagaba al llegar a su tope sin que nada lo levantara.
grep -q "empujar-si-verde" "$M/watchdog.sh" && ok "el watchdog publica lo verificado (el motor deja de depender de un push a mano)" || no "nadie empuja: el trabajo del motor no llega a origin/main ni a CI"
grep -q "StartInterval" packages/metodo/launchd/com.kilopan.ralph-loop.plist && ok "el plist relanza el motor tras el tope de iteraciones (las Olas no se detienen)" || no "al llegar al tope el motor se apaga y espera a una persona"
grep -q "PAUSA-REVISION" "$M/watchdog.sh" && ok "y el marcador de pausa sigue frenando TODO arranque posterior, incluido el de StartInterval" || no "StartInterval sin marcador de pausa = bucle infinito con otro nombre"
# El empujador debe NEGARSE cuando el marcador de verde no apunta al HEAD: es su única
# regla, y si no dispara publicaría código que el gate independiente nunca verificó.
#
# BUG REAL (3-ago-2026): esta prueba comparaba el TEXTO de salida contra dos frases
# fijas — y `empujar-si-verde.sh` tiene un tercer camino de rechazo (rama distinta de
# main) con una frase que no calzaba con ninguna de las dos. Corriendo desde un
# worktree (rama `claude/<algo>`, nunca `main`) esa rama-check dispara ANTES de llegar
# al chequeo del marcador, y la prueba se ponía roja sin que nada estuviera mal —
# `check.sh --full` corre en CADA push de CUALQUIER rama (`.github/workflows/gate.yml:
# branches: ["**"]`), así que esto habría puesto CI en rojo en el primer PR real que
# alguien abriera. Se verifica el EFECTO (¿se empujó algo?), no el texto: eso es
# correcto sin importar cuál de los cuatro caminos de rechazo disparó.
VTMP="$(mktemp -d)"
if [ -f "$PANEL_VIVO/last-green.sha" ]; then cp "$PANEL_VIVO/last-green.sha" "$VTMP/lg.bak"; fi
PENDIENTES_ANTES="$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')"
echo "0000000000000000000000000000000000000000" > "$PANEL_VIVO/last-green.sha"
SAL_EMP="$(bash "$M/empujar-si-verde.sh" 2>&1)"
PENDIENTES_DESPUES="$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')"
# Restaurar SIEMPRE: si NO había marcador, se borra el fixture en vez de dejarlo puesto.
# Antes el `cp` de respaldo se tragaba su error con 2>/dev/null y la restauración estaba
# guardada por `[ -f ]`, así que un panel sin marcador se quedaba con el sha falso de
# ceros — el empujador dejaba de publicar y nadie sabía por qué.
if [ -f "$VTMP/lg.bak" ]; then cp "$VTMP/lg.bak" "$PANEL_VIVO/last-green.sha"; else rm -f "$PANEL_VIVO/last-green.sha"; fi
rm -rf "$VTMP"
if [ "$PENDIENTES_ANTES" = "$PENDIENTES_DESPUES" ]; then
  ok "el empujador se niega con un marcador de verde falso (jamás publica sin verificar) — nada se empujó"
else
  no "el empujador NO se negó con un marcador de verde falso: publicó código sin verificar ($SAL_EMP)"
fi
# Y POR QUÉ se negó. La aserción de efecto de arriba es correcta en las cuatro salidas, pero
# solo UNA ejercita la regla que da nombre a esta prueba; en las otras tres el script sale
# antes de mirar el marcador y el verde estaría diciendo más de lo que probó. Se enumeran las
# cuatro y se reporta «no ejercitado» —nunca fallo— cuando toca otra. El `*)` final NO es
# decorativo: escribiendo esto enumeré tres y el cuarto (árbol sucio) apareció en la primera
# corrida. Si empujar-si-verde.sh gana un camino nuevo, esto lo dice en vez de fingir que pasó.
case "$SAL_EMP" in
  *"marcador de verde"*)
    ok "y se negó POR el marcador, que es la regla que esta prueba cubre" ;;
  *"no main"*)
    printf "  ⚠️  fuera de main (%s): sale por la rama antes de mirar el marcador — ese camino NO quedó ejercitado acá\n" "$(git rev-parse --abbrev-ref HEAD)" ;;
  *"nada pendiente"*)
    printf "  ⚠️  origin/main al día: sale por «nada pendiente» antes de mirar el marcador — ese camino NO quedó ejercitado acá\n" ;;
  *"cambios sin comitear"*)
    printf "  ⚠️  árbol sucio: sale por los cambios sin comitear antes de mirar el marcador — ese camino NO quedó ejercitado acá\n" ;;
  *)
    no "el empujador se negó por una razón desconocida ($SAL_EMP): revisar si empujar-si-verde.sh ganó un camino nuevo" ;;
esac

echo
echo "== 4. gate_specs en negativo (casilla 8) =="
TMP="$(mktemp -d)"; cp -R specs "$TMP/specs.bak"
probar_rojo () { # $1 = descripción
  if node "$M/gate_specs.mjs" --app=kilopan >/dev/null 2>&1; then no "$1"; else ok "$1"; fi
}
sed -i.bak 's|^- \[x\] (P1) F6 Venta contra stock|- [x] (P1) falta terminar: F6 Venta contra stock|' specs/kilopan/03-venta-mostrador.md
probar_rojo "rechaza un [x] cuyo texto dice «falta»"
cp "$TMP/specs.bak/kilopan/03-venta-mostrador.md" specs/kilopan/
sed -i.bak 's|^Fuente: §4|Fuente: §99|' specs/kilopan/00-modelo-datos.md
probar_rojo "rechaza una Fuente: §N que no resuelve en el maestro"
cp "$TMP/specs.bak/kilopan/00-modelo-datos.md" specs/kilopan/
# El id del fixture se ARMA en tiempo de ejecución a propósito: escrito literal, este
# archivo .sh se convierte en una cita de un AC que ninguna spec define, y verify-refs
# lo marca como huérfano — la suite pondría el gate en rojo por su propio andamio.
AC_FALSO="AC-$(printf 'ZZ')-01"
printf '# x\nFuente: §4\n- [ ] uno [%s]\n' "$AC_FALSO" > specs/kilopan/99-corta.md
probar_rojo "rechaza una spec con menos de 3 ACs"
rm -f specs/kilopan/99-corta.md specs/kilopan/*.bak
node "$M/gate_specs.mjs" --app=kilopan >/dev/null 2>&1 && ok "vuelve a verde con las specs restauradas" || no "quedó rojo tras restaurar — la suite ensució el repo"
rm -rf "$TMP"

echo
echo "== 4b. verify-refs no confunde las apps entre sí (8-ago-2026) =="
# El recorrido del árbol es GLOBAL pero `definidos` era de UNA app: al nacer specs/flota/,
# las ~100 citas legítimas de KiloPan en apps/kilopan/** salían «huérfanas» bajo
# --app=flota y el gate de la app nueva no podía ponerse verde JAMÁS. Se ejerce con una
# app de fixture para que la prueba no dependa de que specs/flota/ exista hoy.
APP_FX="__prueba_arnes_app"
mkdir -p "specs/$APP_FX"
# Ids armados en tiempo de ejecución, por la misma razón que el fixture de arriba.
FX1="AC-$(printf 'YYP')-01"; FX2="AC-$(printf 'YYP')-02"; FX3="AC-$(printf 'YYP')-03"
printf '# fixture\nFuente: §4\n- [ ] uno [%s]\n- [ ] dos [%s]\n- [ ] tres [%s]\n' "$FX1" "$FX2" "$FX3" > "specs/$APP_FX/00-fixture.md"
node "$M/verify-refs.mjs" --app="$APP_FX" --estricto >/dev/null 2>&1 \
  && ok "el gate de una app nueva no se pone rojo por las citas legítimas de la otra" \
  || no "verify-refs marcó como huérfanas las citas de otra app — el gate de la app nueva no puede ponerse verde"
# Y el negativo: seguir pillando el AC inventado al vuelo, que es lo que la regla protege.
AC_HUERFANO="AC-$(printf 'YYQ')-99"
printf '// fixture %s\n' "$AC_HUERFANO" > "apps/kilopan/src/comun/__prueba-arnes-huerfano.ts"
node "$M/verify-refs.mjs" --app="$APP_FX" --estricto >/dev/null 2>&1 \
  && no "verify-refs dejó pasar un AC que NINGUNA spec define — la regla 1 quedó desactivada" \
  || ok "sigue pillando el AC que ninguna spec de ninguna app define"
rm -f "apps/kilopan/src/comun/__prueba-arnes-huerfano.ts"
rm -rf "specs/$APP_FX"

echo
echo "== 5. Estructura del monorepo (AC-H0-01) =="
[ -f pnpm-workspace.yaml ] && [ -d apps ] && [ -d packages ] && ok "pnpm workspace con apps/ y packages/" || no "estructura de monorepo ausente"
for p in miga metodo nucleo-comun nucleo-identidad nucleo-pod nucleo-dte; do
  [ -d "packages/$p" ] || { no "falta packages/$p"; break; }
done
[ -d packages/nucleo-dte ] && ok "los 6 paquetes del Anexo C existen"

echo
echo "== 5b. Shells de nucleo-* con package.json real, no solo README (AC-H0-07) =="
# Anexo D (auditoría 2-ago-2026): el AC afirmaba «con package.json» pero en disco los 4
# shells solo tenían README.md — la sección 5 nunca miró package.json, solo el directorio.
for p in nucleo-comun nucleo-identidad nucleo-pod nucleo-dte; do
  [ -f "packages/$p/package.json" ] || { no "packages/$p sin package.json"; continue; }
  node -e "JSON.parse(require('fs').readFileSync('packages/$p/package.json','utf8'))" 2>/dev/null \
    && ok "packages/$p/package.json existe y parsea" \
    || no "packages/$p/package.json no es JSON válido"
  [ -f "packages/$p/README.md" ] && grep -qi "no escribir lógica de negocio aquí todavía" "packages/$p/README.md" \
    && ok "packages/$p/README.md advierte que sigue vacío" \
    || no "packages/$p/README.md no advierte que sigue vacío"
done

echo
echo "== 6. Tokens de diseño Miga (AC-H0-02) =="
grep -rq "C2410C" packages/miga/src 2>/dev/null && ok "acento KiloPan #C2410C definido en packages/miga" || no "falta el token de acento #C2410C"
grep -rq "1D4ED8" packages/miga/src 2>/dev/null && ok "acento KiloRuta #1D4ED8 reservado (Anexo C)" || no "falta el token #1D4ED8 de apps/flota"

echo
echo "== 7. Test de tabular-nums (AC-H0-03) =="
# BUG REAL (Anexo D, 2-ago-2026): esto era un grep sobre TODO packages/miga/src — pasaba
# con la propiedad viva en un solo componente, sin decir nada de los demás. Un mutante
# que la borre de CifraGrande.tsx mientras sigue en TecladoNumerico.tsx sobrevivía.
# Ahora hay un test por componente (packages/miga/src/componentes/cifras.test.ts) y
# packages/miga tiene su propio `pnpm test`, que `unit (workspace)` ya corre vía
# `pnpm -r --if-present run test` — no hace falta tocar check.sh.
[ -f packages/miga/src/componentes/cifras.test.ts ] && ok "existe un test por componente, no un grep sobre todo el árbol" || no "AC-H0-03 sigue siendo un grep global — un componente sin la propiedad no se detecta"
grep -q '"test"' packages/miga/package.json && ok "packages/miga tiene su propio 'pnpm test' (unit (workspace) ya lo corre con --if-present)" || no "sin script de test, unit (workspace) nunca ejecuta cifras.test.ts"
# Ejercicio real: el test debe EXISTIR como archivo Y su corrida debe pasar de verdad.
(cd packages/miga && node scripts/correr-tests.mjs >/dev/null 2>&1) && ok "cifras.test.ts corre y pasa contra el código real" || no "cifras.test.ts existe pero NO pasa — revisar packages/miga/src/componentes/"

# Un test que pasa no dice nada hasta que se lo ve FALLAR contra el caso que dice atrapar.
# Los dos mutantes se ejercen contra un árbol de juguete (MIGA_COMPONENTES_DIR), nunca
# escribiendo un .tsx de mentira dentro del src/ real: si esto se interrumpe a mitad, no
# queda basura en el árbol de nadie (mismo motivo que KILOPAN_ENV_FILE arriba).
MIGA_A="$(mktemp -d)/componentes"; mkdir -p "$MIGA_A"
cp packages/miga/src/componentes/*.tsx "$MIGA_A"/
# Mutante A — el que el grep global dejaba vivo: se borra la PROPIEDAD de CifraGrande
# dejando intacto el comentario que la nombra, y sigue viva en TecladoNumerico. Así se
# comprueba de una vez que la propiedad es obligatoria por componente Y que el test
# descarta comentarios (si no, se conformaría con su propia documentación).
grep -v "fontVariantNumeric" "$MIGA_A/CifraGrande.tsx" > "$MIGA_A/.mut" && mv "$MIGA_A/.mut" "$MIGA_A/CifraGrande.tsx"
if grep -q "tabular-nums" "$MIGA_A/CifraGrande.tsx" && grep -q "tabular-nums" "$MIGA_A/TecladoNumerico.tsx"; then
  ok "el árbol mutado reproduce el caso: la cadena sigue viva (comentario + otro componente), que es lo que engañaba al grep"
else
  no "el árbol mutado no reproduce el caso — sin la cadena viva en otro lado el mutante no prueba nada"
fi
(cd packages/miga && MIGA_COMPONENTES_DIR="$MIGA_A" node scripts/correr-tests.mjs >/dev/null 2>&1) \
  && no "mutante A VIVO: CifraGrande sin la propiedad y el test pasa igual — es el mismo hueco del grep global" \
  || ok "mutante A muerto: quitar la propiedad de UN componente pone el test en rojo aunque la cadena siga en un comentario y en otro archivo"
# Mutante B — el hueco propio del reemplazo: la lista es enumerada, así que un componente
# NUEVO que muestre plata y que nadie clasifique se cuela EN SILENCIO. Sin este cierre,
# el arreglo de AC-H0-03 repetiría con otra forma el defecto que vino a corregir.
MIGA_B="$(mktemp -d)/componentes"; mkdir -p "$MIGA_B"
cp packages/miga/src/componentes/*.tsx "$MIGA_B"/
printf 'export function PrecioNuevo({ monto }: { monto: number }) {\n  return <div>{monto}</div>;\n}\n' > "$MIGA_B/PrecioNuevo.tsx"
# Se captura la salida y DESPUÉS se busca, en vez de encadenar `node ... | grep -q`: con
# `pipefail` (activo arriba) el pipeline hereda el exit 1 de node —que es justamente el
# rojo que se quiere— y la aserción reportaba "mutante vivo" con el mutante bien muerto.
SALIDA_B="$(cd packages/miga && MIGA_COMPONENTES_DIR="$MIGA_B" node scripts/correr-tests.mjs 2>&1)" || true
case "$SALIDA_B" in
  *PrecioNuevo.tsx*) ok "mutante B muerto: un componente nuevo sin clasificar pone el test en rojo y lo nombra" ;;
  *) no "mutante B VIVO: un componente nuevo que muestre plata entra sin que nadie lo mire — la lista se quedó vieja en silencio" ;;
esac
rm -rf "$(dirname "$MIGA_A")" "$(dirname "$MIGA_B")"

echo
echo "== 8. Gate y panel ejecutables (AC-H0-05 · AC-H0-06) =="
bash -n "$M/check.sh" 2>/dev/null && ok "check.sh es sintácticamente válido y ejecutable" || no "check.sh no parsea"
grep -q -- "--full" "$M/check.sh" && ok "check.sh acepta --full" || no "check.sh sin modo --full"
node --check packages/metodo/panel/generar.mjs 2>/dev/null && ok "panel/generar.mjs parsea" || no "panel/generar.mjs no parsea"

echo
echo "== 8b. check.sh --full EJERCE de verdad build+lint+types+unit (+e2e) (AC-H0-05) =="
# Anexo D (auditoría 2-ago-2026): la sección 8 solo mira SINTAXIS (`bash -n`) y que el texto
# contenga `--full` (grep). Un mutante que borre los `run_step` internos de lint/types/unit/
# build sobrevive a ambas: `check.sh` seguiría parseando y el flag seguiría en el archivo,
# pero no correría nada. Aquí se EJECUTA `check.sh --full` en un repo-sandbox hermético
# —toolchain estubada que registra cada invocación de `pnpm`— y se exige que de verdad
# dispare `pnpm ... run {lint,typecheck,test,build}` y el e2e. Y al final se planta el
# mutante del Anexo D y se exige que esta misma prueba lo MATE: un test que no muere ante el
# defecto que dice cazar es un no-op. Se ejercita una COPIA de `check.sh` en un árbol de
# usar y tirar (no el real) para no recursar en prueba-arnes ni pisar el panel de producción.
ARNES_TMP="$(mktemp -d)"
armar_sandbox () { # $1 = raíz del sandbox — árbol mínimo con TODO estubado
  local raiz="$1"
  rm -rf "$raiz"
  mkdir -p "$raiz/node_modules" "$raiz/apps/kilopan" "$raiz/packages/metodo/scripts" "$raiz/bin"
  printf '{}\n' > "$raiz/package.json"
  # check.sh invoca guardrail y prueba-arnes por ruta literal: estubados a exit 0 ⇒ ni
  # recursión ni red. (La prueba-arnes estubada es lo que corta el bucle infinito.)
  printf '#!/usr/bin/env bash\nexit 0\n' > "$raiz/packages/metodo/scripts/guardrail.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$raiz/packages/metodo/scripts/prueba-arnes.sh"
  # con un playwright.config presente, `--full` debe disparar el e2e (rama "cuando exista UI").
  printf 'export default {}\n' > "$raiz/apps/kilopan/playwright.config.ts"
  # pnpm estubado: NO hace el trabajo, solo registra cada llamada ⇒ se prueba que check.sh
  # EJECUTA los pasos, no que los imprime. node estubado a exit 0 (gate_specs/verify-refs).
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "$PNPM_LOG"\nexit 0\n' > "$raiz/bin/pnpm"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$raiz/bin/node"
  chmod +x "$raiz/packages/metodo/scripts/"*.sh "$raiz/bin/"*
}
ejercer () { # $1 = check.sh a ejercitar · $2 = flags · imprime el registro de llamadas a pnpm
  local base="$ARNES_TMP/run"
  armar_sandbox "$base"
  cp "$1" "$base/packages/metodo/scripts/check.sh"
  local plog="$ARNES_TMP/pnpm.log"; : > "$plog"
  PATH="$base/bin:$PATH" PNPM_LOG="$plog" bash "$base/packages/metodo/scripts/check.sh" $2 >/dev/null 2>&1
  cat "$plog"
}

# (a) --full corre de verdad los cuatro pasos de workspace + el e2e.
LOG_FULL="$(ejercer "$M/check.sh" "--full --app=kilopan")"
falta=""
for paso in "run lint" "run typecheck" "run test" "run build" "run e2e"; do
  printf '%s\n' "$LOG_FULL" | grep -q -- "$paso" || falta="$falta $paso"
done
[ -z "$falta" ] && ok "check.sh --full invoca de verdad pnpm run {lint,typecheck,test,build,e2e}" \
                 || no "check.sh --full NO ejecutó:$falta — un run_step de workspace no corre"

# (b) el e2e es --full-específico: sin el flag NO debe dispararse (check.sh DIFERENCIA los modos).
LOG_RAPIDO="$(ejercer "$M/check.sh" "--app=kilopan")"
printf '%s\n' "$LOG_RAPIDO" | grep -q -- "run e2e" \
  && no "check.sh corre e2e SIN --full — el flag no gatea nada, los modos no difieren" \
  || ok "sin --full el e2e no corre (el flag sí gatea los pasos pesados, no es cosmético)"

# (c) EL MUTANTE del Anexo D: borrar los run_step internos. La aserción (a) DEBE morir con él.
MUTANTE="$ARNES_TMP/check-mutante.sh"
grep -vE 'run_step "(lint|typecheck|unit|build) \(workspace\)"' "$M/check.sh" > "$MUTANTE"
LOG_MUT="$(ejercer "$MUTANTE" "--full --app=kilopan")"
sobrevive=""
for paso in "run lint" "run typecheck" "run test" "run build"; do
  printf '%s\n' "$LOG_MUT" | grep -q -- "$paso" && sobrevive="$sobrevive $paso"
done
[ -z "$sobrevive" ] && ok "MATA al mutante que borra los run_step (la prueba ejerce algo, no es un no-op)" \
                     || no "el mutante sin run_step sobrevive:$sobrevive — la prueba no ejercita nada real"
rm -rf "$ARNES_TMP"

echo
echo "== 8c. El «avance» del panel sale de los ACs CERRADOS, jamás del proceso vivo (AC-H0-06) =="
# Anexo D (auditoría 2-ago-2026): la sección 8 sólo hacía `grep -q "rev-list --count"` sobre
# generar.mjs y lo rotulaba «el panel mide avance por commits» — una cadena que NO calcula la
# métrica auditada: el avance real es `pct(plan.cerrados, total)`, y `rev-list --count` sólo
# alimenta el contador cosmético «Commits totales». Ese grep sobrevive intacto a un mutante que
# ate el avance al pid del loop (justo lo que este AC prohíbe), y nada probaba que el proceso
# vivo nunca sea señal de avance. Aquí se EJERCE generar.mjs en un sandbox hermético —specs y
# loop.pid controlados, copia del script, jamás el panel vivo— y se exige: (1) prender el loop
# NO mueve el avance; (2) el avance sube al subir los ACs cerrados (y con los commits en 0);
# (3) mutant-kill directo del AC: con el loop VIVO pero cero ACs cerrados, el avance es 0.
SB="$(mktemp -d)/sandbox"
mkdir -p "$SB/packages/metodo/panel" "$SB/specs/kilopan"
cp packages/metodo/panel/generar.mjs "$SB/packages/metodo/panel/generar.mjs"
# ids de fixture armados en runtime: escritos literales, este .sh sería una cita de ACs que
# ninguna spec define y verify-refs pondría el gate en rojo por el andamio de su propia suite.
F1="AC-$(printf 'PP')-01"; F2="AC-$(printf 'PP')-02"
sembrar_specs () { # $1 = nº cerrados · $2 = nº abiertos
  { echo "# 99 — prueba de avance del panel"
    local i=0
    while [ "$i" -lt "$1" ]; do echo "- [x] (P0) cerrado $i [${F1}$i]"; i=$((i+1)); done
    i=0
    while [ "$i" -lt "$2" ]; do echo "- [ ] (P0) abierto $i [${F2}$i]"; i=$((i+1)); done
  } > "$SB/specs/kilopan/99-avance.md"
}
correr_panel () { # $1 = contenido de loop.pid ("" = sin archivo) · imprime "AVANCE|CORRIENDO"
  if [ -n "$1" ]; then printf '%s\n' "$1" > "$SB/packages/metodo/panel/loop.pid"
  else rm -f "$SB/packages/metodo/panel/loop.pid"; fi
  node "$SB/packages/metodo/panel/generar.mjs" --app=kilopan >/dev/null 2>&1
  node -e '
    const fs = require("fs");
    const est = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const html = fs.readFileSync(process.argv[2], "utf8");
    const m = html.match(/Avance del plan<\/div><div class="v">(\d+)%/);
    process.stdout.write((m ? m[1] : "?") + "|" + est.loop.corriendo);
  ' "$SB/packages/metodo/panel/estado.json" "$SB/packages/metodo/panel/index.html"
}

# (1) 1 cerrado / 1 abierto: loop APAGADO vs loop VIVO (este mismo shell, pid $$) ⇒ mismo avance.
sembrar_specs 1 1
R_APAGADO="$(correr_panel "")"
R_VIVO="$(correr_panel "$$")"
AV_APAGADO="${R_APAGADO%%|*}"; CORR_APAGADO="${R_APAGADO##*|}"
AV_VIVO="${R_VIVO%%|*}";       CORR_VIVO="${R_VIVO##*|}"
if [ "$CORR_APAGADO" = "false" ] && [ "$CORR_VIVO" = "true" ]; then
  ok "el sandbox ejerce de verdad ambos estados del loop (apagado→vivo), no es un no-op"
else
  no "el sandbox no diferenció loop apagado/vivo ($R_APAGADO vs $R_VIVO) — la prueba no probó nada"
fi
if [ "$AV_APAGADO" = "50" ] && [ "$AV_VIVO" = "50" ]; then
  ok "prender el loop NO mueve el avance (50% con y sin proceso vivo)"
else
  no "el avance cambió al prender el loop ($AV_APAGADO→$AV_VIVO): el proceso vivo se cuela como señal de avance"
fi
# (2) sube a 2 cerrados / 0 abiertos ⇒ el avance DEBE subir a 100 (sale del conteo de ACs, no de commits).
sembrar_specs 2 0
AV_MAS="$(correr_panel "$$")"; AV_MAS="${AV_MAS%%|*}"
[ "$AV_MAS" = "100" ] && ok "el avance sube con los ACs cerrados (2/2 → 100%), con los commits en 0 en el sandbox" \
                      || no "más ACs cerrados no subieron el avance (dio $AV_MAS, esperaba 100): no sale del conteo de ACs"
# (3) mutant-kill directo del AC: cero cerrados con el loop VIVO ⇒ avance 0 (el pid jamás es señal de avance).
sembrar_specs 0 2
AV_CERO="$(correr_panel "$$")"; AV_CERO="${AV_CERO%%|*}"
[ "$AV_CERO" = "0" ] && ok "con el loop VIVO pero 0 ACs cerrados el avance es 0 (el «proceso vivo» no cuenta)" \
                     || no "el loop vivo con 0 ACs cerrados dio avance $AV_CERO — «proceso vivo» cuenta como avance, lo que el AC prohíbe"
rm -rf "$(dirname "$SB")"

echo
echo "== 9. Selector de modelo (casilla 12) =="
# §8 del maestro: «se testea contra el caso normal — un selector no-op que todo lo manda
# a Opus quema la ventana en silencio». La prueba central no es que devuelva un id, es
# que DIFERENCIE. Un no-op pasaría cualquier test que mire una sola línea.
SEL="$M/model-selector.sh"
[ "$(bash "$SEL" plan)"   = "claude-sonnet-5"   ] && ok "plan → Sonnet"  || no "plan no rutea a Sonnet"
[ "$(bash "$SEL" verify)" = "claude-sonnet-5"   ] && ok "verify → Sonnet" || no "verify no rutea a Sonnet"
[ "$(bash "$SEL" juez)"   = "claude-opus-4-8"   ] && ok "juez → Opus (mandato de refutar)" || no "juez no rutea a Opus"

TMPP="$(mktemp -d)"; cp IMPLEMENTATION_PLAN.md "$TMPP/plan.bak"
# HERMETICIDAD (2-ago-2026): estas pruebas de ruteo dan por sentado que el contador de
# strikes está en cero, y pasaban sólo porque `.ralph/build-fails` NUNCA existía — nadie
# lo escribía. Al arreglar eso (loop.sh ya lo incrementa), el contador quedó en 1 tras un
# fallo real del motor y «ítem de UI» empezó a rutear a Sonnet en vez de Haiku: el
# selector hacía lo correcto (un fallo ⇒ piso Sonnet) y era la PRUEBA la que mentía, por
# depender de estado ambiente. Se guarda y se limpia; se restaura al final.
[ -f .ralph/build-fails ] && cp .ralph/build-fails "$TMPP/build-fails.bak"
mkdir -p .ralph; rm -f .ralph/build-fails
FX="AC-$(printf X)$(printf X)"   # id de fixture armado en runtime: escrito literal, este
                                  # archivo citaría ACs que ninguna spec define y verify-refs
                                  # pondría el gate en rojo por el andamio de su propia suite.
FXS="AC-$(printf S)EC"
probar_ruteo () { # $1 = linea de ítem · $2 = modelo esperado · $3 = descripción
  printf '# plan de prueba\n\n%s\n' "$1" > IMPLEMENTATION_PLAN.md
  got="$(bash "$SEL" build)"
  [ "$got" = "$2" ] && ok "$3 → $(echo "$2" | sed 's/claude-//;s/-4-8//;s/-5//')" || no "$3 ruteó a $got, esperaba $2"
}
probar_ruteo '- [ ] (P0-SEC) bloqueo por PIN errado [${FXS}-99]'        "claude-opus-4-8"  "ítem -SEC"
probar_ruteo '- [ ] (P1) migración que agrega un trigger [${FX}-99]'    "claude-opus-4-8"  "ítem que toca migración"
probar_ruteo '- [ ] (P1) chip con el nombre del operador [${FX}-98]'    "claude-haiku-4-5" "ítem de UI"
probar_ruteo '- [ ] (P1) cola con reintento automático [${FX}-97]'      "claude-sonnet-5"  "ítem estándar"
# Escalación de dos strikes sobre un ítem NO-duro
mkdir -p .ralph; echo 2 > .ralph/build-fails
probar_ruteo '- [ ] (P1) cola con reintento automático [${FX}-96]'      "claude-opus-4-8"  "2 strikes escala a"

# EL BUCLE DE MUERTE (bug real, 3-ago-2026): la regla de arriba dice «2 fallos en el MISMO
# AC» pero leía `.ralph/build-fails`, que es GLOBAL y sólo vuelve a cero con un commit.
# Sin commits nunca bajaba —llegó a 14—, así que TODO build salía a Opus, Opus agotaba el
# presupuesto antes de comitear, y no comitear subía el contador: ciclo cerrado, 2 h y 9
# iteraciones quemadas hasta pausar por rc 8. El caso que lo atrapa es exactamente el que
# el bug no podía dar: global ALTO + ese AC sin fallos propios ⇒ NO debe escalar.
FXP="AC-$(printf P)ES"
printf '# plan de prueba\n\n- [ ] (P1) cola con reintento automático [%s-95]\n' "$FXP" > IMPLEMENTATION_PLAN.md
mkdir -p .ralph/fallos; echo 9 > .ralph/build-fails; rm -f ".ralph/fallos/${FXP}-95"
got_sano="$(bash "$SEL" build kilopan "${FXP}-95")"
[ "$got_sano" = "claude-sonnet-5" ] \
  && ok "un AC SIN fallos propios no hereda el contador global (el bucle de muerte no puede volver)" \
  || no "model-selector volvió a leer el contador GLOBAL: con global=9 y 0 fallos propios ruteó a $got_sano — es el bucle que quemó 9 iteraciones"
# Y el control en negativo: el mismo AC, ahora CON sus propios strikes, sí debe escalar.
echo 2 > ".ralph/fallos/${FXP}-95"
got_malo="$(bash "$SEL" build kilopan "${FXP}-95")"
[ "$got_malo" = "claude-opus-4-8" ] \
  && ok "y con 2 fallos PROPIOS sí escala a Opus (la escalación sigue viva, no se desactivó)" \
  || no "la escalación por AC no dispara: 2 fallos propios rutearon a $got_malo"
rm -f ".ralph/fallos/${FXP}-95"

# El selector debe saltear los ACs que loop.sh saltea. Sin esto clasificaba el primer
# ítem del plan aunque estuviera atascado — el mismo bug que su cabecera dice haber
# arreglado en e-auto, entrando por otra puerta.
ATMP="$(mktemp -d)"; ATAS="packages/metodo/panel/acs-atascados.txt"
[ -f "$ATAS" ] && cp "$ATAS" "$ATMP/atascados.bak"
printf '# plan\n\n- [ ] (P0-SEC) item atascado que el motor NO va a tomar [%s-94]\n- [ ] (P1) cola con reintento automático [%s-93]\n' "$FXS" "$FXP" > IMPLEMENTATION_PLAN.md
printf '%s-94\n' "$FXS" > "$ATAS"
rm -f .ralph/build-fails
got_sal="$(bash "$SEL" build)"
[ "$got_sal" = "claude-sonnet-5" ] \
  && ok "el selector saltea los ACs atascados igual que loop.sh (clasifica el que se va a construir)" \
  || no "el selector clasificó un AC ATASCADO que loop.sh no va a tomar: ruteó a $got_sal"
if [ -f "$ATMP/atascados.bak" ]; then cp "$ATMP/atascados.bak" "$ATAS"; else rm -f "$ATAS"; fi
rm -rf "$ATMP"
# Se restaura el contador REAL del motor: borrarlo sin más le regalaría al motor un
# «cero strikes» cada vez que corre el gate, y la escalación —que recién ahora existe—
# no llegaría nunca a dispararse en producción.
rm -f .ralph/build-fails
[ -f "$TMPP/build-fails.bak" ] && cp "$TMPP/build-fails.bak" .ralph/build-fails
cp "$TMPP/plan.bak" IMPLEMENTATION_PLAN.md; rm -rf "$TMPP"
# El anti-no-op: los cuatro casos de arriba deben haber dado al menos 3 modelos distintos.
distintos=$(printf '%s\n' "claude-opus-4-8" "claude-haiku-4-5" "claude-sonnet-5" | sort -u | wc -l | tr -d ' ')
[ "$distintos" -ge 3 ] && ok "el selector DIFERENCIA (no es un no-op que manda todo a Opus)" || no "selector no-op"

echo
echo "=================== RESUMEN ARNÉS ==================="
echo "  verde: $PASA   ·   rojo: $FALLA"
if [ "$FALLA" -ne 0 ]; then echo "prueba-arnes: ROJO — hay guards que no protegen lo que dicen proteger."; exit 1; fi
echo "prueba-arnes: VERDE"
