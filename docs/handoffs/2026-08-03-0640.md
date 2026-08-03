# HANDOFF — motor detenido a propósito, esperando la decisión de Alexis sobre una migración

Traspaso por límite de sesión. **Hay una decisión pendiente de Alexis, no solo un traspaso
técnico** — leé la sección siguiente antes que nada.

## LO MÁS URGENTE: migración escrita por el motor, sin supervisión, ya en `origin/main`

`AC-ADM-05` (anular una venta) cerró con `db/migraciones/0020_anular_venta.sql`.
`docs/PROMPT_CORRECTIVO.md` §7 lo prohíbe en letra grande: el motor autónomo JAMÁS escribe
en `db/migraciones/` — es de sesión supervisada, siempre. La regla nunca estaba
implementada como guardrail (arreglado esta sesión, ver abajo), y el motor la cruzó.

**El motor está DETENIDO a propósito** (`launchctl bootout`, no solo `PAUSA-REVISION`) —
NO relanzar hasta que Alexis decida qué hacer con la migración 0020. Le pregunté y eligió
"la reviso yo": mostrale el SQL completo (`db/migraciones/0020_anular_venta.sql`, ~30
líneas, aditiva, con reversión) y el AC que cierra
(`specs/kilopan/10-administracion.md`, buscar AC-ADM-05), y esperá su decisión:
- **Queda como está** → nada que hacer, solo confirmar con Alexis y relanzar.
- **Se ajusta** → sesión supervisada la corrige, gate, commit, y recién ahí relanzar.
- **Se revierte** → `git revert` del commit `4b4d59e` (AC-ADM-05), el AC vuelve a abierto,
  y OJO: ahora que el guardrail existe, si el motor lo vuelve a tomar y necesita
  migración otra vez, va a pausar con `rc 10` en vez de comitear — está bien, es lo que
  se espera. Marcarlo en `panel/acs-atascados.txt` mientras se decide cómo dárselo (a
  mano, o partiendo el AC en «schema, sesión supervisada» + «endpoint, el motor»).

## Lo que se arregló esta sesión (larga: cerró Ola 1, encendió el motor por primera vez,
## escribió y arrancó Ola 2, y encontró/corrigió 10 bugs reales)

Todo el detalle con evidencia está en `docs/BITACORA.md`, entradas del 2-ago noche y
3-ago madrugada. Resumen:

**El motor nunca había cerrado un AC solo hasta esta sesión.** Ocho defectos (uno
mortal: el agente se detectaba a sí mismo como builder rival — `AGENTS.md` + prompt de
`loop.sh`, arreglado) impedían cualquier avance. Arreglados todos, probados con
ejecución real (stubs de `rc`, clones descartables), no solo grep.

**Bug de producto:** migraciones y semilla no fijaban zona horaria — escribían el día de
MAÑANA en CI (UTC) entre las 20:00 y las 24:00 de Chile. Arreglado en `db/migrar.mjs`.

**Cadena autónoma cerrada:** el watchdog publica solo lo que el gate independiente
verifica (`empujar-si-verde.sh`, lee `last-green.sha` DEL DISCO — no hace falta
comitearlo, comitearlo aparte solo corre el `HEAD` un paso). El plist relanza cada 30 min
sin desarmar el freno real (`PAUSA-REVISION` sigue frenando todo arranque).

**Ola 2 planificada:** 13 ACs nuevos en `specs/kilopan/{10-administracion,09-plataforma-
miga,05-entrega-pod,03-venta-mostrador}.md`. §4 (modelo de datos) ya estaba hecho
(migraciones 0017/0018 existentes) — la reparación de datos históricos (`AC-ADM-11`) es
la única de sesión supervisada por diseño.

**El bug de esta madrugada, el más serio:** dos frenos con el mismo umbral (3) se
disparaban juntos, así que el salteo de ACs atascados nunca llegaba a probarse cuando UN
AC fallaba 3 veces — que es el caso normal. Arreglado con `rc 9` (loop.sh) distinguiendo
"AC saltado, progreso" de "no sé qué hacer". Y recién DESPUÉS de arreglar eso, el motor
cerró `AC-ADM-05` con la migración prohibida — ver arriba.

## Estado exacto ahora

- **Motor: DETENIDO** (no cargado en launchd). NO relanzar sin la decisión de Alexis.
- **Backlog:** 60 ACs abiertos de 110 totales (61 cerrados). `AC-ADM-05` cerrado (con la
  migración pendiente de revisión); `AC-ADM-04` cerrado limpio.
- **Fuera del motor** (`panel/acs-atascados.txt`): `AC-SEC-05` (refactor a IndexedDB,
  trabajo al 80% en un `git stash`, buscar «AC-SEC-05 wip»), `AC-ADM-11` (informe firmado
  por la dueña), `AC-H0-03` (necesita arnés de tests nuevo en `packages/miga`).
- **`origin/main` al día** — todo lo comiteado esta sesión ya está publicado, incluida
  la migración 0020 en revisión.
- **Panel del motor:** artefacto publicado, URL ya conocida por Alexis (buscar en
  `claude.ai/code/artifacts` si hace falta el link — "KiloPan · Motor autónomo"). Se
  actualiza con `node /private/tmp/.../scratchpad/panel-vivo/construir-artefacto.mjs`
  seguido de `Artifact` sobre el mismo `file_path` — OJO: esa ruta es del scratchpad de
  ESTA sesión (`/private/tmp/claude-501/...`), no sobrevive el traspaso. Si la sesión
  siguiente quiere seguir actualizándolo, tiene que recrear `datos.mjs`/`plantilla.mjs`/
  `construir-artefacto.mjs` en su propio scratchpad (están en la bitácora del código, o
  se pueden regenerar leyendo este HANDOFF + el historial de git de esta conversación no
  aplica — quedan como archivos de sesión, no versionados a propósito, son tooling de
  supervisión, no producto).

## Verificación rápida al retomar

```bash
launchctl list | grep kilopan                                             # debería NO aparecer (detenido)
cat ~/kilopan-monorepo/db/migraciones/0020_anular_venta.sql                # la migración en revisión
git -C ~/kilopan-monorepo log origin/main..HEAD --oneline                  # ¿quedó algo sin publicar? (debería estar vacío)
git -C ~/kilopan-monorepo stash list                                       # trabajo guardado del motor
cat ~/kilopan-monorepo/packages/metodo/panel/acs-atascados.txt
```

## Lo que NO está resuelto

1. **La decisión sobre la migración 0020 — lo primero, antes de relanzar nada.**
2. `AC-SEC-05` (sesión supervisada, trabajo al 80% en stash).
3. CI se confirma a mano por la API pública de GitHub (no hay `gh` ni `brew` en la máquina):
   `curl -s "https://api.github.com/repos/ARSe-auto/kilopan-monorepo/actions/runs?per_page=5"`.
4. Los dos gestos del dueño: rotar credencial de Postgres (G1), branch protection (G2).
5. Olas 3 y 4 sin ACs escritos — mismo trabajo que Ola 2, antes de que se agoten los 60.
6. Considerar si el guardrail de migraciones (`rc 10`) necesita vivir también en
   `guardrail.sh` para cubrir otros caminos de entrada, no solo `loop.sh`.

## Prompt de arranque de la sesión siguiente

> Retoma en `~/kilopan-monorepo`. Lee `docs/HANDOFF.md` completo — hay una decisión
> pendiente de Alexis (qué hacer con `db/migraciones/0020_anular_venta.sql`, que el motor
> escribió violando una regla dura) antes de relanzar el motor. NO relanzarlo sin esa
> decisión. El resto del estado (Ola 2 en marcha, 8 bugs de autonomía arreglados, el
> panel publicado) está en la bitácora. Regla dura de Alexis, la más repetida esta
> noche: no supongas nada, comprobá siempre y mostrá la evidencia.
