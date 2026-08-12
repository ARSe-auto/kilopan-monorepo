import { superficie, tipografia, grilla, enfasis, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout } from "@kilopan/miga/estructura.ts";
import { CifraGrande } from "@kilopan/miga/componentes/index.tsx";
import type { ColorSemaforo, TarjetaHoy } from "../../dominio/semaforo.ts";
import { fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";

// Nivel 0 del «Hoy» (spec 05, §2.1) [AC-FSEM-01].
//
// Cero toques (§5.6-N0): esta pantalla no navega ni abre nada — el peek de 1 toque (N1) y el
// detalle (N2) son de AC-FSEM-04/05. Por eso las tarjetas de acá no son botones ni links.

const ETIQUETA_COLOR: Record<ColorSemaforo, string> = {
  verde: "Verde",
  amarillo: "Amarillo",
  rojo: "Rojo",
};

const FONDO_COLOR: Record<ColorSemaforo, string> = {
  verde: colores.ok,
  amarillo: colores.alerta,
  rojo: colores.error,
};

export function TableroHoy({ tarjetas }: { tarjetas: TarjetaHoy[] }) {
  return (
    <div
      data-testid="tablero-hoy"
      style={{
        display: "grid",
        gap: layout.espacio.entreTarjetas,
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
      }}
    >
      {tarjetas.map((tarjeta) => (
        <TarjetaDelTablero key={tarjeta.clave} tarjeta={tarjeta} />
      ))}
    </div>
  );
}

function TarjetaDelTablero({ tarjeta }: { tarjeta: TarjetaHoy }) {
  return (
    <article
      data-testid="tarjeta-hoy"
      data-dominio={tarjeta.clave}
      data-color={tarjeta.color}
      style={{
        display: "grid",
        gap: layout.espacio.entreControles,
        padding: `${grilla.base * 2}px`,
        borderRadius: layout.esquina.tarjeta,
        background: superficie.tarjeta,
        border: `1px solid ${superficie.hairline}`,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: grilla.base }}>
        <h2 style={{ margin: 0, fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso }}>
          {tarjeta.titulo}
        </h2>
        {/* AA: el color NUNCA es la única señal — la palabra viaja siempre, aunque el punto
            de color se apague con CSS (§5.6, oráculo conductual en AC-FSEM-12). */}
        <span
          data-testid="color-tarjeta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: grilla.base / 2,
            fontSize: tipografia.pie.tamano,
            fontWeight: enfasis.fuerte,
            color: FONDO_COLOR[tarjeta.color],
          }}
        >
          <span
            aria-hidden
            style={{
              width: grilla.base,
              height: grilla.base,
              borderRadius: "50%",
              background: FONDO_COLOR[tarjeta.color],
            }}
          />
          {ETIQUETA_COLOR[tarjeta.color]}
        </span>
      </header>

      {tarjeta.color === "verde" ? (
        // Verde = SOLO agregado. Ni contador ni excepción: no hay nada que revisar.
        <div data-testid="agregado-verde">
          <CifraGrande valor={tarjeta.agregadoTexto ?? ""} />
        </div>
      ) : (
        <div style={{ display: "grid", gap: layout.espacio.entreControles }}>
          <p style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.fuerte }}>
            <span data-testid="contador-excepciones">{tarjeta.contadorExcepciones}</span>{" "}
            {tarjeta.contadorExcepciones === 1 ? "excepción" : "excepciones"}
          </p>
          {tarjeta.excepcionMasAntigua ? (
            <p data-testid="excepcion-mas-antigua" style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, color: superficie.textoDim }}>
              {tarjeta.excepcionMasAntigua.descripcion}
              {" — desde "}
              {fechaEsCl(tarjeta.excepcionMasAntigua.record_time)} {horaEsCl(tarjeta.excepcionMasAntigua.record_time)}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
