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
| **3300** | **KiloPan** | `apps/kilopan` |
| **3301** | **KiloPan** | `apps/flota` (cuando exista) |
| **8778** | **KiloPan** | panel, si algún día se sirve |
| 8100 · 8200 | **eauto** | pdf-svc / mail-worker |
| 8777 | **eauto** | panel del motor |
| 54329 | **eauto** | Postgres local |

KiloPan usa **PGlite embebido** (`@electric-sql/pglite`), sin servidor de base de datos: por
ese lado no hay conflicto posible.

## Reglas

1. **Nunca usar 3000, 3100, ni el resto de la columna «eauto».** No es negociable: el motor
   de eauto los reclama automáticamente y no pregunta.
2. **Fijar el puerto en `package.json`, no solo en `launch.json`.** `next dev` a secas cae en
   3000. `apps/kilopan` ya está pineado a 3300 en su script `dev`/`start`; cualquier app nueva
   del monorepo debe pinear el suyo *antes* del primer arranque.
3. **Si KiloPan adopta higiene de procesos** (copiar el `guardrail.sh` de eauto es tentador,
   la metodología es la misma), anclarla desde el día uno: `pkill` por ruta absoluta o por
   CWD del proceso, jamás por substring genérico como `next-server`. Un `pkill -f next-server`
   aquí mataría el motor de eauto y le rompería el gate en silencio.

Última revisión: 2026-07-25.
