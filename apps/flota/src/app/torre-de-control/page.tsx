"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, enfasis, semantico as colorSemantico } from "@kilopan/miga/tokens.ts";
import { semantico } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../cliente/aparato.ts";
import { MapaTorreDeControl } from "./MapaTorreDeControlCliente.tsx";

// La torre de control del gestor [AC-FTEL-04] — §5.7, §11: última posición conocida por
// vehículo EN RUTA, con la ANTIGÜEDAD del dato siempre visible. Mismo criterio de la pantalla
// que `liquidaciones/page.tsx` (AC-FTAR-07): pantalla cliente que solo pide `pedir()`, sin abrir
// la BD por su cuenta — el confinamiento por tenant y por rol vive ENTERO en
// `/api/torre-de-control`.
//
// El mapa DEGRADA, no inventa (§5.7): un vehículo en ruta sin ninguna posición capturada
// todavía aparece en la LISTA con «Sin posición aún» y no entra al mapa (no hay lat/lng que
// dibujar); y si NINGÚN vehículo está en ruta, la pantalla entera cae al estado vacío
// accionable, en vez de un mapa mudo.

type FilaTorreDeControl = {
  vehiculo_id: string;
  patente: string;
  turno_id: string;
  posicion: { lat: number; lng: number; minutos: number; texto: string; desactualizada: boolean } | null;
};

export default function TorreDeControl() {
  const [vehiculos, setVehiculos] = useState<FilaTorreDeControl[] | undefined>(undefined);
  const [error, setError] = useState(false);
  const [sinAcceso, setSinAcceso] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    const respuesta = await pedir("/api/torre-de-control").catch(() => null);
    if (!respuesta) return setError(true);
    if (respuesta.status === 403) return setSinAcceso(true);
    if (!respuesta.ok) return setError(true);
    const { vehiculos: v } = (await respuesta.json()) as { vehiculos: FilaTorreDeControl[] };
    setVehiculos(v);
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (sinAcceso) {
    return (
      <main data-testid="torre-de-control-sin-acceso">
        <h1 style={titulo}>Torre de control</h1>
        <EstadoVacio mensaje="Este panel es de operación o administración." />
      </main>
    );
  }

  return (
    <main data-testid="torre-de-control">
      <h1 style={titulo}>Torre de control</h1>

      {error && (
        <EstadoError
          mensaje="No se pudo cargar la torre de control. Revisá tu conexión."
          alReintentar={() => void cargar()}
        />
      )}
      {vehiculos === undefined && !error && <EstadoCargando filas={4} />}

      {vehiculos && vehiculos.length === 0 && !error && (
        <EstadoVacio mensaje="Ningún vehículo tiene turno abierto ahora. En cuanto un chofer abra turno y capture su primera posición, aparece acá." />
      )}

      {vehiculos && vehiculos.length > 0 && (
        <>
          <div style={bloque}>
            <MapaTorreDeControl
              vehiculos={vehiculos
                .filter((v): v is FilaTorreDeControl & { posicion: NonNullable<FilaTorreDeControl["posicion"]> } => v.posicion !== null)
                .map((v) => ({
                  vehiculo_id: v.vehiculo_id,
                  patente: v.patente,
                  lat: v.posicion.lat,
                  lng: v.posicion.lng,
                  texto: v.posicion.texto,
                  desactualizada: v.posicion.desactualizada,
                }))}
            />
          </div>

          <ul
            data-testid="torre-de-control-lista"
            style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: semantico.espacio.entreControles, marginTop: semantico.espacio.entreTarjetas }}
          >
            {vehiculos.map((v) => (
              <li key={v.vehiculo_id} data-testid={`torre-vehiculo-${v.patente}`} style={tarjeta}>
                <span style={{ ...cuerpo, fontWeight: enfasis.medio }}>{v.patente}</span>
                {v.posicion ? (
                  <span
                    data-testid={`torre-antiguedad-${v.patente}`}
                    style={{
                      ...pie,
                      color: v.posicion.desactualizada ? colorSemantico.alerta : superficie.textoDim,
                      fontWeight: v.posicion.desactualizada ? enfasis.medio : tipografia.pie.peso,
                    }}
                  >
                    {v.posicion.texto}
                    {v.posicion.desactualizada && (
                      <span data-testid={`torre-desactualizada-${v.patente}`}> · Desactualizada</span>
                    )}
                  </span>
                ) : (
                  <span data-testid={`torre-sin-posicion-${v.patente}`} style={{ ...pie, color: superficie.textoFaint }}>
                    Sin posición aún
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const pie = { fontSize: tipografia.pie.tamano, margin: 0 };
const bloque = { marginTop: semantico.espacio.entreTarjetas };
const tarjeta = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: grilla.base,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
};
