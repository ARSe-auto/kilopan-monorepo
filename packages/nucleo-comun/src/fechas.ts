import { FORMATOS } from "./constants.ts";

// Fechas y horas visibles, en es-CL [AC-FVEH-07] — §0 (Formatos), §3.E1.4.
//
// UNA sola implementación, por la misma razón que la fórmula de energía: `dd-mm-aaaa` escrito
// a mano en cada pantalla es `mm-dd-aaaa` en la que alguien copió de un ejemplo de internet, y
// el 03-04 de una agenda se lee como abril en una pantalla y como marzo en la de al lado. En un
// país que escribe el día primero, esa confusión no la nota nadie hasta que un camión sale un
// mes tarde.
//
// El huso es el de Chile y no el del navegador (§0: la app está cableada a un solo país). Un
// bloque agendado a las 22:00 de Santiago se vería como del día siguiente en un servidor que
// corre en UTC, y la agenda de la noche entera se leería corrida un día.

const CON_HUSO = { timeZone: FORMATOS.zona_horaria } as const;

/** `dd-mm-aaaa`, el formato del §0. Con guiones, que es como se escribe una fecha en Chile. */
export function fechaEsCl(cuando: Date): string {
  const partes = new Intl.DateTimeFormat(FORMATOS.locale, {
    ...CON_HUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(cuando);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${de("day")}-${de("month")}-${de("year")}`;
}

/** `hh:mm` en 24 horas: en un galpón a las cinco de la mañana nadie quiere leer «a. m.». */
export function horaEsCl(cuando: Date): string {
  return new Intl.DateTimeFormat(FORMATOS.locale, {
    ...CON_HUSO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(cuando);
}

/** El día de la semana, en minúsculas y sin abreviar: la agenda se lee de un vistazo. */
export function diaDeSemanaEsCl(cuando: Date): string {
  return new Intl.DateTimeFormat(FORMATOS.locale, { ...CON_HUSO, weekday: "long" }).format(cuando);
}

/**
 * El lunes de la semana de `cuando`, a las 00:00 de Chile.
 *
 * La semana empieza el LUNES, como en Chile y como en la norma ISO — y como `date_trunc` de
 * PostgreSQL, que es lo que usa la vista `eevd_semanal`. Si acá empezara el domingo, la agenda
 * y la métrica norte estarían hablando de semanas distintas con el mismo nombre.
 */
export function lunesDeLaSemana(cuando: Date): Date {
  const enChile = new Date(cuando.toLocaleString("en-US", CON_HUSO));
  const diaDeLaSemana = (enChile.getDay() + 6) % 7; // lunes = 0
  enChile.setDate(enChile.getDate() - diaDeLaSemana);
  enChile.setHours(0, 0, 0, 0);
  // Se reconstruye desde las partes en Chile para que el resultado sea el instante correcto
  // sin importar el huso del proceso que lo ejecuta.
  const desfase = new Date(cuando.toLocaleString("en-US", CON_HUSO)).getTime() - cuando.getTime();
  return new Date(enChile.getTime() - desfase);
}

/**
 * Dinero en es-CL: `$12.500` [AC-FVEH-13] — §0 (Formatos), §4.8.
 *
 * Vive en este módulo por la misma razón que las fechas: un solo lugar. Escrito a mano en cada
 * pantalla, el separador de miles se convierte en coma en la primera que alguien copie de un
 * ejemplo, y `$12,500` en Chile se lee como doce pesos con medio.
 *
 * Recibe un ENTERO porque en CLP no hay centavos (§0): el decimal aparece recién en el primer
 * total que no cuadra por un peso. Quien tenga un `numeric` lo redondea antes, con `round_clp`
 * en la base, que es donde el §4.8 pone el cálculo.
 */
export function dineroEsCl(pesos: number): string {
  return new Intl.NumberFormat(FORMATOS.locale, {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(pesos));
}
