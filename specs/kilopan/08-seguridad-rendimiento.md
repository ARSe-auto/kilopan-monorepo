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
- [ ] (P0-SEC) Cabeceras de seguridad base (`X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options`) en `next.config.ts`. CSP completa y HSTS quedan para cuando
      existan orígenes reales que permitir (fotos, mapa estático) — decisión deliberada:
      no declarar una CSP amplia «por si acaso» [AC-SEC-04]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Las cabeceras están declaradas en
      `next.config.ts:28-38` pero ningún test hace `fetch()`/`page.goto()` y lee
      `response.headers()` para confirmar que el servidor las emite de verdad — una
      entrada borrada por error no la detectaría nada.
- [ ] (P0-SEC) Cookies de sesión `HttpOnly` + `Secure` (en producción) + `SameSite=Lax`;
      ningún secreto ni token en `localStorage`. Verificado en vivo: `document.cookie` no
      puede leer `kp_sesion` desde JS, pero el navegador la manda sola y
      `/api/auth/logout` la valida [AC-SEC-05]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** La cookie de sesión sí cumple lo que
      afirma, pero la cláusula "ningún secreto ni token en localStorage" es falsa:
      `apps/kilopan/src/identidad/cliente/dispositivo.ts:11,27` guarda el `secreto` del
      dispositivo en texto plano vía `window.localStorage.setItem`. El propio comentario
      del archivo lo reconoce como garantía menor aceptada — pero eso hace falsa la
      afirmación del AC, no la vuelve cierta.
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
- [ ] (P1-PERF) Compresión de fotos en el cliente antes de subir: 1280 px de ancho máximo,
      calidad 0.72, objetivo ≈400 KB, con techo duro de 1,5 MB en el servidor [AC-PERF-02]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** `camara.ts` (ancho/calidad) y el techo
      de 1,5 MB en `api/fotos/route.ts` existen, pero ningún test referencia esos valores
      ni sube una foto pesada esperando 413 — cero prueba automatizada de cualquiera de
      las dos mitades.
- [ ] (P1-PERF) Paginación por CURSOR (keyset), no por OFFSET, en el listado de entregas:
      con OFFSET la página 40 obliga a recorrer y descartar 2.000 filas, y el cursor
      además no se corre si entra una entrega nueva mientras el dueño scrollea [AC-PERF-03]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El endpoint existe pero ninguna
      pantalla lo consume (ya reconocido por `AC-PERF-05`, abierto) — sin una pantalla
      real que scrollee, la afirmación "el cursor no se corre" nunca se ejercita de
      punta a punta.
- [x] (P1-PERF) Presupuesto de performance en el gate: peso GZIP del flujo dorado contra
      150 KB. Hoy 104 KB en `/pesar`, `/vender`, `/ruta` — coincide con lo que reporta
      Next, o sea está bien calibrado [AC-PERF-04]
- [ ] (P1-PERF) Cablear la paginación por cursor a una pantalla de historial de entregas.
      El endpoint existe desde `AC-PERF-03` y ninguna pantalla lo consume [AC-PERF-05]

## Guardrails que corren antes de cada iteración

`packages/metodo/scripts/guardrail.sh`:

- `DATABASE_URL` SOLO localhost o 127.0.0.1 — exit ≠ 0 aborta.
- Secretos SOLO en `.env.local`, gitignored.
- Grep bloqueante en `src/`: `TODO|FIXME|PLACEHOLDER|not implemented|lorem ipsum`.
- Jamás migración destructiva ni `db:reset` sobre datos con evidencia (fotos de POD).
- Motor OAuth-only: ventana agotada ⇒ **espera**. Jamás API de pago.
