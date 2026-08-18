export function getOrderOriginLabel(params: {
  orderType: string | null | undefined;
  tableName?: string | null;
  splitCode?: string | null;
  isSpecial?: boolean | null | undefined;
  isTrayOrder?: boolean | null | undefined;
}) {
  if (params.isTrayOrder) {
    return "Orden Bandeja";
  }

  if (params.isSpecial) {
    const tableName = params.tableName?.trim();
    if (tableName) {
      return `${tableName} (Orden Especial)`;
    }
    return "Orden Especial";
  }

  if (params.orderType === "EXPRESS") {
    return "Express";
  }

  if (params.orderType === "EXTRA") {
    const tableName = params.tableName?.trim();
    if (tableName) {
      return `Extra • ${tableName}`;
    }
    return "Extra";
  }

  if (params.orderType === "TAKEOUT") {
    return "Para llevar";
  }

  const tableName = params.tableName?.trim() || "Mesa";
  return tableName;
}

/** Etiqueta en español del tipo de orden (valor enum en BD). */
export function getOrderTypeLabel(
  orderType: string | null | undefined,
  options?: { isSpecial?: boolean | null; isTrayOrder?: boolean | null },
): string {
  if (options?.isTrayOrder) return "Orden bandeja";
  if (options?.isSpecial) return "Orden especial";
  switch (orderType) {
    case "DINE_IN":
      return "Mesa";
    case "TAKEOUT":
      return "Para llevar";
    case "EXPRESS":
      return "Express";
    case "EXTRA":
      return "Extra";
    default:
      return orderType?.replace(/_/g, " ").trim() || "Orden";
  }
}

export function resolveOrderTableName(params: {
  is_special?: boolean | null;
  table_id?: string | null;
  special_origin_table_id?: string | null;
  table_name_snapshot?: string | null;
  tablesMap?: Record<string, string | { name?: string | null; visual_order?: number | null }>;
}): string | null {
  const snapshot = String(params.table_name_snapshot ?? "").trim() || null;

  const lookupTable = (tableId: string | null | undefined): string | null => {
    if (!tableId) return null;
    const entry = params.tablesMap?.[tableId];
    if (!entry) return null;
    if (typeof entry === "string") {
      return entry.trim() || null;
    }
    const baseName = String(entry.name ?? "Mesa").trim() || "Mesa";
    const hasNumber = /\d/.test(baseName);
    return hasNumber ? baseName : `${baseName} ${Number(entry.visual_order ?? 0) + 1}`;
  };

  if (params.table_id) {
    return lookupTable(params.table_id) ?? snapshot;
  }

  if (params.is_special) {
    return lookupTable(params.special_origin_table_id) ?? snapshot;
  }

  return snapshot;
}

export function getOrderKind(params: {
  orderType: string | null | undefined;
  isSpecial?: boolean | null | undefined;
  isTrayOrder?: boolean | null | undefined;
}) {
  if (params.isTrayOrder) return "tray" as const;
  if (params.isSpecial) return "special" as const;
  if (params.orderType === "EXPRESS") return "express" as const;
  if (params.orderType === "EXTRA") return "extra" as const;
  if (params.orderType === "TAKEOUT") return "takeout" as const;
  return "table" as const;
}

export function cleanOrderCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.replace(/-V[a-f0-9]{4}$/i, "");
}

export function getOrderRef(
  orderCode: string | null | undefined,
  orderNumber: number | null | undefined,
): string {
  const n = Number(orderNumber ?? 0);
  if (n > 0) {
    return `#${String(n).padStart(4, "0")}`;
  }

  const clean = cleanOrderCode(orderCode);
  if (clean && clean.trim()) {
    return clean.trim();
  }

  return "Borrador";
}

/** Número corto para cabeceras/pestañas de mesa (p. ej. "0001"). */
export function getOrderMesaHeaderNumber(params: {
  orderCode?: string | null;
  orderNumber?: number | null;
  tableOrderPosition?: number | null;
}): string {
  const orderNumber = Number(params.orderNumber ?? 0);
  if (orderNumber > 0) {
    return String(orderNumber).padStart(4, "0");
  }

  const cleaned = cleanOrderCode(params.orderCode);
  if (cleaned) {
    const suffix = cleaned.split("-").pop()?.trim();
    if (suffix && /^\d+$/.test(suffix)) {
      return suffix.padStart(4, "0");
    }
  }

  return String(Number(params.tableOrderPosition ?? 1));
}

