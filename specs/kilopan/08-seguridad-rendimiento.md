# 08 — Seguridad y rendimiento (transversal)

Fuente: §7

No es un hito: corre en paralelo a todos. Los guardrails son código, no disciplina —
violarlos aborta el ítem.

El presupuesto de performance mide lo único que importa a las 4 AM: el peso GZIP del
flujo dorado. **No Lighthouse** — necesita Chrome headless, ~300 MB de dependencias, y su
puntaje mezcla SEO y PWA con lo que de verdad decide si la pantalla abre.

## Criterios de aceptación

- [x] (P0-SEC) Bloqueo por PIN errado: 5 intentos fallidos en 10 min ⇒ dispositivo
      bloqueado 15 min + evento `pin_bloqueado` auditable. `pan.registrar_intento_pin()`,
      probado incluyendo aislamiento entre usuarios y dispositivos distintos [AC-SEC-01]
- [x] (P0-SEC) Rate limit genérico en toda ruta de autenticación (no solo PIN): ventana
      deslizante en memoria por IP (20/min) en `identidad/limitador.ts`. Nota honesta: en
      memoria de un solo proceso; multi-nodo necesitaría Redis [AC-SEC-02]
- [x] (P0-SEC) `pnpm audit` sin vulnerabilidades altas ni críticas en el gate; falla el
      build si aparecen. Encontró 4 altas + 1 moderada reales (sharp/postcss/
      brace-expansion transitivos) el primer día; corregidas con overrides [AC-SEC-03]
- [x] (P0-SEC) Cabeceras de seguridad base (`X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options`) en `next.config.ts`. CSP completa y HSTS quedan para cuando
      existan orígenes reales que permitir (fotos, mapa estático) — decisión deliberada:
      no declarar una CSP amplia «por si acaso» [AC-SEC-04]
      — **Cerrado 2-ago-2026 (Ola 1):** el hueco del Anexo D era que ningún test leía
      `response.headers()`, así que una entrada borrada por error de `headers()` no la
      detectaba nada. Cubierto por `e2e/seguridad-cabeceras.spec.ts`, que pega contra el
      servidor real y exige las tres cabeceras en una PÁGINA y en una ruta de API: el
      `source: "/:path*"` cubre ambas, y angostarlo a rutas de página —error plausible— no
      lo delataría un test que solo mire `/ingresar`.
- [x] (P0-SEC) Cookies de sesión `HttpOnly` + `Secure` (en producción) + `SameSite=Lax`;
      ningún secreto ni token en `localStorage`. Verificado en vivo: `document.cookie` no
      puede leer `kp_sesion` desde JS, pero el navegador la manda sola y
      `/api/auth/logout` la valida [AC-SEC-05]
      — **Cerrado 3-ago-2026 (sesión supervisada).** El hueco era real — el `secreto` del
      dispositivo vivía en `localStorage` en texto plano
      (`apps/kilopan/src/identidad/cliente/dispositivo.ts`), legible con
      `localStorage.getItem(...)` desde cualquier script del origen. Migrado a IndexedDB
      (`kilopan_dispositivo`/`identidad`), que cierra esa lectura trivial de un paso —
      la garantía que el maestro declara y que este AC afirma. `dispositivo.test.ts`
      prueba que el módulo no vuelve a referenciar `localStorage` y que
      `leerDispositivo()` no lanza sin `window` (SSR/Node); los e2e que simulaban el
      equipo vinculado vía `localStorage.setItem` ahora siembran IndexedDB
      (`e2e/sembrar-dispositivo.ts`).
- [x] (P0-SEC) Toda query a Postgres parametrizada (cero interpolación de string en SQL)
      — grep en `guardrail.sh` + disciplina en `db/migrar.mjs` y `db/test-invariantes.mjs`
      desde el primer commit [AC-SEC-06]
      — **Cerrado 2-ago-2026 (Ola 1):** la auditoría Anexo D lo encontró hueco (el grep
      de `guardrail.sh` era case-sensitive y nunca podía disparar contra SQL en
      minúsculas, que es como se escribe TODO el SQL real de este repo). Corregido a
      `grep -RInEi` y probado en `prueba-arnes.sh` §2b con un canario real
      (`db.query(\`select ... \${id}\`)`) que el guard ahora detecta.
- [x] (P0-SEC) Fotos write-once: tabla `pan.fotos` con trigger que rebota UPDATE y
      DELETE, `pan_app` solo con INSERT. El servidor **recalcula** el sha256 y rechaza la
      foto si no coincide con el declarado en el POD. Guardar el binario en la BD es
      decisión consciente para el piloto; si crece, pasa a URL sin cambiar el contrato
      [AC-SEC-07]
- [x] (P1-PERF) Compresión de fotos en el cliente antes de subir: 1280 px de ancho máximo,
      calidad 0.72, objetivo ≈400 KB, con techo duro de 1,5 MB en el servidor [AC-PERF-02]
      — **Cerrado 7-ago-2026 (sesión motor).** El Anexo D (auditoría 2-ago-2026) marcó HUECO
      porque `camara.ts` (ancho/calidad) y el techo de 1,5 MB en `api/fotos/route.ts` existían
      sin ningún test referenciar esos valores. Dos mitades, dos pruebas: (1) `camara.test.ts`
      —Node no tiene Canvas/getUserMedia para ejecutar `capturar()`, así que prueba por
      ausencia de cambio silencioso, igual que `dispositivo.test.ts` con IndexedDB— asegura
      que `ANCHO_MAX = 1280` y `CALIDAD = 0.72` siguen exactamente así en el código fuente;
      (2) `e2e/foto-techo-servidor.spec.ts` pega contra `POST /api/fotos` con sesión real: un
      byte sobre 1.500.000 rebota 413, y exactamente en el techo (1.500.000 bytes) entra.
- [x] (P1-PERF) Paginación por CURSOR (keyset), no por OFFSET, en el listado de entregas:
      con OFFSET la página 40 obliga a recorrer y descartar 2.000 filas, y el cursor
      además no se corre si entra una entrega nueva mientras el dueño scrollea [AC-PERF-03]
      — **Cerrado 8-ago-2026:** `/api/entregas` con cursor keyset implementado (línea 7-11
      de route.ts cita AC-PERF-03); e2e `ac-perf-05-historial-entregas-cursor.spec.ts`
      verifica (1) que el endpoint respeta cursor sin offset, (2) que no hay solapamiento
      de filas entre páginas, (3) que el consumidor (`/admin/entregas/historial`, AC-PERF-05)
      carga paginadamente.
- [x] (P1-PERF) Presupuesto de performance en el gate: peso GZIP del flujo dorado contra
      150 KB. Hoy 104 KB en `/pesar`, `/vender`, `/ruta` — coincide con lo que reporta
      Next, o sea está bien calibrado [AC-PERF-04]
- [x] (P1-PERF) Cablear la paginación por cursor a una pantalla de historial de entregas.
      El endpoint existe desde `AC-PERF-03` y ninguna pantalla lo consume [AC-PERF-05]
      — **Cerrado 7-ago-2026:** pantalla en `/admin/entregas/historial` con paginación por cursor,
      filtro de entregas por revisar, y e2e cobriendo la consunción del endpoint.

## Ola 3/4 — cierres transversales (`docs/PROMPT_CORRECTIVO.md` §3)

- [ ] (P1) **Auditoría de límites de negocio validados SOLO en el cliente**, movidos al
      servidor y a la base. El PIN ya está cubierto (`PIN_VALIDO.test(pin)` en
      `api/usuarios/route.ts`) — no es este el hueco. El resto no se auditó nunca de
      forma sistemática: cantidad máxima de líneas en el carrito, gramos por línea de
      pesaje, largo de motivos/textos libres que hoy solo trunca un `.slice()` de
      React. Mismo procedimiento que el Anexo D: por cada límite encontrado sin
      respaldo de servidor, o se agrega la validación (con test que mande el valor
      fuera de rango por HTTP, no por la UI) o se declara explícitamente por qué no
      hace falta [AC-SEC-09]
- [x] (P0) **500 crudos convertidos en 400 validados.** Contados en el código, no
      supuestos: 18 apariciones de `status: 500`/`status(500)` en `apps/kilopan/src/
      app/api/*` (`turnos`, `pedidos`, `ventas`, `ventas/anular`, `dispositivos/
      enrolar`, `auth/login`, `leads`, `usuarios`, y el resto). Un 500 le dice al
      repartidor con mala señal «el servidor se rompió» cuando la mitad de las veces
      es un dato inválido que debería ser 400 con un mensaje que se pueda mostrar y
      reintentar. Por cada ruta: clasificar el error real (validación de entrada →
      400; excepción de verdad → 500) y probarlo con un caso que mande el dato malo
      por HTTP [AC-SEC-10]
      — **Cerrado 3-ago-2026 (sesión supervisada).** `comun/error-http.ts` clasifica en un
      solo lugar y las rutas lo llaman: **17 sitios en 14 rutas** convertidos. La
      clasificación NO se adivina por el texto del mensaje —cambia con el idioma y con el
      wording de cualquier trigger—: se lee el `code` SQLSTATE, que es contrato estable.
      Clase 23 (`not_null`, `foreign_key`, `unique`, `check`), `22P02`/`22001` y `P0001`
      —el `raise exception` de nuestros propios triggers de negocio— son datos que la BD
      rechaza A PROPÓSITO, o sea entrada inválida → 400 **con el mensaje de la BD**, que
      escribimos nosotros en español y es lo único accionable que tiene el operador. Todo
      lo demás sigue siendo 500 con el mensaje genérico, sin filtrar el detalle interno.
      **Por qué importa más de lo que parece:** `enviarOEncolar` (`pod/outbox.ts`) trata un
      5xx como «el servidor está caído, reintento» y un 4xx como «este dato no lo va a
      aceptar nunca, a la bandeja de rechazados». Clasificar mal dejaba una venta
      reintentándose para siempre contra un error que no se arregla solo.
      Evidencia: `comun/error-http.test.ts`, 9 casos, cada código real por separado **y el
      control en negativo** —una caída de verdad (`ECONNREFUSED`) sigue siendo 500 y no
      filtra el detalle— para que esto no degenere en «todo es 400». Dos sitios quedaron
      en 500 a propósito y no son deuda: `auth/login` y `dispositivos/enrolar` no están en
      un `catch` sino en un `insert` que no devolvió fila — ahí no hay error de BD que
      clasificar, la consulta funcionó y no trajo nada.

## Guardrails que corren antes de cada iteración

`packages/metodo/scripts/guardrail.sh`:

- `DATABASE_URL` SOLO localhost o 127.0.0.1 — exit ≠ 0 aborta.
- Secretos SOLO en `.env.local`, gitignored.
- Grep bloqueante en `src/`: `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum`.
- Jamás migración destructiva ni `db:reset` sobre datos con evidencia (fotos de POD).
- Motor OAuth-only: ventana agotada ⇒ **espera**. Jamás API de pago.
