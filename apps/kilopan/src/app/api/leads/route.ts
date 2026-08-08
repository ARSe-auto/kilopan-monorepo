import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { aEnteroEnRango } from "@/comun/validacion.ts";

// AC-DASH-07: Cablear el POST de ambos CTA (lead_eauto y lead_kiloruta).
// AC-DASH-02/03: los dos CTA de la tarjeta «Tu flota» del panel del dueño. Las tablas
// (pan.lead_eauto, pan.lead_kiloruta) y sus grants existen desde 0005, pero nunca se
// escribió el endpoint: los botones estaban en pantalla y no hacían absolutamente
// nada. El dueño tocaba «Quiero que e-auto me contacte», no pasaba nada, y el interés
// —que es justo lo que estas tablas existen para medir— se perdía (auditoría de
// experiencia). Solo el admin: es el dueño quien decide que lo contacten.
//
// El consentimiento es explícito y lo exige un CHECK de la BD, no solo esta ruta:
// insertar un lead con consentimiento=false rebota en el motor.
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: {
    tipo?: string;
    contacto?: string;
    kmMes?: number;
    ahorroEstimadoClp?: number;
    paradasMes?: number;
    consentimiento?: boolean;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { tipo, contacto, consentimiento } = cuerpo;
  if (tipo !== "eauto" && tipo !== "kiloruta") {
    return NextResponse.json({ error: "Tipo de interés inválido" }, { status: 400 });
  }
  if (typeof contacto !== "string" || contacto.trim().length < 3) {
    return NextResponse.json({ error: "Deja un teléfono o correo para contactarte" }, { status: 400 });
  }
  // Se valida acá ADEMÁS del CHECK de la BD para poder devolver un mensaje legible en
  // vez de un rebote crudo del motor.
  if (consentimiento !== true) {
    return NextResponse.json(
      { error: "Necesitamos tu consentimiento explícito para compartir tu contacto" },
      { status: 400 }
    );
  }
  const kmMes = aEnteroEnRango(cuerpo.kmMes ?? 0, 0);
  if (kmMes === null) {
    return NextResponse.json({ error: "Kilómetros inválidos" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    if (tipo === "eauto") {
      const ahorro = aEnteroEnRango(cuerpo.ahorroEstimadoClp ?? 0, 0);
      if (ahorro === null) {
        return NextResponse.json({ error: "Ahorro estimado inválido" }, { status: 400 });
      }
      await db.query(
        `insert into pan.lead_eauto (km_mes, ahorro_estimado_clp, contacto, consentimiento)
         values ($1,$2,$3,true)`,
        [kmMes, ahorro, contacto.trim()]
      );
    } else {
      const paradas = aEnteroEnRango(cuerpo.paradasMes ?? 0, 0);
      if (paradas === null) {
        return NextResponse.json({ error: "Paradas inválidas" }, { status: 400 });
      }
      await db.query(
        `insert into pan.lead_kiloruta (km_mes, paradas_mes, contacto, consentimiento)
         values ($1,$2,$3,true)`,
        [kmMes, paradas, contacto.trim()]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("POST /api/leads:", mensaje);
    // AC-SEC-10: 400 si la BD rechazo el DATO; 500 solo si de verdad nos rompimos.
    const clasificado = clasificarError(err, "No se pudo registrar tu interés");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
