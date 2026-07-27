"use client";
import Link from "next/link";
import { superficie, acentos } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { Pantalla } from "../Pantalla.tsx";
import { CerrarSesionBoton } from "../CerrarSesionBoton.tsx";
import { useSesion } from "../SesionCliente.tsx";
import { destinosEnMas, ETIQUETA_ROL } from "../navegacion.ts";

// «Más» es el ÚNICO lugar donde queda navegación de menú-y-botón — y es a propósito: acá
// SÍ corresponde (ver navegacion.ts), porque cambiar a Despacho o a Ajustes es irse a
// hacer otra tarea, no seguir la que tenías entre manos. Para el maestro, el vendedor y
// el repartidor esta pantalla sale casi vacía: sus una o dos pantallas ya viven en la
// barra de pestañas, y acá solo les queda ver su nombre/rol y Salir.
export default function MasPage() {
  const sesion = useSesion();
  if (!sesion) return null;

  const destinos = destinosEnMas(sesion.rol);

  return (
    <Pantalla titulo="Más">
      <div>
        <p style={{ margin: 0, fontSize: 13, color: superficie.textoFaint }}>Tu cuenta</p>
        <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800 }}>{sesion.nombre}</p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: superficie.textoFaint }}>
          {ETIQUETA_ROL[sesion.rol]}
        </p>
      </div>

      {destinos.length > 0 ? (
        <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {destinos.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              style={{
                display: "block",
                minHeight: 56,
                padding: "10px 18px",
                borderRadius: 12,
                border: `1px solid ${superficie.hairline}`,
                background: superficie.tarjeta,
                color: superficie.texto,
                textDecoration: "none",
              }}
            >
              <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{d.etiqueta}</span>
              <span style={{ display: "block", fontSize: 13, color: superficie.textoDim, marginTop: 2 }}>
                {d.detalle}
              </span>
            </Link>
          ))}
        </nav>
      ) : (
        // Un rol con una o dos pantallas no tiene por qué leerse como una app pobre:
        // se dice qué hace ese perfil y quién hace el resto.
        <p style={{ fontSize: 13, color: superficie.textoFaint, margin: 0, lineHeight: 1.5 }}>
          Tu perfil trabaja desde{" "}
          <span style={{ fontWeight: 700, color: acentos.kilopan }}>
            {sesion.rol === "maestro" ? "Pesaje" : sesion.rol === "repartidor" ? "Mi ruta" : "tus pestañas"}
          </span>
          , abajo. El resto del día —pedidos, mesón, caja, facturación y panel— lo maneja el
          administrador con su propio RUT.
        </p>
      )}

      <div style={{ marginTop: "auto" }}>
        <CerrarSesionBoton variante="fila" />
      </div>

      <Copyright />
    </Pantalla>
  );
}
