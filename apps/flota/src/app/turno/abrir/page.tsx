"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BotonPrimario,
  CifraGrande,
  TecladoNumerico,
  EstadoVacio,
  EstadoError,
} from "@kilopan/miga/componentes/index.tsx";
import { tipografia, superficie, grilla, semantico as colorSemantico, enfasis } from "@kilopan/miga/tokens.ts";
import { semantico, componente } from "@kilopan/miga/estructura.ts";
import { pedir } from "../../../cliente/aparato.ts";
import { semaforoDeSalida, type Semaforo } from "../../../../../../packages/nucleo-comun/src/energia.ts";

// La apertura del turno (F3) [AC-FVEH-10] — §5.2-F3, §5.3, §5.7, §7.6, §0.
//
// ─── EL PRESUPUESTO DE TOQUES ES EL DISEÑO, NO UNA CONSECUENCIA ────────────────────
//
// El §5.3 fija ≤9 acciones para la apertura, y la pantalla se arma desde ahí:
//
//   1 · elegir el vehículo (chip)          4 · confirmar el odómetro
//   2 · «Está todo bien» del chequeo pre   5 · el campo de la carga (teclado propio = 1)
//   3 · el campo del odómetro (1 acción)   6 · confirmar la carga      7 · «Abrir turno»
//
// Siete, con dos de margen para el ítem fallado que el §5.2-F3 cuenta como +2. Cada paso de
// confirmación que alguien agregue «por seguridad» se come ese margen, y por eso el e2e cuenta.
//
// ─── OK-POR-DEFECTO: EL CAMINO FELIZ ES UN BOTÓN ───────────────────────────────────
//
// «Solo se toca lo malo» (§5.2-F3). El chequeo pre entero se despacha con «Está todo bien»;
// marcar un ítem cuesta sus dos toques y NO BLOQUEA nada (§7.6). Si un ítem fallado detuviera
// la apertura, la persona aprendería a no marcar ninguno — y perderíamos justo el dato por el
// que existe el chequeo.
//
// ─── EL TECLADO ES PROPIO. EL DEL SISTEMA JAMÁS APARECE (§5.7) ────────────────────
//
// No hay un solo `<input>` en esta pantalla. El del sistema abre con autocorrector encima del
// campo, tapa media pantalla y en terreno con guantes es inusable. La convención del §5.3 dice
// que un campo de teclado propio cuenta como UNA acción sin importar cuántos dígitos tenga.
//
// ─── EL SEMÁFORO SIEMPRE CON TEXTO ────────────────────────────────────────────────
//
// «Alcanza / No alcanza — recarga antes» escrito, nunca solo color (§5.2-F3, §5.1). Y un tercer
// estado que no es un color de advertencia sino la ausencia de respuesta: sin datos EV cargados
// no se afirma nada, se dice qué falta (§5.7). Verde afirmaría que el vehículo llega.

type Vehiculo = {
  id: string;
  patente: string;
  activo: boolean;
  autonomia_nominal_km: number | null;
  soh_pct: number | null;
  soc: number | null;
};

type Paso = "vehiculo" | "chequeo" | "odometro" | "carga" | "semaforo";

/** El texto del semáforo. Va acá y no en el componente: es la frase del §5.2-F3, literal. */
const TEXTO_DEL_SEMAFORO: Record<Semaforo, string> = {
  alcanza: "Alcanza",
  no_alcanza: "No alcanza — recargá antes de salir",
  sin_datos: "Falta cargar la ficha de este vehículo para saber si alcanza",
};

export default function AbrirTurno() {
  const [vehiculos, setVehiculos] = useState<Vehiculo[] | null>(null);
  const [elegido, setElegido] = useState<Vehiculo | null>(null);
  const [paso, setPaso] = useState<Paso>("vehiculo");
  const [fallados, setFallados] = useState<string[]>([]);
  const [odometro, setOdometro] = useState("");
  const [carga, setCarga] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  /** Lo que le dejó dicho quien manejó antes ESTE vehículo (§5.2-F5 → §5.2-F3). */
  const [nota, setNota] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const respuesta = await pedir("/api/vehiculos").catch(() => null);
    if (!respuesta?.ok) return setError("No se pudo leer la flota. Revisá tu conexión.");
    const { vehiculos: lista } = (await respuesta.json()) as { vehiculos: Vehiculo[] };
    setVehiculos(lista.filter((v) => v.activo));
    return undefined;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** El semáforo del §5.2-F3, con la fórmula única (§0). Sin plan del día no se afirma nada. */
  const semaforo: Semaforo = useMemo(() => {
    if (!elegido) return "sin_datos";
    const soc = carga === "" ? elegido.soc : Number(carga);
    return semaforoDeSalida(
      soc,
      // El «necesario» sale del plan del día, que lo suministra el hito (d)
      // (`rutas.km_presupuesto_energia`). Hasta entonces no hay contra qué comparar y el
      // semáforo dice que faltan datos, en vez de inventar un veredicto.
      null,
      { autonomiaNominalKm: elegido.autonomia_nominal_km, sohPct: elegido.soh_pct },
    );
  }, [elegido, carga]);

  async function abrir() {
    setError(null);
    const respuesta = await pedir("/api/turnos", {
      method: "POST",
      body: JSON.stringify({ vehiculo_id: elegido?.id }),
    }).catch(() => null);
    if (!respuesta) return setError("No se pudo abrir el turno. Revisá tu conexión.");
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { mensaje?: string };
      return setError(cuerpo.mensaje ?? "No se pudo abrir el turno.");
    }
    const { turno } = (await respuesta.json()) as { turno: { id: string } };

    // El chequeo pre y las dos lecturas viajan DESPUÉS de abrir, porque cuelgan del turno. Las
    // tres son CAPTURA: si alguna fallara, el turno ya está abierto y la persona puede trabajar
    // — que es exactamente lo que el §4.2 protege.
    await pedir("/api/chequeos", {
      method: "POST",
      body: JSON.stringify({
        inspectable_tipo: "vehiculos",
        inspectable_id: elegido?.id,
        momento: "pre",
        turno_id: turno.id,
        fallados,
        client_uuid: crypto.randomUUID(),
        ts_dispositivo: new Date().toISOString(),
      }),
    }).catch(() => null);

    for (const [magnitud, valor] of [
      ["odometro", odometro],
      ["soc", carga],
    ] as const) {
      if (valor === "") continue;
      await pedir("/api/lecturas", {
        method: "POST",
        body: JSON.stringify({
          magnitud,
          valor: Number(valor),
          turno_id: turno.id,
          client_uuid: crypto.randomUUID(),
          ts_dispositivo: new Date().toISOString(),
        }),
      }).catch(() => null);
    }

    setAbierto(true);
    return undefined;
  }

  if (abierto) {
    return (
      <main data-testid="turno-abierto">
        <h1 style={titulo}>Turno abierto</h1>
        <p style={cuerpo}>Ya podés salir. Buen viaje.</p>
      </main>
    );
  }

  return (
    <main data-testid="pantalla-apertura">
      <h1 style={titulo}>Tu turno de hoy</h1>
      {error && <EstadoError mensaje={error} alReintentar={() => void cargar()} />}

      {paso === "vehiculo" && (
        <section data-testid="paso-vehiculo" style={bloque}>
          <h2 style={subtitulo}>¿Con qué vehículo salís?</h2>
          {vehiculos?.length === 0 && (
            <EstadoVacio mensaje="No hay vehículos activos en tu flota. Pedile a quien administra que dé de alta uno." />
          )}
          <div style={chips}>
            {vehiculos?.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`vehiculo-${v.patente}`}
                onClick={() => {
                  setElegido(v);
                  setPaso("chequeo");
                  void (async () => {
                    const r = await pedir(`/api/chequeos/nota?vehiculo_id=${v.id}`).catch(() => null);
                    if (r?.ok) setNota(((await r.json()) as { nota: string | null }).nota);
                  })();
                }}
                style={chip}
              >
                {v.patente}
              </button>
            ))}
          </div>
        </section>
      )}

      {paso === "chequeo" && (
        <section data-testid="paso-chequeo" style={bloque}>
          {/* La nota del turno ANTERIOR de este mismo vehículo (§5.2-F5 → §5.2-F3). Solo
              aparece si existe: un recuadro casi siempre vacío enseña a no mirarlo, y el día
              que traiga algo importante nadie lo lee. */}
          {nota && (
            <p data-testid="nota-del-turno-anterior" style={textoNota}>
              Del turno anterior: {nota}
            </p>
          )}
          <h2 style={subtitulo}>Antes de salir, ¿está todo bien?</h2>
          {/* OK-POR-DEFECTO (§5.2-F3): el camino feliz es UN toque. Marcar algo cuesta sus dos
              y no bloquea nada — si bloqueara, la persona aprendería a no marcar. */}
          <BotonPrimario testid="todo-bien" onClick={() => setPaso("odometro")}>
            Está todo bien
          </BotonPrimario>
          <div style={chips}>
            {["Luces", "Frenos", "Neumáticos", "Carrocería"].map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`falla-${item}`}
                aria-pressed={fallados.includes(item)}
                onClick={() =>
                  setFallados((previos) =>
                    previos.includes(item) ? previos.filter((f) => f !== item) : [...previos, item],
                  )
                }
                style={fallados.includes(item) ? chipMarcado : chip}
              >
                {fallados.includes(item) ? "✓ " : ""}
                {item}
              </button>
            ))}
          </div>
          {fallados.length > 0 && (
            <>
              {/* El §7.6 con sujeto: se dice que NO bloquea, para que la persona marque sin
                  miedo a quedarse sin poder trabajar. */}
              <p data-testid="no-bloquea" style={textoAviso}>
                Queda anotado y no te impide salir. Lo revisa quien opera.
              </p>
              <BotonPrimario testid="seguir-con-fallas" onClick={() => setPaso("odometro")}>
                Seguir
              </BotonPrimario>
            </>
          )}
        </section>
      )}

      {paso === "odometro" && (
        <section data-testid="paso-odometro" style={bloque}>
          <h2 style={subtitulo}>Kilómetros del tablero</h2>
          <CifraGrande valor={odometro === "" ? "—" : odometro} unidad="km" />
          <div data-testid="teclado-odometro">
            <TecladoNumerico valor={odometro} onCambiar={setOdometro} />
          </div>
          <BotonPrimario testid="continuar-odometro" disabled={odometro === ""} onClick={() => setPaso("carga")}>
            Continuar
          </BotonPrimario>
        </section>
      )}

      {paso === "carga" && (
        <section data-testid="paso-carga" style={bloque}>
          <h2 style={subtitulo}>Carga de la batería</h2>
          <CifraGrande valor={carga === "" ? "—" : carga} unidad="%" />
          <div data-testid="teclado-carga">
            <TecladoNumerico valor={carga} onCambiar={setCarga} />
          </div>
          <BotonPrimario testid="continuar-carga" disabled={carga === ""} onClick={() => setPaso("semaforo")}>
            Continuar
          </BotonPrimario>
        </section>
      )}

      {paso === "semaforo" && (
        <section data-testid="paso-semaforo" style={bloque}>
          {/* SIEMPRE con texto, jamás solo color (§5.2-F3, §5.1). El color acompaña; la frase
              es la que informa, y es la que lee un lector de pantalla. */}
          <p data-testid="semaforo-texto" role="status" style={textoDelSemaforo(semaforo)}>
            {TEXTO_DEL_SEMAFORO[semaforo]}
          </p>
          <CifraGrande valor={carga} unidad="%" />
          {/* Ni la carga baja ni un ítem fallado bloquean: la confirmación es de UN toque
              (§7.6). Si el botón se deshabilitara con poca batería, el chofer no podría salir
              a cargar. */}
          <BotonPrimario testid="abrir-turno" onClick={() => void abrir()}>
            Abrir turno
          </BotonPrimario>
        </section>
      )}
    </main>
  );
}

const titulo = { fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 };
const subtitulo = { fontSize: tipografia.cuerpo.tamano, fontWeight: enfasis.medio, margin: 0 };
const cuerpo = { fontSize: tipografia.cuerpo.tamano, color: superficie.texto };
const bloque = {
  display: "grid",
  gap: semantico.espacio.entreControles,
  marginTop: semantico.espacio.entreTarjetas,
};
const chips = { display: "flex", gap: grilla.base, flexWrap: "wrap" as const };
const chip = {
  minHeight: componente.objetivoTactil.altoMinPx,
  padding: `0 ${grilla.base * 2}px`,
  borderRadius: grilla.radio,
  border: `1px solid ${superficie.hairline}`,
  background: superficie.tarjeta,
  color: superficie.texto,
  fontSize: tipografia.cuerpo.tamano,
  fontWeight: enfasis.medio,
};
const chipMarcado = { ...chip, background: superficie.texto, color: superficie.tarjeta };
const textoNota = {
  ...cuerpo,
  margin: 0,
  padding: `${grilla.base}px`,
  borderRadius: grilla.radio,
  background: superficie.tarjeta,
  border: `1px solid ${superficie.hairline}`,
  fontWeight: enfasis.medio,
};
const textoAviso = { ...cuerpo, margin: 0, color: colorSemantico.alerta, fontWeight: enfasis.medio };
/** El semáforo con TEXTO y color. El color acompaña; sin la frase, no se comunica nada. */
const textoDelSemaforo = (estado: Semaforo) => ({
  ...cuerpo,
  margin: 0,
  fontWeight: enfasis.fuerte,
  color:
    estado === "alcanza"
      ? colorSemantico.ok
      : estado === "no_alcanza"
        ? colorSemantico.error
        : superficie.textoDim,
});
