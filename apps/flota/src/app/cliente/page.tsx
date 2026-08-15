import { tipografia } from "@kilopan/miga/tokens.ts";

// Portal del contratante — raíz del namespace `/cliente/*` [AC-FPOR-04] — spec 07 §1, §2.
//
// Este archivo es SOLO el punto de entrada que prueba que el namespace existe y que el gate
// de `servidor.mjs` tiene una ruta real que dejar pasar cuando el portal está encendido. Las
// cuatro pantallas (Hoy · Encargos · Nuevo/Importar CSV · Liquidación), la sesión del rol
// `cliente` y el confinamiento por empresa son de AC-FPOR-05/06/07/08, todavía abiertos — este
// Server Component no lee sesión ni datos de negocio a propósito, para no adelantar esas
// decisiones. El candado de módulo apagado NO puede vivir acá (un Server Component no fija el
// status HTTP): vive en `servidor/portal.ts`, consultado desde `servidor.mjs` antes de que
// Next reciba el request.
export default function PortalCliente() {
  return (
    <main data-testid="portal-cliente-shell">
      <h1 style={{ fontSize: tipografia.display.tamano, fontWeight: tipografia.display.peso, margin: 0 }}>
        Portal del contratante
      </h1>
    </main>
  );
}
