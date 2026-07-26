# 09 — Plataforma, sistema de diseño «Miga» y accesibilidad

Fuente: §5

Estructura del monorepo (Anexo C) y el sistema de diseño que comparten KiloPan y
KiloRuta. PWA instalable móvil-primero (viewport base 390×844) + dashboard web escritorio
(≥1280 px). Solo modo claro en el MVP.

Manos enharinadas: cero hover, cero long-press obligatorio, cero drag fino en móvil.
Ningún estado se comunica solo por color.

## Criterios de aceptación

- [x] (P0) pnpm workspace + estructura `apps/*` `packages/*` [AC-H0-01]
- [x] (P0) `packages/miga`: tokens de diseño (color, tipografía, grilla, radios) como
      árbol de constantes TS + hoja CSS de variables; incluye acento `#C2410C` (KiloPan)
      y `#1D4ED8` (KiloRuta, reservado para `apps/flota`) [AC-H0-02]
- [x] (P0) Test que falla si una cifra de dinero o peso no usa `tabular-nums` /
      `font-variant-numeric` en los componentes de `packages/miga` [AC-H0-03]
- [x] (P0) `packages/metodo/scripts/guardrail.sh` ejecutable: aborta si `DATABASE_URL` no
      es localhost/127.0.0.1, aborta si hay secretos fuera de `.env.local`, grep
      bloqueante de tokens vedados en `src/` [AC-H0-04]
- [x] (P0) `packages/metodo/scripts/check.sh` ejecutable con `--full`: build + lint +
      types + unit (+ e2e y axe cuando exista UI) [AC-H0-05]
- [x] (P0) `packages/metodo/panel/generar.mjs`: genera `panel/index.html` desde estado
      real del repo — nunca «proceso vivo» como señal de avance [AC-H0-06]
- [x] (P0) Shells vacíos de `packages/nucleo-{identidad,pod,dte,comun}` con `package.json`
      y un `README.md` que dice explícitamente: «se puebla en el hito de extracción,
      después del DONE de KiloPan — no escribir lógica de negocio aquí todavía»
      [AC-H0-07]
- [ ] (P1) TEST que verifique la escala tipográfica completa de Miga. Los tokens ya
      existen (`tokens.ts`: `pesoBascula` 96/700, y `CifraGrande.tsx` la aplica); lo que
      no existe es la prueba que falle si una pantalla se sale de la escala [AC-H0-08]
- [ ] (P1) es-CL verificado por grep de gate: `12,450 kg` (coma, 3 decimales desde
      gramos), `$12.500` (entero, punto de miles), `dd-mm-aaaa`, RUT `12.345.678-5`
      validado al escribir. **Cero strings visibles en inglés** [AC-H0-09]
- [ ] (P1) AA medible en el gate: **axe no está instalado ni como dependencia ni como
      test** — `check.sh` solo lo nombra en un comentario y en el mensaje de «saltado».
      Falta: contraste ≥4.5:1 automatizado, test que recorra el DOM buscando targets
      <44 pt, foco visible, F1/F4/F5 con VoiceOver, texto al 200 % sin truncar kilos
      ni CLP, y grep de `aria-label` vacíos [AC-H0-10]
- [ ] (P1) Estados obligatorios en todo listado: vacío accionable / skeleton / error con
      reintentar / sin conexión con **contador real de cola** («Sin conexión — N
      registros por subir» ámbar → «Sincronizado hace Xs» verde). Undo de 8 s en vez de
      modales [AC-H0-11]

## Fronteras internas (Anexo C)

`apps/kilopan` mantiene `identidad`, `pod`, `dte` y `comun` como carpetas con imports
**unidireccionales**, para que el hito de extracción posterior al DONE mueva ese código a
`packages/nucleo-*` sin cambio de conducta.

Criterio de la extracción: el gate de KiloPan sigue verde **sin tocar sus specs**.

Orden con un solo motor OAuth: KiloPan completo hasta su DONE → hito de extracción →
`apps/flota` → contrato de integración. Dos despliegues, dos BD con dueños distintos,
**cero FK entre productos**.
