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
      — **Cerrado 4-ago-2026 (sesión supervisada).** Los tres estados que faltaban viven en
      `packages/miga/src/componentes/EstadoListado.tsx` — `EstadoCargando` (skeleton real,
      no un «Cargando…»: reserva el alto para que la pantalla no salte y se distingue de un
      vacío sin leer), `EstadoVacio` (accionable: acepta una acción, no solo un mensaje) y
      `EstadoError` (**con su botón de reintentar**, que es la mitad del estado: sin él
      «algo falló» es una noticia sin salida y el operador cierra la app). El 4º —sin
      conexión con contador de cola— ya existía en `ChipEstadoConexion` y se cerró en
      `AC-POD-07`, que cableó `/ruta`, la pantalla donde el chip mentía.
      Viven en `miga` y no en cada pantalla porque la diferencia entre los cuatro tiene que
      ser la MISMA en toda la app: si cada listado inventa su propio «no hay nada», el
      operador aprende a ignorarlos y volvemos al punto de partida.
      Aplicados a `/caja`, `/historial` y `/facturar`, que tenían los estados distinguidos
      pero **sin ninguna forma de reintentar** — verificado con grep: las únicas dos
      apariciones de «Reintentar» en toda la app eran de `/ruta`, y una era del GPS. En
      `/caja` la carga se extrajo a `cargarMedios()` para que el botón pudiera llamarla:
      antes vivía dentro del `useEffect` y reintentar exigía recargar la pantalla entera,
      perdiendo lo que el vendedor ya había tecleado.
      Evidencia: `estado-listado.test.ts`, 6 casos que prueban la DIFERENCIA entre estados,
      no su estética — que el error trae acción, que se anuncia con `role="alert"` mientras
      el vacío usa `role="status"` (un error interrumpe al lector de pantalla, un vacío no),
      que el cargando es skeleton y no texto, y que el botón respeta el mínimo táctil de
      48 px (§5: un reintento que no se acierta es lo mismo que no tenerlo).
      **Alcance declarado, no olvido:** quedan sin cablear los listados de `/vender`,
      `/pedidos`, `/admin` e `/inicio`. Los componentes existen y exportarlos era el
      trabajo estructural; cablear cada pantalla es mecánico y se hace con su AC. Cerrar
      esto afirmando «todo listado» sin haberlos tocado sería exactamente el `[x]` sin
      respaldo que el Anexo D encontró 62 veces.
      — **Trampa para quien construya el 4º estado (3-ago-2026, verificado):**
      `public/sw.js:84-100` responde `caches.match("/ingresar")` a TODA página
      autenticada pedida sin red. Un e2e que emule offline y NAVEGUE a la pantalla
      aterriza en el login y pasa en VERDE sin haber ejercido nada — falso verde, no
      rojo, así que nadie lo nota. Hay que perder la señal con la pantalla YA abierta,
      que además es el escenario real (el furgón entrando a una zona sin cobertura).
- [ ] (P0) Deshacer de 8 s en pesaje, venta, agregar al carro y armar ruta, **en vez de
      modales de confirmación**. Un panadero con las manos ocupadas y enharinadas despacha
      un modal sin leerlo: confirmar no protege de nada, deshacer sí. Especificado desde el
      primer día dentro de `AC-H0-11` y nunca construido
      (`docs/PROMPT_CORRECTIVO.md` §5) [AC-H0-12]
      — **Alcance acotado (3-ago-2026), para que el motor no lo tome mal: se implementa
      DIFIRIENDO el despacho, nunca compensando (escribir y después revertir).**
      Compensar exige DELETE o un estado de anulación en tablas de negocio, y `pan_app`
      no los tiene en NINGUNA: verificado grant por grant de `0001` a `0022`, los únicos
      dos DELETE del esquema son `pan.bloqueos_pin` (`0001:243`) y
      `pan.bloqueos_pin_enrolamiento` (`0016:71`), ninguna de negocio. Compensar
      obligaría además a un trigger de REVERSO de `trg_pesajes_suman_linea`
      (`0004:93-108` — `gramos_pesados` hoy solo SUMA, «lo mantiene un trigger, JAMÁS la
      app», `0004:52`), a un estado `'anulada'` en `pan.rutas` que su CHECK
      (`0004:171-172`) hoy no admite, y a filtrar esa anulación en `pan.stock_disponible`
      (`0012:15-27`) y `pan.conciliacion_diaria` (`0005`) — o sea, migración sí o sí, que
      es de sesión supervisada y jamás del motor (`docs/PROMPT_CORRECTIVO.md` §7). Y
      diferir el despacho tampoco es gratis: hoy `enviarOEncolar` garantiza IndexedDB
      pase lo que pase (`outbox.ts`, el `catch` que encola en `sin_red`); diferir la
      escritura en memoria de React SIN encolar antes sería una regresión de
      durabilidad — se pierde el dato si el operador bloquea el teléfono a mitad de los
      8 s. El orden correcto es ENCOLAR primero, despachar a los 8 s.
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
