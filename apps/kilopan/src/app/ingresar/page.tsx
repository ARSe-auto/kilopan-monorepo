"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TecladoNumerico, CifraGrande, BotonPrimario, Copyright } from "@kilopan/miga/componentes/index.tsx";
import { leerDispositivo, olvidarDispositivo } from "@/identidad/cliente/dispositivo.ts";
import { recordarOperador } from "@/identidad/cliente/operador.ts";
import { LogoKiloPan } from "../LogoKiloPan.tsx";
import { destinoDeIngreso } from "../navegacion.ts";

// Cada motivo se redacta con la ACCIÓN que le toca al panadero, no con el nombre técnico
// del estado. Los emite `obtenerSesionOMotivo` (identidad/sesion.ts), el middleware y el
// interceptor de 401.
const MOTIVOS: Record<string, string> = {
  vencida: "Tu sesión se cerró sola tras 10 minutos sin usar la app. Vuelve a entrar: nada de lo que registraste se perdió.",
  cerrada: "Tu sesión ya no está abierta. Suele ser porque alguien entró con tu mismo RUT en otro equipo — en KiloPan solo hay una sesión por persona.",
  "sin-sesion": "Para entrar a esa pantalla necesitas iniciar sesión.",
  salida: "Sesión cerrada. El equipo queda libre para el siguiente turno.",
};

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
  // Por qué está viendo esta pantalla. Sin esto, cualquier corte de sesión —los 10 min de
  // inactividad, el mismo RUT abierto en otro equipo— dejaba al operador en el login sin
  // una palabra: desde el mesón se lee como que la app se cayó sola.
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const ultimo = window.localStorage.getItem("kp_ultimo_rut");
    if (ultimo) setRut(ultimo);
    // `window.location.search` en vez de `useSearchParams`: no obliga a envolver la
    // pantalla en un <Suspense> solo para leer un parámetro que ya está en el navegador.
    setAviso(MOTIVOS[new URLSearchParams(window.location.search).get("motivo") ?? ""] ?? null);
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
      // Un rol con una sola pantalla (maestro → Pesaje, repartidor → Mi ruta) entra
      // DIRECTO a lo único que puede hacer: pasar por "Hoy" para elegir entre una
      // opción es un clic que nunca decide nada. Con dos o más, "Hoy" sigue siendo
      // quien decide qué sigue.
      //
      // window.location.assign, no router.push: el layout raíz lee la sesión UNA vez
      // en el servidor y Next reutiliza esa lectura en las navegaciones de cliente que
      // se quedan dentro del mismo árbol de layouts. Con router.push, el chip y la tab
      // bar seguían mostrando "sin sesión" (el estado de ANTES del login) hasta la
      // primera recarga completa — verificado en el navegador: aterrizaba en la
      // pantalla correcta pero sin encabezado ni barra. Una navegación dura fuerza al
      // servidor a releer la cookie recién puesta.
      window.location.assign(destinoDeIngreso(cuerpo.usuario.rol));
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
        flex: 1,
      }}
    >
      <div>
        {/* En esta pantalla el logo es el título: no hay otro encabezado que lo sea. */}
        <LogoKiloPan tamano={28} comoTitulo />
        <p style={{ color: "#5B564C", fontSize: 15, marginTop: 8 }}>Ingresa tu RUT y tu PIN.</p>
      </div>

      {aviso ? (
        <p
          role="status"
          style={{
            margin: 0,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#FEF3E2",
            border: "1px solid rgba(180,83,9,.35)",
            color: "#7C3E06",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {aviso}
        </p>
      ) : null}

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
