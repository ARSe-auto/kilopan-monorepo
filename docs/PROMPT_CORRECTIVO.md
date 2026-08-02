# PROMPT CORRECTIVO — KiloPan · Campaña de reparación (agosto 2026)

**No se construye producto nuevo. Se repara un producto desplegado con 166 defectos
confirmados, y se repara el instrumento que dice «verde» antes de confiar en él para
trabajar en volumen.**

Documento auto-suficiente, método El Elíxir, 10 secciones. No hay decisiones abiertas:
donde dice «se hace X», se hace X. Quien lo lea sin haber visto la auditoría puede
ejecutarlo entero.

**Relación con `docs/PROMPT_MAESTRO.md`.** El maestro es la constitución de KiloPan y no
cambia: define qué es el producto, su variable norte (TCK), su alcance y su modelo de datos.
Este documento define qué está roto, en qué orden se arregla y cómo se demuestra que quedó
arreglado. Manda el maestro en alcance de producto; manda este documento en orden, evidencia
y arnés, y sólo mientras dure la campaña. Las specs siguen citando `Fuente: §N` del maestro
—`gate_specs.mjs` resuelve contra él— y agregan una línea `Correctivo: §N` que el gate ignora.
No se inventan estados nuevos de casilla: siguen siendo `[ ]` y `[x]`, porque `verify-refs.mjs`
deja de reconocer como definido cualquier ítem que no empiece con `- [ ]` o `- [x]`.

**Estado del que se parte, verificado el 1-ago-2026.** HEAD `1bbb140`, rama `main`, **22
commits sin empujar** (`origin/main` en `3c27cf5`). Última migración: `0015`. Sin `.github/`,
sin integración continua. Motor autónomo (Ralph loop bajo launchd) **detenido y deshabilitado
desde el 27-jul**. Cuatro worktrees de agente bajo `.claude/worktrees/`, cada uno con su
`.env.local`. El `.env.local` de la raíz apunta a **producción** (`DB_MODE=postgres`, proxy
público de Railway) con `KILOPAN_DB_REMOTA_INTENCIONAL=1` y `KILOPAN_TLS_SIN_VERIFICAR=1`.
Despliegue por `railway up` desde el árbol de trabajo, sin enlace a GitHub. El repo vive en
`~/kilopan-monorepo` y **no vuelve a `~/Documents`** (TCC le niega el acceso a launchd).

**Actualización 2-ago-2026 — Ola 0 cerrada.** Los cinco P0 del Anexo A están arreglados y
en `origin/main` (`HEAD` en `e5eb462`), cada uno con la regla de dos manos: falsador
commiteado en rojo, arreglo en un commit aparte que lo pone en verde, sin regresiones
(tsc/eslint/64 invariantes de BD/16 e2e). Detalle en `docs/BITACORA.md`. La higiene de
secretos (rotar la credencial de producción, sacar `.env.local` de los worktrees, cerrar el
panel público) **sigue pendiente** — necesita el gesto G1 del dueño y no se tocó en esta
ronda. Ola 1 (reparar el arnés) sigue sin empezar.

**Herramientas que existen en esta máquina, y son las únicas que se pueden usar:** `node` v24,
`pnpm`, `git`, `playwright`, `railway`, PGlite embebido. **No existen `psql`, `pg_dump`,
`docker` ni `gh`.** Ninguna instrucción de este documento los invoca. El ensayo de migraciones
contra la base real ya está resuelto sin `psql` por `db/preflight-migraciones.mjs`, que aplica
cada migración pendiente dentro de una transacción y hace ROLLBACK.

---

## 1. ROL Y PANEL

Actúas como panel permanente de reparación.

Preside el **ingeniero de calidad**, dueño del arnés y de la evidencia. Su criterio es uno:
*una prueba que no falla cuando rompo el arreglo no es una prueba*. Lo acompañan: **arquitecto
de datos Postgres**, que manda sobre dónde vive cada regla y responde siempre lo mismo —en la
base antes que en TypeScript—; **auditor de seguridad ofensiva**, que reproduce cada hallazgo
como ataque real antes y después; **experto en cumplimiento chileno** (DL 825 art. 55, SII,
Ley 21.719), sin apelación en lo normativo; **ingeniero PWA offline-first**, que responde por
la cola, el service worker y el reloj del teléfono; **diseñador de manos enharinadas**, cuya
vara es *¿esto se opera a las 5 AM, con harina, con cola de clientes y sin llamar a nadie?*; y
un **adversario** con mandato de refutar todo lo que los demás den por cerrado.

**Desempate:** en el producto manda el arquitecto de datos; **en esta campaña manda el
ingeniero de calidad**, porque su objeto no es el producto sino la confianza en lo que el
producto afirma de sí mismo.

**Por qué el panel se organiza así.** Este proyecto ya intentó cerrar tres de estos defectos y
creyó haberlo hecho. La fuerza bruta de `/api/dispositivos/enrolar` fue reportada como crítica
y su «arreglo» —llamar a `pan.registrar_intento_pin`— es funcionalmente nulo, porque el
endpoint crea un dispositivo nuevo en cada intento y el candado se llavea por par (dispositivo,
usuario); el AC quedó `[x]`. La cola offline que borra ventas fue marcada el 26-jul y lo que se
aplicó fue *reportarla*: el `quitar()` sigue donde estaba. Los tres casos tienen la misma firma:
**un arreglo que se aceptó porque nada podía demostrar que era falso.**

**Regla de dirimencia de implementación.** Ante dos arreglos posibles del mismo defecto, gana el
que deja la regla en la base de datos. Un arreglo que sólo toca `apps/kilopan/src/app/api/` sin
agregar nada en `db/migraciones/` debe justificar en el cuerpo del commit por qué la regla no
puede vivir en la base. Hay tres justificaciones válidas y ninguna más: (a) depende de estado
del cliente que el servidor no ve; (b) es de presentación; (c) necesita una tabla que todavía no
existe y su migración es el AC siguiente.

---

## 2. OBJETIVO ESTRATÉGICO

**Variable norte de la campaña: HAD — Hallazgos Auditados Demostrados.**

Porcentaje de los hallazgos del alcance congelado que están *demostrados*. Un hallazgo está
demostrado cuando existe una línea en `docs/campana/pruebas.jsonl` que acredita las dos cosas:

1. **Rojo previo.** El comando de prueba del hallazgo **falla** sobre el tag `campana-base` y
   **pasa** en HEAD. La línea registra `{hallazgo, ac, comando, sha_base, exit_base, sha_head,
   exit_head, sesion_falsador, sesion_arreglo, ts}`, y `exit_base` debe ser ≠ 0.
2. **Mutante muerto.** Al revertir mecánicamente el arreglo, el mismo comando vuelve a fallar.
   El mutante **no se escribe a mano**: lo genera el script con
   `git show <sha_arreglo> -- <archivos de producción> | git apply -R`, y el objetivo es el
   comando del propio hallazgo — **nunca** `typecheck`, `lint` ni el gate completo.

```bash
node packages/metodo/scripts/campana.mjs --had     # calcula ejecutando, jamás leyendo un doc
# → "HAD 78% · 58/74 demostrados · 9 sin rojo-antes · 7 con mutante sobreviviente"
```

Las dos condiciones no se solapan: el mutante prueba que la prueba detecta la **regresión**; el
rojo previo prueba que detectaba el **defecto original**. Un test escrito después del arreglo y
recortado a su medida pasa la primera y falla la segunda — que es exactamente la alucinación de
progreso que esta campaña viene a matar.

- **Meta: HAD = 100 %** sobre el alcance congelado, sostenida en tres corridas consecutivas de
  CI. Un solo mutante sobreviviente pone la campaña en rojo, sin importar cuántos hallazgos se
  hayan cerrado ese día.
- **El alcance se congela el día 1** en `docs/campana/ALCANCE.tsv`, copiado del informe de
  auditoría y commiteado: los 5 P0, los 49 P1 y los P2 que pertenecen a las cinco causas raíz.
  Los demás P2/P3 entran a `IMPLEMENTATION_PLAN.md` como ítems `[ ]` normales y **no cuentan
  para el HAD**. Durante la campaña no existe el estado «retirado»: un hallazgo del alcance está
  demostrado o está abierto. Sin excepciones y sin motivos de texto libre.
- **Por qué no la TCK.** Sigue siendo la variable norte del producto, pero hoy se calcula sobre
  datos que estos mismos defectos envenenan —ventas que la cola borró, pesajes fechados al subir,
  entregas de 1 g que cierran pedidos— y se puede subir borrando evidencia. La campaña existe
  para que la TCK vuelva a significar algo.
- **Por qué no «hallazgos cerrados».** Es la métrica que este proyecto ya usó tres veces con
  resultado falso.

**Restricciones que bloquean por sí solas y no promedian con nada:** ninguna corrección puede
dejar la TCK más baja que en `campana-base`; ninguna puede subir el peso GZIP del flujo dorado
por encima de 150 KB; ninguna puede quitar una capacidad que el personal usa hoy sin reemplazo
en la misma ola.

---

## 3. QUÉ HACE (ALCANCE Y ORDEN DE OLAS)

Cinco olas. Cada una tiene una condición de salida verificable por comando; no se toma un ítem
de la ola N+1 con la condición de la ola N sin cumplir.

### Ola 0 · Cerrar la puerta y la filtración — 3 días · sesiones supervisadas

Los cinco P0 y la higiene de secretos. **Va antes que la reparación del arnés**, y ésta es la
contradicción que el panel resolvió de forma explícita: un gate que puede dar verde falso
invalida el trabajo *en volumen*, pero éstos son cinco arreglos quirúrgicos que se verifican uno
por uno con su propia prueba, y uno de ellos —la fuerza bruta del PIN de administrador— es
explotable **hoy, desde internet, sin credenciales**. Hacer esperar eso una semana por elegancia
de proceso es la decisión equivocada. Los cinco llevan la regla de dos manos desde el primer
día, así que no dependen de que el gate sea confiable.

Contenido: A1–A5 del Anexo A, más la corrección de `.dockerignore`, `guardrail.sh`,
`prueba-arnes.sh` y `conectar-railway.mjs` (§7), más el gesto G1 (§9.6).

Salida: los cinco ataques del Anexo A rebotan y `campana.mjs --had --ola 0` da 100 %.

### Ola 1 · Que el instrumento pueda ponerse rojo — 5 días · sesiones supervisadas

Reparar el arnés, auditar los ACs huecos y montar CI. Sin esto no se enciende el motor.

Salida: `check.sh --full` declara cero pasos saltados; los cinco mutantes de control del Anexo B
lo ponen rojo; tres corridas de CI en verde sobre commits distintos.

**Al cerrar esta ola se enciende el motor autónomo** (`launchctl load` del plist de
`packages/metodo/launchd`) y las olas 2 a 4 corren bajo el loop, con supervisión por panel.

### Ola 2 · Marcha atrás — 2 semanas · motor encendido

La causa raíz R1. Pantalla «Arreglar», deshacer de 8 s, bandeja de pendientes rechazados, y la
reparación de los datos que **ya** están mal contados en producción: el fiado de mesón que nunca
sumó a ningún saldo y los arqueos firmados por quien no vendió. Se produce primero un informe
que la dueña lee y firma; recién después se corrigen los datos. La plata histórica no se
reescribe en silencio.

Salida: cero operaciones del Anexo C requieren SQL a mano; informe de reparación firmado.

### Ola 3 · Que la dueña vea — 2 semanas · motor encendido

Las causas raíz R3 y R4. Eventos de auditoría en toda operación de plata, pantalla que los lee,
cola de entregas por revisar cableada, histórico y exportación, IVA, y los límites que hoy valida
el cliente movidos al servidor y a la base.

Salida: dado un faltante de caja sembrado en datos de prueba, la dueña reconstruye sola quién,
cuándo y en qué equipo, sin ayuda técnica.

### Ola 4 · Robustez y accesibilidad — 1 semana · motor encendido

La causa raíz R5 y el resto del alcance: offline honesto, los cuatro estados obligatorios de
listado, `axe` instalado y AA medible, y los 500 crudos convertidos en 400 validados.

**Fuera de la campaña, explícitamente:** multi-sucursal, KiloRuta y `apps/flota`, la extracción a
`packages/nucleo-*`, báscula por GATT, escaneo del TED, y todo P3 que no pertenezca a las cinco
causas raíz. Si aparece la tentación, se anota en `IMPLEMENTATION_PLAN.md` y no se toca.

---

## 4. MODELO DE DATOS

Los campos los da el negocio, no el modelo. Éstos ya están decididos y no se discuten.

**`pan.turnos` (nueva, migración 0017).** El arqueo necesita un sujeto y hoy no lo tiene: lo
esperado se calcula por dispositivo y la fila se unicifica por vendedor. **La panadería opera por
turno con apertura explícita** — decisión del dueño, 1-ago-2026. La palabra «turno» hoy sólo
existe en textos de la interfaz; no hay tabla ni columna.

```
pan.turnos(
  id uuid pk, dispositivo_id uuid not null fk, vendedor_id uuid not null fk,
  abierto_at timestamptz not null default now(), cerrado_at timestamptz,
  fondo_inicial_clp integer not null check (fondo_inicial_clp >= 0)
)
índice único parcial: un turno abierto por dispositivo   (where cerrado_at is null)
pan.ventas.turno_id       uuid fk    -- nullable → respaldo → not null (tres migraciones)
pan.cierres_caja.turno_id uuid fk
índice único cierres_caja: (turno_id, medio_pago)   -- reemplaza (fecha, medio_pago, vendedor_id)
```

Lo esperado del arqueo pasa a calcularse `where turno_id = $1`, el mismo sujeto con que se firma
la fila. El respaldo de lo histórico agrupa por (dispositivo, día), deja esos turnos marcados
como sintéticos y los declara en el informe de reparación: no son turnos reales y nadie debe
leerlos como tales.

**`pan.eventos`, extensión de uso (sin cambio de esquema).** Hoy sólo la escriben identidad y
parámetros. Pasa a ser obligatoria en toda operación de plata y de configuración: venta,
anulación de venta, apertura y cierre de turno, cambio de precio, reseteo de PIN, revocación de
equipo, merma, anulación de DTE, cierre de ruta. La tabla ya es append-only por `revoke`.

**`pan.saldo_cliente`, corrección (migración 0016).** La vista suma sólo documentos tributarios
vía pedidos, así que el fiado de mostrador no entra en el saldo de nadie. Pasa a sumar también
`pan.ventas` con `medio_pago = 'fiado'` y `cliente_id not null`, con su rama de abono.

**Reglas de migración durante la campaña, sin excepción:**

1. **Sólo aditivas.** Nada de `drop table`, `drop column` ni `truncate`. Una columna que sobra se
   deja de escribir y se documenta; se elimina después del DONE de la campaña.
2. Una columna nueva `not null` entra en **tres pasos y tres migraciones**: agregar nullable →
   respaldo → agregar la restricción. Jamás en una sola.
3. Todo cambio de restricción o índice único que pueda chocar con datos existentes va precedido,
   en la misma migración, del `select` que cuenta las filas infractoras, y el ensayo con
   `preflight-migraciones.mjs` contra la base real es obligatorio antes de desplegar. Esto no es
   teoría: el 26-jul un índice único no pudo crearse porque había tres rutas del mismo repartidor
   sin cerrar, y el deploy entró en crash-loop.
4. Cada archivo de migración incluye al final, en comentario, el SQL de reversión.
5. La numeración sigue desde `0016`. Dos migraciones nunca comparten número.

---

## 5. INTERFAZ

Rige `packages/miga` y el maestro §5. Lo que esta campaña agrega, como criterios verificables
con e2e de Playwright y captura — nunca con juicio estético:

- **Pantalla «Arreglar»** (`/arreglar`, sólo rol admin): anular una venta con motivo, corregir un
  cierre de turno, cerrar una ruta con odómetro, revocar un equipo enrolado, desbloquear un PIN,
  quitar un pedido de una ruta. Cada acción escribe su evento con nombre, hora y equipo. Toda
  acción destructiva se confirma **escribiendo el motivo**, no marcando una casilla.
- **Deshacer de 8 s** en pesaje, venta, agregar al carro y armar ruta, en lugar de modales
  (`AC-H0-11`, ya especificado y nunca construido). Un panadero con las manos ocupadas despacha
  un modal sin leerlo.
- **Los cuatro estados obligatorios** en todo listado: vacío accionable, cargando, error con
  reintentar, y sin conexión con el contador real de la cola. Hoy un error de red se ve idéntico
  a «no hay nada», y por eso el repartidor cuya ruta no carga se va a la casa.
- **Bandeja de pendientes** persistente, visible desde cualquier pantalla, con lo que la cola no
  pudo subir y por qué. Nada que la cola rechace desaparece sin decisión del operador.
- **El teclado grande** (`TecladoNumerico`, ya existe) en todo campo de plata, incluido el arqueo,
  que hoy usa el teclado chico del sistema.
- **F23 — sin `<select>` nativo en manos enharinadas** (declarado 2-ago-2026, encontrado por una
  sesión hermana auditando en solo lectura): `vender/page.tsx` (elegir el cliente al fiar) y
  `admin/page.tsx` (cambiar el rol de un usuario) usan `<select>` del sistema — el mismo defecto de
  fondo que el teclado chico del arqueo (AC-H0-11, "ningún control del sistema en un campo que un
  panadero real toca a diario"), del lado de listas en vez de números. Se reemplazan por
  `SelectorUnToque` (`packages/miga`, ya existe — el mismo patrón que ya usan destino de pesaje y
  medio de pago). Rompe de forma predecible 5 e2e existentes que dependen de la forma actual del
  DOM (`camino-dorado.spec.ts` con `.fill()` sobre el input de caja, y el helper `teclear()`
  duplicado en 4 specs que hace `getByRole("button", {name: dígito})` — un segundo teclado de
  dígitos en la misma pantalla rompería ese locator por *strict mode*); se actualizan en el mismo
  cambio, con la regla de dos manos.
- **Apertura de turno** al primer ingreso del día en un equipo: fondo inicial y confirmación, dos
  toques.

---

## 6. BENCHMARKS

- **Marcha atrás y auditoría:** Stripe Dashboard — toda operación de plata es reversible, deja
  rastro con actor y hora, y la reversión se ve al lado del original. Extraer el patrón
  «evento + reverso», no la pantalla.
- **Deshacer sin modales:** Gmail y iOS. La banda de 8 s protege igual y no interrumpe.
- **Arqueo por turno:** Toast y Square POS — apertura con fondo, conteo a ciegas, cierre
  atribuible a una persona y un turno.
- **Formato de evidencia:** el propio `docs/AUDITORIA_RED_TEAM_UX.md`, que ya lo tiene bien —
  esperado / observado / reproductor. Los falsadores de esta campaña se escriben así.

---

## 7. RESTRICCIONES Y PROHIBICIONES

Guardrails que abortan, no frases. Cada uno con la prueba que lo dispara en `prueba-arnes.sh`.

**Se corrige `packages/metodo/scripts/guardrail.sh`:**

- El grep anti-interpolación de SQL es case-sensitive y no puede disparar en este repo: pasa a
  `grep -Ei`, y su prueba usa una línea real con `${` dentro de `db.query`.
- Aborta si existe cualquier `.claude/worktrees/*/.env.local`. Esos archivos entran al contexto
  de compilación y llevan la cadena de producción.
- Aborta si el comando es `railway up` y `git status --porcelain` no está vacío, o HEAD no está
  empujado a `origin/main`, o el gate no está verde para ese sha. Hoy `railway up` sube el árbol
  de trabajo entero, incluido el trabajo de otra sesión.
- Aborta si `DATABASE_URL` no es localhost y el comando no es uno de los tres permitidos
  (`railway up`, `preflight-migraciones`, `migrar` con confirmación explícita del dueño).

**Se corrige `.dockerignore`:** agregar `**/.env.local`, `**/.env*.local` y `.claude/`. Los
patrones actuales sólo cubren la raíz, así que los `.env.local` de los cuatro worktrees viajan
hoy dentro de la imagen.

**Se corrige `prueba-arnes.sh`:** no escribe nunca el `.env.local` de la raíz — usa un archivo
temporal vía `KILOPAN_ENV_FILE`. Su prueba compara el **mtime** del archivo real antes y después
y falla si cambió. Una comprobación de sha256 pasaría hoy sin arreglar nada, porque el script ya
respalda y restaura: lo que hay que prohibir es que *escriba*, no que el contenido final difiera.

**Se corrige `db/conectar-railway.mjs`:** no corre `sembrar.mjs` sin confirmación, y la semilla
deja de crear un administrador con PIN 1234.

**El `.env.local` de la raíz vuelve a apuntar a PGlite.** La cadena de producción sale del árbol
de trabajo y vive sólo en las variables del servicio de Railway. Ningún script del repo debe
poder tocar producción por omisión.

**El motor autónomo jamás:** escribe en `db/migraciones/`, ejecuta `railway up`, corre
`conectar-railway.mjs`, toca `.env*`, ni opera fuera de `~/kilopan-monorepo`. Migraciones y
despliegue son de sesión supervisada, siempre. Si un ítem del plan exige una migración, el motor
lo deja marcado `requiere-dueño` y toma el siguiente. Esto vale también para las olas 2 a 4: sus
migraciones (0016 a 0019) las aplica una sesión supervisada, no el loop.

**Prohibiciones permanentes:** secretos fuera de `.env.local`; puertos 3000 y 3100 (los reclama
otro proyecto y mata lo que encuentre — KiloPan usa 3300+); `TODO`, `FIXME`, `PLACEHOLDER`,
`not implemented` y `lorem ipsum` en `src/`; API de pago.

---

## 8. MODELO Y ESFUERZO

| Trabajo | Modelo | Por qué |
|---|---|---|
| Los 5 P0, migraciones, esquema, seguridad | Opus | Irreversible o explotable; el error cuesta más que el modelo |
| Falsadores y mutantes de todo AC | Opus | Es la evidencia; si miente, la campaña entera miente |
| Arnés, CI, guardrails | Opus | Es el instrumento que decide todo lo demás |
| Pantallas, e2e, estados, deshacer | Sonnet | Volumen con patrón claro y prueba que lo verifica |
| Rótulos, `aria-label`, largos de texto, 400 en vez de 500 | Haiku | Mecánico y verificable por grep |
| Planificar y verificar | Sonnet | Lee artefactos ya producidos; no decide |

Escalación: dos fallas seguidas del gate sobre el mismo ítem suben un escalón de modelo.

`model-selector.sh` hoy elige el AC por su cuenta con un `grep` propio en vez de recibir la línea
que ya eligió `loop.sh` — dos fuentes de verdad para lo mismo, y por lo tanto ruteo distinto al
del ítem que se está construyendo. Se corrige en la Ola 1: `loop.sh` le pasa la línea y el
selector no vuelve a leer el plan.

**Vía de costo:** sólo la ventana OAuth de la suscripción. Cero API de pago. Ventana agotada ⇒ el
motor **espera** el reset con marcador en disco; no gira en vacío ni cambia de vía.

---

## 9. PROCESO

### 9.1 Un hallazgo, dos commits, dos manos

**La regla de dos manos es la corrección más importante de esta campaña:** quien escribe el
arreglo **no** escribe la prueba que lo falsa.

1. **Commit A — el falsador.** Una sesión escribe la prueba que reproduce el hallazgo tal como lo
   describe la auditoría y la deja **fallando** sobre `campana-base`. El commit registra el exit
   code del rojo en `docs/campana/pruebas.jsonl`.
2. **Commit B — el arreglo.** Otra sesión, que lee el hallazgo y no el commit A, corrige hasta que
   la prueba pasa. **No puede modificar el archivo de la prueba**; si cree que la prueba está mal,
   lo declara y devuelve el ítem, no lo edita.
3. **El mutante lo genera el script**, no una persona: `git show <sha_B> -- <archivos de
   producción>` revertido con `git apply -R`, y se exige que el comando del hallazgo vuelva a
   fallar. Si el mutante sobrevive, el AC no se cierra.

Mensaje de commit, formato del maestro: `fix(modulo): descripción [AC-XX-YY] [H-nnn]`.

### 9.2 Gate único

`bash packages/metodo/scripts/check.sh --full` decide, y **el verde lo estampa el exit code,
jamás un agente**. El verificador sólo documenta lo que el gate ya produjo. Lo que se repara en
la Ola 1, cada cosa con su prueba:

- `check.sh` rotula pasos que no ejecuta («offline emulado», `axe`, lighthouse): o los ejecuta o
  los lista como saltados. Un paso rotulado y no corrido es peor que uno ausente.
- `presupuesto-perf.mjs` devuelve OK cuando el manifiesto no trae las rutas críticas: hoy da
  verde midiendo cero pantallas. Pasa a fallar si no encuentra las tres rutas del flujo dorado.
- El marcador `last-green` certifica el commit anterior al cambio. Pasa a estamparse con el sha
  que el gate acaba de verificar.
- `apps/kilopan/package.json` corre `node --test src/**/*.test.ts` sin comillas: el glob es de un
  solo nivel, así que un test dentro de `src/app/api/...` no se descubre. Se corrige y se agrega
  una prueba que compara los `*.test.ts` en disco contra los que el runner ejecutó.
- Las fallas de infraestructura (puerto ocupado, base caída, `node_modules` ausente) salen con
  exit code propio y **no se reportan como rojo del código**.
- `camino-dorado.spec.ts:223` es flaky y está declarado como tal en la bitácora: se estabiliza o
  se saca del gate con su ítem abierto. Un test flaky dentro del gate lo pone rojo al azar y el
  watchdog trata el rojo como árbol roto.

### 9.3 Integración continua

Se crea `.github/workflows/gate.yml` que corre el gate en cada push. No hace falta `gh`: se
escribe el archivo y se empuja con `git`. **Antes hay que empujar los 22 commits pendientes**, y
eso se hace al inicio de la Ola 1, no al final. La protección de rama es el gesto G2 (§9.6).

### 9.4 Encendido del motor

El motor se enciende al cerrar la Ola 1 y sólo si se cumplen las cuatro condiciones, verificadas
por comando: gate sin pasos saltados; los cinco mutantes de control del Anexo B lo ponen rojo; CI
verde en tres commits distintos; y `lock.sh` demostrando que un segundo builder rebota con exit 7.

### 9.5 Convivencia y continuidad

Otra sesión puede estar trabajando el mismo árbol. Antes de tocar cualquier archivo: `ps aux` en
busca de otro builder, y mtimes de lo que se va a editar. Un diff que cambia solo es otra sesión
viva, no un fantasma.

A las 4 h 35 min de sesión: terminar el ítem en curso o abortarlo limpio, commitear todo,
actualizar `docs/BITACORA.md`, escribir `docs/HANDOFF.md` con estado, procesos vivos y próximos
pasos ordenados, y abrir la sesión siguiente. La sesión que encuentra un `HANDOFF.md` lo retoma
sin preguntar y arma su propio despertador.

### 9.6 Los dos únicos gestos del dueño

Todo lo demás lo ejecuta el agente, sin listas de tareas para el dueño. Estos dos no puede:

- **G1 · Rotar la credencial de Postgres de producción**, en este orden exacto para no tumbar la
  app: crear la credencial nueva en Railway → actualizar la variable del servicio → verificar que
  la app responde → recién ahí revocar la vieja. El agente conduce hasta la pantalla y deja el
  valor en el portapapeles; el dueño pega.
- **G2 · Activar la protección de rama** en la consola de GitHub, para que el gate en rojo bloquee
  el merge.

---

## 10. MONITOREO Y ENTREGA

**El panel** (`packages/metodo/panel`) se publica **con autenticación o no se publica**: hoy está
en una URL pública de Vercel arrastrando los logs crudos del agente y `ultimo-resultado.json`,
que guarda los comandos que el agente intentó ejecutar. Primer ítem de la Ola 1.

**Tres cifras, calculadas ejecutando y nunca leyendo un documento:** HAD por ola; hallazgos del
alcance sin falsador; consumo contra la ventana de 5 h, tomado de la consola oficial y no de un
índice propio.

**Bitácora** en `docs/BITACORA.md` tras cada ítem, append-only, con la cicatriz cuando la haya.

**El estado del motor son marcadores en disco** (`DONE`, `PAUSED-BY-OWNER`, `WAITING-OWNER`),
jamás un grep de logs. El conteo de pendientes vive en un solo script.

### DONE de la campaña

1. `campana.mjs --had` = 100 % sobre el alcance congelado, en tres corridas consecutivas de CI.
2. `check.sh --full` verde, cero pasos saltados, y los cinco mutantes de control lo ponen rojo.
3. Los cinco ataques del Anexo A rebotan con el código esperado, corridos contra una base aislada
   en el puerto 3301 — **jamás contra producción**.
4. Camino dorado completo en e2e: abrir turno → pesar → vender → cobrar → cerrar turno → armar
   ruta → entregar con POD → registrar documento → cerrar ruta → anular una venta desde «Arreglar»
   y ver el evento en la pantalla de auditoría.
5. El informe de reparación histórica está firmado por la dueña y los datos quedaron consistentes.
6. Cero operaciones del Anexo C requieren SQL a mano.

---

## Anexo A — Los cinco ataques que hoy tienen éxito

Cada uno es el falsador de su hallazgo. Se corren contra una base aislada en el puerto 3301.

| # | Ataque | Hoy | Después |
|---|---|---|---|
| A1 | `POST /api/dispositivos/enrolar` en bucle variando `pinAdmin` de 0000 a 9999 | 401 siempre, nunca 423; al acertar entrega `{dispositivoId, secreto}` | 423 al sexto intento fallido del mismo RUT, sin importar el dispositivo |
| A2 | Encolar una venta sin red y forzar un 409 al subir | La venta desaparece de la cola y del servidor | Sigue en la bandeja de pendientes con su motivo |
| A3 | Vender $10.000 con `medio_pago='fiado'` y `cliente_id` | `saldo_pendiente_clp` del cliente no se mueve | Sube en $10.000 |
| A4 | Dos vendedoras venden en la misma tablet y ambas cierran caja | Lo esperado de la segunda incluye lo de la primera | Cada cierre cubre sólo su turno |
| A5 | Asociar una nota de crédito (61) al pedido y pasar la ruta a `en_curso` | La ruta sale | La ruta rebota: el art. 55 exige guía o factura |

## Anexo B — Los cinco mutantes de control del arnés

Reversiones mecánicas que **deben** poner el gate en rojo. Si alguna no lo hace, el gate no sirve
y no se enciende el motor: revertir el tope de merma; revertir la normalización a minúsculas de
la clave del producto en la venta; devolver el precio al cuerpo del request; quitar el
`trg_exige_sesion` de `pan.ventas`; devolver `Expires` a la cookie de sesión.

## Anexo C — Operaciones que hoy exigen SQL a mano

Anular una venta · corregir un cierre de caja · cerrar una ruta · quitar un pedido de una ruta ·
anular o corregir un documento tributario · revocar un equipo perdido · desbloquear un PIN antes
de los 15 minutos · editar o dar de baja un cliente · mover una merma a `recuperada_con_venta` ·
reabrir un pedido cerrado por una entrega parcial.

## Anexo D — Auditoría de los ACs huecos (Ola 1)

Procedimiento, no caso a caso: para cada AC marcado `[x]` en `specs/kilopan/*.md` —**62 hoy**,
más 15 abiertos— se busca la prueba que lo respalda y se le aplica su mutante. El que no tiene
prueba, o cuyo mutante sobrevive, **vuelve a `[ ]`** con una línea que dice por qué.

Ya verificados como huecos por la auditoría: `AC-FIA-01` (índice `unique` sobre la propia llave
primaria), `AC-SEC-05` (declara que ningún secreto vive en `localStorage` y el secreto del
dispositivo vive ahí), `AC-SEC-06` (grep case-sensitive), `AC-PERF-04` (mide cero pantallas),
`AC-SUC-01` («sucursal» no aparece en el código), `AC-PERF-03`, `AC-POD-04`, `AC-DES-01`,
`AC-DES-03`, `AC-ID-07`, `AC-PES-01`, `AC-MERM-01`, `AC-H0-02`, `AC-DASH-02`, `AC-FIA-02`.

## Anexo E — No re-levantar

La verificación adversarial del 1-ago refutó 15 hallazgos por estar mitigados en otra capa, y la
del 26-jul refutó otros 12. Están listados en `docs/AUDITORIA_RED_TEAM_UX.md` (Anexo) y en el
informe del 1-ago. Volver a levantarlos gasta ventana y ensucia el HAD.

## Anexo F — Checklist prevuelo

**Cerrado el 2-ago-2026** (retroactivo: la Ola 0 se ejecutó antes de que este aparato
existiera — hueco encontrado por una sesión hermana auditando en solo lectura, y es
exactamente el defecto que la campaña vino a matar: un arreglo aceptado porque nada
podía demostrar que era falso, esta vez del lado del instrumento).

1. ✅ Variable norte calculable: `node packages/metodo/scripts/campana.mjs --had` →
   **HAD 100 % · 6/6 demostrados**, re-ejecutando cada falsador y regenerando cada
   mutante en vivo (no leyendo un registro histórico).
2. ✅ Alcance congelado en `docs/campana/ALCANCE.tsv` — los 5 P0 de Ola 0 más
   `H-merma-sin-test` (mutante del Anexo B #1, encontrado auditando el arnés).
3. ✅ Tag `campana-base` sobre `1bbb140` (HEAD antes del primer commit de Ola 0).
4. ✅ `docs/campana/pruebas.jsonl`: cada hallazgo con su commit de falsador (rojo) y de
   arreglo (verde), verificados en vivo el 2-ago-2026. `H-merma-sin-test` es un caso
   distinto — su arreglo es del 26-jul, anterior a la campaña — documentado como tal,
   con el mutante en un parche estático (`docs/campana/mutantes/`) en vez de derivado
   de un commit.
5. ✅ Guardrails corregidos y probados (`prueba-arnes.sh`, 32/32).
6. ✅ `origin/main` == HEAD (verificado 2-ago; el "22 commits sin empujar" de más
   arriba es del estado del 1-ago, ya resuelto en Ola 0).
7. ✅ `.env.local` de la raíz apunta a PGlite; la cadena de producción no vive en el
   árbol — se re-obtiene con `node db/conectar-railway.mjs` si hace falta.
