"use client";
import { useCallback, useEffect, useState } from "react";
import { BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { superficie, semantico } from "@kilopan/miga/tokens.ts";
import { listarRechazados, descartarRechazado, type ItemRechazado } from "@/pod/outbox.ts";
import { Pantalla } from "../Pantalla.tsx";

// AC-POD-06: bandeja de pendientes. Todo lo que la cola NO pudo subir, con el motivo, y
// nada se va de acá sin una decisión del operador.
//
// El defecto que cierra: `sincronizar()` movía a la store `rechazados` lo que el servidor
// devolvía con 4xx —una venta, un pesaje, una entrega— y ahí quedaba. `outbox.ts:129-132`
// lo dice con todas las letras: «la bandeja que la lee (Ola 2) todavía no existe». O sea
// que el dato estaba a salvo en IndexedDB y era invisible: el operador veía desaparecer la
// venta de la cola y suponía que había subido. Se perdía de vista, no del disco.
//
// Es CLIENTE y no Server Component a propósito: los rechazados viven en IndexedDB del
// dispositivo, no en Postgres. El servidor no los conoce ni puede conocerlos — son
// justamente los que nunca llegaron.
export default function PendientesPage() {
  const [items, setItems] = useState<ItemRechazado[] | null>(null);

  const cargar = useCallback(async () => {
    setItems(await listarRechazados());
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function descartar(clientUuid: string) {
    await descartarRechazado(clientUuid);
    await cargar();
  }

  return (
    <Pantalla titulo="Pendientes por revisar">
      {items === null ? (
        <p style={{ color: superficie.textoFaint, margin: 0 }}>Buscando pendientes…</p>
      ) : items.length === 0 ? (
        // Vacío ACCIONABLE, no un «no hay nada» a secas: acá el vacío es la buena noticia
        // y conviene decir por qué, para que nadie lo confunda con un error de carga.
        <p style={{ color: superficie.textoFaint, margin: 0 }}>
          Nada pendiente. Todo lo que se registró en este equipo llegó al servidor.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p role="status" style={{ margin: 0, color: semantico.alerta, fontWeight: 600 }}>
            {items.length} {items.length === 1 ? "registro rechazado" : "registros rechazados"} — el
            servidor no los aceptó
          </p>
          {items.map((item) => (
            <div
              key={item.clientUuid}
              style={{
                border: `1px solid ${superficie.hairline}`,
                borderRadius: 12,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 17 }}>{etiquetaDeTipo(item.tipo)}</strong>
              {/* El MOTIVO es lo que este AC existe para mostrar: sin él la bandeja sería
                  otra lista de cosas que fallaron sin decir por qué. */}
              <span style={{ color: semantico.error, fontSize: 15 }}>{item.motivo}</span>
              <span style={{ color: superficie.textoFaint, fontSize: 13 }}>
                {new Date(item.rechazadoAt).toLocaleString("es-CL")}
              </span>
              <BotonPrimario onClick={() => void descartar(item.clientUuid)}>
                Ya lo resolví — quitar de la bandeja
              </BotonPrimario>
            </div>
          ))}
        </div>
      )}
    </Pantalla>
  );
}

function etiquetaDeTipo(tipo: string): string {
  if (tipo === "venta") return "Venta";
  if (tipo === "pesaje") return "Pesaje";
  if (tipo === "entrega") return "Entrega";
  return tipo;
}
