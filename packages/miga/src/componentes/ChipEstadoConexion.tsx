// Estado obligatorio de todo listado con cola (PROMPT_MAESTRO.md §5): "Sin conexión —
// N registros por subir" ámbar -> "Sincronizado hace Xs" verde. Nunca silencioso.
export function ChipEstadoConexion({ pendientes }: { pendientes: number }) {
  const sinConexion = pendientes > 0;
  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 100,
        fontSize: 13,
        fontWeight: 700,
        background: sinConexion ? "rgba(180,83,9,.13)" : "rgba(21,128,61,.12)",
        color: sinConexion ? "#B45309" : "#15803D",
      }}
    >
      {sinConexion ? `Sin conexión — ${pendientes} por subir` : "Sincronizado"}
    </div>
  );
}
