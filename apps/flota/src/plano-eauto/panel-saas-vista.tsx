"use client";

import { superficie, semantico as colores } from "@kilopan/miga/tokens.ts";
import { semantico as layout } from "@kilopan/miga/estructura.ts";
import type {
  CalidadNorte,
  ContadorExenciones,
  EmbudoActivacion,
  FilaEevdTendenciaTenant,
  SaludPlataforma,
} from "../dominio/panel-saas.ts";
import { FORMATOS } from "../../../../packages/nucleo-comun/src/constants.ts";

// Panel interno SaaS de e-auto (spec 05 §3, maestro §10) [AC-FSEM-22].
//
// Puramente PRESENTACIONAL, mismo criterio que `tablero-cross-tenant.tsx` (AC-FSEM-10): recibe
// datos ya armados por `dominio/panel-saas.ts` (que ya pasaron el centinela 14) y los pinta.
// Cero fetch, cero cliente de base de datos. No está montado bajo ninguna ruta de `app/`
// todavía — sin URL, no hay caso de cruce que declarar en `rutas/manifiesto.json`; el montaje
// real llega con AC-FSEM-24 (pregunta 2).

const numero = new Intl.NumberFormat(FORMATOS.locale);
const porcentaje = new Intl.NumberFormat(FORMATOS.locale, { style: "percent", maximumFractionDigits: 1 });
const horas = new Intl.NumberFormat(FORMATOS.locale, { maximumFractionDigits: 1 });

function celdaPct(valor: number | null): string {
  // NULL declarado ⇒ "pendiente", jamás un cero que se confunda con "medido y da 0" (mismo
  // criterio que AC-FTEN-04 aplica en la BD y `tablero-cross-tenant.tsx` en esta vista).
  return valor === null ? "pendiente" : porcentaje.format(valor);
}

function celdaHoras(valor: number | null): string {
  return valor === null ? "pendiente" : `${horas.format(valor)} h`;
}

export function PanelSaasVista({
  eevdPorTenant,
  embudo,
  salud,
  calidad,
  exenciones,
}: {
  eevdPorTenant: FilaEevdTendenciaTenant[];
  embudo: EmbudoActivacion;
  salud: SaludPlataforma;
  calidad: CalidadNorte;
  exenciones: ContadorExenciones;
}) {
  return (
    <div data-testid="panel-saas" style={{ display: "grid", gap: layout.espacio.entreTarjetas }}>
      <section
        data-testid="panel-saas-eevd-tendencia"
        style={{ display: "grid", gap: layout.espacio.entreControles, padding: layout.espacio.entreControles, borderRadius: layout.esquina.tarjeta, background: superficie.tarjeta }}
      >
        <strong>EEVD por tenant — tendencia 4 semanas</strong>
        <dl style={{ display: "grid", gap: layout.espacio.entreControles, margin: 0 }}>
          {eevdPorTenant.map((fila) => (
            <div key={fila.tenantSlug} data-testid={`panel-saas-eevd-${fila.tenantSlug}`}>
              <dt>{fila.tenantSlug}</dt>
              <dd>{fila.semanas.map(celdaPct).join(" → ")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        data-testid="panel-saas-embudo"
        style={{ display: "grid", gap: layout.espacio.entreControles, padding: layout.espacio.entreControles, borderRadius: layout.esquina.tarjeta, background: superficie.tarjeta }}
      >
        <strong>Embudo de activación — alta → primera entrega</strong>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: layout.espacio.entreControles, margin: 0 }}>
          <div>
            <dt>p50</dt>
            <dd data-testid="panel-saas-embudo-p50">{celdaHoras(embudo.p50Horas)}</dd>
          </div>
          <div>
            <dt>p90</dt>
            <dd data-testid="panel-saas-embudo-p90">{celdaHoras(embudo.p90Horas)}</dd>
          </div>
          <div>
            <dt>Tenants activados</dt>
            <dd data-testid="panel-saas-embudo-activados">{numero.format(embudo.tenantsActivados)}</dd>
          </div>
          <div>
            <dt>Tenants pendientes</dt>
            <dd data-testid="panel-saas-embudo-pendientes">{numero.format(embudo.tenantsPendientes)}</dd>
          </div>
        </dl>
      </section>

      <section
        data-testid="panel-saas-salud"
        style={{ display: "grid", gap: layout.espacio.entreControles, padding: layout.espacio.entreControles, borderRadius: layout.esquina.tarjeta, background: superficie.tarjeta }}
      >
        <strong>Salud de plataforma</strong>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: layout.espacio.entreControles, margin: 0 }}>
          <div>
            <dt>Tenants activos</dt>
            <dd data-testid="panel-saas-tenants-activos">{numero.format(salud.tenantsActivos)}</dd>
          </div>
          <div>
            <dt>Vehículos con turno</dt>
            <dd data-testid="panel-saas-pct-vehiculos-turno">{celdaPct(salud.pctVehiculosConTurno)}</dd>
          </div>
        </dl>
      </section>

      <section
        data-testid="panel-saas-calidad-norte"
        style={{ display: "grid", gap: layout.espacio.entreControles, padding: layout.espacio.entreControles, borderRadius: layout.esquina.tarjeta, background: superficie.tarjeta }}
      >
        <strong>Calidad de la norte</strong>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: layout.espacio.entreControles, margin: 0 }}>
          <div>
            <dt>Paradas sin evidencia</dt>
            <dd data-testid="panel-saas-paradas-sin-evidencia">{celdaPct(calidad.pctParadasSinEvidencia)}</dd>
          </div>
          <div>
            <dt>PODs supersedidos (sin undo)</dt>
            <dd data-testid="panel-saas-pods-supersedidos">{celdaPct(calidad.pctPodsSupersedidosSinUndo)}</dd>
          </div>
        </dl>
      </section>

      <section
        data-testid="panel-saas-exenciones"
        style={{
          display: "grid",
          gap: layout.espacio.entreControles,
          padding: layout.espacio.entreControles,
          borderRadius: layout.esquina.tarjeta,
          background: superficie.tarjeta,
          borderLeft: exenciones.creciente ? `6px solid ${colores.error}` : undefined,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong>Exenciones de la suite</strong>
          {/* Texto SIEMPRE junto al color, mismo criterio AA que `tablero-cross-tenant.tsx`
           *  (AC-FSEM-12): la bandera roja no se comunica solo con el borde. */}
          {exenciones.creciente ? <span data-testid="panel-saas-exenciones-bandera">Tendencia creciente</span> : null}
        </div>
        <dd data-testid="panel-saas-exenciones-valor" style={{ margin: 0 }}>
          {numero.format(exenciones.valorActual)}
        </dd>
      </section>
    </div>
  );
}
