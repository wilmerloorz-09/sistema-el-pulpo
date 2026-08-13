/** Calendario de feriados y días hábiles bancarios (Ecuador). */

export function fechaActualEcuador(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** 0 = domingo … 6 = sábado, sobre la fecha civil (no la zona del dispositivo). */
export function weekdayFromIso(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function esFinDeSemanaIso(isoDate: string): boolean {
  const weekday = weekdayFromIso(isoDate);
  return weekday === 0 || weekday === 6;
}

export function esDiaHabilBancario(isoDate: string, feriados: Iterable<string>): boolean {
  const feriadoSet = feriados instanceof Set ? feriados : new Set(feriados);
  return !esFinDeSemanaIso(isoDate) && !feriadoSet.has(isoDate);
}

/** Siguiente lunes–viernes que no esté en la lista de feriados. */
export function siguienteDiaHabil(isoDate: string, feriados: Iterable<string>): string {
  const feriadoSet = feriados instanceof Set ? feriados : new Set(feriados);
  let cursor = addDaysIso(isoDate, 1);
  for (let i = 0; i < 16; i += 1) {
    if (esDiaHabilBancario(cursor, feriadoSet)) return cursor;
    cursor = addDaysIso(cursor, 1);
  }
  return cursor;
}

/**
 * Fechas válidas en un comprobante al cobrar ahora.
 * Día hábil: solo hoy. Día no hábil (finde o feriado): hoy y el siguiente hábil.
 */
export function fechasAceptadasComprobante(
  now = new Date(),
  feriados: Iterable<string> = [],
): string[] {
  const hoy = fechaActualEcuador(now);
  const feriadoSet = feriados instanceof Set ? feriados : new Set(feriados);
  if (esDiaHabilBancario(hoy, feriadoSet)) return [hoy];
  return [hoy, siguienteDiaHabil(hoy, feriadoSet)];
}

export function expandirRangoFechas(
  fechaInicio: string,
  fechaFin: string,
  options?: { omitirFinesDeSemana?: boolean },
): string[] {
  const omitirFinesDeSemana = options?.omitirFinesDeSemana !== false;
  if (fechaFin < fechaInicio) return [];
  const dates: string[] = [];
  let cursor = fechaInicio;
  for (let i = 0; i < 40; i += 1) {
    if (!omitirFinesDeSemana || !esFinDeSemanaIso(cursor)) dates.push(cursor);
    if (cursor === fechaFin) break;
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
export function domingoPascua(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface FeriadoNacional {
  fecha: string;
  nombre: string;
}

function fechaFija(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Feriados nacionales de Ecuador (fecha oficial; los puentes se agregan a mano). */
export function feriadosNacionalesEcuador(year: number): FeriadoNacional[] {
  const pascua = domingoPascua(year);
  return [
    { fecha: fechaFija(year, 1, 1), nombre: "Año Nuevo" },
    { fecha: addDaysIso(pascua, -48), nombre: "Carnaval" },
    { fecha: addDaysIso(pascua, -47), nombre: "Carnaval" },
    { fecha: addDaysIso(pascua, -3), nombre: "Jueves Santo" },
    { fecha: addDaysIso(pascua, -2), nombre: "Viernes Santo" },
    { fecha: fechaFija(year, 5, 1), nombre: "Día del Trabajo" },
    { fecha: fechaFija(year, 5, 24), nombre: "Batalla de Pichincha" },
    { fecha: fechaFija(year, 8, 10), nombre: "Primer Grito de Independencia" },
    { fecha: fechaFija(year, 10, 9), nombre: "Independencia de Guayaquil" },
    { fecha: fechaFija(year, 11, 2), nombre: "Día de los Difuntos" },
    { fecha: fechaFija(year, 11, 3), nombre: "Independencia de Cuenca" },
    { fecha: fechaFija(year, 12, 25), nombre: "Navidad" },
  ];
}
