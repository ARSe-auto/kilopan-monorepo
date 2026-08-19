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

// Ícono propio en vez del pin por defecto de Leaflet: el pin por defecto es un <img alt="Marker">
// indistinguible entre vehículos, y el AC exige probar que un vehículo SIN posición jamás recibe
// un punto inventado (§5.7) — sin un testid por patente, esa prueba solo podría afirmar «el mapa
// entero está vacío», algo que deja de ser cierto en cuanto CUALQUIER otra suite hermana del mismo
// tenant `hechos` (AC-FTEL-01/03) ya capturó una posición. El testid por patente prueba lo mismo
// sin depender de que el tenant compartido esté, además, vacío.
function iconoDeVehiculo(v: VehiculoConMapa) {
  const color = v.desactualizada ? semantico.alerta : semantico.ok;
  return L.divIcon({
    className: "",
    html: `<div data-testid="torre-marcador-${v.patente}" style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

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
          <Marker key={v.vehiculo_id} position={new L.LatLng(v.lat, v.lng)} icon={iconoDeVehiculo(v)}>
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
