"use client";

import { useEffect, useState } from "react";
import { superficie, tipografia, grilla, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico as layout } from "@kilopan/miga/estructura.ts";
import { CifraGrande, EstadoCargando, EstadoError, EstadoVacio } from "@kilopan/miga/componentes/index.tsx";
import type { ColorSemaforo, TarjetaHoy } from "../../dominio/semaforo.ts";
import type { FilaPeek } from "../../dominio/peek-n1.ts";
import { TERMINOLOGIA_BASE, type TerminologiaHoy } from "../../dominio/hoy-terminologia.ts";
import { SEMAFORO } from "../../../../../packages/nucleo-comun/src/constants.ts";
import { fechaEsCl, horaEsCl } from "../../../../../packages/nucleo-comun/src/fechas.ts";
import { PeekN1 } from "./peek-n1.tsx";
import { useDigestSemaforo } from "./usar-digest-semaforo.ts";

// Nivel 0 del «Hoy» (spec 05, §2.1) [AC-FSEM-01].
//
// Cero toques en el TABLERO (§5.6-N0): las tarjetas no navegan ni abren nada por sí solas. El
// peek de 1 toque (N1, §2.2) SÍ abre un bottom-sheet sobre las tarjetas amarillo/rojo — es
// justo lo que las distingue de verde, que no comunica nada más que el agregado — y por eso
// no cuenta como navegación (la pila del §5.1 no crece): es estado local de este componente,
// no una ruta [AC-FSEM-04].

// Contraste AAA (7:1) de los indicadores semafóricos + la cifra operativa, en tema CLARO y
// OSCURO [AC-FSEM-12] — §5.7 y §5.1 de docs/PROMPT_MAESTRO_FLOTA.md («dark mode automático de
// serie: los turnos parten de madrugada»). `semantico.ok/alerta/error` de `@kilopan/miga/tokens.ts`
// son los del sistema de diseño general (botones, chips de otras pantallas: ~5:1 sobre blanco,
// de sobra para `CONTRASTE.ui` pero bajo el 7:1 que este AC exige para el indicador que se lee
// desde medio metro al sol) y esa hoja documenta «solo modo claro en el MVP» citando el maestro
// de KiloPan — no el de esta plataforma. Este módulo no toca ese token general (otras pantallas
// dependen de su contrato) ni construye el theming completo de Miga (CSS custom properties desde
// `tenant_theme`, acento derivado — eso es AC-FMIG-02, módulo 08, no construido): define su PROPIO
// par claro/oscuro para esta pantalla nada más, verificado por `hoy-aa-estados.spec.ts` contra
// `CONTRASTE.cifra_operativa_y_semaforos`.
const HOY_TEMA_CSS = `
.hoy-superficie {
  --hoy-bg-pagina: ${superficie.fondo};
  --hoy-bg-tarjeta: ${superficie.tarjeta};
  --hoy-texto: ${superficie.texto};
  --hoy-texto-dim: ${superficie.textoDim};
  --hoy-hairline: ${superficie.hairline};
  --hoy-color-verde: #14532D;
  --hoy-color-amarillo: #78350F;
  --hoy-color-rojo: #991B1B;
  background: var(--hoy-bg-pagina);
  color: var(--hoy-texto);
}
@media (prefers-color-scheme: dark) {
  .hoy-superficie {
    --hoy-bg-pagina: #121212;
    --hoy-bg-tarjeta: #121212;
    --hoy-texto: #F5F5F5;
    --hoy-texto-dim: #A39D91;
    --hoy-hairline: rgba(255, 255, 255, .16);
    --hoy-color-verde: #4ADE80;
    --hoy-color-amarillo: #FCD34D;
    --hoy-color-rojo: #FCA5A5;
  }
}
`;

const FONDO_COLOR: Record<ColorSemaforo, string> = {
  verde: "var(--hoy-color-verde)",
  amarillo: "var(--hoy-color-amarillo)",
  rojo: "var(--hoy-color-rojo)",
};

export function TableroHoy({
  tarjetas: tarjetasIniciales,
  peekPorDominio,
  seed,
  terminologia = TERMINOLOGIA_BASE,
}: {
  tarjetas: TarjetaHoy[];
  peekPorDominio: Record<string, FilaPeek[]>;
  seed: string;
  terminologia?: TerminologiaHoy;
}) {
  const [abiertoDominio, setAbiertoDominio] = useState<string | null>(null);
  // Overrides LOCALES del demo (§ arriba): `id de fila -> nueva estado tras tocar «Reconocer»`.
  // La transición de verdad vive en el servidor; acá solo refleja el toque en la pantalla.
  const [reconocidasLocal, setReconocidasLocal] = useState<ReadonlySet<string>>(new Set());

  // Refresco del digest [AC-FSEM-06]: polling con ETag/304 solo con la pestaña visible; en
  // offline se queda con `tarjetasIniciales`/el último digest bueno, marcado como tal por el
  // banner de abajo — jamás un verde fingido con datos viejos sin decirlo (§2.6).
  const seedDigest = seed === "c" ? "c" : "a";
  const { tarjetas, conectado, intentosFallidos, ultimoDigestEn, cargando, errorManual, refrescarAhora } =
    useDigestSemaforo(seedDigest, tarjetasIniciales);

  // «Skeleton <50 ms, aviso de demora recién pasados los 400 ms» (§5.7) [AC-FSEM-12]: el aviso
  // es una escalada, no el skeleton mismo — aparece SOLO si el refresco manual sigue en curso
  // pasado ese umbral, igual que el patrón gemelo de `pod-estados-obligatorios.spec.ts`.
  const [demora, setDemora] = useState(false);
  useEffect(() => {
    if (!cargando) {
      setDemora(false);
      return;
    }
    const temporizador = setTimeout(() => setDemora(true), 400);
    return () => clearTimeout(temporizador);
  }, [cargando]);

  const tarjetaAbierta = tarjetas.find((t) => t.clave === abiertoDominio) ?? null;
  const filasAbiertas = abiertoDominio ? (peekPorDominio[abiertoDominio] ?? []) : [];
  const filasConOverride = filasAbiertas.map((f) => (reconocidasLocal.has(f.id) ? { ...f, estado: "reconocida" as const } : f));

  return (
    <div className="hoy-superficie" style={{ display: "grid", gap: layout.espacio.entreTarjetas, padding: grilla.base * 2 }}>
      <style>{HOY_TEMA_CSS}</style>
      <BarraRefresco conectado={conectado} intentosFallidos={intentosFallidos} ultimoDigestEn={ultimoDigestEn} onRefrescar={refrescarAhora} />

      {errorManual ? (
        // Error es-CL con recuperación (§5.7) [AC-FSEM-12]: DISTINTO de «sin conexión» — el
        // servidor respondió y respondió mal, no una caída de red. «Reintentar» pide de nuevo.
        <div data-testid="error-hoy">
          <EstadoError mensaje={errorManual} alReintentar={refrescarAhora} />
        </div>
      ) : cargando ? (
        // Skeleton (§5.7) [AC-FSEM-12]: reemplaza la grilla mientras el refresco MANUAL está en
        // curso — el poll de fondo (silencioso) jamás llega a este estado.
        <div data-testid="cargando-hoy">
          <EstadoCargando filas={SEMAFORO.tarjetas_max} />
          {demora ? (
            <p data-testid="aviso-demora-hoy" role="status" style={{ margin: 0, color: "var(--hoy-texto-dim)", fontSize: tipografia.pie.tamano }}>
              Sigue actualizando…
            </p>
          ) : null}
        </div>
      ) : tarjetas.length === 0 ? (
        // Vacío accionable (§5.7) [AC-FSEM-12]: cero dominios evaluados todavía (tenant recién
        // provisionado) — dice qué pasa y ofrece algo real que tocar, no un hueco en blanco.
        <EstadoVacio
          mensaje="Todavía no hay señales configuradas para «Hoy». Actívalas en Funciones, o actualiza si acabas de cambiar la configuración."
          accion={
            <button
              type="button"
              data-testid="cta-vacio-hoy"
              onClick={refrescarAhora}
              style={{
                minHeight: 44,
                padding: `0 ${grilla.base * 2}px`,
                borderRadius: layout.esquina.tarjeta,
                border: `1px solid var(--hoy-hairline)`,
                background: "var(--hoy-bg-tarjeta)",
                color: "var(--hoy-texto)",
                fontSize: tipografia.cuerpo.tamano,
                fontWeight: enfasis.medio,
                alignSelf: "flex-start",
                cursor: "pointer",
              }}
            >
              Actualizar
            </button>
          }
        />
      ) : (
        <div
          data-testid="tablero-hoy"
          style={{
            display: "grid",
            gap: layout.espacio.entreTarjetas,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {tarjetas.map((tarjeta) => (
            <TarjetaDelTablero key={tarjeta.clave} tarjeta={tarjeta} terminologia={terminologia} onAbrir={tarjeta.color === "verde" ? undefined : () => setAbiertoDominio(tarjeta.clave)} />
          ))}
          {tarjetaAbierta ? (
            <PeekN1
              titulo={tarjetaAbierta.titulo}
              filas={filasConOverride}
              seed={seed}
              onCerrar={() => setAbiertoDominio(null)}
              onReconocer={(id) => setReconocidasLocal((previo) => new Set(previo).add(id))}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** `hace N s` / `hace N min` — la antigüedad del último digest recibido con éxito (§2.6). */
function antiguedadTexto(ultimoDigestEn: number): string {
  const segundos = Math.max(0, Math.floor((Date.now() - ultimoDigestEn) / 1000));
  if (segundos < 60) return `hace ${segundos} s`;
  return `hace ${Math.floor(segundos / 60)} min`;
}

/** Pull-to-refresh de respaldo (§2.6) + el estado «sin conexión» del §5.7: cero verde fingido —
 *  cuando el refresco no llega, se dice, con un contador real de intentos y la antigüedad del
 *  último digest bueno. */
function BarraRefresco({
  conectado,
  intentosFallidos,
  ultimoDigestEn,
  onRefrescar,
}: {
  conectado: boolean;
  intentosFallidos: number;
  ultimoDigestEn: number;
  onRefrescar: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: grilla.base, flexWrap: "wrap" }}>
      <button
        type="button"
        data-testid="refrescar-ahora"
        onClick={onRefrescar}
        style={{
          font: "inherit",
          fontSize: tipografia.pie.tamano,
          padding: `${grilla.base / 2}px ${grilla.base}px`,
          borderRadius: layout.esquina.tarjeta,
          border: `1px solid var(--hoy-hairline)`,
          background: "var(--hoy-bg-tarjeta)",
          color: "var(--hoy-texto)",
          cursor: "pointer",
        }}
      >
        Actualizar
      </button>
      {!conectado ? (
        <span
          data-testid="banner-sin-conexion"
          role="status"
          style={{ display: "inline-flex", alignItems: "center", gap: grilla.base / 2, fontSize: tipografia.pie.tamano, color: "var(--hoy-color-rojo)", fontWeight: enfasis.fuerte }}
        >
          Sin conexión —{" "}
          <span data-testid="cola-offline">{intentosFallidos}</span>{" "}
          {intentosFallidos === 1 ? "intento" : "intentos"} sin llegar al servidor · último dato{" "}
          <span data-testid="antiguedad-digest">{antiguedadTexto(ultimoDigestEn)}</span>
        </span>
      ) : null}
    </div>
  );
}

const ESTILO_TARJETA = {
  display: "grid",
  gap: layout.espacio.entreControles,
  padding: `${grilla.base * 2}px`,
  borderRadius: layout.esquina.tarjeta,
  background: "var(--hoy-bg-tarjeta)",
  border: `1px solid var(--hoy-hairline)`,
  color: "var(--hoy-texto)",
  textAlign: "left",
  font: "inherit",
  width: "100%",
} as const;

function TarjetaDelTablero({
  tarjeta,
  terminologia,
  onAbrir,
}: {
  tarjeta: TarjetaHoy;
  terminologia: TerminologiaHoy;
  onAbrir?: () => void;
}) {
  const contenido = <ContenidoDeTarjeta tarjeta={tarjeta} terminologia={terminologia} />;

  // Verde no abre nada (§5.6-N0: no hay peek de un dominio sin excepciones) — sigue siendo
  // un `<article>` de solo lectura. Amarillo/rojo son el toque de entrada al peek (§2.2) y
  // por eso son un `<button>` real: teclado y lector de pantalla lo anuncian como acción.
  if (!onAbrir) {
    return (
      <article data-testid="tarjeta-hoy" data-dominio={tarjeta.clave} data-color={tarjeta.color} style={ESTILO_TARJETA}>
        {contenido}
      </article>
    );
  }
  return (
    <button
      type="button"
      data-testid="tarjeta-hoy"
      data-dominio={tarjeta.clave}
      data-color={tarjeta.color}
      onClick={onAbrir}
      style={{ ...ESTILO_TARJETA, cursor: "pointer" }}
    >
      {contenido}
    </button>
  );
}

function ContenidoDeTarjeta({ tarjeta, terminologia }: { tarjeta: TarjetaHoy; terminologia: TerminologiaHoy }) {
  return (
    <>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: grilla.base }}>
        <h2 style={{ margin: 0, fontSize: tipografia.titulo.tamano, fontWeight: tipografia.titulo.peso }}>
          {tarjeta.titulo}
        </h2>
        {/* AA: el color NUNCA es la única señal — la palabra viaja siempre, aunque el punto
            de color se apague con CSS (§5.6, oráculo conductual verificado en
            `hoy-aa-estados.spec.ts` [AC-FSEM-12]: la etiqueta sigue diciendo el estado con el
            CSS de color apagado y el punto decorativo oculto). */}
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
          {terminologia.etiquetaColor[tarjeta.color]}
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
            {tarjeta.contadorExcepciones === 1 ? terminologia.excepcionSingular : terminologia.excepcionPlural}
          </p>
          {tarjeta.excepcionMasAntigua ? (
            <p data-testid="excepcion-mas-antigua" style={{ margin: 0, fontSize: tipografia.cuerpo.tamano, color: "var(--hoy-texto-dim)" }}>
              {tarjeta.excepcionMasAntigua.descripcion}
              {" — desde "}
              {fechaEsCl(tarjeta.excepcionMasAntigua.record_time)} {horaEsCl(tarjeta.excepcionMasAntigua.record_time)}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
