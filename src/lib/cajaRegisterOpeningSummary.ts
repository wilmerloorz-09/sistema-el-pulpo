import { supabase } from "@/integrations/supabase/client";
import type { RegisterSummaryPaymentRow } from "@/lib/cajaRegisterPayments";

export async function fetchRegisterOpeningCollectedPayments(
  openingId: string,
): Promise<RegisterSummaryPaymentRow[]> {
  const { data, error } = await supabase.rpc(
    "get_register_opening_collected_payments" as any,
    { p_opening_id: openingId } as any,
  );

  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    amount: Number(row.amount ?? 0),
    payment_method_id: String(row.payment_method_id ?? ""),
    created_at: String(row.created_at ?? ""),
    created_by: String(row.created_by ?? ""),
    notes: row.notes != null ? String(row.notes) : null,
    status: row.status != null ? String(row.status) : null,
  }));
}
