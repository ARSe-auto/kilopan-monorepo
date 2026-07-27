"use client";
import Link from "next/link";
import { superficie, semantico, acentos } from "@kilopan/miga/tokens.ts";

// La pieza central del rediseño (docs/HANDOFF.md §5.3, equivalente de
// `tarjeta-acciones.tsx` del CRM E-Auto Next). Antes, terminar una acción —confirmar un
// pesaje, cobrar una venta— dejaba una línea verde y punto: nada decía qué seguía. Esta
// tarjeta aparece EN EL MISMO SITIO donde vivía esa línea y hace dos cosas:
//   1. Confirma qué acaba de pasar (lo que antes decía la línea verde).
//   2. Ofrece el paso siguiente — pero SOLO cuando de verdad hay otra tarea a la que
//      saltar (vender lo que se acaba de pesar, armar la ruta de un pedido que se
//      completó). Cuando lo que sigue es simplemente seguir haciendo lo mismo —otra
//      bandeja del mismo producto—, la pantalla ya está lista para eso sin botón: el
//      teclado quedó limpio y el producto sigue elegido. Forzar un botón para una acción
//      que no requiere ninguna sería inventar un clic que antes no hacía falta.
export interface AccionSiguiente {
  etiqueta: string;
  href?: string;
  onClick?: () => void;
}

export function SiguientePaso({
  texto,
  detalle,
  acciones,
}: {
  texto: string;
  detalle?: string;
  acciones?: AccionSiguiente[];
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 14,
        background: "#F0FDF4",
        border: "1px solid rgba(21,128,61,.25)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span aria-hidden style={{ color: semantico.ok, fontSize: 17, lineHeight: "22px" }}>
          ✓
        </span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: superficie.texto }}>{texto}</p>
          {detalle ? (
            <p style={{ margin: "2px 0 0", fontSize: 13, color: superficie.textoDim }}>{detalle}</p>
          ) : null}
        </div>
      </div>

      {acciones && acciones.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {acciones.map((a, i) => {
            const primaria = i === 0;
            const estilo = {
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 16px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              border: primaria ? "none" : `1px solid ${superficie.hairline}`,
              background: primaria ? acentos.kilopan : superficie.tarjeta,
              color: primaria ? "#fff" : superficie.texto,
            };
            return a.href ? (
              <Link key={a.etiqueta} href={a.href} style={estilo}>
                {a.etiqueta}
              </Link>
            ) : (
              <button key={a.etiqueta} type="button" onClick={a.onClick} style={{ ...estilo, border: primaria ? "none" : estilo.border }}>
                {a.etiqueta}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
