# launchd — el motor sobrevive a sesión, terminal y reinicio

Casilla 14 del prevuelo. Sin esto, el motor muere al cerrar el portátil o la terminal, y
«construir de noche» depende de que nadie toque nada.

## Estado: CARGADO desde el 26-jul-2026 (casilla 14 cerrada)

El motor de KiloPan corre bajo launchd y sobrevive a la sesión, la terminal y el reinicio.
Comprobar con `launchctl list | grep kilopan`: un pid numérico = corriendo.

Sigue vigente que §8 del maestro fija **un solo motor OAuth a la vez**, y el Anexo C el
orden *KiloPan hasta DONE → extracción a `nucleo-*` → `apps/flota`*. Al cargarlo, el motor
de `eauto-crm-next` seguía andando —arrancado a mano, ver abajo— y los dos comparten la
misma credencial. Apagar uno es decisión del dueño, no del arnés.

## Dos cosas que costaron caro y no son obvias

**1. El repo NO puede vivir en `~/Documents`.** macOS (TCC) le niega a los agentes de
launchd el acceso a `~/Documents`, `~/Desktop` y `~/Downloads`. Con el repo ahí, el agente
cargaba «bien» —`launchctl list` mostraba pid y estado 0— y moría al instante con
`Operation not permitted` en el stderr, sin una sola línea de stdout. Por eso el repo se
movió a `~/kilopan-monorepo`. **No lo devuelvas a Documents.**

**2. La credencial va por `CLAUDE_CODE_OAUTH_TOKEN`**, que es la variable que `claude` lee
de verdad. El token lo genera `claude setup-token`, se guarda en `~/.claude-oauth-token`
(permisos 600) y el plist lo lee **en tiempo de ejecución**, nunca copiado adentro, para
que este archivo se pueda versionar sin filtrar un secreto. La primera versión inventó una
variable inexistente (`CLAUDE_CODE_OAUTH_TOKEN_FILE`) y el motor moría en cada iteración
con «Not logged in · Please run /login». **El síntoma engañaba:** el gate corría VERDE, el
loop elegía su AC, y recién ahí fallaba — parecía cosa del builder y era de la credencial.

**No tomes `com.eauto.ralph-loop` como modelo.** Figura cargado pero con pid `-`, o sea
que NO corre; el motor de eauto que sí avanza se arrancó a mano desde una terminal,
heredando una sesión ya autenticada. Hasta ahora ningún agente de launchd de esta máquina
se había autenticado nunca: el precedente que parecía probado no lo estaba.

## Instalar

Los plists usan marcadores porque launchd no expande variables ni rutas relativas:

```bash
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"
for p in packages/metodo/launchd/*.plist; do
  sed -e "s|REEMPLAZAR_RAIZ|$RAIZ|g" -e "s|REEMPLAZAR_HOME|$HOME|g" \
      "$p" > "$HOME/Library/LaunchAgents/$(basename "$p")"
done
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.kilopan.ralph-loop.plist"
```

## Verificar que quedó vivo

```bash
launchctl list | grep kilopan          # PID en la 1ª columna = corriendo
tail -f packages/metodo/panel/watchdog.log
```

Si aparece `-` en vez de un PID y un código en la 2ª columna, arrancó y murió: leer
`packages/metodo/panel/launchd-loop.err.log`. La causa más frecuente es el PATH — el de
launchd **no** es el de tu terminal, y `watchdog.sh` aborta si `claude` o `pnpm` no
resuelven. Ese chequeo no es cosmético: así se perdieron ~15 h en eauto-crm-next.

## Detener

```bash
launchctl bootout gui/$(id -u)/com.kilopan.ralph-loop
launchctl disable gui/$(id -u)/com.kilopan.ralph-loop   # que no reviva al reiniciar
```

## Las cuatro vidas de un cambio

Editar el plist cargado **no** basta. Todo cambio vive cuatro veces: la plantilla de este
directorio, la copia en `~/Library/LaunchAgents/`, el proceso en memoria (que no relee el
disco) y lo que sobreviva a un reinstall. En e-auto un fix anti-OOM se aplicó al plist
vivo pero no a la plantilla que lo reescribe, y el siguiente reinstall lo revirtió en
silencio. Arregla la plantilla, propaga, y **verifica con un método distinto** al que
produjo el cambio.
