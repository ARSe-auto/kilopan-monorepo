"use client";

import Link from "next/link";
import { superficie, tipografia, grilla, enfasis, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout, componente } from "@kilopan/miga/estructura.ts";
import type { FilaPeek } from "../../dominio/peek-n1.ts";
import { fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";

// Peek N1 [AC-FSEM-04] — spec 05 §2.2.
//
// Bottom-sheet SIN NAVEGACIÓN: es estado local del componente (`abiertoDominio` en
// `tablero-de-hoy.tsx`), jamás un `router.push` — así la pila de navegación del §5.1 no crece
// con el peek, que es justo lo que lo distingue de ser "un nivel más".
//
// El botón «Reconocer» transiciona ESTE demo localmente (fixtures de `semaforo-fixtures.ts`,
// mismo alcance declarado por AC-FSEM-01 mientras el digest real no exista). La transición
// de verdad —`nueva → reconocida` contra `review_queue`, con el 422 tipado de re-reconocer—
// vive en `POST /api/semaforo/excepciones/[id]/reconocer` (`servidor/review-queue.ts`) y se
// prueba contra una fila real en `e2e/peek-n1.spec.ts`.
//
// El «Ver detalle» de cada fila SÍ es un `<Link>` [AC-FSEM-05] — a propósito, y no una
// contradicción con el párrafo de arriba: ese es el «1 toque más» al Nivel 2 (§2.3), un nivel
// de navegación real y distinto del peek, no el peek creciendo. Y por lo mismo el peek NUNCA
// ofrece «Resolver» acá —ni para rojas ni para amarillas—: resolver es acción de N2 (§2.3,
// «el rojo lo exige»); ver `e2e/detalle-n2.spec.ts`.

const ETIQUETA_SEVERIDAD: Record<FilaPeek["severidad"], string> = { rojo: "Rojo", amarillo: "Amarillo" };
const COLOR_SEVERIDAD: Record<FilaPeek["severidad"], string> = { rojo: colores.error, amarillo: colores.alerta };

export function PeekN1({
  titulo,
  filas,
  seed,
  onCerrar,
  onReconocer,
}: {
  titulo: string;
  filas: FilaPeek[];
  seed: string;
  onCerrar: () => void;
  onReconocer: (id: string) => void;
}) {
  return (
    <div
      data-testid="peek-n1-fondo"
      onClick={onCerrar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(27,23,18,.4)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 100,
      }}
    >
      <div
        data-testid="peek-n1"
        role="dialog"
        aria-modal="true"
        aria-label={`Excepciones de ${titulo}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          background: superficie.fondo,
          borderTopLeftRadius: layout.esquina.tarjeta,
          borderTopRightRadius: layout.esquina.tarjeta,
          padding: layout.espacio.margenPantalla,
          display: "grid",
          gap: layout.espacio.entreTarjetas,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: grilla.base }}>
          <h2 style={{ margin: 0, fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso }}>{titulo}</h2>
          <button
            type="button"
            data-testid="peek-cerrar"
            onClick={onCerrar}
            style={{
              minHeight: componente.objetivoTactil.altoMinPx,
              minWidth: componente.objetivoTactil.anchoMinPx,
              border: "none",
              background: "transparent",
              fontSize: tipografia.cuerpo.tamano,
              fontWeight: enfasis.medio,
              color: superficie.textoDim,
            }}
          >
            Cerrar
          </button>
        </header>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: layout.espacio.entreTarjetas }}>
          {filas.map((fila) => (
            <FilaDelPeek key={fila.id} fila={fila} seed={seed} onReconocer={onReconocer} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function FilaDelPeek({
  fila,
  seed,
  onReconocer,
}: {
  fila: FilaPeek;
  seed: string;
  onReconocer: (id: string) => void;
}) {
  return (
    <li
      data-testid="fila-peek"
      data-severidad={fila.severidad}
      data-estado={fila.estado}
      style={{
        display: "grid",
        gap: layout.espacio.entreControles,
        padding: `${grilla.base * 2}px`,
        borderRadius: layout.esquina.tarjeta,
        background: superficie.tarjeta,
        border: `1px solid ${superficie.hairline}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: grilla.base }}>
        <span
          aria-hidden
          style={{ width: grilla.base, height: grilla.base, borderRadius: "50%", background: COLOR_SEVERIDAD[fila.severidad] }}
        />
        <span style={{ fontSize: tipografia.pie.tamano, fontWeight: enfasis.fuerte, color: COLOR_SEVERIDAD[fila.severidad] }}>
          {ETIQUETA_SEVERIDAD[fila.severidad]}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.fuerte, color: superficie.texto }}>{fila.quien}</p>
      <p style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, color: superficie.texto }}>
        {fila.que} — {fila.cuanto}
      </p>
      <p style={{ margin: 0, fontSize: tipografia.pie.tamano, color: superficie.textoDim }}>
        desde {fechaEsCl(fila.desde)} {horaEsCl(fila.desde)}
      </p>
      <p data-testid="playbook" style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, color: superficie.textoDim, fontStyle: "italic" }}>
        {fila.playbook}
      </p>

      {/* Nivel 2 [AC-FSEM-05]: 1 toque más desde acá, y NUNCA un botón «Resolver» en esta
          fila — resolver es solo de N2, para cualquier severidad, incluida la roja. */}
      <Link
        href={`/hoy/excepciones?id=${encodeURIComponent(fila.id)}&seed=${encodeURIComponent(seed)}`}
        data-testid="ver-detalle"
        style={{
          fontSize: tipografia.pie.tamano,
          fontWeight: enfasis.medio,
          color: superficie.textoDim,
          textDecoration: "underline",
        }}
      >
        Ver detalle
      </Link>

      {fila.estado === "nueva" ? (
        <button
          type="button"
          data-testid="reconocer"
          onClick={() => onReconocer(fila.id)}
          style={{
            minHeight: componente.objetivoTactil.altoMinPx,
            minWidth: componente.objetivoTactil.anchoMinPx,
            borderRadius: layout.esquina.control,
            border: "none",
            background: colores.ok,
            color: "#FFFFFF",
            fontSize: tipografia.cuerpo.tamano,
            fontWeight: enfasis.fuerte,
          }}
        >
          Reconocer
        </button>
      ) : (
        <span data-testid="reconocida-marca" style={{ fontSize: tipografia.pie.tamano, color: colores.ok, fontWeight: enfasis.fuerte }}>
          Reconocida
        </span>
      )}
    </li>
  );
}
