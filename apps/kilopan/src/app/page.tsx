"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { leerDispositivo } from "@/identidad/cliente/dispositivo.ts";
import { destinoDeIngreso } from "./navegacion.ts";

// Puerta de entrada: sin equipo vinculado -> /vincular; con equipo -> /ingresar
// (esa pantalla, o /inicio si ya hay sesión, deciden el resto).
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const dispositivo = leerDispositivo();
    if (!dispositivo) {
      router.replace("/vincular");
      return;
    }
    // Antes esto mandaba SIEMPRE a /ingresar sin mirar si ya había sesión viva —
    // si el operador seguía logueado, volver a "/" lo hacía teclear el PIN de nuevo,
    // y pan.abrir_sesion() cierra la sesión anterior al abrir la nueva (AC-ID-06):
    // reingresar sin necesidad le cortaba su propia sesión activa.
    fetch("/api/auth/me")
      .then(async (r) => {
        if (!r.ok) {
          router.replace("/ingresar");
          return;
        }
        const cuerpo = await r.json();
        router.replace(destinoDeIngreso(cuerpo.usuario.rol));
      })
      .catch(() => router.replace("/ingresar"));
  }, [router]);
  return null;
}
