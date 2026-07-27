"use client";
import { useRouter } from "next/navigation";
import { superficie } from "@kilopan/miga/tokens.ts";
import { olvidarOperador } from "@/identidad/cliente/operador.ts";

// Vivía en `inicio/CerrarSesionBoton.tsx`, o sea: solo se podía salir desde /inicio.
// Subió un nivel para que el menú de la barra —disponible en TODAS las pantallas— ofrezca
// lo mismo. Un turno que termina en el mesón no debería tener que buscar la pantalla
// correcta para entregar el equipo.
export function CerrarSesionBoton({ variante = "pildora" }: { variante?: "pildora" | "fila" }) {
  const router = useRouter();
  const esFila = variante === "fila";
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
          router.push("/ingresar?motivo=salida");
        }
      }}
      style={{
        minHeight: 44,
        padding: esFila ? "0 18px" : "0 16px",
        width: esFila ? "100%" : undefined,
        textAlign: esFila ? "left" : "center",
        borderRadius: esFila ? 12 : 100,
        border: `1px solid ${superficie.hairline}`,
        background: superficie.tarjeta,
        fontSize: esFila ? 15 : 14,
        fontWeight: 700,
        color: superficie.textoDim,
      }}
    >
      Salir
    </button>
  );
}
