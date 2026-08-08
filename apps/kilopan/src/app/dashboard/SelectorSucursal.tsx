"use client";

import { useRouter } from "next/navigation";
import { superficie } from "@kilopan/miga/tokens.ts";

// AC-SUC-02: AC-SUC-01 (multisucursal ligero) dejó la tabla `pan.sucursales` y la
// herencia por dispositivo funcionando en la BD, pero sin ningún efecto visible en el
// producto — un dueño con más de un local no podía separar "cuánto pesó/vendió cada
// uno" desde acá. Server component (dashboard/page.tsx) solo renderiza este selector
// con 2+ sucursales activas: con una sola, el 95% de las panaderías no ve ni un control
// de más (mismo criterio de diseño de AC-SUC-01).
export function SelectorSucursal({
  sucursales,
  actual,
}: {
  sucursales: { id: string; nombre: string }[];
  actual: string | null;
}) {
  const router = useRouter();

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
      <span style={{ color: superficie.textoFaint }}>Sucursal</span>
      <select
        aria-label="Sucursal"
        value={actual ?? ""}
        onChange={(e) => {
          const valor = e.target.value;
          router.push(valor ? `/dashboard?sucursal=${valor}` : "/dashboard");
        }}
        style={{
          minHeight: 40,
          padding: "0 10px",
          fontSize: 14,
          borderRadius: 8,
          border: `1px solid ${superficie.hairline}`,
          background: superficie.fondo,
          color: superficie.texto,
        }}
      >
        <option value="">Todas las sucursales</option>
        {sucursales.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
