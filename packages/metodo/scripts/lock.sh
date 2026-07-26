#!/usr/bin/env bash
# lock.sh — UN solo builder por worktree, garantizado (casilla 15 del prevuelo).
#
# Uso:
#   bash lock.sh tomar <nombre>   # exit 0 tomado · 7 ya hay otro vivo
#   bash lock.sh soltar <nombre>
#   bash lock.sh estado <nombre>
#
# Exclusión por `mkdir`, que es atómico en POSIX: dos procesos que corren a la vez, uno
# solo gana. Un archivo con `[ -f ]` + `touch` NO sirve — entre el test y el touch cabe
# el otro proceso, y ese hueco es justo el que aparece cuando hay carrera de verdad.
#
# ROBO ATÓMICO DE HUÉRFANOS: si el dueño del lock ya no existe (crash, kill -9, reinicio),
# el lock queda para siempre y nadie vuelve a construir. Se roba, pero verificando el PID
# y renombrando de forma atómica: dos ladrones simultáneos, uno solo se lo lleva.
#
# POR QUÉ EXISTE: el 26-jul-2026 dos sesiones construían KiloPan en el mismo worktree a la
# vez. eauto-crm-next tenía el manejo de `rc 7` en watchdog.sh pero NADA lo emitía nunca —
# el guard estaba declarado y no existía. Un guard que jamás dispara es indistinguible de
# uno roto (cap. 14).
set -uo pipefail
cd "$(dirname "$0")/../../.."

ACCION="${1:-estado}"
NOMBRE="${2:-builder}"
DIR_LOCK=".metodo-locks/${NOMBRE}.lock"
ARCH_PID="${DIR_LOCK}/pid"

mkdir -p .metodo-locks

vivo () { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

leer_pid () { cat "$ARCH_PID" 2>/dev/null | tr -dc 0-9; }

case "$ACCION" in
  tomar)
    # 1) intento limpio: mkdir gana o falla, atómicamente
    if mkdir "$DIR_LOCK" 2>/dev/null; then
      echo $$ > "$ARCH_PID"
      echo "lock[$NOMBRE]: TOMADO por pid $$"
      exit 0
    fi

    # 2) ocupado: ¿el dueño sigue vivo?
    duenio="$(leer_pid)"
    if vivo "$duenio"; then
      echo "lock[$NOMBRE]: OCUPADO por pid $duenio (vivo) — no arranco" >&2
      exit 7
    fi

    # 3) huérfano: robo atómico. `mv` de un directorio dentro del mismo FS es atómico,
    #    así que dos ladrones a la vez ⇒ uno solo consigue mover el original.
    tumba=".metodo-locks/.huerfano.$$.$(od -An -N2 -tu2 </dev/urandom | tr -d ' ')"
    if mv "$DIR_LOCK" "$tumba" 2>/dev/null; then
      rm -rf "$tumba"
      if mkdir "$DIR_LOCK" 2>/dev/null; then
        echo $$ > "$ARCH_PID"
        echo "lock[$NOMBRE]: ROBADO a huérfano pid ${duenio:-?} — TOMADO por pid $$"
        exit 0
      fi
    fi
    # otro ladrón fue más rápido, o el dueño revivió entre medio
    echo "lock[$NOMBRE]: OCUPADO (perdí la carrera del robo) — no arranco" >&2
    exit 7
    ;;

  soltar)
    duenio="$(leer_pid)"
    if [ -d "$DIR_LOCK" ] && [ -n "$duenio" ] && [ "$duenio" != "$$" ] && vivo "$duenio"; then
      echo "lock[$NOMBRE]: NO suelto — es de pid $duenio, no mío ($$)" >&2
      exit 1
    fi
    rm -rf "$DIR_LOCK"
    echo "lock[$NOMBRE]: soltado"
    exit 0
    ;;

  estado)
    if [ ! -d "$DIR_LOCK" ]; then echo "lock[$NOMBRE]: libre"; exit 0; fi
    duenio="$(leer_pid)"
    if vivo "$duenio"; then echo "lock[$NOMBRE]: tomado por pid $duenio (vivo)"; exit 7
    else echo "lock[$NOMBRE]: huérfano de pid ${duenio:-?} (robable)"; exit 0; fi
    ;;

  *) echo "uso: lock.sh tomar|soltar|estado <nombre>" >&2; exit 2 ;;
esac
