import { superficie } from "@kilopan/miga/tokens.ts";

// Dark mode automático de las 4 pantallas del portal [AC-FPOR-12] — spec 07 §5, §5.1/§5.7 de
// `docs/PROMPT_MAESTRO_FLOTA.md` («dark mode automático de serie: los turnos parten de
// madrugada»). Mismo criterio que `HOY_TEMA_CSS` de `hoy/tablero-de-hoy.tsx` (AC-FSEM-12): un
// par claro/oscuro PROPIO de estas 4 pantallas, no el theming completo de Miga (CSS custom
// properties del `tenant_theme` — logo + acento derivado —, inyectadas desde el bootstrap), que
// sigue siendo AC-FMIG-02 (módulo 08, no construido — ya lo documenta `layout.tsx`). El token
// general `superficie.*` de Miga es "solo claro en el MVP" (tokens.ts) por diseño de KiloPan;
// este módulo no lo toca, define sus propias variables `--portal-*` para las 4 pantallas.
export const TEMA_PORTAL_CSS = `
.portal-superficie {
  --portal-bg-pagina: ${superficie.fondo};
  --portal-bg-tarjeta: ${superficie.tarjeta};
  --portal-texto: ${superficie.texto};
  --portal-texto-dim: ${superficie.textoDim};
  --portal-hairline: ${superficie.hairline};
  --portal-error: #B91C1C;
  --portal-alerta: #B45309;
  background: var(--portal-bg-pagina);
  color: var(--portal-texto);
}
@media (prefers-color-scheme: dark) {
  .portal-superficie {
    --portal-bg-pagina: #121212;
    --portal-bg-tarjeta: #1E1E1E;
    --portal-texto: #F5F5F5;
    --portal-texto-dim: #C7C0B4;
    --portal-hairline: rgba(255, 255, 255, .16);
    --portal-error: #FCA5A5;
    --portal-alerta: #FCD34D;
  }
}
`;
