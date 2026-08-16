# HANDOFF — tres motores vivos y construyendo (15-Ago-2026 22:55)

> **Arrancá con Fable 5 y esfuerzo max** (pedido explícito de Alexis a las 16:45).
>
> **LO PRIMERO: los TRES motores están VIVOS y sanos.** Nada que destrabar al arrancar.
> El motor 3, que el traspaso anterior dejó aparcado, lleva construyendo desde las 16:41.
> **162 de 203 ACs cerrados · faltan 41.**
>
> Los tres worktrees tienen archivos sin comitear: es el WIP de los agentes en su AC actual,
> **no lo commitees vos** — lo cierra cada motor con su propio commit al terminar.

## El mapa (verificar vivo antes de afirmar nada)

| | motor 1 | motor 2 | motor 3 |
|---|---|---|---|
| worktree | `~/kilopan-monorepo-flota` | `~/kilopan-monorepo-flota2` | `~/kilopan-monorepo-flota3` |
| rama | `flota/specs-e1` | `flota/motor2` (+22) | `flota/motor3` (+20) |
| familias | `^AC-(FIDN\|FPOD\|FRUT\|FSEM\|FTAR\|FTEN\|FVEH)-` | `^AC-FPOR-` | `^AC-FMIG-` |
| faltan | **19** | **8** | **14** |
| Postgres | 54331 (`~/.flota-pg`) | 54332 (`~/.flota-pg-2`) | 54333 (`~/.flota-pg-3`) |
| e2e | 3311 | 3312 | 3313 |
| lanzador | `~/bin/arrancar-motor1.sh` | `~/bin/arrancar-motor2.sh` | `~/bin/arrancar-motor3.sh` |

Los tres supervisores son `nohup` desprendidos (`~/bin/supervisor-flota*.sh`, logs en
`~/supervisor-flota*.log`): sobreviven a las sesiones y relanzan su motor al agotar la tanda.
Verificación en 30 s:

```
for n in "" 2 3; do W=~/kilopan-monorepo-flota$n; P=$(cat $W/packages/metodo/panel/motor-flota.pid 2>/dev/null); \
  echo "motor ${n:-1}: $(ps -p $P >/dev/null 2>&1 && echo VIVO || echo muerto) · pausa: $(ls $W/packages/metodo/panel/ | grep -i pausa || echo no)"; done
pgrep -fl supervisor-flota
```

## Lo que se resolvió hoy (no repetir el diagnóstico)

**1. El motor 3 estaba aparcado por DOS defectos del arnés, ninguno del AC.** La «conexión
fantasma a tenant_template» del traspaso anterior YA NO EXISTE: el vigía sobre
`pg_stat_activity` la nombró — era el pool ocioso de `pg` (idle, muere sola a los ~12 s), y
fcc2c18 (`crearBase` espera 12 s) es el antídoto, ya en las tres ramas. El fallo REAL era que
**el gate se envenenaba a sí mismo**: las limpiezas dropeaban la base pero dejaban la fila en
`control.tenants`, el exportador de la corrida siguiente las nombraba como rezago y los
agregados bloqueaban por FK la limpieza de control.test. Verde sobre cluster limpio, rojo en la
que viene. Arreglado con `suite-bd/desregistrar.mjs` (baja completa) + paso de saneo en el gate
(`sanear-gate.mjs`). Commits ccf8aa7 (motor3) y 62aaa49 (motor2).

**2. El reparto de familias no protegía al motor 1.** `KILOPAN_FAMILIAS` es lista de
INCLUSIÓN (`loop.sh:92`) y el motor 1 corría SIN la variable: tomaba lo que fuera. Duplicó dos
ACs del motor 2 y se atascó en un tercero. Arreglado con `~/bin/arrancar-motor1.sh` (enumera
sus siete familias) + su supervisor apuntado ahí; verificado: tras relanzarse eligió AC-FIDN-13,
familia propia. **Si nace una familia nueva hay que agregarla a ese regex** — un motor que no la
reclama la deja sin construir, y eso no sale en ningún rojo.

**3. Las pausas legítimas de hoy fueron TODAS del gate de specs, y del mismo tipo: texto mal
formado, no código roto.** En las dos el AC estaba hecho y verde; lo que falló fue cómo quedó
escrito el ítem. Son baratas de arreglar y cuestan una pausa entera, así que **si vuelve a
pasar, revisá primero el texto del ítem antes de sospechar del código**:

- **20:12, motor 2** — «AC-FTEN-26 definido en dos specs». El id de un ítem es su ÚLTIMO
  corchete (`gate_specs.mjs:65`); ese ítem puso el suyo al principio y terminó con una CITA a
  `[AC-FTEN-26]`, que el gate leyó como segunda definición. Sin eso, dos ACs habrían compartido
  id y el conteo habría mentido (198 contados vs 199 definidos). Arreglado en `8bf8c94`.
- **22:16, motor 1** — «AC-FRUT-24 marcado [x] pero su texto dice "falta"». El AC estaba
  probado (migración 0070, pgTAP 11/11, e2e 22/22); las dos frases eran del DIAGNÓSTICO
  escritas en presente («hace falta marcarla», «lo que falta es que la dispare»), y así no se
  distinguen de trabajo pendiente. Pasadas a pasado en `f6feaf5` — ojo: «hacía falta» TAMBIÉN
  matchea el gate; hay que reformular («hubo que»), no solo conjugar.

**Proporción del día: 2 pausas del arnés, 2 del AC.** El diagnóstico primero sigue siendo
obligatorio, pero «siempre es el arnés» ya no es cierto. Vale evaluar que el prompt de build
advierta las dos reglas de redacción de arriba: se pagan con una tanda cortada cada vez.

## Deudas — lo que hay que hacer, en orden

**(a) DOS ACs duplicados a reconciliar en el merge.** Git los uniría SIN conflicto textual
(viven en archivos distintos) dejando dos implementaciones vivas del mismo criterio. Hay que
elegir UNA de cada par a conciencia:

| AC | lado specs-e1 (motor 1) | lado motor2 | qué difiere |
|---|---|---|---|
| FPOR-01 | `9404d41` | `e57ef76` | `altaTenant()` en `servidor/modo.ts` vs. el alta dentro de `provisionar()` |
| FPOR-02 | `e463f9b` | `da62e39` | centinela 11: barrido dinámico por `pg_class` vs. la versión del motor 2 |

**(b) El fix del gate quedó con dos formas**: `desalta()` (motor 2, en `provisionar.mjs`) y
`desregistrar.mjs` (motores 2 y 3). Unificar en el mismo merge.

**(c) Desbalance: el motor 2 termina ~4 h antes que el 1.** Cuando llegue a AC-FPOR-17,
pasarle una familia del motor 1 —FSEM o FPOD son las más separables— editando el regex de
`~/bin/arrancar-motor2.sh` Y quitándola de `~/bin/arrancar-motor1.sh`; toma efecto al
relanzarse. Sin eso quedará ocioso mientras el 1 sigue ~4 h más.

**(d) El job `gate-flota` del CI está escrito y comiteado, sin publicar.** Rama local
`ci/gate-flota` (`acbf99b`): instala PostgreSQL 18 del PGDG, provisiona el cluster desde cero y
corre `db/flota/gate.sh --full`. Hoy el CI **no** ejerce nada de FLOTA. Falta un `git push`
—denegado en la sesión anterior— y el token de `gh` no tiene scope `workflow`. Pedirle el sí a
Alexis en una línea.

**(e) El plist de launchd sigue sin cargar**: tras un REINICIO de la máquina los motores no
arrancan solos. `launchctl` está denegado en el arnés; pedirle el sí.

## Reglas duras de convivencia

- **Commits SOLO con `git commit -F <msg> -- <rutas>`** y mirar `git diff --cached --name-only`
  antes: el índice es compartido y `git add <ruta>` NO protege. Jamás `git add -A`.
- **Un builder por worktree.** Antes de tocar un worktree, verificar que su motor está muerto.
  Editar el repo de un builder activo es pedirle que commitee tu cambio mezclado con su AC —
  por eso los lanzadores viven en `~/bin` y no en el árbol.
- **No empujar a mano `flota/motor2` / `flota/motor3`**: el watchdog de cada motor publica solo
  lo verificado, y cada push dispara el CI.
- **Lock `e2e-flota`** antes de cualquier e2e manual.
- **Diagnóstico antes de reconstruir**: hoy, 2 pausas del arnés y 2 del AC (detalle arriba).
  Ninguna se resolvió reconstruyendo: las cuatro se arreglaron leyendo el fallo exacto.
- Gasto: tres motores ≈ el triple de tokens/hora. La máquina no es el límite (SoC ~55 °C,
  carga ~3,8 en un M4): el límite es la cuota.

## Permiso levantado en la sesión anterior

`Bash(kill *)` estaba en el `deny` del sobre versionado (`.claude/settings.json`) y **deny gana
sobre allow**, así que un `settings.local.json` no alcanza: hay que quitar la línea del deny.
Se levantó SOLO en el worktree de la sesión de supervisión, con el sí explícito de Alexis; el
archivo que gobierna a los motores queda intacto y ellos siguen sin poder tocar procesos.

## Prompt de arranque de la sesión nueva

> Retomá la supervisión de la Plataforma FLOTA en el Mac Mini, **con Fable 5 y esfuerzo max**.
> Leé `~/kilopan-monorepo-flota/docs/HANDOFF.md` COMPLETO y archivalo en `docs/handoffs/` al
> absorberlo. Los TRES motores están vivos y sanos con sus supervisores desprendidos: tu trabajo
> es supervisión, no construcción — atender pausas (diagnóstico primero: el arnés falla más que
> los ACs), unir ramas periódicamente reconciliando A MANO los dos ACs duplicados que el HANDOFF
> nombra con sus SHAs, vigilar el CI (`gh` vive en `~/.local/bin`; el detalle de un rojo está en
> el artefacto `gate-logs`) y repartirle familias al motor 2 cuando agote las suyas. Armá tu
> despertador de 4h30m al arrancar y traspasá ~5 min antes del límite actualizando este mismo
> archivo. Reglas duras: un builder por worktree · lock `e2e-flota` antes de cualquier e2e
> manual · commits solo con `-F <msg> -- <rutas>` · nada sin verificar se publica.
