-- pgTAP: tema y terminología del tenant (§4.4, §5.1). [AC-FTEN-10]
--
-- El fixture de rechazo de contraste estuvo BLOQUEADO hasta el 09-ago-2026 por la Pregunta 7,
-- y no por pereza: el producto del ratio de un color contra blanco por su ratio contra negro
-- es exactamente 21, así que la lectura que la spec proponía —rechazar si falla contra
-- CUALQUIERA de los dos fondos— no admitía ningún fixture válido para toda interpretación. El
-- dueño cerró «cada variante contra SU fondo», y con eso el fixture existe.

select no_plan();

select has_table('tenant_theme');
select has_table('tenant_terminology');
select has_table('plataforma');

-- --- El contraste WCAG, contra valores conocidos de la norma -------------------------------
select is(contraste_wcag('#000000', '#ffffff'), 21.0000,
  'negro sobre blanco da exactamente 21: el máximo posible de la norma');
select is(contraste_wcag('#ffffff', '#000000'), 21.0000,
  'y es simétrico: el orden de los colores no cambia el ratio');
select is(contraste_wcag('#123456', '#123456'), 1.0000,
  'un color contra sí mismo da 1');
select cmp_ok(contraste_wcag('#767676', '#ffffff'), '>=', 4.5::numeric,
  '#767676 sobre blanco cruza el mínimo por poco: es el gris de frontera conocido de WCAG');
select cmp_ok(contraste_wcag('#777777', '#ffffff'), '<', 4.6::numeric,
  'y un tono más claro ya no lo cruza con holgura: la función discrimina, no redondea');
select throws_ok(
  $$ select contraste_wcag('rojo', '#ffffff') $$,
  '23514', null,
  'un color que no es #rrggbb rebota en vez de devolver un número inventado'
);

-- --- El umbral viene de la familia de constantes, no del DDL -------------------------------
select is((select count(*)::int from plataforma), 1,
  'la provisión sembró el umbral de contraste desde constants.ts (§0)');
select cmp_ok((select contraste_minimo from plataforma), '>', 1::numeric,
  'y es un umbral de verdad, no un cero que dejaría pasar todo');

-- --- tenant_theme: cada variante contra SU fondo (Pregunta 7) ------------------------------
select lives_ok(
  $$ insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro)
     values ('#0B6E4F', '#0B6E4F', '#ffffff', '#57C79A', '#101314') $$,
  'un acento con sus dos variantes derivadas, cada una cruzando el mínimo contra su fondo, entra'
);

-- EL FIXTURE DE RECHAZO que estuvo bloqueado. La variante OSCURA no llega al mínimo contra el
-- fondo oscuro; la clara está perfecta. Con la lectura vieja («falla contra cualquiera de los
-- dos») este color habría pasado, porque contra blanco anda bien.
delete from tenant_theme;
select throws_ok(
  $$ insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro)
     values ('#0B6E4F', '#0B6E4F', '#ffffff', '#1F4D3C', '#101314') $$,
  '23514', null,
  'la variante OSCURA que no cruza el mínimo contra el fondo oscuro es RECHAZADA (Pregunta 7)'
);

select throws_ok(
  $$ insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro)
     values ('#EEEEEE', '#EEEEEE', '#ffffff', '#57C79A', '#101314') $$,
  '23514', null,
  'y la variante CLARA que no cruza contra el fondo claro también: se valida cada una'
);

select lives_ok(
  $$ insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro)
     values ('#0B6E4F', '#0B6E4F', '#ffffff', '#57C79A', '#101314') $$,
  'el mismo acento con la variante oscura corregida entra: aclararla es lo que el §5.1 pide'
);

select throws_ok(
  $$ insert into tenant_theme (accent_color, accent_claro, fondo_claro, accent_oscuro, fondo_oscuro)
     values ('#0B6E4F', '#0B6E4F', '#ffffff', '#57C79A', '#101314') $$,
  '23505', null,
  'y hay UN tema por tenant: el §5.1 personaliza tres cosas, no tres temas'
);

-- --- tenant_terminology: los invariantes del §0 y del §4.4 ---------------------------------
select lives_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('encargo', 'navegacion', 'Pedido', 'Pedidos') $$,
  'un término con singular y plural entra'
);

select throws_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular) values ('ruta', 'navegacion', 'Vuelta') $$,
  '23502', null,
  'sin plural no entra: los DOS son obligatorios (§4.4)'
);

select throws_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('ruta', 'navegacion', 'Vuelta larguisima', 'Vueltas') $$,
  '23514', null,
  'un término de navegación que pasa su largo rebota: en la barra no entra y se corta solo'
);

select lives_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('ruta', 'titulo', 'Vuelta larguisima', 'Vueltas larguisimas') $$,
  'el MISMO largo pasa como título: el límite es por tipo, no uno solo para los tres'
);

select throws_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('parada', 'navegacion', 'Punto #1', 'Puntos') $$,
  '23514', null,
  'un carácter prohibido rebota: rompe URLs y plantillas cuando el término viaja (§0)'
);

select throws_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('audit_trail', 'navegacion', 'Historial', 'Historiales') $$,
  '23514', null,
  'un término de auditoría no se renombra: la trazabilidad del §7.4 se apoya en que signifique '
  'lo mismo en todos los tenants'
);

select throws_ok(
  $$ insert into tenant_terminology (term_key, tipo, singular, plural)
     values ('encargo', 'navegacion', 'Otro', 'Otros') $$,
  '23505', null,
  'la misma clave dos veces en el mismo tenant rebota'
);

-- --- Las dos entran al snapshot global de configuración (AC-FTEN-13) -----------------------
select bag_has(
  $$ select tabla from config_versionada $$,
  $$ values ('tenant_theme'), ('tenant_terminology') $$,
  'tema y terminología viajan en el snapshot congelado del turno (§4.4)'
);

select * from finish();
