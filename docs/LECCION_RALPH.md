# Lección aprendida: procesos vivos ≠ avance

En `eauto-crm-next`, tras migrar el entorno a este Mac, el CLI `claude` no estaba
instalado. El watchdog capturaba la salida con `2>&1` y solo buscaba patrones de error
de crédito/límite — el `command not found` de bash no matcheaba ninguno, así que el
chequeo de salud devolvía «sano» y el watchdog seguía relanzando el loop cada 5 minutos.
Resultado: ~15 horas de ciclos fallidos, 552 commits congelados, logs de build de 0
bytes. El reporte de esa sesión fue «el motor está codificando autónomamente» basado
solo en que los procesos (`watchdog.sh`, `loop.sh`, LaunchAgents) estaban vivos —
sobreafirmación.

**Regla para este repo:** ningún script ni ningún reporte declara avance sin verificar,
en este orden:

1. `git rev-list --count HEAD` subiendo desde la última medición.
2. `IMPLEMENTATION_PLAN.md` registrando un AC real cerrado (`grep -cE '^- \[x\]
   \(P[0-9]'`), no `iter-sin-ac` repetido.
3. `command -v claude` resolviendo dentro del **mismo entorno** en que corre el
   watchdog/cron/launchd — no en la terminal interactiva del operador, que puede tener
   un `PATH` distinto.
4. El log del último `check.sh --full` con timestamp reciente y salida real (no 0
   bytes).

El panel (`packages/metodo/panel/generar.mjs`) implementa esto explícitamente: el
número de commits y de ACs cerrados manda; el estado del proceso es, como mucho, una
alerta ámbar de apoyo, nunca la prueba.
