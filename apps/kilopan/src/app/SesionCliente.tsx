"use client";
import { createContext, useContext } from "react";
import type { Rol } from "./navegacion.ts";

// La sesión la lee el layout en el servidor (cookie HttpOnly: el cliente no puede verla).
// Esto la baja a las pantallas de cliente SIN exponer nada nuevo — solo nombre y rol, que
// ya viajaban en el chip del operador. Sirve para que una pantalla decida qué ofrecer:
// /pesar sin pedidos que esperen el producto le muestra al admin el atajo a Despacho y al
// maestro le dice a quién pedírselo, en vez de mandarlos a los dos a una pantalla que uno
// de los dos no puede abrir.
export interface SesionCliente {
  nombre: string;
  rol: Rol;
}

const Contexto = createContext<SesionCliente | null>(null);

export function ProveedorSesion({
  sesion,
  children,
}: {
  sesion: SesionCliente | null;
  children: React.ReactNode;
}) {
  return <Contexto.Provider value={sesion}>{children}</Contexto.Provider>;
}

/** null en /ingresar y /vincular — no hay sesión que mostrar ahí. */
export function useSesion(): SesionCliente | null {
  return useContext(Contexto);
}
