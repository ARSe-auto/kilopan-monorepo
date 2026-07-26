# Auditoría de red-team + experiencia — KiloPan

_Ronda posterior a las 6 tandas de la auditoría de navegación. Fecha: 26-jul-2026._

## Veredicto

KiloPan resiste bien los ataques que ya tenía documentados: la matriz de autorización rol×endpoint está **sólida** (todas las escrituras y las lecturas con plata transaccional rebotan 403 al repartidor; las cookies/headers falsos rebotan 401), la idempotencia por `client_uuid` funciona, el precio lo pone el servidor, y los invariantes de BD que se probaron aguantaron. La verificación adversarial **refutó 12 de 40** hallazgos crudos del red-team (falsos positivos como "el repartidor ve el precio de vitrina", que es catálogo público), lo que da confianza en los que quedaron.

Pero quedan grietas reales, y dos de ellas son plata:

- **Se puede vender pan que no existe** por un camino que la defensa anti-sobreventa no cubre (capitalización del UUID del producto).
- **El cierre de caja muestra el monto esperado antes de contar**, anulando el único control anti-robo por el que paga el dueño.

Y un patrón transversal de robustez: **decenas de entradas malformadas producen HTTP 500 con el mensaje crudo de Postgres** (nombres de constraints y columnas) en vez de un 400 validado — no es explotable para robo, pero filtra el esquema y ensucia la operación.

En experiencia, el concepto es fuerte (offline-first, teclas grandes) pero **la app se rompe justo donde se mueve la plata y donde el personal opera solo**: un PIN que empieza en 0 es intecleable, un repartidor sin GPS no registra nada, y varias pantallas muestran "vacío mentiroso" (un error de red se ve igual que "no hay nada").

## Metodología

- **Entorno aislado y desechable**: base PGlite propia en `localhost:3301` con las 14 migraciones aplicadas, **nunca contra Railway/producción**. Sembrado con stock, clientes, un pedido, y 10 identidades de ataque (usuario + equipo propio cada una, para no pisarse las sesiones).
- **Frente 1 — Red-team de seguridad/lógica** (50 agentes): un "panadero ladino" por cada una de 10 lentes (autorización, precios, stock, idempotencia, POD, caja, DTE, merma, entrada, sesiones) atacó el servidor vivo con `curl`, leyendo el código para formular ataques precisos. **Cada hallazgo se verificó adversarialmente** re-ejecutando el ataque e intentando refutarlo. Resultado: **40 hallazgos crudos → 27 confirmados, 1 plausible, 12 refutados.**
- **Frente 2 — Auditoría de experiencia** (11 agentes): 10 pantallas evaluadas con triple lente (QA de Apple + consultor McKinsey + panadero simplón/ladino) leyendo el código real de cada flujo, más una síntesis priorizada por impacto de negocio. Resultado: **83 hallazgos brutos → 21 priorizados.**
- **Verificación humana**: los hallazgos de severidad alta se re-confirmaron a mano contra el código y, cuando aplica, en ejecución en vivo.

## Conteo

| Frente | Alta | Media | Baja | Total útil |
|---|---|---|---|---|
| Seguridad/lógica (confirmados) | 4 | 4 | 19 | 27 |
| Experiencia (crudos) | 19 | 43 | 21 | 83 |

> Red-team: 12 hallazgos refutados por la verificación adversarial (ver Anexo). 1 plausible sin confirmar.

---

## A. Seguridad y lógica de negocio (red-team confirmado)

### [ALTA] Sobreventa de pan fantasma: el acumulador de stock se burla con el UUID del producto en distinta capitalización (minúscula vs MAYÚSCULA)
- **Lente / endpoint:** stock · `POST /api/ventas`
- **Esperado:** 409 Stock insuficiente: las dos líneas son del MISMO producto (uuid case-insensitive), 11100+11100=22200 g > 18500 g disponibles; el guard gramosPorProducto de ventas/route.ts debería sumarlas y rechazar, igual que cuando llegan en la misma capitalización.
- **Observado:** 200 OK {"id":"f2aa1526-c982-4f33-80c7-c951d4e89ba0","totalClp":46398}. GET /api/productos justo antes: Hallulla stock_disponible_g=18500; justo después: -3700. Se vendieron y facturaron 22200 g contra 18500 g reales = 3700 g de pan inexistente, con venta y total válidos.
- **Impacto:** El panadero ladino vende pan que no está en el mesón: el stock queda NEGATIVO, la venta se registra y cobra ($46398) sin respaldo físico, y la conciliación diaria (TCK) y el cierre de caja quedan descuadrados sin que nada avise. Es exactamente el agujero 'dos líneas del mismo producto' que ventas/route.ts declara haber tapado, reabierto por la asimetría Map de JS (case-sensitive) vs tipo uuid de Postgres (case-insensitive). Fix en apps/kilopan/src/app/api/ventas/route.ts: normalizar la clave del Map (p.ej. productoId.toLowerCase()) y/o hacer cumplir stock>=0 en la BD (chequeo dentro del CTE de insert o trigger/constraint), no confiar solo en el acumulador de la capa app.
- **Verificación:** Reproducido en vivo contra localhost:3301 (base aislada). Control con MISMA capitalizacion (dos lineas lowercase 11100+11100=22200 > 18500) devuelve 409 "Stock insuficiente (disponible: 18500 g)" y el stock queda intacto en 18500. El ATAQUE con capitalizacion MIXTA (linea1 lowercase + linea2 UPPERCASE del mismo UUID) devuelve 200 OK {"id":"5b4f4afd-476c-4377-9e17-94f02db8ff9e","totalClp":66378} y el stock cae de 18500 a -3700, es decir se descontaron e insertaron ambas lineas (22200 g contra 18500 g reales = 3700 g de pan fantasma), con venta registrada y facturada. Use Integral (2990/kg -> to
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-stock.jar -X POST http://localhost:3301/api/ventas -H 'Content-Type: application/json' -d '{"clientUuid":"9e0e9fb7-1111-4267-868a-3f43fe082301","medioPago":"efectivo","lineas":[{"productoId":"32043713-1fef-4943-b54f-8282f6a35ba7","gramos":11100},{"productoId":"32043713-1FEF-4943-B54F-8282F6A35BA7","gramos":11100}]}'   # (usar un clientUuid nuevo cada vez; cada línea debe ser <= stock actual y la suma > stock). Verificar: curl -s -b /tmp/qa-stock.jar http://localhost:3301/api/productos
  ```

### [ALTA] Carrera check-then-insert en venta sin lock: rebota bien en pglite (target vivo), pero es riesgo latente de sobreventa en el pool Postgres de producción
- **Lente / endpoint:** stock · `POST /api/ventas`
- **Esperado:** Con N ventas concurrentes que cada una pide todo el stock, solo UNA debe cerrar; el resto 409. En el código, `select pan.stock_disponible()` y el INSERT son queries separadas SIN `for update`/advisory lock/serializable, y venta_lineas no tiene constraint stock>=0.
- **Observado:** En 3 pruebas (8, 6 con ventana ancha de 52 queries, y 12 con barrier de Python) SIEMPRE ganó 1 sola (200) y el resto 409 'disponible: 0 g'; el stock quedó exactamente en 0, NUNCA negativo. La defensa de facto se sostiene porque pglite serializa las queries en una sola conexión. Comportamiento CORRECTO en el target vivo.
- **Impacto:** Sin pérdida en el entorno atacado. Pero db.ts documenta que producción usa un pool Postgres (max:10) con paralelismo real: ahí dos ventas en conexiones distintas pueden leer el mismo stock antes de que ninguna inserte y sobrevender. Recomendación preventiva: mover la garantía de stock a la BD (chequeo atómico dentro del INSERT o trigger), que además cerraría el finding crítico #1 de raíz. Se reporta como info porque en localhost:3301 el ataque rebotó correctamente.
- **Verificación:** Reproduje ambas cosas contra localhost:3301 (base viva). (1) La forma ingenua del reproductor (8 ventas concurrentes de 1 linea pidiendo todo el stock) dio EXACTO lo que reporto el red-team: 1 gana (200), 7 dan 409 'disponible: 0 g', stock queda en 0, nunca negativo. Hasta ahi el reporte es correcto. (2) PERO su conclusion clave ("comportamiento CORRECTO en el target vivo / solo riesgo latente en el pool de produccion / severidad info") es FALSA. Ensanchando la ventana critica -carrito de 20 lineas, que fuerza 20 queries pan.precio_vigente entre el UNICO check de stock (ventas/route.ts:97, sel
- **Reproductor:**
  ```bash
  S=$(curl -s -b /tmp/qa-stock.jar http://localhost:3301/api/productos | python3 -c "import sys,json;print([p['stock_disponible_g'] for p in json.load(sys.stdin)['productos'] if p['nombre']=='Integral'][0])"); for i in $(seq 1 8); do U=$(python3 -c 'import uuid;print(uuid.uuid4())'); curl -s -o /dev/null -w "req$i %{http_code}\n" -b /tmp/qa-stock.jar -X POST http://localhost:3301/api/ventas -H 'Content-Type: application/json' -d "{\"clientUuid\":\"$U\",\"medioPago\":\"efectivo\",\"lineas\":[{\"productoId\":\"22fbbfa8-a6b6-48bb-b5f4-e47df76e3a71\",\"gramos\":$S}]}" & done; wait
  ```

### [ALTA] Punto de miles chileno en montoTotal trunca el monto: "25.000" se registra como $25 (subvaluacion 1000x del DTE y del fiado)
- **Lente / endpoint:** dte · `POST /api/dte`
- **Esperado:** El servidor deberia rechazar (400) un monto con separador de miles, o interpretarlo como 25000. montoTotal solo deberia aceptarse como entero limpio.
- **Observado:** 200 {"id":"d1a2c6cc-..."}. En route.ts se hace Number(cuerpo.montoTotal); Number("25.000")===25 y Number.isInteger(25) pasa el guard. GET /api/facturar confirma monto_total:25 para el folio 8001, y GET /api/clientes muestra saldo_pendiente_clp de Don Lucho en 26025 (la guia de 25000 solo sumo 25 al fiado).
- **Impacto:** El panadero ladino (o cualquiera que teclee el monto en formato es-CL) registra una guia/factura de $25.000 como $25: subdeclara ventas/IVA ante el SII 1000x y hace desaparecer la deuda del cliente en el fiado, todo silencioso y sin error. Rompe trazabilidad tributaria y descuadra la conciliacion de plata.
- **Verificación:** Reproducido en el servidor vivo (3301). POST /api/dte con montoTotal:"25.000" (folio 8201) devolvio 200 y GET /api/facturar confirma monto_total:25; el control con "25000" (folio 8202) guardo 25000 correctamente, y "25.500" fue rechazado con 400. Causa real en dte/route.ts:25 Number(cuerpo.montoTotal) y el guard de :38 !Number.isInteger(montoTotal): Number("25.000")===25 e Number.isInteger(25)===true, asi que una guia de $25.000 se registra silenciosamente como $25 (subvaluacion 1000x del DTE). No es comportamiento correcto malinterpretado: el guard solo atrapa strings es-CL no redondos ("25.5
- **Reproductor:**
  ```bash
  curl -s -X POST http://localhost:3301/api/dte -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"tipoDte":52,"folioSii":8101,"rutEmisor":"76.192.083-9","montoTotal":"25.000","pedidoId":"df8a58dd-db31-40dc-97dd-dd775bb8722e"}' ; echo ; curl -s 'http://localhost:3301/api/facturar?clienteId=44a7e97b-e8c1-4456-b0bd-8fa661d377e8' -b /tmp/qa-dte.jar
  ```

### [ALTA] Merma sin tope de stock deja pan.stock_disponible() NEGATIVO (mermar pan fantasma sin límite)
- **Lente / endpoint:** merma · `POST /api/pesajes`
- **Esperado:** El servidor debería rechazar (400/409) una merma cuyos gramos superan pan.stock_disponible(producto), igual que /api/ventas rechaza con 409 'Stock insuficiente'. El stock nunca debe quedar negativo: es físicamente imposible mermar más pan del que se horneó/pesó.
- **Observado:** HTTP 200 sin ningún chequeo de tope. Frica pasó de 60000g a -40000g con UNA sola merma de 100000g (delta limpio, nadie más tocó Frica). Marraqueta 0g → -100000g. pesajes/route.ts nunca consulta stock_disponible antes de insertar merma.
- **Impacto:** El maestro ladino escribe merma ilimitada para lavar pan robado/vendido por fuera: los gramos faltantes se etiquetan como 'merma perdida' (g_merma_tipificada en pan.conciliacion_diaria) inflando la métrica y ensuciando la TCK, la variable-norte auditable de todo el sistema. Además deja el inventario en negativo (descuadre real). El dueño ve merma sana y no detecta el faltante. Simétrico al chequeo que /api/ventas SÍ tiene: el camino de pesaje quedó sin la misma guarda.
- **Verificación:** REPRODUCE: Sí, contra la base pglite AISLADA (db/data/pglite, que tiene el seed exacto del dossier: device 'Equipo merma' 6d2f737a…, usuario 'QA merma' maestro). Loguée como maestro (HTTP 200) y con un clientUuid FRESCO mermé 2000g sobre Integral, que tenía stock_disponible=900g. Respuesta: HTTP 200 con cuerpo de ÉXITO real {"id":"b00c16f6-…","clientUuid":…} — no un cuerpo de error disfrazado. Stock después = -1100g (delta limpio de -2000; nadie más tocó Integral en la ventana). Frica en la base ya estaba en -40000 (=60000-100000, una sola merma de 100k) y Marraqueta en -100000, coincidiendo c
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-merma.jar -X POST http://localhost:3301/api/pesajes -H 'Content-Type: application/json' -d '{"clientUuid":"a1a1a1a1-0000-4000-8000-000000000011","productoId":"fb62a78e-b950-404f-b676-2728dd2cf8e7","gramos":100000,"destino":"merma","motivoMerma":"quemado"}' ; echo ; curl -s -b /tmp/qa-merma.jar http://localhost:3301/api/productos | python3 -c "import sys,json;print([p['stock_disponible_g'] for p in json.load(sys.stdin)['productos'] if p['nombre']=='Marraqueta'][0])"
  ```

### [MEDIA] Regex débil de client_uuid: un valor de 36 chars no-UUID revienta la venta con 500 sin cuerpo (query de idempotencia fuera del try/catch)
- **Lente / endpoint:** idempotencia · `POST /api/ventas`
- **Esperado:** HTTP 400 con {error:'client_uuid inválido'}: la validación debe exigir un UUID real (no cualquier string de 36 chars de [0-9a-f-]) y la consulta de idempotencia (yaExiste, líneas 53-59) debe estar dentro del try/catch para nunca devolver un 500 sin manejar.
- **Observado:** HTTP 500 con CUERPO VACÍO. El regex /^[0-9a-f-]{36}$/i (route.ts línea 33) acepta '------------------------------------' (36 guiones), '000000000000000000000000000000000000' (36 ceros) y '540d0b88fdfb428c9cf96c150fbbbce9-aaa'; los tres pasan la validación y luego fallan el cast a uuid en `select ... where client_uuid=$1` que está FUERA del try (el try recién abre en la línea 143), así que la excepción sale sin capturar → 500 crudo. Un UUID válido nuevo da 200 normal.
- **Impacto:** client_uuid es LA llave de idempotencia del sistema (evita el cobro doble tras un corte de señal). Que su propia validación sea floja y que una llave malformada tire un 500 sin cuerpo rompe el contrato de reintento: para la cola offline del POS un 500 significa 'error transitorio, reintentar', así que una llave permanentemente malformada gira infinito y la venta nunca queda registrada, o el vendedor cree que falló y la recobra a mano → riesgo de descuadre y de venta perdida. Es además un defecto de código claro (excepción no capturada en la ruta de mutación principal).
- **Verificación:** Reproducido exactamente contra el servidor vivo en localhost:3301, autenticado como el vendedor 'idempotencia' (QA idempotencia). Los tres clientUuid malformados descritos devuelven HTTP 500 con cuerpo VACÍO (0 bytes): '------------------------------------' (36 guiones), '000000000000000000000000000000000000' (36 ceros) y '540d0b88fdfb428c9cf96c150fbbbce9-aaa' (32 hex + '-aaa', 36 ch). Controles: un clientUuid que NO pasa el regex (zzzz...) devuelve un 400 limpio {"error":"Falta client_uuid"}, y un UUID válido nuevo con stock disponible devuelve un 200 limpio {"id":...,"totalClp":299}. Esto aí
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-idempotencia.jar -X POST http://localhost:3301/api/ventas -H 'Content-Type: application/json' -d '{"clientUuid":"------------------------------------","medioPago":"efectivo","lineas":[{"productoId":"32043713-1fef-4943-b54f-8282f6a35ba7","gramos":1000}]}' -i
  ```

### [MEDIA] Entrega parcial ínfima (1 g de 10.000) cierra el pedido como 'entregado' y NO aparece en la cola 'Entregas por revisar'
- **Lente / endpoint:** pod · `POST /api/sync`
- **Esperado:** Un faltante de 9.999 g sobre 10.000 pedidos debería quedar flageado para revisión (o el pedido no debería marcarse 'entregado' completo), ya que es el patrón #1 de robo de un repartidor. La cola porRevisar es la herramienta del dueño para pescar entregas sospechosas.
- **Observado:** HTTP 200 aceptadas:[b2222222...]. La parada queda 'entregada', el pedido pasa a 'entregado' (confirmado en GET /api/rutas/mi-ruta y GET /api/pedidos). El índice único entregas_una_vigente_por_pedido impide un segundo POD, así que los 9.999 g restantes ya no se pueden entregar/conciliar nunca. GET /api/entregas?porRevisar=1 NO lista esta entrega (foto 'subida', GPS no degradado, gps_fuera_de_zona=false), y GET /api/entregas ni siquiera devuelve gramos_pedidos para notar el faltante. Solo el TCK diario agregado (0005) baja, sin poder atribuirlo a esta entrega.
- **Impacto:** El repartidor entrega 1 g, se queda con 9.999 g de pan real, y el sistema muestra el pedido 'entregado' y la entrega 'limpia' en la cola de revisión. Si el cliente ya fue facturado por la guía (obligatoria para salir a ruta), quedó cobrado por 10.000 g y recibió 1 g. El dueño no tiene ninguna vista por-entrega que delate el descuadre.
- **Verificación:** Reproduje el hallazgo completo end-to-end contra el server vivo (login pod/admin/repartidor, pedido nuevo de 10.000 g, ruta en 'cargando', foto subida). POST /api/sync con gramosEntregados=1 → HTTP 200 {"aceptadas":["ff123492-..."]}. Verificado downstream: el pedido (correlativo 100, total_clp 16.500) pasa a estado 'entregado' (GET /api/pedidos), la parada a 'entregada' con gramos_pedidos=10000 (GET /api/rutas/mi-ruta), y un 2º POD por los 9.999 g restantes rebota con "duplicate key ... entregas_una_vigente_por_pedido" → el faltante es IRRECUPERABLE. GET /api/entregas?porRevisar=1 NO lista la 
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-pod.jar -X POST http://localhost:3301/api/sync -H 'Content-Type: application/json' -d '{"entregas":[{"clientUuid":"b2222222-0000-0000-0000-000000000001","pedidoId":"355b5bc3-adad-4d40-9499-ea2fedff5887","receptorNombre":"Recibe Cualquiera","fotoSha256":"8c9de792fb2743421ae235d62991be761910fb0d61b7248094219c9c7f66434d","lat":-33.45,"lng":-70.66,"precisionM":8,"gramosEntregados":1,"capturadoAt":"2026-07-26T14:00:00Z"}]}'   # precondición: el pedido es parada de la ruta 'cargando'/'en_curso' del repartidor y la foto ya fue subida (POST /api/fotos)
  ```

### [MEDIA] capturado_at (reloj del teléfono, sin validación) fecha la entrega en la conciliación TCK: el repartidor mueve entregas a cualquier día
- **Lente / endpoint:** pod · `POST /api/sync`
- **Esperado:** La fecha de negocio de la entrega debería ser la del servidor (recibido_at), que el propio esquema declara que 'manda para negocio'. capturado_at debería validarse contra una ventana razonable alrededor de now().
- **Observado:** HTTP 200 aceptada. GET /api/entregas devuelve capturado_at:'2099-12-31T23:59:59.000Z' vs recibido_at:'2026-07-26T13:58:46Z'. La vista de conciliación pan.tck (db/migraciones/0005_conciliacion_tck.sql, CTE 'entregado') agrupa g_pod_ok por capturado_at::date, NO por recibido_at. Ningún CHECK ni el route validan el rango de capturado_at.
- **Impacto:** El repartidor controla a qué día se imputan los gramos entregados en el TCK. Puede sacar una entrega del día real (para tapar un excedente) o meterla en un día con faltante (para cuadrarlo), descorrelacionando pesaje (día real) y POD. La conciliación diaria del dueño se vuelve manipulable desde el teléfono, y combinado con el faltante parcial hace el robo aún más difícil de pescar.
- **Verificación:** Reproducido tal cual. Re-ejecuté el curl como repartidor 'pod' (rut 15.000.685-6) sobre su parada activa (pedido 78b049bf, gramos_pedidos 8000): respuesta HTTP 200 {"aceptadas":["c3333333-..."],"rechazadas":[]}, sin rechazo. La entrega quedó almacenada y visible en GET /api/entregas (admin): id 346d0119 con capturado_at=2099-12-31T23:59:59Z vs recibido_at=2026-07-26T13:58:46Z, cerrada y vigente (supersede_id null). Es defecto real, no comportamiento correcto malinterpretado. El route (apps/kilopan/src/app/api/sync/route.ts:138) inserta e.capturadoAt crudo; el esquema pan.entregas (0004_despach
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-pod.jar -X POST http://localhost:3301/api/sync -H 'Content-Type: application/json' -d '{"entregas":[{"clientUuid":"c3333333-0000-0000-0000-000000000001","pedidoId":"78b049bf-1e64-4f01-818a-e8c4dea5da00","receptorNombre":"Lucho","fotoSha256":"8c9de792fb2743421ae235d62991be761910fb0d61b7248094219c9c7f66434d","lat":-33.45,"lng":-70.66,"precisionM":8,"gramosEntregados":8000,"capturadoAt":"2099-12-31T23:59:59Z"}]}'
  ```

### [MEDIA] totalFacturadorClp sin validacion: acepta negativos y montos absurdos que envenenan la conciliacion
- **Lente / endpoint:** caja · `POST /api/cierre-caja`
- **Esperado:** totalFacturadorClp deberia validarse igual que declaradoClp (Number.isInteger, >=0, con cota superior sana) y rechazarse con 400 si es negativo, no entero o absurdo. Es la cifra que el dueno compara contra la cinta del facturador/POS: debe ser confiable.
- **Observado:** HTTP 200 {"resultado":[{"medioPago":"efectivo","esperado":0,"declarado":5000,"diferencia":5000}],"totalEsperado":0,"diferenciaFacturador":-777777}. Se guarda -777777 tal cual y diferenciaFacturador=-777777. Con totalFacturadorClp:2000000000 tambien pasa (diferenciaFacturador=2000000000). Con no-enteros ('1.000.000' o 100.5) revienta con 500 crudo. A diferencia de declaradoClp, este campo no tiene NINGUN chequeo en la API ni check en la columna.
- **Impacto:** El vendedor ladino neutraliza el control cruzado independiente del cierre: el total del facturador se teclea a mano y se puede fijar en cualquier valor (incluso negativo) para que diferenciaFacturador quede como el quiera, tapando un descuadre real de caja. Rompe la trazabilidad de la conciliacion diaria sin dejar rastro, que es justo lo que ese numero deberia proteger.
- **Verificación:** Reproducido en el servidor vivo (localhost:3301, sesion caja). En medios frescos: totalFacturadorClp:-777777 (medio=mach) devolvio HTTP 200 con diferenciaFacturador:-777777, y el re-cierre de mach devolvio 409, probando que la fila con total_facturador_clp=-777777 SE PERSISTIO (no hubo rollback). totalFacturadorClp:2000000000 (medio=fiado) devolvio HTTP 200 con diferenciaFacturador:2000000000. Valores no-enteros (100.5 y el string '1.000.000') revientan con 500 crudo "No se pudo cerrar la caja". Los 409 iniciales de la reproduccion original solo ocurrieron porque el red-team ya habia cerrado e
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-caja.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"efectivo","declaradoClp":5000}],"totalFacturadorClp":-777777}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] GET /api/parametros expone las cifras CLP/km del dueño a un repartidor (rol que nunca debe ver plata)
- **Lente / endpoint:** autorizacion · `GET /api/parametros`
- **Esperado:** 403, o al menos un cuerpo SIN ninguna cifra en pesos. La regla de rol esta documentada explicitamente en rutas/mi-ruta/route.ts ('el repartidor ve km y kg, nunca plata — PROMPT_MAESTRO.md §5, regla de rol'), donde ese endpoint DELIBERADAMENTE excluye todo CLP. parametros/route.ts GET usa solo exigirSesion (cualquier rol logueado), sin gate de rol.
- **Observado:** HTTP 200 con clp_km_combustible=140 y clp_km_ev=35 ('CLP por km ... panel GTM, jul-2026'). El repartidor recibe las cifras de costo por km en pesos del panel del dueño.
- **Impacto:** Rompe la invariante de rol 'repartidor nunca ve plata': el repartidor conoce la estructura de costo $/km del dueño (dato interno del panel GTM). Sin perdida monetaria directa ni vector de robo, pero es filtracion de dato financiero interno a un rol que por diseño no debe verlo; misma leniencia (session-only sin exigirRol) que si mañana se agregara un parametro mas sensible lo expondria igual.
- **Verificación:** Reproduce exacto: logueado como repartidor (rol:"repartidor", "QA autorizacion") GET /api/parametros devuelve HTTP 200 con clp_km_combustible=140 y clp_km_ev=35, ambos "CLP por km ... panel GTM, jul-2026". El codigo lo confirma: parametros/route.ts GET usa solo exigirSesion (cualquier rol logueado), sin gate de rol, mientras que TODOS los demas GET con plata (clientes/saldos fiado, cierre-caja, pedidos, usuarios/nomina, dte, entregas, facturar) usan exigirRol excluyendo al repartidor. La invariante "el repartidor ve km y kg, nunca plata" esta documentada en rutas/mi-ruta/route.ts (PROMPT_MAEST
- **Reproductor:**
  ```bash
  curl -s -X POST http://localhost:3301/api/auth/login -H 'Content-Type: application/json' -d '{"rut":"15.000.137-4","pin":"4321","dispositivoId":"2c975390-79bf-4a57-af11-6a358a6d59df","dispositivoSecreto":"MdCMmvXxnmFOXnAB2LOM7Y0ny4iQfm75"}' -c /tmp/qa-autorizacion.jar >/dev/null && curl -s -i http://localhost:3301/api/parametros -b /tmp/qa-autorizacion.jar
  ```

### [BAJA] cierre-caja acepta y persiste totalFacturadorClp negativo/absurdo (sin validacion)
- **Lente / endpoint:** precios · `POST /api/cierre-caja`
- **Esperado:** totalFacturadorClp deberia validarse como entero >= 0 igual que declaradoClp; un negativo o valor absurdo deberia rebotar con 400
- **Observado:** HTTP 200 -> {"resultado":[{"medioPago":"credito","esperado":0,"declarado":100,"diferencia":100}],"diferenciaFacturador":-999999999}. La fila queda en pan.cierres_caja con total_facturador_clp=-999999999 (columna integer SIN check, y la ruta hace 'cuerpo.totalFacturadorClp ?? null' sin validar).
- **Impacto:** El campo que concilia caja contra el facturador queda envenenable: un cajero ladino teclea un totalFacturador falso (negativo o inflado) para enmascarar un descuadre real de efectivo, y la conciliacion del dia (diferenciaFacturador) miente. Rompe la trazabilidad del cierre sin dejar rastro de que el numero es basura.
- **Verificación:** Reproducido y es defecto real. El servidor 3301 estaba caido; lo relance (next dev --port 3301, misma base pglite aislada db/data/pglite) y logue como precios (rut 15.000.274-5). El comando exacto con medioPago=credito dio 409 "Ya cerraste caja hoy" (ese vendedor ya lo cerro), asi que use un medio no cerrado (mach), tal como indica la nota del reproductor. Resultado: HTTP 200 -> {"resultado":[{"medioPago":"mach","esperado":0,"declarado":100,"diferencia":100}],"totalEsperado":0,"diferenciaFacturador":-999999999}, identico a lo reportado. Confirme la asimetria de validacion: declaradoClp:-500 ->
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-precios.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"credito","declaradoClp":100}],"totalFacturadorClp":-999999999}'   # si da 409 'ya cerraste', usar otra clave de medio no cerrada hoy
  ```

### [BAJA] cierre-caja: totalFacturadorClp no-entero (punto de miles / decimal) tira 500 crudo en vez de 400
- **Lente / endpoint:** precios · `POST /api/cierre-caja`
- **Esperado:** Un totalFacturadorClp con punto de miles chileno o decimal deberia rebotar con 400 y mensaje claro (misma vara que /api/ventas y /api/facturar, que ya validan enteros)
- **Observado:** HTTP 500 -> {"error":"No se pudo cerrar la caja"}. El string '1.234.567' (o un decimal 1234.56) llega sin validar a la columna integer y revienta el insert; el cierre completo se cae (rollback) por un dato de entrada.
- **Impacto:** Mismo hueco de raiz que el totalFacturador sin validar: en vez de un 400 didactico el cajero recibe un error crudo 500 y no puede cerrar caja si teclea el numero con formato chileno; ademas expone que el campo no se sanea. UX/robustez del cierre diario.
- **Verificación:** Reproduce y es defecto real de validacion incompleta. RE-TEST: POST /api/cierre-caja con totalFacturadorClp:"1.234.567" -> HTTP 500 {"error":"No se pudo cerrar la caja"} (identico al reporte). Aisle la causa con controles: mismo request con entero valido 1234567 -> 200 con cuerpo correcto; decimal 1234.56 -> 500; y el campo hermano declaradoClp:"1.234.567" -> 400 {"error":"Monto declarado invalido"}. Codigo (apps/kilopan/src/app/api/cierre-caja/route.ts, POST): valida declaradoClp con Number.isInteger()+>=0 devolviendo 400, pero NO valida totalFacturadorClp; lo pasa tal cual (cuerpo.totalFactu
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-precios.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"debito","declaradoClp":500000}],"totalFacturadorClp":"1.234.567"}'
  ```

### [BAJA] cierre-caja no valida medioPago; una clave inexistente/inactiva provoca 500 crudo (violacion de FK)
- **Lente / endpoint:** precios · `POST /api/cierre-caja`
- **Esperado:** Un medio de pago inexistente o inactivo deberia rebotar con 400 'Medio de pago no disponible' (como si lo hace POST /api/ventas), no llegar hasta la BD
- **Observado:** HTTP 500 -> {"error":"No se pudo cerrar la caja"}. La ruta solo valida que declaradoClp sea entero>=0 pero nunca chequea la clave del medio contra pan.medios_pago; el insert falla por FK y cae al catch generico como 500.
- **Impacto:** Inconsistencia de validacion frente a /api/ventas (que si valida el medio). No hay perdida de plata pero degrada la robustez: entradas invalidas producen 500 en vez de rechazo limpio, y el cierre de un dia se aborta por una clave mal tecleada.
- **Verificación:** Reproducido en vivo sobre la base aislada 3301. Con sesion valida (vendedor/admin), POST /api/cierre-caja con {"declarados":[{"medioPago":"bitcoin","declaradoClp":100}]} devuelve HTTP 500 {"error":"No se pudo cerrar la caja"}, identico al reporte. Control con medioPago valido "efectivo" devuelve 200 con resultado normal, confirmando que el 500 es especifico del medio inexistente. Codigo lo corrobora: cierres_caja.medio_pago tiene FK NOT NULL a medios_pago.clave (0003_venta_mostrador.sql:61); el POST solo valida declaradoClp entero>=0 (cierre-caja/route.ts:50-54) y nunca chequea la clave contra
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-precios.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"bitcoin","declaradoClp":100}]}'
  ```

### [BAJA] Cierre de caja con medio de pago inexistente/inactivo devuelve 500 crudo en vez de 400 (no valida contra pan.medios_pago como sí hace /api/ventas)
- **Lente / endpoint:** idempotencia · `POST /api/cierre-caja`
- **Esperado:** HTTP 400 con {error:'Medio de pago no disponible'}, igual que /api/ventas (que hace `select clave from pan.medios_pago where clave=$1 and activo` y devuelve 400 si no existe). El cierre debería validar cada declarado.medioPago contra pan.medios_pago activos antes de insertar.
- **Observado:** HTTP 500 con {"error":"No se pudo cerrar la caja"}. El endpoint (cierre-caja/route.ts POST) inserta directo en pan.cierres_caja sin validar el medio, así que un medio inexistente ('bitcoin_ladron') o inactivo dispara la violación de FK a pan.medios_pago y cae al catch genérico 500 (líneas 113-114), no al 409 de duplicado. Confirmado también con 'tarjeta_debito' (que NO es un medio válido; los válidos son efectivo/debito/credito/transferencia/mercadopago/mach/fiado/otro).
- **Impacto:** Inconsistencia de validación entre venta y cierre: el cierre del día del vendedor puede reventar con un error de driver crudo (500) por un typo de medio o por un medio que el dueño desactivó, en vez de un mensaje claro. No hay pérdida de plata (la transacción hace rollback), pero degrada la confiabilidad del cierre y expone un error interno; además abre la puerta a confusión sobre si el cierre 'pasó' o no.
- **Verificación:** Reproducido exacto contra el server vivo (login vendedor idempotencia, cookie /tmp/verif-idempotencia-cookie.jar). POST /api/cierre-caja con medioPago 'bitcoin_ladron' devuelve HTTP 500 {"error":"No se pudo cerrar la caja"}; idem con 'tarjeta_debito' (typo verosímil de 'debito', que sí es válido según GET /api/cierre-caja). Un cierre con medio válido 'efectivo' toma otra rama (409 por el unique cierres_caja_un_cierre_por_dia), confirmando que el 500 es específico del medio inválido. Causa raíz confirmada en código+esquema: cierre-caja/route.ts POST inserta directo en pan.cierres_caja (líneas 7
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-idempotencia.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"bitcoin_ladron","declaradoClp":100}]}' -i
  ```

### [BAJA] gps_fuera_de_zona nunca se dispara para clientes sin lat/lng: GPS spoofing dentro de Chile queda sin flag
- **Lente / endpoint:** pod · `POST /api/sync`
- **Esperado:** Una entrega cuyo GPS no se puede validar contra la ubicación del cliente (cliente sin coordenadas) debería marcarse para revisión, no asumirse 'en zona'.
- **Observado:** En sync/route.ts la distancia usa coalesce(sqrt(...) > 300, false): si c.lat/c.lng son NULL el resultado es NULL y coalesce lo vuelve false (=en zona). Ambos clientes de reparto semilla (Almacén Don Lucho, Rotisería La Esquina) tienen lat/lng NULL, así que TODAS sus entregas salen gps_fuera_de_zona:false sin importar el GPS declarado (verificado en GET /api/entregas para correlativos 1, 35 y 67).
- **Impacto:** El repartidor puede declarar cualquier coordenada dentro del rango de Chile (su casa, otra comuna) y jamás cae en la cola 'por revisar' por GPS mientras el cliente no tenga coordenadas cargadas. La evidencia de ubicación del POD queda anulada de facto para esos clientes.
- **Verificación:** Reproduce y es un defecto real (fail-open) en la logica del flag de revision GPS. En sync/route.ts (lineas 89-96) la distancia se calcula con coalesce(sqrt(power((c.lat-$1)*111000,2)+power((c.lng-$2)*90000,2)) > 300, false): si c.lat/c.lng son NULL, la expresion entera es NULL y coalesce la fuerza a false (=en zona). Confirme en vivo que los DOS clientes de reparto tienen coordenadas NULL (mi-ruta muestra lat:null,lng:null para Almacen Don Lucho y para Rotiseria La Esquina). El unico guard duro de GPS es el CHECK de la tabla entregas que exige lat/lng dentro de Chile (lat entre -56 y -17, lng 
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-pod.jar -X POST http://localhost:3301/api/sync -H 'Content-Type: application/json' -d '{"entregas":[{"clientUuid":"d4444444-0000-0000-0000-000000000001","pedidoId":"<pedido de cliente sin lat/lng en tu ruta>","receptorNombre":"Lucho","fotoSha256":"8c9de792fb2743421ae235d62991be761910fb0d61b7248094219c9c7f66434d","lat":-33.45,"lng":-70.66,"precisionM":8,"gramosEntregados":8000,"capturadoAt":"2026-07-26T14:00:00Z"}]}'
  ```

### [BAJA] /api/sync registra POD con la ruta en 'cargando', estado alcanzable sin DTE; el POD no verifica DTE por su cuenta
- **Lente / endpoint:** pod · `POST /api/sync`
- **Esperado:** El POD no debería cerrarse para un pedido sin guía/factura (art. 55 DL 825). El gate de DTE del trigger trg_ruta_exige_dte solo protege la transición a 'en_curso'; sync también acepta 'cargando'.
- **Observado:** sync/route.ts filtra r.estado in ('en_curso','cargando'). 'cargando' se alcanza con PATCH /api/rutas (admin) sin disparar el gate de DTE (que solo mira new.estado='en_curso'). Cerré PODs de 3 pedidos (correlativos 1, 35, 67) que nunca tuvieron DTE. El endpoint POD no consulta documento_tributario en ningún momento.
- **Impacto:** Un pedido puede quedar 'entregado' con evidencia POD pero sin ningún documento tributario que ampare el traslado, rompiendo la trazabilidad SII. Requiere que un admin deje la ruta en 'cargando' (el repartidor no puede cambiar estado de ruta), por eso es baja: es una brecha de defensa-en-profundidad, no explotable por el repartidor en solitario.
- **Verificación:** Reproducido end-to-end contra el servidor vivo (localhost:3301). El comando reproductor literal apunta al pedido 78b049bf (correlativo 67), que el red-team ya dejó entregado, así que re-ejecutarlo tal cual solo devuelve un ACEPTADA idempotente (client_uuid ya existente). Recreé el escenario limpio y observé lo mismo: (1) creé pedido fresco correlativo 133 (bba4e146) confirmado y SIN DTE; (2) armé ruta del repartidor pod con ese pedido; (3) PATCH /api/rutas estado='en_curso' => 409 "hay pedidos sin guía o factura (art. 55 DL 825)" — el gate trg_ruta_exige_dte SÍ funciona en ese borde; (4) PATCH
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-pod.jar -X POST http://localhost:3301/api/sync -H 'Content-Type: application/json' -d '{"entregas":[{"clientUuid":"e5555555-0000-0000-0000-000000000001","pedidoId":"78b049bf-1e64-4f01-818a-e8c4dea5da00","receptorNombre":"Lucho","fotoSha256":"8c9de792fb2743421ae235d62991be761910fb0d61b7248094219c9c7f66434d","lat":-33.45,"lng":-70.66,"precisionM":8,"gramosEntregados":8000,"capturadoAt":"2026-07-26T12:00:00Z"}]}'   # ruta en 'cargando' y el pedido SIN ningún documento_tributario registrado
  ```

### [BAJA] Se filtran mensajes crudos de Postgres (nombres de constraints/columnas) al cliente en el motivo de rechazo
- **Lente / endpoint:** pod · `POST /api/sync`
- **Esperado:** Un rebote de invariante debería devolver un motivo de negocio legible, sin exponer nombres internos de constraints/columnas de la BD.
- **Observado:** GPS (0,0) devuelve motivo 'new row for relation "entregas" violates check constraint "entregas_lat_check"'; el doble cierre devuelve 'duplicate key value violates unique constraint "entregas_una_vigente_por_pedido"'; sin GPS devuelve 'null value in column "lat" ... violates not-null constraint'. El código hace mensaje.slice(0,200) del error del driver y lo pasa tal cual como 'motivo'.
- **Impacto:** Fuga menor: revela el esquema interno (nombres de tablas, columnas e índices) a cualquiera con sesión de repartidor, facilitando el mapeo de la BD para ataques posteriores. La defensa funciona (el dato no entra); solo el mensaje es demasiado explícito.
- **Verificación:** Reproducido al pie de la letra contra localhost:3301 con sesion del repartidor 'pod'. Los tres motivos crudos de Postgres se filtran verbatim en el campo 'motivo' de rechazadas (HTTP 200): GPS(0,0) -> 'new row for relation "entregas" violates check constraint "entregas_lat_check"'; sin lat -> 'null value in column "lat" of relation "entregas" violates not-null constraint'; POD ya vigente -> 'duplicate key value violates unique constraint "entregas_una_vigente_por_pedido"'. El codigo lo confirma: apps/kilopan/src/app/api/sync/route.ts lineas 166-172 hacen mensaje = err.message y mensaje.slice(0
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-pod.jar -X POST http://localhost:3301/api/sync -H 'Content-Type: application/json' -d '{"entregas":[{"clientUuid":"f6666666-0000-0000-0000-000000000001","pedidoId":"78b049bf-1e64-4f01-818a-e8c4dea5da00","receptorNombre":"Lucho","fotoSha256":"abc123","lat":0,"lng":0,"precisionM":10,"gramosEntregados":8000,"capturadoAt":"2026-07-26T12:00:00Z"}]}'
  ```

### [BAJA] medioPago fuera del catalogo (o vacio) revienta con 500 crudo en vez de 400
- **Lente / endpoint:** caja · `POST /api/cierre-caja`
- **Esperado:** 400 con mensaje claro tipo 'medio de pago invalido' — el endpoint deberia validar medioPago contra el catalogo de pan.medios_pago (idealmente solo los activos) ANTES de intentar el insert.
- **Observado:** HTTP 500 {"error":"No se pudo cerrar la caja"}. El medioPago no se valida contra el catalogo; la violacion de FK medio_pago->medios_pago cae al catch, que solo tiene un regex para el unique constraint 'cierres_caja_un_cierre_por_dia', asi que cualquier otro error de BD termina en 500 generico. Un medioPago vacio ('') produce el mismo 500.
- **Impacto:** El panadero ladino (o un cliente PWA con bug) puede disparar 500s a voluntad y descubre que el cierre no tiene allowlist de medios: la validacion del medio de pago vive solo en el FK de la BD, no en la capa de negocio. Ruido en logs, UX rota y una puerta abierta a que claves de medio no controladas lleguen al insert.
- **Verificación:** Reproduce exactamente. Re-ejecute el comando logueado como identidad 'caja' (vendedor). medioPago:"bitcoin" -> HTTP 500 {"error":"No se pudo cerrar la caja"}; medioPago:"" -> mismo HTTP 500. Control con medioPago:"efectivo" (valido) -> HTTP 409 "Ya cerraste caja hoy...", lo que prueba que el camino valido si se maneja y que SOLO la unique constraint tiene rescate. Es defecto real: en apps/kilopan/src/app/api/cierre-caja/route.ts el POST valida declarados.length y declaradoClp (entero, >=0) pero NUNCA valida medioPago contra pan.medios_pago. Inserta directo en pan.cierres_caja.medio_pago, que e
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-caja.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"bitcoin","declaradoClp":1000}]}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] declaradoClp sin cota superior: desborda el integer (int32) y da 500 crudo
- **Lente / endpoint:** caja · `POST /api/cierre-caja`
- **Esperado:** 400 'Monto declarado invalido' con una cota superior razonable (la validacion actual solo exige Number.isInteger y >=0, sin techo).
- **Observado:** HTTP 500 {"error":"No se pudo cerrar la caja"}. 3.000.000.000 pasa Number.isInteger y >=0, pero excede el maximo del integer de 4 bytes (2.147.483.647) de esperado_clp/declarado_clp, revienta el insert y cae al 500 generico.
- **Impacto:** Validacion floja de cota superior + error crudo: un monto de cierre grotesco (o un typo) no se rechaza limpio sino que tumba el cierre con 500. Sin perdida directa, pero es una entrada no validada mas que confirma que la unica barrera de cordura sobre los montos es el tipo de la columna en BD.
- **Verificación:** Reproduje el reproductor exacto tras loguear con la identidad "caja" (vendedor, rut 15.000.822-0): POST /api/cierre-caja con declaradoClp=3000000000 devuelve HTTP 500 {"error":"No se pudo cerrar la caja"}, idéntico al reporte. Aislé la causa con un test de frontera decisivo sobre el MISMO code path: declaradoClp=2147483647 (máximo de int4) inserta limpio con HTTP 200 (probado en 'mercadopago' y 'otro', ambos medios frescos sin cierre previo hoy), mientras que 2147483648 (máx+1) devuelve 500. El medio 'mach' es válido y activo (0003_venta_mostrador.sql), y descarté falsos positivos: los 200 con
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-caja.jar -X POST http://localhost:3301/api/cierre-caja -H 'Content-Type: application/json' -d '{"declarados":[{"medioPago":"mach","declaradoClp":3000000000}]}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] RUT no prevalidado en el codigo cae en 500 crudo: rutReceptor en /api/dte y rutEmisor en /api/facturar
- **Lente / endpoint:** dte · `POST /api/dte y POST /api/facturar`
- **Esperado:** dv de RUT invalido deberia devolver 400 con mensaje claro (como si hace /api/dte con rutEmisor). El codigo solo llama validaRut() sobre rutEmisor en /api/dte y no sobre rutReceptor; /api/facturar no valida rutEmisor en absoluto.
- **Observado:** Ambos devuelven 500 {"error":"No se pudo registrar el documento"} / {"error":"No se pudo consolidar"}. El CHECK pan.valida_rut de la BD es el unico que ataja el dato malo; el error de constraint no matchea /unique\|duplicate/ y cae al console.error + 500 generico. Verificado que la transaccion hace rollback (sin filas huerfanas).
- **Impacto:** La BD protege la integridad, pero el 500 crudo filtra que la validacion vive solo en la base y es inconsistente entre endpoints; ademas un receptor con RUT malo da un error opaco imposible de corregir para el usuario legitimo. Deberia ser un 400 explicito y coherente con el resto.
- **Verificación:** Reproducido en localhost:3301 con sesion admin (identidad dte). /api/dte con rutReceptor de dv invalido (11.111.111-2) devuelve 500 {"error":"No se pudo registrar el documento"}; con rutReceptor valido (11.111.111-1) devuelve 200; y con rutEmisor invalido devuelve 400 {"error":"RUT del emisor invalido"} — misma ruta, dos campos RUT, dos comportamientos. /api/facturar con guia valida creada para la prueba (ffdad119-...) + rutEmisor invalido (12.345.678-0) devuelve 500 {"error":"No se pudo consolidar"}; misma guia + rutEmisor valido (12.345.678-5) devuelve 200 (consolida, monto 5000). Control cl
- **Reproductor:**
  ```bash
  curl -s -X POST http://localhost:3301/api/dte -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"tipoDte":33,"folioSii":8105,"rutEmisor":"76.192.083-9","montoTotal":1000,"rutReceptor":"11.111.111-2"}' -w '\n[HTTP %{http_code}]\n' ; curl -s -X POST http://localhost:3301/api/facturar -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"guiaIds":["d1a2c6cc-07ff-40d9-a98d-190450d9b606"],"folioSii":40002,"rutEmisor":"12.345.678-0"}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] ind_traslado sin validacion de rango: acepta 999 y -5 en una guia de despacho
- **Lente / endpoint:** dte · `POST /api/dte`
- **Esperado:** IndTraslado del SII tiene dominio 1..9 (venta, consignacion, traslado interno, etc). Un valor 999 o -5 deberia rebotar con 400.
- **Observado:** 200 con id. route.ts guarda Number(cuerpo.indTraslado) sin acotar rango; la migracion solo exige (ind_traslado is null or tipo_dte=52), sin CHECK de dominio. Confirmado que 999 y -5 se insertan.
- **Impacto:** Metadata tributaria invalida en la guia: rompe la trazabilidad SII del motivo de traslado (art. 55 DL 825) y pasa desapercibida en cualquier export o reporte. Falta un CHECK ind_traslado between 1 and 9.
- **Verificación:** Reproducido en el servidor vivo (localhost:3301, identidad dte/admin): POST /api/dte con tipoDte 52 e indTraslado 999 (folio 8103) y -5 (folio 8104) devolvieron ambos HTTP 200 con un UUID real de `returning id`, es decir el INSERT commiteo (no son cuerpos de error disfrazados). Control con indTraslado 1 tambien 200. No hay GET (405), pero un id retornado solo ocurre tras commit exitoso. Es defecto real, no comportamiento correcto malinterpretado: route.ts:63 guarda Number(cuerpo.indTraslado) sin acotar rango cuando tipoDte===52 (el valor se persiste tal cual, no se nulifica: la nulificacion so
- **Reproductor:**
  ```bash
  curl -s -X POST http://localhost:3301/api/dte -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"tipoDte":52,"folioSii":8103,"rutEmisor":"76.192.083-9","montoTotal":1000,"indTraslado":999}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] montoTotal fuera de rango int4 y pedidoId inexistente producen 500 crudo en vez de 400
- **Lente / endpoint:** dte · `POST /api/dte`
- **Esperado:** montoTotal > 2.147.483.647 (columna integer/int4) y un pedidoId que no existe deberian devolver 400 con mensaje claro. El guard Number.isInteger && >=0 no acota al maximo de int4 ni verifica la FK antes de insertar.
- **Observado:** Ambos 500 {"error":"No se pudo registrar el documento"}: el primero por 'value out of range for type integer', el segundo por violacion de FK a pan.pedidos. Rollback limpio verificado (folios 50003 ausentes en GET /api/facturar).
- **Impacto:** Sin perdida de datos (la BD ataja), pero son 500 crudos ante entrada de usuario: mala UX, ruido en logs y sintoma de que la capa de app confia en la base para validar. Falta cap de monto y chequeo de existencia del pedido.
- **Verificación:** Re-ejecute los dos comandos reproductores contra la base pglite aislada viva en localhost:3301 (login OK como admin QA dte 15.000.959-6). Ambos devolvieron identico a lo reportado: HTTP 500 con {"error":"No se pudo registrar el documento"}. TEST 1: {tipoDte:52,folioSii:8104,montoTotal:9999999999} -> 500. TEST 2: {tipoDte:52,folioSii:8106,montoTotal:1000,pedidoId:"00000000-..."} -> 500. Controles que aislan el mecanismo (descartan falso positivo tipo "el server siempre da 500" o causa distinta): (A) monto 1000 valido -> 200 {id}; (B) monto 2147483647 (int4 MAX exacto) -> 200 {id}; (C) monto 214
- **Reproductor:**
  ```bash
  curl -s -X POST http://localhost:3301/api/dte -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"tipoDte":52,"folioSii":8104,"rutEmisor":"76.192.083-9","montoTotal":9999999999}' -w '\n[HTTP %{http_code}]\n' ; curl -s -X POST http://localhost:3301/api/dte -b /tmp/qa-dte.jar -H 'Content-Type: application/json' -d '{"tipoDte":52,"folioSii":8106,"rutEmisor":"76.192.083-9","montoTotal":1000,"pedidoId":"00000000-0000-0000-0000-000000000000"}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] productoId inexistente o mal formado devuelve 500 crudo (uno con body vacío por excepción no capturada)
- **Lente / endpoint:** merma · `POST /api/pesajes`
- **Esperado:** Un productoId con formato inválido o inexistente es un error del cliente: debería responder 400 (formato) o 404 (no existe), con cuerpo JSON claro.
- **Observado:** productoId 'no-soy-uuid' → HTTP 500 con BODY VACÍO: la query pan.es_outlier_pesaje($1::uuid) corre ANTES del try/catch (route.ts ~línea 107) y el cast a uuid revienta como excepción no capturada. Variante con uuid válido pero inexistente (00000000-0000-4000-8000-000000000000) → HTTP 500 {"error":"No se pudo registrar el pesaje"} por violación de FK. La tabla queda intacta (inyección SQL '; DROP TABLE pan.pesajes;-- también solo produjo 500, sin ejecutarse).
- **Impacto:** Validación floja de entrada: un 500 no manejado ensucia logs, confunde al cliente offline (que puede reintentar en loop una request que nunca va a entrar) y, bajo carga, una excepción no capturada es peor que un 4xx controlado. No hay pérdida de plata ni fuga de datos; es robustez/UX.
- **Verificación:** Reproducido idéntico con cookie de maestro (merma) recién logueada. TEST 1: productoId="no-soy-uuid" → HTTP 500 con size_download=0 (BODY VACÍO real). TEST 2: uuid válido inexistente (00000000-0000-4000-8000-000000000000) → HTTP 500 {"error":"No se pudo registrar el pesaje"} (42 bytes). TEST 3 control con producto real → HTTP 200 {id, clientUuid}. Mecanismo confirmado contra el código (apps/kilopan/src/app/api/pesajes/route.ts): la función pan.es_outlier_pesaje(p_producto_id uuid, p_gramos integer) (db/migraciones/0002_catalogo_pesaje.sql:98, 0003:112) recibe un uuid. La línea 107 ejecuta `sel
- **Reproductor:**
  ```bash
  curl -s -b /tmp/qa-merma.jar -X POST http://localhost:3301/api/pesajes -H 'Content-Type: application/json' -d '{"clientUuid":"c3c3c3c3-0000-4000-8000-000000000033","productoId":"no-soy-uuid","gramos":2000,"destino":"merma","motivoMerma":"quemado"}' -w '\n[HTTP %{http_code}]\n'
  ```

### [BAJA] Cookie de sesión no-UUID provoca HTTP 500 crudo en todos los endpoints protegidos
- **Lente / endpoint:** entrada · `cualquier ruta que lee la sesión (GET /api/clientes, /api/productos, /api/usuarios, /api/pedidos, ...)`
- **Esperado:** Una cookie malformada = sin sesión → 401 'Sin sesión'. obtenerSesionActual() en identidad/sesion.ts documenta explícitamente 'nunca lanza — devuelve null si no hay sesión viva'.
- **Observado:** HTTP 500 con cuerpo vacío en /api/clientes, /api/productos, /api/usuarios y /api/pedidos. Con una cookie UUID bien formada pero inexistente (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee) sí devuelve 401 limpio. Causa: el valor va directo a 'where s.id = $1' sobre columna uuid → Postgres lanza 'invalid input syntax for type uuid' → excepción no capturada → 500, violando el contrato 'nunca lanza'.
- **Impacto:** Cualquiera SIN sesión tumba (500) todas las rutas protegidas mandando una cookie basura. No hay pérdida de plata ni fuga de datos (cuerpo vacío), pero es un error crudo no controlado que ensucia el monitoreo y rompe la experiencia; debería ser 401. Fix: validar formato UUID (o try/catch) en obtenerSesionActual y tratar cookie malformada como sin-sesión.
- **Verificación:** Reproduce exacto contra localhost:3301: `curl -H 'Cookie: kp_sesion=fantasma' /api/clientes` -> HTTP 500 cuerpo vacio; mismo 500 en /api/productos, /api/usuarios, /api/pedidos y /api/rutas. Caso de control decisivo: una cookie UUID bien formada pero inexistente (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee) devuelve 401 'Sin sesion' limpio, y sin cookie tambien 401. La UNICA variable que cambia 401->500 es si el valor es parseable como UUID, lo que fija la causa raiz. Confirmado en codigo: db/migraciones/0001_identidad.sql:107 define `id uuid primary key`; sesion.ts:38-55 (obtenerSesionActual) mete el
- **Reproductor:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -H 'Cookie: kp_sesion=fantasma' http://localhost:3301/api/clientes
  ```

### [BAJA] Inputs malformados en login público devuelven 500 crudo en vez de 400/401
- **Lente / endpoint:** entrada · `POST /api/auth/login`
- **Esperado:** dispositivoId con formato inválido → 400 'Cuerpo inválido' o 401 'Dispositivo no enrolado'. rut no-string → 400. Nunca un 500.
- **Observado:** HTTP 500 con dispositivoId='no-soy-uuid' (cast a uuid en 'where id = $1' lanza). También rut numérico (150012333) → 500 (validaRut(number) llama .replace sobre un número → TypeError no capturado). Un dispositivoId UUID inexistente en cambio devuelve 401 limpio.
- **Impacto:** Superficie pre-auth (sin credenciales) que responde 500 ante entradas triviales: ruido de errores, fingerprinting del stack y manejo de errores roto en la puerta de entrada. Fix: validar UUID de dispositivoId y tipo string de rut/pin antes de tocar la BD, y capturar excepciones devolviendo 400/401.
- **Verificación:** Reproducido en el servidor vivo (localhost:3301) y confirmado contra el código. (1) Reproducer exacto con dispositivoId="no-soy-uuid" y rut string válido → HTTP 500. Causa raíz confirmada: en apps/kilopan/src/app/api/auth/login/route.ts la query `select ... from pan.dispositivos where id = $1` recibe el dispositivoId crudo, y db/migraciones/0001_identidad.sql:97 define `id uuid primary key`; pglite lanza "invalid input syntax for type uuid" sin try/catch → 500. (2) rut numérico (150012333) → HTTP 500: `!rut` no atrapa un número truthy, luego validaRut(number) → normalizar() → rut.replace() sob
- **Reproductor:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3301/api/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-For: 7.7.7.7' -d '{"rut":"15.001.233-3","pin":"4321","dispositivoId":"no-soy-uuid","dispositivoSecreto":"x"}'
  ```

### [BAJA] Oráculo de tiempos en login permite enumerar RUTs de personal existente
- **Lente / endpoint:** entrada · `POST /api/auth/login`
- **Esperado:** El tiempo y comportamiento deben ser indistinguibles entre un RUT registrado y uno inexistente (ambos devuelven 401 con el mismo mensaje 'RUT o PIN incorrecto').
- **Observado:** RUT inexistente ~0.025-0.030s; RUT existente (adminSemilla) ~0.047-0.050s — ≈2x consistente en varias muestras, mismo status 401 y mismo mensaje. Causa: si el RUT no existe, login retorna antes de verificarPin(pin); si existe, corre un segundo scrypt (lento) sobre el PIN. El tiempo delata cuáles RUTs son personal real.
- **Impacto:** Un intruso enumera qué RUTs pertenecen a la nómina (dato PII y usuario de login) pese al mensaje idéntico. Combinado con el bypass de rate-limit (hallazgo 1) prepara fuerza bruta dirigida a operadores reales. Fix: comparar contra un hash dummy en tiempo constante cuando el RUT no existe, para igualar el tiempo de respuesta.
- **Verificación:** Reproducido limpiamente contra el servidor vivo. Con status y cuerpo IDENTICOS (http=401, {"error":"RUT o PIN incorrecto"}), un RUT valido pero inexistente responde ~0.026-0.039s mientras un RUT existente (adminSemilla 76.192.083-9 y 4 usuarios mas del roster) responde ~0.050-0.059s: separacion limpia sin solape, ~2x consistente, exactamente lo reportado. Causa confirmada en codigo (apps/kilopan/src/app/api/auth/login/route.ts lineas 65-69): si no hay fila en pan.usuarios se retorna 401 ANTES de correr el segundo scrypt verificarPin(pin, pin_hash) de la linea 69; con RUT existente ese scrypt m
- **Reproductor:**
  ```bash
  echo INEXISTENTE; curl -s -o /dev/null -w "%{time_total}\n" -X POST http://localhost:3301/api/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-For: 172.16.1.1' -d '{"rut":"30.111.777-9","pin":"0000","dispositivoId":"c8bec55f-8986-4b9b-a8c4-61ace220b5f8","dispositivoSecreto":"WiDGGcZObRIcOLF8h7ze9JHRMZ_6HRCe"}'; echo EXISTENTE; curl -s -o /dev/null -w "%{time_total}\n" -X POST http://localhost:3301/api/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-For: 172.16.5.1' -d '{"rut":"76.192.083-9","pin":"0000","dispositivoId":"c8bec55f-8986-4b9b-a8c4-61ace220b5f8","dispositivoSecreto":"WiDGGcZObRIcOLF8h7ze9JHRMZ_6HRCe"}'
  ```

### [BAJA] Cookie de sesión malformada (no-UUID) provoca 500 en vez de 401 en toda ruta protegida
- **Lente / endpoint:** sesiones · `GET /api/auth/me y POST /api/pesajes (todo endpoint que llame exigirSesion/exigirRol)`
- **Esperado:** 401 {"error":"Sin sesión"} — una cookie presente pero inválida se rechaza igual que una ausente (es lo que promete el comentario del propio middleware)
- **Observado:** HTTP/1.1 500 Internal Server Error con cuerpo VACÍO, tanto en la lectura /api/auth/me como en el mutador POST /api/pesajes. Causa: obtenerSesionActual (apps/kilopan/src/identidad/sesion.ts:43-55) ejecuta `where s.id = $1` con el valor crudo de la cookie tipado como uuid, sin try/catch ni validación de formato; Postgres lanza 'invalid input syntax for type uuid' y la excepción sube sin capturar hasta Next → 500. El cuerpo vacío evita fuga de stack, pero el fallo NO cierra en 401.
- **Impacto:** Cualquiera SIN sesión (ni credenciales) dispara errores 500 en la capa de autenticación con un solo request trivial y repetible: ruido/alertas de monitoreo, superficie de DoS barata (cada hit va a la BD y lanza excepción) y ruptura del contrato de la capa de auth (debía fallar-cerrado con 401). No es escalada de privilegios: no otorga acceso, pero degrada el gate de sesión.
- **Verificación:** Reproduje el hallazgo exactamente: GET /api/auth/me con kp_sesion=notauuid devuelve HTTP 500 con cuerpo vacio, y POST /api/pesajes con kp_sesion=x';drop-- tambien 500 cuerpo vacio. Tests de control aislan la causa: sin cookie -> 401; UUID valido pero inexistente (00000000-...) -> 401 (la query corre y devuelve 0 filas); solo el string no-UUID -> 500. El schema (db/migraciones/0001_identidad.sql:107) declara id uuid primary key; en sesion.ts:43-55 el valor crudo de la cookie se bindea a $1 contra s.id (uuid) sin validacion ni try/catch, asi que Postgres/PGlite lanza 'invalid input syntax for ty
- **Reproductor:**
  ```bash
  curl -s -i --cookie "kp_sesion=notauuid" http://localhost:3301/api/auth/me   # y tambien: curl -s -o /dev/null -w '%{http_code}\n' -X POST --cookie "kp_sesion=x';drop--" -H 'Content-Type: application/json' -d '{}' http://localhost:3301/api/pesajes
  ```

### [BAJA] La sesión no tiene tope duro server-side: el 'límite 12h' es solo Max-Age de la cookie (lado cliente)
- **Lente / endpoint:** sesiones · `validación de sesión en apps/kilopan/src/identidad/sesion.ts + db/migraciones/0006_cambio_operador.sql`
- **Esperado:** Un tope absoluto de vida de sesión (~12h desde `inicio`) validado en el servidor, como afirman los comentarios de OPCIONES_COOKIE y sesion.ts ('12h de tope duro'); una tablet compartida no debería aceptar un id de sesión indefinidamente.
- **Observado:** El servidor (obtenerSesionActual, sesion.ts:38-78) solo valida `fin is null`, `u.activo` y la inactividad deslizante de 10 min (pan.sesion_expirada sobre ultima_actividad, reseteada en CADA request por pan.tocar_sesion). La columna `inicio` de pan.sesiones_operador nunca se compara contra un máximo. El único '12h' es OPCIONES_COOKIE.maxAge=43200 (Max-Age visible en el Set-Cookie), que solo obedece un navegador; curl/un cliente adulterado reenvía el id crudo e —confirmado en vivo— la sesión sigue en 200 request tras request sin acercarse a ningún corte absoluto. El >12h completo no se puede correr en la ventana de prueba; mecanismo confirmado por código + comportamiento de ventana deslizante observado.
- **Impacto:** En el modelo de amenaza de tablet compartida (justo el foco de esta lente), un id de sesión lifteado/copiado del maestro sobrevive mucho más que las 12h documentadas mientras se lo mantenga activo cada <10min, sin que el operador legítimo tenga que estar presente. La mitigación real queda delegada a que un cliente honesto respete Max-Age, cosa que un ladino no hace.
- **Verificación:** Reproducido y confirmado por codigo + comportamiento. CODIGO: obtenerSesionActual (sesion.ts:50-53) valida solo `s.fin is null`, `u.activo` y la inactividad deslizante de 10 min (sesion_expirada, l.62); pan.tocar_sesion (l.69) resetea ultima_actividad=now() en CADA request. La columna `inicio` (0001_identidad.sql:110) solo se usa para el default y el EXCLUDE de solapamiento — NUNCA se compara contra un maximo. Enumere todos los sitios que setean `fin` (logout, inactividad, relevo de equipo 0006, desplazamiento mismo-usuario 0001:123): ninguno cierra por edad absoluta, y no hay cron/reaper/swee
- **Reproductor:**
  ```bash
  # Mantener tibio un id de sesión copiado vence el 'tope 12h': cada request refresca ultima_actividad y nunca se mira `inicio`.
  while true; do curl -s -o /dev/null -w 'keepalive=%{http_code}\n' --cookie "kp_sesion=<ID_SESION_COPIADO>" http://localhost:3301/api/auth/me; sleep 500; done
  ```

---

## B. Experiencia del panadero (UX priorizado)

### [ALTA] (caja) El cierre de caja muestra el monto 'esperado' antes de contar: anula el control anti-robo por el que paga el dueño
- **Escenario:** Al cerrar, el vendedor ve pegado al campo 'esperado $145.000' antes de declarar nada. El ladino que sacó $5.000 teclea justo $145.000 y sale 'cuadra'; el honesto pero apurado copia el número por pereza y nunca cuenta de verdad. El cierre se vuelve teatro: todo cuadra siempre.
- **Impacto:** El cierre existe para cazar descuadres (robo, mermas, cobros mal hechos). Al revelar lo esperado antes del conteo se neutraliza justo el control que el dueño de 3 sucursales y 8 empleados más valora. Es el hallazgo que más plata cuesta de toda la app.
- **Fix propuesto:** Conteo a ciegas: el vendedor teclea primero lo contado y recién al apretar 'Cerrar' se revela esperado + diferencia. Un 'modo abierto' opcional que solo el DUEÑO active por configuración, nunca el vendedor.

### [ALTA] (entrada) El PIN que empieza con 0 es imposible de teclear y bloquea al operador permanentemente
- **Escenario:** María tiene PIN 0512. Toca 0, luego 5: la lógica del TecladoNumerico (pensada para montos, colapsa el cero inicial con `valor === '0' ? tecla : valor+tecla`) reemplaza el 0 por el 5, la bolita no avanza y parece colgado. Reintenta, arma un PIN corto y equivocado, y a los pocos intentos queda 'Bloqueado 15 minutos' con cola de clientes. El mismo bug de TecladoNumerico convierte 10->5 en 105 al editar kilos en /ruta.
- **Impacto:** Un operador de cada ~10 (los que parten en 0 o 00) queda sin poder entrar, con un error que lo culpa a él: turno que no abre, ventas perdidas y bloqueo en plena mañana. En caja compartida con 8 empleados es casi seguro que le toque a alguien.
- **Fix propuesto:** Dar al TecladoNumerico un modo PIN/no-monto (prop `esPin` o `permitirCeroInicial`) que use siempre `valor + tecla` sin colapsar el cero, y activarlo en ingresar y vincular. Verificar que la bolita avance en cada toque para que nunca se vea congelado.

### [ALTA] (ruta) Sin GPS el repartidor no puede registrar NINGUNA entrega ni marcarla fallida: queda en loop sin salida
- **Escenario:** El repartidor llega dentro de un galpón o con la ubicación apagada. Toma la foto, llega a la pantalla del receptor y el GPS nunca fija. 'Confirmar entrega' queda gris; busca 'No se pudo entregar' y ese botón TAMBIÉN exige GPS y está gris. No hay 'reintentar ubicación'. Su única opción es Cancelar y volver a chocar con lo mismo. El mensaje de recuperación es código muerto porque solo corre dentro de funciones que el botón deshabilitado nunca dispara.
- **Impacto:** Con el GPS caído no puede registrar ninguna entrega en todo el día, ni exitosa ni fallida. El pan se entrega igual pero no queda en el sistema: la conciliación no cuadra, el dueño no sabe qué se despachó y no hay POD. Es la fricción más cara de la pantalla.
- **Fix propuesto:** Agregar un botón 'Reintentar ubicación' visible en el paso receptor; NO bloquear 'No se pudo entregar' por GPS (una fallida con foto sin GPS sigue siendo evidencia, marcarla gps_degradado); y como último recurso permitir confirmar la entrega sin ubicación marcándola 'sin GPS' para revisión.

### [ALTA] (ruta) Una ruta que no carga se ve idéntica a 'no hay reparto hoy': el repartidor se va a la casa
- **Escenario:** El repartidor abre la app en la calle. La sesión venció (401) o el server no responde: cargarRuta hace `if(!r.ok) return` o cae al catch en silencio, paradas queda []. La pantalla muestra un '0' gigante y 'No tienes paradas hoy'. Lo lee como 'hoy no hay reparto' y se va. No hay pull-to-refresh ni reintento, así que queda pegado en el falso vacío hasta reiniciar la app.
- **Impacto:** El reparto de un día completo no se hace porque el repartidor cree que no tiene paradas. Ventas y clientes perdidos, y el dueño no se entera hasta que llaman preguntando por su pan.
- **Fix propuesto:** Distinguir tres estados: cargando (skeleton), error de carga ('No se pudo cargar tu ruta — reintentar' con botón) y vacío real. Guardar un flag de 'cargó alguna vez con éxito' para no pintar el vacío real mientras el primer fetch aún no responde o falló.

### [ALTA] (facturar) Las guías no cargan y muestra 'no tiene guías pendientes' en falso: fiado mayorista que no se cobra
- **Escenario:** Don Luis elige a 'Panadería Rosa'. Con señal mala, mientras el fetch está en curso —o si falla del todo, porque cargarGuias no tiene setCargando ni try/catch— la pantalla muestra 'Este cliente no tiene guías pendientes de facturar'. Él lo lee, concluye que Rosa no le debe nada y pasa al siguiente cliente. Lo mismo cuando la carga inicial de clientes falla: el desplegable queda vacío sin explicación.
- **Impacto:** Cuentas por cobrar de fiado mayorista perdidas por un estado vacío mentiroso, en silencio y en la pantalla que mueve la plata más grande. El dueño ni se entera.
- **Fix propuesto:** Estado 'Buscando guías…' mientras carga; try/catch que muestre 'Sin conexión, reintenta' con botón; nunca reutilizar el mensaje de 'no hay guías' para el caso de carga o error. Mismo tratamiento para el fetch de clientes.

### [ALTA] (ruta) La entrega parcial precarga el total y 'Editar' es un link gris diminuto: se registran kilos que no se entregaron
- **Escenario:** El pedido es 10 kg pero se produjeron 8 y el repartidor lleva 8. Llega, entrega los 8 físicos, saca la foto. La pantalla dice 'Entrega: 10 kg' (precargado con el total) y abajo el botón grande verde. Para corregir a 8 tiene que ver un 'Editar' gris de 14px, tocarlo, borrar el 10 y teclear 8. Apurado, con cola, toca el verde: queda registrado 10 kg cuando entregó 8.
- **Impacto:** Se registran 2 kg fantasma en cada parcial. Ese número alimenta la facturación y la conciliación del dueño: al cliente le cobran de más (o el inventario descuadra). Descuadres de plata sistemáticos, sin mala intención, porque el camino de menor esfuerzo registra lo que NO se entregó.
- **Fix propuesto:** Hacer la entrega parcial un botón visible de tamaño táctil real, o dividir en dos botones explícitos 'Entregar completo (10 kg)' y 'Entregar menos…'. Precargar el total está bien para velocidad, pero la reducción no puede ser un link escondido.

### [ALTA] (caja) 'Sin sesión' en rojo al cobrar/cerrar/guardar, sin salida y perdiendo el trabajo tecleado
- **Escenario:** La sesión se cae por inactividad (10 min). El vendedor termina de contar, teclea los 8 medios, aprieta 'Cerrar caja' y sale 'Sin sesión' en rojo. No entiende qué es 'sesión', no sabe que debe reingresar y, si lo mandan a /ingresar, pierde los 8 montos que están en estado local. El interceptor de sesión vencida solo actúa en GET, así que este POST se estrella. El mismo dead-end se repite en /facturar (al registrar) y en las 4 secciones de /admin.
- **Impacto:** Cobro y cierre frenados con jerga técnica, sin camino de vuelta y con pérdida del trabajo hecho, en el peor momento (fin del día). Es un patrón transversal que golpea las tres pantallas que graban plata.
- **Fix propuesto:** Que los POST también distingan 401: mostrar 'Tu sesión se cerró por inactividad. Vuelve a entrar y KiloPan recuerda lo que contaste' con botón 'Volver a entrar' que preserve lo tecleado (guardarlo antes de redirigir). Nunca mostrar 'Sin sesión' crudo. Aplicar el mismo patrón en facturar y admin.

### [ALTA] (inicio) 'Salir' sin señal se rompe: quedas logueado y el siguiente turno vende con tu nombre
- **Escenario:** Panadería de muros gruesos, señal intermitente. Termina el turno, el vendedor toca 'Salir'. El fetch a /api/auth/logout tiene await sin try/catch: offline la promesa se rechaza y las líneas de abajo (olvidarOperador y router.push) nunca corren. El botón no hace nada visible. El vendedor cree que salió, deja la tablet, y el turno siguiente encuentra la sesión de Juan abierta y cobra bajo su nombre.
- **Impacto:** Ventas atribuidas al operador equivocado: la caja descuadra por persona y nadie sabe quién vendió qué. Para el dueño de 3 sucursales es el clásico 'a mí no me cuadra' irrastreable, y le abre la puerta al ladino para echarle la culpa a otro.
- **Fix propuesto:** Envolver en try/catch y correr olvidarOperador()+router.push SIEMPRE (finally), para que el logout local complete aunque el servidor no responda. Mostrar 'Saliendo…', deshabilitar el botón mientras corre, y avisar 'Sin conexión: cerraste sesión en este equipo, se sincroniza al volver la señal'.

### [ALTA] (caja) El cierre de caja es irreversible pero se graba de un toque, sin confirmar, y no se puede corregir un cero de más
- **Escenario:** Con la cola encima, el vendedor roza 'Cerrar caja' o teclea rápido y se le va un cero ('+$400.000'). Al grabar, el botón desaparece; los inputs de arriba siguen editables (parece que puede corregir) pero no hay nada que los reenvíe, y la constraint 'un cierre por día' bloquea recerrar. Además, un medio que dejó en blanco se graba como $0 y aparece como faltante gigante ('-$80.000'), haciéndolo pensar que le robaron.
- **Impacto:** Un dedazo o un roce queda registrado como descuadre permanente del día, sin salida en la UI ni mensaje que lo explique. Inputs editables que no hacen nada = affordance mentirosa. Descuadres falsos en los reportes que el dueño mira a distancia.
- **Fix propuesto:** Un paso de confirmación antes de grabar que muestre el total contado y advierta 'Después no se puede editar'; avisar si algún medio con esperado>0 quedó en blanco ('Te faltó contar: Transferencia'); y tras cerrar, quitar la edición de los inputs mostrando 'Cierre guardado; si te equivocaste, avisa al admin'. Permitir 'corregir cierre' con registro de quién y cuándo.

### [ALTA] (caja) Teclear el efectivo con el teclado chico del sistema descuadra la caja por diseño
- **Escenario:** El vendedor viene de /vender, donde tecleó los kilos en el teclón (teclas >=64px). Llega a caja, toca 'Efectivo' y le salta el teclado chiquito del sistema (20px, con autocorrector). Con los dedos enharinados aprieta el 4 y el 5 juntos y teclea $455.000 en vez de $45.000. El mismo quiebre ocurre con el RUT en /ingresar y /vincular y con los <select> nativos de fiado (/vender) y rol (/admin).
- **Impacto:** Error de tecleo directo sobre la plata contada = caja del día descuadrada por diseño, no por robo. Rompe la promesa central de la app en la pantalla más delicada y obliga al vendedor a reaprender a teclear justo ahí.
- **Fix propuesto:** Reemplazar los <input inputMode=numeric> por el flujo de la app: campo grande + TecladoNumerico (CLP entero, sin decimales), idealmente un medio a la vez con CifraGrande como en /vender. Ofrecer teclado propio también para el RUT y reemplazar los <select> nativos por pills/lista de toque grande.

### [ALTA] (admin) Resetear PIN dice «PIN reseteado» aunque haya fallado: la empleada no puede entrar
- **Escenario:** El dueño resetea el PIN de la Juanita a 1234 y confirma. La wifi se corta justo ahí: patch() cae en su catch y pinta 'Sin conexión' en rojo, PERO confirmarReset sigue de largo, ejecuta setMensaje('PIN reseteado') y cierra el formulario. El dueño ve el verde, le dice a la Juanita que su PIN es 1234, y nunca se guardó.
- **Impacto:** La Juanita no puede entrar y el dueño hace troubleshooting a ciegas o la culpa a ella. patch() se traga el resultado y confirmarReset asume éxito incondicional: cualquier fallo (red, 401, 500) se reporta como logrado.
- **Fix propuesto:** Que patch() devuelva un booleano de éxito (o lance). Solo mostrar 'PIN reseteado' y cerrar el formulario si patch() confirmó ok; si falló, dejar el formulario abierto con el error visible para reintentar.

### [ALTA] (pedidos) Armar ruta con un pedido sin guía crea una 'ruta fantasma' que deja los pedidos trancados sin salida
- **Escenario:** Hay un pedido A (con guía, verde) y B (sin guía, rojo). El panadero llena repartidor y patente y aprieta 'Armar ruta y salir' sin registrar la guía de B; el botón nunca se bloquea. El primer POST marca A y B como en_ruta; el PATCH a en_curso rebota porque B no tiene DTE, pero la lista no se refresca. Registra la guía de B, reintenta, y ahora sale 'No hay pedidos confirmados' porque en la base ya quedaron en_ruta en una ruta que nunca salió. Desde esa pantalla ya no puede despacharlos nunca más.
- **Impacto:** Pedidos reales bloqueados sin forma de recuperarse desde la UI; hay que meter mano a la base. En plena mañana con cola, frena todo el despacho.
- **Fix propuesto:** Antes de armar, chequear en el cliente si algún pedido confirmado tiene dte_count===0 (el dato ya está en la lista) y frenar con 'Hay pedidos sin documento — regístralos antes de salir', sin tocar la base. Deshabilitar 'Armar ruta y salir' mientras quede un pedido rojo.

### [ALTA] (pedidos) El monto del documento del SII se registra en $0 si se deja en blanco
- **Escenario:** En 'Registrar documento del SII' el campo 'Monto total' no es obligatorio ni viene precargado. El panadero apurado teclea el folio, salta el monto y registra: funciona, el pedido se pone verde y la ruta se destranca. Pero quedó una guía por $0 que no cuadra con el total del pedido. Un ladino descubre que con monto vacío destranca la ruta sin poner el documento de verdad.
- **Impacto:** Documentos en $0 ensucian la conciliación y el registro tributario, y destraban rutas sin respaldo real. Plata mal registrada que aparece descuadrada semanas después sin que nadie sepa de dónde salió.
- **Fix propuesto:** Precargar el monto con el total del pedido (p.total_clp, editable) y exigir monto > 0, o al menos avisar cuando el monto tecleado no coincide con el total del pedido antes de registrar.

### [ALTA] (pedidos) El panel de DTE no dice a qué pedido se le está pegando el folio: guía asociada al cliente equivocado
- **Escenario:** Hay tres pedidos rojos. El panadero aprieta 'Asociar guía o factura' en el segundo. El panel baja pero solo dice 'Registrar documento del SII' — sin número, sin cliente, sin total. Si lo interrumpe un cliente y vuelve, no sabe si el folio va al pedido correcto. Pega la guía de la panadería X contra el pedido de la panadería Y.
- **Impacto:** Guías/facturas asociadas al pedido equivocado: descuadra la conciliación pedido-documento y puede dejar salir a ruta un pedido con el DTE de otro. Corregirlo después es engorroso y confunde la contabilidad.
- **Fix propuesto:** Poner en el encabezado del panel a quién se documenta: 'Documentando: N° 42 · Panadería La Estrella · $45.000' con correlativo, cliente y total del pedido seleccionado.

### [ALTA] (pesar) Un pesaje encolado que rebota al subir se descarta en silencio: kilos despachados que nunca entran al sistema
- **Escenario:** El maestro pesa 8 bandejas a reparto SIN señal a las 5 AM; cada una da el verde 'Pesado sin señal — se sube solo' y carga el furgón confiado. Al volver la señal, si en Despacho marcaron ese pedido como entregado, esas bandejas dan 4xx, se hace quitar() y desaparecen de la cola. Solo ve un renglón rojo '8 pesaje(s) rebotaron: El pedido de X ya está entregado' con el literal '(s)', mostrando solo el motivo del primero, sin producto ni kilos, y el registro ya está borrado. El pan ya salió; no hay forma de re-pesarlo.
- **Impacto:** Kilos despachados que nunca entran al sistema: la conciliación (TCK) queda descuadrada y el dueño no puede saber qué se despachó. Peor por venir con verde de éxito antes: el maestro confió y no tiene cómo saber qué re-registrar.
- **Fix propuesto:** No borrar en silencio: dejar el pesaje rebotado en una bandeja 'necesita tu atención' con producto + kilos + destino + motivo legible y un botón 'reintentar/corregir'. El aviso debe listar cada uno (no '(s)' ni solo el primero) y ser accionable.

### [ALTA] (facturar) 'Registrar factura' hace creer que la app EMITE la factura, pero solo enlaza un folio que el panadero debió sacar antes en el SII
- **Escenario:** Don Luis junta las 4 guías de Panadería Rosa, ve el botón grande 'Registrar factura por $340.000' y lo toca esperando que salga la factura para cobrar. No pasa nada (está deshabilitado por falta de folio). No entiende qué folio le piden ni que primero tenía que emitir la factura en el portal del SII. El subtítulo 'Aquí las agrupas en una factura para cobrar' y el placeholder 'Folio de la factura que emitiste' refuerzan que la app la crea.
- **Impacto:** Se traba justo en la cobranza de mayor monto (fiado mayorista), o inventa un número de folio para avanzar, generando facturas con folios que después no cuadran con el SII.
- **Fix propuesto:** Microcopy que ordene el flujo: '1) Emite la factura en el SII  2) Escribe aquí su folio para enlazar estas guías'. Renombrar el botón a 'Enlazar guías al folio N°…' o 'Guardar factura del SII' para que no prometa emitir. Agregar un paso de confirmación (folio + N guías + total) antes de comprometer.

### [ALTA] (inicio) El menú de inicio son 7 palabras sueltas sin una línea que diga qué hace cada una
- **Escenario:** Primer día. El dueño-panadero entra y ve siete cajones idénticos: Panel del dueño, Despacho, Consolidar y facturar, Pesaje, Venta mostrador, Cierre de caja, Ajustes. Sin íconos, sin subtítulos, mismo borde y grosor de letra. Con harina y cola tiene que leer y adivinar. Lo curioso: casi todas las pantallas destino SÍ traen una línea que las explica, pero el menú esconde toda esa ayuda. Además 'Despacho' y 'Venta mostrador' se confunden (una es reparto mayorista con guía, la otra el mesón), y el destino tiene otro título ('Pesaje'->'Pesar').
- **Impacto:** El punto de entrada no orienta: el primerizo entra a la pantalla equivocada por probar, registra una venta de mostrador como pedido mayorista (o al revés) y descuadra la caja sin que nadie lo note. No escala a capacitar 8 empleados uno por uno.
- **Fix propuesto:** Agregar un subtítulo de una línea bajo cada etiqueta (reusar el texto plano que ya vive en cada pantalla destino) y/o un ícono grande a la izquierda. Diferenciar 'Despacho — pedidos para reparto a otros negocios' vs 'Venta mostrador — cobrar al cliente que tienes al frente', agrupar 'Vender' vs 'Facturar', y unificar la etiqueta del menú con el título del destino.

### [ALTA] (dashboard) Los botones de la tarjeta de flota (CTA de e-auto) no hacen nada: lead de monetización perdido
- **Escenario:** El dueño ve que repartir en eléctrico le ahorra plata, se entusiasma y toca 'Quiero que e-auto me contacte'. No pasa absolutamente nada: sin spinner, sin 'gracias', sin cambio de color. Cree que la app se colgó, lo toca 3 veces más, se frustra y se olvida. El botón se ve 100% vivo pero está hueco (el propio comentario del código admite que no hay POST detrás).
- **Impacto:** Es literalmente el CTA de monetización/upsell (captar el lead de e-auto y KiloRuta) y tira el interés del cliente al suelo sin registrarlo. Un botón que parece funcional pero responde con silencio, y que además cuesta plata directa: el dueño ya dijo 'sí, contáctenme' y nadie lo escucha.
- **Fix propuesto:** Mientras no exista el backend, que el botón no se vea totalmente operativo: al tocarlo mostrar 'Listo, te contactamos pronto' (registrando la intención al menos localmente/por correo) o marcarlo 'Próximamente' deshabilitado. Nunca un control que parece vivo y responde con silencio.

### [MEDIA] (facturar) El campo 'RUT emisor' viene editable y prellenado en cada factura/documento: foot-gun y no escala
- **Escenario:** El RUT del emisor es SIEMPRE el mismo (la panadería), pero aparece como campo de texto editable prellenado ('76.192.083-9') tanto en /facturar como en el panel de DTE de /pedidos. Con las manos enharinadas Don Luis roza el campo y borra un dígito, o teclea el folio dentro del RUT. Si lo deja vacío, el servidor responde 'Faltan campos' (jerga que no orienta). Si el software se instala en otra panadería, el precargado hace registrar todo con el RUT de otra empresa.
- **Impacto:** Facturas y documentos registrados con RUT emisor equivocado (descuadre tributario) que después hay que corregir uno por uno, o bloqueo con un mensaje que no dice qué arreglar. No escala a un dueño con varias razones sociales.
- **Fix propuesto:** Tomar el RUT emisor de la configuración de la empresa/sesión y mostrarlo como dato fijo de solo-lectura ('tu panadería'), no como input por factura. Si debe poder cambiarse, esconderlo tras un enlace 'cambiar emisor' y validarlo antes de enviar.

### [MEDIA] (dashboard) La cifra más grande del panel del dueño es 'TCK', jerga contable que él no entiende
- **Escenario:** El dueño abre su panel entre horneadas y lo primero y más grande que ve es un número enorme encabezado por 'TCK — TASA DE CONCILIACIÓN DE KILOS'. No sabe qué es 'conciliación' ni qué mide un '96%' de kilos. La métrica norte del producto es justo la que no puede leer. En la misma pantalla, 'Vendidos' y 'Entregados con prueba' (ambos verdes) parecen lo mismo y confunden, y no hay ninguna tarjeta que responda su pregunta #1: '¿cuánto vendí hoy en plata?'.
- **Impacto:** Si el usuario objetivo no entiende su métrica norte ni ve su venta en pesos, la propuesta de valor del panel se pierde: mira el tablero y no sabe si su negocio va bien. Es la brecha de relevancia más grande de la pantalla.
- **Fix propuesto:** Encabezar con lenguaje de panadero ('Kilos que cuadran', y 'TCK' en chico entre paréntesis) y decir en plata 'Te faltan X kg por explicar'. Agregar una tarjeta 'Vendido hoy $' (CLP) como cifra destacada, aprovechando que ya es pantalla solo-admin. Renombrar 'Entregados con prueba' a 'Reparto confirmado'.

### [MEDIA] (vender) Agregar al carrito no da ninguna señal y el botón 'Cobrar' queda bajo el pliegue: doble cobro y duda
- **Escenario:** El panadero pesa 1,5 kg de marraqueta y toca 'Agregar'. La pantalla vuelve de golpe a la grilla, idéntica: sin toast, sin conteo, sin scroll al carrito. Con cola y manos enharinadas piensa '¿quedó o no?' y toca el mismo pan otra vez 'por si acaso'. El carrito, el Total y 'Cobrar' se dibujan DEBAJO de toda la grilla; con 8 panes hay que bajar para verlos. Además 'Cambiar' de producto no borra los kilos ya tecleados, que se arrastran al pan siguiente y se cobran sin que nadie pese.
- **Impacto:** Duda en cada venta y riesgo real de cobrar el mismo pan dos veces o cobrar kilos de un pan que nunca se pesó. El botón que hace plata está fuera de la vista.
- **Fix propuesto:** Tras 'Agregar', mostrar confirmación breve (destello o mini-toast 'Agregado') y anclar un resumen fijo abajo (n ítems · Total · Cobrar) en safe-area. Resetear kilos en el onClick de 'Cambiar' (setKilos('')). Descontar lo ya en carrito en el gate de stock para no rebotar recién al cobrar.

---

## C. Temas transversales (patrones que se repiten)

- ERRORES 401 EN CRUDO SIN SALIDA: la sesión vence por inactividad y la app pinta 'Sin sesión' (o 'Cuerpo inválido', 'Folio inválido') en rojo, sin traducir ni ofrecer 'Volver a entrar', y a veces perdiendo el trabajo ya tecleado. Aparece en caja (cierre), facturar, admin (4 secciones) y entrada. El interceptor solo cubre GET, no los POST que graban.
- EL TECLADO DEL SISTEMA INVADE LAS PANTALLAS DE PLATA: el contrato central ('jamás el teclado del sistema, teclas >=64px para manos con harina') se rompe justo donde más duele. Efectivo en /caja, RUT en /ingresar y /vincular, el <select> de fiado en /vender y el de rol en /admin usan controles chicos del SO, invitando a errores de tecleo sobre montos y credenciales.
- ESTADOS DE CARGA/ERROR AUSENTES = 'VACÍO MENTIROSO': sin loading ni try/catch, un fetch lento o caído se ve idéntico a 'no hay nada'. /facturar dice 'no tiene guías pendientes' (fiado no cobrado), /ruta muestra 'No tienes paradas hoy' (reparto completo perdido), la entrada queda en blanco, el dashboard tira el error crudo de Next y el bloque superior de /admin desaparece sin aviso.
- ACCIONES IRREVERSIBLES DE UN SOLO TOQUE, SIN CONFIRMAR NI DESHACER: cerrar caja, registrar un folio de factura, confirmar un pesaje y desactivar personas/productos/medios graban directo y no se pueden corregir desde la UI. Un roce, un cero de más o un dedazo queda grabado como descuadre permanente.
- EL CAMINO DE MENOR ESFUERZO IMPUTA MAL LA PLATA/KILOS (patrón ladino): defaults y atajos que registran lo que no se cobró o no se entregó. Esperado visible antes de contar la caja, entrega parcial precargada con el total y 'Editar' escondido, 'Mostrador' como única salida en /pesar, kilos que se arrastran al cambiar de producto, monto DTE que pasa en $0, inercia de reparto al pedido anterior.
- BOTONES Y TOQUES SIN FEEDBACK: controles que parecen vivos y responden con silencio. El CTA de e-auto (monetización) no hace nada, 'Agregar' al carrito no da ninguna señal, los links de inicio y el logout offline no reaccionan, y varios botones quedan gris sin decir qué falta para habilitarlos.
- EL ESTADO DE CONEXIÓN MIENTE OFFLINE: el ChipEstadoConexion, diseñado para 'nunca mentir', no recibe navigator.onLine en /ruta (dice 'Subiendo' o 'Sincronizado' sin señal) y en /pesar se apaga cuando todo está sano, dejando ambiguo el silencio. El usuario más offline (el repartidor) es el peor informado.
- JERGA CONTABLE/TÉCNICA EN LAS ETIQUETAS MÁS VISIBLES: 'TCK', 'consolidar', 'despacho', 'RUT emisor', 'enrolado/revocado', 'entregados con prueba'. Varias pantallas destino ya traducen la jerga en un subtítulo interno, pero el menú y los titulares dejan la palabra difícil a la vista.
- EL TECLADONUMERICO MANEJA MAL EL DÍGITO FUERA DE MONTOS: la lógica pensada para montos (colapsar el 0 inicial, apendear dígitos) se reutiliza sin adaptar en flujos que no son plata: bloquea el PIN que empieza con 0 (/ingresar) y convierte 10->5 en 105 al editar kg (/ruta).
- **500 crudo en vez de 400 validado** (red-team, patrón en ~15 endpoints): entradas malformadas —cookie no-UUID, montos fuera de rango int4/int32, medioPago/pedidoId/productoId inexistente, RUT no prevalidado— producen HTTP 500 con el mensaje crudo de Postgres (nombres de constraints/columnas). Sin robo, pero filtra el esquema y ensucia la operación. Fix transversal: validar tipo/rango antes de tocar la BD, y un `catch` que devuelva 400 con mensaje limpio.

---

## D. Plan de corrección propuesto

Ordenado por lo que primero **descuadra plata o frena la operación**, luego robustez y claridad. Cada tanda es un commit verificado con `pnpm check:full`, igual que las 6 tandas anteriores.

### Tanda A — Plata y stock (no se vende ni se cuadra lo que no existe) · CRÍTICO
1. **Sobreventa por capitalización de UUID** (`api/ventas`): normalizar `productoId` (minúsculas / validar UUID) antes de usarlo como clave del `Map` acumulador. Añadir test que mande el mismo UUID en dos capitalizaciones.
2. **Merma sin tope deja stock negativo** (`api/pesajes`): rechazar una merma que dejaría `pan.stock_disponible()` bajo cero (no se puede mermar pan que no está). Verificado en vivo: se llega a −139.000 g.
3. **Cierre de caja a ciegas** (`caja/page.tsx`): ocultar el monto esperado hasta que el vendedor teclee lo contado; revelar esperado + diferencia recién al cerrar. "Modo abierto" opcional que solo el dueño active. _(Decisión de producto — es el hallazgo que más plata cuesta.)_
4. **Monto DTE en $0 y punto de miles** (`api/dte`): exigir `montoTotal >= 1` (hoy acepta 0, inconsistente con el folio que exige ≥1) y validar en servidor sin confiar en el parseo del cliente.
5. **`totalFacturadorClp` / `declaradoClp` sin validar** (`api/cierre-caja`): rechazar negativos, no-enteros y fuera de rango int4 (hoy dan 500 o envenenan la conciliación).

### Tanda B — La operación no se frena (el personal puede trabajar) · ALTO
6. **PIN que empieza en 0 intecleable** (`TecladoNumerico`): modo `esPin`/`permitirCeroInicial` que use siempre `valor + tecla` sin colapsar el cero, activado en `/ingresar` y `/vincular`. Corrige de paso el `10→105` al editar kg en `/ruta`.
7. **Sin GPS el repartidor no registra nada** (`ruta/page.tsx`): botón "Reintentar ubicación"; permitir "No se pudo entregar" sin GPS (la foto ya es evidencia, marcar `gps_degradado`); último recurso, confirmar entrega sin ubicación marcada para revisión.
8. **"Salir" sin señal deja la sesión viva** (`CerrarSesionBoton`): `try/finally` que limpie el operador local y navegue pase lo que pase; el logout server se reintenta.
9. **"PIN reseteado" que miente** (`admin/page.tsx`): `patch()` debe devolver éxito/fallo; el llamador solo muestra "reseteado" si fue verdad. Mismo arreglo para `toggleActivo` y `guardarPrecio`.

### Tanda C — La app no miente (feedback honesto) · ALTO
10. **"Vacío mentiroso"** (`facturar`, `ruta`, `dashboard`, entrada): distinguir cargando / error / vacío-real en cada fetch. Un error de red no puede verse igual que "no hay fiado por cobrar" o "no hay reparto hoy".
11. **Sesión vencida a mitad de mutación = venta/pesaje perdido** (`pod/outbox.ts` `enviarOEncolar`): tratar 401/403 como reintentable (igual que `sincronizar()` en el fondo), no como rechazo de negocio; mensaje claro con "Volver a entrar" en vez de "Sin sesión" en crudo.
12. **Pesaje encolado que rebota se descarta en silencio**: reportar al operador los kilos que no entraron, no tragarlos.

### Tanda D — Robustez de entrada (cero 500 crudos) · MEDIO
13. **Validación defensiva transversal**: en cada endpoint, validar tipo/rango/existencia antes de tocar la BD, y envolver en `try/catch` que devuelva **400 con mensaje limpio** — nunca 500 con texto de Postgres. Cubre cookie no-UUID (→401), montos fuera de int4/int32, `medioPago`/`pedidoId`/`productoId` inexistentes, RUT no prevalidado, `ind_traslado` fuera de rango.
14. **Sanitizar mensajes de error**: nunca devolver nombres de constraints/columnas de Postgres al cliente.

### Tanda E — Integridad de datos · MEDIO
15. **Entrega parcial ínfima cierra el pedido** (`api/sync`): un umbral mínimo (o marcar "parcial" para la cola de revisión) para que 1 g de 10.000 no cuente como entregado y desaparecido.
16. **`capturado_at` del reloj del cliente sin validar**: acotar a una ventana razonable server-side para que el repartidor no mueva entregas a cualquier día.
17. **Carrera check-then-insert en venta** (`api/ventas`): en Postgres de producción (pool multi-conexión) la validación de stock y el insert no son atómicos — `SELECT ... FOR UPDATE` o un constraint. Rebota bien en PGlite (un proceso), pero es riesgo latente en Railway.
18. **Sesión sin tope duro server-side**: el "límite 12 h" es solo `Max-Age` de la cookie; validar la antigüedad de la sesión en el servidor.

### Tanda F — Claridad y quitar jerga · BAJO/MEDIO
19. **Menú de inicio**: una línea de descripción bajo cada opción ("Despacho", "Consolidar y facturar" no le dicen nada a un panadero simplón).
20. **Traducir jerga**: "TCK" (la cifra más grande del panel del dueño), "consolidar", "DTE", "RUT emisor" — subtítulo o rótulo en lenguaje de panadería.
21. **Quitar/editar ítem del carrito** (`vender`): hoy un ítem agregado no se puede corregir sin cobrar mal o empezar de cero.
22. **Feedback de toques**: "Agregar" al carrito sin señal visual; CTA de flota (e-auto) que no hace nada; botones grises sin decir qué falta.
23. **Teclado del sistema en campos de plata/RUT**: `/caja` (efectivo), `/ingresar` y `/vincular` (RUT), los `<select>` de fiado y de rol usan controles chicos del SO — contradice el contrato de teclas ≥64px.

---

## Anexo — Refutados por la verificación adversarial (no re-levantar)

Se dejan registrados para que nadie vuelva a reportar la misma falsa alarma.

| Hallazgo propuesto | Por qué cayó |
|---|---|
| GET /api/productos entrega precio_mostrador_clp a un repartidor | La observacion se reproduce EXACTAMENTE: logueado como repartidor (QA autorizacion, rol=repartidor), GET /api/productos devuelve HTTP 200 con precio_mostrador_clp por producto (Dobladitas 2890, Frica 2490, Hallulla 2090, Integral 2990, Marr |
| [INFO — defensa confirmada] La matriz de autorizacion contiene por completo la escalada del repartidor; escrituras y lecturas de plata rebotan 403 y las cookies/headers falsos 401 | Re-ejecute el comando reproductor EXACTO y observe lo mismo: ventas=403 clientes=403 sin-cookie=401 cookie-falsa=401. La defensa central que describe el hallazgo es REAL y es comportamiento CORRECTO, no un bug: (1) las 15 escrituras rebotan |
| Venta al contado (efectivo) cobra a precio MAYORISTA al adjuntar un cliente mayorista | Reproduje EXACTAMENTE lo observado contra el server vivo (localhost:3301): venta efectivo + clienteId de Almacén Don Lucho (lista_precio='mayorista'), Hallulla 1000g → HTTP 200 {"totalClp":1590}. Controles: la MISMA venta sin clienteId da 2 |
| DEFENSA CONFIRMADA: /api/ventas recalcula el precio en el server e ignora el precioClp del cliente | El "hallazgo" es una DEFENSA CONFIRMADA (severidad info, sin vulnerabilidad) y es EXACTO: no hay bug. Reproducción: con sesión válida de vendedor re-ejecuté el comando reproductor (precioClp:1) contra localhost:3301 y obtuve HTTP 409 — la v |
| DEFENSA CONFIRMADA: el gate de rol bloquea al vendedor en todos los endpoints admin de precio/DTE/factura | Reproduje el comando exacto contra el servidor vivo (3301) con sesion REAL de vendedor y confirmo que NO hay hallazgo: es comportamiento correcto, no un defecto. Por eso REFUTED (el eje del veredicto es bug/no-bug; una "defensa confirmada"  |
| Defensas del POD confirmadas (control positivo) | Re-ejecuté el comando reproductor exacto con la cookie del repartidor pod y observé lo mismo: {"aceptadas":[],"rechazadas":[{"motivo":"Ese pedido no es una parada de tu ruta activa"}]}. La query de parada en sync/route.ts exige r.repartidor |
| montoTotal 0 aceptado: se registra un DTE (guia/factura) por $0 sin justificacion | Reproduje el curl exacto contra el server aislado (pglite en localhost:3301, arrancado con DB_MODE=pglite para NO tocar Railway): POST /api/dte con tipoDte:52, montoTotal:0 devuelve 200 {"id":...} y GET /api/facturar confirma la guía folio  |
| DEFENSA OK (info): la merma SÍ descuenta del stock disponible (fix 0012 funciona) | Re-ejecuté el reproductor contra el servidor vivo (localhost:3301) desde una línea base controlada. Con la sesión de "merma" (rol maestro, login 200), el stock de Dobladitas estaba en -5000g; tras POST /api/pesajes {gramos:5000, destino:"me |
| DEFENSA OK (info): centinela outlier AC-PES-03 ('báscula mal tipeada') está vivo y dispara | Reproduje el comando exacto en el servidor vivo (localhost:3301, PID 18320 tras un reinicio del orquestador a mitad de sesión). Tras 3 pesajes de 2500g en Hallulla (32043713…, todos HTTP 200), el pesaje de 30000g sin confirmar devolvió HTTP |
| DEFENSA CONFIRMADA: bloqueo por PIN AC-SEC-01 (5 fallos → 15 min) funciona | Reproduje el comando exacto contra localhost:3301 con la identidad "entrada" (RUT 15.001.233-3, dispositivo c8bec55f...). Resultado idéntico al reportado: intentos 1-4 con PIN 0000 → 401; 5º y 6º → 423 con cuerpo {"error":"Bloqueado por int |
| DEFENSA CONFIRMADA: inyección SQL/XSS neutralizada (queries parametrizadas) | El reporte reproduce exactamente, pero describe comportamiento CORRECTO (una defensa funcionando), no un defecto — por eso REFUTED con esBugReal=false. Re-test en vivo: POST /api/clientes con razonSocial="Bobby'); DROP TABLE pan.ventas;-- < |
| Defensas de integridad de sesión confirmadas (relevo, logout, cookie ausente/forjada, headers falsos) | Re-ejecuté cada vector del reporte contra el servidor vivo en localhost:3301 (confirmé antes que ese proceso tiene abierto el data-dir pglite y NO tiene conexión saliente a Railway; nunca toqué producción). Todos los resultados coinciden co |

