# Arranque de la construcción — Plataforma FLOTA (E1)

**Para la sesión que construya la app.** Modelo: Opus 5, esfuerzo alto (orden de Alexis,
8-ago-2026). Este documento se lee UNA vez y después manda el contrato, no este archivo.

---

## 1. Qué existe y qué no

**Existe (el contrato, completo y verificado):**

| Artefacto | Qué es |
|---|---|
| `docs/PROMPT_MAESTRO_FLOTA.md` | 947 líneas. **La única fuente de verdad.** Cableado a Chile por diseño (CLP entero, RUT, SII, es-CL, Ley 21.719/21.131/19.983, Res. 154/2025). |
| `specs/flota/00…08-*.md` | 9 specs de módulo, **195 ACs**, todos abiertos. Cada AC con conducta verificable, caso de rebote o degradación, y **oráculo** (178 CI · 8 humano · 8 producción). |
| `IMPLEMENTATION_PLAN_flota.md` | Los mismos ACs ordenados por los hitos (a)→(g) del §9.1. **Solo lleva el estado**; la spec manda. |
| `docs/compatibilidad-kiloruta-E1.md` | Prueba de compatibilidad con KiloRuta (primer tenant real): **63 criterios KR** → spec y AC que los satisface, o «pendiente» con nota honesta. Es el insumo de `AC-FTEN-18`/`AC-FTEN-19`. |
| `docs/CONTRATO_PUERTOS.md` | Reparto de puertos del Mac Mini. **Leerlo antes de levantar nada.** |

**NO existe, a propósito:** `apps/flota/` y `db/migraciones-flota/`. Un esqueleto y una
migración nacieron el 8-ago ANTES de que hubiera specs y fueron **revertidos por orden del
dueño** (`31b32ff`): sin contrato no se construye. Ese trabajo sigue en la historia y se
puede consultar (`git show ebb85ea` esqueleto, `git show db21644` plano de control) —
**consultar, no copiar**: lo que se construya ahora se deriva de las specs.

De ese borrador quedan dos datos ganados que sí sirven: `uuidv7()` nativo exige
**PostgreSQL ≥ 18** (confirmado contra PGlite 0.5.4), y el proveedor gestionado real todavía
no está confirmado que lo tenga.

---

## 2. Cómo se verifica (el gate)

```
node packages/metodo/scripts/gate_specs.mjs --app=flota     # el contrato
bash packages/metodo/scripts/check.sh --app=flota           # todo lo que hay
bash packages/metodo/scripts/check.sh --full --app=flota    # + e2e, perf, invariantes
```

`check.sh --app=flota` **corre aunque `apps/flota` todavía no exista**: los pasos que
necesitan el árbol de la app quedan SALTADOS explícitos (arreglado el 8-ago; antes abortaba
con exit 2 y el gate de una app nueva no podía correr nunca — justo al revés del método).

Un paso SALTADO **no es un paso verde**. El resumen del gate los lista aparte a propósito.

---

## 3. Reglas duras del método (las mismas que gobiernan KiloPan)

1. **Sin spec no se construye.** El AC vive en `specs/flota/` — esa es su definición canónica.
   Leer la spec dueña del AC **y la sección del maestro que cita su línea `Fuente: §N`** antes
   de escribir código.
2. **Un AC = un commit**, con su test naciendo en el MISMO commit.
3. **Citar el id del AC** (`AC-FTEN-03`, etc.) en un comentario del código o del test que lo
   implementa. Sin esa cita, `verify-refs --estricto` ve un `[x]` sin respaldo y pone el gate
   en ROJO — y ahí ningún commit posterior pasa.
4. **`[x]` solo con evidencia de test corriendo en verde.** Si el texto del AC exige un e2e, ese
   e2e verde **en primer plano** antes de marcar nada.
5. **Marcar `[x]` en la spec Y en el plan, en el mismo commit** (regla 5 del gate: se espejan).
6. **Un AC no se marca `[x]` si falta parte de él.** Si quedó a medias: cerrar lo hecho y dejar
   el resto como AC abierto nuevo en la spec.
7. **ACs BLOQUEADOS: no inventar la respuesta.** **16 de los 195** están marcados BLOQUEADOS
   por una pregunta al dueño (§6). Se saltan y se sigue; se desbloquean cuando Alexis
   responde. Varios están BLOQUEADOS solo en una cláusula: el resto del AC es ejecutable hoy
   y la spec lo dice explícitamente — leerla antes de descartar el AC entero.
   Los 16: `AC-FTEN-05`, `AC-FTEN-10`, `AC-FTEN-14`, `AC-FTEN-25`, `AC-FTEN-27`, `AC-FIDN-18`,
   `AC-FVEH-06`, `AC-FVEH-07`, `AC-FVEH-13`, `AC-FVEH-19`, `AC-FSEM-25`, `AC-FTAR-14`,
   `AC-FMIG-06`, `AC-FMIG-15`, `AC-FMIG-22`, `AC-FMIG-23`.
8. **8 ACs tienen oráculo `humano`** — no los cierra CI ni un motor autónomo, los cierra una
   sesión supervisada con Alexis: `AC-FTEN-18`, `AC-FIDN-16`, `AC-FVEH-16`, `AC-FPOD-16`,
   `AC-FSEM-15`, `AC-FPOR-13`, `AC-FMIG-12`, `AC-FMIG-16`.

## 4. Orden de trabajo

El plan ya viene ordenado por los hitos del §9.1. **Hito (a) primero**: núcleo tenancy
(BD `control` + `tenant_template` + runner con canario) + familia canónica de constantes +
linter de migraciones + `docs/criterios-kiloruta.txt` congelado.

Dos cosas del hito (a) que conviene saber antes de empezar:

- **§8 del maestro: el hito (a) es una decisión fundacional irreversible de E1 — la escribe el
  modelo tope disponible.** No delegarlo a un modelo menor ni a un motor automático.
- **`AC-FTEN-18` tiene oráculo `humano`**: la lista `docs/criterios-kiloruta.txt` (IDs `KR-01…KR-NN`
  con N explícito) **la aprueba Alexis** antes de continuar el hito (a). Conviene pedírsela
  temprano. Su insumo ya está hecho: `docs/compatibilidad-kiloruta-E1.md`.
- `docs/matriz-kiloruta.md` es el entregable de `AC-FTEN-19` (tabla mecánica
  `ID | tabla/constraint | test` con gate de tres verificaciones). **Esa ruta está reservada**:
  no pisarla con otra cosa.

## 5. Trampas ya pagadas con sangre en KiloPan (no volver a pisarlas)

- **Puertos.** `3300` = dev de KiloPan · `3301` = **e2e de KiloPan**, fijo en su
  `playwright.config.ts` para todos los worktrees · **`3310` = dev de FLOTA · `3311` = e2e de
  FLOTA**. Pinear el de dev en `package.json` (`next dev` a secas cae en 3000, que el motor de
  eauto mata cada pocos minutos) y el de e2e en `playwright.config.ts`, **antes del primer
  arranque**. El esqueleto revertido se había pineado al 3301 y dejó a un agente esperando un
  puerto que no se iba a liberar.
- **Componentes de mapa / browser-only** van con `dynamic(..., { ssr: false })` desde un
  envoltorio cliente, o la página entera muere en SSR con `window is not defined`.
- **e2e: usar `page.request`** para pegarle a la API (comparte las cookies de la sesión). El
  fixture `request` pelado va sin sesión y da 401.
- **Todo listado puede venir vacío** en la base de e2e: asertar contenido real **O** el estado
  vacío, con `.or()`.
- **Selectores** por contenido visible real o `getByRole`, con `{ exact: true }` si el texto
  puede ser substring de otro. Jamás selectores fantasma tipo `div[style*=...]`.
- **Nada de trabajo en segundo plano para el gate**: correrlo en primer plano y esperar su exit
  code en el mismo turno.

## 6. Preguntas al dueño (Alexis) — pendientes

Están consolidadas al final de cada spec, en su sección «Preguntas al dueño», y las que
bloquean un AC lo dicen en el propio AC (`BLOQUEADO`). **Ninguna se responde inventando.**

Las que conviene resolver temprano porque tocan el hito (a) o (b):

- **Grupos jerárquicos de visibilidad** (§3.E1.1): el maestro fija el árbol `grupos` y su
  ortogonalidad al rol, pero no dice **qué entidades se adscriben a un grupo ni qué superficies
  filtra**. Bloquea un AC del módulo 00.
- **Clase del gancho `lot`** (§4.9): ¿`PLANIFICACIÓN` o `CAPTURA`? Bloquea una cláusula de
  `AC-FTEN-14`.
- **Dominio de producción** para el ruteo por subdominio, y **proveedor Postgres gestionado**
  (¿el de Railway?) con la confirmación de `uuidv7()` nativo (PG ≥ 18).
- **Atribución turno/bloque → empresa cliente** para `por_bloque_horas`: KiloRuta lo resolvía con
  `turnos.empresa_cliente_id`; el esquema §4.5 de FLOTA no trae esa columna. Bloquea el fixture
  del devengo del seed A.
- **Sesiones**: duración, caducidad y re-autenticación no están fijadas en el maestro.

## 7. Lo que NO se toca

- `apps/kilopan/**`, `db/migraciones/*.sql` y el contenido de negocio de `specs/kilopan/**`:
  son de KiloPan, que está en 83/98 ACs con su propio motor.
- El motor de KiloPan arranca **solo por launchd** (`com.kilopan.ralph-loop`) y trabaja en
  `~/kilopan-monorepo` sobre `main`. Hoy está detenido en DONE (nada que construir que no esté
  marcado atascado). **No commitear a `main` a mitad de una iteración suya** y no matar sus
  procesos: un commit externo en medio le corrompe la contabilidad de avance.
- Los tags `archivo-wip/*` (55) no se borran jamás.
- **La app JAMÁS emite DTE** (art. 97 N°4 CT): nada de XML, TED ni folios propios. La emisión
  sale exclusivamente por adaptadores de proveedores autorizados por el SII.
