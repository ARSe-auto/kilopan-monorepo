# Operar por datos móviles con Postgres hospedado

Decisión del 25-jul-2026: KiloPan opera sobre **5G/datos móviles** y contra un
**Postgres hospedado**, no sobre el wifi de la panadería con una base local.

Esto invalidó un supuesto que estaba escrito en el diseño original (decisión #4:
«pesaje y mostrador nunca salen del LAN de la panadería»). Este documento registra qué
cambió y por qué, para que nadie lo re-descubra dentro de seis meses.

## 1. Por qué pglite ya no alcanza

pglite es un motor **embebido de un solo proceso**. Sirve perfecto para desarrollar en
una máquina —cero instalación, y las 44 invariantes corren igual— pero:

- No puede atender a la tablet del mesón, el teléfono del repartidor y el del dueño a
  la vez. Se descubrió en la práctica: el script de seed chocó con el servidor de dev
  por el mismo archivo.
- Vive en el disco del servidor, no en un lugar con respaldo.

**El SQL no cambia.** Las 8 migraciones, los triggers, los grants de `pan_app` y los
tests de invariantes corren idénticos en ambos. Cambia el transporte, no el contrato.

## 2. Conectar el Postgres hospedado (Railway)

Sirve cualquier Postgres ≥14 con `pgcrypto` y `btree_gist`. Antes de migrar contra un
host nuevo, correr el diagnóstico — prueba empíricamente todo lo que las migraciones
necesitan y dice qué encontró:

```bash
node db/verificar-conexion.mjs
```

```bash
# .env.local
DB_MODE=postgres
DATABASE_URL=postgres://usuario:clave@host:puerto/railway   # SIN ?sslmode=
KILOPAN_DB_REMOTA_INTENCIONAL=1
DB_POOL_MAX=5                       # el diagnóstico sugiere el número

node db/migrar.mjs && node db/sembrar.mjs
```

### El TLS de Railway: por qué la verificación estricta es imposible

Esto se investigó a fondo porque la configuración "obvia" no funciona, y la razón no
es evidente:

- El certificado de Postgres de Railway es **autofirmado y generado dentro del propio
  contenedor** en el primer arranque (verificado en el código del template oficial
  `railwayapp-templates/postgres-ssl/init-ssl.sh`).
- Ese certificado lleva **`CN=localhost` y `subjectAltName = DNS:localhost`** — el
  hostname real del proxy (`*.proxy.rlwy.net`) no aparece. O sea: aunque consiguieras
  la CA, la verificación de identidad fallaría igual.
- Railway **no publica ninguna CA descargable**, y la genera distinta por instancia,
  rotándola sola. Pinnearla no es viable ni siquiera extrayéndola del contenedor.

Conclusión: contra el proxy público, `rejectUnauthorized: true` **no puede funcionar**.
No es un problema de configuración, es de construcción.

**El footgun de `sslmode`.** node-postgres NO usa la semántica de libpq: trata
`require` y `verify-ca` como **alias de `verify-full`**, y —peor— si la URL trae
`sslmode`, *descarta en silencio* el objeto `ssl` del código. Poner `?sslmode=require`
(que suena a lo correcto) rompe la conexión Y anula la política TLS que escribiste.
Por eso el guardrail ahora **rechaza** cualquier `?sslmode=` en la URL: la política vive
en un solo lugar, `politicaTls()` en `apps/kilopan/src/comun/db.ts`.

### Las dos formas de conectar, y cuál usar

| Red | URL | TLS | Cuándo |
|---|---|---|---|
| **Privada** | `postgres.railway.internal` | ninguno (`ssl: false`) | **producción**, con la app desplegada en Railway |
| **Pública** | `*.proxy.rlwy.net` | cifrado sin verificar | desarrollo desde tu Mac |

La privada es la buena: Railway cifra todo el tráfico entre servicios con **Wireguard**,
así que el transporte ya va protegido y el problema del certificado desaparece. Es la
propia recomendación de Railway (quitar el proxy público de las BD de producción).

Para la pública hay que aceptar explícitamente el downgrade:

```bash
KILOPAN_TLS_SIN_VERIFICAR=1   # cifra pero NO autentica: expuesto a un intermediario
```

No es una formalidad. Sin verificación de certificado, alguien en el camino puede
hacerse pasar por la base de datos. Por eso solo para desarrollo, y por eso la variable
se llama así y no `SSL_OK`.

### El rol de mínimo privilegio va en el handshake

`options: "-c role=pan_app"` viaja en el *startup packet*, no como una query posterior.
La diferencia importa por dos razones que se descubrieron investigando Railway:

1. **En Railway el usuario de `DATABASE_URL` es superusuario real** (el rol bootstrap de
   initdb, sin la contención que ponen RDS o Supabase). La versión anterior hacía
   `set role pan_app` con un `.catch()` silencioso: si eso fallaba, la conexión entraba
   al pool **como superusuario** y AC-SEC-08 se evaporaba sin ruido.
2. **Un `SET ROLE` de sesión no sobrevive a PgBouncer en modo transacción**, y Railway
   lo ofrece como un toggle de UI que reapunta `DATABASE_URL` sin avisarle al código.

Con `options`, si el rol no existe la conexión **falla al autenticar**. Falla cerrado,
que es lo que corresponde cuando lo que está en juego es el privilegio. Además, al
abrir el pool se verifica que `current_user` sea `pan_app` de verdad y, si no lo es, la
app no arranca.

**Si activas Connection Pooling en Railway**, las migraciones necesitan la cadena sin
pooler (DDL y funciones no sobreviven al modo transacción):

```bash
KILOPAN_MIGRACIONES_URL=<la cadena UNPOOLED>
```

### Otros detalles del pool

`statement_timeout: 15s` — con datos móviles una consulta puede colgarse, y es mejor
cortarla que dejar al maestro mirando una pantalla congelada.

Aplicar y **registrar** una migración van en una sola transacción: son dos viajes de red
y, contra una BD remota, un corte entre ambos dejaba la migración aplicada pero sin
registrar — y la corrida siguiente la reaplicaba, fallando con "already exists".

## 3. Qué cambió del lado del teléfono

Sobre datos móviles el corte de señal deja de ser el caso raro de la madrugada y pasa a
ser cotidiano. Tres cambios:

**Un solo outbox, en IndexedDB.** Antes había dos mecanismos: IndexedDB para el reparto
y `sessionStorage` para pesaje/mostrador. `sessionStorage` **se borra al cerrar la
pestaña** — o sea, perdía pesajes. Ahora todo va por `pod/outbox.ts`: IndexedDB
sobrevive al cierre del navegador y al reinicio del teléfono.

La regla de qué se encola y qué no:

| Respuesta | Qué hace | Por qué |
|---|---|---|
| 2xx | listo | — |
| Sin red / 5xx | encola y reintenta | el problema es del transporte, no del dato |
| 4xx | **NO** encola, lo muestra | es una respuesta legítima (stock insuficiente, outlier) que el operador tiene que ver ahora; encolarla sería mentirle |

**Service worker acotado.** Cachea el app shell para que la app abra sin señal, pero
**jamás cachea respuestas de la API**: mostrar un stock o una TCK viejos como si fueran
de ahora es peor que decir «sin conexión».

**Caché del catálogo.** Los productos se guardan en `localStorage` y se muestran de
inmediato mientras se refrescan por detrás. Con mala señal, esperar el fetch dejaba la
grilla vacía y al maestro sin poder pesar.

## 4. Lo que todavía NO está resuelto

- **Consumo de datos.** Cada foto de POD son ~400 KB. Una ruta de 20 paradas = ~8 MB
  diarios por repartidor. Con un plan móvil chico eso importa; habría que medirlo en el
  piloto y evaluar bajar la calidad o subir las fotos solo con wifi.
- **Mostrador y despacho** ya usan el outbox unificado, pero sus pantallas todavía
  asumen catálogo fresco (a diferencia de pesaje, que ya cachea). Falta darles el mismo
  trato.
- **El dashboard** es un Server Component: sin señal no carga y no tiene caché. Es
  aceptable —el dueño lo mira de noche, no en la calle— pero es una decisión, no un
  olvido.
