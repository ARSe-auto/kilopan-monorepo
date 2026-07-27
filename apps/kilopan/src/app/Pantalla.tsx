"use client";
import { superficie } from "@kilopan/miga/tokens.ts";
import { ChipOperador } from "@kilopan/miga/componentes/index.tsx";
import { useSesion } from "./SesionCliente.tsx";

// Encabezado único de todas las pantallas — mismo patrón que `Pantalla` del CRM E-Auto
// Next: título grande, un accesorio a la derecha, y el contenido debajo.
//
// Resuelve dos cosas que estaban rotas:
//   1. Cada pantalla se dibujaba su propio encabezado a mano, con tamaños distintos
//      (22/700 en unas, 24/800 en otras) y con el enlace «← Menú» presente o ausente
//      según el estado interno. Ahora el encabezado es UNO y no depende del estado.
//   2. El chip del operador (AC-ID-07) flotaba en `position: fixed` sobre la esquina
//      superior derecha, ENCIMA del contenido: en /pesar caía justo sobre el botón
//      «Cambiar». Ahora va en el flujo, dentro del encabezado, y no tapa nada.
export function Pantalla({
  titulo,
  bajada,
  accesorio,
  children,
  ancho = 480,
}: {
  titulo: string;
  /** Una línea que dice qué se hace acá. Opcional: en las pantallas de paso (elegir
   *  producto) sobra, en las de tarea (cierre de caja) evita tener que adivinar. */
  bajada?: string;
  /** Lo que la pantalla necesite a la derecha del título: chip de conexión, «Cambiar». */
  accesorio?: React.ReactNode;
  children: React.ReactNode;
  ancho?: number;
}) {
  const sesion = useSesion();
  return (
    <main
      style={{
        maxWidth: ancho,
        margin: "0 auto",
        padding: "16px 20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        flex: 1,
        width: "100%",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* El operador va PRIMERO y en su propia fila: en una tablet de mesón que pasa de
            mano en mano, saber bajo qué nombre estás escribiendo es previo a todo lo
            demás, y así nunca compite por el ancho con el título ni con el accesorio. */}
        {sesion ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <ChipOperador nombre={sesion.nombre} anchoMaximo={220} />
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              {titulo}
            </h1>
            {bajada ? (
              <p style={{ margin: "4px 0 0", fontSize: 14, color: superficie.textoDim, lineHeight: 1.4 }}>{bajada}</p>
            ) : null}
          </div>
          {accesorio ? <div style={{ flexShrink: 0 }}>{accesorio}</div> : null}
        </div>
      </header>
      {children}
    </main>
  );
}
