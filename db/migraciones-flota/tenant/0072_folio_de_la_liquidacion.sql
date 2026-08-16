-- 0072 — la liquidación cerrada apunta al DTE que la ampara. [AC-FTAR-16]
--
-- El §7.3 es una obligación legal antes que una decisión de arquitectura: la app JAMÁS emite
-- un DTE (art. 97 N°4 del Código Tributario). Lo que sí hace es REFERENCIAR el documento que
-- un emisor autorizado ya emitió — eso es `reference_document`, que existe desde la 0006 como
-- gancho vivo del §4.9. Lo que faltaba es el vínculo: nada ataba ese documento a la
-- liquidación que ampara, así que el registro manual del folio (AC-FTAR-16) no tenía dónde
-- escribirse.
--
-- POR QUÉ UNA COLUMNA EN `liquidaciones` Y NO UNA TABLA `liquidacion_documento`
-- ----------------------------------------------------------------------------
-- La spec deja las dos formas abiertas. Se elige la columna porque la cardinalidad del §3.E1.9
-- es UNO a uno: una liquidación cerrada se ampara en UN documento, y un documento ampara UNA
-- liquidación. Una tabla intermedia solo se paga cuando hay N a N —varios DTE por liquidación,
-- o un DTE que cubre varias— y ninguna de las dos cosas está en E1. Modelar el N a N «por si
-- acaso» costaría hoy un join en cada lectura del portal y una regla de unicidad que nadie
-- puede escribir sin saber cuál de las dos direcciones se abrirá primero.
--
-- POR QUÉ LA FK ES COMPUESTA
-- ---------------------------
-- `(tenant_id, reference_document_id)` contra `(tenant_id, id)`, que es la regla de oro del
-- §4.2 para toda FK de este esquema: una FK simple por `id` dejaría que una liquidación
-- apuntara al documento de OTRO tenant si alguna vez un id se filtrara entre bases. Con la
-- compuesta eso es imposible por construcción, no por cuidado del que escribe la consulta.
--
-- POR QUÉ NULL Y POR QUÉ UN ÍNDICE ÚNICO PARCIAL
-- -----------------------------------------------
-- NULL es el estado normal: una liquidación `abierta` no tiene folio, y por eso el AC pide que
-- registrar uno sobre una abierta rebote 422 —esa regla es del servicio, no de la columna—.
-- El índice ÚNICO parcial (solo sobre las filas que sí tienen documento) es el que hace
-- imposible en la BASE lo que el AC llama «duplicado ⇒ 422 y 0 filas»: el mismo documento no
-- puede amparar dos liquidaciones. Parcial y no total porque, sin el `where`, todas las
-- liquidaciones sin folio colisionarían entre sí en NULL... salvo que Postgres trata los NULL
-- como distintos; el `where` lo hace explícito igual, que es lo que se lee en un `\d` y lo que
-- evita que alguien mañana lo convierta en NOT NULL sin darse cuenta del efecto.

alter table liquidaciones
  add column reference_document_id uuid,
  add constraint liquidaciones_reference_document_fk
    foreign key (tenant_id, reference_document_id) references reference_document (tenant_id, id);

create unique index liquidaciones_documento_unico_idx
  on liquidaciones (tenant_id, reference_document_id)
  where reference_document_id is not null;

comment on column liquidaciones.reference_document_id is
  'El DTE de un tercero que ampara esta liquidación [AC-FTAR-16]. NULL mientras está `abierta`: '
  'el folio se registra a mano recién sobre una `cerrada` y hacerlo sobre una abierta rebota 422 '
  'en el servicio. La app JAMAS emite el documento -- solo lo referencia (§7.3, art. 97 N°4 CT). '
  'El indice unico parcial hace imposible en la BASE que un mismo DTE ampare dos liquidaciones, '
  'que es la mitad de «duplicado ⇒ 422 y 0 filas» que no puede vivir en el codigo.';
