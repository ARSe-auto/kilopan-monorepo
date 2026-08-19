export { CifraGrande } from "./CifraGrande.tsx";
export { TecladoNumerico } from "./TecladoNumerico.tsx";
export { BotonPrimario } from "./BotonPrimario.tsx";
export { BotonTactil } from "./BotonTactil.tsx";
export { SelectorUnToque } from "./SelectorUnToque.tsx";
export { ChipEstadoConexion } from "./ChipEstadoConexion.tsx";
export { ChipOperador } from "./ChipOperador.tsx";
export { Copyright } from "./Copyright.tsx";
export { Termino } from "./Termino.tsx";
// AC-H0-11: los cuatro estados obligatorios de listado. El cuarto (sin conexión) es
// ChipEstadoConexion, que ya existía — estos tres son los que faltaban.
// AC-FMIG-10: la escalada única de «skeleton <50 ms, spinner solo >400 ms» (§5.7).
export { EstadoCargando, EstadoVacio, EstadoError, useEscaladaDeCarga } from "./EstadoListado.tsx";
