-- 0010 — Tema y terminología del tenant (§4.4, §5.1). [AC-FTEN-10]
--
-- El §5.1 es taxativo: el tenant personaliza EXACTAMENTE tres cosas —logo, color de acento y
-- unos extras—, y las tres son FILAS, no código. Y el §4.4 pone la terminología como filas con
-- sus límites de largo por tipo, para que renombrar «encargo» a «pedido» no sea un deploy.
--
-- EL CONTRASTE, y por qué está escrito así (Pregunta al dueño 7, respondida el 09-ago-2026).
-- El dueño cerró: «cada variante contra SU fondo». La plataforma deriva una variante del
-- acento por tema y valida CADA UNA contra el fondo de ESE tema, ambas ≥ el mínimo de la
-- familia de constantes. Rechazó explícitamente la lectura que la propia spec proponía
-- —rechazar si falla contra CUALQUIERA de los dos fondos— porque es inservible: el producto
-- del ratio de un color contra blanco por su ratio contra negro es exactamente 21, así que
-- exigir el mínimo contra ambos deja pasar solo una rendija donde casi ningún color de marca
-- entra.
--
-- La consecuencia de diseño: la BD guarda la variante DERIVADA junto al fondo contra el que se
-- la validó, y verifica ese par. La derivación (aclarar/oscurecer) es de la plataforma —§5.1
-- dice que ella deriva—, y los tokens de fondo de cada tema son del módulo de diseño (spec 08,
-- AC-FMIG-01). Esta base NO los conoce ni los inventa: los recibe con la fila. Eso es lo que
-- deja el invariante ENFORCEABLE hoy sin decidir por el módulo de diseño.

-- El umbral es la única CIFRA de la familia §0 que este DDL necesita, y por eso NO está
-- escrita acá: la siembra `db/flota/provisionar.mjs` importando `CONTRASTE.texto` de
-- `packages/nucleo-comun/src/constants.ts`. Copiar el número al SQL sería el número mágico
-- duplicado que el grep-gate de AC-FTEN-01 existe para atrapar.
--
-- linter: exenta plataforma — no es una tabla de dominio: guarda constantes de la PLATAFORMA
-- sembradas desde la familia canónica, no datos del tenant.
create table plataforma (
  unica             boolean not null default true,
  contraste_minimo  numeric not null,
  primary key (unica),
  constraint plataforma_una_sola_fila check (unica),
  constraint plataforma_contraste_positivo check (contraste_minimo > 1)
);
comment on table plataforma is
  'PLANIFICACIÓN — constantes de plataforma sembradas desde la familia canónica del §0. Una '
  'sola fila; los valores los pone la provisión, no este DDL (grep-gate de AC-FTEN-01).';

create or replace function luminancia_relativa(color text) returns numeric
  language plpgsql immutable strict as $$
  declare
    hex text := lower(btrim(color));
    canal numeric;
    lineal numeric[] := array[]::numeric[];
    i int;
  begin
    if hex !~ '^#[0-9a-f]{6}$' then
      raise exception 'color inválido: «%». Se espera #rrggbb', color
        using errcode = 'check_violation';
    end if;
    for i in 0..2 loop
      canal := ('x' || substr(hex, 2 + i * 2, 2))::bit(8)::int / 255.0;
      lineal := lineal || case
        when canal <= 0.03928 then canal / 12.92
        else power((canal + 0.055) / 1.055, 2.4)
      end;
    end loop;
    return 0.2126 * lineal[1] + 0.7152 * lineal[2] + 0.0722 * lineal[3];
  end
  $$;


/**
 * Contraste WCAG entre dos colores `#rrggbb`. Los coeficientes son los de la norma, no
 * decisiones de este proyecto.
 */
create or replace function contraste_wcag(color_a text, color_b text) returns numeric
  language plpgsql immutable strict as $$
  declare
    la numeric;
    lb numeric;
  begin
    la := luminancia_relativa(color_a);
    lb := luminancia_relativa(color_b);
    if la < lb then
      return round((lb + 0.05) / (la + 0.05), 4);
    end if;
    return round((la + 0.05) / (lb + 0.05), 4);
  end
  $$;

comment on function contraste_wcag(text, text) is
  'Ratio de contraste WCAG 2.x entre dos colores #rrggbb. Los coeficientes son los de la '
  'norma, no decisiones de este proyecto.';

-- tenant_theme: las TRES cosas del §5.1, más la evidencia de la derivación.
create table tenant_theme (
  id             uuid    not null default uuidv7(),
  tenant_id      uuid    not null default tenant_actual() check (tenant_id = tenant_actual()),
  unica          boolean not null default true,
  logo_url       text,
  accent_color   text    not null,
  -- La variante derivada por tema Y el fondo contra el que se la validó. Guardar el fondo no
  -- es una cuarta personalización: es la evidencia de contra qué se midió, sin la cual el
  -- invariante no se puede verificar en la base.
  accent_claro   text    not null,
  fondo_claro    text    not null,
  accent_oscuro  text    not null,
  fondo_oscuro   text    not null,
  extras         jsonb   not null default '{}'::jsonb,
  primary key (id),
  unique (tenant_id, id),
  unique (unica)
);
create index tenant_theme_tenant_idx on tenant_theme (tenant_id);
comment on table tenant_theme is
  'PLANIFICACIÓN — las tres cosas que el tenant personaliza (§5.1): logo, acento y extras. '
  'Cada variante derivada se guarda con el fondo contra el que se validó (Pregunta 7).';

create or replace function validar_contraste_del_tema() returns trigger
  language plpgsql as $$
  declare
    v_minimo numeric;
    v_par    record;
  begin
    select contraste_minimo into v_minimo from plataforma;
    if v_minimo is null then
      raise exception
        'no hay umbral de contraste sembrado: la provisión tiene que ponerlo desde la familia '
        'de constantes (§0) antes de aceptar un tema'
        using errcode = 'check_violation';
    end if;
    for v_par in
      select 'claro' as tema, new.accent_claro as acento, new.fondo_claro as fondo
      union all
      select 'oscuro', new.accent_oscuro, new.fondo_oscuro
    loop
      if contraste_wcag(v_par.acento, v_par.fondo) < v_minimo then
        raise exception
          'el acento del tema % da %:1 contra su fondo y el mínimo es %:1 — la plataforma '
          'tiene que aclararlo u oscurecerlo hasta cruzarlo (§5.1, Pregunta 7)',
          v_par.tema, contraste_wcag(v_par.acento, v_par.fondo), v_minimo
          using errcode = 'check_violation';
      end if;
    end loop;
    return new;
  end
  $$;

create trigger tenant_theme_contraste
  before insert or update on tenant_theme
  for each row execute function validar_contraste_del_tema();

-- tenant_terminology: singular Y plural obligatorios, con límite de largo POR TIPO de clave
-- (§0 LABELS, §4.4). Los términos de sistema y de auditoría quedan fuera por CHECK: renombrar
-- «audit_trail» o «evento» rompería la trazabilidad que el §7.4 promete.
create type termino_tipo as enum ('navegacion', 'titulo', 'descripcion');

create table tenant_terminology (
  id        uuid         not null default uuidv7(),
  tenant_id uuid         not null default tenant_actual() check (tenant_id = tenant_actual()),
  term_key  text         not null,
  tipo      termino_tipo not null,
  singular  text         not null,
  plural    text         not null,
  primary key (id),
  unique (tenant_id, id),
  unique (tenant_id, term_key),
  -- Largos por TIPO (§0): la navegación tiene menos lugar que un título, y un título menos que
  -- una descripción. Un solo límite para los tres dejaría la navegación rota o el resto inútil.
  constraint tenant_terminology_largo_por_tipo check (
    case tipo
      when 'navegacion'  then length(singular) <= 12 and length(plural) <= 12
      when 'titulo'      then length(singular) <= 24 and length(plural) <= 24
      when 'descripcion' then length(singular) <= 40 and length(plural) <= 40
    end
  ),
  constraint tenant_terminology_no_vacios check (
    length(btrim(singular)) > 0 and length(btrim(plural)) > 0
  ),
  -- Caracteres prohibidos (§0): rompen URLs, plantillas y consultas cuando el término viaja.
  constraint tenant_terminology_caracteres_prohibidos check (
    singular !~ '[#$%;<=>]' and plural !~ '[#$%;<=>]'
  ),
  -- Términos de sistema y auditoría: no se renombran. La trazabilidad del §7.4 se apoya en que
  -- «evento» signifique lo mismo en todos los tenants.
  constraint tenant_terminology_sin_terminos_de_sistema check (
    term_key !~ '^(evento|eventos|audit|audit_trail|auditoria|firma|firmas|evidencia|evidence)$'
  )
);
create index tenant_terminology_tenant_key_idx on tenant_terminology (tenant_id, term_key);
comment on table tenant_terminology is
  'PLANIFICACIÓN — cómo llama el tenant a cada cosa. Singular y plural obligatorios, con '
  'límite de largo por tipo (§0) y sin términos de sistema ni de auditoría (§4.4, §7.4).';

-- Las dos entran al snapshot global de configuración (AC-FTEN-13): agregarlas es una fila.
insert into config_versionada (tabla, ac) values
  ('tenant_theme',       'AC-FTEN-10'),
  ('tenant_terminology', 'AC-FTEN-10');
