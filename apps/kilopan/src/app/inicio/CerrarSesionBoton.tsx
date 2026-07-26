"use client";
import { useRouter } from "next/navigation";
import { olvidarOperador } from "@/identidad/cliente/operador.ts";

export function CerrarSesionBoton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        // try/finally: sin esto, un logout sin señal lanzaba en el fetch y NUNCA
        // llegaba a limpiar el operador local ni a navegar — el panadero veía que no
        // pasaba nada, dejaba la tablet, y el siguiente turno entraba a una sesión
        // que seguía viva y vendía con el nombre anterior (auditoría de experiencia).
        // La cookie del servidor la corta igual la expiración por inactividad
        // (AC-ID-05) y el próximo login desplaza la sesión (AC-ID-06).
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          // sin señal: salir del equipo IGUAL es lo correcto
        } finally {
          olvidarOperador();
          router.push("/ingresar");
        }
      }}
      style={{
        minHeight: 44,
        padding: "0 16px",
        borderRadius: 100,
        border: "1px solid rgba(27,23,18,.14)",
        background: "#FFFFFF",
        fontSize: 14,
        fontWeight: 700,
        color: "#5B564C",
      }}
    >
      Salir
    </button>
  );
}
