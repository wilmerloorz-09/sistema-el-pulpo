export function dinero(valor: number): string {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    Number(valor) || 0,
  );
}

/** Mismo formato de total que las tarjetas de /mesas del POS. */
export function dineroMesa(valor: number): string {
  const n = Math.round((Number(valor) || 0) * 100) / 100;
  return `$${n.toFixed(2)}`;
}

export function normalizarCodigo(codigo: string): string {
  return String(codigo ?? "").trim().replace(/[\r\n\t]/g, "");
}

export function esCodigoBarrasValido(codigo: string): boolean {
  const c = normalizarCodigo(codigo);
  return c.length >= 4 && c.length <= 80;
}

export function etiquetaTipoOrden(tipo: string): "mesa" | "llevar" | "otro" {
  const t = String(tipo ?? "").toUpperCase();
  if (t === "DINE_IN" || t === "TABLE" || t === "EXTRA") return "mesa";
  if (t === "TAKEOUT" || t === "EXPRESS") return "llevar";
  return "otro";
}

export function etiquetaPago(saldo: number, estado: string): string {
  if (String(estado).toUpperCase() === "CANCELLED") return "Cerrada";
  if (saldo <= 0.009) return "Pagada";
  return "Por cobrar";
}

export function etiquetaOrden(orden: {
  codigo: string | null;
  mesa: string | null;
  tipo: string;
}): string {
  const tipo = etiquetaTipoOrden(orden.tipo);
  if (tipo === "mesa" && orden.mesa) return orden.mesa.startsWith("Mesa") ? orden.mesa : `Mesa ${orden.mesa}`;
  if (orden.codigo) return String(orden.codigo);
  return tipo === "llevar" ? "Para llevar" : "Orden";
}

export function formatearHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function nuevoIdOperacion(): string {
  return crypto.randomUUID();
}

export function iniciales(nombre: string): string {
  const parts = String(nombre || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "EP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
