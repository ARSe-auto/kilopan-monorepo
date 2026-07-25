import { formatearFecha, formatearClp, formatearKg } from "@/comun/formato";
import { acentos } from "@kilopan/miga/tokens";

// Hito 1 (identidad) todavía no existe: esta ruta raíz se reemplaza por el login /
// cambio de operador (F5) en cuanto AC-ID-06 esté cerrado. Por ahora confirma, de
// punta a punta, que Next.js + TypeScript + los formatos es-CL de `comun/` compilan
// y renderizan juntos — es la prueba de humo del esqueleto, no una pantalla del MVP.
export default function Home() {
  const hoy = formatearFecha(new Date());
  return (
    <main style={{ padding: 32, color: "#1B1712" }}>
      <h1 style={{ color: acentos.kilopan, fontWeight: 800 }}>KiloPan</h1>
      <p style={{ fontVariantNumeric: "tabular-nums" }}>
        Esqueleto en construcción — {hoy}. Ejemplo de formato: {formatearKg(14400)} ·{" "}
        {formatearClp(31580)}.
      </p>
    </main>
  );
}
