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

## 2. Conectar el Postgres hospedado

Sirve cualquier Postgres ≥14 con las extensiones `pgcrypto` y `btree_gist` (las traen
Neon, Supabase, RDS y Railway de fábrica).

```bash
# 1. En .env.local
DB_MODE=postgres
DATABASE_URL=postgres://usuario:clave@host/kilopan?sslmode=require
KILOPAN_DB_REMOTA_INTENCIONAL=1

# 2. Aplicar las migraciones (idempotente: solo corre las nuevas)
node db/migrar.mjs

# 3. Sembrar usuarios y catálogo
node db/sembrar.mjs
```

Dos guardrails que van a abortar si faltan, y están a propósito:

- **`KILOPAN_DB_REMOTA_INTENCIONAL=1`** — apuntar a una BD remota tiene que ser
  deliberado. Correr una migración sobre la panadería equivocada no tiene deshacer.
- **`sslmode=require`** — por esa conexión viajan RUTs, PINs hasheados y evidencia de
  entregas.

### Qué hace el pool, y por qué importa

`obtenerDb()` abre un **pool**, no un cliente suelto: los proveedores hospedados cierran
conexiones ociosas de forma agresiva y un cliente único se cae con la primera.

Detalle que no es cosmético: `set role pan_app` se aplica en el hook `connect` del pool,
no una sola vez al arrancar. Si se hiciera una vez, cada conexión nueva del pool entraría
como **dueño del esquema** y AC-SEC-08 (mínimo privilegio) dejaría de valer en silencio
— justo la clase de agujero que no se nota hasta que alguien lo usa.

También hay `statement_timeout: 15s`: con datos móviles una consulta puede quedar
colgada, y es mejor cortarla que dejar al maestro mirando una pantalla congelada.

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
