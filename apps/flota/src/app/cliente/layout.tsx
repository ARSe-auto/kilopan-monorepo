import type { ReactNode } from "react";
import { tipografia, superficie, grilla } from "@kilopan/miga/tokens.ts";
import { MODULOS_PORTAL_CLIENTE } from "../../dominio/manifest-cliente.ts";

// El shell del portal del contratante [AC-FPOR-07] — spec 07 §2: las cuatro pantallas, en la
// MISMA nav en todas, para que «recorrer todo el portal» sea navegar por acá y no adivinar
// URLs. `data-testid="modulo-nav-cliente"` es DELIBERADAMENTE distinto del `modulo-nav` del
// manifest del operador (`dominio/manifest.ts`, AC-FPOR-03): el e2e que recorre el portal tiene
// que poder afirmar «cero módulos del operador acá», y con el mismo testid esa afirmación sería
// ambigua — no distinguiría «no hay nav» de «hay nav, pero es la del portal».
export default function LayoutPortalCliente({ children }: { children: ReactNode }) {
  return (
    <div data-testid="portal-cliente-shell">
      <nav data-testid="manifest-cliente" aria-label="Pantallas del portal">
        {MODULOS_PORTAL_CLIENTE.map((m) => (
          <a
            key={m.clave}
            data-testid="modulo-nav-cliente"
            data-modulo={m.clave}
            href={m.ruta}
            style={enlace}
          >
            {m.titulo}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}

const enlace = {
  fontSize: tipografia.pie.tamano,
  color: superficie.texto,
  padding: `${grilla.base / 2}px ${grilla.base}px`,
  display: "inline-block",
};
