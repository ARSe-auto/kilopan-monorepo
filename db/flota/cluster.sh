#!/usr/bin/env bash
# Cluster Postgres local de FLOTA — desarrollo y CI de `apps/flota`.
#
# POR QUÉ UN CLUSTER PROPIO Y NO EL DE NADIE MÁS
# ----------------------------------------------
# El §4.1 del maestro exige cosas que PGlite (lo que usa KiloPan) no puede dar por
# construcción: `CREATE DATABASE … TEMPLATE`, una BD por tenant, roles `app_t_<slug>` con
# CONNECT solo a SU BD, y `uuidv7()` nativo (PostgreSQL ≥ 18). Hace falta un servidor real.
#
# En este Mac ya hay uno: Postgres.app 18.4 sirviendo el cluster de **eauto** en el 54329
# (docs/CONTRATO_PUERTOS.md). Ese cluster NO se toca — regla «una sesión, un proyecto».
# Lo que se reutiliza son los BINARIOS (lectura pura); los datos, el puerto y los roles son
# nuestros: PGDATA propio, puerto 54331, y ni una fila compartida.
#
# El cluster es UNO para todos los worktrees, igual que el puerto 3301 del e2e de KiloPan:
# el recurso se comparte, así que quien lo consume toma el lock (ver check.sh).
#
# Uso:  bash db/flota/cluster.sh {iniciar|parar|estado|psql|destruir}
set -uo pipefail

FLOTA_PG_HOME="${FLOTA_PG_HOME:-$HOME/.flota-pg}"
PGDATA="$FLOTA_PG_HOME/var-18"
SHAREDIR="$FLOTA_PG_HOME/share"   # `extension_control_path` busca <elemento>/extension/<ext>.control,
EXTDIR="$SHAREDIR/extension"      # o sea el elemento es un «sharedir», no el directorio de extensiones.
SOCKDIR="$FLOTA_PG_HOME/sock"   # corto a propósito: el socket unix de Postgres no admite
                                # rutas de más de 103 bytes y el scratchpad las excede.
PUERTO="${FLOTA_PG_PUERTO:-54331}"
SUPER="flota_admin"
LOG="$FLOTA_PG_HOME/postgres.log"

# Binarios: Postgres.app por defecto, sobreescribible para CI en otra máquina.
PGBIN="${FLOTA_PG_BIN:-/Users/alexismacmini/apps/Postgres.app/Contents/Versions/18/bin}"

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"

morir () { echo "cluster.sh: $1" >&2; exit "${2:-1}"; }

[ -x "$PGBIN/pg_ctl" ] || morir "no encuentro los binarios de PostgreSQL 18 en $PGBIN.
  Instalá Postgres.app 18 o exportá FLOTA_PG_BIN apuntando a su bin/." 3

version_mayor () { "$PGBIN/postgres" --version | sed -E 's/.* ([0-9]+)\..*/\1/'; }

esta_arriba () { "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" >/dev/null 2>&1; }

sembrar_extensiones () {
  # pgTAP vendorizado en el repo, copiado a un directorio del CLUSTER (no de un worktree):
  # el cluster lo comparten todos los worktrees y no puede depender de la ruta de ninguno.
  mkdir -p "$EXTDIR"
  if [ -d "$RAIZ/vendor/pgtap" ]; then
    cp -f "$RAIZ"/vendor/pgtap/pgtap.control "$RAIZ"/vendor/pgtap/pgtap--*.sql "$EXTDIR/" 2>/dev/null || true
  fi
}

iniciar () {
  mkdir -p "$FLOTA_PG_HOME" "$SOCKDIR"
  local mayor; mayor="$(version_mayor)"
  [ "$mayor" -ge 18 ] || morir "PostgreSQL $mayor: el §0 exige uuidv7() nativo, que llegó en 18." 3

  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "cluster.sh: initdb en $PGDATA (PostgreSQL $mayor)"
    # ICU con es-CL: el locale del sistema es_CL.UTF-8 no existe en macOS, pero el
    # ordenamiento es-CL sí importa (listados de destinos, comunas, nombres).
    "$PGBIN/initdb" -D "$PGDATA" -U "$SUPER" --encoding=UTF8 \
      --locale-provider=icu --icu-locale=es-CL --locale=C >"$FLOTA_PG_HOME/initdb.log" 2>&1 \
      || { tail -20 "$FLOTA_PG_HOME/initdb.log"; morir "initdb falló" 3; }
  fi

  sembrar_extensiones

  if esta_arriba; then
    echo "cluster.sh: ya estaba arriba en 127.0.0.1:$PUERTO"
  else
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -w -t 30 \
      -o "-p $PUERTO -k $SOCKDIR -c listen_addresses=127.0.0.1" \
      start >/dev/null 2>&1 || { tail -20 "$LOG"; morir "no arrancó — ver $LOG" 3; }
    esta_arriba || { tail -20 "$LOG"; morir "arrancó pero no acepta conexiones" 3; }
    echo "cluster.sh: arriba en 127.0.0.1:$PUERTO (PGDATA=$PGDATA)"
  fi
  # `extension_control_path` (PostgreSQL ≥18) deja usar pgTAP sin escribir dentro del
  # bundle de Postgres.app, que es una instalación COMPARTIDA con el cluster de eauto.
  # Va por ALTER SYSTEM y no por la línea de comandos: en la línea de comandos el `$system`
  # se lo come el shell y el catálogo queda sin el directorio del sistema.
  local actual esperado
  esperado="$SHAREDIR:\$system"
  actual="$("$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" -d postgres -tAc \
            "show extension_control_path" 2>/dev/null)"
  if [ "$actual" != "$esperado" ]; then
    "$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" -d postgres -tAc \
      "alter system set extension_control_path = '$esperado'" >/dev/null 2>&1
    "$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" -d postgres -tAc \
      "select pg_reload_conf()" >/dev/null 2>&1
  fi
}

parar () {
  if esta_arriba; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 && echo "cluster.sh: detenido"
  else
    echo "cluster.sh: no estaba corriendo"
  fi
}

estado () {
  if esta_arriba; then
    echo "arriba  127.0.0.1:$PUERTO  PGDATA=$PGDATA"
    "$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" -d postgres -tAc \
      "select 'bases: '||string_agg(datname, ', ' order by datname) from pg_database where not datistemplate"
  else
    echo "abajo   (127.0.0.1:$PUERTO)"
    exit 1
  fi
}

destruir () {
  # Solo para rehacer el cluster de desarrollo desde cero. Jamás corre en el gate.
  parar
  [ -d "$PGDATA" ] && mv "$PGDATA" "$PGDATA.borrado-$(date +%Y%m%d-%H%M%S)"
  echo "cluster.sh: PGDATA movido a un lado (no se borra nada en firme)"
}

case "${1:-estado}" in
  iniciar)  iniciar ;;
  parar)    parar ;;
  estado)   estado ;;
  psql)     shift; exec "$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO" -U "$SUPER" -d "${1:-postgres}" ;;
  destruir) destruir ;;
  *) morir "uso: cluster.sh {iniciar|parar|estado|psql [bd]|destruir}" 2 ;;
esac
