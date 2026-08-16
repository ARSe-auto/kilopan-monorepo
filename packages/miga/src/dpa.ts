// El DPA en términos del tenant [AC-FMIG-22] — §3.E1.15, §7.8.
//
// EL ARTEFACTO VERSIONADO QUE PIDE EL AC ES ESTE ARCHIVO. `DPA_VERSION` es su versión: cambia
// cuando cambia cualquier sección de `DPA_SECCIONES`, y es lo que `servidor/dpa.ts` graba como
// «versión aceptada» en `audit_trail` (§4.6) — el mismo criterio que ya usa `config_version_id`
// para congelar QUÉ vio quien aceptó, en vez de dejar que un documento mutable reescriba el
// pasado.
//
// QUÉ ESTÁ CERRADO Y QUÉ NO (el AC lo dice con esas palabras: «el AC cierra hoy con la parte
// estructural y se completa al responderse»). Las SIETE secciones mínimas existen con contenido
// real —jamás un `hueco de relleno`— derivado de decisiones YA tomadas en otras partes del maestro:
// base de licitud = ejecución de contrato jamás consentimiento de trabajadores (§7.8), ID opaco
// y anonimización sin tocar el ledger (§4.3), aislamiento físico por tenant (§4.1), argon2id y
// RUT enmascarado (§7.8), y el offboarding como `pg_dump` completo (§2 métrica 7). Lo que SÍ
// falta —el texto legal final revisado por un abogado y el momento exacto de la aceptación
// (paso del wizard vs panel admin)— está bloqueado por la Pregunta al dueño 12, y esta spec no
// lo inventa: `DPA_VERSION` sube el día que esa pregunta se responda y el contenido se reemplace.
//
// POR QUÉ VIVE EN `packages/miga` Y NO EN `apps/flota`: este paquete ya es dueño de la capa de
// copy es-CL (`terminologia.ts`) y de los tokens que la sirven sin CSS libre ni build por
// cliente (§5.1) — el DPA es la misma clase de artefacto: texto versionado, consumido por
// cualquier tenant sin fork.

export type SeccionDpa = { id: string; titulo: string; cuerpo: string };

/** Sube en CUALQUIER cambio de `DPA_SECCIONES` — es lo que distingue «el tenant aceptó ESTE
 *  texto» de «el tenant aceptó lo que hubiera acá cuando lo miró» (§4.6, doble reloj aplicado a
 *  un documento en vez de a un evento de terreno). */
export const DPA_VERSION = "2026-08-16-v1";

/** La ruta donde el panel admin sirve el documento — depth 2 (`/panel/dpa`), la misma
 *  profundidad que `/panel/funciones` y `/panel/terminologia` (§5.1: máx 2 niveles). */
export const DPA_RUTA = "/panel/dpa";

export const DPA_SECCIONES: readonly SeccionDpa[] = [
  {
    id: "partes",
    titulo: "Partes",
    cuerpo:
      "Este acuerdo de tratamiento de datos rige entre KiloRuta (la Plataforma) y el Tenant " +
      "contratante identificado en su propia cuenta del panel administrativo. Aplica desde que " +
      "el Tenant lo acepta y queda vigente mientras dure el contrato de servicio, salvo " +
      "reemplazo por una versión posterior de este mismo documento.",
  },
  {
    id: "objeto",
    titulo: "Objeto del tratamiento",
    cuerpo:
      "El tratamiento tiene por objeto exclusivo la operación del servicio contratado: " +
      "identidad del personal del Tenant (choferes, operadores, responsables de carga y " +
      "técnicos), seguimiento de vehículos y rutas, captura de evidencia de entrega, " +
      "liquidación de servicios y los reportes operativos derivados de esos hechos. KiloRuta " +
      "no trata estos datos para ningún fin propio ajeno al servicio ni los cede a terceros " +
      "distintos de los subencargados declarados en este documento.",
  },
  {
    id: "encargado_responsable",
    titulo: "Encargado y responsable del tratamiento",
    cuerpo:
      "El Tenant es el RESPONSABLE del tratamiento de los datos personales de su propio " +
      "personal y de sus destinatarios; KiloRuta es el ENCARGADO, y procesa esos datos " +
      "únicamente por cuenta e instrucción documentada del Tenant. La base de licitud del " +
      "tratamiento es la ejecución del contrato de servicio entre el Tenant y su personal — " +
      "jamás el consentimiento individual de los trabajadores, que la Ley 21.719 no exige ni " +
      "esta relación asume.",
  },
  {
    id: "subencargados",
    titulo: "Subencargados",
    cuerpo:
      "KiloRuta emplea como subencargados al proveedor del clúster Postgres gestionado donde " +
      "corre la base de datos propia de cada tenant, y a los proveedores de mensajería " +
      "(WhatsApp/SMS del propio teléfono, vía share-sheet del sistema) que el Tenant elige al " +
      "compartir una invitación de enrolamiento. Ningún subencargado nuevo se agrega a esta " +
      "lista sin que la versión de este documento suba y el Tenant vuelva a aceptar.",
  },
  {
    id: "seguridad",
    titulo: "Medidas de seguridad",
    cuerpo:
      "Aislamiento físico por tenant: cada Tenant tiene su propia base de datos y sus propias " +
      "credenciales, sin cruce posible entre compañías. Los PIN de acceso se guardan con " +
      "argon2id, jamás en texto plano ni en bitácoras. El RUT aparece enmascarado en los logs " +
      "del servidor. La minimización es la regla por defecto: la geolocalización viene apagada " +
      "salvo que el Tenant la active, y las fotografías de evidencia son una mejora progresiva, " +
      "jamás una exigencia para completar una entrega. La evidencia binaria queda firmada por " +
      "sha256 y no se puede sobrescribir una vez capturada.",
  },
  {
    id: "devolucion_y_supresion",
    titulo: "Devolución y supresión al término",
    cuerpo:
      "Al término del contrato, KiloRuta entrega al Tenant la base de datos completa de su " +
      "operación (ver «Portabilidad» más abajo) y, cumplido el plazo de retención vigente para " +
      "ese Tenant, suprime los datos identificatorios por anonimización de la tabla `personas` " +
      "— sin tocar el resto del registro histórico de operación, que permanece con un " +
      "identificador opaco y sin poder volver a asociarse a la persona.",
  },
  {
    id: "portabilidad",
    titulo: "Portabilidad",
    cuerpo:
      "El offboarding de un Tenant es, siempre, la entrega de un `pg_dump` completo de SU base " +
      "de datos — nunca una extracción parcial: el aislamiento físico por tenant (una base de " +
      "datos por tenant, sin tablas compartidas de dominio) hace que la base entera SEA el " +
      "export completo. Es la métrica 7 del régimen de plataforma y el fundamento técnico del " +
      "derecho de portabilidad de la Ley 21.719.",
  },
] as const;
