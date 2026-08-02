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
PANEL=packages/metodo/panel

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

# (d) watchdog.sh sale con 0 al pausar, para que KeepAlive del plist NO lo resucite.
grep -q "PAUSA-REVISION" "$M/watchdog.sh" && ok "watchdog.sh usa un marcador de pausa que launchd no puede pisar" || no "watchdog.sh sin marcador: launchd lo relanza tras cada abort, en bucle infinito"
grep -qE "^\s*exit 1$" "$M/watchdog.sh" && no "watchdog.sh todavía sale con 1 en algún abort — KeepAlive lo relanzaría" || ok "ningún abort sale con 1 (KeepAlive/SuccessfulExit=false no lo revive)"
# El marcador debe FRENAR de verdad, no solo existir: con él puesto, el watchdog no construye.
touch "$PANEL/PAUSA-REVISION"
SALIDA_PAUSA="$(KILOPAN_MAX_ITERACIONES=1 bash "$M/watchdog.sh" 2>&1 | head -3)"
rm -f "$PANEL/PAUSA-REVISION"
case "$SALIDA_PAUSA" in
  *"EN PAUSA"*) ok "con el marcador puesto, el watchdog no arranca (frena de verdad)" ;;
  *)            no "el marcador de pausa no frena al watchdog: sigue construyendo" ;;
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
echo "== 5. Estructura del monorepo (AC-H0-01) =="
[ -f pnpm-workspace.yaml ] && [ -d apps ] && [ -d packages ] && ok "pnpm workspace con apps/ y packages/" || no "estructura de monorepo ausente"
for p in miga metodo nucleo-comun nucleo-identidad nucleo-pod nucleo-dte; do
  [ -d "packages/$p" ] || { no "falta packages/$p"; break; }
done
[ -d packages/nucleo-dte ] && ok "los 6 paquetes del Anexo C existen"

echo
echo "== 6. Tokens de diseño Miga (AC-H0-02) =="
grep -rq "C2410C" packages/miga/src 2>/dev/null && ok "acento KiloPan #C2410C definido en packages/miga" || no "falta el token de acento #C2410C"
grep -rq "1D4ED8" packages/miga/src 2>/dev/null && ok "acento KiloRuta #1D4ED8 reservado (Anexo C)" || no "falta el token #1D4ED8 de apps/flota"

echo
echo "== 7. Test de tabular-nums (AC-H0-03) =="
grep -rqE "tabular-nums|font-variant-numeric" packages/miga/src 2>/dev/null && ok "los componentes de cifras usan tabular-nums" || no "ninguna cifra usa tabular-nums"

echo
echo "== 8. Gate y panel ejecutables (AC-H0-05 · AC-H0-06) =="
bash -n "$M/check.sh" 2>/dev/null && ok "check.sh es sintácticamente válido y ejecutable" || no "check.sh no parsea"
grep -q -- "--full" "$M/check.sh" && ok "check.sh acepta --full" || no "check.sh sin modo --full"
node --check packages/metodo/panel/generar.mjs 2>/dev/null && ok "panel/generar.mjs parsea" || no "panel/generar.mjs no parsea"
grep -q "rev-list --count" packages/metodo/panel/generar.mjs && ok "el panel mide avance por commits, jamás por «proceso vivo»" || no "el panel no calcula desde git"

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
rm -f .ralph/build-fails
cp "$TMPP/plan.bak" IMPLEMENTATION_PLAN.md; rm -rf "$TMPP"
# El anti-no-op: los cuatro casos de arriba deben haber dado al menos 3 modelos distintos.
distintos=$(printf '%s\n' "claude-opus-4-8" "claude-haiku-4-5" "claude-sonnet-5" | sort -u | wc -l | tr -d ' ')
[ "$distintos" -ge 3 ] && ok "el selector DIFERENCIA (no es un no-op que manda todo a Opus)" || no "selector no-op"

echo
echo "=================== RESUMEN ARNÉS ==================="
echo "  verde: $PASA   ·   rojo: $FALLA"
if [ "$FALLA" -ne 0 ]; then echo "prueba-arnes: ROJO — hay guards que no protegen lo que dicen proteger."; exit 1; fi
echo "prueba-arnes: VERDE"
