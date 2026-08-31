import { dbSelect } from "@/services/DatabaseService";

export type RegisterSummaryPaymentRow = {
  id: string;
  amount: number;
  payment_method_id: string;
  created_at: string;
  created_by: string;
  notes: string | null;
  status: string | null;
};

/** Pagos del turno vía ordenes (cash_shift_id), con respaldo por payments.shift_id. */
export async function fetchPaymentsForRegisterSummary(params: {
  shiftId: string;
  branchId: string;
  rangeStart: string;
  rangeEnd?: string;
}): Promise<RegisterSummaryPaymentRow[]> {
  const select = "id, amount, payment_method_id, created_at, created_by, notes, status, order_id, shift_id";
  const byId = new Map<string, RegisterSummaryPaymentRow>();

  const pushRows = (rows: Array<RegisterSummaryPaymentRow & { order_id?: string }>) => {
    for (const row of rows ?? []) {
      if (!row?.id) continue;
      byId.set(row.id, {
        id: row.id,
        amount: Number(row.amount ?? 0),
        payment_method_id: row.payment_method_id,
        created_at: row.created_at,
        created_by: row.created_by,
        notes: row.notes ?? null,
        status: row.status ?? null,
      });
    }
  };

  const orders = await dbSelect<{ id: string }>("orders", {
    select: "id",
    filters: [
      { column: "cash_shift_id", op: "eq", value: params.shiftId },
      { column: "branch_id", op: "eq", value: params.branchId },
    ],
  });

  const orderIds = (orders ?? []).map((row) => row.id).filter(Boolean);
  if (orderIds.length > 0) {
    const orderPaymentFilters: Array<{ column: string; op: string; value: unknown }> = [
      { column: "order_id", op: "in", value: orderIds },
      { column: "created_at", op: "gte", value: params.rangeStart },
    ];
    if (params.rangeEnd) {
      orderPaymentFilters.push({ column: "created_at", op: "lte", value: params.rangeEnd });
    }

    pushRows(
      await dbSelect<RegisterSummaryPaymentRow & { order_id?: string }>("payments", {
        select,
        filters: orderPaymentFilters,
      }),
    );
  }

  const shiftPaymentFilters: Array<{ column: string; op: string; value: unknown }> = [
    { column: "shift_id", op: "eq", value: params.shiftId },
    { column: "created_at", op: "gte", value: params.rangeStart },
  ];
  if (params.rangeEnd) {
    shiftPaymentFilters.push({ column: "created_at", op: "lte", value: params.rangeEnd });
  }

  pushRows(
    await dbSelect<RegisterSummaryPaymentRow & { order_id?: string }>("payments", {
      select,
      filters: shiftPaymentFilters,
    }),
  );

  return Array.from(byId.values());
}
