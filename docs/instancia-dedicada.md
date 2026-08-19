# Instancia dedicada — opción del plan Empresa

Fuente: §0 (fila Tenancy) y §4.1 del maestro. Entregable de AC-FTEN-23.

## Condición: DOCUMENTADA, no construida en el MVP

**Esta opción no se construye en E1.** No hay código, no hay migraciones y no hay DDL apagado
esperándola: lo único que existe es este documento. Si alguien la necesita antes de que esté
en un hito, la respuesta correcta es agregarla al plan, no improvisarla — y esta línea existe
para que nadie la dé por hecha leyendo el pricing del Anexo A.

## Qué es

Un tenant del plan Empresa puede comprar una **instancia dedicada**: su base de datos deja de
vivir en el cluster compartido y pasa a un **host propio**. Nada más cambia.

- **Misma `tenant_template`.** La instancia dedicada se provisiona desde la MISMA plantilla
  versionada del repo (§4.1), con el mismo `CREATE DATABASE t_<slug> TEMPLATE tenant_template`.
  No es un fork del esquema ni una variante: si lo fuera, cada migración habría que escribirla
  dos veces y la promesa de «un vertical nuevo = filas» se rompería para ese cliente.
- **Otro host.** Cambia dónde corre el Postgres, no qué corre. El runner de migraciones ×N
  (`db/flota/migrar.mjs`) lo alcanza igual: su cadena de conexión sale de un solo lugar
  (`db/flota/conectar.mjs`) y el recorrido es por base, no por host.
- **El plano de control sigue siendo UNO.** `control` no se duplica: el registro del tenant,
  su plan, su modo y su estado siguen ahí, y el job exportador empuja sus agregados técnicos
  al mismo lugar que los de todos. La vista cross-tenant de e-auto sigue leyendo SOLO de
  `control` (§4.1, §5.6).

## Por qué la separación física ya la hace barata

El §4.1 decidió una base por tenant, con rol `app_t_<slug>` propio y `CONNECT` solo a su base.
Con esa decisión ya tomada, mover una base a otro host es un cambio de **operación**, no de
**arquitectura**: no hay datos de otros tenants que separar, ni consultas que reescribir, ni
claves que repartir. Ese es exactamente el valor que el §4.1 compró por adelantado.

## Qué habría que construir cuando toque

Queda anotado para que el día que entre a un hito no se descubra desde cero:

1. Un segundo origen de conexión en `control.tenants` (hoy la BD se DERIVA del slug con un
   CHECK: `bd = 't_' || slug`; una instancia dedicada agrega el host, no reemplaza esa regla).
2. Que el runner de migraciones recorra también los hosts dedicados y que `verificar` los
   incluya en el centinela 13 — una base dedicada rezagada tiene que dejar el deploy en rojo
   igual que una compartida.
3. Que el job exportador alcance ese host, con la misma prohibición de cross-database: dos
   conexiones separadas, jamás una consulta que vea las dos bases.
4. El pooler (PgBouncer) del host dedicado, con su límite de pool propio.

## Verificación pendiente que afecta a esta opción

La Pregunta al dueño 2 (respondida el 09-ago-2026) fijó **Railway** como proveedor del
Postgres gestionado. Antes de comprometer la instancia dedicada hay que confirmar lo mismo que
para el cluster compartido: **PostgreSQL ≥ 18** (el §0 exige `uuidv7()` nativo) y
`CREATE DATABASE … TEMPLATE` a demanda. Si el proveedor no da las dos cosas, esta opción y el
§4.1 completo vuelven al dueño.
