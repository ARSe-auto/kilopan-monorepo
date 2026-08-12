"use client";

import { useState } from "react";
import { superficie, tipografia, grilla, enfasis, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout, componente } from "@kilopan/miga/estructura.ts";
import type { DetalleN2, TipoEvidenciaN2 } from "../../../dominio/detalle-n2.ts";
import { fechaEsCl, horaEsCl } from "../../../../../../packages/nucleo-comun/src/fechas.ts";

// Detalle N2 [AC-FSEM-05] — spec 05 §2.3.
//
// El ciclo `nueva → reconocida → resuelta` que se ve acá es el MISMO demo local que
// `hoy/peek-n1.tsx` usa para «Reconocer» (AC-FSEM-04): mientras el digest real no exista, la
// pantalla refleja el toque sin llamar al servidor. La transición de verdad —«resolver exige
// nota», `reconocida → resuelta` con 422 si falta— vive en
// `POST /api/semaforo/excepciones/[id]/resolver` (`servidor/review-queue.ts`) y se prueba
// contra una fila real de `review_queue` en `e2e/detalle-n2.spec.ts`.
//
// «El rojo lo exige» (§2.3) se aplica en el peek N1, que NUNCA ofrece resolver — acá, en N2,
// resolver está disponible para cualquier severidad una vez reconocida: es justo el nivel al
// que el rojo está OBLIGADO a llegar para poder cerrarse.

const ETIQUETA_EVIDENCIA: Record<TipoEvidenciaN2, string> = {
  foto: "Foto",
  gps: "GPS estático",
  soc: "Curva SOC",
  sync: "Registros de sync",
};

export function DetalleN2Vista({ detalle }: { detalle: DetalleN2 }) {
  const [estado, setEstado] = useState<"nueva" | "reconocida" | "resuelta">(detalle.estado);
  const [notaEnviada, setNotaEnviada] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [errorNota, setErrorNota] = useState<string | null>(null);

  function enviarResolucion() {
    if (nota.trim() === "") {
      setErrorNota("Resolver exige una nota — no puede quedar vacía.");
      return;
    }
    setErrorNota(null);
    setNotaEnviada(nota.trim());
    setEstado("resuelta");
  }

  return (
    <div data-testid="detalle-n2" style={{ display: "grid", gap: layout.espacio.entreTarjetas }}>
      <header
        data-testid="detalle-cabecera"
        data-severidad={detalle.severidad}
        data-estado={estado}
        style={{ display: "grid", gap: layout.espacio.entreControles }}
      >
        <p style={{ margin: 0, fontSize: tipografia.titulo.tamano, fontWeight: enfasis.fuerte }}>{detalle.quien}</p>
        <p style={{ margin: 0, fontSize: tipografia.cuerpo.tamano }}>
          {detalle.que} — {detalle.cuanto}
        </p>
        <p style={{ margin: 0, fontSize: tipografia.pie.tamano, color: superficie.textoDim }}>
          desde {fechaEsCl(detalle.desde)} {horaEsCl(detalle.desde)}
        </p>
        <p data-testid="detalle-playbook" style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontStyle: "italic" }}>
          {detalle.playbook}
        </p>
        <span data-testid="detalle-estado-texto" style={{ fontSize: tipografia.pie.tamano, fontWeight: enfasis.fuerte }}>
          Estado: {estado}
        </span>
      </header>

      <section data-testid="detalle-timeline" style={{ display: "grid", gap: layout.espacio.entreControles }}>
        <h2 style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.fuerte }}>Timeline</h2>
        {detalle.timeline.length === 0 ? (
          <p data-testid="timeline-vacio" style={{ margin: 0, fontSize: tipografia.pie.tamano, color: superficie.textoDim }}>
            Sin eventos registrados todavía.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: layout.espacio.entreControles }}>
            {detalle.timeline.map((evento) => (
              <li key={evento.id} data-testid="timeline-evento" style={{ fontSize: tipografia.pie.tamano }}>
                <span style={{ color: superficie.textoDim }}>
                  {fechaEsCl(evento.cuando)} {horaEsCl(evento.cuando)} —{" "}
                </span>
                {evento.texto}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="detalle-evidencia" style={{ display: "grid", gap: layout.espacio.entreControles }}>
        <h2 style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.fuerte }}>Evidencia</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: layout.espacio.entreControles }}>
          {detalle.evidencia.map((e) => (
            <li
              key={e.tipo}
              data-testid="evidencia-item"
              data-tipo={e.tipo}
              data-presente={e.presente}
              style={{ fontSize: tipografia.pie.tamano }}
            >
              <strong>{ETIQUETA_EVIDENCIA[e.tipo]}:</strong>{" "}
              {e.presente ? (
                e.detalle
              ) : (
                <span style={{ color: superficie.textoDim, fontStyle: "italic" }}>sin esta evidencia</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="detalle-acciones" style={{ display: "grid", gap: layout.espacio.entreControles }}>
        {/* «Llamar» [AC-FSEM-20] — spec 05 §2.3: acción siempre presente en N2, para
            cualquier estado y severidad — este AC solo exige su PRESENCIA (aserción en el
            e2e); a diferencia de reconocer/resolver/reasignar, no hay número de teléfono en
            el modelo de dominio todavía (`FilaPeek`/`DetalleN2` no traen uno: ni personas ni
            dispositivos exponen un campo de contacto hoy), así que el `tel:` queda vacío a
            propósito — mejora progresiva (§7.6), no un botón fantasma: el texto y el target
            táctil están, la marcación real llega con el campo de teléfono. */}
        <a
          data-testid="detalle-llamar"
          href="tel:"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: componente.objetivoTactil.altoMinPx,
            minWidth: componente.objetivoTactil.anchoMinPx,
            borderRadius: layout.esquina.control,
            border: `1px solid ${superficie.hairline}`,
            color: superficie.texto,
            textDecoration: "none",
            fontSize: tipografia.cuerpo.tamano,
            fontWeight: enfasis.medio,
          }}
        >
          Llamar
        </a>

        {estado === "nueva" ? (
          <button
            type="button"
            data-testid="detalle-reconocer"
            onClick={() => setEstado("reconocida")}
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
        ) : null}

        {estado === "reconocida" ? (
          <div data-testid="detalle-resolver-form" style={{ display: "grid", gap: layout.espacio.entreControles }}>
            <textarea
              data-testid="detalle-resolver-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Nota de resolución (obligatoria)"
              style={{ fontSize: tipografia.cuerpo.tamano, padding: grilla.base, borderRadius: layout.esquina.control }}
            />
            {errorNota ? (
              <p data-testid="detalle-resolver-error" style={{ margin: 0, color: colores.error, fontSize: tipografia.pie.tamano }}>
                {errorNota}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="detalle-resolver-enviar"
              onClick={enviarResolucion}
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
              Resolver
            </button>
          </div>
        ) : null}

        {estado === "resuelta" && notaEnviada ? (
          <p data-testid="detalle-nota-resuelta" style={{ margin: 0, fontSize: tipografia.pie.tamano, color: superficie.textoDim }}>
            Resuelta con nota: «{notaEnviada}»
          </p>
        ) : null}
      </section>
    </div>
  );
}
