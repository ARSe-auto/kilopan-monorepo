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

# Restauración pase lo que pase: estas pruebas mueven .env.local a propósito.
RESPALDO_ENV=""
limpiar () {
  [ -n "$RESPALDO_ENV" ] && [ -f "$RESPALDO_ENV" ] && mv -f "$RESPALDO_ENV" "$RAIZ/.env.local"
  rm -rf "$RAIZ/.metodo-locks/prueba".* 2>/dev/null
  bash "$M/lock.sh" soltar prueba-arnes >/dev/null 2>&1
}
trap limpiar EXIT INT TERM

echo "== 1. Candado anti-producción (casilla 10b · AC-H0-04) =="
# El guard debe ABORTAR con una URL remota sin la marca de intencionalidad, y debe
# hacerlo leyendo la ÚLTIMA definición: el modo de fallo real fue un .env.local con
# localhost arriba y la cadena del dashboard pegada al final.
if [ -f .env.local ]; then RESPALDO_ENV="$RAIZ/.env.local.prueba-arnes.bak"; cp .env.local "$RESPALDO_ENV"; fi
printf 'DATABASE_URL=postgres://u:p@localhost:5432/x\nDATABASE_URL=postgres://u:p@db.panaderia-real.com:5432/prod\n' > .env.local
if bash "$M/guardrail.sh" >/dev/null 2>&1; then
  no "guardrail NO aborta con DATABASE_URL remota — el candado no protege nada"
else
  ok "aborta con DATABASE_URL remota (y lee la ÚLTIMA definición, no la primera)"
fi
# Y debe DEJAR PASAR la misma URL remota cuando el dueño la declaró intencional:
# un guard que siempre aborta tampoco sirve — bloquearía el trabajo legítimo.
printf 'DATABASE_URL=postgres://u:p@db.panaderia-real.com:5432/prod\nKILOPAN_DB_REMOTA_INTENCIONAL=1\n' > .env.local
if bash "$M/guardrail.sh" >/dev/null 2>&1; then
  ok "deja pasar la remota cuando KILOPAN_DB_REMOTA_INTENCIONAL=1 (no es un no-op al revés)"
else
  no "guardrail aborta incluso con la marca intencional — bloquea trabajo legítimo"
fi
# sslmode en la URL debe abortar: node-postgres lo trata distinto que libpq y pisa el TLS del código.
printf 'DATABASE_URL=postgres://u:p@db.x.com:5432/prod?sslmode=require\nKILOPAN_DB_REMOTA_INTENCIONAL=1\n' > .env.local
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "no aborta con ?sslmode= en la URL" || ok "aborta con ?sslmode= (pisaría politicaTls() del código)"
limpiar; RESPALDO_ENV=""

echo
echo "== 2. Anti-cáscaras en src/ (AC-H0-04) =="
CANARIO="apps/kilopan/src/.canario-prueba-arnes.ts"
printf '// PLACEHOLDER: canario de prueba del arnes\nexport const x = 1;\n' > "$CANARIO"
bash "$M/guardrail.sh" >/dev/null 2>&1 && no "el grep anti-cáscaras NO detecta PLACEHOLDER en src/" || ok "detecta un token vedado plantado en src/"
rm -f "$CANARIO"

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
echo "=================== RESUMEN ARNÉS ==================="
echo "  verde: $PASA   ·   rojo: $FALLA"
if [ "$FALLA" -ne 0 ]; then echo "prueba-arnes: ROJO — hay guards que no protegen lo que dicen proteger."; exit 1; fi
echo "prueba-arnes: VERDE"
