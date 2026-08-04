# 02 — Catálogo y pesaje

Fuente: §3

Módulo 2 de los siete. La balanza **es** la app: cifra en 96 px, teclado numérico propio,
destino en un toque. Requiere red local de la panadería — el pesaje **no** es offline
(offline es solo el módulo de reparto, §4).

F1 Pesar ≤4 toques; repetir producto: 2 toques.

## Criterios de aceptación

- [x] (P1) F1 Pesar ≤4 toques: cifra 96/700, teclado numérico propio (teclas ≥64 px,
      coma es-CL, jamás el teclado del sistema), destino en un toque. Probado en vivo
      end-to-end: clic real → API → BD → mensaje verde «Pesado: 2,500 kg · Frica».
      Reparto visible pero deshabilitado hasta el hito de despacho; `hornada_id` NULL en
      fase 1 [AC-PES-02]
- [x] (P1-SEC) Test centinela «báscula mal tipeada»: `pan.es_outlier_pesaje()` detecta
      >3× la mediana del producto. Fase 1 sin dimensión cliente — se agrega cuando
      `pedido_linea_id` tenga FK real [AC-PES-03]
- [ ] (P2) Foto de respaldo opcional (decisión #1, nivel 1): toggle
      `pesaje_foto_obligatoria` en `/admin`, **solo admin** y deliberadamente NO en la
      pantalla de pesaje, para que quien pesa no lo apague cuando le incomode. Obturador
      real por `getUserMedia`, compresión ~400 KB, `sha256` sobre el blob comprimido.
      La exigencia se valida en el SERVIDOR; `pan_app` puede marcar `foto_estado` pero
      no reapuntar `foto_sha256`. 2 tests de invariante lo prueban [AC-PES-04]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Los 2 tests de invariante solo prueban
      que `pan_app` no puede reapuntar `foto_sha256` DESPUÉS de creado — ninguno prueba
      que `/api/pesajes` RECHACE un pesaje sin foto cuando el toggle está en 1. Es
      exactamente la clase de bug que ya pasó una vez con esta misma AC (nota de
      implementación abajo): un mutante que borre el bloque `exigeFoto` de `route.ts`
      no haría fallar ningún test existente.
- [ ] (P2) Báscula conectada opcional (decisión #1, nivel 2): Web Bluetooth contra el
      perfil GATT Weight Scale, con degradación a manual. En iPhone este camino nunca se
      ofrece (Web Bluetooth no existe en Safari) [AC-PES-05]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** `bascula.ts` no tiene ningún test, y
      el propio `AC-PES-09` (abierto) ya declara que esto "está escrito pero no
      verificado contra hardware" — sin contradicción posible.
- [ ] (P2) Cola con reintento automático (decisión #4) en pesaje: respaldada en
      sessionStorage, reintento cada 15 s y al volver `online`, con chip «Sin conexión —
      N por subir». Un rechazo 4xx **no** se encola (es una respuesta que el operador
      tiene que ver ahora); solo se reintenta lo que falló por red [AC-RED-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El AC describe un mecanismo
      (sessionStorage, 15 s) que ya no coincide con el código real (IndexedDB vía
      `outbox.ts`, 30 s) — ni la versión descrita ni la real tienen test, unit o e2e.
- [x] (P1) Pesaje con destino `reparto` imputado a una línea de pedido: sin
      `pedido_linea_id` no entra (CHECK de §4), y el stock de mostrador **no** se lleva lo
      que se pesó para reparto — probado en `db/test-invariantes.mjs` en ambos sentidos
      [AC-PES-06]
- [x] (P2) Estado de mermas recuperables (decisión #6): máquina de estados en
      `pesajes.estado_merma`; la vista de TCK mueve `recuperada_con_venta` de
      `g_merma_tipificada` a `g_venta` sin cambiar la fórmula — probado: 3.000 g pasan
      de merma a venta y la TCK sigue cerrando al 100 % [AC-MERM-01]
- [x] (P1) Orden de productos **por frecuencia real** de pesaje, no alfabético como hoy.
      §5 F1 lo exige para que repetir producto cueste 2 toques. Requiere trackear
      frecuencia. Test: sembrar frecuencias desiguales y fallar si la grilla no las
      respeta [AC-PES-07]
      — Probado: `/api/productos` ordena por `count(*)` de `pan.pesajes` desc, empate a
      alfabético (route.ts). e2e `frecuencia-pesar.spec.ts` siembra Frica=10, Hallulla=5,
      resto=0 y falla si la grilla no pone Frica antes que Hallulla y ambas antes que
      Dobladitas (que en alfabético iría primera). Gate --full verde, 0 saltados.
- [ ] (P1-SEC) UI de re-confirmación explícita cuando `pan.es_outlier_pesaje()` devuelve
      true: `/pesar` tiene el estado `confirmar_outlier` y conserva el sha256 de la foto
      entre las dos vueltas de `enviar()` — el maestro no fotografía dos veces la misma
      bandeja. Verificado en `apps/kilopan/src/app/pesar/page.tsx` [AC-PES-08]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** La propia evidencia citada es una
      lectura de archivo ("Verificado en pesar/page.tsx"), no un test automatizado —
      ningún unit ni e2e ejercita el estado `confirmar_outlier`.
- [ ] (P2) Validar el camino GATT contra una báscula real antes de darlo por bueno. Las
      marcas comunes en panaderías chilenas (Toledo, CAS, Torrey) suelen usar serie
      propietario, no GATT — `AC-PES-05` está escrito pero no verificado contra hardware
      [AC-PES-09]
- [ ] (P2) UI de resolución de mermas al día siguiente: hoy la máquina de estados existe
      y la TCK la respeta, pero nadie puede mover una merma a `recuperada_con_venta`
      desde pantalla [AC-MERM-02]

## Notas de implementación

- `AC-PES-04` estuvo marcado `[x]` falsamente hasta el 25-jul-2026: las columnas y el
  toggle existían, pero `/api/pesajes` no aceptaba el hash y `/pesar` nunca abría la
  cámara. El control del dueño estaba apagado en los hechos. Es el precedente que
  justifica que toda exigencia se valide en el servidor y tenga test de invariante.
