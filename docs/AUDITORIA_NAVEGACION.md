# Auditoría de navegación y funcionamiento — KiloPan

**Fecha:** 2026-07-25 · **Nivel:** EXHAUSTIVO · **Estado del árbol:** trabajo en curso sin commitear
(3 archivos modificados + `api/pedidos/pendientes/` sin trackear). No se commiteó, guardó ni
descartó nada. **Cero archivos de producto modificados por esta auditoría.**

**Base de datos auditada:** Postgres hospedado en Railway (decisión explícita del usuario), no
PGlite. §2 del encargo decía PGlite; el `.env.local` vigente dice `DB_MODE=postgres`. Ese
desajuste está registrado como hallazgo.

**Método:** 176 agentes. 12 auditores (6 estáticos en paralelo + 6 conductores de navegador
serializados) produjeron 175 hallazgos en bruto; se agruparon en 83 causas raíz; 52 causas
CRÍTICA/ALTA pasaron por 3 verificadores adversariales independientes con instrucción de
refutar (sobrevive con 2 de 3), las MEDIA/BAJA por uno. Resultado: **76 causas confirmadas,
7 refutadas.**

---

## Veredicto

**No. Hoy no se puede operar una panadería con esto.** No por falta de funciones —están casi
todas construidas y varias están bien hechas— sino porque el dinero y los kilos no están a
salvo: la venta deja vender pan que no existe, la cola offline **borra** ventas y pesajes
cuando la sesión vence, y el cierre de caja lee «45.000» como $45.

Cualquier operador autenticado puede hacer cualquier cosa: no existe `middleware.ts`, 9 de 12
pantallas no comprueban nada, y los endpoints de escritura del flujo dorado no miran el rol.
El repartidor ve la plata que el propio producto declara que jamás debe ver.

La buena noticia es que **la mayoría del daño se concentra en pocos patrones repetidos**, no en
76 defectos independientes. El plan de abajo los ataca en 6 tandas; la Tanda 0 son tres
correcciones de una línea cada una.

---

# PLAN DE CORRECCIÓN

Ordenado por **sangrado primero, dependencia después**. Cada tanda es independiente de las
siguientes: se puede parar en cualquier punto y lo hecho sigue valiendo.

> **Antes de tocar nada:** hoy `pnpm check` sale VERDE con el paso e2e **SALTADO**, porque
> `apps/kilopan` no tiene `playwright.config.ts`. Ninguno de los 76 defectos de este informe
> hace fallar el gate. Ver Tanda 6: hasta que exista ese archivo, verde no significa nada.

## Tanda 0 — Tres líneas que paran sangrado hoy (≈30 min)

| # | Qué | Dónde | Cambio |
|---|---|---|---|
| 0.1 | Reparto se puede pesar | `apps/kilopan/src/app/pesar/page.tsx:514` | Borrar `\|\| destino === "reparto"` del `disabled` |
| 0.2 | El cierre de caja deja de perder ceros | `apps/kilopan/src/app/caja/page.tsx:34` | Sanear el punto de miles antes de `Number()` |
| 0.3 | Un fallo de BD deja de ser permanente | `apps/kilopan/src/comun/db.ts:193-194` | No cachear el promise si se rechaza |

**0.1** — El JSX anula la lógica que la propia pantalla ya calcula bien en `:203-208`
(`destino !== "reparto" || !!pedidoLineaId`). El candado **ya venía en HEAD** con el texto viejo
«Reparto se habilita cuando exista el módulo de despacho»: el trabajo sin commitear construyó la
función completa —validación en el endpoint, selector de línea de pedido, endpoint
`pedidos/pendientes`— y solo olvidó quitarlo. **Es un residuo de una línea, no un diseño a medio
hacer.** Confirmado en ejecución: con producto, 5 kg, destino Reparto y línea de pedido
seleccionada, el botón sigue `disabled: true`.

**0.2** — `Math.round(Number(declarados[m.medio_pago] || "0"))`. En Chile se escribe `45.000`
y `Number("45.000")` da `45`. El cierre registra **$45 donde había $45.000**. Sanear:
quitar puntos de miles y aceptar coma decimal. Ojo: el mismo patrón sin sanear está en el
«Monto total» del DTE (`pedidos/page.tsx:98`) — arreglar los dos juntos.

**0.3** — `if (!poolPromise) poolPromise = crearPool(url); return poolPromise;` Si la primera
conexión falla (corte de red, Railway reiniciando), el promise **rechazado** queda cacheado y
toda la app devuelve 500 hasta que alguien reinicie el proceso. Añadir `.catch(() => { poolPromise = null; throw e })`.
No es un defecto de `/caja` aunque ahí se detectó: está en el módulo de BD y afecta a los 21 endpoints.

## Tanda 1 — Autorización (el agujero más grande, un solo patrón)

Nueve causas confirmadas son la misma ausencia. Hoy **el menú de `/inicio` es la única
autorización de la UI**: escribiendo la URL, cualquier rol abre `/admin`, `/caja`, `/vender`,
`/pedidos` y `/facturar`, y en `/caja` llega a escribir en la base.

1. **Crear `apps/kilopan/middleware.ts`** — no existe. Es la pieza que falta. Debe validar la
   cookie de sesión y redirigir a `/ingresar` toda ruta que no sea `/ingresar` ni `/vincular`.
2. **Añadir un helper `exigirRol(sesion, [...roles])`** junto a `exigirSesion`, y aplicarlo a:
   - **Escritura sin control de rol:** `POST /api/ventas`, `POST /api/pesajes`, `POST /api/dte`,
     `POST /api/pedidos`, `POST /api/cierre-caja`, `PATCH /api/rutas`.
   - **Lectura que filtra plata:** `GET /api/clientes` (saldos de fiado), `GET /api/pedidos`
     (`total_clp`), `GET /api/entregas`, `GET /api/facturar`, `GET /api/usuarios` (nómina),
     `GET /api/cierre-caja`.
3. **`POST /api/sync`**: exigir rol repartidor **y** que el `pedidoId` corresponda a una parada
   de la ruta activa de quien llama. Hoy cierra un POD sobre cualquier pedido del sistema.
4. **`PATCH /api/rutas`**: exigir rol y pertenencia, y validar el rango del odómetro (alimenta
   el $/km del panel del dueño).

> El patrón correcto **ya existe en el repo**: `POST /api/clientes` hace
> `if (sesion.rol !== "admin") return 403`, y `POST /api/rutas` también. Es replicar, no diseñar.

## Tanda 2 — La cola offline pierde plata (pérdida de datos irreversible)

1. **`pod/outbox.ts:247-256` y `:228-231`** — `else if (r.status < 500) { await quitar(...) }`
   mete un **401 de sesión vencida** en el mismo saco que un rechazo de negocio legítimo
   (stock insuficiente, outlier). Resultado: **la venta o el pesaje se borran para siempre.**
   Separar: 401/403 → reintentar tras reautenticar, nunca descartar. 409/422 de negocio → sí descartar,
   pero avisando.
2. **`vender/page.tsx:6`** — importa `enviarOEncolar` pero **nunca llama a `iniciarSyncAutomatico`**,
   a diferencia de `/pesar:185` y `/ruta:59`. La venta queda en IndexedDB sin nadie que la drene,
   y la pantalla muestra «se sube solo» (`:112`), que es mentira. Añadir la llamada y un chip de
   pendientes.
3. **`ruta/page.tsx:59`** — `iniciarSyncAutomatico(setPendientes)` pasa un setter de React como
   callback `alCambiar(pendientes, rechazadas?)`: **el segundo argumento se ignora**. El POD
   rebotado desaparece y la parada se cuenta como entregada. Manejar `rechazadas` y recargar la ruta.
4. **Atar la cola al operador** (`outbox.ts:125-134`): hoy lo encolado por uno se sube con la
   sesión de quien esté logueado al sincronizar. En una tablet compartida eso atribuye la venta
   al operador equivocado.

## Tanda 3 — Zona horaria: el negocio se corta a las 20:00

**Causa raíz única, capturada en vivo durante esta auditoría.** `current_date` lo evalúa
**Postgres**, que en Railway corre en **UTC**. A las 00:00 UTC —**20:00 en Chile**— el día
avanza y todo lo que filtra por «hoy» cambia de día mientras la panadería sigue trabajando.

Prueba controlada, dos pedidos idénticos creados con minutos de diferencia a las 20:02 Chile:

| Pedido | `fecha_entrega` | ¿Visible en `GET /api/pedidos`? |
|---|---|---|
| correlativo 1 | 2026-07-25 (**hoy** en Chile) | ❌ desaparecido, sin aviso |
| correlativo 2 | 2026-07-26 (mañana) | ✅ visible, `estado: confirmado` |

**Corregir en todos los puntos que usan `current_date`/`::date`:**
`api/pedidos/route.ts:24` · `api/pedidos/pendientes/route.ts:35` · `api/cierre-caja/route.ts:18` y `:55`
· `api/rutas/route.ts:21` · `dashboard/page.tsx`.
Sustituir por el día **en zona horaria de Chile**, p.ej. `(now() at time zone 'America/Santiago')::date`,
en un solo helper SQL para que no vuelva a divergir.

**Impacto si no se corrige:** una panadería trabaja de noche. Entre las 20:00 y medianoche el
turno que arma el reparto del amanecer ve la lista de pedidos vacía, y las ventas del atardecer
caen en el cierre de caja del día siguiente.

## Tanda 4 — Atomicidad e idempotencia (lo que se toca dos veces)

La idempotencia del sistema es **una isla**: está bien hecha justo donde se probó
(ventas, pesajes y sync usan `client_uuid` + `on conflict`) y ausente justo donde no.

1. **`POST /api/cierre-caja:49-82`** — inserta fila por fila **sin transacción, sin unicidad y
   sin idempotencia**. Un cierre puede quedar a medias, y cerrar dos veces duplica el día.
   Envolver en transacción + llave natural `(fecha, medio_pago)` en
   `db/migraciones/0003_venta_mostrador.sql`.
2. **`POST /api/rutas:46-62`** — sin transacción ni idempotencia: cada clic crea una ruta nueva
   con los mismos pedidos.
3. **`POST /api/facturar:69-86`** — consolidar N guías en una factura no es atómico y la base no
   impide facturar dos veces la misma guía: **el saldo del cliente puede quedar al doble.**
4. **`POST /api/ventas:86-129`** — el chequeo de stock está **dentro** del `for` de líneas y
   compara cada línea contra el stock completo, sin acumular lo ya comprometido en el mismo
   carrito. Dos líneas del mismo producto venden pan que no existe. Acumular por producto antes
   de validar (o consolidar líneas en `vender/page.tsx:77-80`).
5. **`pan.stock_disponible()`** (`0003:99-108`) es un **acumulado histórico** y la merma no
   descuenta: al día siguiente hay stock fantasma.

## Tanda 5 — Bloqueadores de producto (funciones que faltan, no defectos)

1. **No existe pantalla para dar de alta un cliente.** `POST /api/clientes` existe y está bien
   protegido (solo admin), pero **ninguna pantalla lo llama**. Sin clientes no hay pedidos, ni
   reparto, ni fiado, ni facturación: **el día 1 la mitad del producto es inalcanzable.**
   Es la dependencia raíz de todo lo demás — sin esto no se puede ni auditar al repartidor.
2. **No existe la entrega parcial ni la entrega fallida.** El POD registra como entregado lo
   **pedido**, no lo que el repartidor dejó (`ruta/page.tsx:152`), y el cliente cerrado no tiene
   cómo registrarse. En reparto real ambas cosas pasan a diario.
3. **`/api/sync` acepta `gramosEntregados` del cliente** sin contrastarlo con el pedido, y ese
   número alimenta la TCK del dueño.
4. **La foto se sube ANTES de que exista la entrega o el pesaje**: con buena señal el POD queda
   marcado `pendiente_subida` para siempre.
5. **Fiar en el mesón es imposible**: la pantalla cotiza con lista mostrador y el servidor cobra
   la lista del cliente; el 409 se repite indefinidamente.

## Tanda 6 — Cerrar la brecha que permitió todo esto

1. **Crear `apps/kilopan/playwright.config.ts`.** Mientras no exista, `check.sh` reporta el paso
   e2e como SALTADO y **ningún** defecto de este informe rompe el gate. Es la causa de fondo de
   que 76 causas confirmadas convivan con un check en verde.
2. **Service worker (`public/sw.js:56-64`)**: dejar de cachear el HTML de páginas autenticadas.
   Hoy guarda `/inicio` y `/dashboard` y sin señal se los sirve **al siguiente operador de la
   tablet**: el repartidor termina viendo los CLP del dueño. Cachear solo el shell; excluir
   documentos de páginas con datos de sesión, no solo `/api/`.
3. **Rate limit (`identidad/limitador.ts:10`)**: se llavea con `X-Forwarded-For`, una cabecera
   que manda el propio cliente. Rotarla da cuota infinita. Usar la IP real del socket.
4. **`POST /api/dispositivos/enrolar`**: es la **única** verificación de PIN que no pasa por
   `pan.registrar_intento_pin`, así que el bloqueo de 15 min (AC-SEC-01) nunca se dispara ahí.
   Fuerza bruta del PIN de admin. Hacerla pasar por el mismo registro que el login.
5. **La expiración por inactividad no se aplica en `/inicio` ni `/dashboard`**: ambas
   reimplementan la consulta de sesión a mano en vez de usar `obtenerSesionActual`.

### Orden sugerido

```
Tanda 0  ──► Tanda 2  ──► Tanda 3  ──► Tanda 4
   │            (pérdida de datos primero: es lo irreversible)
   └──► Tanda 1 (autorización; independiente, se puede hacer en paralelo)
              └──► Tanda 5 (necesita Tanda 1 para probarse de verdad)
                        └──► Tanda 6 (el e2e sirve una vez que hay algo que valga la pena fijar)
```

---

# COBERTURA REAL

**Esta es la parte incómoda del informe y va antes que los hallazgos a propósito.**

El servidor de desarrollo **se cayó durante la Ola B**. B2 (maestro) y B4 (repartidor) corrieron
contra un servidor muerto y **nunca completaron un login**. Lo que sabemos de esos dos roles
viene casi todo de lectura de código, no de ejecución. El orquestador cubrió después parte del
hueco del maestro (login real, `/pesar`, flujo de reparto de punta a cabo), pero el repartidor
quedó sin una sola sesión.

### Rutas × roles

| Ruta | admin | maestro | vendedor | repartidor |
|---|---|---|---|---|
| `/` | ⚠️ | ❌ | ⚠️ | ❌ |
| `/ingresar` | ✅ | ✅¹ | ✅ | ❌ |
| `/vincular` | ✅² | ❌ | ⚠️ | ❌ |
| `/inicio` | ✅ | ❌ | ✅ | ❌ |
| `/pesar` | ✅ | ✅¹ | ✅ | ❌ |
| `/vender` | ✅ | ❌ | ✅ operada | ❌ |
| `/caja` | ✅ operada | ❌ | ✅ | ❌ |
| `/pedidos` | ✅ | ❌ | ✅ | ❌ |
| `/ruta` | ✅ | ❌ | ✅ | ⚠️³ |
| `/facturar` | ✅ | ❌ | ✅ | ❌ |
| `/dashboard` | ✅ operada | ❌ | ✅ bloqueo verificado | ⚠️³ |
| `/admin` | ✅ operada | ❌ | ✅ fuga verificada | ❌ |

¹ cubierto por el orquestador tras reponer el servidor · ² enrolamiento real ejecutado en Fase 0
· ³ visto **sin sesión y desde el caché del service worker** con el servidor caído: es cobertura
del caché, no del rol.

**Recuento honesto: 30 de 48 combinaciones con evidencia real (62%).** El repartidor tiene
**0 de 12**.

### Endpoints

**Ejercidos con éxito (8/21):** `auth/login` · `auth/logout` · `auth/me` · `productos` ·
`medios-pago` · `clientes` (POST, por el orquestador) · `pedidos` (POST) · `pedidos/pendientes` (GET)

**Ejercidos sin éxito (2):** `pesajes` (única petición → 409 outlier; **cero filas escritas en
`pan.pesajes` en toda la auditoría**) · `cierre-caja` (200 en admin, 500 permanente en vendedor)

**Nunca ejercidos (11/21):** `sync` · `fotos` · `entregas` · `dte` · `facturar` (GET/POST/PATCH)
· `rutas` (GET/POST/PATCH) · `dispositivos/enrolar` (vía API) · `parametros` · `usuarios`

Los tres endpoints **exclusivos del repartidor** —`sync`, `fotos`, `entregas`— tienen **cero
peticiones**. Tres causas CRÍTICAS confirmadas describen el comportamiento de `sync` y ninguna
se ejecutó contra el servidor: son sólidas por código, no por ejecución.

**Endpoints huérfanos detectados:** `GET /api/entregas` y `GET /api/rutas` — ninguna pantalla
los llama.

### Definición de TERMINADO

| Casilla | Estado |
|---|---|
| 12 rutas × 4 roles | ⚠️ 30/48 con evidencia real |
| 21 endpoints ejercidos | ❌ 10/21 |
| Flujo dorado de punta a cabo | ❌ **cero pesajes escritos**; nunca se cerró pesar→vender→caja |
| Reparto y facturación completos | ❌ bloqueados por la falta de pantalla de clientes |
| Offline y reconexión | ⚠️ se probó encolar; **nunca se probó drenar la cola tras reconectar** |
| Móvil 390×844, 12 capturas | ❌ 1 de 12 |
| CRÍTICO/ALTO con 3 verificadores | ✅ 52 causas × 3 refutadores |
| Crítico de completitud | ✅ ejecutado; sus huecos son esta sección |
| Informe escrito | ✅ este archivo |
| Cero archivos de producto modificados | ✅ `git status` idéntico al inicial |

---

# LO QUE FUNCIONA BIEN

No es cortesía: es dónde se puede pisar firme.

- **La identidad está bien pensada donde importa.** El rol viaja en el *startup packet* de
  Postgres (`options: "-c role=pan_app"`), así que **falla cerrado**: si `pan_app` no existe, la
  conexión no se establece en vez de degradarse a superusuario. La cookie es HttpOnly + SameSite
  y la expiración por inactividad se valida **en el servidor**, no en el cliente.
- **El enrolamiento de equipos es correcto.** Exige credenciales de admin en el momento, el
  secreto se devuelve una sola vez y el servidor guarda solo el hash. Verificado de punta a cabo
  en Fase 0.
- **La validación de pesajes es sólida:** `Number.isInteger(gramos)` con rango 1–100.000 y
  rechazo explícito. El trabajo sin commitear añade comprobaciones finas y bien razonadas — que
  la línea de pedido sea **del mismo producto**, y que el pedido siga admitiendo pan.
- **La idempotencia, donde existe, está bien hecha:** `client_uuid` + `on conflict` en ventas,
  pesajes y sync.
- **El control de rol de `POST /api/clientes` y `POST /api/rutas` es el patrón correcto** — el
  que hay que replicar en la Tanda 1.
- **Los guardrails del repo son serios y ya atraparon cosas reales:** el `.env.local` remoto
  exige `KILOPAN_DB_REMOTA_INTENCIONAL=1`, se prohíbe `?sslmode=` en la URL con una explicación
  de por qué, y `check.sh` **nunca reporta OK por omisión**: lista los pasos SALTADOS. Esa
  honestidad del gate es la que permitió escribir este informe.
- **Los mensajes de error de negocio están escritos en chileno y para el panadero**, no para el
  ingeniero: «El pedido de Panadería X ya está entregado: no admite más pan», «Elige a qué pedido
  va este pesaje».
- **El precio lo decide el servidor** en la venta (snapshot de la lista del cliente), no el cliente.

---

# HALLAZGOS

76 causas confirmadas: **13 CRÍTICAS · 18 ALTAS · 27 MEDIAS · 18 BAJAS.**
Se detallan en formato completo las CRÍTICAS y las ALTAS. Las MEDIA/BAJA van en tabla compacta
al final por volumen; cada una conserva su archivo:línea.

## CRÍTICAS

### [CRÍTICA] Dos líneas del mismo producto venden pan que no existe
- **Dónde:** `api/ventas/route.ts:86-129` (chequeo en `:119-127`, dentro del `for` de `:86`); origen en `vender/page.tsx:77-80`
- **Rol:** vendedor · **Verificación:** 3/3
- **Reproducir:** 1. Ingresar como vendedor. 2. `/vender`. 3. Agregar el mismo producto dos veces como líneas separadas. 4. Cobrar.
- **Esperado:** El stock se valida contra la suma del carrito.
- **Observado:** Cada línea se compara contra el stock completo, sin acumular lo ya comprometido. El stock queda negativo.
- **Impacto:** Se vende pan que no está en el mesón. El cliente paga y no hay qué entregarle.

### [CRÍTICA] Una venta cobrada sin señal no se sube nunca, y la pantalla dice que sí
- **Dónde:** `vender/page.tsx:6` (import), `:89-114`, mensaje en `:112` · `pod/outbox.ts:272`
- **Rol:** vendedor · **Verificación:** 3/3
- **Esperado:** Igual que `/pesar:185` y `/ruta:59`, arrancar `iniciarSyncAutomatico`.
- **Observado:** `/vender` solo importa `enviarOEncolar`. La venta queda en IndexedDB sin nadie que la drene, y la pantalla muestra un mensaje de éxito que afirma lo contrario. Tampoco hay chip de cola pendiente.
- **Impacto:** Se cobra, el cliente se va, y la venta no existe para el sistema. Nadie se entera hasta el cuadre.

### [CRÍTICA] La cola offline BORRA la venta o el pesaje cuando el servidor responde 4xx
- **Dónde:** `pod/outbox.ts:247-256` (bucle `otras`) y `:228-231` (entregas)
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** `else if (r.status < 500) { await quitar(item.clientUuid) }` mete 401/403 (sesión vencida, perfectamente reintentable) en el mismo saco que los rechazos de negocio. El propio comentario del código justifica la regla **solo** para rechazos de negocio.
- **Impacto:** El vendedor deja la tablet 10 minutos, la sesión vence, y las ventas encoladas se borran solas. Irreversible.

### [CRÍTICA] `/ruta` descarta las entregas rechazadas: el POD desaparece y la parada se cuenta como entregada
- **Dónde:** `ruta/page.tsx:59`, `:156`, `:247`, `:260-266` · `pod/outbox.ts:228-231,273` · `api/sync/route.ts:96-102`
- **Rol:** repartidor · **Verificación:** 3/3
- **Observado:** `iniciarSyncAutomatico(setPendientes)` pasa un setter de React como callback `alCambiar(pendientes, rechazadas?)`: el segundo argumento se ignora. El outbox ya borró el ítem y la UI ya marcó la parada como entregada. El filtro exige `estado === 'pendiente'`, así que las rechazadas desaparecen y se dispara «Todas las paradas entregadas».
- **Impacto:** Pan entregado que nadie cobró, y un repartidor convencido de que cerró el día.

### [CRÍTICA] Ningún endpoint de escritura del flujo dorado comprueba el rol
- **Dónde:** `api/ventas:15-17` · `api/pesajes:9-11` · `api/dte:11-13` · `api/pedidos:12,31-33` · `api/cierre-caja:8-9,28-30`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** Todos llaman solo a `exigirSesion`, nunca a un chequeo de rol. Un repartidor puede vender, pesar, cerrar caja, crear pedidos y registrar folios del SII.
- **Impacto:** No hay separación de funciones. Cualquiera con el teléfono del mesón opera la caja.

### [CRÍTICA] No existe `middleware.ts` y 9 de 12 páginas no comprueban nada
- **Dónde:** `apps/kilopan/` (ausente) · `src/app/{pesar,vender,caja,pedidos,ruta,facturar,admin,vincular,ingresar}/page.tsx`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** El menú de `/inicio` es la única autorización. Escribiendo la URL se abre `/caja` completa, con montos, y se puede cerrar caja. `/dashboard` es la única con chequeo real de rol en servidor.
- **Impacto:** El repartidor lee la plata del día y cierra la caja del mesón desde su teléfono.

### [CRÍTICA] Los endpoints de lectura entregan plata, nómina y costos a cualquier rol
- **Dónde:** `api/clientes:6-18` (saldos de fiado) · `api/pedidos:11-26` + `pedidos/page.tsx:173` (`total_clp`) · `api/entregas` · `api/facturar` · `api/usuarios` (nómina) · `api/cierre-caja`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Impacto:** Contradice la regla explícita del producto: «el repartidor ve SOLO km y kg, jamás CLP» (`ruta/page.tsx:22`, `rutas/mi-ruta/route.ts:6-7`).

### [CRÍTICA] `POST /api/sync` cierra un POD sobre CUALQUIER `pedidoId`
- **Dónde:** `api/sync/route.ts:22-95` (sesión en `:23-24`, cierre en `:86-95`)
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** Acepta el `pedidoId` del cuerpo y lo marca `entregado` sin comprobar que exista una parada de la ruta activa de quien llama, ni exigir rol repartidor.
- **Impacto:** Cualquiera marca entregado el pedido de cualquiera. La conciliación del día queda falseada.

### [CRÍTICA] El service worker sirve el panel del dueño al siguiente operador de la tablet
- **Dónde:** `public/sw.js:56-64` · `dashboard/page.tsx:24-46` · `inicio/page.tsx`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** El handler cachea toda respuesta GET del mismo origen que no sea `/api/` ni `/_next/static/` — incluidos los documentos de `/inicio` y `/dashboard`. El Cache Storage ignora por diseño `Cache-Control`, así que el `no-store` no protege. Sin señal, `caches.match()` devuelve ese HTML a quien esté sentado frente al equipo.
- **Impacto:** En una panadería la tablet es una sola y pasa de mano en mano. Basta que el dueño mire su panel una vez.

### [CRÍTICA] El cierre de caja lee «45.000» como $45
- **Dónde:** `caja/page.tsx:34` y `:36` — `Math.round(Number(declarados[m.medio_pago] || "0"))`
- **Rol:** vendedor/admin · **Verificación:** 3/3
- **Observado:** En Chile el separador de miles es el punto. `Number("45.000")` = 45.
- **Impacto:** El cuadre del día se registra con tres ceros menos y nadie lo nota hasta que falta la plata.

### [CRÍTICA] Un fallo transitorio de Postgres deja la app en 500 para siempre
- **Dónde:** `comun/db.ts:91` y `:193-194`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** `if (!poolPromise) poolPromise = crearPool(url); return poolPromise;` — si la primera conexión falla, el promise rechazado queda cacheado y nunca se reintenta.
- **Impacto:** Un parpadeo de red a las 5 AM deja la panadería sin sistema hasta que alguien reinicie el proceso. **Afecta a los 21 endpoints**, no solo a `/caja` donde se detectó.

### [CRÍTICA] La cola offline no está atada al operador
- **Dónde:** `pod/outbox.ts:125-134` · `api/ventas:142-143` · `api/pesajes:139` · `api/sync:77-78`
- **Rol:** cualquiera · **Verificación:** 3/3
- **Observado:** Lo encolado no guarda quién lo hizo; se sube con la sesión de quien esté logueado al sincronizar.
- **Impacto:** En la tablet compartida, la venta de uno queda registrada a nombre de otro. Rompe la trazabilidad que `pan.trg_exige_sesion` busca garantizar.

### [CRÍTICA] Fuerza bruta del PIN de admin en `/api/dispositivos/enrolar`
- **Dónde:** `api/dispositivos/enrolar/route.ts:11-39` (verificación en `:32-39`) · comparar con `api/auth/login/route.ts:55-65`
- **Rol:** ninguno (previo a autenticación) · **Verificación:** 2/3
- **Observado:** Es la **única** verificación de PIN que no pasa por `pan.registrar_intento_pin`, así que el bloqueo de 15 min nunca se dispara. Su único freno restante es el rate limit, que se llavea con una cabecera que manda el propio cliente.
- **Impacto:** Un PIN de 4 dígitos son 10.000 combinaciones. Con la cabecera rotando, se enrola un equipo propio y se entra a todo.

## ALTAS

| # | Título | Dónde | Voto |
|---|---|---|---|
| 1 | Con destino Reparto, `Confirmar` de `/pesar` nunca se habilita (**confirmado en ejecución por el orquestador**) | `pesar/page.tsx:514` vs `:203-208` | 3/3 |
| 2 | El «día» del negocio se calcula sin zona horaria: las ventas del atardecer caen en el cierre de mañana | `cierre-caja:18,55` · `rutas:21` · `dashboard` | único |
| 3 | `PATCH /api/rutas` sin rol ni pertenencia: cualquiera reescribe estado y odómetro | `api/rutas:67-101` | 3/3 |
| 4 | El rate limit se llavea con `X-Forwarded-For`: rotarla da cuota infinita | `identidad/limitador.ts:10` | 3/3 |
| 5 | `POST /api/cierre-caja` sin transacción, unicidad ni idempotencia | `api/cierre-caja:49-82` | 3/3 |
| 6 | No existe pantalla para dar de alta un cliente: despacho, fiado y facturación inalcanzables | `api/clientes:21` (huérfano) | 3/3 |
| 7 | Fiar en el mesón es imposible: la UI cotiza mostrador y el servidor cobra la lista del cliente | `vender/page.tsx:69-72,98` | 3/3 |
| 8 | Consolidar guías no es atómico y se puede facturar dos veces la misma guía | `api/facturar:69-86` | 2/3 |
| 9 | `/api/sync` acepta `gramosEntregados` del cliente sin contrastar con el pedido | `api/sync:39-81` | 3/3 |
| 10 | El POD registra lo **pedido**, no lo entregado: no existe la entrega parcial | `ruta/page.tsx:152,233-235` | 3/3 |
| 11 | `POST /api/rutas` sin transacción ni idempotencia: cada clic crea otra ruta | `api/rutas:46-62` | 3/3 |
| 12 | La expiración por inactividad no se aplica en `/inicio` ni `/dashboard` | `inicio:30-39` · `dashboard:28-36` | 3/3 |
| 13 | `pan.stock_disponible()` es acumulado histórico y la merma no descuenta: stock fantasma | `0003:99-108` | 3/3 |
| 14 | La foto se sube antes de que exista la entrega: el POD queda `pendiente_subida` para siempre | `ruta:116-117,140-155` · `pesar:243-246` | 3/3 |
| 15 | Un 401 de `/api/sync` se traduce a «sin conexión»: las entregas giran para siempre | `pod/outbox.ts:232-237` | 3/3 |
| 16 | Ninguna pantalla distingue «no hay datos» de «no pude consultar» | `vender:46-56` · `caja:20-22` · `pesar:129-158` | 3/3 |
| 17 | El «Monto total» del DTE acepta vacío y se registra como $0, y se propaga a la factura | `pedidos/page.tsx:98,203` · `api/dte:38` | 3/3 |
| 18 | No hay forma de registrar una entrega fallida: el cliente cerrado no existe en la app | `ruta/page.tsx:128-163,269-298` | 3/3 |
| 19 | Una sesión vencida se muestra como «Ningún pedido está esperando este producto» (**orquestador**) | `/pesar` destino Reparto | único |

## MEDIAS y BAJAS

27 MEDIAS y 18 BAJAS confirmadas, agrupadas por tema. El detalle por causa raíz —con
`archivo:línea`, ids de origen y veredicto— está en el JSON de la corrida de verificación.

- **Lengua y presentación (A6, la mayoría):** formato de CLP inconsistente entre pantallas,
  decimales donde CLP no los tiene, cifras de peso con tres decimales (`faltan 10,000 kg` para
  10 kg, verificado por el orquestador), `tabular-nums` ausente en varias cifras, terminología
  que alterna entre pantallas.
- **Mensajes de error para ingeniero y no para panadero:** «Cuerpo inválido», «Faltan campos».
- **Móvil y accesibilidad (B6):** blancos táctiles bajo 44×44, contraste insuficiente en texto
  secundario, el total de `/facturar` desborda y se le cortan 61 px que el scroll no alcanza,
  etiquetas de formulario y orden de foco incompletos.
- **Seguridad menor:** el PIN se muestra **en texto plano a 96 px** mientras se teclea, en
  `/ingresar:90` y `/vincular:77` — en un mesón compartido eso es mirable desde la fila.
- **Bordes no manejados (B5):** RUT sin puntos, doble toque en botones que envían, dos pestañas
  sobre el mismo pedido.

---

# ANEXO A — Hallazgos refutados

No se borran: quedan aquí para que nadie vuelva a levantar la misma falsa alarma.

| Hallazgo | Severidad propuesta | Por qué cayó |
|---|---|---|
| `/api/sync` marca el pedido entregado aunque venga con motivo de rechazo | ALTA | Los verificadores comprobaron que el camino de rechazo no llega a ese `update`; la lectura del código era incorrecta. |
| Sin fix de GPS la entrega es imposible y la foto ya se tomó | ALTA | El botón no depende del fix de GPS; la precondición citada no existe en el código. |
| El cursor de paginación repite la última fila | MEDIA | No se sostiene contra el SQL real. |
| Dos reglas de redondeo distintas conviviendo | MEDIA | Ambas rutas terminan en `pan.round_clp()`. |
| El pesaje offline queda fechado por el servidor | MEDIA | El `client_uuid` y la marca de tiempo del cliente sí viajan. |
| Cifras sin `tabular-nums` | BAJA | El componente compartido sí lo aplica; los casos citados eran texto no numérico. |
| Botones sin `aria-label` | BAJA | Tienen nombre accesible por su contenido de texto. |

# ANEXO B — NO VERIFICADO

Lo que **no** se probó. Un silencio se lee como «funciona», y esa es justo la mentira que esta
auditoría existe para evitar.

1. **El flujo dorado nunca se cerró.** Cero filas escritas en `pan.pesajes` en toda la auditoría.
   Pesar → que el kilo entre al stock → venderlo → que cuadre en caja: **no se ejecutó nunca de
   punta a cabo.** Es la función más importante del producto.
2. **El repartidor entero.** Cero sesiones. POD real con foto + GPS + receptor: cero. Subida de
   foto y verificación de `sha256` en el servidor: cero. `POST /api/sync`, `POST /api/fotos` y
   `GET /api/entregas` no recibieron ni una petición.
3. **Drenar la cola tras reconectar.** Se probó **encolar** sin señal; nunca se probó la
   reconexión y el vaciado. Tres CRÍTICAS de la Tanda 2 describen ese camino por código, no por
   ejecución.
4. **PIN incorrecto y bloqueo de 15 minutos (AC-SEC-01).** Ningún agente lo probó — deliberadamente,
   para no dejar roles inutilizables durante la auditoría. Sigue sin verificarse en ejecución.
5. **Doble toque** en Cerrar caja, Confirmar pedido, Registrar documento y Registrar factura.
6. **Barrido móvil:** 1 de 12 capturas en 390×844. El modo oscuro quedó sin evaluar.
7. **Estado de la base:** nadie comprobó si las 10 migraciones están aplicadas en Railway, ni si
   ya hay stocks negativos o cierres duplicados de corridas anteriores.
8. **Un lote de 6 causas MEDIA/BAJA quedó sin veredicto**: el agente verificador agotó sus
   reintentos de salida estructurada. Esas 6 entraron al informe con la severidad propuesta por
   el dedup, sin verificación independiente.

## Sospechas fundadas que la próxima ronda debería atacar primero

Derivadas de los patrones confirmados, no de corazonadas:

- **El punto de miles chileno también rompe el DTE.** Confirmado en `/caja`; el mismo patrón sin
  sanear está en el «Monto total» de `pedidos/page.tsx:98`. Nadie lo probó ahí.
- **La no-atomicidad no es de `/cierre-caja`: es de toda la mitad B del sistema.** Confirmada en
  cierre-caja, rutas y facturar. Probablemente también en pedidos.
- **Siete pantallas sin guarda × dos roles sin probar = 14 fugas sin mirar.** La fuga de `/admin`
  (cualquier rol lee los costos por km) está confirmada solo para vendedor.
- **La foto del POD se puede perder sin que nadie se entere y no hay dónde verlo:** `/api/sync`
  inserta la entrega con `foto_estado='pendiente_subida'` y `cerrada=true` sin exigir que la foto
  llegue.
- **RUT sin puntos:** `validaRut` es tolerante (acepta `12345678-5`) pero la consulta usa
  `where rut = $1` sin normalizar. Un panadero que escribe el RUT sin puntos no puede entrar.

---

# ANEXO C — Método y honestidad del proceso

**Datos sembrados deliberadamente** (regla 6 — declaración obligatoria). Para alcanzar el estado
de borde «pesaje con destino reparto» hacía falta un pedido, y no existe pantalla para dar de alta
clientes. Se crearon **por la API de la propia app**, nunca por SQL directo:

- Cliente `AUDITORIA - cliente de prueba`, RUT 11.111.111-1, canal reparto (`POST /api/clientes` como admin)
- Pedido correlativo **1**, entrega 2026-07-25, 10 kg de Marraqueta
- Pedido correlativo **2**, entrega 2026-07-26, 10 kg de Marraqueta

Quedan en la base de Railway, marcados con el prefijo `AUDITORIA` para poder limpiarlos. **No se
borró ni modificó ningún dato preexistente.**

**Artefactos de la auditoría — no son defectos de la app:**

- **El servidor de desarrollo se cayó durante la Ola B.** Es la causa de que B2 (maestro) y B4
  (repartidor) no completaran login, y la razón principal del hueco de cobertura. Cualquier
  veredicto que cite `ERR_CONNECTION_REFUSED` o un 500 de conexión debe releerse con desconfianza.
- **Sesiones que se cierran entre sí.** El navegador y las llamadas por `curl` compartieron el
  mismo `dispositivoId`, y `pan.abrir_sesion()` cierra la sesión abierta en ese equipo. Los 401
  intermitentes de la verificación manual salen de ahí. Es comportamiento correcto del producto.
- **Clics sintéticos que dejaron de llegar a la página.** A partir de cierto momento los clics del
  panel no registraban, aunque las coordenadas eran correctas y un `.click()` desde la consola sí
  llegaba. Limitación del arnés de automatización: la reproducción final se condujo por
  JavaScript, ejercitando los mismos manejadores de React.
- **429 «Demasiados intentos»** provocados por la propia flota (20/min por IP compartidos entre
  todos los agentes).

**Por qué el `current_date` no lo encontró la flota:** los 12 auditores corrieron entre las 17:42
y las 19:40 hora de Chile, **antes** del cambio de fecha en UTC. Es un defecto que solo se
manifiesta 4 horas al día, y apareció porque la auditoría se alargó hasta cruzarlo.
