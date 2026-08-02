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

## Notas de implementación

- **La foto era falsa hasta el 25-jul-2026**: `capturarFoto()` calculaba el sha256 de un
  texto (`${parada}-${Date.now()}`), no de una imagen, y nunca llamaba a `/api/fotos`.
  La evidencia de entrega —el mecanismo de confianza central del producto— no existía.
  `comun/camara.ts` estaba escrito y correcto, solo desconectado. Este es el caso de
  referencia de por qué un AC no se cierra sin test que lo ejercite de verdad.
- Segundo POD de otro dispositivo rebota 409 y la app muestra «ya entregado por X».
- Corrección de un POD cerrado = fila nueva con `supersede_id`, jamás UPDATE.
