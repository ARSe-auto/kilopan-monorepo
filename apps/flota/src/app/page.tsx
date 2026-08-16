"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EstadoVacio, EstadoError, EstadoCargando } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../cliente/aparato.ts";

// La pantalla de inicio consume el manifest de navegación server-side [AC-FMIG-09] — §5.5, §0.
//
// «Módulo apagado NO se renderiza — sin huecos, candados ni parpadeo»: por eso acá no hay una
// lista fija de módulos con un `if` por delante. Lo único que esta pantalla pinta es lo que
// `/api/manifiesto` mandó — un manifest vacío ES la app mínima (§5.5), no una falla: se pinta
// con el estado vacío accionable, no con el de error.

type ItemDeManifiesto = { lookupKey: string; etiqueta: string; ruta: string };

export default function Inicio() {
  const [items, setItems] = useState<ItemDeManifiesto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/manifiesto").catch(() => null);
    if (!respuesta) return setError("No se pudo leer el menú. Revisá tu conexión.");
    if (!respuesta.ok) return setError("No se pudo leer el menú.");
    const { items: lista } = (await respuesta.json()) as { items: ItemDeManifiesto[] };
    setItems(lista);
    setError(null);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main data-testid="inicio">
      <h1 style={titulo}>FLOTA</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}
      {!error && items === null && <EstadoCargando filas={2} />}
      {!error && items?.length === 0 && (
        <EstadoVacio mensaje="Todavía no hay módulos habilitados para esta cuenta. El administrador los activa desde el panel." />
      )}
      {!error && items && items.length > 0 && (
        <nav data-testid="navegacion" style={lista}>
          {items.map((item) => (
            <Link key={item.lookupKey} href={item.ruta} data-testid={`nav-${item.lookupKey}`} style={enlace}>
              {item.etiqueta}
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const lista = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const enlace = {
  display: "flex",
  alignItems: "center" as const,
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: 500,
  textDecoration: "none",
};
