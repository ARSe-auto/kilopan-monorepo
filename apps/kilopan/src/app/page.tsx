"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { leerDispositivo } from "@/identidad/cliente/dispositivo.ts";

// Puerta de entrada: sin equipo vinculado -> /vincular; con equipo -> /ingresar
// (esa pantalla, o /inicio si ya hay sesión, deciden el resto).
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const dispositivo = leerDispositivo();
    router.replace(dispositivo ? "/ingresar" : "/vincular");
  }, [router]);
  return null;
}
