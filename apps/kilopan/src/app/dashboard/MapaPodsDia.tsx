"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatearKg } from "@/comun/formato.ts";
import { superficie } from "@kilopan/miga/tokens.ts";

interface Pod {
  id: string;
  receptor_nombre: string;
  lat: number;
  lng: number;
  gramos_entregados: number;
  foto_estado: string;
}

export function MapaPodsDia({ pods }: { pods: Pod[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (pods.length === 0) {
    // AC-H0-10: #999 sobre blanco daba 2.84:1 (axe), bajo el 4.5:1 de AA — el mismo
    // matiz "faint" que ya cruzaba el umbral para textoDim vive en el token.
    return (
      <p style={{ fontSize: 13, color: superficie.textoFaint, textAlign: "center" }}>
        Sin entregas hoy aún.
      </p>
    );
  }

  // Calcula el centro del mapa como promedio de todas las coordenadas
  const centerLat = pods.reduce((sum, p) => sum + p.lat, 0) / pods.length;
  const centerLng = pods.reduce((sum, p) => sum + p.lng, 0) / pods.length;

  return (
    <MapContainer
      center={new L.LatLng(centerLat, centerLng)}
      zoom={13}
      style={{ width: "100%", height: 400, borderRadius: 12 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pods.map((pod) => (
        <Marker key={pod.id} position={new L.LatLng(pod.lat, pod.lng)}>
          <Popup>
            <div style={{ fontSize: 12 }}>
              <strong>{pod.receptor_nombre}</strong>
              <br />
              {/* AC-H0-09: `.toFixed(1)` da "12.5 kg" (punto, formato en-US) — formatearKg
                  usa coma decimal es-CL ("12,5 kg"), la misma función que el resto de la app. */}
              {pod.gramos_entregados ? formatearKg(pod.gramos_entregados) : "Sin peso"}
              <br />
              <span style={{ color: "#999", fontSize: 11 }}>
                {pod.foto_estado === "subida" ? "✓ Foto registrada" : "Foto pendiente"}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
