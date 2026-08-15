# HANDOFF — tres worktrees, dos motores vivos, uno aparcado (15-Aug-2026 16:19)

> **LO PRIMERO: hay DOS motores autónomos construyendo en paralelo**, cada uno con su worktree,
> su cluster de Postgres y su puerto de e2e. No compiten: el reparto de familias de ACs es
> explícito y está en los lanzadores de `~/bin/`. **138 de 199 ACs cerrados.**

## El mapa (verificar vivo con `ps -p <pid>` antes de afirmar nada)

| | motor 1 | motor 2 | motor 3 |
|---|---|---|---|
| worktree | `~/kilopan-monorepo-flota` | `~/kilopan-monorepo-flota2` | `~/kilopan-monorepo-flota3` |
| rama · HEAD | `flota/specs-e1` · 6dda969 | `flota/motor2` · 0f80a62 | `flota/motor3` · fcc2c18 |
| estado | VIVO (pid 27334) | VIVO (pid 43201) | **APARCADO — no arrancar sin leer abajo** |
| familias | todo salvo FMIG/FPOR | `^AC-FPOR-` (portabilidad) | `^AC-FMIG-` (migración) |
| Postgres | 54331 (`~/.flota-pg`) | 54332 (`~/.flota-pg-2`) | 54333 (`~/.flota-pg-3`, ARRIBA) |
| e2e | 3311 | 3312 | 3313 |
| lanzador | `arrancar-motor-flota.sh` (dentro del repo) | `~/bin/arrancar-motor2.sh` | `~/bin/arrancar-motor3.sh` |
| supervisor | `supervisor-flota.sh` vivo | `supervisor-flota2.sh` vivo | escrito, NO arrancado a propósito |

Los supervisores son procesos `nohup` desprendidos: sobreviven a las sesiones, relanzan su motor
al agotar la tanda, reanudan pausas con HEAD verde (máx 3) y ESPERAN sin tocar el marcador si la
pausa exige una persona. Bitácora de cada uno en `~/supervisor-flota*.log`.

## Por qué el motor 3 está aparcado, y el paso EXACTO que sigue

Su cluster (54333) está provisionado desde cero y VERDE en migraciones; su `check.sh --full` dio
verde en todo salvo **la suite de tenancy** (`db/flota/gate.sh --full`, paso «plantilla,
provisión ×2 y rezago»): «hay 1 conexión abierta contra tenant_template» al copiar la plantilla.
Lo ya DESCARTADO con evidencia, para no repetirlo: (a) no es concurrencia entre archivos — el
gate corre `--test-concurrency=1`; (b) no es el pool ocioso de la suite anterior — `crearBase`
ahora espera 12 s re-contando (commit fcc2c18 en `flota/motor3`) y falló igual; (c) el archivo
solo (`node --test db/flota/suite-bd/hechos.test.mjs`) pasa ENTERO; (d) tras el gate,
`pg_stat_activity` sobre 54333 muestra CERO conexiones a la plantilla. Conclusión: algo DEL
PROPIO GATE retiene la plantilla >12 s, solo visible bajo `--full` y de momento solo en ese
cluster. Hubo además un segundo FALLÓ en ese gate cuyo nombre no quedó capturado.
**Siguiente paso concreto:** correr `gate.sh --full` con un vigía que muestree
`select pid, usename, application_name, state, query from pg_stat_activity where
datname='tenant_template'` cada segundo en el 54333 — eso nombra al que la retiene — y leer los
DOS «FALLÓ:» completos del gate. Con eso arrancarlo: `bash ~/bin/arrancar-motor3.sh` y
`nohup ~/bin/supervisor-flota3.sh &`.

## Deudas y reglas de convivencia (las que ya costaron trabajo esta semana)

- **Comitear SIEMPRE `git commit -F <msg> -- <rutas>`** y mirar `git diff --cached --name-only`
  antes: el índice es compartido y `git add <ruta>` NO protege (memoria
  `git-commit-por-ruta-no-basta-el-add`). No usar `git add -A`.
- **El motor 2 corre con el filtro VIEJO en memoria** (`^AC-(FMIG|FPOR)-`). Su lanzador ya dice
  `^AC-FPOR-`, así que se corrige SOLO cuando el supervisor lo relance al agotar la tanda. Solo
  urge si va a agotar los 17 FPOR dentro de la tanda actual — vigilar, no matar en vuelo.
- **No empujar a mano las ramas `flota/motor2`/`flota/motor3`**: cada push dispara el CI (correo
  si rojo). El watchdog de cada motor publica solo lo verificado. Los merges hacia
  `flota/specs-e1` los hace una persona, con los DOS motores en límite de iteración; la fricción
  esperada es `IMPLEMENTATION_PLAN_flota.md` y las specs (los tres marcan `[x]`).
- **El CI NO corre el e2e de FLOTA** (verificado bajando el artefacto: solo suites de KiloPan,
  cero menciones del cluster). Las 498 pruebas son reproducibles desde cero — quedó demostrado
  hoy con el cluster 2 — así que agregar el job de FLOTA al workflow ya es POSIBLE; es el
  backlog de arnés más valioso que queda.
- **El plist de launchd sigue sin cargar** (`launchctl` denegado): el arranque tras REINICIO de
  la máquina depende de que alguien corra los lanzadores. Pedirle el sí a Alexis en una línea.
- Gasto: dos motores ≈ el doble de tokens/hora. Con el 3, el triple.

## Cómo verificar el estado en 30 segundos

```
for n in "" 2 3; do W=~/kilopan-monorepo-flota$n; P=$(cat $W/packages/metodo/panel/motor-flota.pid 2>/dev/null); \
  echo "motor ${n:-1}: $(ps -p $P >/dev/null 2>&1 && echo VIVO || echo muerto) · $(cd $W && git log --oneline -1)"; done
pgrep -fl supervisor-flota; tail -2 ~/supervisor-flota*.log
```

## Prompt de arranque de la sesión nueva

> Retomá la supervisión de la Plataforma FLOTA. Leé `~/kilopan-monorepo-flota/docs/HANDOFF.md`
> COMPLETO y archivalo en `docs/handoffs/` al absorberlo. Hay DOS motores autónomos vivos (sus
> supervisores desprendidos los relanzan solos) y un TERCERO aparcado con su diagnóstico y su
> próximo paso escritos arriba. Tu trabajo es el de supervisión: atender pausas (diagnóstico
> primero, el arnés miente menos que el AC), destrabar el motor 3, unir las ramas
> periódicamente, y NO construir a mano lo que los motores pueden construir. Armá tu despertador
> de 4h30m al arrancar. Reglas duras: un solo builder por worktree · lock `e2e-flota` antes de
> cualquier e2e manual · commits solo con `-F <msg> -- <rutas>` · nada sin verificar se publica.
