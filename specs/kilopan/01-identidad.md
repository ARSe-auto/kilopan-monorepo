# 01 — Identidad y dispositivos

Fuente: §3

Módulo 1 de los siete. Todo lo demás depende de esto: sin sesión de operador viva no hay
escritura (trigger, no disciplina de la app). Todo write lleva
`usuario_id + dispositivo_id + hora del servidor`.

Roles fijos: `admin`, `maestro`, `vendedor`, `repartidor`. Dispositivos compartidos con
cambio de operador por PIN — el equipo vive en un local, no se elige a mano.

## Criterios de aceptación

- [x] (P0) Trigger genérico `pan.trg_exige_sesion()`: ningún INSERT/UPDATE de negocio
      pasa sin sesión de operador viva. SECURITY DEFINER, probado por el camino HTTP con
      `SET ROLE` real y no por acceso directo. Cableado en `pesajes` y `hornadas`; se
      reusa tal cual en cada tabla de negocio nueva [AC-ID-02]
- [x] (P0) PIN de 4 dígitos hasheado, nunca en texto plano en logs ni en
      `eventos.payload`. Sustitución deliberada: `node:crypto` scrypt en vez de bcrypt
      (memory-hard, sin dependencia nueva que auditar). `POST /api/auth/login` probado
      en vivo: PIN correcto entra, incorrecto rebota, 5º fallido bloquea con 423 y el
      PIN correcto ya no sirve hasta que expire [AC-ID-03]
- [x] (P0) 1 sesión activa concurrente por usuario: sesión nueva desplaza la anterior y
      escribe fila de auditoría `sesion_desplazada` (`trg_desplazar_sesiones`) [AC-ID-04]
- [x] (P0) Auto-bloqueo a PIN tras 10 min de inactividad, validado **en el servidor**
      (`pan.sesion_expirada` + `tocar_sesion`), no solo en la UI: un cliente adulterado
      simplemente no llamaría al cierre. Una sesión inexistente se trata como expirada,
      nunca como válida [AC-ID-05]
- [x] (P1) F5 Cambio de operador en equipo compartido: `pan.abrir_sesion()` hace el
      relevo atómico y auditado (evento `operador_relevado`). Bug real encontrado
      probando el login: el EXCLUDE impedía que el vendedor tomara la tablet que dejó el
      maestro y devolvía 500 [AC-ID-06]
- [x] (P1) Chip con el nombre del operador **siempre visible** en cada pantalla, como
      exige §5 F5. Hoy el relevo funciona pero el chip no existe: quien pesa no puede
      confirmar de un vistazo bajo qué identidad está escribiendo. Test: recorrer las
      rutas de operación con sesión abierta y fallar si alguna no muestra el nombre
      [AC-ID-07] — chip fijo en top-right de todas las pantallas, renderizado por
      Server Component con la sesión actual

## Notas de implementación

- El PIN de 4 dígitos son 10.000 combinaciones. El bloqueo por intentos (`AC-SEC-01`,
  spec 08) no es opcional aunque el maestro no lo pidiera explícitamente.
- `secreto_hash` del dispositivo vive en IndexedDB del cliente: garantía menor que
  Keychain, declarada a propósito en §4.
- Los dispositivos nunca se borran (`revocado_at`, jamás DELETE).
