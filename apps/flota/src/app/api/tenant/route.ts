import { headers } from "next/headers";
import { poolDe } from "../../../servidor/conexion.ts";

// La mitad POSITIVA de AC-FTEN-05: un request al subdominio de A opera sobre la BD de A.
//
// Sin esto, el AC sería solo tres códigos de error. Que un subdominio inexistente reciba 404
// no prueba que el existente vaya a la base correcta — y ese es el cruce que el §4.1 hace
// imposible por construcción. La prueba es que el slug se lee de `tenant_info` de SU base,
// que es la fila que la provisión sembró ahí y que ninguna otra base tiene igual.
//
// Node y no Edge: acá se abre el pool del tenant con el driver de Postgres.
export const runtime = "nodejs";
// Cada request resuelve su tenant: cachear esto serviría la identidad de un tenant a otro.
export const dynamic = "force-dynamic";

export async function GET() {
  // La cabecera la puso el middleware DESPUÉS de resolver contra `control`, y la sobrescribe
  // siempre. Si falta, es que este handler se alcanzó por fuera del ruteo: no se adivina.
  const bd = (await headers()).get("x-flota-tenant-bd");
  if (!bd) return new Response(null, { status: 404 });

  const { rows } = await poolDe(bd).query<{ slug: string }>("select slug from tenant_info");
  const slug = rows[0]?.slug;
  if (!slug) return new Response(null, { status: 404 });

  return Response.json({ slug, bd });
}
