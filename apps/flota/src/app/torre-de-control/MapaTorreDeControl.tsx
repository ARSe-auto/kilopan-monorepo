"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { superficie, semantico, tipografia, grilla } from "@kilopan/miga/tokens.ts";

// El mapa de la torre de control [AC-FTEL-04] — §5.7, §11. Mismo patrón que
// `apps/kilopan/.../MapaPodsDia.tsx`: react-leaflet toca `window` al cargar el módulo, así que
// este componente solo se monta en el cliente (ver `MapaTorreDeControlCliente.tsx`).

export type VehiculoConMapa = {
  vehiculo_id: string;
  patente: string;
  lat: number;
  lng: number;
  texto: string;
  desactualizada: boolean;
};

export function MapaTorreDeControl({ vehiculos }: { vehiculos: VehiculoConMapa[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (vehiculos.length === 0) {
    return (
      <p data-testid="torre-mapa-vacio" style={{ fontSize: tipografia.pie.tamano, color: superficie.textoFaint, textAlign: "center" }}>
        Ningún vehículo en ruta trae una posición todavía.
      </p>
    );
  }

  const centerLat = vehiculos.reduce((sum, v) => sum + v.lat, 0) / vehiculos.length;
  const centerLng = vehiculos.reduce((sum, v) => sum + v.lng, 0) / vehiculos.length;

  return (
    <div data-testid="torre-mapa">
      <MapContainer
        center={new L.LatLng(centerLat, centerLng)}
        zoom={11}
        style={{ width: "100%", height: 360, borderRadius: grilla.radio }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {vehiculos.map((v) => (
          <Marker key={v.vehiculo_id} position={new L.LatLng(v.lat, v.lng)}>
            <Popup>
              <div style={{ fontSize: 12 }}>
                <strong>{v.patente}</strong>
                <br />
                {v.texto}
                {v.desactualizada && (
                  <>
                    {" — "}
                    <span style={{ color: semantico.alerta }}>desactualizada</span>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
