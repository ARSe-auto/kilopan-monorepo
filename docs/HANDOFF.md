# HANDOFF — Rediseño de navegación de KiloPan

**Escrito:** 27-jul-2026 ~01:30 · **Motivo:** Alexis detiene la sesión para cambiar de
modelo/esfuerzo y que el trabajo siga autónomo toda la noche. Él duerme ~10 h desde la 01:15.
**Fecha límite dura:** reunión con **Rafael Urra (Indupan) el martes 28-jul**. Rafael tiene el
acceso desde ya (mail ya enviado) y puede entrar a producción en cualquier momento.

---

## 1. El encargo, en sus palabras

> «la navegacion no lleva a ninguna parte. es inflexible e ilogica.»
> «debemos rediseñar eso completamente antes que lo vea rafael urra»
> «la logica de navegacion debe ser **secuencial**. Una etapa, se sigue naturalmente de la
> siguiente, sin tener que cambiar de página, apretar hipertextos, cambiar de menu, volver
> atrás, ni ninguna de esas ineficiencias. Salvo que haya que **rehacer** un proceso, caso en
> el cual navegar por los menus apretando botones, es natural. Si no es el caso, cada etapa
> debe aparecer naturalmente despues de la otra. **Rediseña asi, todo.**»
> «Usa como ejemplo la logica de **crm e-auto next**.»

---

## 2. Diagnóstico verificado en el navegador (no leído en el código)

Se reprodujo en `localhost:3300` contra la BD de producción, entrando como **Pedro Maestro**
(RUT 12.345.678-5 / PIN 1234) — que es, además, **el rol con el que entró Alexis** (las tres
sesiones de las 04:51–04:57 UTC en `pan.sesiones_operador` son suyas).

1. **El rol `maestro` tiene UN solo destino** (`/pesar`). Su «menú» es un botón. Nada en
   pantalla decía con qué perfil estaba dentro → se lee como app rota, no como «el maestro
   solo pesa». *(El mail a Rafael sí manda las credenciales de admin, 22.222.222-2 / PIN 2026.)*
2. **Callejón sin salida en `/pesar`**: elegido un producto, el enlace «← Menú» **desaparece**.
   Con una bandeja empezada no queda ni un control que lleve a otra parte. Mismo defecto en
   `/vender`. `/ruta` nunca tuvo enlace de vuelta en ningún estado.
3. **Destino «Reparto» sin pedidos** dice «Ármalo primero en Despacho» — pantalla que el
   maestro **no tiene en su menú**. Le pide hacer algo imposible y no ofrece salida.
4. **El chip del operador** (`position: fixed`, top-right) se montaba **encima** del botón
   «Cambiar» de `/pesar`.
5. **Sesión caída = login en blanco.** `obtenerSesionActual` devuelve null por inactividad de
   10 min (AC-ID-05), por desplazamiento (AC-ID-04, misma clave en otro equipo) o por el tope
   de 12 h, y `/inicio` redirigía a `/ingresar` **sin una palabra**. Eso es el «si pongo menu,
   me ingresa al log in».
6. **Terminar una acción no lleva a ninguna parte.** Confirmar un pesaje deja una línea verde
   y punto. No hay etapa siguiente. Esto es el corazón del encargo.

---

## 3. Modelo de referencia: CRM E-Auto Next (`~/eauto-crm-next`)

Leído y adoptado. Piezas que importan:

| Pieza | Archivo | Qué aporta |
|---|---|---|
| `AppChrome` | `src/components/shell/app-chrome.tsx` | Marco responsivo: `<900px` tab bar + FAB; `≥900px` rail lateral. `main pb-40` para que la tab bar no tape el botón primario. |
| `TabBar` | `src/components/shell/tab-bar.tsx` | **Exactamente 4 destinos raíz**, fija abajo, `aria-current`, blur + hairline, `pb-safe`. |
| `Pantalla` | `src/components/shell/pantalla.tsx` | Large Title 34/700 con `accesorio` a la derecha, que colapsa a barra compacta sticky al scrollear. Exporta también `EstadoVacio` (icono + frase + CTA) y `Celda`. |
| `hoy/tarjeta-acciones.tsx` | `src/app/(app)/hoy/` | **La clave del patrón secuencial**: tarjetas con contexto + **1 acción primaria inline**, resueltas en el sitio (`useTransition` + server action), reversibles con **Deshacer 8 s**. La Hoja se abre **por query param sin cambiar el pathname**. |

**Traducción a KiloPan:** «Hoy» no es un menú, es el motor de la jornada — dice cuál es el paso
que toca y lo ofrece como acción primaria. La tab bar existe para *cambiar de tarea a
propósito*, no para «volver». Y cada acción completada entrega la siguiente en la misma pantalla.

---

## 4. Estado del árbol AHORA

`git status` sobre **main**, sin commitear. **`pnpm --filter kilopan typecheck` pasa limpio** y
la app **funciona** en `localhost:3300` (verificado con captura). Es un estado intermedio
coherente, no roto.

### Ya hecho y funcionando (fase 1: que la navegación exista)
- `src/app/navegacion.ts` **(nuevo)** — fuente única: `DESTINOS_POR_ROL`, `pestanasDe(rol)`
  (Hoy + ≤2 propias + Más), `ETIQUETA_ROL`, `puedeEntrar`, `tituloDeRuta`, `RUTAS_SIN_BARRA`,
  `destinoDeIngreso(rol)`.
- `src/app/SesionCliente.tsx` **(nuevo)** — contexto `{nombre, rol}` para pantallas de cliente.
- `src/app/CerrarSesionBoton.tsx` **(nuevo, subido de `inicio/`)** — variantes `pildora`/`fila`.
- `src/app/BarraApp.tsx` **(nuevo)** — barra superior con `☰ Menú` + título + chip, y panel
  deslizante con los destinos del rol + Salir. **Es la fase 1 y está pensada para ser
  REEMPLAZADA** por `BarraPestanas` (ver §5).
- `src/app/BarraPestanas.tsx` **(nuevo, ESCRITO PERO NO CABLEADO)** — tab bar inferior estilo
  CRM, iconos SVG propios, `env(safe-area-inset-bottom)`, `ALTO_BARRA_PESTANAS = 64`.
- `src/app/Pantalla.tsx` **(nuevo, ESCRITO PERO NO CABLEADO)** — encabezado único: chip del
  operador en su propia fila + título 28/800 + bajada + accesorio.
- `packages/miga/src/componentes/ChipOperador.tsx` — acepta `anchoMaximo`, recorta con `…`,
  `title` con el nombre completo.
- `src/app/layout.tsx` — lee la sesión en el servidor, `<ProveedorSesion>` + `<BarraApp/>`,
  body en **columna flex** (`minHeight: 100dvh`), se quitó el chip flotante.
- Las 6 pantallas con `minHeight: "100dvh"` pasaron a **`flex: 1`** (pesar ×2, ruta ×3,
  ingresar ×1) para que la barra no empuje el botón primario bajo el pliegue.
- `VolverInicio.tsx`, `EncabezadoConOperador.tsx`, `inicio/CerrarSesionBoton.tsx` **borrados**;
  `<VolverInicio/>` quitado de las 7 pantallas.
- `src/identidad/sesion.ts` — nuevo `obtenerSesionOMotivo()` que devuelve
  `motivo: "sin-sesion" | "vencida" | "cerrada"`. `obtenerSesionActual()` queda como envoltorio.
- `middleware.ts` → `/ingresar?motivo=sin-sesion`; `InterceptarSesionVencida` → `?motivo=vencida`;
  `CerrarSesionBoton` → `?motivo=salida`; `inicio/page.tsx` → `?motivo=${motivo}`.
- `ingresar/page.tsx` — banner que traduce el motivo a una frase accionable.
- `inicio/page.tsx` — usa `navegacion.ts`, muestra la etiqueta del rol, explica el rol de una
  sola pantalla.
- `pesar/page.tsx` — el vacío de Reparto ya no es callejón: atajo a Despacho si el rol puede
  (`puedeDespachar`), explicación + «Mandarla a Mostrador» si no.

### Lo que falta (fase 2: que la navegación sea SECUENCIAL) — §5

---

## 5. Plan de la fase 2, en orden

> Criterio de aceptación transversal: **terminar cualquier acción debe entregar la siguiente en
> la misma pantalla.** Si para seguir hay que tocar una pestaña o volver a un menú, no cumple.

1. **Cambiar la barra superior por la tab bar inferior.**
   En `layout.tsx`: quitar `<BarraApp/>`, montar `<BarraPestanas/>` después de `{children}` y
   envolver `{children}` en un `div` con
   `paddingBottom: "calc(72px + env(safe-area-inset-bottom))"` cuando hay sesión (si no, el
   botón «Confirmar» queda bajo la barra — es el mismo defecto que documenta `RESET_GLOBAL`).
   Luego **borrar `BarraApp.tsx`**. Crear **`/mas`** (destinos restantes del rol + nombre + rol
   + `CerrarSesionBoton variante="fila"`).

2. **Migrar las 9 pantallas a `<Pantalla>`** (pesar, vender, caja, pedidos, facturar, dashboard,
   ruta, admin, mas). Quita 9 encabezados a mano con tamaños distintos (22/700 vs 24/800) y deja
   el chip del operador en un solo sitio.

3. **`SiguientePaso` (componente nuevo)** — la pieza central. Tarjeta que aparece **al terminar
   una acción**, con: qué acaba de pasar, y 1 acción primaria + 1-2 secundarias. Equivalente de
   `tarjeta-acciones.tsx` del CRM. Cablearla en:
   - **`/pesar` tras Confirmar** → primaria «Otra bandeja de {producto}» (encadena, es el 90%);
     secundarias según destino: mostrador → «Vender en el mesón»; reparto → «Sigue cargando el
     pedido de {cliente}: faltan {kg}» y, al completarse, «Armar la ruta»; merma → «Otra bandeja».
   - **`/vender` tras Cobrar** → «Otra venta» / «Cerrar caja».
   - **`/caja` tras Cerrar** → hoy el resultado ya se muestra; agregar «Ver el panel del día».
   - **`/pedidos`** tras confirmar pedido → «Armar la ruta»; tras armar ruta → «Ver la ruta».
   - **`/ruta`** tras cada entrega → que la parada siguiente aparezca sola (revisar si ya lo hace).
   *Ojo:* la línea verde actual (`mensaje`) queda **reemplazada** por esta tarjeta, no duplicada.

4. **Aterrizaje directo por rol.** `ingresar/page.tsx` hoy hace `router.push("/inicio")`; usar
   `destinoDeIngreso(cuerpo.usuario.rol)` (ya escrito en `navegacion.ts`): maestro → `/pesar`,
   repartidor → `/ruta`, admin y vendedor → `/inicio`. Requiere que `POST /api/auth/login`
   devuelva el rol en `cuerpo.usuario` — **verificar**, y si no lo devuelve, agregarlo.

5. **`/inicio` = «Hoy», no un menú.** Server Component con acceso a `obtenerDb()`. Una tarjeta
   grande con **el paso que toca ahora** según el estado real del día, y debajo las etapas de la
   jornada con su estado (hecho / en curso / pendiente). Consultas baratas sugeridas:
   ¿hay pesajes hoy? ¿hay pedidos de hoy sin completar? ¿hay ruta activa? ¿está cerrada la caja?
   **Ojo con la zona horaria**: `current_date` lo evalúa Postgres en UTC y el día salta a las
   20:00 de Chile — usar `(now() at time zone 'America/Santiago')::date`
   (Tanda 3 de `docs/AUDITORIA_NAVEGACION.md`).

6. **Stepper dentro de la tarea** (Producto → Peso → Destino → Listo) en `/pesar` y `/vender`,
   para que el avance se vea. Bajo prioridad frente a 1–5.

---

## 6. Verificación antes de dar nada por hecho

- Servidor de desarrollo: **`preview_start` con el nombre `kilopan-dev`** (definido en
  `~/Documents/ClaudeMini/.claude/launch.json`, ya corregido a la ruta nueva del repo).
  **Nunca `pnpm dev` por Bash.**
- **Trampa que ya costó tiempo:** si se borra `apps/kilopan/.next`, el **service worker** sigue
  sirviendo los chunks viejos de `/_next/static/` (cache-first) y la app cae con
  `Cannot read properties of undefined (reading 'call')`. **No es un bug del código.** Limpiar:
  ```js
  (async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();
   for(const k of await caches.keys())await caches.delete(k)})()
  ```
- Probar a **375×812** (`resize_window` preset `mobile`) y con los **cuatro roles**
  (PIN 1234 para los de semilla): admin 76.192.083-9 · maestro 12.345.678-5 ·
  vendedor 10.000.013-K · repartidor 5.000.006-0. El admin de la demo es
  **Rafael Urra 22.222.222-2 / PIN 2026**.
- **Hay UNA sesión por usuario**: entrar como Pedro Maestro mata la sesión de Pedro Maestro que
  tenga otro. Para probar dos roles a la vez hacen falta dos usuarios distintos.
- Gate: `pnpm --filter kilopan typecheck`, `lint`, `test`, y el e2e de Playwright.
  **Ojo:** los e2e existentes tocan el encabezado y el enlace «← Menú» — van a fallar y hay que
  actualizarlos, no saltárselos.

## 7. Despliegue (es lo que Rafael va a ver)

- `https://kilopan-app-production.up.railway.app` — **NO está enlazado a GitHub**. Se despliega
  con **`railway up`, que sube el ÁRBOL DE TRABAJO**, no un commit.
- **Antes de cualquier `railway up`: `pnpm db:preflight`.** El Dockerfile hace
  `migrar.mjs && server.js`: una migración que falla es un deploy caído, no un aviso.
- Ver `docs/BITACORA.md` y la memoria `kilopan-deploy-railway`.

## 8. Avisos

- **Había una segunda sesión de Claude viva en este mismo repo** (pid 38567, arrancada 01:01).
  Tocó `apps/kilopan/src/middleware.ts` mientras yo trabajaba: le agregó al `matcher` las
  exclusiones `icono-192.png|icono-512.png|logo-kilopan.svg` (era el fix pendiente que estaba
  desplegado pero sin commitear). **Comprobar `ps aux | grep claude` y los mtimes antes de
  editar**, y no matar procesos que no sean propios.
- El trabajo de esta sesión está **sin commitear**, en `main`. Conviene commitear temprano.
- El motor autónomo (launchd) de KiloPan sigue **detenido y deshabilitado** a pedido de Alexis.
