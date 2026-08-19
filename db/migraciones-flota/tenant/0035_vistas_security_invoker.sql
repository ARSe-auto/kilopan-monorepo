-- 0035 — Toda vista corre con los privilegios de QUIEN CONSULTA, no del dueño. [AC-FVEH-13]
--
-- ─── EL DEFECTO, TAL COMO APARECIÓ ─────────────────────────────────────────────────
--
-- La RLS del §4.8 le niega al chofer todo SELECT sobre `energy_entry`, y eso funcionaba: la
-- suite lo verifica desde AC-FVEH-08. Pero una vista de PostgreSQL corre, por omisión, con los
-- privilegios de su DUEÑO — así que `energia_semanal` sumaba esas mismas filas y le devolvía el
-- total. **El chofer no veía ninguna fila y veía el monto igual.**
--
-- Es exactamente la fuga que el centinela 10 (§9.3) existe para impedir, y no la habría
-- encontrado ninguna revisión de la política: la política estaba bien. Apareció corriendo la
-- consulta con el rol de app real, que es la única forma de verla.
--
-- ─── LA CORRECCIÓN, Y POR QUÉ VA PARA TODAS ────────────────────────────────────────
--
-- `security_invoker = true` hace que la vista aplique los permisos y las políticas del que
-- consulta. Se activa en las TRES vistas del tenant y no solo en la que tenía montos: la
-- próxima vista que alguien escriba sobre una tabla con RLS va a tener el mismo agujero, y
-- dejar dos criterios conviviendo es cómo se elige el equivocado. El invariante de
-- `db/flota/suite-bd/` lo verifica para toda vista, incluidas las que todavía no existen.

alter view eevd_semanal set (security_invoker = true);
alter view energia_sin_incidente_semanal set (security_invoker = true);
alter view energia_semanal set (security_invoker = true);
