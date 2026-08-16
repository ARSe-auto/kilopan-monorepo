import { headers } from "next/headers";
import { poolDe } from "../../../../servidor/conexion.ts";
import { resolverSesion, secretoDe } from "../../../../servidor/sesion.ts";
import { rotarIdentidad } from "../../../../servidor/anden.ts";
import { noExiste } from "../../../../servidor/gobierno.ts";
import { hashDeSecreto } from "../../../../dominio/secretos.ts";

// La rotación por PIN del andén [AC-FIDN-07] — §5.4 F-D, §4.7 (centinela 9), §4.2.
//
// NO USA `guardia` NI `sesionDelTenant`, y esa es la decisión de fondo: las dos exigen una sesión
// resuelta, y acá el punto de partida es justamente un aparato que TODAVÍA no tiene identidad
// humana —o que tiene la del operario anterior, que se está por ir—. Lo que autentica al request
// es el secreto del APARATO, que es lo único que el andén tiene antes del PIN.
//
// ES PLANIFICACIÓN (§4.2): valida online y rebota 422 tipado. No es una captura de terreno —el
// PIN no se puede verificar sin servidor, argon2id vive en la base— así que no hay nada que
// degradar. Lo que JAMÁS rebota es lo que quedó en el outbox del operario anterior, y por eso
// esta rotación no toca ni una llave del disco del aparato.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const cabeceras = await headers();
  const bd = cabeceras.get("x-flota-tenant-bd");
  if (!bd) return noExiste();
  const pool = poolDe(bd);

  const veredicto = await resolverSesion(pool, cabeceras.get("authorization"));
  // El andén sin identidad es el caso NORMAL de esta ruta: el aparato está sano y esperando que
  // alguien tipee su PIN. Cualquier otro motivo —sin credencial, desconocida, revocada— es un
  // aparato que no tiene por qué estar preguntando, y se le responde el 404 pelado de siempre.
  const dispositivoId =
    veredicto.tipo === "valida"
      ? veredicto.sesion.dispositivoId
      : veredicto.motivo === "anden_sin_identidad"
        ? await dispositivoDelSecreto(pool, cabeceras.get("authorization"))
        : null;
  if (!dispositivoId) return noExiste();

  const cuerpo: unknown = await peticion.json().catch(() => null);
  const datos = cuerpo as { rut?: unknown; pin?: unknown } | null;
  if (typeof datos?.rut !== "string" || typeof datos?.pin !== "string") {
    return Response.json(
      { error: "datos_incompletos", mensaje: "Falta el RUT o el PIN." },
      { status: 422 },
    );
  }

  const rotacion = await rotarIdentidad(pool, {
    dispositivoId,
    rut: datos.rut,
    pin: datos.pin,
  });
  if (rotacion.tipo === "rebote") {
    if (rotacion.motivo === "no_es_anden") return noExiste();
    // RUT desconocido y PIN equivocado responden EXACTAMENTE lo mismo (misma razón que
    // AC-FIDN-08): si difirieran, el aparato apoyado en la mesa del andén sería un buscador de
    // los RUTs de la empresa. El bloqueo sí se dice, porque quien está bloqueado ya sabe quién es
    // y necesita entender por qué su PIN correcto no abre (§5.7).
    return Response.json(
      rotacion.motivo === "bloqueado"
        ? {
            error: "bloqueado",
            mensaje: "Demasiados intentos. Esperá un momento o pedile al dueño que te desbloquee.",
          }
        : { error: "credenciales_invalidas", mensaje: "El RUT o el PIN no coinciden." },
      { status: 422 },
    );
  }

  // La huella viaja al aparato porque es la partición de SU outbox (§4.7, `cliente/identidad.ts`).
  // No es una credencial: con ella no se entra a ningún lado —el request sigue autenticándose con
  // el secreto del aparato— y lo único que decide es bajo qué llave el teléfono guarda lo que este
  // operario capture, para que al rotar no se mezcle con lo del siguiente.
  return Response.json({
    huella: rotacion.huella,
    nombre: rotacion.nombre,
    rol: rotacion.rol,
  });
}

/** El aparato detrás del secreto, cuando todavía no hay identidad humana que resolver. */
async function dispositivoDelSecreto(
  pool: ReturnType<typeof poolDe>,
  cabecera: string | null,
): Promise<string | null> {
  const secreto = secretoDe(cabecera);
  if (!secreto) return null;
  const { rows } = await pool.query<{ id: string }>(
    "select id::text as id from dispositivos where secreto_hash = $1 and revocado_at is null",
    [hashDeSecreto(secreto)],
  );
  return rows[0]?.id ?? null;
}
