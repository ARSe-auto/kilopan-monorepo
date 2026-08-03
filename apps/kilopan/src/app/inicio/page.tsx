import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionOMotivo } from "@/identidad/sesion.ts";
import { obtenerDb } from "@/comun/db.ts";
import { superficie } from "@kilopan/miga/tokens.ts";
import { Copyright } from "@kilopan/miga/componentes/index.tsx";
import { Pantalla } from "../Pantalla.tsx";
import { SiguientePaso, type AccionSiguiente } from "../SiguientePaso.tsx";
import { destinosDe, ETIQUETA_ROL } from "../navegacion.ts";

// "Hoy" ya no es un menú: es el motor de la jornada (docs/HANDOFF.md §5.5, patrón
// `hoy/page.tsx` del CRM E-Auto Next). Antes esta pantalla era una lista de siete
// botones sueltos —"Despacho", "Consolidar y facturar"— sin decir cuál de todos es el
// que TOCA ahora. Ahora la primera tarjeta contesta esa pregunta contra el estado real
// del día; el resto de los destinos del rol sigue abajo para cuando de verdad haga
// falta cambiar de tarea a propósito (rehacer algo, revisar otra cosa).
//
// Solo admin y vendedor aterrizan acá: maestro y repartidor —con una sola pantalla—
// entran directo a la suya desde /ingresar (`destinoDeIngreso`). Por eso el cálculo del
// paso solo cubre esos dos roles.

interface PasoDelDia {
  texto: string;
  detalle?: string;
  acciones: AccionSiguiente[];
}

// El "día" de la panadería se corta a las 00:00 hora de Chile, no a las 00:00 UTC.
// Railway corre en UTC: sin este ajuste, entre las 20:00 y medianoche (hora de Chile)
// el día ya habría avanzado para el servidor y "hoy" mostraría la jornada de mañana,
// vacía (Tanda 3 de docs/AUDITORIA_NAVEGACION.md).
const HOY_CHILE = `(now() at time zone 'America/Santiago')::date`;

async function pasoDelDiaAdmin(): Promise<PasoDelDia> {
  const db = await obtenerDb();
  const [pesajes, pedidosSinRuta, rutaActiva, cajaCerrada] = await Promise.all([
    db.query<{ n: number }>(
      `select count(*)::int as n from pan.pesajes where (recibido_at at time zone 'America/Santiago')::date = ${HOY_CHILE}`
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from pan.pedidos where estado = 'confirmado' and fecha_entrega = ${HOY_CHILE}`
    ),
    db.query<{ n: number }>(`select count(*)::int as n from pan.rutas where estado = 'en_curso' and fecha = ${HOY_CHILE}`),
    db.query<{ n: number }>(
      `select count(*)::int as n from pan.cierres_caja where fecha = ${HOY_CHILE} and not anulado`
    ),
  ]);

  if ((pesajes.rows[0]?.n ?? 0) === 0) {
    return {
      texto: "Todavía no se pesó nada hoy",
      detalle: "El primer paso del día es siempre pesar lo que sale del horno.",
      acciones: [{ etiqueta: "Empezar a pesar", href: "/pesar" }],
    };
  }
  const nPedidos = pedidosSinRuta.rows[0]?.n ?? 0;
  if (nPedidos > 0) {
    return {
      texto: `${nPedidos} pedido${nPedidos === 1 ? "" : "s"} confirmado${nPedidos === 1 ? "" : "s"} esperando salir`,
      detalle: "Arma la ruta del furgón en Despacho para que no se acumulen.",
      acciones: [{ etiqueta: "Armar la ruta", href: "/pedidos" }],
    };
  }
  if ((rutaActiva.rows[0]?.n ?? 0) > 0) {
    return {
      texto: "El furgón está en reparto",
      detalle: "El repartidor va marcando cada entrega desde su teléfono.",
      acciones: [{ etiqueta: "Ver el panel del día", href: "/dashboard" }],
    };
  }
  if ((cajaCerrada.rows[0]?.n ?? 0) === 0) {
    return {
      texto: "Aún no se cerró la caja de hoy",
      detalle: "Cuando termine el turno del mesón, cuenta la plata y cierra.",
      acciones: [{ etiqueta: "Cerrar caja", href: "/caja" }],
    };
  }
  return {
    texto: "El día está al día",
    detalle: "Pesaje, despacho y caja ya están resueltos — no hay nada esperando.",
    acciones: [{ etiqueta: "Ver el panel del día", href: "/dashboard" }],
  };
}

async function pasoDelDiaVendedor(dispositivoId: string): Promise<PasoDelDia> {
  const db = await obtenerDb();
  // AC-VEN-05: sin turno abierto no hay a quién cargarle el arqueo (0018_turnos_
  // cierre_caja.sql) — abrirlo es lo primero que toca al llegar, antes que vender.
  const turnoAbierto = await db.query<{ n: number }>(
    `select count(*)::int as n from pan.turnos where dispositivo_id = $1 and cerrado_at is null`,
    [dispositivoId]
  );
  if ((turnoAbierto.rows[0]?.n ?? 0) === 0) {
    return {
      texto: "Falta abrir el turno",
      detalle: "Anota el fondo con el que partes la caja antes de vender.",
      acciones: [{ etiqueta: "Abrir turno", href: "/apertura-turno" }],
    };
  }
  const cajaCerrada = await db.query<{ n: number }>(
    `select count(*)::int as n from pan.cierres_caja where fecha = ${HOY_CHILE} and not anulado`
  );
  return (cajaCerrada.rows[0]?.n ?? 0) > 0
    ? { texto: "Caja ya cerrada hoy", detalle: "Buen turno. Mañana se cuenta de nuevo.", acciones: [] }
    : { texto: "El mesón está listo para vender", detalle: undefined, acciones: [{ etiqueta: "Vender en el mesón", href: "/vender" }] };
}

export default async function InicioPage() {
  // Antes esta pantalla reimplementaba la consulta de sesión a mano y se le había
  // olvidado el chequeo de expiración por inactividad (AC-ID-05) que sí tiene
  // obtenerSesionActual — una sesión vencida hacía "F5" acá y seguía adentro.
  const { sesion, motivo } = await obtenerSesionOMotivo({ cookies: await cookies() });
  // El motivo viaja a /ingresar para que la pantalla lo diga. Sin él, tocar «Menú» con la
  // sesión caída te dejaba en el login sin una palabra de explicación — que es exactamente
  // lo que se ve desde el mesón como «la app me botó y no sé por qué».
  if (!sesion) redirect(`/ingresar?motivo=${motivo}`);

  const destinos = destinosDe(sesion.rol);
  const paso =
    sesion.rol === "admin"
      ? await pasoDelDiaAdmin()
      : sesion.rol === "vendedor"
        ? await pasoDelDiaVendedor(sesion.dispositivoId)
        : null;

  return (
    <Pantalla titulo="Hoy" bajada={`Hola, ${sesion.nombre} · ${ETIQUETA_ROL[sesion.rol]}`}>
      {paso ? <SiguientePaso texto={paso.texto} detalle={paso.detalle} acciones={paso.acciones} /> : null}

      {/* El resto de las tareas del rol, para cambiar de una a otra A PROPÓSITO —no es
          el único camino, la tarjeta de arriba ya señaló cuál sigue. */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {destinos.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            style={{
              display: "block",
              minHeight: 56,
              padding: "10px 18px",
              borderRadius: 12,
              border: `1px solid ${superficie.hairline}`,
              background: superficie.tarjeta,
              color: superficie.texto,
              textDecoration: "none",
            }}
          >
            <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{d.etiqueta}</span>
            <span style={{ display: "block", fontSize: 13, color: superficie.textoDim, marginTop: 2 }}>
              {d.detalle}
            </span>
          </Link>
        ))}
      </nav>

      <Copyright />
    </Pantalla>
  );
}
