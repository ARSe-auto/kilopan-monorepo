import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { obtenerDb } from "@/comun/db.ts";
import { obtenerSesionActual } from "@/identidad/sesion.ts";
import { superficie, acentos, semantico } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { formatearKg, formatearClp } from "@/comun/formato.ts";
import { CtaFlota } from "./CtaFlota.tsx";
import { MapaPodsDia } from "./MapaPodsDiaCliente.tsx";
import { PantallaAuditoria } from "./PantallaAuditoria.tsx";
import { HistoricoConciliacion } from "./HistoricoConciliacion.tsx";
import { Pantalla } from "../Pantalla.tsx";

// Los agregados llegan como string desde Postgres (bigint/numeric no entran en un
// number de JS sin pérdida) — se convierten con Number() al formatear.
type Conciliacion = Record<string, unknown> & {
  fecha: string;
  g_pesados: string;
  g_venta: string;
  g_pod_ok: string;
  g_merma_tipificada: string;
  g_merma_recuperada: string;
  tck: string | null;
};

// AC-DASH-01: el panel del dueño. Todo sale de pan.conciliacion_diaria — una vista
// sobre eventos, nunca un snapshot. Server Component: la sesión se valida acá y las
// cifras nunca viajan al cliente sin pasar por el chequeo de rol.
export default async function DashboardPage() {
  // Antes esta pantalla reimplementaba la consulta de sesión a mano y se le había
  // olvidado el chequeo de expiración por inactividad (AC-ID-05) que sí tiene
  // obtenerSesionActual — una sesión vencida hacía "F5" acá y seguía viendo la plata.
  const usuario = await obtenerSesionActual({ cookies: await cookies() });
  if (!usuario) redirect("/ingresar");

  const db = await obtenerDb();
  // Regla de rol testeada: el CLP y el $/km viven solo acá, jamás en el teléfono
  // del repartidor (PROMPT_MAESTRO.md §5).
  if (usuario.rol !== "admin") {
    return (
      <Pantalla titulo="Panel del dueño" ancho={640}>
        <p style={{ color: superficie.textoDim }}>Esta pantalla es solo para administradores.</p>
        <Copyright />
      </Pantalla>
    );
  }

  const conciliacion = await db.query<Conciliacion>(
    `select fecha, g_pesados, g_venta, g_pod_ok, g_merma_tipificada, g_merma_recuperada, tck
       from pan.conciliacion_diaria where fecha = current_date`
  );
  const hoy = conciliacion.rows[0];

  // Mapa de PODs del día — solo entregas cerradas con GPS válido (AC-DASH-05)
  const pods = await db.query<{
    id: string;
    receptor_nombre: string;
    lat: number;
    lng: number;
    gramos_entregados: number;
    foto_estado: string;
  }>(
    `select e.id, e.receptor_nombre, e.lat, e.lng, e.gramos_entregados, e.foto_estado
       from pan.entregas e
      where e.cerrada = true
        and date(e.recibido_at) = current_date
        and e.supersede_id is null
      order by e.recibido_at desc`
  );

  const rutasCerradas = await db.query<{ n: string }>(
    `select count(*)::text as n from pan.rutas where estado = 'cerrada'`
  );
  const minimoFlota = await db.query<{ valor: number }>(
    `select valor from pan.parametros where clave = 'rutas_minimas_tarjeta_flota'`
  );
  const mostrarFlota =
    Number(rutasCerradas.rows[0]?.n ?? 0) >= (minimoFlota.rows[0]?.valor ?? 20);

  // AC-DASH-06: usuarios y dispositivos para los filtros de auditoría
  const usuariosR = await db.query<{ id: string; nombre: string; rut: string }>(
    `select id, nombre, rut from pan.usuarios where activo order by nombre`
  );
  const dispositivosR = await db.query<{ id: string; nombre: string }>(
    `select id, nombre from pan.dispositivos where revocado_at is null order by nombre`
  );

  const tckPct = hoy?.tck != null ? Math.round(Number(hoy.tck) * 100) : null;
  const colorTck = tckPct == null ? superficie.textoFaint : tckPct >= 95 ? semantico.ok : semantico.alerta;

  return (
    <Pantalla titulo={usuario.nombre} bajada="Panel del dueño · hoy" ancho={900}>
      <section
        style={{
          background: superficie.tarjeta,
          border: `1px solid ${superficie.hairline}`,
          borderRadius: 16,
          padding: 24,
        }}
      >
        {/* La cifra más grande del panel era la sigla "TCK", que no le dice nada al
            dueño de una panadería. Ahora manda la pregunta en su idioma y la sigla
            queda como subtítulo, para quien ya la conoce (auditoría de experiencia). */}
        <p style={{ fontSize: 15, fontWeight: 700, color: superficie.texto, margin: 0 }}>
          ¿Cuánto del pan que horneaste está explicado?
        </p>
        <p style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: superficie.textoFaint, margin: "2px 0 0" }}>
          TCK · tasa de conciliación de kilos
        </p>
        <p style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, fontVariantNumeric: "tabular-nums", color: colorTck, margin: "8px 0 0" }}>
          {tckPct == null ? "—" : `${tckPct}%`}
        </p>
        <p style={{ fontSize: 14, color: superficie.textoDim, margin: "4px 0 0" }}>
          {tckPct == null
            ? "Todavía no se pesó nada hoy."
            : tckPct >= 95
              ? "Meta cumplida: casi todo el pan que salió del horno está vendido, entregado o anotado como merma."
              : "Bajo la meta de 95%: hay pan que salió del horno y no aparece vendido, entregado ni como merma."}
        </p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {[
          { etiqueta: "Pesados", valor: hoy?.g_pesados, color: acentos.kilopan },
          { etiqueta: "Vendidos", valor: hoy?.g_venta, color: semantico.ok },
          { etiqueta: "Entregados con prueba", valor: hoy?.g_pod_ok, color: semantico.ok },
          { etiqueta: "Merma perdida", valor: hoy?.g_merma_tipificada, color: semantico.error },
          { etiqueta: "Merma recuperada", valor: hoy?.g_merma_recuperada, color: semantico.alerta },
        ].map((c) => (
          <div
            key={c.etiqueta}
            style={{
              background: superficie.tarjeta,
              border: `1px solid ${superficie.hairline}`,
              borderRadius: 14,
              padding: 16,
            }}
          >
            <p style={{ fontSize: 12, color: superficie.textoFaint, margin: 0 }}>{c.etiqueta}</p>
            <p style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.color, margin: "6px 0 0" }}>
              {formatearKg(Number(c.valor ?? 0))}
            </p>
          </div>
        ))}
      </section>

      <section
        style={{
          background: superficie.tarjeta,
          border: `1px solid ${superficie.hairline}`,
          borderRadius: 16,
          padding: 24,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Entregas del día</h2>
        <MapaPodsDia pods={pods.rows} />
      </section>

      <HistoricoConciliacion />

      {mostrarFlota ? (
        <TarjetaFlota />
      ) : (
        <p style={{ fontSize: 13, color: superficie.textoFaint }}>
          La tarjeta «Tu flota» aparece cuando tengas al menos {minimoFlota.rows[0]?.valor ?? 20} rutas cerradas —
          con tus kilómetros reales, no con estimaciones.
        </p>
      )}

      <PantallaAuditoria usuarios={usuariosR.rows} dispositivos={dispositivosR.rows} />

      <Copyright />
    </Pantalla>
  );
}

// AC-DASH-02 + AC-DASH-03: el caso de la van eléctrica se construye con los datos del
// propio panadero, y al lado va el CTA hermano de KiloRuta (que otro reparta por él).
// Los dos son simétricos a propósito: se mide qué prefiere de verdad el cliente.
async function TarjetaFlota() {
  const db = await obtenerDb();
  const m = await db.query<{ km_totales: number; costo_combustion_clp: number; costo_ev_clp: number }>(
    `select coalesce(sum(km_totales),0)::int as km_totales,
            coalesce(sum(costo_combustion_clp),0)::int as costo_combustion_clp,
            coalesce(sum(costo_ev_clp),0)::int as costo_ev_clp
       from pan.metricas_flota`
  );
  const flota = m.rows[0];
  if (!flota) return null;
  const ahorro = flota.costo_combustion_clp - flota.costo_ev_clp;
  const p = await db.query<{ n: number }>(
    `select count(*)::int as n from pan.ruta_paradas rp
       join pan.rutas r on r.id = rp.ruta_id
      where r.fecha >= current_date - interval '30 days'`
  );
  const paradasMes = p.rows[0]?.n ?? 0;

  return (
    <section style={{ background: superficie.tarjeta, border: `1px solid ${superficie.hairline}`, borderRadius: 16, padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Tu flota</h2>
      <p style={{ fontSize: 14, color: superficie.textoDim, margin: "0 0 16px" }}>
        {flota.km_totales} km reales de reparto. Repartir eso en bencina te cuesta{" "}
        {formatearClp(flota.costo_combustion_clp)}; en eléctrico, {formatearClp(flota.costo_ev_clp)}.
      </p>
      <p style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", margin: "0 0 16px" }}>
        Diferencia: {formatearClp(ahorro)}
      </p>
      {/* Estos CTA eran <span> con pinta de botón y, peor, no hacían NADA al tocarlos
          — aunque las tablas de leads y sus grants existen desde 0005 y solo faltaba
          el endpoint. Ahora piden contacto con consentimiento explícito y lo
          registran de verdad (ver api/leads y CtaFlota). */}
      <CtaFlota
        kmMes={flota.km_totales}
        ahorroEstimadoClp={ahorro}
        paradasMes={paradasMes}
      />
    </section>
  );
}
