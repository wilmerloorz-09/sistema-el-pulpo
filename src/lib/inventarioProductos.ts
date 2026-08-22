export type TipoProducto = "COMPRADO" | "PREPARADO";

export type EstadoInventario = "DISPONIBLE" | "AGOTADO";

export function estadoInventarioDesdeCantidad(cantidad: number): EstadoInventario {
  return Number(cantidad) > 0 ? "DISPONIBLE" : "AGOTADO";
}

export function etiquetaTipoProducto(tipo: TipoProducto | string | null | undefined): string {
  if (tipo === "PREPARADO") return "Preparado";
  return "Comprado";
}

export function etiquetaEstadoInventario(estado: EstadoInventario): string {
  return estado === "DISPONIBLE" ? "Disponible" : "Agotado";
}

/** Normaliza cantidad editable: no negativa, hasta 3 decimales. */
export function normalizarCantidadInventario(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}
