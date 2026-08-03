# HANDOFF — motor autónomo funcionando por primera vez, Ola 2 planificada

Traspaso por límite de sesión, no por bloqueo. Todo lo importante está en `docs/BITACORA.md`
(entradas del 2-ago noche y 3-ago madrugada). Esto es el resumen operativo.

## Lo que cambió en esta sesión

**El motor NUNCA había cerrado un AC por sí mismo.** No era lentitud: era imposible. Ocho
defectos, de los cuales uno era mortal y los otros siete lo disfrazaban de «AC difícil».

1. `loop.sh` heredaba el árbol sucio de la iteración fallida anterior → el gate arrancaba
   rojo por código ajeno y no podía dar verde jamás. Ahora se guarda en `git stash`.
2. `watchdog.sh` salía con `exit 1` en aborts que decían «NO reintentar solo», y
   `KeepAlive` lo resucitaba a los 120 s, en bucle infinito quemando US$3 por vuelta.
   Ahora escribe `panel/PAUSA-REVISION` y sale con 0.
3. `siguiente_ac()` usaba `grep -m1`: un AC imposible tapaba a todos los de atrás. Ahora
   hay lista de atascados (`panel/acs-atascados.txt`).
4. `.ralph/build-fails` no lo escribía nadie: la escalación a Opus era código muerto.
5. **EL MORTAL:** `AGENTS.md` manda verificar `ps aux | grep loop.sh` antes de construir, y
   el agente encontraba SIEMPRE al `loop.sh` que lo había lanzado a él. Se negaba a
   construir y preguntaba al vacío bajo `claude -p`. Arreglado en AGENTS.md y en el prompt.
6. Las pruebas del selector de modelo no eran herméticas y además BORRABAN el contador.
7. El agente podía editar pero **no ejecutar**: `acceptEdits` no cubre Bash, así que no
   podía correr `check.sh` y —obedeciendo su regla— no comiteaba. Lista blanca acotada en
   `.claude/settings.json` (decisión de Alexis: no `bypassPermissions`).
8. Mi propia suite podía **pausar el motor de producción**: escribía `PAUSA-REVISION` en el
   panel vivo. `KILOPAN_PANEL_DIR` lo redirige; se afirma por mtime que el vivo no se toca.

**Bug de producto encontrado de paso:** `db/migrar.mjs` no fijaba la zona horaria, así que
migraciones y semilla escribían `current_date` en la zona del proceso. En CI (UTC) eso es
el día de MAÑANA entre las 20:00 y las 24:00 de Chile → `pan.precios.vigente_desde` en el
futuro → producto sin precio → tres tests de venta en rojo todas las noches. Arreglado en
`conectar()` para ambas ramas, con guard probado en negativo.

## Estado ahora

- **Motor:** verificar con `launchctl list | grep kilopan`. Cerró `AC-ID-03` solo, con gate
  independiente verde, y publicó. Si está detenido, encender con:
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kilopan.ralph-loop.plist`
- **Autonomía:** el watchdog publica lo verificado (`empujar-si-verde.sh`, solo si
  `last-green.sha == HEAD`), el plist lo relanza cada 30 min (`StartInterval`) y sin
  trabajo sale con DONE. Un ABORT real escribe `PAUSA-REVISION` y **frena todo arranque
  posterior** hasta que una persona lo borre — mirar ese archivo PRIMERO si no avanza.
- **Backlog:** 54 ACs abiertos (41 de deuda de Ola 1 + 13 de Ola 2 recién escritos).
- **Fuera del motor** (`panel/acs-atascados.txt`): `AC-SEC-05` (migrar el secreto de
  dispositivo a IndexedDB; trabajo al 80% en un stash, ver abajo) y `AC-ADM-11` (reparación
  de datos históricos con informe firmado por la dueña — §7, sesión supervisada).

## Verificación rápida al retomar

```bash
launchctl list | grep kilopan
cat ~/kilopan-monorepo/packages/metodo/panel/PAUSA-REVISION 2>/dev/null   # si existe, está frenado A PROPÓSITO
tail -40 ~/kilopan-monorepo/packages/metodo/panel/watchdog.log
git -C ~/kilopan-monorepo log origin/main..HEAD --oneline                 # ¿quedó algo sin publicar?
git -C ~/kilopan-monorepo stash list                                      # trabajo guardado del motor
```

## Lo que NO está resuelto

1. **`AC-SEC-05`** exige migrar el secreto de dispositivo de `localStorage` a IndexedDB, lo
   que vuelve asíncrona una API que consumen 3 páginas y 6 specs e2e. El trabajo del motor
   está bueno y guardado en un `git stash` (buscar «AC-SEC-05 wip»). Es de sesión
   supervisada; terminarlo y quitarlo de `acs-atascados.txt`.
2. **CI hay que confirmarlo a mano**: no hay `gh` ni `brew` en la máquina. El repo es
   público, así que sirve
   `curl -s "https://api.github.com/repos/ARSe-auto/kilopan-monorepo/actions/runs?per_page=5"`.
3. **Los dos gestos del dueño siguen abiertos**: rotar la credencial de Postgres de
   producción (G1) y activar branch protection en GitHub (G2).
4. **Olas 3 y 4 no tienen ACs escritos.** Mismo trabajo que se hizo con Ola 2 hoy: el motor
   construye pero no planifica. Hacerlo antes de que se agoten los 54.

## Prompt de arranque de la sesión siguiente

> Retoma en `~/kilopan-monorepo` (repo principal, no un worktree). Lee `docs/HANDOFF.md`.
> El motor autónomo funciona por primera vez y publica solo lo que el gate independiente
> verifica. Verificá su estado con los comandos de «Verificación rápida»; si hay
> `PAUSA-REVISION`, LEELO antes de nada: está frenado a propósito y dice por qué. Si avanza,
> supervisá y confirmá CI por la API de GitHub (no hay `gh` instalado). Cuando el backlog de
> 54 se acerque a agotarse, traducí Olas 3 y 4 de `docs/PROMPT_CORRECTIVO.md` a ACs con su
> spec, igual que se hizo con Ola 2. Pendiente de sesión supervisada: `AC-SEC-05` (su
> trabajo al 80% está en un `git stash`). Armá tu despertador de continuidad (~4h35m).
> Regla dura de Alexis: **no supongas nada, comprobá siempre y mostrá la evidencia.**
