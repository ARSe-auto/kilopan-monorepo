"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TecladoNumerico, CifraGrande, BotonPrimario } from "@kilopan/miga/componentes/index.tsx";
import { leerDispositivo } from "@/identidad/cliente/dispositivo.ts";
import { recordarOperador } from "@/identidad/cliente/operador.ts";

// F5 Cambio de operador (PROMPT_MAESTRO.md §5): RUT + PIN de 4 dígitos, ≤3s. El
// equipo ya está vinculado a esta altura (/ redirige acá solo si lo está).
export default function IngresarPage() {
  const router = useRouter();
  const [rut, setRut] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const ultimo = window.localStorage.getItem("kp_ultimo_rut");
    if (ultimo) setRut(ultimo);
  }, []);

  async function ingresar() {
    const dispositivo = leerDispositivo();
    if (!dispositivo) {
      router.push("/vincular");
      return;
    }
    setEnviando(true);
    setError(null);
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
        setPin("");
        setEnviando(false);
        return;
      }
      window.localStorage.setItem("kp_ultimo_rut", rut);
      // Para que la cola offline sepa, al momento de encolar, DE QUIÉN es cada
      // mutación — y así no subirla a nombre de quien esté logueado al sincronizar.
      recordarOperador(cuerpo.usuario.id);
      router.push("/inicio");
    } catch {
      setError("Sin conexión con el servidor");
      setEnviando(false);
    }
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>KiloPan</h1>
        <p style={{ color: "#5B564C", fontSize: 15 }}>Ingresa tu RUT y tu PIN.</p>
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
        <CifraGrande valor={pin.padEnd(4, "•").slice(0, 4)} />
      </div>

      <TecladoNumerico valor={pin} onCambiar={(v) => setPin(v.slice(0, 4))} />

      {error ? (
        <p style={{ color: "#B91C1C", fontSize: 14, textAlign: "center" }} role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: "auto" }}>
        <BotonPrimario disabled={!rut || pin.length !== 4 || enviando} onClick={ingresar}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </BotonPrimario>
      </div>
    </main>
  );
}
