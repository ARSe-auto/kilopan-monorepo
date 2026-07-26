"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TecladoNumerico, CifraGrande, BotonPrimario, Copyright } from "@kilopan/miga/componentes/index.tsx";
import { leerDispositivo, olvidarDispositivo } from "@/identidad/cliente/dispositivo.ts";
import { recordarOperador } from "@/identidad/cliente/operador.ts";
import { LogoKiloPan } from "../LogoKiloPan.tsx";

// F5 Cambio de operador (PROMPT_MAESTRO.md §5): RUT + PIN de 4 dígitos, ≤3s. El
// equipo ya está vinculado a esta altura (/ redirige acá solo si lo está).
export default function IngresarPage() {
  const router = useRouter();
  const [rut, setRut] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // El servidor ya no reconoce ESTE equipo (revocado, o el secreto local quedó
  // desincronizado) — reintentar el PIN no arregla nada, hace falta vincularlo de
  // nuevo. Ver api/auth/login/route.ts: codigo "dispositivo_invalido".
  const [dispositivoInvalido, setDispositivoInvalido] = useState(false);
  // Ver el fallback de router.push más abajo: el cleanup de este efecto es lo que
  // cancela el reloj cuando la navegación SÍ funciona (el componente se desmonta al
  // cambiar de pantalla, y React corre este cleanup en ese momento — no antes).
  const relojFallbackRef = useRef<number | null>(null);

  useEffect(() => {
    const ultimo = window.localStorage.getItem("kp_ultimo_rut");
    if (ultimo) setRut(ultimo);
    return () => {
      if (relojFallbackRef.current !== null) window.clearTimeout(relojFallbackRef.current);
    };
  }, []);

  async function ingresar() {
    const dispositivo = leerDispositivo();
    if (!dispositivo) {
      router.push("/vincular");
      return;
    }
    setEnviando(true);
    setError(null);
    setDispositivoInvalido(false);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rut,
          pin,
          dispositivoId: dispositivo.id,
          dispositivoSecreto: dispositivo.secreto,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) {
        setError(cuerpo.error ?? "No se pudo ingresar");
        setDispositivoInvalido(cuerpo.codigo === "dispositivo_invalido");
        setPin("");
        setEnviando(false);
        return;
      }
      window.localStorage.setItem("kp_ultimo_rut", rut);
      // Para que la cola offline sepa, al momento de encolar, DE QUIÉN es cada
      // mutación — y así no subirla a nombre de quien esté logueado al sincronizar.
      recordarOperador(cuerpo.usuario.id);
      // El login YA está confirmado por el servidor a esta altura — lo único que
      // falta es la transición client-side de Next (fetch RSC + actualizar la URL).
      // Encontrado en vivo (26-jul-2026, instrumentando el propio código): esa
      // transición puede no completarse nunca sin lanzar ningún error, dejando al
      // operador con "Ingresando…" congelado pese a que su turno ya abrió en el
      // servidor. En una tablet de mesón bajo carga esto es indistinguible de un
      // cuelgue real. `router.push` es fire-and-forget: no hay promesa que esperar
      // ni evento de fallo que capturar, así que la única defensa posible es un
      // plazo — si router.push no completó la navegación en 2 s, un cambio de URL
      // duro sí funciona siempre (fuerza un GET normal, sin la capa RSC). Si router.push
      // SÍ funciona, este componente se desmonta al cambiar de pantalla y el cleanup
      // del useEffect de arriba cancela el reloj antes de que llegue a dispararse.
      relojFallbackRef.current = window.setTimeout(() => {
        window.location.assign("/inicio");
      }, 2000);
      router.push("/inicio");
    } catch {
      setError("Sin conexión con el servidor");
      setEnviando(false);
    }
  }

  function vincularDeNuevo() {
    olvidarDispositivo();
    router.push("/vincular");
  }

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        minHeight: "100dvh",
      }}
    >
      <div>
        {/* En esta pantalla el logo es el título: no hay otro encabezado que lo sea. */}
        <LogoKiloPan tamano={28} comoTitulo />
        <p style={{ color: "#5B564C", fontSize: 15, marginTop: 8 }}>Ingresa tu RUT y tu PIN.</p>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#5B564C" }}>RUT</span>
        <input
          value={rut}
          onChange={(e) => setRut(e.target.value)}
          placeholder="12.345.678-5"
          autoComplete="off"
          style={{
            minHeight: 44,
            borderRadius: 12,
            border: "1px solid rgba(27,23,18,.14)",
            padding: "0 14px",
            fontSize: 17,
          }}
        />
      </label>

      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
        {/* Hallazgo menor de la auditoría: antes solo se rellenaban los dígitos SIN
            teclear con "•" — los YA tecleados se mostraban en texto plano a 96 px,
            legibles desde el otro lado del mesón. Acá se enmascaran los dos casos con
            símbolos distintos (● tecleado, ○ pendiente) para conservar el feedback de
            cuántos dígitos van sin revelar cuáles son. */}
        <CifraGrande valor={"●".repeat(pin.length).padEnd(4, "○")} />
      </div>

      <TecladoNumerico valor={pin} onCambiar={(v) => setPin(v.slice(0, 4))} permitirCeroInicial />

      {error ? (
        <p style={{ color: "#B91C1C", fontSize: 14, textAlign: "center" }} role="alert">
          {error}
        </p>
      ) : null}

      {dispositivoInvalido ? (
        <button
          type="button"
          onClick={vincularDeNuevo}
          style={{ minHeight: 44, background: "none", border: "none", color: "#5B564C", fontSize: 14, fontWeight: 700, textAlign: "center" }}
        >
          Vincular este equipo de nuevo
        </button>
      ) : null}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <BotonPrimario disabled={!rut || pin.length !== 4 || enviando} onClick={ingresar}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </BotonPrimario>
        <Copyright />
      </div>
    </main>
  );
}
