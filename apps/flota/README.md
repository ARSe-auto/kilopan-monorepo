# apps/flota — Plataforma FLOTA

Esqueleto del **hito 0** (§9.1 de `docs/PROMPT_MAESTRO_FLOTA.md`), levantado el
09-ago-2026. Cero imports de `apps/kilopan`: la frontera son `packages/miga` y los
futuros `packages/nucleo-*`.

## Qué maestro rige

`docs/PROMPT_MAESTRO_FLOTA.md` — la Plataforma FLOTA ABSORBE a KiloRuta como su primer
vertical configurado (Anexo C de ese documento). `docs/PROMPT_MAESTRO_KILORUTA.md` queda
como referencia histórica; `apps/flota` NO se construye contra él.

## Puertos — 3310 y 3311, pineados acá

| Puerto | Uso | Dónde está fijo |
|---|---|---|
| **3310** | `dev` y `start` | `package.json` |
| **3311** | e2e de Playwright | `playwright.config.ts` |
| **54331** | cluster de PostgreSQL | `db/flota/cluster.sh` |

No es un detalle de configuración. `next dev` a secas cae en **3000**, que es de eauto, y
su motor lo reclama cada pocos minutos matando lo que encuentre: el servidor desaparece
sin error visible. Y el **3301** es del e2e de `apps/kilopan` — un esqueleto de esta app
ya nació pineado ahí una vez (08-ago-2026) y dejó a otro agente esperando un puerto que
nunca se iba a liberar. Detalle completo en `docs/CONTRATO_PUERTOS.md`.

La base de datos vive en su propio cluster: `bash db/flota/cluster.sh iniciar`
(PostgreSQL 18 en 127.0.0.1:**54331**; el 54329 es de eauto y no se toca).

## Qué hay hoy, y qué no

**Hay:** el ruteo por subdominio (AC-FTEN-05) en `servidor.mjs` —el mismo proceso que se
despliega, en desarrollo y en producción— y el shell que sirve detrás de él:
en es-CL, con manifest de PWA, tokens estructurales de Miga (§5.1) y el estado vacío
accionable que manda la regla de contracción del §5.5 cuando el manifest de navegación
llega sin módulos. Sus e2e (`e2e/esqueleto.spec.ts` y `e2e/ruteo.spec.ts`) ejercen ese
camino de punta a punta: el primero porque es el que esconde el defecto de «responde 200 y
nunca hidrata», el segundo porque el ruteo se juega entero en la cabecera `Host`.

**No hay** ninguna pantalla de terreno: recepción, apertura de turno, parada y cierre
nacen en los hitos (c) a (e) con sus propios ACs y sus propios e2e con presupuesto de
toques. Tampoco hay script `test`: no existe todavía un test unitario de esta app, y
declarar el script vacío haría que `unit (workspace)` reportara verde sin correr nada. El
primer AC que traiga un test unitario agrega el script en su mismo commit.

## Cómo se verifica

```bash
bash packages/metodo/scripts/check.sh --app=flota --full
```

El gate de esta app corre además `db/flota/gate.sh`, que exige el cluster arriba.
