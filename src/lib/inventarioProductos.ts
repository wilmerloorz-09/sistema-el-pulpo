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

/** Si true, las ventas futuras validarán/descontarán stock en esta sucursal. */
export function etiquetaIntegraConVentas(integra: boolean): string {
  return integra ? "Sí" : "No";
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

/** Normaliza cantidad editable: entero no negativo. */
export function normalizarCantidadInventario(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Para inputs de cantidad: solo dígitos (sin punto, coma ni signo). */
export function soloDigitosCantidad(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Bloquea teclas que no forman un entero (punto, coma, signo, exponente). */
export function bloquearTeclaNoEntera(event: { key: string; preventDefault: () => void }): void {
  if ([".", ",", "-", "+", "e", "E"].includes(event.key)) event.preventDefault();
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
    return `Stock insuficiente. Disponible: ${formatCantidadInventarioDisplay(cantidadAnterior)}`;
  }
  return null;
}

/** Muestra 1 en vez de 1.000; conserva decimales útiles (1.5). */
export function formatCantidadInventarioDisplay(value: number | string): string {
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(n)) return String(value ?? "");
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/** Limpia "Disponible: 1.000, solicitado: 2.000" (o "0.") → "1" y "2"; sin stock → "No hay stock de ...". */
export function formatearMensajeStockInventario(raw: string): string {
  return String(raw ?? "")
    .replace(
      /(Disponible:|solicitado:)\s*(\d+(?:[.,]\d*)?)/gi,
      (_match, label: string, num: string) =>
        `${label} ${formatCantidadInventarioDisplay(num)}`,
    )
    .replace(
      /Stock insuficiente para "([^"]+)"\. Disponible: 0, solicitado: [\d.]+/i,
      'No hay stock de "$1".',
    );
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

/** Producto con integración de ventas activa y stock en cero. */
export function productoBloqueadoPorStockInventario(params: {
  integraConVentas: boolean;
  cantidadDisponible: number;
}): boolean {
  return params.integraConVentas && Number(params.cantidadDisponible) <= 0;
}

/** Stock a mostrar en menú/órdenes: solo si Integra ventas = Sí. */
export function stockVisibleParaOrden(params: {
  integraConVentas: boolean;
  cantidadDisponible: number;
}): number | null {
  if (!params.integraConVentas) return null;
  const qty = Number(params.cantidadDisponible);
  return Number.isFinite(qty) ? Math.max(0, qty) : 0;
}

/** Rojo en órdenes: sin stock, o stock menor al límite de la sucursal. */
export function stockEnRojo(stock: number, limite = 0): boolean {
  return stock <= 0 || stock < Number(limite || 0);
}

export function formatearStockVisible(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  if (Number.isInteger(qty)) return String(qty);
  return String(Number(qty.toFixed(3)));
}
