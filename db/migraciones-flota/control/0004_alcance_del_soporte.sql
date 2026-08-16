-- 0004 — Soporte sin god-mode: alcance y vencimiento cerrado del grant. [AC-FIDN-11]
-- §4.3, §7.9.
--
-- `grants_soporte` ya nacía con tenant, motivo y vencimiento obligatorios (AC-FTEN-04). Lo
-- que le faltaba para cumplir el §7.9 son las dos cosas que hacen que un acceso de soporte
-- sea un acceso ACOTADO y no una llave: QUÉ puede ver y POR CUÁNTO.
--
-- El alcance es un enum cerrado porque el §4.3 lo enumera: solo-lectura o módulos. Un tercer
-- valor que significara «todo» sería el god-mode que este AC existe para que no exista.
--
-- Y el vencimiento es de DOS duraciones y no un campo libre. El §4.3 dice «24 h | 7 d», y la
-- diferencia entre eso y un timestamptz suelto es concreta: con un campo libre, el día que
-- alguien tenga apuro va a poner un año, y nadie va a estar mirando esa fila. Con dos
-- opciones, extender el acceso obliga a otorgar otro grant — que queda registrado.

create type alcance_de_soporte as enum ('solo_lectura', 'modulos');

alter table grants_soporte
  add column alcance alcance_de_soporte not null default 'solo_lectura';

comment on column grants_soporte.alcance is
  'solo_lectura | modulos (§4.3). No existe un valor que signifique «todo»: eso es el '
  'god-mode que el §7.9 prohíbe.';

-- Las DOS duraciones del §4.3 y ninguna más. Se compara contra la diferencia y no contra un
-- campo aparte para que no puedan divergir: un `duracion = '24h'` con `expira_en` a un año
-- diría una cosa y haría otra, y lo que manda al final es la fecha.
alter table grants_soporte
  add constraint grants_soporte_duracion_cerrada
    check (expira_en - otorgado_en in (interval '24 hours', interval '7 days'));
