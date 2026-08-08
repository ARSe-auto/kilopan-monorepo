import { NextResponse, type NextRequest } from "next/server";
import { clasificarError } from "@/comun/error-http.ts";
import { obtenerDb } from "@/comun/db.ts";
import { registrarEvento } from "@/comun/evento.ts";
import { exigirRol } from "@/identidad/sesion.ts";
import { esUuid, MAX_LARGO_MOTIVO } from "@/comun/validacion.ts";

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
  // AC-SEC-09: `bultos_override_motivo` es `text` sin CHECK de largo, y el único guard
  // que existía era "no vacío" —y solo cuando hay bultos pendientes—. Se topa el largo
  // acá, ANTES de tocar la BD, para que aplique venga o no motivo y haya o no pendientes.
  if (typeof motivo === "string" && motivo.trim().length > MAX_LARGO_MOTIVO) {
    return NextResponse.json(
      { error: `El motivo no puede superar los ${MAX_LARGO_MOTIVO} caracteres` },
      { status: 400 }
    );
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

      // Cambiar estado a 'en_curso'. Dos triggers de BD lo validan: el del art. 55
      // (DTE por pedido) y el de carga (0024). Este último EXIGE que el override
      // —motivo + usuario— viaje en el MISMO update que mueve el estado, y él mismo
      // escribe el evento 'ruta.salida_con_bultos_pendientes' en pan.eventos: por eso
      // acá se setean las columnas bultos_override_* en vez de registrar el evento a
      // mano (AC-DES-06, AC-DES-04). Al 100 % las columnas quedan NULL y no hay override.
      if (hayPendientes) {
        await tx.query(
          `update pan.rutas
              set estado = 'en_curso',
                  bultos_override_motivo = $2,
                  bultos_override_usuario_id = $3
            where id = $1`,
          [rutaId, motivo!.trim(), sesion.usuarioId]
        );
        // El trigger de 0024 ya dejó `ruta.salida_con_bultos_pendientes` en pan.eventos al
        // ver las columnas de override; acá se agrega además el rastro a nivel de app que
        // exige AC-ADM-10 (toda operación de plata registra su evento en su ruta). Antes
        // esta línea era inalcanzable: el update pelado rebotaba en el trigger y abortaba
        // la transacción antes de llegar aquí — el override nunca dejaba rastro de app.
        await registrarEvento(
          tx,
          "ruta_salida_con_bultos_pendientes",
          "rutas",
          rutaId,
          { motivo: motivo!.trim() },
          sesion
        );
      } else {
        await tx.query(`update pan.rutas set estado = 'en_curso' where id = $1`, [rutaId]);
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
