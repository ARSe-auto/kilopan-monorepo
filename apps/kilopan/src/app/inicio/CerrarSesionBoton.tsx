"use client";
import { useRouter } from "next/navigation";
import { olvidarOperador } from "@/identidad/cliente/operador.ts";

export function CerrarSesionBoton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        olvidarOperador();
        router.push("/ingresar");
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
