# Contrato de puertos — convivencia con eauto-crm-next en el Mac Mini

Este Mac Mini corre **dos proyectos a la vez**: `kilopan-monorepo` y `~/eauto-crm-next`,
este último con un motor autónomo (LaunchAgents `com.eauto.ralph-*`) que construye y
verifica sin intervención humana, día y noche.

## Por qué existe este documento

El arnés de eauto ejecuta `scripts/guardrail.sh` **en cada iteración de build** (cada pocos
minutos). Entre sus tareas de higiene libera sus puertos:

```bash
for p in 3000 3100; do lsof -tiTCP:$p -sTCP:LISTEN | xargs -r kill; done
```

Ese `kill` es **ciego al proyecto**: mata lo que sea que escuche en 3000/3100. No es un bug
—eauto necesita esos puertos libres para su propio `next start` de e2e—, pero significa que
**cualquier servidor de KiloPan en 3000 moriría solo cada pocos minutos, sin error visible**.
Diagnosticarlo desde el lado de KiloPan es desconcertante: el proceso simplemente desaparece.

(El otro vector, un `pkill -f "next-server"` sin anclar que mataba servidores Next de
cualquier checkout, se corrigió en eauto el 25-jul-2026 —commit `b327511`— filtrando por el
CWD real del proceso. Ya no es un riesgo.)

## Reparto

| Rango | Dueño | Uso |
|---|---|---|
| 3000 | **eauto** | `next dev` / `next start` de e2e |
| 3025 · 3143 | **eauto** | Greenmail SMTP / IMAP |
| 3100 | **eauto** | suite de rendimiento (`NEXT_DIST_DIR=.next-perf`) |
| 3200 | libre | copias aisladas para QA puntual |
| **3300** | **KiloPan** | `apps/kilopan` (`dev`/`start`) |
| **3301** | **KiloPan** | **e2e de `apps/kilopan`** — `playwright.config.ts` lo fija para TODOS los worktrees |
| **3310** | **FLOTA** | `apps/flota` (`dev`/`start`) |
| **3311** | **FLOTA** | e2e de `apps/flota` |
| **8778** | **KiloPan** | panel, si algún día se sirve |
| 8100 · 8200 | **eauto** | pdf-svc / mail-worker |
| 8777 | **eauto** | panel del motor |
| 54329 | **eauto** | Postgres local (Postgres.app 18) |
| **54331** | **FLOTA** | **cluster Postgres de `apps/flota`** — `db/flota/cluster.sh` |

KiloPan usa **PGlite embebido** (`@electric-sql/pglite`), sin servidor de base de datos: por
ese lado no hay conflicto posible.

## El cluster de FLOTA (54331)

FLOTA **no puede** correr sobre PGlite: el §4.1 del maestro exige `CREATE DATABASE …
TEMPLATE`, una base por tenant con rol `app_t_<slug>` que solo tiene `CONNECT` a la suya, y
`uuidv7()` nativo (PostgreSQL ≥ 18). Eso pide un servidor de verdad.

En esta máquina ya hay uno: **Postgres.app 18.4**, sirviendo el cluster de eauto en el 54329.
De esa instalación FLOTA reutiliza **solo los binarios** (lectura pura). Todo lo demás es
propio y no se cruza con eauto en nada:

| | eauto | FLOTA |
|---|---|---|
| Puerto | 54329 | **54331** |
| PGDATA | `~/Library/Application Support/Postgres/var-18` | `~/.flota-pg/var-18` |
| Superusuario | (el de Postgres.app) | `flota_admin` |
| Extensiones extra | — | pgTAP 1.3.3 vía `extension_control_path` → `~/.flota-pg/share` |

**Nunca** se levanta FLOTA sobre el 54329 ni se crean bases `t_*` ahí: son cluster, datos y
credenciales de otro proyecto. `cluster.sh destruir` mueve el PGDATA a un lado con marca de
tiempo; jamás borra en firme.

El cluster es **uno solo para todos los worktrees** —igual que el 3301 del e2e de KiloPan—,
así que dos gates simultáneos comparten el recurso y quien lo consume toma el lock.

```bash
bash db/flota/cluster.sh iniciar   # initdb si hace falta, arranca y siembra pgTAP
bash db/flota/cluster.sh estado
bash db/flota/cluster.sh parar
```

## Reglas

1. **Nunca usar 3000, 3100, ni el resto de la columna «eauto».** No es negociable: el motor
   de eauto los reclama automáticamente y no pregunta.
2. **Fijar el puerto en `package.json`, no solo en `launch.json`.** `next dev` a secas cae en
   3000. `apps/kilopan` ya está pineado a 3300 en su script `dev`/`start`; cualquier app nueva
   del monorepo debe pinear el suyo *antes* del primer arranque.
3. **Cada app tiene DOS puertos: el suyo y el de su e2e.** Esta tabla asignaba el 3301 a
   `apps/flota` mientras `apps/kilopan/playwright.config.ts` ya lo tenía fijo para su e2e
   (línea `const PUERTO = 3301`) — dos dueños para el mismo recurso, escrito en el propio
   contrato que existe para evitarlo. Pasó el 8-ago-2026: un esqueleto de `apps/flota` nació
   pineado al 3301, y un agente que corría el e2e de KiloPan quedó esperando un puerto que
   nunca se iba a liberar. Un gate perdido por colisión de infraestructura le suma un strike
   a un AC sano (ver el comentario del lock en `check.sh`), así que la colisión no es sólo
   molesta: corrompe la contabilidad del motor.
4. **Si KiloPan adopta higiene de procesos** (copiar el `guardrail.sh` de eauto es tentador,
   la metodología es la misma), anclarla desde el día uno: `pkill` por ruta absoluta o por
   CWD del proceso, jamás por substring genérico como `next-server`. Un `pkill -f next-server`
   aquí mataría el motor de eauto y le rompería el gate en silencio.

Última revisión: 2026-08-08 (alta del cluster de FLOTA en el 54331).
