# PROMPT MAESTRO — AUDITORÍA TOTAL DE NAVEGACIÓN Y FUNCIONAMIENTO DE KILOPAN

> **Cómo usar:** pégalo completo como primer mensaje de una sesión de Claude Code abierta
> en `~/Documents/ClaudeMini/kilopan-monorepo`. Si quieres que la flota corra como
> orquestación determinista, antepón la palabra `ultracode`; si prefieres fan-out simple,
> déjalo tal cual y el orquestador usará agentes sueltos.
> **Ajusta antes de lanzar:** el `NIVEL` en §1 y, si aplica, la lista de rutas en §2.

---

## 1. Tu rol y el encargo

Eres el **orquestador de una auditoría exhaustiva de navegación y funcionamiento** de
KiloPan. No eres un desarrollador arreglando cosas: eres el que arma el mapa completo de
lo que la app hace, lo que no hace, y lo que hace mal — con evidencia reproducible para
cada afirmación.

**NIVEL = EXHAUSTIVO.** No es un smoke test. El objetivo es cobertura total: cada ruta,
cada endpoint, cada rol, cada estado de borde. Si al final no puedes demostrar que
tocaste el 100% del inventario de §2, la auditoría no está terminada.

Tres niveles disponibles (elige uno arriba, el resto ignóralo):
- `RÁPIDO` — 4 agentes, solo flujo dorado y rutas principales, 1 rol.
- `ESTÁNDAR` — 8 agentes, todas las rutas × 2 roles, verificación simple.
- `EXHAUSTIVO` — 12+ agentes, todas las rutas × 4 roles, verificación adversarial,
  crítico de completitud y segunda ronda hasta que dos rondas seguidas no aporten nada nuevo.

---

## 2. Contexto duro — no lo redescubras, verifícalo

Esto ya está establecido. Tu Fase 0 lo **confirma**, no lo investiga desde cero. Si algo
de esto resulta falso, ese desajuste es en sí mismo un hallazgo de severidad alta.

**Stack:** Next.js 15 (App Router) + React 19 + TypeScript, PWA instalable, Postgres
(PGlite embebido en local), pnpm workspace. App en `apps/kilopan`.

**Puerto: 3300, fijado en `apps/kilopan/package.json`.** Jamás levantes nada en 3000 ni
3100: el motor autónomo de `eauto-crm-next` mata ciegamente lo que encuentre ahí cada
pocos minutos y tu servidor va a desaparecer sin error visible. Contrato completo en
`docs/CONTRATO_PUERTOS.md`.

**Inventario de rutas de UI (12) — cobertura obligatoria:**
`/` · `/inicio` · `/ingresar` · `/vincular` · `/pesar` · `/vender` · `/caja` · `/pedidos`
· `/ruta` · `/facturar` · `/dashboard` · `/admin`

**Inventario de endpoints (21) — cobertura obligatoria:**
`auth/login` · `auth/logout` · `auth/me` · `cierre-caja` · `clientes` ·
`dispositivos/enrolar` · `dte` · `entregas` · `facturar` · `fotos` · `medios-pago` ·
`parametros` · `pedidos` · `pedidos/pendientes` · `pesajes` · `productos` · `rutas` ·
`rutas/mi-ruta` · `sync` · `usuarios` · `ventas`

**Roles (constraint de BD, `rol in (...)`):** `admin` · `maestro` · `vendedor` ·
`repartidor`. La matriz rol × ruta × endpoint es el eje central de la auditoría.

**Contexto de uso real:** panadería chilena. Móvil primero (390×844), operado con las
manos ocupadas y a veces sin señal. Idioma **es-CL con tuteo** (no voseo argentino — ya
hubo un fix por esto). Cifras de dinero y peso deben usar `tabular-nums`. Pesos se
guardan en **gramos enteros**, se cobran en kilos. CLP se redondea con `pan.round_clp()`.

**Estado del repo al momento de auditar:** hay cambios sin commitear y un endpoint nuevo
sin trackear (`api/pedidos/pendientes/`). **No commitees, no hagas stash, no descartes
nada.** Audita el árbol tal como está y registra en el informe que auditaste trabajo en
curso, no un commit limpio.

**Hueco conocido que enmarca todo esto:** `apps/kilopan` todavía no tiene
`playwright.config.ts`, así que el paso e2e de `packages/metodo/scripts/check.sh` sale
como **SALTADO**. Es decir: hoy nadie ha ejercitado esta app por el camino del navegador.
Esta auditoría es la primera pasada e2e real que recibe. Trátala con esa seriedad.

---

## 3. Reglas innegociables

1. **Ninguna afirmación sin evidencia.** Cada hallazgo trae al menos una de: captura de
   pantalla, línea literal de consola, entrada de red (método + ruta + status), salida de
   comando, o cita `archivo.ts:línea`. "Parece que no funciona" no es un hallazgo; es ruido.
2. **Auditar ≠ arreglar.** Nadie modifica código de producto durante la auditoría. Un
   arreglo a mitad de camino invalida lo que los demás agentes están observando y hace
   irreproducibles los hallazgos anteriores. Las correcciones son una decisión posterior
   del usuario, con el informe en la mano.
3. **Un solo proyecto.** No toques, leas ni mates procesos de `eauto-crm-next`. Si un
   puerto está ocupado por otro proyecto, no lo liberes: repórtalo.
4. **El panel Browser es un recurso compartido, no infinito.** Es un solo navegador con
   pestañas y **una sola bandeja de cookies**. Dos agentes logueados con roles distintos
   al mismo tiempo se pisan la sesión y producen resultados falsos. De ahí la separación
   en olas de §5.
5. **Reportar lo no cubierto es parte del trabajo.** Si un agente no pudo probar algo
   (feature incompleta, dato inexistente, dependencia externa caída), eso va al informe
   como *NO VERIFICADO* con la razón. Un silencio se lee como "funciona", y esa es
   justo la mentira que esta auditoría existe para evitar.
6. **Nada de datos inventados en la app.** Si necesitas sembrar datos, usa
   `pnpm db:seed`. No metas registros a mano en la BD por fuera de la app salvo para
   provocar deliberadamente un estado de borde, y si lo haces, decláralo en el hallazgo.

---

## 4. Fase 0 — Reconocimiento (lo haces tú, en línea, antes de repartir nada)

No delegues esto: la flota necesita salir con el terreno ya despejado.

1. Levanta la app en el 3300 con las herramientas del panel Browser (`preview_start`;
   crea o ajusta `.claude/launch.json` si hace falta). No uses Bash para servidores.
2. Confirma que arranca limpia: revisa `preview_logs` y `read_console_messages`. Errores
   de arranque son el hallazgo #1 y cambian el plan del resto.
3. Verifica el inventario de §2 contra el árbol real (`src/app/**/page.tsx` y
   `**/route.ts`). Cualquier ruta que exista y no esté en la lista, agrégala al alcance.
4. Consigue credenciales operables para **los cuatro roles**. Lee `db/sembrar.mjs` y las
   migraciones de identidad para saber qué usuarios/PIN existen. Si algún rol no tiene
   forma de entrar, eso es un hallazgo bloqueante y lo declaras antes de continuar.
5. Corre `pnpm check` (sin `--full`) una vez y guarda el resultado como línea base: lint,
   types, unit, build. Anota explícitamente qué pasos salieron **SALTADOS**.
6. Publica un **plan de auditoría** de máximo 20 líneas: qué agentes lanzarás, en qué olas,
   y qué cubre cada uno. Ese plan es el contrato contra el que se mide la completitud.

---

## 5. Fase 1 — La flota

### 5.1 Ola A — Auditores estáticos (paralelos, sin navegador)

Corren todos a la vez; no compiten por el navegador. Cada uno devuelve hallazgos
estructurados según §8.

- **A1 · Cartógrafo de navegación.** Reconstruye el grafo real de navegación desde el
  código: cada `Link`, `router.push`, `redirect`, `middleware`, layout y `manifest.ts`.
  Busca: rutas huérfanas (existen pero nada las enlaza), enlaces a rutas inexistentes,
  callejones sin salida (pantallas sin retorno), y discrepancias entre lo que el menú
  ofrece y lo que el rol puede realmente abrir.
- **A2 · Auditor de contratos de API.** Los 21 endpoints, uno por uno: métodos aceptados,
  validación de entrada, forma de la respuesta, códigos de error, autenticación exigida.
  Marca cualquier endpoint que confíe en datos del cliente para algo que decide el
  servidor (precios, totales, identidad, rol).
- **A3 · Auditor de identidad y autorización.** Construye la matriz rol × ruta ×
  endpoint tal como la impone el código. Busca escalada de privilegios: endpoints sin
  chequeo de rol, páginas protegidas solo en el cliente, sesión de operador no exigida en
  tablas de negocio (el trigger `pan.trg_exige_sesion` debería estar cableado en todas).
- **A4 · Auditor de invariantes de datos.** Gramos enteros, redondeo CLP, idempotencia de
  la venta, atomicidad, unicidad, cursores de paginación. Contrasta migraciones,
  `db/test-invariantes.mjs` y el código de los endpoints. Un invariante que el SQL impone
  pero la UI puede violar (o al revés) es hallazgo.
- **A5 · Auditor de offline / PWA / sync.** Service worker, `manifest.ts`,
  `RegistrarSW.tsx`, endpoint `sync`, cola de reintentos. Pregunta central: si el
  repartidor pierde señal a mitad de una entrega, ¿qué se pierde y qué se recupera?
- **A6 · Auditor de lengua y presentación.** Barrido de todo el texto visible: tuteo
  chileno consistente (cero voseo), formato de moneda y peso, `tabular-nums` en cifras,
  mensajes de error entendibles por un panadero y no por un ingeniero, textos placeholder
  o "lorem" olvidados.

### 5.2 Ola B — Auditores dinámicos (navegador, **serializados por rol**)

Un rol a la vez, en este orden: `admin` → `maestro` → `vendedor` → `repartidor`. Para
cada rol se lanza **un solo agente conductor** que hace login, recorre su guion completo
y cierra sesión antes de ceder el navegador al siguiente. Si necesitas paralelismo dentro
de un rol, el conductor abre pestañas propias con `tabs_create` y opera **solo** sobre su
`tabId`.

Guion mínimo de cada conductor (además de lo específico de su rol):

1. Login desde `/ingresar`, con PIN correcto e incorrecto. Enrolamiento/`vincular` si aplica.
2. Abrir **las 12 rutas** en su rol. Para cada una registrar: ¿carga?, ¿qué muestra con
   datos?, ¿qué muestra vacía?, ¿errores en consola?, ¿requests 4xx/5xx?, ¿se puede
   volver atrás?, ¿el botón físico "atrás" del navegador la rompe?
3. Intentar entrar **a mano por URL** a las rutas que su rol no debería ver. Registrar
   qué pasa: redirect, 403, o —lo grave— la página se abre igual.
4. Ejecutar su flujo de negocio de punta a cabo, con los datos reales que produzca la app.
5. Recargar la página a media tarea. Registrar qué se perdió.
6. Terminar con captura de pantalla del estado final y el volcado de consola.

Flujos por rol:

- **B1 · admin** — `/admin`, `/dashboard`: usuarios, productos, parámetros, medios de
  pago, cierre de caja, lectura de DTE. Todo lo que solo él debería poder.
- **B2 · maestro** — el corazón productivo: `/pesar` → `/vender`. Pesaje, hornadas,
  mermas. **Este es el flujo dorado; audítalo con el doble de detalle que el resto.**
- **B3 · vendedor** — `/vender`, `/caja`, `/facturar`: venta, medios de pago, fiado,
  cierre de caja, registro DTE. Incluye la venta duplicada a propósito (idempotencia) y
  el intento de alterar el precio desde el cliente.
- **B4 · repartidor** — `/pedidos`, `/ruta`: mi ruta, entregas, POD, foto de respaldo.
  Incluye la prueba con red cortada (emula offline desde el navegador) y la reconexión.

- **B5 · Torturador de bordes** (corre al final, con el rol que corresponda a cada caso).
  Su único trabajo es romper la app por vías legítimas: campos vacíos, RUT inválido,
  cantidades cero y negativas, decimales donde se esperan enteros, números absurdamente
  grandes, texto en campos numéricos, doble clic en botones que envían, navegación atrás
  a mitad de una transacción, dos pestañas operando el mismo pedido, sesión expirada a
  media tarea.
- **B6 · Auditor móvil y de accesibilidad.** Viewport 390×844 y modo oscuro
  (`resize_window`). Tamaño de los blancos táctiles para manos enharinadas, contraste,
  desbordes horizontales, orden de foco, etiquetas de formulario, navegación por teclado.
  Cierra con capturas de las 12 rutas en móvil.

**Escalado:** si el NIVEL es `EXHAUSTIVO` y la Ola B deja huecos, lanza una segunda ronda
con los guiones que faltaron. Repite hasta que **dos rondas seguidas no produzcan ningún
hallazgo nuevo**. Un contador fijo de rondas siempre se pierde la cola larga.

---

## 6. Fase 2 — Verificación adversarial

Ningún hallazgo entra al informe sin pasar por aquí. Por cada hallazgo de severidad
CRÍTICA o ALTA, lanza **tres verificadores independientes** con la instrucción explícita
de **refutarlo**, cada uno con una lente distinta:

- **¿Reproduce?** Sigue los pasos literales del hallazgo desde cero. Si no reproduce,
  muere.
- **¿Es real o es entorno?** ¿Falla por un defecto de la app, o por datos ausentes,
  configuración local, feature aún no construida o un puerto pisado?
- **¿Importa?** ¿Bloquea a un panadero un martes a las 6 AM, o es un detalle que nadie
  va a encontrar nunca?

Un hallazgo sobrevive con **2 de 3** votos a favor. Ante la duda, el verificador refuta.
Los hallazgos MEDIA y BAJA pasan con un solo verificador. Los refutados **no se borran**:
van a un anexo del informe con la razón por la que cayeron — así nadie vuelve a levantar
la misma falsa alarma el mes que viene.

---

## 7. Fase 3 — Síntesis

1. **Deduplica.** Cinco agentes reportando la misma sesión rota es un hallazgo, no cinco.
   Agrupa por causa raíz, no por síntoma.
2. **Crítico de completitud.** Un último agente responde, con el plan de §4.6 al lado:
   ¿qué ruta no se abrió? ¿qué endpoint no se ejerció? ¿qué rol no se probó? ¿qué
   hallazgo quedó sin verificar? Lo que encuentre es la lista de trabajo de la ronda
   siguiente, no una nota al pie.
3. **Escribe el informe** en `docs/AUDITORIA_NAVEGACION.md` (este es el único archivo que
   la auditoría tiene permitido crear):
   - Veredicto en tres líneas: ¿se puede operar una panadería con esto hoy, sí o no?
   - Tabla de cobertura: 12/12 rutas, 21/21 endpoints, 4/4 roles — con ✅ / ⚠️ / ❌ y el
     motivo de cada casilla no verde.
   - Hallazgos ordenados por severidad, en el formato de §8.
   - **Lo que funciona bien**, explícito. Un informe que solo lista defectos no deja ver
     dónde pisar firme.
   - Anexo de hallazgos refutados y de lo NO VERIFICADO, con razones.
4. **En el chat** entrega solo: el veredicto, la tabla de cobertura y los CRÍTICOS. El
   resto vive en el archivo.

---

## 8. Formato de hallazgo (obligatorio, sin excepciones)

```
### [SEVERIDAD] Título en una línea, concreto
- **Dónde:** ruta de UI y/o `archivo.ts:línea`
- **Rol:** admin | maestro | vendedor | repartidor | cualquiera
- **Reproducir:** 1. … 2. … 3. …  (pasos literales, desde login)
- **Esperado:** …
- **Observado:** …
- **Evidencia:** captura / línea de consola / `POST /api/ventas → 500` / salida de comando
- **Impacto en la panadería:** qué le pasa al panadero un martes a las 6 AM
- **Verificación:** 2/3 verificadores confirman · o · verificador único confirma
```

---

## 9. Severidades — ancladas al negocio, no a la estética

- **CRÍTICA** — pérdida o corrupción de datos, dinero mal cobrado, kilos mal registrados,
  un rol accede a lo que no le corresponde, o el flujo dorado (pesar → vender → caja) se
  corta por completo.
- **ALTA** — una función central no se puede completar, o se completa dejando el sistema
  en estado inconsistente. Hay workaround, pero es doloroso.
- **MEDIA** — funciona pero mal: estado de borde no manejado, mensaje de error inútil,
  navegación confusa, dato que no refresca.
- **BAJA** — cosmético, texto, consistencia, mejora de usabilidad.

Cuando dudes entre dos severidades, sube. Que el usuario baje.

---

## 10. Definición de TERMINADO

Ninguna de estas casillas es opcional:

- [ ] Las 12 rutas abiertas y evaluadas en los 4 roles (48 combinaciones; las que
      redirigen o bloquean cuentan como evaluadas, con su comportamiento registrado).
- [ ] Los 21 endpoints ejercidos por el camino de la UI o por request directo.
- [ ] Flujo dorado completado de punta a cabo al menos una vez, con datos reales.
- [ ] Flujos de reparto y facturación completados al menos una vez.
- [ ] Prueba offline y de reconexión ejecutada.
- [ ] Barrido móvil 390×844 con capturas de las 12 rutas.
- [ ] Todo hallazgo CRÍTICO/ALTO pasado por 3 verificadores adversariales.
- [ ] Crítico de completitud ejecutado y sus huecos cerrados o declarados.
- [ ] `docs/AUDITORIA_NAVEGACION.md` escrito, con la tabla de cobertura completa.
- [ ] Cero archivos de producto modificados. `git status` muestra exactamente los mismos
      cambios en curso que había al empezar, más el informe.

---

## 11. Qué NO hacer

- No arreglar nada. Ni siquiera "esto es un typo, lo corrijo al pasar".
- No commitear, ni hacer stash, ni descartar los cambios en curso.
- No levantar nada en 3000 ni 3100. No tocar `eauto-crm-next`.
- No declarar OK por omisión. Lo que no se probó se dice.
- No confiar en que un test verde significa que la pantalla funciona: hoy el paso e2e
  sale SALTADO y esa es exactamente la brecha que esta auditoría viene a cubrir.
- No pedirle al usuario que verifique a mano. Verifica tú y muestra la prueba.
