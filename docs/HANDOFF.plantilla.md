# HANDOFF — kilopan-monorepo · AAAA-MM-DD HH:MM

> Plantilla. Al traspasar, copiar a `docs/HANDOFF.md` y llenar. La sesión que lo encuentra
> lo retoma sin re-preguntar y, al absorberlo, lo mueve a `docs/handoffs/AAAA-MM-DD-HHMM.md`.
> Este archivo (`.plantilla.md`) se queda donde está.

## Estado exacto

- **Rama / HEAD:** `<rama>` en `<sha corto>` — «<asunto del commit>»
- **Árbol:** limpio | N archivos sin commitear (listar cuáles y por qué)
- **Gate:** `packages/metodo/panel/ultimo-check.estado` = verde | rojo | infra
- **Último verde real:** `packages/metodo/panel/last-green.tag` = `<tag>` sobre `<sha>`
- **ACs abiertos:** N (`node packages/metodo/scripts/gate_specs.mjs --app=kilopan`)
- **AC en curso:** `AC-XX-NN` — qué se alcanzó y qué falta exactamente

## Qué está corriendo

- **Procesos:** `ps aux | grep -E "[l]oop.sh|[w]atchdog"` → pegar el resultado
- **Lock:** `bash packages/metodo/scripts/lock.sh estado builder-kilopan`
- **Puertos:** KiloPan vive en **3300+**, jamás 3000/3100 (ver `docs/CONTRATO_PUERTOS.md`)
- **launchd:** `launchctl list | grep kilopan`

## Próximos pasos, en orden

1. …
2. …
3. …

## Trampas vivas en este momento

Lo que haría perder tiempo a quien retome sin saberlo. Ej.: «la migración 00NN está a
medias», «el e2e X falla por datos de semilla, no por código», «otra sesión trabaja en
`apps/`».

## Prompt de arranque

```
Lee CLAUDE.md, AGENTS.md y docs/HANDOFF.md. Retoma exactamente donde quedó, sin
re-preguntar. Arma tu propio despertador de traspaso a ~4h35m. Cuando absorbas el
HANDOFF, archívalo en docs/handoffs/.
```

## Verificación antes de dar por bueno el traspaso

- [ ] Todo commiteado (`git status --short` vacío)
- [ ] `docs/BITACORA.md` actualizada con lo cerrado en esta sesión
- [ ] Este HANDOFF dice el estado REAL, no el deseado
- [ ] El lock quedó liberado si el builder se detuvo
