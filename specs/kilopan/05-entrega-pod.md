# 05 — Entrega con POD (offline-first)

Fuente: §3

Módulo 5 de los siete y **el mecanismo de confianza central del producto**: la foto con
GPS y receptor es lo que termina las discusiones de reparto. Único módulo offline.

F4 Entregar ≤4 toques. Todo funciona sin señal y sincroniza solo (outbox local,
`client_uuid` idempotente).

**Permiso de GPS denegado bloquea la confirmación y lo dice; precisión mala jamás
bloquea** — el pan no espera (§4).

## Criterios de aceptación

- [x] (P1) Outbox del cliente en IndexedDB (sin Dexie: ~80 líneas propias en vez de una
      dependencia más que auditar) con reintento al volver `online` y cada 30 s +
      `POST /api/sync` idempotente. Probado por HTTP: 3 replays del mismo `client_uuid`
      ⇒ UNA entrega de 12 kg en el dashboard, y un GPS `(0,0)` sale como rechazo
      explícito en vez de girar en la cola para siempre [AC-POD-02]
- [x] (P1) F4 Entregar: `/ruta` con la parada activa destacada, obturador real, receptor
      precargado y confirmación. GPS denegado bloquea y lo dice; precisión mala entra
      marcada «(impreciso, igual sirve)». El repartidor ve km y kg, **jamás CLP** —
      verificado en pantalla. Foto por `getUserMedia` in-app (nunca `<input type=file>`,
      que permitiría adjuntar una foto vieja de la galería), JPEG ~400 KB, sha256 sobre
      el blob comprimido, subida a `/api/fotos`; sin señal el binario queda en la cola de
      fotos del outbox [AC-POD-03]
- [ ] (P1) Flujo POD ejercitado de punta a punta con el seed: e2e «8 · el repartidor
      entrega el pedido con foto y GPS» en `camino-dorado.spec.ts:223`. ⚠️ El test es
      INESTABLE: sobre el mismo commit pasó, agotó los 30 s y volvió a pasar.
      Estabilizarlo es prerrequisito para dejar el motor desatendido [AC-POD-04]
      — **Anexo D (auditoría 2-ago-2026): HUECO confirmado.** El propio texto del AC ya
      declaraba la inestabilidad; formalizado como hueco porque un test flaky no es
      evidencia repetible — coincide con `docs/PROMPT_CORRECTIVO.md` §9.2 ("se estabiliza
      o se saca del gate con su ítem abierto").
- [ ] (P1) Rechazo total y parcial con motivo de catálogo cerrado: `/ruta` define el
      catálogo (`rechazo`: «Cliente rechazó el pedido»), reporta rechazos por
      `clientUuid` desde el outbox y muestra «Entregada parcial — X de Y» cuando
      `gramos_entregados < gramos_pedidos` [AC-POD-05]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Ningún test toca el flujo de rechazo
      desde `/ruta` ni el texto «Entregada parcial — X de Y». Además el catálogo
      "cerrado" no se valida en el servidor (`api/sync/route.ts` solo chequea
      `!!e.motivoRechazo`, cualquier string pasa) — sin test que lo ejercite, no hay
      evidencia de que la UI real funcione como se describe.

- [x] (P0) **Bandeja de pendientes** persistente, alcanzable desde cualquier pantalla, con
      todo lo que la cola no pudo subir y **por qué**. Nada que la cola rechace desaparece
      sin una decisión del operador: hoy un rechazo se pierde de vista y la venta se
      evapora sin que nadie se entere (`docs/PROMPT_CORRECTIVO.md` §5, Ola 2) [AC-POD-06]
      — **Cerrado 3-ago-2026 (sesión supervisada).** La persistencia ya existía y era
      INVISIBLE: `sincronizar()` movía a la store `rechazados` de IndexedDB lo que el
      servidor devolvía con 4xx, y `outbox.ts:129-132` lo decía con todas las letras — «la
      bandeja que la lee (Ola 2) todavía no existe». El dato estaba a salvo en disco y
      nadie podía verlo: el operador veía la venta salir de la cola y suponía que había
      subido. Se perdía de vista, no del disco — que es exactamente lo que el AC describe.
      `app/pendientes/page.tsx` lo lee con `listarRechazados()` y muestra tipo, **motivo**
      y fecha por registro; quitarlo exige tocar «Ya lo resolví», que llama
      `descartarRechazado()` — la decisión del operador que el AC pide, nunca un borrado
      automático. Es cliente y no Server Component a propósito: los rechazados viven en
      IndexedDB del dispositivo, no en Postgres; el servidor no los conoce ni puede
      conocerlos, son justamente los que nunca llegaron. Alcanzable desde los CUATRO roles
      (`navegacion.ts`), porque cualquiera de ellos puede generar un registro rechazado.

## Ola 4 — Robustez: offline honesto (`docs/PROMPT_CORRECTIVO.md` §3, R5)

- [x] (P0) **`/ruta` sabe si está offline — hoy no lo sabe.** `comun/useEnLinea.ts` existe
      y su propio comentario dice «cada pantalla con cola offline llama este hook»; lo
      llaman `pesar/page.tsx` y `vender/page.tsx`, que por regla (`AGENTS.md`: «Offline es
      SOLO el módulo de reparto») exigen red local y NO deberían necesitarlo. `/ruta` —el
      único módulo con cola offline de verdad— tiene cero referencias al hook. Un
      repartidor sin señal en `/ruta` no tiene ninguna indicación de que está offline: un
      POD puede quedar en cola sin que la pantalla lo diga distinto de uno que subió.
      Cerrar exige: `/ruta` (y la confirmación de POD dentro de ella) usa `useEnLinea()`
      y muestra el estado real; retirar el hook de `pesar`/`vender` o dejarlo si algún AC
      futuro lo justifica, pero no como está — sin uso donde se necesita y con uso donde
      la regla dice que no debería offline nunca [AC-POD-07]
      — **Mitad hecha, mitad bloqueada (3-ago-2026). NO cerrado, a propósito.**
      **HECHO:** `/ruta` usa `useEnLinea()` y el chip dice la verdad. El defecto medido era
      peor que «no sabe»: `ruta/page.tsx` montaba `<ChipEstadoConexion pendientes={…} />`
      sin la prop `online`, y el componente tiene `online = true` por defecto, así que con
      la cola vacía la pantalla afirmaba «Sincronizado» en VERDE con y sin señal — y sin
      condición de montaje, al revés que `/pesar` y `/vender`. Evidencia:
      `e2e/pod-offline.spec.ts` pierde la señal con la ruta ya cargada y exige «Sin
      conexión»; contra el código sin la prop el caso se pone ROJO con el mensaje exacto
      del defecto (`Received string: "Sincronizado"` estando offline), y también exige que
      el chip VUELVA al recuperar señal. Se pierde la señal con la pantalla abierta y no
      navegando porque `public/sw.js:84-100` responde `caches.match("/ingresar")` a toda
      página autenticada pedida sin red: un caso que navegue offline aterriza en el login y
      pasa en verde sin ejercer nada. Es además el escenario real del furgón.
      **Segunda mitad, decidida por Alexis (3-ago-2026):** la contradicción era real —el
      código en `pesar/page.tsx:298`/`vender/page.tsx:146` ya llama `enviarOEncolar` (cola
      real ante un corte de WiFi), y el maestro decía que eso estaba fuera del MVP
      (`PROMPT_MAESTRO.md:94`, `:66`). Se resolvió a favor del código, que ya funciona en
      producción sin incidentes reportados: cambiarlo habría sido el riesgo más caro para
      corregir un texto. El hook queda en `pesar`/`vender` —es robustez ante un corte
      momentáneo, no una estación offline diseñada como `/ruta`— y el maestro y
      `AGENTS.md` se actualizaron para decir la verdad (`PROMPT_MAESTRO.md` §2/FUERA-DEL-MVP,
      `AGENTS.md`: «la UX de offline es solo reparto», distinto de «offline es solo
      reparto»). AC cerrado con las dos mitades hechas: ninguna pantalla miente ya.

## Notas de implementación

- **La foto era falsa hasta el 25-jul-2026**: `capturarFoto()` calculaba el sha256 de un
  texto (`${parada}-${Date.now()}`), no de una imagen, y nunca llamaba a `/api/fotos`.
  La evidencia de entrega —el mecanismo de confianza central del producto— no existía.
  `comun/camara.ts` estaba escrito y correcto, solo desconectado. Este es el caso de
  referencia de por qué un AC no se cierra sin test que lo ejercite de verdad.
- Segundo POD de otro dispositivo rebota 409 y la app muestra «ya entregado por X».
- Corrección de un POD cerrado = fila nueva con `supersede_id`, jamás UPDATE.
