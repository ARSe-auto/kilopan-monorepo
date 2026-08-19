import { tipografia, enfasis } from "../tokens.ts";

// Estado obligatorio de todo listado con cola (PROMPT_MAESTRO.md §5): "Sin conexión —
// N registros por subir" ámbar -> "Sincronizado hace Xs" verde. Nunca silencioso.
//
// Hallazgo menor de la auditoría: antes esto deducía "sin conexión" SOLO de que
// `pendientes > 0` — mentía en los dos sentidos. Con buena señal y algo recién
// encolado (o reintentando tras un error de servidor), decía "sin conexión" sin
// serlo. Sin nada encolado pero con el WiFi caído, decía "Sincronizado" sin estarlo.
// `online` es opcional (no toda pantalla que usa este chip rastrea navigator.onLine
// todavía): sin el dato, se asume en línea y el chip se comporta como antes.
export function ChipEstadoConexion({ pendientes, online = true }: { pendientes: number; online?: boolean }) {
  const alerta = !online || pendientes > 0;
  let texto: string;
  if (!online) texto = pendientes > 0 ? `Sin conexión — ${pendientes} por subir` : "Sin conexión";
  else if (pendientes > 0) texto = `Subiendo — ${pendientes} pendiente(s)`;
  else texto = "Sincronizado";

  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 100,
        fontSize: tipografia.pie.tamano,
        fontWeight: enfasis.fuerte,
        background: alerta ? "rgba(180,83,9,.13)" : "rgba(21,128,61,.12)",
        // AC-FMIG-11 (axe, wcag2aa): lo que hay que medir es el texto contra el FONDO TEÑIDO
        // de este chip, no contra blanco puro — `semantico.error`/`semantico.ok` (tokens.ts)
        // cumplen `CONTRASTE.texto` sobre blanco, pero sobre este fondo pálido caen bajo el
        // mínimo. Estos dos tonos, más oscuros y propios de este componente, sí lo cumplen
        // contra SU fondo.
        color: alerta ? "#92400E" : "#0F6B33",
      }}
    >
      {texto}
    </div>
  );
}
