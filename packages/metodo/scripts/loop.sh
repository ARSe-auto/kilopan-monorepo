#!/usr/bin/env bash
# Una iteración plan -> build -> verify sobre el siguiente AC abierto de
# IMPLEMENTATION_PLAN.md (P0 antes que P1 antes que P2). Se invoca desde watchdog.sh
# o a mano. Exit 0 = commit nuevo landed; exit 1 = sin avance (el watchdog decide qué
# hacer con eso, ver docs/LECCION_RALPH.md).
set -uo pipefail
export PATH="$HOME/.local/lib/nodejs/current/bin:$PATH"
cd "$(dirname "$0")/../../.."

APP="kilopan"
for arg in "$@"; do
  case "$arg" in
    --app=*) APP="${arg#--app=}" ;;
    *) echo "loop.sh: argumento desconocido '$arg' (uso: [--app=kilopan|flota])"; exit 2 ;;
  esac
done

# Un plan por app: `siguiente_ac` no debe cruzar productos.
PLAN="IMPLEMENTATION_PLAN_${APP}.md"
if [ ! -f "$PLAN" ] && [ "$APP" = "kilopan" ] && [ -f "IMPLEMENTATION_PLAN.md" ]; then
  PLAN="IMPLEMENTATION_PLAN.md"   # nombre histórico, previo a la separación por app
fi
[ -f "$PLAN" ] || { echo "loop: falta $PLAN"; exit 2; }
LOG_DIR="${KILOPAN_PANEL_DIR:-packages/metodo/panel}"   # ver watchdog.sh: la suite lo redirige
# 3→6 (06-ago-2026): con tope $3, AC-DES-04 (F3, el AC más grande del flujo dorado)
# murió DOS veces por agotamiento con el trabajo bien encaminado — Sísifo: el WIP iba
# al stash y la iteración siguiente partía de cero. El freno contra el gasto en círculo
# ya no es este tope sino los 3 sin-avance del watchdog + el marker de pausa. Si un AC
# no cabe en $6 × 3 intentos, la respuesta es PARTIRLO, no subir esto de nuevo.
MAX_BUDGET_USD="${KILOPAN_MAX_BUDGET_USD:-6}"

# UN SOLO BUILDER POR WORKTREE (casilla 15). Se toma ANTES de mirar el plan: dos loops
# que leen el mismo plan eligen el mismo AC y se pisan los commits. El 26-jul-2026 dos
# sesiones construyeron KiloPan a la vez durante horas — este lock es la respuesta.
# Exit 7 = ya hay otro builder vivo; el watchdog lo trata como «esperar», no como rojo.
if ! bash packages/metodo/scripts/lock.sh tomar "builder-$APP" $$; then
  echo "loop: ya hay otro builder vivo en este worktree — no arranco (exit 7)"
  exit 7
fi
trap 'bash packages/metodo/scripts/lock.sh soltar "builder-'"$APP"'" '"$$"' >/dev/null 2>&1' EXIT INT TERM

# ACs ATASCADOS (bug real, 2-ago-2026). `grep -m1` devuelve SIEMPRE el mismo primer AC
# abierto, así que un AC que el motor no puede cerrar —demasiado grande para el
# presupuesto, o que necesita una migración de sesión supervisada (§7)— bloquea a TODOS
# los que vienen detrás, para siempre. Con AC-SEC-05 bloqueó a los otros 41.
# Un AC que falla N veces seguidas se anota acá, el motor sigue con el siguiente, y queda
# listado para que un humano lo mire. No se marca [x] ni se toca su spec: sigue abierto y
# pendiente, solo deja de ser el tapón.
ATASCADOS="$LOG_DIR/acs-atascados.txt"

esta_atascado () { # $1 = id del AC
  [ -n "${1:-}" ] || return 1
  [ -f "$ATASCADOS" ] || return 1
  grep -qxF "$1" "$ATASCADOS"
}

siguiente_ac() {
  for prioridad in '\(P0' '\(P1' '\(P2'; do
    # El here-doc (y no una tubería) es a propósito: `while ... | read` corre en subshell
    # y el `return 0` de adentro no saldría de la función.
    while IFS= read -r linea; do
      [ -n "$linea" ] || continue
      id=$(echo "$linea" | grep -oE '\[AC-[A-Z0-9-]+\]' | tr -d '[]')
      esta_atascado "$id" && continue
      echo "$linea"
      return 0
    done <<EOF
$(grep -E "^- \[ \] ${prioridad}" "$PLAN" || true)
EOF
  done
  return 1
}

id_de_linea () { echo "${1:-}" | grep -oE '\[AC-[A-Z0-9-]+\]' | tr -d '[]'; }

# MODO SECO: responder sólo «¿qué AC elegirías?», sin tocar el árbol, sin correr el gate y
# sin invocar al agente. Lo usa prueba-arnes.sh para probar el salteo de ACs atascados:
# una suite que gasta US$3 de `claude -p` cada vez que corre el gate no se corre nunca, y
# un guard que nadie ejercita es indistinguible de uno roto (cap. 14).
if [ -n "${KILOPAN_DRY_RUN:-}" ]; then
  AC_SECO="$(siguiente_ac)"
  echo "loop: siguiente = $(id_de_linea "$AC_SECO") :: ${AC_SECO:-<ninguno>}"
  echo "loop: KILOPAN_DRY_RUN — no toco el árbol, no corro el gate, no invoco al agente."
  exit 0
fi

# ÁRBOL LIMPIO ANTES DE ELEGIR (bug real, 2-ago-2026 — el primero que encontró el motor
# corriendo de verdad). Cuando una iteración no logra verde, el agente NO comitea: así se
# le pide, y hace bien. Pero su trabajo a medias queda en el árbol, y la iteración
# siguiente lo HEREDA: su gate arranca ROJO por código que ella no escribió, y no puede
# dar verde jamás por mucho que trabaje. El motor giró media hora sobre AC-SEC-05 así, y
# como watchdog.sh aborta con exit 1 y el plist relanza ante cualquier salida no-exitosa,
# el ciclo era infinito — cada vuelta costaba hasta 3 × US$3 de `claude -p`.
#
# Se GUARDA en stash, jamás se borra: «no revertir solo» (docs/LECCION_RALPH.md) vale
# también para el trabajo que el motor no alcanzó a terminar. Un veredicto malo que borra
# trabajo sano es peor que un rojo esperando a que alguien mire.
#
# Se excluyen dos rutas que están sucias SIEMPRE por construcción — tratarlas como trabajo
# a medias stashearía ruido en cada iteración hasta topar KILOPAN_MAX_STASHES y pausar el
# motor por nada:
#   · packages/metodo/panel/ — artefactos que el propio motor reescribe en cada corrida
#     (`ultimo-resultado.json`, `ultimo-check.estado`, marcadores de verde).
#   · apps/kilopan/next-env.d.ts — lo REGENERA Next en cada build apuntando al distDir que
#     se usó, y el gate corre dos builds con distDir distinto (`.next` en build, `.next-e2e`
#     en e2e). Queda alternando solo. No es trabajo de nadie.
EXCLUIR_SUCIO=(':!packages/metodo/panel' ':!apps/kilopan/next-env.d.ts')
SUCIO="$(git status --porcelain -- "${EXCLUIR_SUCIO[@]}" 2>/dev/null)"
if [ -n "$SUCIO" ]; then
  MARCA="motor-wip-$(date +%Y%m%d-%H%M%S)"
  echo "loop: ÁRBOL SUCIO al arrancar — una iteración anterior dejó trabajo sin comitear:"
  echo "$SUCIO" | sed 's/^/  /'
  if git stash push -u -m "$MARCA (guardado por loop.sh — NO borrado)" -- "${EXCLUIR_SUCIO[@]}" >/dev/null 2>&1; then
    echo "loop: guardado en stash '$MARCA' — recuperable con 'git stash list'. Sigo con árbol limpio."
    # ARTEFACTOS HUÉRFANOS (bug real, 3-ago-2026 — costó 4 rojos en cascada). El stash se
    # lleva el FUENTE, pero los tipos que Next generó a partir de él NO: están gitignored,
    # así que `git stash -u` ni los ve. Una iteración que creó `src/app/turno/page.tsx`
    # dejó `.next/types/app/turno/page.ts` importándolo, el stash se llevó la página, y el
    # typecheck de la vuelta siguiente falló con «Cannot find module .../turno/page.js» —
    # y detrás cayeron build, standalone y audit. Cuatro rojos que no tenían NADA que ver
    # con el AC en curso: el motor los habría leído como «este AC no compila» y gastado
    # sus tres intentos en un fantasma. Los tipos se regeneran solos en el próximo build.
    rm -rf apps/*/.next/types apps/*/.next-e2e/types 2>/dev/null || true
    echo "loop: tipos generados de Next descartados — se regeneran en el build y, si no, apuntan a fuentes que el stash se llevó."
  else
    echo "loop: NO pude guardar el árbol sucio — no construyo sobre un árbol que no controlo (exit 8)"
    exit 8
  fi
fi

# Tope de stashes acumulados: si el motor lleva muchas iteraciones guardando trabajo a
# medias, el problema no se arregla girando — lo tiene que mirar alguien.
N_STASH=$(git stash list 2>/dev/null | wc -l | tr -d ' ')
if [ "${N_STASH:-0}" -gt "${KILOPAN_MAX_STASHES:-10}" ]; then
  echo "loop: $N_STASH stashes acumulados — el motor viene fallando en serie. Pausa para revisión (exit 8)."
  exit 8
fi

# EL CONTRATO PRIMERO. Sin specs válidas no se construye — este abort es exactamente lo
# que faltaba hasta el 26-jul-2026 y lo que dejó al motor produciendo tandas A-F de
# reparación en vez de ACs verificados.
if ! node packages/metodo/scripts/gate_specs.mjs "--app=$APP"; then
  echo "ABORT: specs incompletas o sin fuente. Specs primero."
  exit 2
fi
if ! node packages/metodo/scripts/verify-refs.mjs "--app=$APP"; then
  echo "ABORT: hay ACs citados que ninguna spec define."
  exit 2
fi

AC_LINEA="$(siguiente_ac)"
if [ -z "${AC_LINEA:-}" ]; then
  # Exit 6, NO 0: para el watchdog, 0 significa «hubo commit nuevo» y dispara el gate
  # completo de verificación independiente. Sin trabajo que hacer eso son ~6 minutos de
  # gate sobre un árbol que nadie tocó, en cada vuelta. 6 = «no queda trabajo» y el
  # watchdog termina limpio.
  echo "loop: no quedan ACs P0/P1/P2 abiertos (ni atascados pendientes) — ver criterio DONE en $PLAN"
  exit 6
fi
AC_ID=$(echo "$AC_LINEA" | grep -oE '\[AC-[A-Z0-9-]+\]' | tr -d '[]')
echo "loop: siguiente = ${AC_ID:-sin-id} :: $AC_LINEA"

# SOBRE POR TIPO DE AC (07-ago-2026). Los AC de UI con e2e no caben en el sobre base:
# DES-06 y DTE-03 murieron 2 veces cada uno a centímetros del commit (el ciclo
# escribir→e2e→corregir→e2e cuesta más que un AC de API) y cerraron recién con la
# escalación a Opus en la 3ª iteración — 3 sobres para pagar 1. Si la línea del AC
# huele a UI+e2e, el sobre sube. El freno contra el gasto en círculo sigue siendo el
# watchdog (3 sin-avance) + el marker, no este número.
if echo "$AC_LINEA" | grep -qiE 'e2e|pantalla|zxing|esc[áa]ner|c[áa]mara|modal|banner'; then
  MAX_BUDGET_USD="${KILOPAN_MAX_BUDGET_USD_UI:-10}"
  echo "loop: AC de UI+e2e — sobre ampliado a \$${MAX_BUDGET_USD}"
fi

COMMITS_ANTES=$(git rev-list --count HEAD 2>/dev/null || echo 0)

# SOS EL BUILDER, NO SU RIVAL (bug real, 2-ago-2026 — la razón por la que este motor
# nunca cerró un solo AC, ni una vez). AGENTS.md y CLAUDE.md mandan verificar que no haya
# otro builder con `ps aux | grep loop.sh` antes de construir. El agente obedecía... y
# encontraba SIEMPRE al `loop.sh` que acababa de lanzarlo a él. Concluía que había un
# motor rival, se negaba a tocar nada por regla dura, y encima preguntaba cuál de tres
# caminos tomar — corriendo bajo `claude -p`, donde no hay nadie que conteste. Cada
# iteración terminaba en 68 s, US$0,50, cero líneas escritas, y un «SIN AVANCE» que
# parecía culpa del AC. Deadlock determinista al 100%: la regla estaba bien escrita, pero
# nadie la había leído nunca desde adentro del proceso que la regla describe.
PROMPT="Estudiá AGENTS.md antes de tocar nada. Estás construyendo ${APP} en este monorepo.

CONTEXTO DE EJECUCIÓN — leelo antes que nada:
- A vos te lanzó el motor (packages/metodo/scripts/loop.sh, pid $$). Ese loop.sh que vas a
  ver en 'ps aux' SOS VOS: es tu proceso padre, y ya tomó el lock de builder a tu favor
  (.metodo-locks/builder-${APP}.lock). NO lo cuentes como un builder rival, no lo mates y
  no te frenes por él. Es el único caso en que ver un loop.sh vivo no te detiene.
- Corrés NO INTERACTIVO: no hay nadie del otro lado. Preguntar equivale a no hacer nada y
  perder la iteración. Si algo te bloquea de verdad, dejá dicho qué y por qué en tu
  respuesta final, no marques nada como hecho, y terminá.

Implementá EXACTAMENTE este ítem, nada más:

${AC_LINEA}

Reglas duras:
- El AC vive en specs/${APP}/ — esa es su definición canónica y durable. ${PLAN} solo
  lleva su estado. Leé la spec dueña del AC y la sección del maestro que cita su línea
  'Fuente: §N' (docs/PROMPT_MAESTRO*.md) ANTES de escribir código.
- Un AC = un commit, con su test naciendo en el mismo commit.
- Corré 'bash packages/metodo/scripts/check.sh --full --app=${APP}' y NO hagas commit si
  no queda verde (arreglar lo que encuentres es parte del AC).
- CITÁ el id del AC (${AC_ID}) en un comentario del código o del test que lo implementa.
  Sin esa cita, 'verify-refs --estricto' ve un [x] sin respaldo y pone el gate
  en ROJO — y ahí NINGÚN commit posterior puede pasar, ni el tuyo ni el de la iteración
  siguiente: el motor queda girando en falso hasta que un humano lo destrabe. Pasó de
  verdad el 26-jul-2026 con AC-ID-07. La cita no es burocracia: es lo que deja ir del
  código al contrato y de vuelta.
- Si el gate pasa, marcá el AC como [x] EN SU SPEC (specs/${APP}/) y en ${PLAN}, en el
  MISMO commit, con una nota breve de qué se probó. Marcar solo uno de los dos pone el
  gate en ROJO (regla 5: la spec y el plan se espejan).
- Si el TEXTO de tu AC exige un e2e, el [x] exige ESE e2e verde: corré
  'npx playwright test <su spec.ts>' en PRIMER PLANO antes de marcar nada — el check
  rápido NO corre e2e, y un [x] con e2e rojo lo pilla el gate independiente y pausa
  todo el motor (pasó el 06-ago con AC-DES-06).
- Un AC no se marca [x] si todavía falta parte de él. Si quedó a medias, partilo: cerrá
  lo hecho y dejá el resto como AC abierto nuevo en la spec. Un [x] cuyo texto dice
  'falta' pone el gate en rojo — y con razón.
- TUS COMANDOS BASH SE APRUEBAN POR PREFIJO contra una lista blanca (.claude/settings.json).
  Usá comandos SIMPLES: sin 'cd' (ya estás en la raíz del repo), sin ';', sin '&&' y sin
  heredocs — un comando compuesto NO calza ningún patrón y muere denegado, quemando el
  turno. 'pnpm …', 'node …', 'git …', 'bash packages/metodo/scripts/…' directos sí pasan.
- JAMÁS lances el gate ni tests en background, y tu último mensaje JAMÁS puede ser
  «espero que termine X»: en modo -p NO EXISTE el turno siguiente — morirías esperando
  (pasó el 06-ago: gate lanzado en background, sesión terminada «esperando», cero
  commit con el trabajo listo). Corré 'bash packages/metodo/scripts/check.sh' en
  PRIMER PLANO, esperá su exit code en el mismo turno, y actuá: verde ⇒ commit AHORA.
- ANTES de escribir nada: corré 'git stash list'. Si hay stashes 'motor-wip' recientes,
  alguno puede traer TU PROPIO avance de este mismo AC, de una iteración que murió por
  presupuesto (el arnés guarda el trabajo, no lo bota). Miralo con
  'git stash show -p stash@{N}' y recuperá lo útil ('git stash apply' o rescate a
  mano si no aplica limpio). Los stashes NO se borran jamás. Re-implementar de cero lo
  que ya está en un stash es tirar presupuesto.
- CHECKLIST DE e2e NUEVOS (cada punto es un rojo real de la noche del 06/07-ago):
  (1) enrolar/ingresar SOLO con los helpers compartidos: sembrarDispositivo(page, datos.dispositivo)
  e ingresar(page, RUT, pin) — la firma pide RUT, no el nombre del rol, y no inventes
  placeholders que la pantalla no tiene; (2) para pegarle a la API usa page.request
  (comparte cookies de la sesión) — el fixture 'request' pelado va sin sesión y da 401;
  (3) todo listado puede venir VACÍO en la base e2e: aserta contenido real O el estado
  vacío de Miga con .or(); (4) selectores por contenido visible real o getByRole, con
  { exact: true } si el texto puede ser substring de otro — jamás selectores fantasma
  tipo div[style*="..."]; (5) componentes de mapa/browser-only van con dynamic
  ssr:false desde un envoltorio cliente, o el dashboard entero muere en SSR.
- No toques ningún otro AC ni refactorices código no relacionado.
- Si el AC ya está hecho o depende de algo que no existe aún, decilo explícitamente y no
  inventes trabajo ni marques nada como [x]."

mkdir -p "$LOG_DIR"

# EL FALLBACK NO PUEDE DEGRADAR UNA REGLA DURA (8-ago-2026). Esto llamaba SIEMPRE con
# `--fallback-model sonnet`: si el modelo pedido no estaba disponible o la iteración topaba
# el presupuesto, el CLI bajaba a Sonnet solo y sin avisar, y el commit quedaba idéntico a
# uno sano. Un AC ruteado a Opus por ser regla dura —RLS, migración, trigger, invariante—
# terminaba escrito por un modelo menor, que es justo lo que el §8 prohíbe.
#
# Regla: si el selector pidió el modelo TOPE, no hay red de contención. Vale más una
# iteración fallida y reintentada que un commit fundacional escrito por otro modelo. Para
# todo lo demás el fallback sigue, porque ahí sí es preferible avanzar a detenerse.
#
# BUG REAL (10-ago-2026, primer arranque del motor de FLOTA): la rama sin fallback moría con
# «FALLBACK[@]: unbound variable» y el motor no podía construir NI UN AC de los que el §8 manda
# al modelo tope — que en FLOTA son casi todos. El bash de macOS es 3.2, y ahí expandir un array
# VACÍO bajo `set -u` cuenta como variable no definida; en bash ≥4.4 no. Por eso la expansión de
# abajo va con la forma `${A[@]+"${A[@]}"}`, que es fea y es la única que funciona en las dos.
#
# El síntoma engañaba, como el del token en KiloPan: el gate corría VERDE, el loop elegía bien
# su AC y anunciaba el modelo correcto, y recién ahí moría. Tres iteraciones así y el watchdog
# pausó el motor por «sin avance» — que es cierto, pero la causa no estaba en ningún AC.
MODELO_PEDIDO="$(bash packages/metodo/scripts/model-selector.sh build "$APP" "$AC_ID")"
MODELO_TOPE="$(bash packages/metodo/scripts/model-selector.sh modelo-tope)"
FALLBACK=(--fallback-model sonnet)
if [ "$MODELO_PEDIDO" = "$MODELO_TOPE" ]; then
  FALLBACK=()
  echo "loop: ${AC_ID:-?} va al modelo tope ($MODELO_PEDIDO) — sin fallback, por el §8"
fi

claude -p "$PROMPT" \
  --output-format json \
  --max-budget-usd "$MAX_BUDGET_USD" \
  --permission-mode acceptEdits \
  --model "$MODELO_PEDIDO" \
  ${FALLBACK[@]+"${FALLBACK[@]}"} \
  > "$LOG_DIR/ultimo-resultado.json" 2>>"$LOG_DIR/ultimo-loop.log"

# Y la segunda mitad: mirar quién respondió DE VERDAD. Quitar el fallback evita el degradado
# en el caso caro, pero no lo hace visible en los demás — y un degradado invisible es
# indistinguible de un build sano hasta que alguien lee el código meses después.
if ! node packages/metodo/scripts/detectar-degradado.mjs \
       "$LOG_DIR/ultimo-resultado.json" "$MODELO_PEDIDO" >>"$LOG_DIR/ultimo-loop.log" 2>&1; then
  RC_DEG=$?
  if [ "$RC_DEG" = "4" ]; then
    printf '%s %s pedido=%s\n' "$(date '+%F %T')" "${AC_ID:-?}" "$MODELO_PEDIDO" \
      >> "$LOG_DIR/modelo-degradado.log"
    echo "loop: DEGRADADO — ${AC_ID:-?} se pidió a $MODELO_PEDIDO y respondió otro modelo (ver $LOG_DIR/modelo-degradado.log)"
  fi
fi

COMMITS_DESPUES=$(git rev-list --count HEAD 2>/dev/null || echo 0)
node "$LOG_DIR/generar.mjs" >/dev/null 2>&1 || true

# EL MOTOR JAMÁS ESCRIBE EN db/migraciones/ (bug real, 3-ago-2026 — AC-ADM-05, el
# segundo AC de Ola 2). Regla explícita de docs/PROMPT_CORRECTIVO.md §7: «El motor
# autónomo jamás escribe en db/migraciones/... Migraciones y despliegue son de sesión
# supervisada, siempre. Si un ítem del plan exige una migración, el motor lo deja marcado
# requiere-dueño y toma el siguiente.» Existía SOLO como prosa en el maestro — ningún
# guardrail lo comprobaba nunca — y AC-ADM-05 la cruzó de largo: escribió
# db/migraciones/0020_anular_venta.sql, el gate independiente pasó verde (la migración
# en sí estaba bien escrita, aditiva, con reversión), y el commit se publicó a
# origin/main solo. La migración no era el problema; que nadie con autoridad la hubiera
# mirado antes de existir, sí.
#
# Esto NO es "SIN AVANCE" (el AC podría estar perfectamente resuelto) ni "ATASCADO" (no
# es que este AC en particular sea difícil — CUALQUIER AC que toque el esquema pisa esta
# regla). Es una violación de contrato: se pausa TODO, no solo se saltea este AC, porque
# ya hay un commit real con una migración sin supervisión y alguien tiene que decidir qué
# hacer con él antes de que el motor construya nada más encima.
if [ "$COMMITS_DESPUES" -gt "$COMMITS_ANTES" ] && git diff --name-only HEAD~1 HEAD -- db/migraciones/ 2>/dev/null | grep -q .; then
  echo "loop: CONTRATO ROTO — el commit que acaba de landear toca db/migraciones/:"
  git diff --name-only HEAD~1 HEAD -- db/migraciones/ | sed 's/^/  /'
  echo "loop: el motor NUNCA debe escribir migraciones (docs/PROMPT_CORRECTIVO.md §7)."
  echo "loop: pauso TODO el motor, no solo este AC — hay una migración sin supervisión ya"
  echo "loop: comiteada. Revisar a mano antes de relanzar (exit 10)."
  exit 10
fi

# CONTADOR DE STRIKES (bug real, 2-ago-2026). `model-selector.sh:64` lee
# `.ralph/build-fails` para escalar a Opus tras 2 intentos fallidos — y NADIE lo escribía
# nunca en producción: el único que lo tocaba era su propio test en prueba-arnes.sh. La
# escalación existía en el selector y no podía dispararse jamás. «Un guard que nunca
# dispara es indistinguible de uno roto» (cap. 14): acá es donde empieza a existir.
# Si hubiera funcionado, AC-SEC-05 habría escalado a Opus en su tercer intento.
mkdir -p .ralph/fallos
CONT_AC=".ralph/fallos/${AC_ID:-sin-id}"
leer_num () { n="$(cat "$1" 2>/dev/null | tr -dc 0-9)"; echo "${n:-0}"; }

# ATRIBUCIÓN DE AVANCE (bug real, 06-ago-2026): dos commits docs EXTERNOS (5f1d344,
# e32327e, de una sesión supervisada) aterrizaron a mitad de iteración y el delta ciego
# de commits los acreditó como avance de AC-DES-04 — que seguía sin comitear — y encima
# gatilló la re-verificación del watchdog sobre un árbol con WIP. El avance de UN AC son
# commits que llevan SU id en el mensaje; lo externo se declara, no se acredita.
# BUG REAL (07-ago-2026, mismo día del fix): el filtro exigía `[AC-ID]` con corchetes
# literales — el estilo `feat(x): ... [AC-XX-YY]` al final del mensaje. Dos commits
# reales y bien cerrados (AC-ID-07, AC-DASH-02: specs+plan [x], e2e verde) se
# rechazaron porque el builder escribió `test(dashboard): AC-DASH-02 — ...` SIN
# corchetes al inicio — y las 2 "no-atribuciones" falsas quemaron 2 de los 3 strikes
# que pausaron el motor entero sin AC real atascado. Grep extendido (-E), corchetes
# OPCIONALES: acepta `[AC-XX-YY]` y `AC-XX-YY` a secas, en cualquier posición.
AVANCE_DEL_AC=0
if [ "$COMMITS_DESPUES" -gt "$COMMITS_ANTES" ]; then
  N_NUEVOS=$((COMMITS_DESPUES - COMMITS_ANTES))
  N_DEL_AC=$(git log --oneline --extended-regexp --grep="\[?${AC_ID:-<sin-id>}\]?" "HEAD~${N_NUEVOS}..HEAD" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${N_DEL_AC:-0}" -gt 0 ]; then
    AVANCE_DEL_AC=1
  else
    echo "loop: ${N_NUEVOS} commit(s) nuevo(s) pero ninguno menciona ${AC_ID:-?} — externos al AC; no cuentan como avance."
  fi
fi
if [ "$AVANCE_DEL_AC" -eq 1 ]; then
  echo "loop: OK — commit nuevo (${COMMITS_ANTES} -> ${COMMITS_DESPUES}) para ${AC_ID:-?}"
  echo 0 > .ralph/build-fails
  rm -f "$CONT_AC"
  exit 0
else
  # BLOQUEO POR PERMISOS (bug real, 2-ago-2026). `--permission-mode acceptEdits` auto-aprueba
  # ediciones de archivo pero NO comandos Bash: el agente escribía el test del AC y después
  # no podía correr check.sh —«This command requires approval»— y, corriendo no interactivo,
  # no había nadie que aprobara. Obedecía su regla dura (no comitear sin verde) y terminaba
  # en SIN AVANCE HABIENDO HECHO EL TRABAJO — indistinguible, desde afuera, de un AC difícil.
  # Reintentar no lo arregla nunca: hay que tocar .claude/settings.json. Se pausa y se avisa.
  if grep -qiE "requires approval|permission denied|requiere aprobaci" "$LOG_DIR/ultimo-resultado.json" 2>/dev/null; then
    echo "loop: BLOQUEADO POR PERMISOS — el agente necesitó aprobar un comando y corre sin nadie que apruebe."
    echo "loop: revisar la lista blanca de .claude/settings.json (ojo: settings.local.json la PISA)."
    echo "loop: reintentar no lo arregla — pauso para revisión (exit 8)."
    exit 8
  fi
  # ─────────────────────────────────────────────────────────────────────────────────
  # CLASIFICAR EL FALLO ANTES DE CONTARLO (redefinición 3-ago-2026).
  #
  # Hasta acá, CUALQUIER ausencia de commit sumaba un strike al AC, y a los 3 lo marcaba
  # atascado para siempre. Pero un commit puede faltar por razones que no dicen NADA sobre
  # el AC, y las dos se vieron el mismo día:
  #   · el presupuesto de la iteración se agotó a mitad del trabajo (`budget_exhausted`);
  #   · el gate salió rojo en un paso que este AC no puede haber roto — un CVE nuevo en
  #     `audit` (GHSA-rgw5-rvv9-x895 en brace-expansion, transitiva de eslint) tumbó el
  #     gate entero, y el agente, obedeciendo «no comitear sin verde», terminó en SIN
  #     AVANCE habiendo hecho el trabajo.
  # Contar eso como fallo DEL AC es acusar al AC de lo que hizo el entorno: se marcan ACs
  # sanos como atascados, el motor deja de intentarlos, y el backlog se vacía en falso.
  # La regla nueva: un strike es evidencia sobre el AC. Si la causa es ajena, se registra
  # y se reintenta, pero NO se le carga al AC.
  RESULTADO_JSON="$LOG_DIR/ultimo-resultado.json"
  if grep -qE '"(terminal_reason|subtype)":"[^"]*(budget|max_turns|timeout)' "$RESULTADO_JSON" 2>/dev/null; then
    echo "loop: SIN COMMIT por AGOTAMIENTO DE RECURSO (presupuesto/turnos/tiempo), no por el AC."
    echo "loop: NO cuenta como intento fallido de ${AC_ID:-?} — el trabajo puede estar bien encaminado."
    exit 1
  fi
  # El gate lista sus fallos en una línea «FALLÓ   (n): paso1 paso2». Si el ÚNICO rojo es
  # `audit`, es dependencias del repo: ningún AC lo rompe ni lo arregla escribiendo su
  # feature. Se acota a ese caso a propósito — un rojo en lint/typecheck/build/e2e SÍ puede
  # ser del AC, y ahí el strike es correcto.
  CHECK_LOG="$LOG_DIR/ultimo-check.log"
  if [ -f "$CHECK_LOG" ]; then
    LINEA_FALLO="$(grep -E '^FALLÓ' "$CHECK_LOG" | tail -1)"
    N_FALLOS="$(printf '%s' "$LINEA_FALLO" | grep -oE '\([0-9]+\)' | tr -dc 0-9)"
    if [ "${N_FALLOS:-0}" = "1" ] && printf '%s' "$LINEA_FALLO" | grep -q "audit"; then
      echo "loop: SIN COMMIT porque el gate está rojo SOLO en 'audit' — es una vulnerabilidad de"
      echo "loop: dependencias del repo, ajena a ${AC_ID:-?}. NO cuenta como intento fallido."
      echo "loop: arreglar el override en pnpm-workspace.yaml; hasta entonces NINGÚN AC puede comitear."
      exit 1
    fi
  fi
  # ─────────────────────────────────────────────────────────────────────────────────
  fallos_ac=$(( $(leer_num "$CONT_AC") + 1 ))
  echo "$fallos_ac" > "$CONT_AC"
  echo $(( $(leer_num .ralph/build-fails) + 1 )) > .ralph/build-fails
  echo "loop: SIN AVANCE para ${AC_ID:-?} (intento $fallos_ac) — ver $LOG_DIR/ultimo-loop.log y ultimo-resultado.json"
  if [ -n "${AC_ID:-}" ] && [ "$fallos_ac" -ge "${KILOPAN_MAX_FALLOS_AC:-3}" ]; then
    # BUG REAL (3-ago-2026, primer AC de Ola 2 que el motor tocó): KILOPAN_MAX_FALLOS_AC
    # y MAX_SIN_AVANCE de watchdog.sh valen 3 los dos, y como siguiente_ac() vuelve a
    # elegir el MISMO AC hasta que quede atascado, sus 3 fallos consecutivos son SIEMPRE
    # también 3 fallos consecutivos para el watchdog. El salteo marcaba el AC y el motor
    # se pausaba en la misma vuelta de todos modos — la señal de «tengo un plan, sigo con
    # el próximo» nunca llegaba a distinguirse de «no sé qué hacer». Salió a la luz recién
    # ahora porque hasta hoy ningún AC real había fallado 3 veces seguidas sin que ADEMÁS
    # se cayera algo de infra (rc 3) o hubiera otro builder (rc 7) de por medio.
    #
    # exit 9 = «acabo de marcar ESTE AC como atascado» — es progreso estructural (el motor
    # ya sabe qué va a intentar distinto la próxima vuelta), no lo mismo que «no sé qué
    # hacer». watchdog.sh lo trata como tal: resetea su contador global en vez de sumarlo.
    ya_estaba="$(esta_atascado "$AC_ID" && echo si || echo no)"
    [ "$ya_estaba" = "no" ] && echo "$AC_ID" >> "$ATASCADOS"
    echo "loop: ${AC_ID} ATASCADO tras $fallos_ac intentos — sigo con el siguiente AC. Queda abierto y anotado en $ATASCADOS para revisión humana."
    [ "$ya_estaba" = "no" ] && exit 9
  fi
  exit 1
fi
