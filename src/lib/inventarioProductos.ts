export type TipoProducto = "COMPRADO" | "PREPARADO";

export type EstadoInventario = "DISPONIBLE" | "AGOTADO";

export type TipoMovimientoInventario = "INGRESO" | "SALIDA" | "AJUSTE";

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

export function etiquetaTipoMovimientoInventario(tipo: TipoMovimientoInventario): string {
  if (tipo === "INGRESO") return "Ingreso";
  if (tipo === "SALIDA") return "Salida";
  return "Ajuste";
}

export function etiquetaCantidadMovimiento(
  tipo: TipoMovimientoInventario,
  cantidadMovimiento: number,
  cantidadAnterior: number,
  cantidadNueva: number,
): string {
  if (tipo === "INGRESO") return `+${cantidadMovimiento}`;
  if (tipo === "SALIDA") return `-${cantidadMovimiento}`;
  return `${cantidadAnterior} → ${cantidadNueva}`;
}

/** Normaliza cantidad editable: no negativa, hasta 3 decimales. */
export function normalizarCantidadInventario(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

export function calcularCantidadNuevaMovimiento(
  cantidadAnterior: number,
  tipo: TipoMovimientoInventario,
  cantidadInput: number,
): number {
  const anterior = normalizarCantidadInventario(cantidadAnterior);
  const input = normalizarCantidadInventario(cantidadInput);

  if (tipo === "INGRESO") return anterior + input;
  if (tipo === "SALIDA") return Math.max(0, anterior - input);
  return input;
}

export function validarMovimientoInventario(
  cantidadAnterior: number,
  tipo: TipoMovimientoInventario,
  cantidadInput: number,
  motivo: string,
): string | null {
  const motivoLimpio = motivo.trim();
  if (!motivoLimpio && tipo !== "INGRESO") {
    return "Debes ingresar un motivo";
  }

  const input = normalizarCantidadInventario(cantidadInput);
  if (tipo === "INGRESO" || tipo === "SALIDA") {
    if (input <= 0) return "La cantidad debe ser mayor a 0";
  }
  if (tipo === "AJUSTE" && input < 0) return "La cantidad de ajuste no puede ser negativa";
  if (tipo === "SALIDA" && input > normalizarCantidadInventario(cantidadAnterior)) {
    return `Stock insuficiente. Disponible: ${normalizarCantidadInventario(cantidadAnterior)}`;
  }
  return null;
}

/** Motivo enviado al RPC. Ingreso sin texto usa valor por defecto. */
export function motivoMovimientoParaRpc(
  tipo: TipoMovimientoInventario,
  motivo: string,
): string {
  const limpio = motivo.trim();
  if (tipo === "INGRESO" && !limpio) return "Ingreso";
  return limpio;
}
