# HANDOFF — Ola 1 cerrada, motor autónomo encendido, supervisar Olas 2-4

Traspaso por límite de sesión (~4h35m), no por bloqueo. Todo lo importante ya quedó en
`docs/BITACORA.md` (entrada **"2026-08-02 · Ola 1 CERRADA — motor autónomo encendido,
Olas 2-4 en marcha"** y las tres anteriores del mismo día) — esto es el resumen operativo
para arrancar sin releer todo.

## Estado exacto

- **Ola 1 de `docs/PROMPT_CORRECTIVO.md` está CERRADA.** Las 4 condiciones de §9.4
  verificadas: gate 0 saltados, 5 mutantes Anexo B en rojo (`campana.mjs --had` 100%),
  CI verde en 3 commits distintos (`.github/workflows/gate.yml`, corridas #8/#9/#10),
  `lock.sh` exit 7.
- **`com.kilopan.ralph-loop` está CORRIENDO** (verificar con
  `launchctl list | grep kilopan` — un PID numérico = vivo). Arranca en
  `/Users/alexismacmini/kilopan-monorepo` (repo principal, rama `main` — NO el
  worktree de esta sesión). Trabajando el backlog de 43 ACs abiertos (P0-P2, la mayoría
  de la auditoría Anexo D de esta misma sesión).
- **`com.eauto.ralph-loop` está DETENIDO** por decisión explícita de Alexis (priorizar
  KiloPan). Se pausó con su propio mecanismo (`~/.eauto-ralph/PAUSED-FOR-REVIEW`), no
  con un kill. **Si Alexis pide retomar eauto:** borrar ese archivo marker y
  `launchctl kickstart -k gui/$(id -u)/com.eauto.ralph-loop` — pero eso vuelve a violar
  "un solo motor a la vez" mientras KiloPan siga corriendo, así que primero hay que
  detener `com.kilopan.ralph-loop` (`launchctl bootout gui/$(id -u)/com.kilopan.ralph-loop`).
  No hacer esto sin que Alexis lo pida explícitamente.

## Lo que NO está resuelto (encontrado al cerrar esta sesión, no arreglado por falta de tiempo)

1. **`loop.sh` comitea localmente, nunca empuja.** El trabajo del motor no llega a
   `origin/main` ni a CI por sí solo. Alguien tiene que revisar
   `git -C ~/kilopan-monorepo log` periódicamente, confirmar que el gate sigue verde
   (el propio `watchdog.sh` ya lo re-verifica de forma independiente tras cada commit —
   ver su código, aborta si no da verde) y `git push origin main` lo acumulado. Sin esto
   los "3 commits verdes" no se van a seguir dando solos.
2. **Ola 2 (pantalla "Arreglar", reparación de datos históricos con firma de la dueña)
   no tiene NINGÚN AC escrito todavía** — ni en `IMPLEMENTATION_PLAN.md` ni en
   `specs/kilopan/*.md`. El motor va a agotar el backlog actual (43 ACs, ninguno es Ola
   2 propiamente) antes de necesitar esto, pero alguien —una sesión, no el motor, que
   solo construye— tiene que traducir `docs/PROMPT_CORRECTIVO.md` §4/§5 en ACs
   concretos con su spec antes de que el motor pueda tocar Ola 2 de verdad.
3. **Migraciones (0016 en adelante) son de sesión supervisada, siempre** — el motor
   nunca las escribe ni las aplica (`docs/PROMPT_CORRECTIVO.md` §7). Si algún AC del
   backlog actual o de Ola 2/3 las necesita, el motor lo va a dejar marcado y saltar al
   siguiente — revisar el panel para verlos.
4. **Los dos gestos del dueño siguen abiertos** (no tocados esta sesión, ya venían de
   antes): rotar la credencial de Postgres de producción (G1), activar branch
   protection en GitHub (G2).

## Verificación rápida al retomar

```bash
launchctl list | grep kilopan                                    # PID vivo esperado
tail -30 ~/kilopan-monorepo/packages/metodo/panel/launchd-loop.out.log
git -C ~/kilopan-monorepo log --oneline -10                      # qué comiteó el motor
git -C ~/kilopan-monorepo status --short                         # ¿limpio?
node ~/kilopan-monorepo/packages/metodo/scripts/campana.mjs --had  # sigue 100%?
```

## Prompt de arranque de la sesión siguiente

> Retoma en `~/kilopan-monorepo` (repo principal, no un worktree de agente). Lee
> `docs/HANDOFF.md` completo primero. Ola 1 de `docs/PROMPT_CORRECTIVO.md` está cerrada
> y `com.kilopan.ralph-loop` debería estar corriendo — verifícalo con los comandos de la
> sección "Verificación rápida". Si está vivo y avanzando: supervísalo (revisa que el
> gate siga verde, empuja lo acumulado a `origin/main` periódicamente para que CI lo
> confirme — el motor no empuja solo). Si está muerto o atascado: diagnostica con
> `packages/metodo/panel/watchdog.log` antes de reintentar, no relances a ciegas. Cuando
> el backlog actual de 43 ACs esté cerca de agotarse, o si Alexis lo pide antes: arma la
> sesión de planificación que traduce Ola 2 (`docs/PROMPT_CORRECTIVO.md` §4/§5 —
> pantalla "Arreglar", reparación de datos históricos) en ACs concretos con su spec en
> `specs/kilopan/`, porque el motor construye pero no planifica y hoy no hay ningún AC
> de Ola 2 escrito. Arma tu propio despertador de continuidad (~4h35m) apenas empieces
> trabajo largo, como dice `CLAUDE.md`.
