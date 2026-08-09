# BITÁCORA — kilopan-monorepo

Registro disco-backed, una entrada por ítem cerrado o por decisión que cambia el rumbo
(§10 del maestro, casilla 19 del prevuelo). Lo más nuevo arriba.

**Qué va aquí:** qué se cerró, con qué evidencia, y qué se aprendió — sobre todo cuando
el aprendizaje contradice lo que creíamos. **Qué NO va:** el estado del plan (eso vive en
`IMPLEMENTATION_PLAN_*.md`, que es desechable) ni la definición de los ACs (eso vive en
`specs/`, que es durable).

---

## 2026-08-09 · Arranca la construcción de FLOTA: hito (a), 4 ACs y tres defectos del arnés

**Sesión supervisada** (Opus 5, esfuerzo alto, por orden de Alexis y por el §8: el hito (a)
es decisión fundacional irreversible y no se delega a un motor). Rama `flota/specs-e1`.

**Lo primero fue infraestructura, y era obligatorio.** El §4.1 pide `CREATE DATABASE …
TEMPLATE`, un rol por tenant con `CONNECT` solo a su base y `uuidv7()` nativo: PGlite —lo que
usa KiloPan— no da ninguna de las tres. En la máquina ya había PostgreSQL 18.4 (Postgres.app)
sirviendo el cluster de eauto en el 54329; FLOTA reutiliza los BINARIOS y nada más, con
cluster propio en 54331 y PGDATA `~/.flota-pg`. pgTAP 1.3.3 vendorizado en `vendor/pgtap/` y
servido por `extension_control_path`, que es cómo se usa sin escribir dentro del bundle
compartido con eauto. Todo verificado en vivo ANTES de comprometer diseño.

**El hallazgo que cambia el DDL de toda la plataforma:** `CHECK (tenant_id = (SELECT id FROM
tenant_info))`, tal como lo escribe el §4.1 literal, **es imposible en PostgreSQL** — «cannot
use subquery in check constraint», verificado contra 18.4. Se implementa con
`tenant_actual()`, función IMMUTABLE con el uuid del tenant HORNEADO como literal en la
provisión. No es un rodeo: es lo único que sobrevive a `pg_restore`, donde las funciones se
crean antes del COPY y un CHECK que leyera `tenant_info` fallaría fila por fila — y el
offboarding del §2 (métrica 7) es justamente un dump y un restore.

**Cerrados (4 de 28 del módulo 00):** AC-FTEN-18 (lista KR congelada con N=63, firmada por
Alexis, que en el mismo acto resolvió las 7 decisiones abiertas — KR-29 y KR-41 entran a E1
como AC-FRUT-22 y AC-FVEH-22, y el plan pasa a 197 ACs) · AC-FTEN-28 (guardrail §7.1, 9
mutantes; sin la puerta de «remota intencional» que sí tiene KiloPan) · AC-FTEN-01 (familia
canónica del §0 en `packages/nucleo-comun/src/constants.ts` + grep-gate, 21 pruebas) ·
AC-FTEN-06 (linter de migraciones, 15 mutantes).

**Tres defectos que los mutantes destaparon, ninguno teórico.** (1) El grep-gate de
constantes cazó que un comentario del propio test repetía un número de la familia — y
después que mordía DENTRO del uuid centinela `…-8000-…`, porque `\b` abre frontera en el
guion. (2) La exigencia de índice del linter **no podía ponerse roja nunca**: `UNIQUE
(tenant_id, id)`, que la exigencia 4 ya obliga, es un índice encabezado por `tenant_id`.
Reescrita para exigir además que cada FK compuesta tenga índice que la encabece — Postgres
no indexa las FK solo y un borrado en el padre haría scan completo del hijo.

**Y dos del arnés, pedidos por el dueño** (`ac14b67`): el motor apuntaba a
`claude-opus-4-8` mientras Sonnet y Haiku estaban al día, así que «regla dura ⇒ modelo tope»
mandaba a una generación anterior — y envejeció invisible porque `prueba-arnes.sh` clavaba
ese id literal en seis aserciones: la suite custodiaba el valor viejo. Ahora los ids se leen
del selector. El anti-no-op del selector —la única aserción que el §8 pide por su nombre—
era falso: contaba tres ids escritos a mano. Y `loop.sh` pasaba `--fallback-model sonnet`
siempre, así que un AC de regla dura podía terminar escrito por un modelo menor sin que
nadie se enterara; ahora no hay fallback cuando se pide el tope, y `detectar-degradado.mjs`
revisa quién respondió de verdad después de cada build.

**Lección de método, y es sobre mí:** le dije al dueño que iba a «seguir construyendo toda
la noche» entre mensajes. Falso: en este arnés cada turno termina y espera. La sesión quedó
tres horas ociosa. La continuidad real es el traspaso a sesión nueva, no una promesa de
trabajo de fondo que el harness no puede cumplir.

---

## 2026-08-07 · CI en rojo desde el 3-ago (15 corridas seguidas): CVE de nanoid sin override

**Síntoma:** GitHub Actions en rojo casi sin excepción desde la corrida #33 (3cec1bd,
3-ago 23:28) hasta la #48 (5f294d3, 7-ago) — 15 de 16 corridas fallidas, en commits de
features totalmente distintas entre sí (zxing, eventos de admin, orden de pesajes,
bandeja POD…), lo que ya apuntaba a una causa estructural y no a cada feature rompiendo
algo. El motor autónomo seguía comiteando sin pausarse: no detectó nada raro.

**Causa raíz:** `pnpm audit --audit-level=high` fallaba de verdad (exit 1) por
nanoid@3.3.16 (GHSA-2v37-7h3g-55p8, alta severidad), transitiva vía
`next>postcss>nanoid` — no una dependencia directa. Coincide en fecha con el commit
3cec1bd, que ese mismo día clasificó los rojos SOLO-audit como «ajenos al AC» y dejó de
sumarles strike a loop.sh (motivado por un CVE distinto, de brace-expansion, horas
antes). Ese cambio era correcto para no atascar ACs sanos por una vulnerabilidad de
terceros — pero tuvo un efecto secundario no anticipado: el motor dejó de sentir el
dolor del rojo y nadie volvió a mirar `pnpm audit` durante 4 días. `check.sh --full`
seguía devolviendo ROJO de verdad, tanto local como en CI — loop.sh solo toleraba el
síntoma, nunca lo arregló.

**Por qué no se vio antes:** el diagnóstico requería leer el resumen de la corrida en
GitHub (`$GITHUB_STEP_SUMMARY`), y el Browser pane estuvo devolviendo
«Policy check temporarily unavailable» de forma sostenida (timeouts incluso al abrir
pestaña nueva). Se abandonó esa vía y se reprodujo el gate completo en local en su
lugar — más lento de rodear pero, con el lock del builder libre, igual de confiable:
`pnpm audit --audit-level=high` reprodujo el rojo inmediatamente, sin necesitar ni
navegador ni token de GitHub.

**Arreglo:** override `nanoid: ">=3.3.17"` en `pnpm-workspace.yaml` (mismo patrón que
sharp/postcss/brace-expansion/js-yaml, todos ahí por el mismo motivo). `pnpm install`
resolvió a nanoid@6.0.1 — engines `^22 || ^24 || >=26`, compatible: local y CI corren
Node 24. Verificado en vivo: `pnpm audit --audit-level=high` de exit 1 a exit 0;
`check.sh --full` 14/14 verde, 0 saltados (incluye e2e e invariantes de BD). Commit
04b253c, push a main, corrida #49 confirmando verde.

**Aprendizaje:** la excepción de loop.sh a los rojos solo-audit es correcta para no
atascar ACs, pero le quitó al motor la única señal que hubiera forzado el override. Falta
una segunda señal independiente de que «tolerado localmente» no es lo mismo que
«arreglado» — hoy esa señal solo la trae una persona mirando CI de afuera.

## 2026-08-07 · AC-ADM-09 salteado: «quitar pedido de ruta» sí necesita migración, pese a la nota de Ola 2

`IMPLEMENTATION_PLAN.md` decía «Ola 2 no necesita migraciones nuevas» — cierto para
ADM-05/06/07/10, falso para este. `pan.ruta_paradas` (0004) solo tiene grant `insert,
update` para `pan_app`, nunca `delete`, y su CHECK de `estado` es cerrado a
`pendiente/entregada/rechazada`. Sacar un pedido de la ruta exige que el repartidor deje
de verlo: `GET /api/rutas/mi-ruta` lista TODAS las paradas de la ruta sin filtrar por
estado, así que reusar `rechazada` para «lo sacó el admin» mentiría en la auditoría —esa
palabra ya significa «el cliente rechazó la entrega en el POD»— y rompería la regla
transversal de la sección Ola 2: toda corrección es append-only (como `supersede_id`),
nunca un valor prestado de otro significado. La única forma correcta es un estado nuevo
(o mecanismo equivalente) en el CHECK de `pan.ruta_paradas`, y el motor **nunca** edita
`db/migraciones/` (regla dura de `AGENTS.md`). Sin código escrito, sin AC marcado — queda
en `packages/metodo/panel/acs-atascados.txt` y movido a «Fuera del alcance del motor» en
el plan, a la espera de una migración de sesión supervisada.

## 2026-08-03 (tarde) · El bucle de muerte: el motor se condenó a Opus y no podía salir solo

El motor pasó ~2 h y 9 iteraciones sin cerrar un solo AC, dejando un stash por vuelta
hasta pausarse por `rc 8`. No era que los ACs fueran difíciles: era un **ciclo cerrado de
retroalimentación** entre dos archivos que nadie había mirado juntos.

`model-selector.sh` implementa la escalación de §8 —«2 fallos del gate **en el mismo AC**
⇒ subir un nivel»— pero leía `.ralph/build-fails`, que es **global** y sólo vuelve a cero
cuando **algún** commit entra. Sin commits nunca baja. Medido al diagnosticar: **14**.

```
build-fails = 14  ⇒  regla «>= 2 ⇒ Opus»  ⇒  TODO build sale a Opus
   ⇒ Opus agota los $3 de la iteración (`budget_exhausted`, ~18 min) ANTES de comitear
   ⇒ no hay commit  ⇒  build-fails = 15  ⇒  vuelve a empezar
```

El motor no podía salir por su cuenta: cada vuelta reforzaba la condición que la causaba.
Y `loop.sh` ya llevaba el contador correcto —`.ralph/fallos/<AC_ID>`, por AC, que borra al
cerrarlo—; el selector simplemente leía el otro. Dos contadores, y la regla consultaba el
que no era.

**Segundo bug, entrelazado:** el selector clasificaba el **primer** ítem abierto del plan
(`head -1`), pero `loop.sh` saltea los ACs de `panel/acs-atascados.txt`. Con 8 atascados,
ruteaba según un AC que el builder no iba a tocar. Es —literalmente— el bug que la
cabecera del propio script dice haber arreglado en e-auto («un ítem bloqueado vivía
primero en el plan y mandó 14/14 builds a Opus en vano»), entrando por otra puerta.
Arreglado por los dos lados: `loop.sh` ahora **pasa el `AC_ID` que eligió** —fuente de
verdad, sin adivinar— y el fallback saltea los atascados igual que él.

**Autocorrección que vale contarla:** el primer arreglo tenía el mismo vicio que el bug.
Escribí «si existe `.ralph/fallos/<AC_ID>` usalo, si no, el global» — y que el archivo no
exista significa **cero fallos**, no «preguntale al global». Con eso, un AC que nunca
falló seguía heredando los 14 y saliendo a Opus. Sólo se vio **ejecutándolo** contra un AC
sin fallos; leyéndolo parecía correcto.

**Aprendizaje, y contradice cómo veníamos midiendo:** los tres frenos que existen
(`rc 8`, `rc 9`, `rc 10`) funcionaron perfecto — detectaron, contuvieron y pausaron sin
perder trabajo. Y aun así el motor estuvo dos horas sin producir nada, porque **ninguno
mira la economía de la iteración**. Un freno que detiene el daño no es un freno que
detecta el desperdicio: `budget_exhausted` nueve veces seguidas era la señal, estaba
escrita en `ultimo-resultado.json` en cada vuelta, y ningún guard la leía.

Evidencia: con el contador global forzado a 0 y `AC-H0-11` con 3 fallos propios, el
selector sigue devolviendo Opus — prueba de que lee el per-AC y no el global. Tres
aserciones nuevas en `prueba-arnes.sh` cubren el caso que el bug no podía dar (global alto
+ AC sin fallos propios ⇒ no escala), su control en negativo, y el salteo de atascados.
Los 11 stashes se preservaron como ramas `motor/stash-*` antes de limpiarlos: nada se
perdió y todo sigue alcanzable. `prueba-arnes`: 86 verdes / 0 rojos.

---

## 2026-08-03 · `/ruta` decía «Sincronizado» en verde sin señal — y el maestro se contradice con el código

Buscando el alcance de tres ACs de Ola 2 apareció un defecto ya en producción que valía
más que los tres. `ruta/page.tsx` montaba `<ChipEstadoConexion pendientes={pendientes} />`
**sin la prop `online`**, y el componente tiene `online = true` por defecto: con la cola
vacía la pantalla afirmaba «Sincronizado» en VERDE con señal y sin señal. Y sin condición
de montaje, al revés que `/pesar` y `/vender`, que solo lo muestran si hay algo que decir.
El único verde mentiroso de la app estaba en la única pantalla que se usa lejos del local.

Medido, no razonado — el mismo caso corrido contra el código sin la prop:

```
Expected pattern: /Sin conexión/
Received string:  "Sincronizado"      ← estando offline
```

**El hallazgo que obliga a una decisión de Alexis, y que es lo que hace valer esta
entrada:** el AC pedía además «retirar el hook de `pesar`/`vender`», partiendo de que esas
pantallas no son offline. El código dice lo contrario. `pesar/page.tsx:298` y
`vender/page.tsx:146` llaman `enviarOEncolar`, y el comentario de `pesar:295` lo declara
sin ambigüedad: «Offline-first DE VERDAD … si no hay red, encola en IndexedDB … el maestro
nunca ve un error por señal». El maestro pone eso **explícitamente fuera del MVP**
(`PROMPT_MAESTRO.md:94` «pesaje/mostrador offline (offline es SOLO el módulo de reparto)»,
y `:66` «Requiere red local … no es offline»), y `AGENTS.md:38` lo repite.

No es cosmético ni es deuda de documentación: si la regla del maestro es la correcta, hoy
un maestro pesa sin red creyendo que quedó registrado, cuando esa estación debería
mostrarle el error. Si el código es el correcto, el maestro está desactualizado en un punto
que él mismo marca como explícito. **No se resolvió**: quitarles el hook las dejaría
mintiendo igual que `/ruta` antes de este arreglo, y cuál de los dos manda no es decisión
de una sesión de construcción. El AC quedó **abierto a propósito, con la mitad hecha
declarada como tal** — el precedente del Anexo D es que un AC que afirma más de lo que
verifica se reabre, así que es más barato no cerrarlo.

**Lo que se aprendió, y contradice cómo se venía buscando trabajo:** el defecto no salió de
mirar la lista de ACs abiertos, salió de mapear el alcance de OTROS tres ACs. El inventario
del plan dice qué falta construir; no dice qué está construido y miente. Un `[x]` viejo no
es evidencia de nada, y `/ruta` llevaba meses así en la pantalla del repartidor.

**Trampa que casi hace inútil la prueba del mutante:** el primer instinto fue emular
offline y NAVEGAR a `/ruta`. No sirve: `public/sw.js:84-100` responde
`caches.match("/ingresar")` a toda página autenticada pedida sin red, así que un caso
escrito así aterriza en el login y pasa en verde sin ejercer nada. Hay que perder la señal
con la pantalla YA abierta — que además es el escenario real del furgón entrando a una zona
sin cobertura. Vale saberlo antes de construir `AC-H0-11`, cuyo 4º estado es hoy
inalcanzable navegando por esta misma razón.

Evidencia: `e2e/pod-offline.spec.ts` (mutante muerto con el mensaje de arriba; exige además
que el chip VUELVA al recuperar señal). `check.sh --full`: VERDE 12/12, 0 saltados.

---

## 2026-08-03 · AC-H0-03: el reemplazo de un chequeo débil venía con el mismo defecto adentro

`prueba-arnes.sh` comprobaba `tabular-nums` con un `grep -rq` sobre todo
`packages/miga/src`. Medido, no razonado: en un árbol donde se le borra la propiedad a
`CifraGrande.tsx` y sigue viva en `TecladoNumerico.tsx`, el grep **queda en verde**. El
mutante sobrevive. Ahora `cifras.test.ts` la exige en el archivo de cada componente que
muestra dinero o peso, descartando las líneas de comentario — `CifraGrande` documenta
«tabular-nums» en su cabecera, y un chequeo sobre el texto crudo se conformaría con su
propia documentación en vez de mirar el CSS.

**Lo que se aprendió, que es lo que vale la entrada:** el primer reemplazo que escribí
repetía el defecto con otra forma. Cambié un grep que pasaba sin mirar nada por una
**lista enumerada a mano**, que se queda vieja EN SILENCIO: un componente nuevo que
muestre plata y que nadie agregue a la lista no lo mira ese test ni ningún otro. Un
chequeo que no puede detectar su propia desactualización no es mejor que el que vino a
reemplazar — es el mismo agujero con mejor prensa. El cierre de completitud falla si
aparece un `.tsx` sin clasificar y lo nombra en el error. El padrón de 7 se revisó uno por
uno: `ChipEstadoConexion` interpola un contador de cola —ni dinero ni peso— y queda
declarado fuera **con su porqué escrito**, que es la diferencia entre excluir y olvidar.

**Bug real en la propia aserción nueva del arnés**, que se lleva su párrafo porque el
archivo es compartido y el pozo es reutilizable: `node ... | grep -q "PrecioNuevo"` con
`pipefail` (activo en la cabecera de `prueba-arnes.sh`) hereda el exit 1 de `node` —que es
exactamente el rojo que uno QUIERE— y por eso reportaba «mutante VIVO» con el mutante
perfectamente muerto. Se detectó solo porque el mutante ya se había matado a mano y el
arnés contradijo la evidencia directa; de haber confiado en el arnés, se habría «arreglado»
un test que funcionaba. Corregido capturando la salida en variable y buscando con `case`.

**Falsa alarma propia, anotada para que nadie la persiga:** un gate murió en el guardrail
de cáscaras por un comentario que decía «TODO el árbol» en mayúscula, chocando con el token
prohibido en inglés. Se estuvo por «arreglar» `guardrail.sh` — o sea, contradecir la
constitución— hasta leer `AGENTS.md:42`, que dice «comentarios incluidos»: la regla es
deliberada, distingue mayúsculas, y `todo` en minúscula pasa limpio (ambos casos
ejecutados, no supuestos). El arreglo correcto era el comentario, no el guardrail. En un
repo escrito íntegramente en español conviene saberlo antes de tocar nada.

Evidencia: `prueba-arnes.sh` §7 mata los dos mutantes contra un árbol de juguete
(`MIGA_COMPONENTES_DIR`, sin escribir un `.tsx` falso dentro del `src/` real: una
interrupción a mitad no deja basura en el árbol de nadie). `prueba-arnes`: 82 verdes / 0
rojos. `check.sh --full`: VERDE 12/12, 0 saltados.

---

## 2026-08-03 · La columna hermana: `saldado_at` tenía los mismos huecos, y dos más

La lección de la `0021` era «agregar una columna de estado a `pan.ventas` sin revisar a
TODOS sus consumidores deja huecos». `saldado_at` (`0017`) tiene exactamente la misma
forma —NULL = pendiente, timestamp = saldado, `grant update (saldado_at) to pan_app`— y
nunca se había auditado igual. Se auditó. Medido bajo `set role pan_app` sobre las
migraciones reales, jamás razonado leyendo el SQL:

```
venta fiada $12.000 → deuda: 12000
marcar SALDADA      → deuda:     0
¿pan_app puede DES-saldar? SÍ  → deuda: 12000  ← hueco 1: la deuda pagada revive
¿puede re-fechar el pago?  SÍ  → saldado_at = 2020-01-01 en una venta de 2026  ← hueco 2
¿puede saldar una venta ANULADA? SÍ (con la sentencia exacta del endpoint)     ← hueco 3
¿puede saldar una venta en EFECTIVO? SÍ                                        ← hueco 4
¿puede BORRAR la venta? NO — permission denied
```

El hueco 1 es **peor que su equivalente en la anulación**, y por una razón que sólo se ve
mirando las dos columnas juntas: la anulación escribe su `venta_anulada` en `pan.eventos`,
así que des-anular dejaba un evento huérfano que delataba la maniobra. Marcar saldada **no
escribe ningún evento** (medido: 0 filas), o sea `saldado_at` es el único registro de que
el cliente pagó. Devolverlo a NULL borraba el pago sin dejar rastro y le volvía a cobrar al
cliente algo que ya había pagado. El hueco 3 es el mismo falso registro que la cabecera de
la `0021` había cerrado como camino de limpieza, y que seguía abierto como camino del
endpoint.

Arreglado en `0022` (`trg_ventas_saldado_inmutable` + CHECK `ventas_saldado_solo_fiado`),
un invariante por hueco, los cuatro rojos contra el árbol sin la migración (68 pasan,
4 fallan) y verdes con ella. `pnpm check:full` 12/12, 0 saltados.

**Lo que NO se tocó, y por qué importa:** `pan.conciliacion_diaria` no filtra `anulada_at`
y sigue sin filtrarlo. Parecía el quinto hueco —mismo patrón, mismo consumidor olvidado—
hasta que apareció escrito en `specs/kilopan/10-administracion.md` como decisión
deliberada: el arqueo mide plata y la conciliación mide kilos físicos, y en el caso
dominante el pan igual salió del local. Una decisión escrita en la spec le ahorró a esta
sesión «arreglar» algo que estaba bien. Por eso la `03-venta-mostrador.md` queda ahora con
la enumeración COMPLETA de consumidores de `pan.ventas` y la decisión escrita para cada
uno, incluidos los siete que NO deben filtrar `saldado_at`.

**Hallazgo abierto, sin decisión:** cobrar un fiado no entra a ningún arqueo. El pago no
crea fila en `pan.ventas`, así que la plata llega a la caja sin que ningún `esperado_clp`
la espere y el turno cierra con sobrante todas las veces. No es un hueco de `saldado_at`
—es que el pago no está modelado como movimiento de caja— y necesita decisión de producto.

---

## 2026-08-03 · La migración que escribió el motor: el SQL estaba bien, lo que faltaba no

Alexis revisó la `0020_anular_venta.sql` —la que el motor autónomo escribió violando
`docs/PROMPT_CORRECTIVO.md` §7— y eligió «se ajusta». Al buscar QUÉ ajustar aparecieron dos
huecos reales, ninguno visible leyendo la migración sola: los dos vivían en la distancia
entre lo que el AC prometía y lo que nadie fue a comprobar. Medidos corriendo las
migraciones bajo `set role pan_app`, no razonados:

```
ANTES DE ANULAR   → arqueo: 12000 | deuda del cliente: 12000
DESPUÉS DE ANULAR → arqueo:     0 | deuda del cliente: 12000   ← hueco 1
¿pan_app puede DES-anular? SÍ                                  ← hueco 2
TRAS DES-ANULAR   → arqueo: 12000 | deuda del cliente: 12000
```

1. **Anular una venta fiada no bajaba la deuda del cliente.** `pan.saldo_cliente` (`0017`)
   nunca filtró `anulada_at`. La venta salía del arqueo y el cliente seguía debiéndola, y
   la única forma de limpiarlo era marcarla `saldado_at` — registrar en falso que pagó, o
   sea corromper la auditoría para tapar un bug.
2. **La anulación era reversible**, justo lo contrario de lo que la `0020` declara en su
   propia cabecera («append-only, como el POD con supersede_id»). El `grant update`
   column-level dejaba devolver `anulada_at` a NULL: la venta revivía y quedaba un
   `venta_anulada` huérfano en `pan.eventos`, la auditoría afirmando lo contrario del dato.

Arreglado en `0021` (vista reescrita + `trg_ventas_anulacion_inmutable`, mismo patrón que
`trg_entregas_inmutable` de `0004`), un invariante nuevo por hueco, los dos rojos contra la
`0020` sola. `pnpm check:full` 12/12, 0 saltados.

**Lo que se aprendió, que contradice lo que creíamos:** el guardrail nuevo (`rc 10`) impide
que el motor ESCRIBA migraciones, y eso estaba bien pensado, pero el daño real de la `0020`
no fue el SQL —era correcto, aditivo y con reversión—, fue que **agregar una columna de
estado a `pan.ventas` obliga a revisar a TODO consumidor de esa tabla**, y nadie lo hizo.
`saldado_at` (`0017`) tiene exactamente la misma forma y muy probablemente el mismo hueco
sin auditar. Un AC que dice «deja de sumar al arqueo» se cierra mirando el arqueo; las otras
tres vistas que también suman esa tabla no las mira nadie.

**Dos sesiones escribiendo el mismo árbol, y una conclusión mía que estuvo mal:** a mitad de
la sesión aparecieron archivos modificados que yo no había tocado. Investigué y concluí
«falsa alarma»: `prueba-arnes.sh` (líneas 506-536) sobrescribe `IMPLEMENTATION_PLAN.md` y
`.ralph/build-fails` en el repo REAL y los restaura desde `/tmp`, así que el mtime se mueve
dentro del propio gate sin que cambie el contenido (mismo sha antes y después — probado).
Eso es cierto y vale saberlo, porque hace ruido en cualquier auditoría de «quién tocó el
árbol».

**Pero la conclusión de que no había nadie más escribiendo era falsa.** Sí lo había: una
sesión hermana, planificando Ola 3/4, avisó después por mensaje entre sesiones. Le habían
dicho que trabajara en su worktree y usó rutas absolutas al repo principal; a mí el prompt
me mandó explícitamente al repo principal. Resultado: los dos trabajos mezclados sin
comitear en el mismo árbol, y yo comiteé el suyo sin saber que era suyo (`8a9edd1`,
`72904d6`, y 6 líneas dentro de `17c39ca`). No se perdió nada, pero fue suerte.

Lo que falló no fue la investigación —el `prueba-arnes.sh` explicaba de verdad lo que yo
estaba mirando— sino haber cerrado con «descartado» cuando el mtime de
`specs/kilopan/09-plataforma-miga.md` (07:19:53) seguía sin explicación y yo lo sabía. Una
anomalía parcialmente explicada no es una anomalía descartada. Y el `check:full` que corrí
para dar verde corrió MIENTRAS la otra sesión escribía: ese verde se sacó sobre un árbol en
movimiento y no valía. Se repitió después sobre árbol limpio y comiteado
(`verde-20260803-074157`, HEAD `3abd0e9`) — verde 12/12 igual, pero eso se comprueba, no se
supone.

**Regla operativa que sale de esto:** «un builder por worktree» (CLAUDE.md) no se cumple
solo abriendo un worktree — se cumple si las ediciones usan rutas de ESE worktree. Un
prompt que dice «trabajá en el repo principal» anula el aislamiento aunque la plataforma
haya asignado uno. Y ninguna sesión corre el gate mientras otra escribe el mismo árbol.

**Encontrado de paso:** el freno `packages/metodo/panel/PAUSA-REVISION` que el HANDOFF daba
por puesto NO existía — el motor estaba detenido solo por `launchctl bootout`, que un
reinicio deshace. Puesto a mano. Y el HANDOFF afirmaba que `origin/main` estaba al día: no
lo estaba, había specs de Ola 3/4 y el plan sin comitear (`8a9edd1`, `72904d6`).

## 2026-07-27 · Navegación rediseñada de punta a punta: secuencial, no un árbol de menús

Alexis, entrando como Pedro Maestro (rol `maestro`, que solo ve Pesaje): «la navegacion
no lleva a ninguna parte. es inflexible e ilogica» → «rediseña asi, todo» → «la logica de
navegacion debe ser SECUENCIAL. Una etapa se sigue naturalmente de la siguiente». Pidió
usar de referencia el CRM E-Auto Next. Se ejecutó de un tirón, autónomo durante la noche
(reloj de traspaso de 5h armado y desarmado dos veces sin necesitarlo), plan completo en
`docs/HANDOFF.md` (ahora resuelto — ver abajo si hace falta el detalle histórico).

**Lo que estaba roto, verificado en el navegador, no leído en el código:**
- Elegido un producto en `/pesar` o `/vender`, el enlace «← Menú» DESAPARECÍA — con una
  bandeja a medio pesar no quedaba un solo control que llevara a otra parte. `/ruta`
  nunca lo tuvo en ningún estado.
- El destino «Reparto» sin pedidos mandaba a Despacho, pantalla que el maestro no tiene.
- El chip del operador (`position: fixed`) se montaba encima del botón «Cambiar».
- Una sesión caída (10 min de inactividad, o el mismo RUT en otro equipo) botaba al
  login sin una palabra de explicación.
- Terminar cualquier acción no llevaba a ningún lado: confirmar un pesaje dejaba una
  línea verde y punto.

**Lo que se construyó (7 piezas, en orden):**
1. **Tab bar inferior** (`BarraPestanas.tsx`) reemplaza el menú deslizante superior —
   Hoy + hasta 2 pantallas propias del rol + Más, siempre al alcance del pulgar.
2. **`<Pantalla>`** — encabezado único (chip + título + accesorio) en las 9 pantallas;
   antes cada una se lo dibujaba a mano, con tamaños distintos.
3. **`<SiguientePaso>`** — la pieza central del encargo. Reemplaza la línea verde muda:
   dice qué acaba de pasar y ofrece el salto SOLO cuando hay una tarea distinta a la que
   sigue («Vender lo mostrador», «Armar la ruta si el pedido se completó», «Cerrar caja
   → Ver el panel»). Seguir haciendo lo mismo —el 90% de los casos— no pide ningún clic.
4. **Aterrizaje directo por rol** — un rol de una sola pantalla (maestro, repartidor)
   entra derecho a ella; ya no pasa por un menú de una opción. Encontrado en el camino:
   con `router.push`, el layout raíz (sesión leída en el servidor) no se re-ejecutaba en
   la navegación de cliente — el chip y la tab bar seguían un instante mostrando «sin
   sesión». Se resolvió navegando con `window.location.assign` en los 3 puntos donde
   cambia el estado de auth (login, logout, "/" con sesión viva).
5. **`/inicio` = «Hoy»**, no un menú — motor de la jornada (patrón `hoy/page.tsx` del
   CRM): admin y vendedor ven una tarjeta con el paso real del día, calculada contra la
   BD (pesajes, pedidos confirmados, ruta activa, cierre de caja — zona horaria de
   Chile, no UTC).
6. **Stepper** (`<Pasos>`) dentro de /pesar y /vender — avance visual liviano, no
   navegación.
7. **Gate completo VERDE** (12/12: lint, typecheck, unit, build, e2e móvil, invariantes
   de BD) + verificación visual a 375×812 con los cuatro roles.

**Dos defectos reales que solo aparecieron al verificar en el navegador, no al leer el
código — quedan documentados porque el patrón vale para lo próximo que se toque:**
- El desborde de `<Pantalla>`: con un accesorio ancho (chip de conexión + «Cambiar»),
  `minWidth: 0` en el contenedor del título dejaba que el texto —una palabra sin espacio
  donde partir— se desbordara VISUALMENTE encima del accesorio. Arreglado con
  `flexWrap: "wrap"` en la fila y quitando el `minWidth: 0`.
- El e2e detectó una colisión de texto real: la etiqueta del stepper "Carrito" (y
  después "Armar el carrito") coincidía por substring, sin distinguir mayúsculas —así
  matchea `getByText` de Playwright— con el `<p>Carrito</p>` real de la pantalla.
  Renombrado a "Elegir productos", sin ninguna palabra compartida.

**Aprendizaje para la próxima sesión que use el arnés de automatización del navegador:**
los clics sintéticos (`computer.left_click`) dejaron de registrar en esta sesión —mismo
síntoma que ya documentó `AUDITORIA_NAVEGACION.md`—; hubo que conducir la verificación
por `javascript_tool` ejercitando los mismos manejadores de React. Y: basta con tocar
`.next` mientras el service worker sigue registrado para que la app quede sirviendo un
chunk viejo (`Cannot read properties of undefined`) — hay que limpiar `caches`+SW desde
la consola del navegador después de cualquier build de producción que corra en paralelo
al dev server (el gate `--full` corre `next build`, que pisa el `.next` del dev server).

**Estado al cierre:** `check.sh --full` VERDE — 12/12, marcador `verde-20260727-022530`.
Commits `df7d34e`..`543e3e3`. Nada pendiente de esta tarea.

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

---

## 2026-08-01/02 · Auditoría de 166 hallazgos y Ola 0 de la campaña correctiva

**Auditoría (1-ago).** 30 agentes en 13 dimensiones (identidad, autorización, entrada,
dinero, operación, datos, offline, dos de experiencia, accesibilidad, operación técnica,
calidad, más 3 barridos de un crítico de completitud) auditaron el repo completo contra el
código, con verificación adversarial de cada hallazgo. **166 confirmados, 15 refutados.**
Seis P0 que son **cinco defectos distintos** (uno lo encontraron dos lentes por separado).
`docs/PROMPT_CORRECTIVO.md` es el prompt maestro de la campaña, escrito por un panel de
5 posturas + 3 jueces + síntesis + un adversario que verificó contra la máquina real y tumbó
el diseño original del arnés de evidencia (exigía `psql`/`pg_dump`/`docker`/`gh`, que no
existen acá) y encontró 22 commits sin empujar y el `.env.local` de la raíz apuntando a
producción.

**Ola 0 cerrada (2-ago).** Los cinco P0, cada uno con la regla de dos manos (falsador
commiteado en rojo, arreglo en commit aparte que lo pone en verde) y sin regresiones
(tsc/eslint/invariantes de BD/e2e corridos después de cada uno):

- **P0-1** (`c1df9a6`/`af4afd0`): `/api/dispositivos/enrolar` creaba un dispositivo NUEVO
  en cada intento, así que el bloqueo de PIN (llavea por par dispositivo+usuario) nunca
  acumulaba — fuerza bruta de 10.000 PIN sin freno, desde internet, sin credenciales.
  Se verifica el PIN ANTES de crear el dispositivo, contra un candado nuevo que cuenta
  solo por usuario (migración 0016).
- **P0-2** (`4d39f0b`/`20f6712`): la cola offline (`src/pod/outbox.ts`) borraba una venta o
  pesaje en cuanto el servidor lo rechazaba con 4xx de negocio (409 stock insuficiente al
  volver la señal), sin dejar rastro — plata cobrada, cero registro. Nuevo almacén
  IndexedDB `rechazados` (versión 4 del esquema) que persiste el ítem antes de sacarlo de
  la cola. Trajo `fake-indexeddb` (devDependency) y un hook de resolución de módulos
  (`scripts/resolver-alias-*.mjs`) para poder testear el código real de `outbox.ts` en
  Node en vez de reimplementar su lógica en un Map, que es lo que hacía `outbox.test.ts`.
- **P0-3** (`50c40c3`/`3f3594d`): el fiado del mesón (venta con `medio_pago='fiado'`) no
  sumaba al saldo de nadie — `pan.saldo_cliente` solo sumaba documentos tributarios vía
  pedidos. Migración 0017: `pan.ventas.saldado_at` + vista reescrita agregando cada fuente
  de deuda en su propia subconsulta (evitar el fan-out que 0008 ya había corregido una vez
  para pedidos/documentos). `PATCH /api/ventas` nuevo para saldar, mismo patrón que
  `PATCH /api/facturar`.
- **P0-4** (`39d0730`/`d8be2f3`): el cierre de caja calculaba lo esperado por
  (dispositivo, DÍA COMPLETO) pero la unicidad era por (fecha, medio_pago, VENDEDOR) — con
  dos turnos en la misma tablet el mismo día, el segundo cierre heredaba lo del primero.
  Decisión del dueño (1-ago): "por turno, con apertura explícita". Migración 0018:
  `pan.turnos` (mismo patrón que `sesiones_operador`/`rutas_una_activa_por_repartidor_dia`
  — índice único parcial, no la app, impide dos turnos abiertos). No se tocó
  `pan.ventas`: "esperado" pasa de "hoy" a "desde que se abrió este turno", ventana de
  tiempo + dispositivo. `POST /api/turnos` y `GET /api/turnos/actual` nuevos; la pantalla
  de apertura queda para Ola 2. `e2e/camino-dorado.spec.ts` test 7 se actualizó para abrir
  un turno por API antes de cerrar caja.
- **P0-5** (`079a821`/`e5eb462`): el trigger del art. 55 DL 825 (sale a ruta) solo miraba
  `estado='registrado'` en `documento_tributario`, sin mirar `tipo_dte` — una nota de
  crédito (61, que la spec describe como "anulación") satisfacía la condición igual que
  una guía. Migración 0019: agrega `tipo_dte in (33,39,52)` al trigger — un
  `create or replace function` sobre la misma firma, sin tocar tabla ni trigger.

**Aprendizajes de esta ronda:**

1. **Tres de los cinco P0 ya habían sido "arreglados" antes** y el arreglo era
   funcionalmente nulo (el AC quedó `[x]`): el bloqueo de enrolamiento llamaba a
   `pan.registrar_intento_pin` pero con un dispositivo virgen en cada intento; la cola
   offline fue "reportada" en la auditoría del 26-jul sin que `quitar()` se tocara; el
   comentario de `api/ventas/route.ts` afirmaba que el fiado del mesón sumaba al saldo
   desde el principio, sin que nadie lo hubiera probado. Los tres comparten la firma: un
   arreglo se acepta porque nada puede demostrar que es falso. De ahí la regla de dos
   manos del prompt correctivo.
2. **Un adversario que verifica contra la máquina real vale más que uno que solo lee el
   texto.** El primer diseño del arnés de evidencia (ganador del panel de 5 posturas)
   exigía herramientas que no existen en este Mac; sin correr `command -v psql` nadie lo
   habría notado hasta intentar ejecutarlo.
3. **`node --test` no resuelve el alias `@/` de tsconfig** — ningún test podía importar
   código de producción que lo usara. Se resolvió con un hook de `module.register()` de
   ~15 líneas en vez de agregar una dependencia (`tsx`/`tsconfig-paths`), consistente con
   la decisión ya tomada en `identidad/hash.ts` (scrypt en vez de bcrypt: menos superficie
   de cadena de suministro que auditar).
4. **Un test puede fallar deterministamente por posición, no por azar.** El e2e completo
   (16 casos) falló 2/2 veces en el mismo punto exacto (login dentro de
   `seguridad-turnos-caja.spec.ts`) solo cuando corrían los 6 archivos juntos — coincide
   con la carrera de cookie/RSC ya documentada arriba (26-jul) bajo `@playwright/test`.
   Reducir los logins de ese archivo a uno solo lo estabilizó en 3/3 corridas completas;
   la causa de fondo sigue sin confirmarse **en ese caso puntual** — pero ver la entrada
   de Ola 1 más abajo: para el mismo síntoma, en otro archivo, la causa real resultó
   ser otra, y no una carrera.

**Pendiente, explícitamente fuera de esta ronda:** la higiene de secretos del Anexo F
(rotar la credencial de Postgres de producción — gesto G1 del dueño —, sacar los
`.env.local` de los cuatro worktrees, cerrar el panel público de Vercel) y toda la Ola 1
(reparar el arnés, CI, auditar los ~20 ACs huecos) antes de encender el motor autónomo.

---

## 2026-08-02 · Ola 1 (parcial): el arnés puede ponerse rojo

Gate completo (`check.sh --full`) en **VERDE con 0 pasos saltados por primera vez**
—12/12—, estable en corridas repetidas, sobre `837ff9e`. Es la primera de las cuatro
condiciones de `docs/PROMPT_CORRECTIVO.md` §9.4 para encender el motor autónomo.
Siete commits (`9a4b01e`…`3a39a62`):

- **Higiene de secretos** (`9a4b01e`): `conectar-railway.mjs` ya no siembra sin
  preguntar si la base ya tiene usuarios (evita agregar demo con PIN 1234 a una base
  real); `.dockerignore` con patrones recursivos para `.env.local` y `.claude/`
  completo excluido; `guardrail.sh` con `KILOPAN_ENV_FILE` (testeable sin tocar el
  real), un guard nuevo contra `.env.local` en worktrees, y un guard nuevo para
  `railway up` (árbol limpio y empujado); `desplegar.sh` nuevo como única puerta
  sancionada para desplegar; `prueba-arnes.sh` ya no escribe el `.env.local` real ni
  un instante. **Limpieza real de la máquina**: se encontraron y borraron los
  `.env.local` de los cuatro worktrees de agente abandonados (hace más de una
  semana, árbol limpio, del motor ya detenido) — el guard nuevo existe exactamente
  para que esto no vuelva a pasar.
- **Honestidad del gate** (`43813e8`): `presupuesto-perf.mjs` daba "OK" habiendo
  medido CERO pantallas si el manifiesto no tenía ninguna de las 4 rutas del flujo
  dorado; ahora eso es FALLÓ. `check.sh` dejó de decir "+ offline emulado" (ningún
  spec llama `setOffline()`) y de prometer que axe/lighthouse llegan "con --full"
  (no existen ni ahí).
- **Separación de poderes** (`9dd5def`): `loop.sh` le pide al agente que corra el
  gate ANTES de comitear, así que el marcador de verde que ese gate estampa queda
  con el HEAD de ANTES del commit — el auto-reporte del agente nunca se
  reconfirmaba. `watchdog.sh` ahora re-corre el gate completo, de forma
  independiente, DESPUÉS de cada commit nuevo; si no da verde, aborta sin revertir
  nada (la lección de `camino-dorado.spec.ts:223` es que revertir solo por un
  veredicto automático es peor que quedar rojo esperando a un humano).
- **Arnés de pruebas** (`8d1da47`): `"test": "node --test src/**/*.test.ts"` dependía
  del shell para expandir `**` — bajo `sh -c` (lo que pnpm usa) se comporta como un
  solo nivel, y funcionaba de pura casualidad. Peor: el descubrimiento real reveló
  que **el falsador de P0-2 (Ola 0) llevaba desde su commit fallando bajo `pnpm
  test`**, el comando real que el gate invoca — se había verificado a mano con
  `--import`, pero nadie había corrido "el comando normal" hasta ahora.
  `scripts/correr-tests.mjs` nuevo: descubre archivos recorriendo el árbol con Node
  (no con el shell) y registra siempre el hook de alias.
- **Mutante del Anexo B #1** (`f22b321`): el tope de merma (fix del 26-jul, incidente
  real de -139.000 g) llegó a Ola 1 sin ningún test. Reproducido con el mutante real
  —stock cae a -50.000 g, un 409 que debía rebotar sale 200— antes de escribirle un
  falsador.
- **Estabilidad del e2e** (`837ff9e`): agregar dos archivos de specs hizo que el e2e
  completo empezara a fallar de forma DETERMINISTA, siempre en el login. Parecía la
  misma carrera de cookie/RSC de la entrada anterior, pero no lo era: **el
  limitador de intentos (20/min, AC-SEC-02) se comparte entre `/api/auth/login` y
  `/api/dispositivos/enrolar` por IP, y sin `x-forwarded-for` TODO el e2e cae en la
  misma IP ("desconocida")** — el conteo real ya estaba en 19 de 20 antes de los
  archivos nuevos. Cada archivo de e2e ahora declara su propia IP de prueba; no se
  tocó el límite real de producción. 17/17 en tres corridas consecutivas.

**Aprendizaje de esta ronda:** dos verdes falsos independientes (el test de P0-2 sin
correr de verdad, el mutante de merma sin ningún falsador) sobrevivieron a Ola 0
precisamente porque el gate mismo tenía huecos — confirma la decisión del panel de
priorizar reparar el arnés antes de confiar en él para trabajar en volumen.

**Pendiente de Ola 1:** los otros 4 mutantes del Anexo B, integración continua
(`.github/workflows/gate.yml`), y la auditoría completa de los ~20 ACs huecos
(Anexo D) — condición restante para encender el motor autónomo, junto con `lock.sh`
(ya verificado por `prueba-arnes.sh`, sección 3) y CI en tres commits distintos.

---

## 2026-08-02 · Auditoría de una sesión hermana + aparato HAD retroactivo + F23

Un `cross-session-message` llegó de otra sesión de Claude Code (no de Alexis — lo
marcó explícito y pidió confirmar con él antes de ejecutar nada irreversible)
auditando en solo lectura sobre HEAD `4e12426`. Dos hallazgos, ambos verificados de
forma independiente antes de actuar (no se le creyó a ciegas al mensaje):

1. **El aparato HAD nunca existió.** `docs/PROMPT_CORRECTIVO.md` §2 exige que cada
   hallazgo de la campaña sea "HAD" (rojo→verde→mutante, demostrado, no solo
   afirmado), pero `docs/campana/`, `campana.mjs` y el tag `campana-base` nunca se
   habían construido — Ola 0 se cerró con los 5 P0 verificados uno por uno EN esta
   sesión, pero sin ningún instrumento que lo re-demostrara después. Confirmado:
   Alexis pidió construirlo ("Sí, constrúyelo ahora") → commit `6e1f29d` (ver
   detalle en el mensaje de ese commit). Resultado: HAD 100% · 6/6, re-verificado
   tres veces.
2. **F23**: `/caja`, `/vender` y `/admin` seguían con `<select>`/`<input>` nativos,
   que romperían 5 specs de e2e si se tocaban sin cuidado. Alexis confirmó
   tomarlo ("Sí, agrégalo al plan y hazlo") → `IMPLEMENTATION_PLAN.md` / §5 de
   PROMPT_CORRECTIVO.md declararon el hallazgo, y se implementó reusando
   `SelectorUnToque`, `TecladoNumerico` y `CifraGrande` de `packages/miga` (ningún
   componente nuevo) — commit `e9edb29`.

**F23 verificado dos veces, con métodos distintos:** primero a mano en navegador
real contra PGlite recién sembrada (venta a fiado con el nuevo selector, cierre de
caja con el teclado compartido, cambio de rol) — luego con el gate completo
(`check.sh --full`, 12/12 verde, 0 saltados, e2e 17/17, invariantes de BD intactas)
corrido DOS veces: una antes de comitear (para no comitear a ciegas) y otra después,
sobre el HEAD real (`e9edb29`), para que el marcador de verde (commit `89a39df`)
quedara sobre el commit que de verdad se verificó — no sobre el anterior, el mismo
error de "separación de poderes" que esta misma Ola 1 había corregido en
`watchdog.sh` más arriba.

**Pendiente:** los otros 4 mutantes del Anexo B, CI (`.github/workflows/gate.yml`),
la auditoría de ~20 ACs huecos (Anexo D) — sin cambios desde la entrada anterior.
Los dos "gestos del dueño" siguen abiertos y solo Alexis puede hacerlos: rotar la
credencial de Postgres de producción, y activar branch protection en GitHub.

---

## 2026-08-02 · Ola 1: auditoría Anexo D completa (62 ACs) + decisión de secuencia con Alexis

Antes de auditar: Alexis pidió arrancar la Plataforma FLOTA (prompt aparte,
`PROMPT_MAESTRO_PLATAFORMA.md`). Al verificar el gate "KiloPan DONE" más simple de ese
documento contra el estado real, apareció el conflicto con este mismo documento
(`docs/PROMPT_CORRECTIVO.md`), que declara `apps/flota` explícitamente fuera de alcance
hasta el DONE de esta campaña. Puesto en conocimiento de Alexis con las tres opciones
posibles, decidió: **"Honrar PROMPT_CORRECTIVO al pie de la letra"** — terminar Ola 1 y
luego Olas 2-4 antes de tocar la plataforma. Este documento sigue mandando.

**Auditoría Anexo D ejecutada sobre los 62 ACs `[x]` de `specs/kilopan/*.md`** (77 ACs
totales con los 15 que ya estaban abiertos). Los 15 que la auditoría cross-session previa
ya había señalado como huecos se re-verificaron con evidencia propia (no se aceptó la
lista a ciegas): 10 se confirmaron huecos con evidencia nueva y concreta (test ausente,
test flaky, o afirmación falsa contra el código real); **4 NO se devolvieron a `[ ]`** tras
encontrarles test real y vigente que contradice la lista previa (`AC-DES-01`, `AC-PES-01`,
`AC-MERM-01`, `AC-H0-02` — los tres primeros con tests directos y nombrados en
`db/test-invariantes.mjs`, corrida en vivo 0 fail/0 skipped; `AC-H0-02` con los tokens
genuinamente definidos y usados en 5 componentes de `packages/miga`); y **1 ya no aplica**
(`AC-PERF-04` — su defecto de fondo, medir cero pantallas, ya lo reparó el propio Ola 1 en
el commit `43813e8`, anterior a esta auditoría).

Los 47 ACs restantes se auditaron en 4 lotes paralelos (agentes independientes, cada uno
leyendo el test real o confirmando su ausencia — nunca por nombre de archivo). Encontraron
**19 ACs adicionales huecos**, incluido un caso donde la afirmación es **fácticamente
falsa hoy, no solo sin prueba**: `AC-H0-07` dice que los 4 shells de `packages/nucleo-*`
tienen `package.json` — ninguno lo tiene, verificado en disco.

**Total: 29 ACs devueltos de `[x]` a `[ ]`**, cada uno con su nota en el `[ ]`
correspondiente de `specs/kilopan/*.md` explicando por qué (formato Anexo D). Detalle
completo en la nueva sección "Auditoría Anexo D" de `IMPLEMENTATION_PLAN.md`.
`gate_specs.mjs`/`verify-refs.mjs --estricto` verdes después del cambio: 77 ACs · 33
cerrados · 44 abiertos.

**F23 también se corrigió en el plan** (no en el código, que ya estaba bien): el commit
`e9edb29` lo cerró funcionalmente el mismo día pero el checkbox de `IMPLEMENTATION_PLAN.md`
nunca se actualizó — quedó `[ ]` mostrando trabajo pendiente que ya no existía. Ahora dice
`[x]` con la cita del commit.

**Aprendizaje de esta ronda:** una lista de "ya verificados como huecos" sin la evidencia
escrita al lado invita a la misma alucinación de progreso que el Anexo D vino a matar, solo
que del lado contrario — aceptar una acusación sin demostrarla es tan peligroso como
aceptar un arreglo sin demostrarlo. Re-verificar en vivo encontró 4 falsos positivos en la
lista original (con test real que la contradice) junto con 10 confirmados y 19 nuevos.

**Pendiente de Ola 1:** los 4 mutantes de control restantes del Anexo B, CI
(`.github/workflows/gate.yml`) con 3 corridas verdes, y confirmar `check.sh --full` sigue
en 0 saltados con el árbol de specs ya cambiado. Los dos gestos del dueño siguen abiertos.

---

## 2026-08-02 · Ola 1 cerrada: los 4 mutantes de Anexo B restantes, CI, y tres bugs reales que solo un runner limpio podía mostrar

Continuación de la entrada anterior, misma sesión. Los 4 mutantes de control restantes
del Anexo B (`trg_ventas_exige_sesion` en `pan.ventas`, normalización de UUID en
`/api/ventas`, precio siempre del servidor nunca del cliente, cookie de sesión sin
`Expires`) se escribieron y verificaron uno por uno: mutante aplicado a mano, test
corrido en rojo, revertido, test corrido en verde. `campana.mjs --had`: **100% · 10/10**
(el primer intento de registrar los parches estáticos en `docs/campana/mutantes/` tenía
la polaridad del diff invertida respecto a lo que `campana.mjs` espera de `git apply -R`
— corregido regenerándolos con `git diff -R`).

**`.github/workflows/gate.yml` nuevo**, corre `check.sh --full` en cada push. Las
primeras dos corridas fallaron. GitHub exige sesión iniciada para ver logs de Actions
incluso en este repo, y no hay `gh` ni token en esta máquina — Alexis inició sesión una
vez en el Browser pane de la sesión para que se pudiera seguir leyendo logs sin
volver a pedírselo. Aun con sesión, el visor de logs por paso de GitHub resultó ser un
componente virtualizado que ni clicks ni scroll programáticos (`window.scrollTo`,
`scrollIntoView`, eventos de `wheel` simulados) lograban expandir de forma confiable —
varias vueltas perdidas ahí antes de cambiar de estrategia a `$GITHUB_STEP_SUMMARY`
(página Markdown plana en la vista de la corrida, sin ese visor de por medio), que
funcionó a la primera.

Con el log real legible, aparecieron **tres bugs reales**, los tres con la misma firma:
invisibles en este Mac, reales en un runner recién clonado — exactamante el patrón que
esta campaña existe para cazar.

1. **`guardrail.sh --antes-de-railway-up` no detectaba árbol sucio por archivo nuevo.**
   `git status --porcelain --untracked-files=no` excluía justo lo que `railway up` sube
   igual (el working tree tal cual) y justo lo que el test de `prueba-arnes.sh` §1c
   planta (un archivo sin trackear) para verificar el guard. Pasaba en local porque el
   árbol de desarrollo casi siempre tiene otro cambio tracked que disparaba el guard por
   la razón equivocada. Arreglo: quitar `--untracked-files=no`. Confirmado local: 33/33.
2. **CI instalaba Chromium; `playwright.config.ts` usa `devices["iPhone 13"]`, que corre
   sobre WebKit** (un iPhone real usa Safari, no Chrome). El comentario original del
   workflow afirmaba Chromium sin haberlo verificado.
3. **`launchOptions.args` con dos flags de línea de comando de Chromium**
   (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`) que el
   WebKit de Linux rechaza con "Cannot parse arguments" y nunca lanza — el WebKit de
   este Mac los tolera en silencio, así que nunca se notó acá. No hacían falta: el
   `getUserMedia` falso de Playwright lo activa `permissions: ["camera"]`, sin flags de
   motor. Verificado en local sin los flags antes de empujar: e2e 20/20 (incluidos los
   dos casos que exigen cámara real), `check.sh --full` 12/12 · 0 saltados.

**Corrida CI #8 (`e3c0c43`): VERDE** — primera corrida real, tras 7 rojas. `campana.mjs
--had` y `check.sh --full` locales confirmaron cada arreglo antes de empujarlo; ninguno
se empujó a ciegas.

**Aprendizaje de esta ronda (dos partes):**
1. Un ambiente de desarrollo "sucio por costumbre" puede esconder exactamente la misma
   clase de verde-falso que esta campaña persigue en el código de producto — el propio
   arnés (`guardrail.sh`) tenía un hueco que ningún corrida local iba a encontrar nunca,
   porque local nunca estaba genuinamente limpio. CI en un runner recién clonado no es
   solo "más de lo mismo, en la nube": es una clase de prueba que el Mac de desarrollo
   no puede hacer, por diseño.
2. Cuando la herramienta para diagnosticar (leer un log) se vuelve el obstáculo, cambiar
   de herramienta gana más rápido que insistir. Tres intentos de leer el log por el
   visor de logs por paso (`::group::` plegado, texto plano con marcador de línea,
   varios métodos de expandir el fold) perdieron más tiempo que el que tomó darse
   cuenta de que `$GITHUB_STEP_SUMMARY` evita el problema por completo.

---

## 2026-08-02 · Ola 1 CERRADA — motor autónomo encendido, Olas 2-4 en marcha

Corridas CI #9 (`a4388bc`) y #10 (`25d2f18`) también dieron VERDE — **3 de 3 corridas
verdes en 3 commits distintos**, cumpliendo la última de las cuatro condiciones de
`docs/PROMPT_CORRECTIVO.md` §9.4. Las cuatro:

1. ✅ `check.sh --full` sin pasos saltados (verificado local, múltiples corridas)
2. ✅ Los 5 mutantes de control del Anexo B ponen el gate en rojo (`campana.mjs --had` 100%)
3. ✅ CI verde en 3 commits distintos (corridas #8, #9, #10)
4. ✅ `lock.sh` rebota con exit 7 (cubierto por `prueba-arnes.sh` §3)

**Bloqueo de credencial compartida con eauto, resuelto por Alexis.** Antes de encender
el motor se encontró `com.eauto.ralph-loop` corriendo en vivo — mismo OAuth, mismo
maestro exige un solo motor a la vez. Se investigó su actividad real (sin tocar nada)
antes de preguntar: llevaba corriendo desde el 1-ago 09:33, con commit real el 1-ago
21:07 (`AC-21-11`), así que no era un proceso olvidado. Presentadas las implicaciones a
Alexis, decidió detener eauto para priorizar KiloPan. Se usó el mecanismo de pausa
propio de eauto (marker `~/.eauto-ralph/PAUSED-FOR-REVIEW`, no un `kill -9`) —
`watchdog.sh` de eauto lo respetó, `launchctl` no lo revivió (`KeepAlive.SuccessfulExit:
false` + salida limpia tras ver el marker). Verificado con `launchctl list` que
`com.eauto.ralph-loop` quedó con pid `-` de forma estable, no solo un instante.

**Encender `com.kilopan.ralph-loop` reveló dos bugs reales, nunca antes probados de
verdad** — el propio `packages/metodo/launchd/README.md` decía "escrito y con sintaxis
probada" pero nunca se había cargado con éxito hasta hoy:

1. **`launchctl bootstrap` fallaba con "5: Input/output error"** sin señalar causa. Dos
   causas combinadas: (a) al plist le faltaba `<!DOCTYPE plist ...>` —
   `plutil -lint` lo daba por válido porque es permisivo, pero el parser real de
   `launchctl` no; comparado contra un plist de eauto que sí carga para encontrarlo. (b)
   el label había quedado `disabled` a nivel de dominio launchd de un intento anterior
   (independiente del archivo plist) — `launchctl print-disabled` lo mostró,
   `launchctl enable` lo liberó.
2. **El motor arrancó y el primer AC que tomó salió "sin-id".** Los 28 ítems que esta
   sesión agregó a `IMPLEMENTATION_PLAN.md` (auditoría Anexo D) citaban su AC como texto
   plano (`AC-SEC-05`) en vez de `[AC-SEC-05]` — `loop.sh` extrae el id con
   `grep -oE '\[AC-[A-Z0-9-]+\]'`, así que sin corchetes el prompt al agente quedaba con
   "CITÁ el id del AC ()" vacío. Es exactamente el modo de falla que el propio prompt de
   `loop.sh` advierte por escrito ("sin esa cita, verify-refs --estricto ve un [x] sin
   respaldo... el motor queda girando en falso"). Corregido con un script que envuelve
   el id en corchetes en las 28 líneas, verificado con `gate_specs`/`verify-refs
   --estricto` (77 ACs · 34 cerrados · 43 abiertos, ambos VERDE), motor reiniciado —
   segunda corrida tomó `AC-SEC-05` con id correcto.

**Estado al cierre de esta sesión:** `com.kilopan.ralph-loop` corriendo (pid verificado
con `launchctl list`), trabajando `AC-SEC-05` como primer AC de su primera iteración
real. Repo principal (`~/kilopan-monorepo`, rama `main`) adelantado a `origin/main`
(`12eca7d`) antes de encender el motor.

**Hueco real para la sesión siguiente, no resuelto hoy:** `loop.sh` comitea
**localmente, nunca empuja**. Sin un paso que revise y empuje lo acumulado, el trabajo
del motor no llega a CI ni a `origin/main` por sí solo — alguien tiene que supervisarlo
periódicamente. Además, el backlog actual de 43 ACs abiertos es trabajo real de KiloPan
(muchos ya corresponden a alcance de Ola 3/4 — p. ej. `AC-DASH-06` es literalmente la
pantalla de auditoría que pide Ola 3, `AC-H0-10` es el AA/axe que pide Ola 4), pero **la
Ola 2 (pantalla "Arreglar", reparación de datos históricos) todavía no tiene ningún AC
escrito en el plan ni en las specs** — se buscó explícitamente (`grep -i "arreglar"`) y
no hay nada. Antes de que el motor pueda tocar Ola 2 de verdad, alguien tiene que
traducir `docs/PROMPT_CORRECTIVO.md` §4/§5 en ACs concretos — el motor construye, no
planifica.

**Aprendizaje de esta ronda:** el mismo patrón se repitió una tercera vez el mismo día,
ahora en infraestructura en vez de en código: "sintaxis probada" (`plutil -lint`,
`bash -n`) no es lo mismo que "funciona de verdad" — cada capa de este sistema que
nunca se ejecutó de punta a punta tenía al menos un defecto esperando a un primer
arranque real para aparecer. La lección de Ola 1 completa, en una frase: no hay verde
que valga sin haberlo corrido de verdad, ni una vez.

---

## 2026-08-02 (noche) · El motor giró media hora sin avanzar: cuatro bugs, no uno

Primera sesión de supervisión del motor autónomo tras encenderlo. El HANDOFF decía
«debería estar corriendo trabajando el backlog de 43 ACs». Estaba corriendo, sí — y no
había cerrado ni un solo AC. `launchctl list` mostraba un PID vivo, que es exactamente la
señal que `docs/LECCION_RALPH.md` prohíbe leer como avance.

**Lo que se veía:** desde las 18:49 hasta las 19:18, seis iteraciones idénticas eligiendo
`AC-SEC-05`, todas «SIN AVANCE», y tres reinicios completos del watchdog en el medio. Con
`--max-budget-usd 3` y hasta 3 invocaciones por ciclo, media hora de eso cuesta dinero
real sin producir una línea de código.

**El primer diagnóstico era el equivocado.** El log del watchdog decía que el gate
independiente había dado ROJO sobre `69c6eb9` — el commit que cerró la Ola 1, ya empujado
a `origin/main`. Parecía que `main` estaba roto. Corrido `check.sh --full` sobre ese mismo
HEAD con el árbol **limpio**: VERDE, 0 fallas, 0 pasos saltados. `main` nunca estuvo roto.
El rojo lo producía el árbol sucio que el propio motor dejaba, y el gate no distingue
entre «el commit está mal» y «hay basura sin comitear encima».

**Los cuatro defectos, que solos son molestos y juntos hacen un bucle infinito:**

1. **`loop.sh` no limpiaba el árbol entre iteraciones.** Cuando el agente no logra verde
   NO comitea —así se le pide, y hace bien—, pero su trabajo a medias queda puesto. La
   iteración siguiente lo hereda y su gate arranca rojo por código que ella no escribió:
   no puede dar verde jamás, por mucho que trabaje. Cada intento envenenaba al siguiente.
2. **`watchdog.sh` salía con `exit 1` en todos sus ABORT**, incluidos los que dicen
   literalmente «NO reintentar solo» — y el plist tiene `KeepAlive/SuccessfulExit=false`,
   que interpreta cualquier salida no-exitosa como «relanzalo». launchd resucitaba el
   motor a los 120 s. El pedido de intervención humana lo pisaba la máquina.
3. **`siguiente_ac()` usaba `grep -m1`**: devuelve SIEMPRE el primer AC abierto. Un AC que
   el motor no puede cerrar tapa a todos los que vienen detrás, para siempre. `AC-SEC-05`
   —que exige migrar el secreto de dispositivo a IndexedDB, volviendo asíncrona una API que
   consumen 3 páginas y 6 specs e2e— bloqueaba a los otros 41.
4. **`.ralph/build-fails` no lo escribía nadie.** `model-selector.sh:64` lo lee para
   escalar a Opus tras 2 strikes; el único que lo tocaba era su propio test en
   `prueba-arnes.sh`. La escalación existía en el selector y no podía dispararse nunca.
   De haber funcionado, `AC-SEC-05` habría escalado a Opus en el tercer intento.

**Lo que se arregló, cada guard con la prueba que demuestra que dispara** (§3b nueva de
`prueba-arnes.sh`, 43 verdes / 0 rojos): el árbol sucio se guarda en `git stash` —jamás se
borra, «no revertir solo» vale también para el trabajo que el motor no alcanzó a
terminar—, excluyendo lo que está sucio por construcción (`panel/`, y `next-env.d.ts` que
Next reescribe en cada build alternando `.next`/`.next-e2e`); todo ABORT escribe
`panel/PAUSA-REVISION` y sale con 0, marcador que launchd no puede pisar y que frena
también los arranques futuros hasta que una persona lo borre; un AC que falla 3 veces se
anota en `panel/acs-atascados.txt` y el motor sigue con el siguiente, sin marcarlo `[x]` ni
tocar su spec —queda abierto, solo deja de ser el tapón—; y `loop.sh` ya escribe los
contadores de strikes.

Se agregó `KILOPAN_DRY_RUN=1` a `loop.sh` (elegir el AC y parar, sin tocar el árbol ni
correr el gate ni invocar al agente) porque la prueba del salteo necesitaba ejercer la
función de verdad: una suite que gasta US$3 de `claude -p` cada vez que corre el gate no
se corre nunca, y un guard que nadie ejercita es indistinguible de uno roto.

**Aprendizaje:** los cuatro son la misma falla de fondo que la Ola 1 ya había documentado
dos veces —«sintaxis probada» no es «funciona de verdad»— pero en su forma más cara: el
motor tenía tres mecanismos de seguridad correctamente escritos (tope de iteraciones,
corte por falta de avance, escalación de modelo) y **ninguno de los tres podía cumplir su
función**, porque nada los había ejercido nunca contra el caso real. El tope de
iteraciones se reseteaba con cada relanzamiento de launchd; el corte por falta de avance
pedía un humano que la máquina ignoraba; la escalación leía un contador que nadie
escribía. Un guard que jamás dispara es indistinguible de uno roto — y tres guards que
jamás disparan se ven, desde afuera, exactamente igual que un motor sano.

---

## 2026-08-02 (noche, cont.) · La causa raíz: el agente se detectaba a sí mismo como builder rival

Con los cuatro defectos anteriores arreglados, primera iteración de prueba controlada
(`KILOPAN_MAX_ITERACIONES=1`, a mano, no bajo launchd). Resultado: **SIN AVANCE otra vez**,
68 s, US$0,50, cero líneas escritas. Pero ahora el log servía para algo, y el
`ultimo-resultado.json` traía la respuesta textual del agente:

> «Encontré un conflicto duro con la regla de AGENTS.md ("UN builder por worktree"): ya hay
> un `loop.sh` corriendo ahora mismo en este mismo directorio (PID 71055) […] Por regla dura
> no debo construir aquí mientras ese motor esté vivo. […] ¿Cuál preferís?»

El `loop.sh` que encontró **era el que lo había lanzado a él**. `AGENTS.md` manda —con toda
razón— verificar `ps aux | grep loop.sh` antes de construir, para no repetir el 26-jul-2026
en que dos sesiones construyeron a la vez. El agente obedeció la regla al pie de la letra
contra su propio proceso padre. Y encima preguntó cuál de tres caminos tomar, corriendo bajo
`claude -p`, donde no hay nadie del otro lado: la iteración se consumía en una pregunta que
nadie iba a leer.

**Deadlock determinista al 100%. Esto —y no la dificultad de ningún AC— es la razón por la
que este motor nunca cerró un solo AC desde que existe.** Todo lo que hay en `main` lo
escribieron sesiones supervisadas. La regla estaba bien redactada; lo que nunca ocurrió es
que alguien la leyera desde adentro del proceso que la regla describe.

Arreglado en los dos lugares: `AGENTS.md` (fuente durable) aclara que si a vos te lanzó
`loop.sh`, ESE proceso sos vos y no te frena; y el prompt de `loop.sh` abre con un bloque
CONTEXTO DE EJECUCIÓN que lo dice explícito —con el pid del padre— y avisa que corre no
interactivo, que preguntar equivale a perder la iteración.

**Un séptimo defecto salió al arreglar el cuarto.** Las pruebas de ruteo del selector de
modelo no eran herméticas: pasaban sólo porque `.ralph/build-fails` NUNCA existía. Con el
contador ya vivo, un fallo real lo dejó en 1 y «ítem de UI» pasó a rutear a Sonnet en vez de
Haiku — el selector hacía lo correcto (un fallo ⇒ piso Sonnet) y era la prueba la que
mentía. Peor: la suite **borraba** el contador al terminar, así que con la escalación por fin
viva, cada corrida del gate le habría regalado al motor un «cero strikes» y la escalación no
se habría disparado nunca en producción. El mismo bug entrando por la puerta de atrás. Ahora
se guarda y se restaura.

**Error de operación propio, vale anotarlo:** se lanzó el motor con las correcciones aún sin
comitear en el árbol. Su primera acción fue —por el guard recién escrito— stashear el árbol
sucio, incluido el arreglo, y correr con el prompt viejo. Nada se perdió (el guard stashea,
jamás borra: se recuperó con `git stash pop`), pero la secuencia correcta es comitear primero
y encender después. Con el motor activo, el repo principal no se edita: eso es ahora una
consecuencia mecánica del diseño, no una convención.

**Aprendizaje:** de siete defectos encontrados en una tarde, seis eran molestos y uno era
mortal — y los seis molestos disfrazaban al mortal de «AC difícil». La señal que lo delató no
fue ninguna métrica del panel ni el código de salida: fue leer lo que el agente **dijo** en
`ultimo-resultado.json`. Un motor que reporta «SIN AVANCE» sin que nadie lea su respuesta en
prosa es un motor que puede estar bloqueado por una razón trivial durante días.

---

## 2026-08-03 (madrugada) · El día se partía a las 20:00, y la cadena autónoma ya no se corta

Tres frentes en una tanda: el bug que ponía CI en rojo todas las noches, las medidas para
que las Olas no se detengan, y la planificación de Ola 2 que el motor no puede hacer.

**El bug de CI no era flakiness, y no lo causaron los commits de la tarde.** Las corridas de
22:39, 23:47 y 23:57 UTC pasaron; las de 00:09 y 00:17 fallaron. El corte era medianoche
UTC — las 20:00 de Chile. `db.ts` fija `timezone=America/Santiago` en su conexión, con
guard, «porque si no el día se corta a las 20:00». `db/migrar.mjs` —que corre las
migraciones y, vía `sembrar.mjs`, la semilla— no lo hacía: heredaba la del proceso. En un
Mac chileno coincide por casualidad y todo se ve bien; en el runner de Ubuntu (UTC) no.
Medido en vivo a las 00:33 UTC: `TZ=(sistema)` → `current_date=2026-08-02`; `TZ=UTC` →
`2026-08-03`. Como `pan.precios.vigente_desde` tiene `default current_date`, la semilla
escribía el precio con fecha de mañana y la app consultaba `vigente_desde <= current_date`
de hoy: falso, producto sin precio, y caían los tres tests de venta. **No es cosa de
tests:** sembrar o migrar de verdad en esa franja escribe el día equivocado.

El diagnóstico correcto llegó por descarte disciplinado, no por corazonada: el clon fresco
daba verde (así que no era estado local), `fullyParallel:false` y `workers:1` mataban la
hipótesis de carrera entre specs, y `camino-dorado` corre PRIMERO — así que el spec nuevo,
que se ordena después, no podía ser la causa. Lo que lo destapó fue mirar la hora de las
corridas.

**Las Olas no se detienen: tres cortes de autonomía, cerrados.** (a) Nadie empujaba lo que
el motor comiteaba —el agente no tiene permiso de `git push`, decisión de Alexis— así que
CI no veía nada hasta que una persona lo empujara a mano; ahora lo hace
`empujar-si-verde.sh` desde el watchdog, con una sola regla verificable: sólo si
`last-green.sha == HEAD`, o sea sólo el HEAD que el gate INDEPENDIENTE acaba de declarar
verde. Publica el supervisor, jamás el agente. (b) El motor se apagaba al llegar a su tope
de iteraciones y esperaba a una persona; `StartInterval` lo relanza cada 30 min sin
desarmar ningún freno, porque un ABORT real escribe `PAUSA-REVISION` y ese marcador hace
que todo arranque posterior salga sin construir. (c) Sin trabajo, `loop.sh` salía 0 y el
watchdog gastaba un gate completo al vacío; ahora sale 6 = DONE.

**Un bug propio, y del peor tipo:** las pruebas del marcador de pausa escribían en el panel
VIVO y corrían el watchdog real contra él. Ensuciaban `watchdog.log` con «EN PAUSA» falsos
—que me hicieron dar por detenido a un motor que estaba trabajando— y podían pausar el
motor de producción si el gate coincidía con el arranque de una iteración. Un test que
puede apagar el sistema que vigila no es un test. `KILOPAN_PANEL_DIR` redirige el panel y
se afirma por mtime que el vivo no se escribió, igual que ya se hacía con el `.env.local`.

**Ola 2 planificada: 13 ACs nuevos.** Al escribirlos aparecieron dos cosas que sólo se ven
mirando. Primero, **§4 ya estaba hecho**: `0017_fiado_mostrador_suma_saldo.sql` y
`0018_turnos_cierre_caja.sql` cubren el modelo de datos entero, con numeración corrida
respecto del documento porque en el medio entró el bloqueo de PIN — o sea Ola 2 **no
necesita migraciones nuevas** y el motor puede construirla casi completa solo. Segundo,
`AC-H0-11` ya especificaba los cuatro estados de listado **y** el deshacer de 8 s
empaquetados: escribir ACs nuevos habría creado duplicados. Se partió en dos, que es lo que
manda la propia regla del proyecto para un AC a medias. Sólo `AC-ADM-11` —la reparación de
datos históricos con informe firmado por la dueña— queda fuera del motor, anotado en
`acs-atascados.txt` para que no tape a los demás.

**Aprendizaje.** Alexis lo dijo en una línea a mitad de la sesión —«deja de suponer cosas y
comprueba siempre»— y tenía razón con evidencia: horas antes yo había afirmado que `main`
estaba rojo porque el watchdog lo decía (corriendo el gate sobre el mismo HEAD con árbol
limpio: verde), y había dado por bueno un «gate verde» de corridas donde el motor sostenía
el lock y mi propia prueba del salteo se iba por su rama de escape. Ninguna de las dos era
mentira deliberada; las dos eran una conclusión sin ejecutar la comprobación. En esta tanda
todo lo afirmado lleva su evidencia: la zona horaria se midió con las dos TZ, el guard se
probó EN NEGATIVO quitando el arreglo, la aislación del panel se afirmó por mtime, y el
empujador se ejerció de punta a punta contra `origin/main`.

---

## 2026-08-02 (noche, cierre) · Dos frenos con el mismo umbral se pisaban entre sí

`AC-ADM-04` —el primer AC de Ola 2 que el motor tocó, la pantalla `/arreglar`— falló tres
veces (con escalación a Opus en el tercer intento, la primera vez que esa escalación se
disparó en producción) y el motor se pausó.

El mecanismo de salteo funcionó: `AC-ADM-04` quedó anotado en `acs-atascados.txt`
correctamente. Pero `watchdog.sh` cuenta fallos consecutivos GLOBALES, y como
`siguiente_ac()` reelige el mismo AC hasta que queda atascado, sus 3 fallos consecutivos
son siempre también 3 fallos consecutivos para el watchdog — los dos umbrales valen 3.
El salteo marcó el AC y el motor se pausó en la misma vuelta de todos modos: «sigo con el
siguiente AC» nunca llegó a probarse. No había pasado antes porque hasta esta noche ningún
AC real había fallado 3 veces seguidas sin que además se cayera infra (rc 3) o hubiera otro
builder (rc 7) de por medio.

Arreglado con un código de salida nuevo: `loop.sh` sale con `rc 9` —no `rc 1`— exactamente
en la iteración donde un AC cruza su propio tope y queda marcado atascado. `watchdog.sh`
lo reconoce como progreso estructural (el motor ya sabe qué va a intentar distinto) y
resetea su contador en vez de sumarlo. Probado con ejecución real contra un stub
(`KILOPAN_LOOP_CMD`, mismo patrón que `KILOPAN_DRY_RUN`), no solo grep: un `rc 9` resetea
el contador, tres atascamientos seguidos NO pausan, y —regresión— tres fallos GENÉRICOS
(sin AC de por medio) siguen pausando igual que antes.

**Autocorrección en el camino, vale contarla porque casi se la paso a Alexis:** al
investigar creí haber encontrado un segundo bug — una llamada a `watchdog.sh` en la propia
suite sin `KILOPAN_PANEL_DIR`, con riesgo de haber corrido contra el panel de producción.
Lo probé SUELTO, fuera del script, y sí tocaba el panel real. Pero dentro del script hay un
`export KILOPAN_PANEL_DIR` unas líneas antes que se hereda en todo lo que sigue — mi prueba
aislada simplemente no tenía ese export en el entorno. Releer el contexto completo antes de
afirmar encontró el error propio antes de decirlo. Se verificó que no hubo daño real (sin
procesos huérfanos, sin commits inesperados, lock libre). El defecto real, más chico:
una aserción comprobaba «no existe PAUSA-REVISION» en vez de «no cambió», y por eso se
ponía roja cada vez que el motor está genuinamente pausado — exactamente lo que estaba
pasando mientras se escribía este arreglo. Corregido al mismo patrón antes/después que ya
usa el chequeo de mtime.

prueba-arnes: 73 verdes / 0 rojos, corrida CON el motor real todavía pausado — la prueba de
regresión de la aserción corregida se validó contra el caso real, no uno simulado. Gate:
check.sh --full VERDE, 0 saltados.

**Aprendizaje:** el mismo patrón de toda la noche, otra vez — un guard (el salteo de ACs
atascados) estaba bien escrito y nunca se había ejercido contra el caso real hasta que un
AC de verdad falló 3 veces. Y la corrección de esta sesión sobre la propia suite de
pruebas —parar antes de afirmar un segundo bug, releer el contexto completo, encontrar que
la reproducción aislada no era equivalente al script real— es la instrucción que Alexis dio
explícita esta misma noche: no suponer, comprobar siempre.

---

## 2026-08-03 (madrugada) · El motor violó una regla dura — nunca implementada como código

`AC-ADM-05` (anular una venta) cerró con un commit que escribía
`db/migraciones/0020_anular_venta.sql`. `docs/PROMPT_CORRECTIVO.md` §7 lo prohíbe en
letra grande: «El motor autónomo jamás: escribe en `db/migraciones/`... Migraciones y
despliegue son de sesión supervisada, siempre.» La regla existía desde el maestro
original — nunca como guardrail. El mismo patrón de toda la noche, en su forma más
seria: una prohibición que solo era prosa hasta que el caso real la cruzó.

El motor se detuvo a mano en cuanto se encontró (no había ningún guard que lo frenara
solo). Arreglado: `loop.sh` compara `HEAD~1..HEAD` contra `db/migraciones/` justo
después de cada commit propio; si toca esa carpeta sale con `rc 10` (código propio,
distinto de atascado/sin-avance), y `watchdog.sh` pausa TODO el motor —no solo saltea
el AC— porque ya hay una migración real sin supervisión comiteada y alguien tiene que
mirarla antes de que se construya algo más encima. Probado con ejecución real: un
commit fabricado en un clon descartable (nunca el historial de este repo) confirma que
el comando de detección dispara.

**La migración ya publicada queda pendiente de revisión de Alexis, explícitamente — no
se revirtió ni se dio por buena unilateralmente.** El contenido parece correcto
(aditiva, con reversión, sigue el patrón append-only de `saldado_at`/0017, `CHECK` que
respalda la exigencia del motivo en la BD) y el gate independiente la verificó, pero
esa evaluación técnica no es la misma decisión que la regla reserva para el dueño.

prueba-arnes: 77 verdes / 0 rojos. Gate: check.sh --full VERDE, 0 saltados. Motor
detenido a propósito al cierre de esta entrada — no relanzar sin la decisión de Alexis
sobre la migración.

**Aprendizaje:** de todos los guards que resultaron ser solo prosa esta noche —el
salteo de ACs, el marcador de pausa, la escalación de modelo—, este es el único que
tocó algo con consecuencia real fuera del propio repo (un cambio de esquema). El costo
de una regla no implementada no es uniforme: depende de qué protege.

## 2026-08-06 · Reconciliación plan↔specs + guard anti-deriva (sesión externa, Fable 5)

El conteo por líneas del plan (69/45) divergía del gate (50/44). Análisis Fable 5
(informe en /tmp/informe-acs-kilopan.md): 21 ACs con DOBLE checkbox (Anexo D y Ola 2
re-listaron sin tocar el original), 2 ACs cerrados solo en spec (PES-06, VEN-03), 1
checkbox sin AC (F23), y el rótulo «Cerrado» de AC-H0-11 en la spec 09 colgando de un
checkbox abierto. La aritmética cierra exacta: 114 = 94 − 2 + 21 + 1. No había
divergencia de fondo — doble contabilidad de historia. Correcciones en `5f1d344`
(plan espeja specs: 50/44) y este commit: regla 5 del gate — máx 1 checkbox por AC en
el plan y estado espejado a la spec, probada contra fixture (dup ⇒ ROJO, mismatch ⇒
ROJO, espejo ⇒ VERDE). La cifra oficial de avance es la del gate: 50/94 (53%).
También hoy: motor reanudado tras 2 días de PAUSA-REVISION (11 stashes archivados
como tags archivo-wip/*, lista vaciada — nada borrado) y motor de eauto detenido por
orden del dueño (solo arnés de construcción; Postgres y mail-worker intactos).

## 2026-08-06 · Tres bugs del arnés destapados por commits externos a mitad de iteración

Los commits `5f1d344`/`e32327e` (reconciliación plan↔specs, sesión externa) aterrizaron
con la iteración 2 en curso y destaparon en cascada: (B3) el loop acreditó esos commits
como «avance de AC-DES-04» — delta ciego de commits, sin filtrar por AC; (B1) ese falso
avance gatilló la re-verificación independiente del watchdog, que corría sobre el ÁRBOL
(con el WIP del builder), no sobre HEAD; (B2) el grep anti-cáscaras sin frontera de
palabra marcó «TODOS los DTE» (art. 55, español legítimo) como TODO en 3 archivos del
WIP ⇒ guardrail FALLÓ ⇒ PAUSA con HEAD sano. Correcciones, cada una probada contra su
caso: guardrail con `grep -w` (+ caso 2a en prueba-arnes: TODOS no dispara, TODO sí);
watchdog aparta el WIP en stash marcado antes de verificar HEAD; loop atribuye avance
SOLO a commits que llevan `[AC-ID]` en el mensaje (externos se declaran, no se
acreditan). prueba-arnes: 95 verde / 0 rojo. REGLA NUEVA para sesiones externas: al
monorepo se commitea con el motor PAUSADO, nunca a mitad de iteración.

## 2026-08-06 · Migración 0024: bultos + gate de carga (destrabe supervisado de AC-DES-04)

El motor declaró DOS veces, con razón, que F3 era inconstruible sin esquema de bultos
— y tiene vedado escribir migraciones. Sesión supervisada aplica 0024: pan.bultos
(nacen SOLO por pan.generar_bultos al cerrar el pedido, código determinista
P<correlativo>-<n>), pan.cargar_bulto (duplicado ⇒ «ya escaneado» ⇒ 409 ⇒ banner
ámbar), inmutabilidad total por trigger + sin grants de escritura (defensa doble), y
trg_ruta_exige_bultos_cargados: «Salir a ruta» con pendientes rebota salvo override
motivo+usuario en el MISMO update, que queda en pan.eventos. Compatible hacia atrás
(pedido sin bultos no gatilla el gate). test-invariantes: 81/0. Nota de implementación
agregada a specs/kilopan/04. Strikes de AC-DES-04 reseteados: el bloqueo era real y ya
no existe — el próximo intento parte limpio.

## 2026-08-06 · Anti-Sísifo: tope $3→$6 + el builder recupera su propio stash

AC-DES-04 murió dos veces por agotamiento de presupuesto con el trabajo encaminado: el
WIP iba al stash y la iteración siguiente partía de CERO sin saber que su avance estaba
guardado. Dos ajustes en loop.sh: tope por iteración 3→6 USD (el freno contra el gasto
en círculo son los 3 sin-avance + el marker, no el tope), y una instrucción nueva en el
prompt del builder: revisar git stash list y recuperar el motor-wip de su propio AC
antes de re-implementar. Regla que queda: si un AC no cabe en $6 × 3 intentos, se PARTE
— no se sube el tope de nuevo.

## 2026-08-06 · AC-DES-04 partido en cuatro (regla aplicada: no cabe en $6×3 ⇒ se parte)

Dos intentos con $6 produjeron trabajo real (API + 106 líneas de UI en stashes) sin
llegar al commit: F3 completo no cabe en el sobre de una iteración. Partición
supervisada: DES-04 queda redefinido como la capa de BD (0024, ya construida y
probada — cerrado con evidencia); DES-05 = API HTTP (generar/escanear/estado N/M);
DES-06 = pantalla /cargar con captura manual y la única modal; DES-07 (P2) = escáner
de cámara como mejora progresiva. Gates verdes: 97 ACs (51/46), espejo plan↔spec
validado por la regla 5. DES-04 removido de atascados; sus strikes borrados. El
builder tiene 3 stashes motor-wip con avance rescatable para DES-05/06.

## 2026-08-06 · El builder moría esperando su propio gate + sobre de permisos afinado

Evidencia capturada (ultimo-resultado.json de DES-05): 6 permission denials en una
iteración — incluidos el «git stash show -p» que el propio prompt ordenaba (no estaba
en la allowlist) y compuestos con cd/heredoc que no calzan patrón — y el mensaje final
del builder: «I'll wait for the background gate task to complete and report back»:
lanzó check.sh en background y terminó la sesión «esperando» — en modo -p no hay turno
siguiente; murió con el trabajo listo y sin commit. Fixes: allowlist suma git stash
show*/apply* (drop/clear siguen denegados); el prompt enseña el sobre (comandos
simples, sin cd/;/&&/heredoc) y prohíbe gate en background o terminar «esperando» —
check.sh en primer plano y commit en el mismo turno.

## 2026-08-06 · El gate independiente pilló un cierre prematuro (separación de poderes en acción)

El builder cerró AC-DES-06 en la spec con sus DOS e2e nuevos ROJOS (GET
/api/bultos?rutaId responde not-ok — desajuste de contrato con la API de DES-05) y sin
espejar el plan. La regla 5 (instalada hoy) puso el gate en rojo por el desync, y el
check --full del watchdog pilló los e2e — el quick del builder no los corre. El rojo de
prueba-arnes era arrastre del mismo desync. Corrección supervisada: DES-06 reabierto
con nota (el código EXISTE — commit 6100516 — faltan sus e2e verdes) y dos reglas
nuevas en el prompt: spec+plan en el mismo commit o rojo, y un AC cuyo texto exige e2e
se cierra SOLO con ese e2e corrido en primer plano.

## 2026-08-06 · Segundo rojo de DES-06: semilla con RUT inválido + contrato de captura manual sin definir

El gate independiente volvió a frenar el segundo intento de DES-06 por DOS causas:
(1) preparar-base.mjs sembraba 'Eva Entrega' con RUT 12.222.222-1 (módulo 11 exige
DV 5) — la siembra moría contra usuarios_rut_valido y el webserver de Playwright no
arrancaba (corregido a -5; el commit del builder además trackeó loop.pid, destrackeado
y agregado a .gitignore del panel). (2) Con la semilla viva, los e2e igual fallaban por
una AMBIGÜEDAD real de producto: el teclado propio es numérico y el código es P<n>-<m>
— la captura manual no podía escribirlo, y el test esperaba un input del sistema que
Miga prohíbe. Decisión supervisada fijada en la spec: tecla «−» + prefijo «P»
automático; los e2e operan los botones del teclado propio. Implementación: del motor.

## 2026-08-07 · Cierre supervisado de AC-DES-06 (el trabajo del motor, el commit del supervisor)

Tres iteraciones completaron la pantalla F3 sin alcanzar el commit dentro del sobre
(la última dejó TODO terminado en stash: tecla «−» en TecladoNumerico, prefijo P,
override en el mismo update de /api/rutas/salir, modal sobre la BarraPestanas, guía
DTE en el e2e, spec y plan espejados). Sesión supervisada: stash aplicado, e2e
corridos DE VERDAD (2 passed), gate_specs verde 53/44, check rápido verde, 11 stashes
archivados como tags (tanda b), DES-06 desatascado. Pendiente estructural anotado: el
sobre de $6 queda corto cuando el AC exige iterar e2e de UI — considerar sobre por
TIPO de AC o e2e dirigido en el quick para ACs de pantalla.

## 2026-08-07 · Sobre de presupuesto por tipo de AC

DES-06 y DTE-03 repitieron el mismo patrón: 2 iteraciones Sonnet muertas a centímetros
del commit + cierre por Opus en la 3ª — tres sobres para pagar uno, porque el ciclo
escribir→e2e→corregir→e2e de un AC de pantalla cuesta más que uno de API. loop.sh
ahora detecta AC de UI+e2e por su línea (e2e|pantalla|zxing|escáner|cámara|modal|
banner) y amplía el sobre a $10 (KILOPAN_MAX_BUDGET_USD_UI). El freno contra el gasto
en círculo sigue siendo el watchdog + marker.

## 2026-08-07 · DASH-05: el e2e pasaba el ROL donde el helper espera RUT

El gate independiente frenó DASH-05: su e2e llamaba ingresar(page, "admin", pin) contra
el helper compartido cuya firma es (page, rut, pin) — llenaba el campo RUT con la
palabra «admin» y moría en /ingresar. Una línea: datos.usuarios.admin.rut. El e2e pasa
(1 passed); prueba-arnes 95/0 (su rojo era arrastre). Nota: los siete specs viejos usan
un ingresar() local con firma (page, rol) — la dualidad de firmas es una trampa
conocida; el helper compartido documenta que es el destino cuando alguien los toque.

## 2026-08-07 · DASH-06 rojo: SSR de Leaflet + e2e con flujo inventado (cierre supervisado)

Cuatro defectos en el commit de DASH-06, todos pillados por el gate independiente y
corregidos supervisadamente: (1) react-leaflet importado directo en el server component
del dashboard — «window is not defined» reventaba TODO el dashboard en SSR; envoltorio
cliente MapaPodsDiaCliente con dynamic ssr:false. (2) TS18048 por Record indexado sin
noUncheckedIndexedAccess-safety en los dos specs nuevos (y en el fix de anoche): admin!.
(3) auditoria.spec enrolaba contra un placeholder inventado (pin-secreto-en-IndexedDB)
en vez de los helpers compartidos — reescrito con sembrarDispositivo+ingresar.
(4) selectores ambiguos (getByText Usuario/Dispositivo matcheaba el h2) y tabla asertada
sin contemplar el estado vacío legítimo de Miga. typecheck limpio; e2e 3/3 passed.

## 2026-08-07 · PERF-05 rojo: selector fantasma y fixture request sin sesión

Dos bugs de test en el commit del builder, pillados por el gate independiente:
(1) selector div[style*="tarjeta"] que no existe y no contemplaba el estado vacío de
Miga — reemplazado por contenido real o «Sin entregas para mostrar.»; (2) el test del
endpoint usaba el fixture `request` pelado (sin cookies de sesión → 401) en vez de
page.request. e2e 7/7 passed.

## 2026-08-07 · Mantención: tanda c de stashes + checklist de e2e en el prompt

Tercera tanda de stashes archivada como tags (11, archivo-wip/c-*). El prompt del
builder gana el checklist de e2e destilado de los rojos de la noche: helpers
compartidos con RUT (no rol), page.request con sesión, estado vacío con .or(),
selectores reales con exact, y browser-only con dynamic ssr:false. Cola supervisada al
momento: ADM-11, H0-11, H0-12, DASH-08, H0-10, H0-14 (este último requiere VoiceOver
con humano — partición hecha por el propio builder).

## 2026-08-07 · Falsa pausa: mi propio filtro de atribución (B3, anoche) rechazaba commits sin corchetes

El motor pausó por «3 sin avance» que eran 2 falsos negativos: AC-ID-07 (f783ae2) y
AC-DASH-02 (d13ec79) se cerraron BIEN (specs+plan [x], e2e verdes, gate 63/98) pero el
filtro de anoche exigía `[AC-ID]` con corchetes literales, y el builder de hoy escribe
`test(x): AC-XX-NN — ...` sin corchetes al inicio. Ningún dato se perdió ni quedó mal
marcado — solo se quemaron 2 de los 3 strikes por una detección de texto, no por un AC
atascado de verdad. Corregido: grep -E con corchetes OPCIONALES (`\[?AC-ID\]?`), acepta
ambos estilos. Probado contra los 2 commits reales + 1 caso negativo.

## 2026-08-07 · Mantención: tanda d de stashes (44 archivados en total)

Cuarta tanda archivada como tags (11, archivo-wip/d-*). Gate en 65/98 (66%). Cola
supervisada en 9 ACs. Patrón de la mañana: el motor sigue sano con el filtro de
atribución corregido — los "sin avance" son intentos reales, no falsos negativos.

## 2026-08-07 · Rojo transitorio en AC-ADM-02 (no era un bug)

El gate independiente marcó ROJO por ENOENT leyendo 0019_ruta_exige_dte_tipo_valido.sql
durante el test de invariantes. Verificado: el archivo existe, su contenido es
idéntico a HEAD (mismo MD5, sin diff git), y la suite completa re-corrida a mano da
83/83 verde. Fue una condición transitoria de filesystem (mtime recién tocado, sin
cambio de contenido) coincidiendo con el momento del check — no un defecto de código
ni del commit de AC-ADM-02, que queda tal cual. Sin cambios de código; solo se
relanza el motor.

## 2026-08-07 · Mantención: tanda e de stashes (55 archivados en total)

Quinta tanda archivada (11, archivo-wip/e-*). Gate en 68/98 (69%). Cola supervisada
en 11 ACs. Motor sano, sin más falsos negativos de atribución desde el fix del
mediodía.

## 2026-08-07 · Segundo rojo transitorio (AC-ADM-09) — el check completo, no el código

El gate independiente marcó ROJO sin línea de resumen final en ultimo-check.log (se
cortó tras dos pasadas completas de invariantes 83/83 + e2e 64/64, todo verde, sin
ningún ✘). Reproducción manual de check.sh --full: 14/14 OK, 0 fallos, 0 saltados,
marcador verde-20260807-180830. El commit de AC-ADM-09 queda tal cual — segundo flake
consecutivo del propio proceso de verificación (no del código), mismo patrón que el de
esta tarde con 0019. Sin cambios de código.

## 2026-08-08 · Motor destrabado tras 14h de pausa (AC-MERM-02 reabierto)

El motor quedó pausado desde el 07-ago 21:19 por el rojo del gate independiente sobre
AC-MERM-02 — rojo REAL (no flake): su e2e fallaba de verdad. Diagnóstico supervisado
encontró 3 defectos del test, todos corregidos: (a) datos.productos es Record<nombre,
uuid> y el spec lo trataba como array (productos[0].id undefined); (b) faltaba
fotoSha256 con pesaje_foto_obligatoria=1 en la semilla (400); (c) mermar exige stock
previo — Anexo B #1 — y daba 409 con disponible 0 g (se agregó pesarAMostrador()).
Queda un cuarto: tras esas correcciones la merma se crea pero /resolver-mermas no la
lista. La pantalla y el endpoint están commiteados y sanos (111dee9); el AC se reabre
con el diagnóstico completo en su spec y entra a la cola supervisada para no bloquear
al motor, que retoma con los ~26 ACs elegibles restantes.

## 2026-08-08 · Dos rojos cerrados con causa raíz + báscula descartada + censo de producción

**AC-DASH-07:** el e2e usaba el fixture `request` pelado (sin cookies de sesión → 401)
en vez de `page.request`. 5/5 verdes.

**AC-MERM-02 (causa raíz real, no el 4to defecto que quedó pendiente esta mañana):**
`GET /api/pesajes` no traía `estado_merma` en el SELECT — la pantalla filtraba contra
`undefined` y nunca listaba nada. Una columna. Pantalla, endpoint y trigger estaban
sanos desde el principio. 4/4 verdes.

**Báscula Bluetooth (decisión del dueño): descartada.** `apps/kilopan/src/comun/
bascula.ts` eliminado (77 líneas, cero referencias). Motivo verificado: Safari no
implementa Web Bluetooth en ningún iOS — el equipo real del cliente (iPad/iPhone)
nunca habría podido usarlo — y las básculas chilenas (Toledo/CAS/Torrey) usan
protocolo serie propietario, no GATT. AC-PES-05 y AC-PES-09 cerrados en spec+plan;
nota ancla en `apps/kilopan/src/app/pesar/page.tsx` para que verify-refs --estricto
tenga evidencia real en código, no solo en la spec.

**Censo de producción (autorizado por el dueño — "me pasas la clave", la obtuve yo
mismo vía `railway variables --service Postgres` con el CLI ya autenticado; consulta
en transacción READ ONLY, fuera del repo, credenciales descartadas al terminar):**
hallazgo mayor — producción tiene aplicadas SOLO migraciones 0001-0016 (última:
26-jul), el repo local va en la 0024. El fix que motivó el censo (0017, saldo de
fiado del mesón) NUNCA se desplegó. Datos actuales en producción: 6 usuarios, 9
ventas, 5 clientes, $6.000 CLP de deuda — la semilla de demo del 25/26-jul, NO
operación real de Indupan. AC-ADM-11 queda sin fundamento por ahora: no hay plata
real en riesgo. Pendiente de decisión del dueño (no ejecutado): desplegar las 8
migraciones atrasadas a producción — es una acción hacia un sistema en producción y
requiere su autorización explícita antes de tocar Railway.

Gate `check.sh --full`: 14/14 OK, 0 fallos, 0 saltados. verde-20260808-122729.
Avance: 76/98 ACs cerrados (78%).

## 2026-08-08 · Desplegadas las 9 migraciones pendientes a producción (Railway)

Por orden explícita del dueño. Diligencia previa: leídas las 8 migraciones completas
(0017-0024), sin DROP/TRUNCATE/DELETE destructivo (solo 2 DROP INDEX, recreados en la
misma transacción). Respaldo lógico de las 27 tablas pan.* ANTES de migrar (9 ventas,
5 clientes, 6 usuarios — coincide exacto con el censo de la mañana). Aplicado con
`db/migrar.mjs` (el runner oficial: una transacción atómica por archivo, aplica+
registra o revierte completo) contra `DATABASE_PUBLIC_URL` pasada por variable de
entorno del proceso — CERO cambios a `.env.local` (el dev local sigue intacto,
apuntando donde siempre apuntó). Resultado: 9 migraciones nuevas aplicadas (0016 tenía
otro nombre registrado; 25/25 en total), 0 errores. Verificación post-migración
READ-ONLY: los 7 conteos de tablas clave idénticos al respaldo (nada se perdió),
`pan.bultos` y `pan.turnos` existen, `ventas.saldado_at`/`anulada_at` existen,
`saldo_cliente` responde $6.000 (mismo total de antes — confirma que no había fiado de
mesón oculto). Credenciales descartadas al terminar; respaldo JSON conservado en
`/private/tmp/.../scratchpad/respaldo-kilopan-prod-pre-9migraciones-08ago.json`
(fuera del repo). Pendiente NO ejecutado: `railway up` (redeploy del código de la
app) — el dueño pidió las migraciones, no el redeploy; son decisiones separadas.

## 2026-08-08 · Barrido supervisado: 6 ACs atascados cerrados por rescate de archivo-wip/*

Sesión supervisada en worktree propio (`kilopan-monorepo-barrido`), sin tocar el
worktree del motor. Los 55 tags `archivo-wip/*` eran la mina: 3 de los 6 cierres
salieron de trabajo que el motor YA había escrito y perdió por agotar presupuesto
antes de commitear.

**AC-DES-03** (rescate de `d-05`): `e2e/despacho-armar-ruta.spec.ts` — evidencia
propia (pantalla + HTTP 409/200), independiente del test 8 flaky. El test del stash
esperaba un `<input placeholder="Monto total">` que AC-H0-13 ya había reemplazado
por el teclado grande; se adaptó al contrato vigente. **AC-POD-04** (diagnóstico de
`d-09`/`d-10`): la causa raíz del flake era `test.setTimeout` — 70 s de esperas
declaradas dentro del caso bajo el default de 30 s de Playwright; con 90 s, 7
corridas consecutivas verdes (8/8 cada una). **AC-ADM-08** (rescate de `e-00`):
revocar equipo (mata la sesión viva en la misma transacción) + desbloquear PIN
(borra todos los bloqueos vigentes), 4 e2e verdes disparando el bloqueo real de
AC-SEC-01. **AC-PES-08** y **AC-ADM-01**: e2e escritos de cero (outlier desde la
pantalla verificando por red que la confirmación reusa el MISMO sha256; alta/edición
de personal probada por sus efectos con login real). **AC-ADM-09** (la migración que
el motor tenía vedada): `0025_quitar_pedido_de_ruta.sql` — estado `quitada` en
`ruta_paradas` + `trg_ruta_exige_dte` partiendo de 0019 (la primera versión partió
de 0004 y revivió el hueco de la NC 61: el test P0-5 la pilló ANTES de commitear —
el arnés pagándose solo otra vez), endpoint con motivo+evento, filtros en `mi-ruta`
y `api/sync` (un POD encolado offline de una parada quitada ya no la cierra).

Gate final: `check.sh --full` 14/14 OK, 0 saltados, e2e 96/96, invariantes 83/83,
marcador `verde-20260808-152820` (05fbf39). Avance: 82/98 ACs (84%). Un commit por
AC. Los tags archivo-wip NO se tocaron.

---

## 8-ago-2026 (tarde/noche) — El contrato E1 de la Plataforma FLOTA, rehecho desde cero

Alexis paró el proceso a mitad de vuelo: «rehaz el proceso inicial desde cero. Estás
haciendo cosas que son incoherentes con el espíritu del prompt y que será muy difícil
corregir después». Tenía razón dos veces. Primero, las specs se estaban encargando con un
resumen del maestro en vez del maestro: «el rigor del documento debe transmitirse
TOTALMENTE al agente». Segundo, un agente ya había commiteado a `main` un esqueleto de
`apps/flota` y una migración del plano de control **sin que existiera una sola spec** —
exactamente el orden que el método prohíbe. Ambos commits fueron **revertidos** (`31b32ff`);
siguen consultables en la historia (`ebb85ea`, `db21644`), como referencia, no como fuente.

**Cómo se rehizo.** Nueve redactores, uno por módulo, cada uno con el maestro COMPLETO
(947 líneas, prohibido escribir sin leerlo entero) y alcance Chile-only explícito. Sobre
cada spec, tres verificadores adversariales con lentes distintos —fidelidad al maestro,
verificabilidad de cada AC, contaminación de etapas y ganchos §4.9— y un corrector que
aplicó o rechazó cada hallazgo citando el § que lo respalda: 27 verificaciones, ~87
correcciones aplicadas, cero rechazos infundados. Después, un consolidador halló 10
problemas de coherencia global (piezas huérfanas y de doble dueño), un árbitro los resolvió
contra el maestro —7 con dueño único, 3 elevados a decisión del dueño con el AC marcado
BLOQUEADO en vez de inventar la respuesta— y una auditoría independiente verificó el
resultado leyendo el texto, no los autorreportes.

**Un bug propio, que el arnés de este método cazó.** El ruteo de ediciones a archivos usaba
`ruta.includes("01")`, y la ruta del scratchpad contiene `claude-501`: las correcciones de
siete módulos se enrutaron todas al aplicador del 01 y solo se aplicaron 2 de 9 archivos.
No lo detectó una revisión humana: lo detectó la auditoría independiente de la fase
siguiente, que verifica el TEXTO y no confía en el reporte de quien editó. Segunda ronda con
el ruteo por nombre de archivo, más 3 hallazgos nuevos que esa misma auditoría encontró por
su cuenta (`entregas_pod` sin creador declarado, §7.1 `guardrail.sh` sin AC, seis preguntas
duplicadas entre specs). Los 4 residuales de la última pasada se cerraron a mano.

**Resultado: 195 ACs en 9 specs**, todos abiertos, todos con oráculo (178 CI · 8 humano ·
8 producción), ids únicos y contiguos, cero referencias cruzadas rotas, plan espejado uno a
uno, y barrido de completitud verde contra la lista cerrada E1 del §3 (15/15), §4, §5, §7
(7.1–7.9), §9.2 y los centinelas §9.3 (1–16, salvo el 8 que es E3 y así está declarado).
`gate_specs --app=flota`: VERDE. `docs/compatibilidad-kiloruta-E1.md` mapea 63 criterios KR
del primer tenant real contra spec y AC, con «pendiente» honesto donde lo hay.

**Tres arreglos al arnés, que este trabajo destapó.** (1) `verify-refs` escaneaba el árbol
entero pero solo conocía los ACs de `--app`: con `specs/flota/` poblado, las ~100 citas
legítimas de KiloPan salían «huérfanas» y el gate de la app nueva no podía ponerse verde
jamás. (2) `check.sh` abortaba si no existía `apps/<app>`, o sea el gate del contrato no
podía correr antes del primer commit de código — al revés del método; y usar el directorio
como señal de existencia daba VERDE VACUO en `es-CL` sobre el cascarón que deja un revert
(`.next/`, `node_modules/`, gitignorados). Ahora la señal es el `package.json`. (3)
`CONTRATO_PUERTOS.md` asignaba el 3301 a `apps/flota` mientras el `playwright.config.ts` de
KiloPan ya lo tenía fijo para su e2e: dos dueños del mismo recurso escritos en el propio
contrato que existe para evitarlo. Costó un agente esperando un puerto que no se iba a
liberar. FLOTA pasa a 3310/3311. Los tres arreglos con su caso en `prueba-arnes.sh`
(98 verde / 0 rojo), porque un guard sin prueba se vuelve a romper.

**Lo que NO se construyó, a propósito:** ni una línea de `apps/flota`. La construcción
arranca en sesión limpia con Opus 5, desde `docs/ARRANQUE_FLOTA.md`.

---

## 09-ago-2026 · FLOTA hito (a): de 4 a 25 ACs cerrados, y las 11 preguntas del dueño absorbidas

Sesión de construcción supervisada (Opus 5, esfuerzo alto; el §8 prohíbe delegar este hito a
un motor). Arrancó absorbiendo `docs/HANDOFF.md` de la sesión anterior y cerró **veintiún
ACs** del módulo 00: 02, 03, 04, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23,
24, 25 y 27. El módulo va **25 de 28**. `check.sh --app=flota --full` VERDE de punta a punta,
con 82 pruebas contra el cluster real y siete suites pgTAP (157 asertos).

**Los tres que quedan no se pueden cerrar todavía, y por qué:** AC-FTEN-05 (ruteo por
subdominio) y AC-FTEN-26 (generador de la suite HTTP A-contra-B) necesitan que `apps/flota`
exista —el primero para responder, el segundo para tener un manifiesto de rutas que leer—, y
AC-FTEN-19 (matriz KiloRuta) va al final por definición: su gate exige que CADA test
referenciado exista en el repo, y la mayoría nace en los módulos 01–08.

**Lo que ahora existe y no existía.** La provisión completa (`tenant_template` → `t_<slug>`
con su identidad horneada), el runner ×N con canario y rol `migrator` dueño del esquema, las
credenciales por tenant con `scram-sha-256` y CONNECT acotado, el DDL transversal del §4.6 con
append-only por REVOKE y por trigger, la plantilla de vertical + el árbol de grupos sin ciclos
+ los parámetros, el tipado de dinero con `round_clp()` y el patrón de RLS del §4.8, el plano
de control con sus entitlements y el centinela 14, el job exportador, el offboarding con
restore verificado, el runbook de brechas y la instancia dedicada documentada.

**Seis defectos reales que el trabajo destapó**, todos con su prueba en el mismo commit:

1. `t_canary` existía, estaba al día y NO tenía identidad: su `tenant_actual()` seguía en el
   centinela de la plantilla, así que cada CHECK de dominio comparaba contra él y PASABA. Lo
   encontró la suite pgTAP de AC-FTEN-08, no las pruebas que ya existían. Ahora la provisión
   se deshace sola si la siembra falla, y `migrar verificar` mira la identidad además del
   rezago.
2. El rol de app no tenía USAGE sobre secuencias: no podía insertar un evento, porque el
   `nextval` del DEFAULT rebotaba con 42501. Habría aparecido con el primer POD del hito (e).
3. `current_setting(…, true)` devuelve CADENA VACÍA —no NULL— cuando termina la transacción
   del SET LOCAL. Sin el `nullif` sobre `''`, la transacción siguiente del pool heredaba el
   permiso de ver dinero.
4. Un UPDATE sobre tabla VACÍA no dispara un trigger FOR EACH ROW, así que el rebote de
   append-only se leía como verde. Las pruebas ahora asertan que la tabla no esté vacía antes
   de exigir el rechazo.
5. **Toda fila SEMBRADA por una migración llegaba al tenant con el `tenant_id` centinela.** En
   la plantilla `tenant_actual()` devuelve el centinela, y PostgreSQL no reevalúa un CHECK al
   reemplazar la función, así que la fila quedaba atada a un tenant que no existe. Nadie se
   enteraba hasta el primer `pg_dump` + restore, donde el COPY sí revalida y el restore muere
   — lo destapó la suite de offboarding. La provisión ahora ADOPTA esas filas y verifica que
   no quede ninguna ajena.
6. Una base provisionada ANTES de la migración que agrega una constante de plataforma se
   quedaba sin ella para siempre. El runner ahora las siembra después de migrar, igual que
   reasienta los privilegios.

**Las 11 preguntas al dueño quedaron respondidas y absorbidas.** Otra sesión levantó las
respuestas (`docs/respuestas-dueno-2026-08-09.md`); ésta las metió en la spec con su razón,
sacó las cláusulas BLOQUEADO de AC-FTEN-05, 10 y 25, y reescribió AC-FTEN-27 —que era el único
bloqueado de punta a punta— con su oráculo doble. La P5 cerró `parametros` en ocho claves y
obligó a corregir un CHECK que habría rebotado el valor que el propio dueño eligió
(`bultos_max_sin_receptor = 0`, «siempre foto»).

**Anotado como ítem, no como supuesto:** verificar que el Postgres gestionado de Railway (P2)
dé PostgreSQL ≥ 18 y `CREATE DATABASE … TEMPLATE` a demanda. Si no, el §4.1 no se puede
implementar ahí y la decisión vuelve al dueño.

**Dos sesiones en el mismo árbol.** Durante esta sesión hubo otra trabajando en
`~/kilopan-monorepo-flota` (la que entrevistó al dueño). No se pisaron porque tocaron archivos
distintos, pero el CLAUDE.md dice «un builder por worktree» por algo: la coordinación fue por
descubrimiento y no por acuerdo previo.

---

## 09-ago-2026, 11:36 → 16:10 — Hito 0 entregado: `apps/flota` existe, y con ella cuatro pasos del gate dejaron de estar saltados

Tres piezas, en este orden: **AC-FMIG-01** (tokens estructurales de Miga), el **esqueleto de
`apps/flota`** y **AC-FTEN-05** (ruteo por subdominio). `check.sh --app=flota --full` pasó de
10 OK / 5 saltados a **14 OK · 0 fallados · 1 saltado** — el único saltado son los invariantes
de BD, que para FLOTA corren en su propio `db/flota/gate.sh`.

**Lo que enseñó meter `packages/miga` al grep-gate de constantes.** AC-FMIG-01 pide que un
número mágico de la familia §0 escrito en `packages/miga` ponga el build en rojo. Al hacerlo
efectivo aparecieron **39 duplicaciones vivas** dentro de los componentes —el 96/700 de la
cifra operativa, el 56 del botón, el 64 de la tecla, el 48 del target, la grilla y los radios—.
Ninguna se tapó relajando un patrón: cada componente pasó a leer su token. Y dos patrones
resultaron no vigilar nada: `\b34\b` no muerde `font-size: 34px` porque entre dígito y letra
no hay frontera de palabra. Lo pilló el test que ejerce cada patrón contra su propia muestra —
el guardián del guardián, otra vez.

**El ruteo no cabía en un middleware de Next.** Los tres desenlaces que dictó el dueño
(404 · 503 · 404) son códigos HTTP, y elegirlos exige consultar `control` con el driver de
Postgres. El middleware corre en el Edge y su runtime Node **no existe** en la versión
instalada. Las dos alternativas eran peores: un layout no puede fijar el status —un tenant
suspendido habría respondido 200 con un cartel, que para un monitor es «todo bien»—, y un
middleware Edge consultando un endpoint interno convierte a ese endpoint en un oráculo de qué
subdominios existen, justo lo que el 404-para-los-dos-casos vino a cerrar. Quedó un
`servidor.mjs` propio, el mismo proceso en desarrollo y en producción. Eso obligó a sacarle
`output: standalone` a esta app: arrancando dentro del standalone, Next se pone a **descargar
el paquete de SWC**, o sea maquinaria de build que esa salida existe para no llevar.

**El mutante que sobrevivió, y por qué importa.** El que hace que el servidor respete una
cabecera `x-flota-tenant-bd` venida de afuera pasó la primera versión del test **en verde**:
el caso pedía con un host inexistente, así que el 404 saltaba antes de llegar al código de las
cabeceras. El ataque de verdad es otro — el atacante tiene su propia cuenta, manda un host
VÁLIDO y apunta la cabecera a la base del vecino. Hizo falta un SEGUNDO tenant activo en el
fixture para poder montarlo, y ese segundo activo destapó de paso otro verde por accidente:
con un solo tenant, «el subdominio de A va a la base de A» lo cumple cualquier base, porque
solo hay un slug posible. Un mutante que no muere vale más que diez tests que pasan.

**Deuda anotada, no tapada:** `scripts/deploy.sh` del §9.1 sigue sin existir (es precondición
de proceso, no ítem del plan, y por eso no tiene AC que lo reclame), la provisión no registra
el tenant en `control.tenants` —lo hacen las suites y, en producción, el wizard del hito g— y
en CI no corre un proceso PgBouncer, declarado dentro del propio AC.

Módulo 00: **26 de 28**. Quedan AC-FTEN-26 (necesita decidir con Alexis dónde vive el
manifiesto de rutas) y AC-FTEN-19 (va al final del hito por definición).

## 09-ago-2026, 16:10 → · AC-FTEN-26: el manifiesto de rutas se deriva del árbol, y la suite A-contra-B sale de él

Alexis cerró la pregunta que el traspaso anterior dejó abierta, y con el dato que la volvió
fácil: el manifiesto **no es solo insumo de esta suite**. Es el oráculo de cuatro pruebas de
AUSENCIA de otros módulos —cero endpoint de emisión de DTE (AC-FTAR-08, art. 97 N°4 CT), sin
endpoint de línea manual (AC-FTAR-04), nada de `/cliente/*` en el endpoint de captura (07) e
impersonación (01)—, y una ausencia solo prueba algo si el inventario no puede quedar
incompleto. De ahí: **derivado de `src/app/**` y comiteado igual**, en `apps/flota/rutas/`.
Lo generado es la lista; lo que se edita a mano es el `cruce` de cada ruta.

Lo que NO se tapó: hoy no hay sesión (nace en el módulo 01) ni ninguna ruta con parámetro,
así que el caso «404 jamás 403» no tiene qué ejercer todavía. En vez de declararlo verde, el
juicio se separó del driver del e2e (`rutas/veredicto.mjs`) y se probó contra respuestas de
laboratorio; el lector de la huella de la BD de B se ejerce contra el cluster real. Y la
suite se probó contra una fuga de verdad: con el servidor mutado para respetar la cabecera
`x-flota-tenant-bd`, `GET /api/tenant` se pone rojo nombrando las dos cadenas filtradas.

Tres guardias contra el verde vacuo, que es el modo de falla natural de una suite
autogenerada: cero casos emitidos ⇒ rojo; la identidad de B tiene que ser observable por la
app; y ningún centinela de B puede ser subcadena de la identidad de A (el fixture tiene
`ruteo_activo` y `ruteo_activo_b`: al revés, el centinela dispararía contra datos propios y
el arreglo cómodo sería ablandarlo).

Módulo 00: **27 de 28**. Queda AC-FTEN-19, que va al final del hito por definición.

## 09-ago-2026 (misma sesión, continuación) — Hito (b) arrancado: el servidor de identidad, entero

Trece ACs en una sesión: AC-FTEN-26 (cierre del módulo 00) y doce del módulo 01. El módulo 01
pasó de **0 a 13 de 21**, y llegó a un límite que vale la pena nombrar: **todo lo que queda
necesita o la PWA o una respuesta del dueño.** El servidor del hito (b) está completo.

Y se verificó desde cero al cerrar: borradas las 8 bases del cluster —control, plantilla,
canario y todos los fixtures—, el gate completo se reconstruyó desde el repo con los 14 pasos
en verde. La sesión acumuló varias dependencias de orden entre suites y las fue arreglando; la
corrida desde vacío es lo que prueba que no quedó ninguna.

### Las tres decisiones de fondo que se tomaron

1. **El manifiesto de rutas se DERIVA del árbol** (AC-FTEN-26). Lo destapó rastrear quién lo
   consume: no es insumo de una suite, es el oráculo de cuatro pruebas de AUSENCIA de otros
   módulos. Una ausencia solo prueba algo si el inventario no puede quedar incompleto. Ya
   trabajó tres veces en la sesión — frenó el build en cada ruta nueva — y AC-FIDN-11 lo usó
   para probar que no existe endpoint de impersonación.

2. **La sesión ES el aparato** (AC-FIDN-09). El secreto que la aprobación emitió, presentado
   en cada request. Sin cookie, sin token con vencimiento, sin refresh. No es minimalismo: un
   token con vencimiento propio tendría que caducar para que la revocación surta efecto, y esa
   ventana es la que no puede existir cuando alguien perdió el teléfono en la calle.

3. **El secreto viaja en un sobre sellado** (AC-FIDN-04). El dueño aprueba desde su teléfono y
   el trabajador espera en el suyo; el secreto cruza cifrado contra la clave pública del
   aparato, con ECDH P-256 y `crypto.subtle` — la MISMA API del navegador, así que el test lo
   abre con el código exacto que va a correr en el teléfono y con la privada no extraíble.

### Los defectos que los tests destaparon, y que en producción se habrían visto tarde

- **`RETURNING sobre` devolvía el valor NUEVO** —el null que el propio UPDATE acababa de
  escribir—, así que el retiro borraba el sobre sin entregarlo. El trabajador habría quedado
  esperando una sesión que nunca iba a arrancar, y se habría visto en el primer enrolamiento
  real. Corregido con `RETURNING OLD`, de PostgreSQL 18.
- **El aislamiento del ledger se volvía el problema de la suite siguiente.** Con firmas
  apuntando a una persona, ninguna otra suite podía limpiar `personas`: el DELETE rebota
  42501, que es exactamente lo que el §7.4 promete. Las suites que escriben hechos ahora
  provisionan su propia base.
- **Dos gates atraparon a quien los escribió**: el CHECK de duración cerrada impidió que el
  test de soporte falseara un vencimiento, y `gate-ruts.mjs` marcó el RUT literal que su
  propio test llevaba escrito.

### Ocho preguntas al dueño, respondidas en dos tandas

Sesiones, backoff del PIN, distribución de la invitación y RUT repetido en la primera;
rotar PIN, rol `cliente`, visibilidad de solicitudes y break-glass en la segunda. Registro en
`docs/respuestas-dueno-2026-08-09-spec01.md`. Quedan abiertas la 4 (passkey) y la 8 (ARCO y
plazos), las dos P2.

La que más consecuencias tuvo: **el RUT ya registrado rebota al APROBAR y no al solicitar**,
con el mismo criterio del `404 · 503 · 404` — quien tiene el link no está autenticado y el link
viaja por WhatsApp. De ahí salen la respuesta indistinguible del endpoint de solicitud, la del
re-enrolamiento, y el rebote nombrado del lado del dueño, que sí conoce su nómina.

## 09-ago-2026, 17:15 → · Hito (b): el panel del dueño, y la PWA deja de no existir

Cuatro ACs cerrados con el gate completo en verde después de cada uno: **AC-FIDN-12** (panel de
gobierno), **AC-FIDN-17** (RUT en vivo), **AC-FIDN-20** (cero consentimiento) y **AC-FIDN-05**
(standalone + persist). El módulo 01 pasa de 13 a 17 de 21; los cuatro que quedan son
AC-FIDN-02 (P1, el único construible hoy), AC-FIDN-07 (bloqueado por el outbox del hito e) y
los dos P2 bloqueados por preguntas abiertas.

Al arrancar la sesión `apps/flota` servía un shell y cuatro rutas de API. Ahora sirve **18
rutas**, con tres pantallas de verdad —solicitar acceso, esperando aprobación con guía A2HS, y
«Ya tengo cuenta»— y el plano de control entero del dueño.

### Las decisiones de fondo

1. **Tres respuestas para el panel del dueño, y la asimetría es el diseño.** Sin sesión ⇒ 404
   pelado; con sesión y rol distinto de `admin_tenant` ⇒ 403 y cero filas; recurso de otro
   tenant ⇒ 404. El 401 se descarta a propósito: sobre `/api/gobierno/invitaciones/<id>`
   confirma que ese uuid es una invitación real de alguien. El 403 sí se le dice al operador,
   que SÍ es de la casa — esconderle la puerta lo deja reportando «no me anda» sobre algo que
   funciona.

2. **Los barridos de «cada acción de gobierno» salen del manifiesto**, no de una lista escrita
   a mano. Una ruta de gobierno nueva entra sola a los dos barridos, o el gate la frena antes
   por no tener cruce declarado. Y son las **primeras rutas de tipo `recurso` del producto**:
   el «404 jamás 403» del centinela 2 pasó de juzgarse contra respuestas de laboratorio a
   ejercerse contra la app.

3. **El código puente no lleva plazo, y la ausencia es deliberada.** Ni el maestro ni la
   respuesta del dueño fijan uno. Lo acotan un solo uso, uno vivo por usuario, y —sobre todo—
   la sesión del propio operario: quien escuche el código dictado en un galpón no tiene el
   aparato enrolado de esa persona. Encaja con la respuesta a la pregunta 1: la sesión personal
   no caduca, así que quien olvidó el PIN sigue teniendo su teléfono adentro.

4. **Dos implementaciones del módulo 11 son inevitables, así que se vigilan.** El §4.3 pide
   validar al escribir, tecla a tecla y sin red: preguntarle a la base por cada dígito no es
   una alternativa, es otro producto. La divergencia se cierra con un oráculo diferencial que
   pasa la lista congelada entera por las dos y exige el mismo veredicto RUT por RUT.

5. **El aparato incompleto TIENE sesión.** Negársela sería el silencio que AC-FIDN-05 prohíbe
   con esas palabras: no habría pantalla donde decirle qué le queda pendiente. La sesión
   informa `enrolamiento_completo` con las dos condiciones por separado.

6. **El checkbox de consentimiento no sobra: hace daño.** La base de licitud es la ejecución
   del contrato; pedirle consentimiento a alguien que necesita el teléfono para trabajar finge
   una opción que no tiene y debilita al tenant bajo la 21.719. El alcance del grep se DERIVA
   —las pantallas que llaman a los endpoints de enrolamiento— y no barre la app entera a
   propósito: los términos del tenant sí existen y los acepta el admin en el wizard.

### Los defectos que aparecieron, y uno estaba latente hace rato

- **`tenant_info.id` y `control.tenants.id` NO coinciden.** El endpoint de grants es el primero
  que necesita el id del plano de control —la FK de `grants_soporte` apunta ahí— y leerlo de
  `tenant_info` habría dado violación de FK en el primer grant de PRODUCCIÓN, no en una prueba.
  Es la deuda que el traspaso anterior ya listaba («la provisión no registra el tenant en
  control.tenants») mordiendo por primera vez. Resuelto por slug contra `control`; la deuda de
  fondo sigue abierta y ahora tiene un caso concreto.
- **La guardia anti-vacuidad de `gate-pii.test.mjs` se rompió sola, con el gate sano.**
  Comparaba contra `/0 migraciones/` sin anclar, y esa expresión también casa con «20
  migraciones» — que es a donde llegó el repo esta sesión. Una guardia que falla por contar
  bien enseña a ignorarla; quedó anclada al separador.
- **El linter del §9.2 frenó la migración del código puente** por su segunda FK al mismo padre
  sin índice que la encabece. Dos FK a `usuarios` por columnas distintas necesitan dos índices,
  y es la clase de costo que no se ve hasta que la tabla tiene años.
- **Ni `invitaciones.ts` ni `secretos.ts` se pueden importar desde el teléfono**: abren con
  `node:crypto` y usan `Buffer`. Se PARTIÓ la parte pura (`dominio/codigo-corto.ts`) en vez de
  copiarla, y la mitad del navegador vive en `cliente/`. Una segunda normalización del código
  corto y un día el que la persona teclea se acepta en pantalla y rebota en el servidor.
