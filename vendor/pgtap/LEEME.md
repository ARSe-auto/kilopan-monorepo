# vendor/pgtap — pgTAP 1.3.3 vendorizado

**Qué es.** El marco de pruebas unitarias dentro de PostgreSQL que las specs de FLOTA
nombran de forma literal: cuatro criterios de aceptación de
`specs/flota/00-modelo-datos-tenancy.md` (PKs UUIDv7, tipado de dinero, estructura de la
plantilla y política RLS de dinero) y el paso «pgTAP de políticas de ROL con el rol de app
real» del gate `--full` (§9.2 del maestro).

> Los ids de esos ACs NO se citan aquí a propósito: `verify-refs` toma cualquier mención en
> el árbol como respaldo de un `[x]`, y un README no es evidencia de nada. El respaldo tiene
> que ser el test.

**Procedencia.** `github.com/theory/pgtap`, tag `v1.3.3`, licencia PostgreSQL (BSD de 3
cláusulas). Se compiló con el `Makefile` de upstream contra el `pg_config` de PostgreSQL
18.4 y se copiaron aquí solo los dos artefactos que el servidor necesita:

| Archivo | Qué es |
|---|---|
| `pgtap.control` | control de la extensión (`default_version = '1.3.3'`) |
| `pgtap--1.3.3.sql` | el cuerpo, **SQL puro** — cero binarios, cero `$libdir` |

`README-upstream.md` es el README original, conservado como constancia de licencia y uso.

**Por qué vendorizado y no instalado.** `db/flota/cluster.sh` copia estos archivos a
`~/.flota-pg/share/extension/` y apunta el `extension_control_path` del cluster de FLOTA
(PostgreSQL ≥ 18) a ese directorio. Así el gate no depende de la red, y —sobre todo— no se
escribe una sola línea dentro del bundle de Postgres.app, que es una instalación
**compartida** con el cluster de eauto (`docs/CONTRATO_PUERTOS.md`).

**Cómo se actualiza.** Se recompila desde el tag nuevo de upstream y se reemplazan los dos
archivos; el `default_version` del `.control` y el nombre del `.sql` deben coincidir.
`cluster.sh` los recopia en cada `iniciar`, así que basta reiniciar el cluster.
