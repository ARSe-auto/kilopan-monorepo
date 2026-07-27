# BITÁCORA — kilopan-monorepo

Registro disco-backed, una entrada por ítem cerrado o por decisión que cambia el rumbo
(§10 del maestro, casilla 19 del prevuelo). Lo más nuevo arriba.

**Qué va aquí:** qué se cerró, con qué evidencia, y qué se aprendió — sobre todo cuando
el aprendizaje contradice lo que creíamos. **Qué NO va:** el estado del plan (eso vive en
`IMPLEMENTATION_PLAN_*.md`, que es desechable) ni la definición de los ACs (eso vive en
`specs/`, que es durable).

---

## 2026-07-26 (cierre) · Motor 24/7 cargado (casilla 14) y panel apuntando a `specs/` (casilla 16)

**Casilla 16 — fuente de verdad del panel.** `panel/generar.mjs` contaba ACs desde
`IMPLEMENTATION_PLAN.md`, que es desechable: el planner lo regenera desde cero, así que
bastaba que lo reescribiera para que el porcentaje saltara sin haberse construido nada. Y
fue justo un plan mal regenerado —0 abiertos, con 22 ACs enterrados dentro de ítems `[x]`—
el que dejó al motor detenido creyendo que había terminado. Un panel que lee el archivo que
mintió repite la mentira. Ahora lee `specs/<app>/`, el contrato durable, agrupando por spec
y acumulando el bloque completo de cada ítem (envuelven varias líneas y el id queda en la
última). Verificado: 61/77, idéntico al conteo directo, sin ítems sin id.

**Casilla 14 — el motor sobrevive a la sesión.** Cargado y **construyendo**: tomó
`AC-ID-07` y escribió `ChipOperador.tsx` y `EncabezadoConOperador.tsx`. Dos obstáculos, y
ninguno se anunciaba como lo que era:

1. **El repo estaba en `~/Documents`.** macOS (TCC) le niega a los agentes de launchd el
   acceso a esa carpeta. El agente cargaba «bien» —`launchctl list` con pid y estado 0— y
   moría al instante con `Operation not permitted`, sin una línea de stdout. El repo se
   movió a `~/kilopan-monorepo` (respaldo previo en `git bundle`, 4 worktrees reparados con
   `git worktree repair`). **No devolverlo a Documents.**
2. **La credencial iba por una variable inexistente.** El plist apuntaba
   `CLAUDE_CODE_OAUTH_TOKEN_FILE`; la que `claude` lee es `CLAUDE_CODE_OAUTH_TOKEN`. El
   motor moría en cada iteración con «Not logged in». Ahora el token se lee de
   `~/.claude-oauth-token` en tiempo de ejecución, sin copiarlo dentro del plist.

**Aprendizajes:**

1. **«Cargado» no es «corriendo», y «corriendo» no es «autenticado».** El agente pasó por
   los tres estados aparentando estar bien: `launchctl list` mostraba pid y estado 0
   mientras moría por permisos; después arrancaba y corría el gate en VERDE mientras cada
   iteración fallaba por credencial. Cada capa daba señal verde sobre la de abajo rota.
2. **El precedente que parecía probado no lo estaba.** Se copió el plist de eauto por ser
   «el que lleva meses funcionando». Figura cargado con pid `-`: no corre. El motor de
   eauto que sí avanza se arrancó a mano desde una terminal, heredando una sesión ya
   autenticada. Ningún launchd de esta máquina se había autenticado nunca. Verificar que el
   modelo funciona **antes** de copiarlo, no después de que falle.
3. **Un gate verde no dice nada sobre si el motor puede construir.** `gate_specs` y
   `verify-refs` corrían en VERDE y el loop elegía su AC; el fallo aparecía recién al
   invocar al builder. Son capas independientes y hay que verificarlas por separado.

---

## 2026-07-26 (noche) · RESUELTO: la cookie de sesión salía `Secure` sobre `http://`

**Causa raíz.** `OPCIONES_COOKIE` decidía el atributo `Secure` con
`process.env.NODE_ENV === "production"`. Esa condición no responde la pregunta que
importa —«¿esta conexión va cifrada?»—, solo dice cómo se compiló el bundle. El servidor
standalone fija `NODE_ENV=production` **siempre**, así que al servir por `http://` (el
e2e, y también una tablet contra un equipo de la red local sin certificado) se emitía una
cookie `Secure` sobre una conexión sin TLS. **El navegador la descarta entera.** El
operador queda sin sesión después de un login que respondió 200 y dejó su turno abierto en
la base — sin ningún error visible en ninguna capa.

De ahí salía todo lo demás en cascada: sin cookie, el middleware rechazaba `/inicio`, la
navegación del router quedaba «colgada», y el fallback chocaba con el mismo rechazo.

**Arreglo** (`identidad/sesion.ts`): `Secure` se decide por el protocolo REAL de la
petición — `x-forwarded-proto` (último salto, el que pone el proxy de borde; mismo
razonamiento que `ipDelCliente`) y si no, `request.nextUrl.protocol`. En Railway la
petición llega por https y sigue saliendo `Secure` igual que antes: **no se afloja nada en
el despliegue real**, solo deja de mentir cuando no hay TLS.

De paso, el `Set-Cookie` se serializa a mano con `Max-Age` y **sin `Expires`**:
`cookies.set()` de Next deriva un `Expires` cuya fecha lleva una coma, y la coma es el
separador de headers repetidos — cualquier intermediario que junte o reescriba headers
puede partir el `Set-Cookie` en dos fragmentos rotos. Se vio partido de verdad en el trace
(`Expires=Mon` | `27 Jul 2026 …`). No era la causa del fallo, pero es un riesgo real en
producción y salía gratis cerrarlo. Mismo tratamiento en el logout (`cookies.delete()`
emitía `Expires=Thu, 01 Jan 1970 …`, otra coma: si se parte, la sesión no se cierra al
apretar «Salir»).

**Estado:** `check.sh --full` VERDE — 12 pasos, 0 fallas, 0 saltados. **e2e 10/10**,
incluido el test 8 del repartidor que la entrada del mediodía daba por flaky: no era
flaky, era este mismo bug. Se quitó el fallback de 2 s que se había puesto en
`ingresar/page.tsx` sobre el diagnóstico equivocado; el código volvió a su forma simple.

**Aprendizajes (los caros de hoy):**

1. **Comparé dos escenarios distintos y saqué la conclusión contraria.** Vi el
   `Set-Cookie` partido en el trace y lo descarté como «artefacto del parser» porque en
   paralelo `context.cookies()` me mostraba la cookie bien guardada — pero esa
   verificación la corrí contra un servidor levantado a mano, no contra el del test
   runner. Dos escenarios, una conclusión. Costó horas.
2. **`NODE_ENV` no es una señal de transporte.** Dice cómo se compiló, no si hay TLS.
   Cualquier decisión sobre `Secure`, cookies o redirecciones a https tiene que mirar el
   protocolo de la petición.
3. **El «test flaky» no era flaky.** Se documentó como no-determinista y se propuso
   supervisarlo; en realidad fallaba siempre por una causa concreta. Rotular algo de
   flaky es una hipótesis, no un diagnóstico — y rotularlo mal apaga la búsqueda.
4. **`.next-e2e` entraba al lint.** El distDir propio del e2e no estaba en los ignores de
   ESLint (que solo cubrían `.next`), y sumaba ~12.700 quejas sobre JS minificado
   generado: el gate en rojo por un artefacto de build. Corregido a `.next*`.

---

## 2026-07-26 (tarde) · Diagnóstico del e2e flaky — causa raíz acotada, NO resuelta

> **Superada por la entrada de la noche.** El mecanismo descrito acá (la cookie no llega
> al fetch RSC) era correcto; la causa que se le atribuyó, no. Se conserva porque el
> registro de las hipótesis descartadas sigue siendo útil.

**Contexto.** Retomando `camino-dorado.spec.ts` tras el cierre de la entrada anterior:
el test 2 («entrar con PIN abre el turno») falla de forma **100% determinística** bajo
`pnpm exec playwright test` real (5/5 corridas, incluyendo con `retries:1`), y **nunca**
falla en ninguna reproducción manual equivalente fuera del test runner (6+ intentos con
`chromium.launch()` directo, mismo device, mismos permisos, misma secuencia de
navegación). Esto es distinto del flaky de `:223` (reparto) documentado arriba — ese
alternaba pasa/falla; este es fijo.

**Arreglado de paso (commit `be49296`, ya en verde):**
- El e2e corría contra `next dev` (compila cada ruta en su primera visita, robaba el
  timeout de 30s de un click bajo la carga del gate completo). Ahora corre contra el
  build de producción real, el mismo binario standalone que despliega Railway.
- `next start` es incompatible con `output:"standalone"` (Next lo advierte, pero el
  síntoma real era mudo: `/api/auth/login` respondía pero el navegador nunca completaba
  la conexión). Corregido usando `node <dist>/standalone/.../server.js` directo.
- Fallback en `ingresar/page.tsx`: si `router.push("/inicio")` no completa la transición
  en 2s tras un login exitoso, fuerza `window.location.assign("/inicio")`.

**Lo nuevo, esta sesión — diagnóstico instrumentado en profundidad:**

Con logging real en servidor (`console.error` temporal en `route.ts` y `sesion.ts`,
revertido) se confirmó el mecanismo exacto: el login SIEMPRE crea la sesión con éxito
(200, cookie `Set-Cookie: kp_sesion=...` presente). El fetch RSC interno que
`router.push()` dispara 60ms después SIEMPRE llega **sin la cookie** — el middleware
(`middleware.ts`, que solo verifica *existencia* de la cookie) la rechaza antes de que la
petición llegue siquiera al Server Component de `/inicio` (`DIAG-SESION` nunca se
imprimió). Next.js responde 200 con el payload RSC de `/ingresar` embebido (su forma de
comunicar un redirect a una navegación client-side), no un 307 — por eso no hay error
visible y el router queda «colgado» ahí. El fallback de 2s, al disparar un GET real,
choca con el mismo rechazo (307 explícito esta vez) — confirma que NO es una carrera de
milisegundos que un poco más de tiempo resuelve.

**Hipótesis probadas y descartadas, cada una con evidencia directa (no por descarte):**
1. Cookie `Secure` sobre `http://localhost` sin TLS → `context.cookies()` confirma que
   Chromium SÍ la guarda (trata `localhost` como origen de confianza).
2. Contaminación de estado por reutilizar un proceso servidor de pglite entre resiembras
   manuales (motor embebido de un solo proceso — un `rmSync` del dir bajo un proceso vivo
   sí lo corrompe, y de hecho dio un 401 espurio una vez) → descartado como causa real
   reiniciando el proceso en cada resiembra; el patrón real ocurre con servidor 100% fresco.
3. Service Worker sirviendo `/inicio` desde caché stale → el código (`sw.js` v2) usa
   estrategia red-primero para cualquier ruta no pública; confirmado que no interfiere
   esperando explícitamente a `controller:true` antes del login.
4. `InterceptarSesionVencida` (parchea `window.fetch` global) interceptando el fetch RSC
   interno del router → descartado corriendo el test real con el componente desactivado:
   falla idéntico.
5. Condición de carrera transitoria (escritura→lectura en pglite bajo carga) → descartado
   con `retries:1`: el retry falla exactamente igual, mismo síntoma, mismo timeout.

**Lo que queda sin explicar:** por qué la cookie recién seteada por `fetch()` no viaja en
el fetch RSC que Next.js dispara ~60ms después, **solo** bajo `@playwright/test` (test
runner con fixtures) y nunca bajo `playwright` (librería core, `chromium.launch()`
directo) — con `trace` activo o inactivo en ambos casos (se probó con y sin). Esa es la
única variable que no se pudo igualar entre reproducción fallida y exitosa. Puede ser un
bug conocido de Next.js App Router (cookie recién seteada + navegación RSC inmediata) que
el propio test runner de Playwright expone por algún detalle de timing/CDP que
`chromium.launch()` puro no reproduce — no confirmado a nivel de mecanismo interno.

**Decisión:** no seguir cazando sin herramientas más profundas (debugger del worker
process de Playwright, o reportar upstream a Next.js con un repro mínimo). El fallback de
2s queda como defensa legítima para producción (Postgres real, sin este patrón — nunca se
reprodujo fuera de pglite+test-runner). El e2e queda **rojo, no verde falso**: el test 2 y
los 6 que dependen de él en serie no corren. `AC-POD-04` sigue abierto por esto.
**Próximo que retome esto:** empezar por reproducir con un repro mínimo de Next.js (sin
el resto de la app) para descartar que sea específico de KiloPan antes de reportarlo
upstream.

---

## 2026-07-26 · Auditoría de prevuelo y reparación del arnés

**Contexto.** El checklist prevuelo de El Elíxir (cap. 14, 20 casillas) se corrió por
primera vez contra KiloPan, meses después de haber despegado. Resultado inicial:
6 limpias · 6 parciales · 8 fallidas.

**El patrón, que importa más que el puntaje:** las 8 fallidas eran TODAS del arnés y la
operación (clasificación de fallas del gate, tests del arnés, selector de modelo, launchd,
lock, continuidad, bitácora, marcador de DONE). Ninguna era del producto. La definición
(§2 variable norte, §3 alcance, §4 modelo de datos) y el contrato pasaron limpio.

Eso descartó la opción de reconstruir desde cero: habría regenerado justo la parte que
pasa —1.360 líneas de SQL, 38 funciones/triggers, 63 tests de invariantes— sin arreglar
ninguna de las que fallan.

**Cerrado hoy:**

- **Contrato (casilla 8).** `specs/kilopan/` con 11 specs y 77 ACs, extraídos del plan
  conservando sus ids, que ya estaban referenciados en código y tests. `gate_specs`
  ahora falla si `specs/` está vacío, si una `Fuente: §N` no resuelve en el maestro, si
  hay ids duplicados, o si un `[x]` dice «falta» en su propio texto.
- **22 ACs recuperados.** Estaban enterrados dentro de ítems marcados `[x]` cuyo texto
  confesaba trabajo pendiente. El plan reportaba 0 abiertos y `loop.sh` salía de
  inmediato: **el motor llevaba días detenido creyendo que había terminado.**
- **Gate (casillas 4, 5, 20).** `exit 3` = INFRA, distinto del rojo de código: sin
  toolchain el gate aborta en vez de reportar verde con pasos saltados. Marcador
  `last-green.tag` en disco, estampado SOLO por el gate completo sin saltos.
- **Arnés probado (casillas 10b, 11).** `prueba-arnes.sh`: 29 pruebas que ejercen cada
  guard contra el caso real que dice proteger.
- **Lock (casilla 15).** `lock.sh` con exclusión por `mkdir` y robo atómico de huérfanos.
  Verificado: un segundo `loop.sh` rebota con exit 7 y no construye.
- **Selector de modelo (casilla 12).** Ruteo por fase y por naturaleza del ítem, con
  escalación de dos strikes. Probado contra 5 líneas reales de plan.

**Aprendizajes (cicatrices de hoy):**

1. **`eauto-crm-next` tampoco tenía el lock.** Su `watchdog.sh` maneja `rc 7 = lock`
   pero ningún script emite jamás ese código. El guard estaba declarado y no existía —
   el modo de falla exacto del cap. 14: *un guard que nunca dispara es indistinguible de
   uno roto*. No había nada que portar; hubo que escribirlo.
2. **`lock.sh` nació roto y su propio test lo atrapó a las dos horas.** Registraba `$$`,
   el pid del propio `lock.sh`, que muere al terminar; el segundo builder leía un pid
   muerto, lo daba por huérfano y lo robaba. El lock jamás bloqueaba a nadie **y se veía
   perfecto**. Ahora registra el pid del proceso que lo sostiene.
3. **`\b` no es ERE portable.** El selector clasificaba distinto según quién lo invocara,
   porque `grep` es ugrep en el shell interactivo y `/usr/bin/grep` (BSD) bajo launchd.
   Un selector que rutea distinto según el invocador es peor que uno tonto.
4. **`presupuesto-perf` rotulaba «PASA» una pantalla que se pasaba del presupuesto** —
   la palabra que uno busca en verde marcando un resultado en rojo. Ahora «EXCEDE».
5. **Dos sesiones construyeron KiloPan a la vez durante horas**, mientras la auditoría
   marcaba la casilla 15 como hueco. La casilla no era una hipótesis.

6. **`camino-dorado.spec.ts:223` («el repartidor entrega con foto y GPS») es FLAKY.**
   Sobre el mismo commit `3c27cf5`: pasó, luego agotó los 30 s en un `locator.click`,
   luego volvió a pasar (10/10 en 23 s). No es una regresión — y por eso mismo es
   peligroso: **un test flaky dentro del gate lo pone rojo al azar, y el watchdog
   trata el rojo como árbol roto**. Con dos fallos seguidos revertiría commits sanos.
   Estabilizarlo es prerequisito para dejar el motor desatendido; hasta entonces,
   supervisar. Pertenece al territorio de `AC-POD-04` (ejercitar el POD de punta a
   punta), que sigue abierto.

**Estado al cierre:** `check.sh --full` VERDE — 12 pasos, 0 fallas, 0 saltados.
Marcador `verde-20260726-153226`. 22 ACs abiertos, el primero `AC-ID-07`.
