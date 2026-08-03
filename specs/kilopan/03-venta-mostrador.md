# 03 — Venta mostrador

Fuente: §3

Módulo 3 de los siete. Venta táctil en ≤3 toques contra el stock pesado. La boleta la
emite el facturador que la panadería **ya usa**; la app registra la venta interna y
jamás genera un documento con apariencia tributaria (§7, art. 97 N°4 CT).

Sin venta en ruta — está explícitamente FUERA del MVP (§3).

## Criterios de aceptación

- [x] (P1) F6 Venta contra stock pesado, probado en vivo: pesados 5,000 kg → vendidos
      0,500 kg a $1.095 → quedan 4,500 kg, con `pan.stock_disponible()` derivando todo
      de eventos (pesajes − venta_lineas) y nunca de un contador guardado. Productos sin
      stock quedan deshabilitados en pantalla [AC-VEN-02]
- [x] (P2) Catálogo de medios de pago editable por admin (decisión #5): tabla
      `pan.medios_pago` precargada con los 8 medios; `pan_app` puede prender/apagar
      (`activo`) pero NO borrar ni renombrar — probado [AC-PAG-01]
- [x] (P2) Fiado en mostrador reutiliza el MISMO cliente y saldo que el del reparto —
      cero segundo sistema de crédito. Probado por HTTP: sin cliente rebota con mensaje
      claro, con cliente entra y suma al saldo [AC-PAG-02]
      — **Auditoría de `saldado_at` (3-ago-2026), `0022`.** `saldado_at` (`0017`) tiene la
      misma forma que `anulada_at` —NULL/timestamp con `grant update` column-level a
      `pan_app`— y nunca se había revisado como la `0021` revisó a su hermana. Se revisó
      ahora, consumidor por consumidor, midiendo cada caso bajo `set role pan_app` sobre las
      migraciones reales. **Cuatro huecos, los cuatro con su invariante:**
      (1) **el pago era reversible** — `set saldado_at = null` pasaba y la deuda pagada
      revivía ($0 → $12.000). Peor que en la anulación: marcar saldada no escribe ningún
      evento, así que la columna es el ÚNICO registro del pago y devolverla a NULL lo
      borraba sin rastro. (2) **la fecha del pago era reescribible** — se podía fechar el
      pago en 2020 sobre una venta de 2026. (3) **se podía marcar pagada una venta
      ANULADA**, con la sentencia exacta de `PATCH /api/ventas`: la fila quedaba afirmando
      «no existe» y «la pagaron» a la vez — el falso registro contra el que advierte la
      cabecera de la `0021`. (4) **se podía saldar una venta en efectivo**, que nunca fue
      deuda; no rompía ningún saldo sólo porque `pan.saldo_cliente` filtra además
      `medio_pago`, o sea la única defensa era que el consumidor se acordara de filtrar.
      Se arreglan con `trg_ventas_saldado_inmutable` (mismo patrón que
      `trg_anulacion_inmutable`, `0021`) y el CHECK `ventas_saldado_solo_fiado`.
      — **Al revés SÍ se permite, a propósito:** anular una venta que el cliente ya pagó es
      la devolución con reembolso, y prohibirlo dejaría a la dueña sin deshacer una venta
      mal registrada sin entrar por SQL (`AC-ADM-05`). Por eso la regla es un trigger y no
      un CHECK de exclusión mutua: depende de la DIRECCIÓN del cambio, que un CHECK no ve.
      — **Decisiones, no olvidos** (escritas para que nadie vuelva a auditar lo mismo). Los
      consumidores de `pan.ventas` son exactamente estos, y ninguno de los que siguen debe
      filtrar `saldado_at`: `pan.conciliacion_diaria` (`0005`, CTE `vendido`) mide kilos
      físicos y el pan salió del local se haya pagado o no — filtrarlo rompería la TCK;
      `GET`/`POST /api/cierre-caja` miden la plata del turno en que se vendió, y un fiado
      cobrado la semana siguiente no cambia lo que pasó ese turno; las dos consultas de
      idempotencia por `client_uuid` en `/api/ventas` sólo resuelven «¿ya existe esta
      venta?»; `POST /api/ventas/anular` no lo filtra porque anular una venta pagada es
      válido (ver arriba). Sí lo filtra, y debe, `pan.saldo_cliente` (`0017`). Heredan de
      esas dos vistas `GET /api/clientes` y `/dashboard`, y están bien. El único escritor es
      `PATCH /api/ventas`, que desde la `0022` filtra además `anulada_at is null` para
      devolver 409 en vez del 500 del trigger.
      — **Hallazgo abierto, sin decisión tomada:** cobrar un fiado no entra a NINGÚN arqueo.
      El pago no crea fila en `pan.ventas`, así que la plata del fiado cobrado hoy llega a
      la caja sin que ningún `esperado_clp` la espere, y el turno cierra con sobrante todas
      las veces. No es un hueco de `saldado_at` —es que el pago no está modelado como
      movimiento de caja— y por eso no se arregló acá: necesita decisión de producto.
- [x] (P1) Pantalla de cierre de caja: `/caja` (182 líneas) muestra esperado, declarado
      y la diferencia. Ejercitada por el e2e «7 · la caja se cuenta a ciegas: el vendedor
      no ve lo esperado antes de contar» [AC-VEN-03]
- [ ] (P2) Pantalla de admin para togglear medios de pago: `SeccionMediosPago` en
      `/admin` lee `/api/medios-pago` y permite prender/apagar sin borrar ni renombrar
      [AC-PAG-03]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Cero tests tocan `SeccionMediosPago`
      ni `PATCH /api/medios-pago` — ni e2e, ni unit, ni HTTP. `AC-PAG-01` cubre el
      permiso a nivel BD, no esta pantalla ni este endpoint.

- [ ] (P0) **Apertura de turno** al primer ingreso del día en un equipo: fondo inicial y
      confirmación, dos toques. La tabla `pan.turnos` y el arqueo por turno ya existen
      (`db/migraciones/0018_turnos_cierre_caja.sql`); lo que falta es la pantalla que abre
      el turno. Sin ella el arqueo tiene sujeto en la base pero nadie lo declara desde la
      app (`docs/PROMPT_CORRECTIVO.md` §5, Ola 2) [AC-VEN-05]

## Notas de implementación

- El stock se deriva **siempre** de eventos. Cualquier contador materializado sería una
  segunda fuente de verdad y rompería la TCK, que se calcula desde los mismos eventos.
- `AC-DASH-04` (lectura de totales del facturador) vive en la spec 07 porque su pantalla
  es el dashboard, pero su dato nace en este módulo.
