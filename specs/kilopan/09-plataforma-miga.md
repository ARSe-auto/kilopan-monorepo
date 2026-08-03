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
      — **Cerrado 3-ago-2026.** `packages/miga/src/componentes/cifras.test.ts` exige la
      propiedad EN EL ARCHIVO de cada componente que muestra dinero o peso
      (`CifraGrande`, `TecladoNumerico`), descartando las líneas de comentario para no
      conformarse con su propia documentación. `packages/miga` ganó su `pnpm test`
      (`scripts/correr-tests.mjs`, recursivo de verdad), que `unit (workspace)` ya corre
      con `--if-present`. `prueba-arnes.sh` §7 mata DOS mutantes contra un árbol de
      juguete (`MIGA_COMPONENTES_DIR`, sin escribir un `.tsx` falso en el `src/` real):
      **(A)** borrar la propiedad de `CifraGrande` dejando la cadena viva en su comentario
      y en `TecladoNumerico` — el caso exacto que el grep global dejaba pasar; **(B)**
      agregar un componente sin clasificar, que el cierre de completitud nombra en el
      error. Ese cierre existe porque la lista es enumerada: sin él, un componente nuevo
      con plata se colaba en silencio y el arreglo repetía con otra forma el defecto que
      vino a corregir. Los 7 componentes del padrón se revisaron uno por uno;
      `ChipEstadoConexion` interpola un contador de cola —ni dinero ni peso— y queda
      declarado fuera con su porqué.
- [x] (P0) `packages/metodo/scripts/guardrail.sh` ejecutable: aborta si `DATABASE_URL` no
      es localhost/127.0.0.1, aborta si hay secretos fuera de `.env.local`, grep
      bloqueante de tokens vedados en `src/` [AC-H0-04]
- [x] (P0) `packages/metodo/scripts/check.sh` ejecutable con `--full`: build + lint +
      types + unit (+ e2e y axe cuando exista UI) [AC-H0-05]
      — **Cerrado 2-ago-2026.** `prueba-arnes.sh` §8b EJECUTA `check.sh --full` en un
      repo-sandbox hermético (toolchain estubada que registra cada llamada a `pnpm`) y
      exige que dispare de verdad `pnpm run {lint,typecheck,test,build,e2e}`; que sin
      `--full` el e2e NO corra (los modos difieren); y planta el mutante del Anexo D
      —borrar los `run_step` internos— exigiendo que la prueba lo MATE. axe sigue fuera
      (AC-H0-10).
- [x] (P0) `packages/metodo/panel/generar.mjs`: genera `panel/index.html` desde estado
      real del repo — nunca «proceso vivo» como señal de avance [AC-H0-06]
      — **Cerrado 2-ago-2026.** El grep `rev-list --count` (que sólo alimentaba el
      contador cosmético «Commits totales» y rotulaba mal el avance) se reemplazó por
      `prueba-arnes.sh` §8c, que EJERCE `generar.mjs` en un sandbox hermético —specs y
      `loop.pid` controlados, copia del script, jamás el panel vivo— y exige: prender el
      loop no mueve el avance (50% con y sin proceso vivo); el avance sube al subir los
      ACs cerrados (2/2 → 100%) con los commits en 0; y el mutant-kill del AC — con el
      loop VIVO pero 0 ACs cerrados el avance es 0, probando que el pid nunca es señal de
      avance.
- [x] (P0) Shells vacíos de `packages/nucleo-{identidad,pod,dte,comun}` con `package.json`
      y un `README.md` que dice explícitamente: «se puebla en el hito de extracción,
      después del DONE de KiloPan — no escribir lógica de negocio aquí todavía»
      [AC-H0-07]
      — **Cerrado 2-ago-2026.** Los 4 shells tienen ahora `package.json` real
      (`@kilopan/nucleo-*`, recogido por el glob `packages/*` de `pnpm-workspace.yaml`,
      sin dependencias). `prueba-arnes.sh` §5b (Anexo D) verifica en disco que cada
      `package.json` existe y parsea, y que cada `README.md` sigue advirtiendo que el
      paquete está vacío a propósito — mata el hueco anterior, donde el AC afirmaba algo
      fácticamente falso.
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
- [ ] (P0) Los **cuatro** estados obligatorios en todo listado: vacío accionable /
      cargando (skeleton) / error con reintentar / sin conexión con **contador real de
      cola** («Sin conexión — N registros por subir» ámbar → «Sincronizado hace Xs»
      verde). Hoy un error de red se ve idéntico a «no hay nada»: por eso el repartidor
      cuya ruta no carga se va a la casa creyendo que no hay reparto [AC-H0-11]
      — **Partido el 3-ago-2026 (Ola 2):** este AC traía además el «undo de 8 s», que es
      otro trabajo y en otras pantallas. Un AC que empaqueta dos cosas no se puede cerrar
      sin mentir a medias, así que el deshacer salió a `AC-H0-12`.
      — **Nota de archivo (3-ago-2026):** por texto de `docs/PROMPT_CORRECTIVO.md` §3
      "los cuatro estados obligatorios de listado" es alcance de Ola 4 (R5), no de
      Ola 2 — a diferencia de `AC-H0-12` (deshacer de 8 s), que §3 sí lista
      explícitamente dentro de Ola 2. Quedó filed junto a `AC-H0-12` por historia, no
      por scope; no se movió de sección para no generar churn en un AC sin construir.
- [ ] (P0) Deshacer de 8 s en pesaje, venta, agregar al carro y armar ruta, **en vez de
      modales de confirmación**. Un panadero con las manos ocupadas y enharinadas despacha
      un modal sin leerlo: confirmar no protege de nada, deshacer sí. Especificado desde el
      primer día dentro de `AC-H0-11` y nunca construido
      (`docs/PROMPT_CORRECTIVO.md` §5) [AC-H0-12]
- [ ] (P1) El teclado grande (`TecladoNumerico`, ya existe) en **todo** campo de plata,
      incluido el arqueo de caja, que hoy usa el teclado chico del sistema. Mismo defecto
      de fondo que F23 con los `<select>` nativos: ningún control del sistema en un campo
      que un panadero real toca a diario [AC-H0-13]

## Fronteras internas (Anexo C)

`apps/kilopan` mantiene `identidad`, `pod`, `dte` y `comun` como carpetas con imports
**unidireccionales**, para que el hito de extracción posterior al DONE mueva ese código a
`packages/nucleo-*` sin cambio de conducta.

Criterio de la extracción: el gate de KiloPan sigue verde **sin tocar sus specs**.

Orden con un solo motor OAuth: KiloPan completo hasta su DONE → hito de extracción →
`apps/flota` → contrato de integración. Dos despliegues, dos BD con dueños distintos,
**cero FK entre productos**.
