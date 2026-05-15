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
    return "Orden Especial";
  }

  if (params.orderType === "EXPRESS") {
    return "Express";
  }

  if (params.orderType === "TAKEOUT") {
    return "Para llevar";
  }

  const tableName = params.tableName?.trim() || "Mesa";
  return tableName;
}

export function getOrderKind(params: {
  orderType: string | null | undefined;
  isSpecial?: boolean | null | undefined;
  isTrayOrder?: boolean | null | undefined;
}) {
  if (params.isTrayOrder) return "tray" as const;
  if (params.isSpecial) return "special" as const;
  if (params.orderType === "EXPRESS") return "express" as const;
  if (params.orderType === "TAKEOUT") return "takeout" as const;
  return "table" as const;
}

export function getOrderRef(
  orderCode: string | null | undefined,
  orderNumber: number | null | undefined,
): string {
  if (orderCode && orderCode.trim()) return orderCode;
  if (orderNumber && orderNumber > 0) return `#${orderNumber}`;
  return "Borrador";
}
