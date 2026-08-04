// Modelo de navegación de la app, en UN solo lugar.
//
// El diseño anterior era un árbol: /inicio listaba 7 botones y cada pantalla tenía —a
// veces— un enlace «← Menú» para volver. Verificado en el navegador, eso significaba:
// elegido un producto en /pesar o /vender el enlace desaparecía y con una bandeja
// empezada no quedaba NI UN control que llevara a otra parte; /ruta nunca lo tuvo; y
// terminar una acción no llevaba a ningún lado — el pesaje confirmado dejaba una línea
// verde y punto.
//
// El diseño nuevo copia la lógica del CRM E-Auto Next, que ya resolvió esto:
//   · Una barra de pestañas SIEMPRE visible abajo, al alcance del pulgar, con pocos
//     destinos raíz (allá son 4). Nunca hay que "volver" para cambiar de tarea.
//   · Una pantalla «Hoy» que no es un menú sino el motor de la jornada: dice cuál es el
//     paso que toca ahora y lo ofrece como acción primaria.
//   · Acciones que se completan EN LA MISMA PANTALLA y entregan la etapa siguiente ahí
//     mismo, sin cambiar de página ni apretar hipertextos.
// Los menús quedan para lo que sí es navegación de verdad: rehacer algo, o irse a otra
// tarea a propósito.

export type Rol = "admin" | "maestro" | "vendedor" | "repartidor";

export interface Destino {
  href: string;
  etiqueta: string;
  /** Qué se hace ahí, en lenguaje de panadería. Siete palabras sueltas («Despacho»,
   *  «Consolidar y facturar») no le dicen nada a quien recién parte. */
  detalle: string;
}

export const DESTINOS_POR_ROL: Record<Rol, Destino[]> = {
  admin: [
    { href: "/pesar", etiqueta: "Pesaje", detalle: "Anotar las bandejas que salen del horno" },
    { href: "/historial", etiqueta: "Historial de pesaje", detalle: "Lo pesado por cada maestro, con fecha, hora y foto" },
    { href: "/vender", etiqueta: "Venta mostrador", detalle: "Cobrar en el mesón" },
    { href: "/pedidos", etiqueta: "Despacho", detalle: "Pedidos de clientes y armar la ruta del furgón" },
    { href: "/caja", etiqueta: "Cierre de caja", detalle: "Contar la plata al final del turno" },
    { href: "/facturar", etiqueta: "Consolidar y facturar", detalle: "Juntar las guías de un cliente para cobrarle" },
    { href: "/dashboard", etiqueta: "Panel del dueño", detalle: "Cómo va el día: kilos, ventas y pérdidas" },
    { href: "/admin", etiqueta: "Ajustes", detalle: "Personal, productos, precios y medios de pago" },
    // AC-ADM-04: el enlace es solo comodidad — la puerta la cierra el servidor con 403.
    { href: "/arreglar", etiqueta: "Arreglar", detalle: "Deshacer un error de operación sin entrar a la base" },
    // AC-POD-06: nada que la cola rechace desaparece sin una decisión del operador.
    { href: "/pendientes", etiqueta: "Pendientes por revisar", detalle: "Lo que no se pudo subir al servidor, y por qué" },
  ],
  maestro: [
    { href: "/pesar", etiqueta: "Pesaje", detalle: "Anotar las bandejas que salen del horno" },
    { href: "/historial", etiqueta: "Mi historial", detalle: "Lo que has pesado, con fecha, hora y foto" },
    { href: "/pendientes", etiqueta: "Pendientes por revisar", detalle: "Lo que no se pudo subir al servidor, y por qué" },
  ],
  vendedor: [
    { href: "/vender", etiqueta: "Venta mostrador", detalle: "Cobrar en el mesón" },
    { href: "/caja", etiqueta: "Cierre de caja", detalle: "Contar la plata al final del turno" },
    { href: "/pendientes", etiqueta: "Pendientes por revisar", detalle: "Lo que no se pudo subir al servidor, y por qué" },
  ],
  repartidor: [
    { href: "/ruta", etiqueta: "Mi ruta", detalle: "Tus entregas de hoy, con foto y ubicación" },
    { href: "/pendientes", etiqueta: "Pendientes por revisar", detalle: "Lo que no se pudo subir al servidor, y por qué" },
  ],
};

/** Los destinos que van en la barra de pestañas, ADEMÁS de «Hoy» y «Más» que se agregan
 *  solos. Máximo dos: con «Hoy» y «Más» dan las cuatro del CRM, que es lo que cabe cómodo
 *  en un teléfono de 375 px sin que los blancos táctiles bajen de 44 px. El resto de las
 *  pantallas del rol viven en «Más» — no se pierden, dejan de estorbar. */
const PESTANAS_POR_ROL: Record<Rol, string[]> = {
  admin: ["/pesar", "/vender"],
  maestro: ["/pesar"],
  vendedor: ["/vender", "/caja"],
  repartidor: ["/ruta"],
};

/** Nombre corto para la pestaña. «Venta mostrador» no cabe bajo un icono de 24 px. */
const ETIQUETA_CORTA: Record<string, string> = {
  "/pesar": "Pesaje",
  "/vender": "Mesón",
  "/caja": "Caja",
  "/ruta": "Mi ruta",
  "/pedidos": "Despacho",
};

export interface Pestana {
  href: string;
  etiqueta: string;
  icono: "hoy" | "pesar" | "vender" | "caja" | "ruta" | "mas";
}

const ICONO_POR_RUTA: Record<string, Pestana["icono"]> = {
  "/pesar": "pesar",
  "/vender": "vender",
  "/caja": "caja",
  "/ruta": "ruta",
};

export function pestanasDe(rol: string): Pestana[] {
  const propias = (PESTANAS_POR_ROL[rol as Rol] ?? []).map((href) => ({
    href,
    etiqueta: ETIQUETA_CORTA[href] ?? href,
    icono: ICONO_POR_RUTA[href] ?? ("mas" as const),
  }));
  return [
    { href: "/inicio", etiqueta: "Hoy", icono: "hoy" },
    ...propias,
    { href: "/mas", etiqueta: "Más", icono: "mas" },
  ];
}

/** Cómo se llama el rol en voz de panadería. Va bajo el nombre en «Más» y en «Hoy»: entrar
 *  con el RUT equivocado deja una app con UNA pantalla y hasta ahora nada lo decía — se
 *  leía como app rota, no como «el maestro solo pesa». */
export const ETIQUETA_ROL: Record<Rol, string> = {
  admin: "Administrador · ve y maneja todo",
  maestro: "Maestro panadero · solo pesaje",
  vendedor: "Vendedor de mesón · venta y caja",
  repartidor: "Repartidor · solo su ruta",
};

export function destinosDe(rol: string): Destino[] {
  return DESTINOS_POR_ROL[rol as Rol] ?? [];
}

/** ¿Este rol tiene esa pantalla? Lo usan las pantallas para no ofrecer una continuación
 *  hacia un sitio donde el operador no puede entrar. */
export function puedeEntrar(rol: string | undefined, href: string): boolean {
  return !!rol && destinosDe(rol).some((d) => d.href === href);
}

/** Lo que «Más» tiene que listar: los destinos del rol que NO ya tienen su propia pestaña.
 *  Para el maestro, el vendedor y el repartidor esto sale vacío — sus una o dos pantallas
 *  ya están en la barra — y «Más» les sirve solo para ver su nombre/rol y Salir. */
export function destinosEnMas(rol: string): Destino[] {
  const enPestanas = new Set(pestanasDe(rol).map((p) => p.href));
  return destinosDe(rol).filter((d) => !enPestanas.has(d.href));
}

const TITULOS: Record<string, string> = {
  "/inicio": "Hoy",
  "/mas": "Más",
  "/pesar": "Pesaje",
  "/vender": "Venta mostrador",
  "/caja": "Cierre de caja",
  "/pedidos": "Despacho",
  "/facturar": "Consolidar y facturar",
  "/dashboard": "Panel del dueño",
  "/ruta": "Mi ruta",
  "/admin": "Ajustes",
  "/arreglar": "Arreglar",
};

export function tituloDeRuta(pathname: string): string {
  return TITULOS[pathname] ?? "KiloPan";
}

/** Pantallas sin sesión: no llevan barra (no hay tarea que seguir ni operador que nombrar). */
export const RUTAS_SIN_BARRA = new Set(["/", "/ingresar", "/vincular"]);

/** A qué pantalla saltar de inmediato al entrar — explícito por rol, no derivado de
 *  contar destinos. Antes decía "si el rol tiene una sola pantalla, entra directo a
 *  ella": funcionaba mientras maestro y repartidor tuvieran exactamente un destino cada
 *  uno, y se rompió en cuanto "Mi historial" les agregó un segundo — con el conteo,
 *  ambos habrían empezado a aterrizar en «Hoy» aunque su trabajo principal sigue siendo
 *  uno solo. El trabajo diario de cada rol no cambia porque se le sume una pantalla de
 *  consulta secundaria. */
const DESTINO_DE_INGRESO: Partial<Record<Rol, string>> = {
  maestro: "/pesar",
  repartidor: "/ruta",
};

export function destinoDeIngreso(rol: string): string {
  return DESTINO_DE_INGRESO[rol as Rol] ?? "/inicio";
}
