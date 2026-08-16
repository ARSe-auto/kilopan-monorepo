"use client";

import { superficie, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout } from "@kilopan/miga/estructura.ts";
import type { ColorSemaforo } from "../dominio/semaforo.ts";
import type { FilaTenantControl } from "../dominio/plano-eauto.ts";
import { FORMATOS } from "../../../../packages/nucleo-comun/src/constants.ts";

// Plano B — tablero cross-tenant de e-auto (spec 05, §3) [AC-FSEM-10].
//
// Puramente PRESENTACIONAL: recibe filas ya armadas por `dominio/plano-eauto.ts` (que a su vez
// ya pasaron el centinela 14) y las pinta. Cero fetch, cero import de un cliente de base de
// datos — el montaje contra `control` real, con sesión de e-auto, es AC-FSEM-24 (pregunta 2).
// No está montado bajo ninguna ruta de `app/` todavía: sin URL, no hay caso de cruce que
// declarar en `rutas/manifiesto.json` — eso llega junto con el montaje real.

const ETIQUETA_COLOR: Record<ColorSemaforo, string> = { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo" };
const FONDO_COLOR: Record<ColorSemaforo, string> = { verde: colores.ok, amarillo: colores.alerta, rojo: colores.error };

const numero = new Intl.NumberFormat(FORMATOS.locale);
const porcentaje = new Intl.NumberFormat(FORMATOS.locale, { style: "percent", maximumFractionDigits: 1 });

function celda(valor: number | null, formatear: (n: number) => string): string {
  // NULL declarado ⇒ "pendiente", jamás un cero o un guion que se confunda con "medido y da 0"
  // (mismo criterio que AC-FTEN-04 aplica en la BD: NULL y cero son afirmaciones distintas).
  return valor === null ? "pendiente" : formatear(valor);
}

export function TableroCrossTenant({ filas }: { filas: FilaTenantControl[] }) {
  return (
    <div data-testid="plano-eauto-tablero" style={{ display: "grid", gap: layout.espacio.entreTarjetas }}>
      {filas.map((fila) => (
        <div
          key={fila.tenantSlug}
          data-testid={`plano-eauto-fila-${fila.tenantSlug}`}
          style={{
            display: "grid",
            gap: layout.espacio.entreControles,
            padding: layout.espacio.entreControles,
            borderRadius: layout.esquina.tarjeta,
            background: superficie.tarjeta,
            borderLeft: `6px solid ${FONDO_COLOR[fila.color]}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>{fila.tenantSlug}</strong>
            {/* Texto SIEMPRE junto al color: el AA del módulo (AC-FSEM-12) exige que ningún
             *  estado se comunique solo por color — acá ya no se apaga con CSS. */}
            <span data-testid="plano-eauto-color">{ETIQUETA_COLOR[fila.color]}</span>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: layout.espacio.entreControles, margin: 0 }}>
            <div>
              <dt>Actividad (última hora)</dt>
              <dd data-testid="plano-eauto-eventos">{celda(fila.eventosUltimaHora, (n) => numero.format(n))}</dd>
            </div>
            <div>
              <dt>Actividad vs media móvil 7d</dt>
              <dd data-testid="plano-eauto-media-movil">{celda(fila.actividadVsMediaMovil7dPct, (n) => porcentaje.format(n))}</dd>
            </div>
            <div>
              <dt>Errores de sync</dt>
              <dd data-testid="plano-eauto-errores-sync">{celda(fila.erroresSyncPct, (n) => porcentaje.format(n / 100))}</dd>
            </div>
            <div>
              <dt>Backlog (min)</dt>
              <dd data-testid="plano-eauto-backlog">{celda(fila.backlogSyncMaxMin, (n) => numero.format(n))}</dd>
            </div>
            <div>
              <dt>Versión PWA (mínima)</dt>
              <dd data-testid="plano-eauto-pwa">{fila.pwaVersionMin ?? "pendiente"}</dd>
            </div>
            <div>
              <dt>Latencia p95 (ms)</dt>
              <dd data-testid="plano-eauto-latencia">{celda(fila.latenciaP95Ms, (n) => numero.format(n))}</dd>
            </div>
            <div>
              <dt>EEVD agregada</dt>
              <dd data-testid="plano-eauto-eevd">{celda(fila.eevdAgregada, (n) => porcentaje.format(n))}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
