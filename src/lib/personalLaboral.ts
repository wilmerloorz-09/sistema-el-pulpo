export type PrecioSemanal = {
  branch_id: string;
  lunes_viernes: number;
  sabado: number;
  domingo: number;
};

export type SueldoPersona = {
  lunes_viernes: number;
  sabado: number;
  domingo: number;
  dia_especial: number;
};

export type PrecioEspecial = {
  branch_id: string | null;
  fecha: string;
  valor: number;
};

export type TipoSueldoDia = "ESPECIAL" | "SABADO" | "DOMINGO" | "LUNES_VIERNES" | "SIN_CONFIGURAR";

export function normalizeFechaLaboral(value: string | null | undefined) {
  return String(value ?? "").trim().slice(0, 10);
}

export function etiquetaTipoSueldo(tipo: TipoSueldoDia) {
  switch (tipo) {
    case "ESPECIAL":
      return "Día especial";
    case "SABADO":
      return "Sábado";
    case "DOMINGO":
      return "Domingo";
    case "LUNES_VIERNES":
      return "Lunes a Viernes";
    default:
      return "Sin configurar";
  }
}

export function fechaOperativaTurno(openedAt: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(openedAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function findDiaEspecial(
  fecha: string,
  branchId: string,
  especiales: PrecioEspecial[],
) {
  const fechaNorm = normalizeFechaLaboral(fecha);
  return especiales.find((item) =>
    normalizeFechaLaboral(item.fecha) === fechaNorm
    && item.branch_id === branchId,
  ) ?? especiales.find((item) =>
    normalizeFechaLaboral(item.fecha) === fechaNorm
    && item.branch_id == null,
  );
}

export function resolverPrecioDia(
  fecha: string,
  branchId: string,
  semanal: PrecioSemanal | undefined,
  especiales: PrecioEspecial[],
) {
  const especial = findDiaEspecial(fecha, branchId, especiales);
  if (especial) return { valor: Number(especial.valor), tipo: "ESPECIAL" as const };
  if (!semanal) return { valor: null, tipo: "SIN_CONFIGURAR" as const };

  const day = new Date(`${normalizeFechaLaboral(fecha)}T12:00:00-05:00`).getUTCDay();
  if (day === 6) return { valor: Number(semanal.sabado), tipo: "SABADO" as const };
  if (day === 0) return { valor: Number(semanal.domingo), tipo: "DOMINGO" as const };
  return { valor: Number(semanal.lunes_viernes), tipo: "LUNES_VIERNES" as const };
}

/**
 * El reporte prioriza el sueldo configurado por persona.
 * Si la fecha está marcada como día especial, usa dia_especial del empleado.
 */
export function resolverSueldoPersonalDia(
  fecha: string,
  branchId: string,
  sueldoPersona: SueldoPersona | null | undefined,
  semanalSucursal: PrecioSemanal | undefined,
  especiales: PrecioEspecial[],
) {
  const especial = findDiaEspecial(fecha, branchId, especiales);

  if (especial) {
    if (sueldoPersona) {
      return { valor: Number(sueldoPersona.dia_especial), tipo: "ESPECIAL" as const };
    }
    return { valor: Number(especial.valor), tipo: "ESPECIAL" as const };
  }

  if (sueldoPersona) {
    const day = new Date(`${normalizeFechaLaboral(fecha)}T12:00:00-05:00`).getUTCDay();
    if (day === 6) return { valor: Number(sueldoPersona.sabado), tipo: "SABADO" as const };
    if (day === 0) return { valor: Number(sueldoPersona.domingo), tipo: "DOMINGO" as const };
    return { valor: Number(sueldoPersona.lunes_viernes), tipo: "LUNES_VIERNES" as const };
  }

  return resolverPrecioDia(fecha, branchId, semanalSucursal, especiales);
}

export function resumirPersonal<T extends { userId: string; personName: string; valor: number | null }>(rows: T[]) {
  const totals = new Map<string, { userId: string; personName: string; jornadas: number; total: number }>();
  for (const row of rows) {
    const current = totals.get(row.userId) ?? {
      userId: row.userId,
      personName: row.personName,
      jornadas: 0,
      total: 0,
    };
    current.jornadas += 1;
    current.total += Number(row.valor ?? 0);
    totals.set(row.userId, current);
  }
  return Array.from(totals.values()).sort((a, b) => a.personName.localeCompare(b.personName));
}

export function funcionesRealizadas(row: {
  can_serve_tables?: boolean | null;
  can_dispatch_orders?: boolean | null;
  can_serve_plates?: boolean | null;
  can_pack_orders?: boolean | null;
  can_use_caja?: boolean | null;
  is_supervisor?: boolean | null;
  is_operativo?: boolean | null;
}) {
  const funciones: string[] = [];
  if (row.can_serve_tables) funciones.push("Venta / Mesas");
  if (row.can_dispatch_orders) funciones.push("Despacho");
  if (row.can_serve_plates) funciones.push("Servir");
  if (row.can_pack_orders) funciones.push("Empaque");
  if (row.can_use_caja) funciones.push("Caja");
  if (row.is_supervisor) funciones.push("Supervisor");
  if (row.is_operativo) funciones.push("Operativo");
  return funciones;
}
