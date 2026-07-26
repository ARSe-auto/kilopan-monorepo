# 10 — Administración (personal, catálogo, parámetros)

Fuente: §3

Superficie de admin de los módulos 1 y 2: lo que el dueño necesita poder cambiar sin que
alguien entre a la BD por SQL. Sin esto, contratar a un repartidor o subir el precio de la
marraqueta exige un técnico — y la panadería deja de operar sola.

Todo lo de esta spec es **solo rol `admin`** (regla de rol testeada, §5).

## Criterios de aceptación

- [x] (P1) Dar de alta, desactivar, cambiar de rol o resetear el PIN de una persona desde
      la propia app (`/admin` + `POST/PATCH /api/usuarios`). Antes esto solo existía por
      SQL directo contra la BD [AC-ADM-01]
- [x] (P1) Dar de alta pan nuevo y editar precios desde la app (`/admin` +
      `POST/PATCH /api/productos`), respetando la vigencia histórica de `precios`: cambiar
      un precio crea una fila nueva, jamás edita la vigente [AC-ADM-02]
- [ ] (P2) Edición de `pan.parametros` desde `/admin`: `clp_km_combustible`, `clp_km_ev`,
      `co2_g_km_evitado`. §4 los declara «editables por admin, con fuente» y la tarjeta
      «Tu flota» (`AC-DASH-02`) los consume, pero hoy solo se pueden cambiar por SQL — el
      caso de la van eléctrica se arma con números que el dueño no puede corregir
      [AC-ADM-03]

## Notas de implementación

- Desactivar una persona **nunca** la borra: `activo=false`. Los PODs y pesajes que firmó
  siguen siendo suyos y auditables (§4, los dispositivos tampoco se borran).
- Resetear un PIN debe invalidar la sesión viva de esa persona y quedar como evento
  auditable, igual que `pin_bloqueado` (`AC-SEC-01`).
- Cambiar el precio de un producto no puede alterar el `precio_clp` que ya quedó como
  snapshot en `pedido_lineas` ni en `venta_lineas`.
