import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { obtenerDb } from "@/comun/db.ts";
import { NOMBRE_COOKIE } from "@/identidad/sesion.ts";
import { CerrarSesionBoton } from "./CerrarSesionBoton.tsx";

const ENLACES_POR_ROL: Record<string, { href: string; etiqueta: string }[]> = {
  admin: [
    { href: "/dashboard", etiqueta: "Panel del dueño" },
    { href: "/pedidos", etiqueta: "Despacho" },
    { href: "/facturar", etiqueta: "Consolidar y facturar" },
    { href: "/pesar", etiqueta: "Pesaje" },
    { href: "/vender", etiqueta: "Venta mostrador" },
    { href: "/caja", etiqueta: "Cierre de caja" },
    { href: "/admin", etiqueta: "Ajustes" },
  ],
  maestro: [{ href: "/pesar", etiqueta: "Pesaje" }],
  vendedor: [
    { href: "/vender", etiqueta: "Venta mostrador" },
    { href: "/caja", etiqueta: "Cierre de caja" },
  ],
  repartidor: [{ href: "/ruta", etiqueta: "Mi ruta" }],
};

export default async function InicioPage() {
  const cookieStore = await cookies();
  const sesionId = cookieStore.get(NOMBRE_COOKIE)?.value;
  if (!sesionId) redirect("/ingresar");

  const db = await obtenerDb();
  const r = await db.query<{ nombre: string; rol: string }>(
    `select u.nombre, u.rol
       from pan.sesiones_operador s
       join pan.usuarios u on u.id = s.usuario_id
      where s.id = $1 and s.fin is null and u.activo`,
    [sesionId]
  );
  const sesion = r.rows[0];
  if (!sesion) redirect("/ingresar");

  const enlaces = ENLACES_POR_ROL[sesion.rol] ?? [];

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 13, color: "#8A8377", margin: 0 }}>Hola,</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{sesion.nombre}</h1>
        </div>
        <CerrarSesionBoton />
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {enlaces.map((e) => (
          <a
            key={e.href}
            href={e.href}
            style={{
              display: "block",
              minHeight: 56,
              lineHeight: "56px",
              paddingLeft: 18,
              borderRadius: 12,
              border: "1px solid rgba(27,23,18,.14)",
              fontSize: 17,
              fontWeight: 700,
              color: "#1B1712",
              textDecoration: "none",
            }}
          >
            {e.etiqueta}
          </a>
        ))}
      </nav>
    </main>
  );
}
