import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { esUuid } from "@/comun/validacion.ts";

// AC-DES-06: «Salir a ruta» desde la pantalla de carga F3. Valida:
// 1. Todos los pedidos tienen DTE asociado (trigger de 0024 en BD)
// 2. Si hay bultos pendientes, exige motivo del override (auditado en eventos)
export async function POST(request: NextRequest) {
  const sesion = await exigirRol(request, ["admin", "repartidor"]);
  if (sesion instanceof NextResponse) return sesion;

  let cuerpo: { rutaId?: string; motivo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { rutaId, motivo } = cuerpo;
  if (!rutaId || !esUuid(rutaId)) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }

  const db = await obtenerDb();
  try {
    await db.transaccion(async (tx) => {
      // Verificar que la ruta existe y pertenece al usuario (si repartidor)
      const ruta = await tx.query(
        `select id from pan.rutas where id = $1 and ($2 = 'admin' or repartidor_id = $3)`,
        [rutaId, sesion.rol, sesion.usuarioId]
      );
      if (ruta.rows.length === 0) {
        throw Object.assign(new Error("ruta_no_encontrada"), {
          publico: "Ruta no encontrada",
        });
      }

      // Contar bultos pendientes (AC-DES-04)
      const pendientes = await tx.query<{ pendientes: number }>(
        `select count(*) filter (where cargado_at is null)::int as pendientes
           from pan.bultos b
           join pan.ruta_paradas rp on rp.pedido_id = b.pedido_id
          where rp.ruta_id = $1`,
        [rutaId]
      );
      const hayPendientes = (pendientes.rows[0]?.pendientes ?? 0) > 0;

      // Si hay pendientes pero no hay motivo del override, rechazar
      if (hayPendientes && !motivo?.trim()) {
        throw Object.assign(new Error("motivo_requerido"), {
          publico: "Debes indicar el motivo para salir con bultos pendientes",
        });
      }

      // Cambiar estado a 'en_curso' — el trigger de BD valida los DTE
      await tx.query(`update pan.rutas set estado = 'en_curso' where id = $1`, [rutaId]);

      // Si hay override, registrar evento auditado (AC-DES-04)
      if (hayPendientes && motivo?.trim()) {
        await registrarEvento(
          tx,
          "ruta_salida_con_bultos_pendientes",
          "rutas",
          rutaId,
          { motivo: motivo.trim() },
          sesion
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    const publico = err instanceof Error ? (err as Error & { publico?: string }).publico : undefined;

    if (/sin DTE asociado/i.test(mensaje)) {
      return NextResponse.json(
        {
          error:
            "No puedes salir: hay pedidos sin guía o factura asociada (art. 55 DL 825)",
        },
        { status: 409 }
      );
    }
    if (publico) {
      return NextResponse.json({ error: publico }, { status: 409 });
    }

    console.error("POST /api/rutas/salir:", mensaje);
    const clasificado = clasificarError(err, "No se pudo salir a ruta");
    return NextResponse.json({ error: clasificado.mensaje }, { status: clasificado.estado });
  }
}
