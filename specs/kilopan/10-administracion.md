# 10 — Administración (personal, catálogo, parámetros)

Fuente: §3

Superficie de admin de los módulos 1 y 2: lo que el dueño necesita poder cambiar sin que
alguien entre a la BD por SQL. Sin esto, contratar a un repartidor o subir el precio de la
marraqueta exige un técnico — y la panadería deja de operar sola.

Todo lo de esta spec es **solo rol `admin`** (regla de rol testeada, §5).

## Criterios de aceptación

- [ ] (P1) Dar de alta, desactivar, cambiar de rol o resetear el PIN de una persona desde
      la propia app (`/admin` + `POST/PATCH /api/usuarios`). Antes esto solo existía por
      SQL directo contra la BD [AC-ADM-01]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** El endpoint está implementado
      (`exigirRol(["admin"])`, valida RUT/PIN/rol, candado de auto-desactivación), pero
      ningún test (unit, e2e o invariante) llama `POST`/`PATCH /api/usuarios` — nadie lo
      ejercita de forma automatizada.
- [ ] (P1) Dar de alta pan nuevo y editar precios desde la app (`/admin` +
      `POST/PATCH /api/productos`), respetando la vigencia histórica de `precios`: cambiar
      un precio crea una fila nueva, jamás edita la vigente [AC-ADM-02]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Ningún test llama
      `POST`/`PATCH /api/productos`, y en particular ninguno verifica la afirmación
      central — que cambiar el precio crea fila nueva sin pisar la vigente.
- [ ] (P2) Edición de `pan.parametros` desde `/admin`: la pantalla lee y escribe
      `/api/parametros`, así que `clp_km_combustible`, `clp_km_ev` y `co2_g_km_evitado`
      se corrigen sin SQL [AC-ADM-03]
      — **Anexo D (auditoría 2-ago-2026): HUECO.** Cero referencias a `/api/parametros`
      en `*.test.ts`, `*.spec.ts` o `db/test-invariantes.mjs`.

## Notas de implementación

- Desactivar una persona **nunca** la borra: `activo=false`. Los PODs y pesajes que firmó
  siguen siendo suyos y auditables (§4, los dispositivos tampoco se borran).
- Resetear un PIN debe invalidar la sesión viva de esa persona y quedar como evento
  auditable, igual que `pin_bloqueado` (`AC-SEC-01`).
- Cambiar el precio de un producto no puede alterar el `precio_clp` que ya quedó como
  snapshot en `pedido_lineas` ni en `venta_lineas`.
