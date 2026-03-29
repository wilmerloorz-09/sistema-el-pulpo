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

  if (params.orderType === "TAKEOUT") {
    return "Para llevar";
  }

  return params.splitCode?.trim() || params.tableName?.trim() || "Mesa";
}

export function getOrderKind(params: {
  orderType: string | null | undefined;
  isSpecial?: boolean | null | undefined;
  isTrayOrder?: boolean | null | undefined;
}) {
  if (params.isTrayOrder) return "tray" as const;
  if (params.isSpecial) return "special" as const;
  if (params.orderType === "TAKEOUT") return "takeout" as const;
  return "table" as const;
}
