export default function Inicio() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 34, fontWeight: 700, margin: 0 }}>Plataforma FLOTA</h1>
      <p style={{ fontSize: 17, margin: 0, maxWidth: 480 }}>
        Hito 0 — esqueleto del monorepo. El contrato de aceptación vive en{" "}
        <code>specs/flota/*.md</code>, la especificación completa en{" "}
        <code>docs/PROMPT_MAESTRO_FLOTA.md</code>.
      </p>
    </main>
  );
}
