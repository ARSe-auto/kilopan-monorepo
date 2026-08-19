# db/migraciones-flota — el esquema de la plataforma FLOTA

Dos destinos, dos carpetas, porque son dos bases con reglas distintas (§4.1):

| Carpeta | A qué base se aplica | Qué exige el linter |
|---|---|---|
| `control/` | la BD `control` (plano de control, un solo lugar en el cluster) | clase `COMMENT ON TABLE` |
| `tenant/` | `tenant_template` **y** cada `t_<slug>` | las CINCO exigencias de toda tabla de dominio |

Las cinco exigencias de una tabla de dominio, que `db/flota/lint-migraciones.mjs` verifica
en cada corrida del gate:

1. `tenant_id uuid not null`
2. `check (tenant_id = tenant_actual())` — la constante de la BD
3. un índice encabezado por `tenant_id`, y cada FK compuesta cubierta por un índice que la
   encabece (Postgres no indexa las FK solo)
4. `unique (tenant_id, id)` para poder ser referenciada, y toda FK propia compuesta
5. `comment on table … is 'PLANIFICACIÓN …'` o `'CAPTURA …'` (la regla de oro, §4.2)

## Por qué el CHECK no es el del maestro, literal

El §4.1 lo escribe `CHECK (tenant_id = (SELECT id FROM tenant_info))`. PostgreSQL lo
rechaza: **«cannot use subquery in check constraint»** (verificado contra 18.4 antes de
escribir una línea de DDL). La forma implementable es una función `IMMUTABLE` con el uuid
del tenant **horneado como literal** en el momento de la provisión:

```sql
create or replace function tenant_actual() returns uuid
  language sql immutable parallel safe
  as $$ select '019fe4…'::uuid $$;
```

Y es además la única forma segura ante `pg_restore` (offboarding, §2 métrica 7): las
funciones se restauran antes que los datos, mientras que un CHECK que leyera `tenant_info`
fallaría en cada fila del `COPY` porque esa tabla todavía estaría vacía. Un invariante
verifica que `tenant_actual()` y `tenant_info.id` coincidan siempre.

## Exenciones

Se declaran EN la migración y el linter las cuenta e imprime — nunca son silenciosas:

```sql
-- linter: exenta tenant_info — es la fila que DEFINE la constante del tenant.
```

## Cómo se aplican

`db/flota/migrar.mjs` (runner ×N, §4.1): primero el canario sintético `t_canary`, después
la plantilla y cada BD de tenant. Una base rezagada deja el deploy en rojo.

```bash
node db/flota/migrar.mjs aplicar     # recorre y aplica; termina verificando
node db/flota/migrar.mjs verificar   # mira y no toca — el modo que consume el deploy
```

## Quién es quién en el cluster

| Rol | Qué puede | Cómo se autentica |
|---|---|---|
| `flota_admin` | superusuario: crea bases y roles (el alta de tenant) | `trust` desde 127.0.0.1 |
| `migrator` | dueño del esquema: aplica migraciones | `trust` desde 127.0.0.1 |
| `app_t_<slug>` | datos de SU base y nada más; cero ownership | `scram-sha-256`, clave propia |

Las migraciones NO corren con el superusuario: corren con el rol `migrator`, que es además el
dueño de `tenant_template` y de cada `t_<slug>` (§4.1). Desde PostgreSQL 15 el esquema
`public` pertenece a `pg_database_owner`, así que fijar el dueño de la base al crearla ya le
da al migrador el permiso de crear tablas ahí, y a nadie más. Una base con otro dueño detiene
el runner con su nombre en el mensaje: el rol de la app jamás tiene ownership.
