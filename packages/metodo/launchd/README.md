# launchd — el motor sobrevive a sesión, terminal y reinicio

Casilla 14 del prevuelo. Sin esto, el motor muere al cerrar el portátil o la terminal, y
«construir de noche» depende de que nadie toque nada.

## ⚠️ Estos plists NO están cargados, a propósito

Cargarlos **arranca el builder autónomo de KiloPan**, que consume la ventana OAuth. Y esa
ventana es una sola: §8 del maestro fija **un solo motor OAuth a la vez**, y el Anexo C
fija el orden *KiloPan hasta DONE → extracción a `nucleo-*` → `apps/flota`*.

Al 26-jul-2026 el motor de `eauto-crm-next` está corriendo bajo su propio launchd. Cargar
este sin apagar aquel pone dos motores a competir por la misma ventana: ambos avanzan más
lento y el panel de consumo deja de significar nada.

**Decisión del dueño, no del arnés.** Por eso quedan escritos y sin cargar.

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
