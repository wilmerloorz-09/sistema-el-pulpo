import { supabase } from "@/integrations/supabase/client";
import type { OpenCashShift } from "@/lib/openCashShift";

export type TablesOverviewBundle = {
  open_shift: { id: string; opened_at: string } | null;
  rows: any[];
  active_orders: Array<{
    id: string;
    created_by?: string | null;
    created_at?: string | null;
    sent_to_kitchen_at?: string | null;
    cash_shift_id?: string | null;
  }>;
  profiles: Array<{
    id: string;
    first_name?: string | null;
    full_name?: string | null;
    username?: string | null;
    alias?: string | null;
    email?: string | null;
  }>;
  voided_order_ids: string[];
};

const EMPTY: TablesOverviewBundle = {
  open_shift: null,
  rows: [],
  active_orders: [],
  profiles: [],
  voided_order_ids: [],
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeTablesOverviewBundle(raw: unknown): TablesOverviewBundle {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const row = raw as Record<string, unknown>;
  const openShiftRaw = row.open_shift;
  let open_shift: TablesOverviewBundle["open_shift"] = null;
  if (openShiftRaw && typeof openShiftRaw === "object") {
    const s = openShiftRaw as Record<string, unknown>;
    if (typeof s.id === "string") {
      open_shift = {
        id: s.id,
        opened_at: String(s.opened_at ?? ""),
      };
    }
  }
  return {
    open_shift,
    rows: asArray(row.rows),
    active_orders: asArray(row.active_orders),
    profiles: asArray(row.profiles),
    voided_order_ids: asArray<string>(row.voided_order_ids).filter(Boolean),
  };
}

export async function fetchTablesOverviewBundle(
  branchId: string,
  shiftId?: string | null,
): Promise<TablesOverviewBundle> {
  const { data, error } = await (supabase as any).rpc("get_tables_overview_bundle", {
    p_branch_id: branchId,
    p_shift_id: shiftId ?? null,
  });
  if (error) throw error;
  return normalizeTablesOverviewBundle(data);
}

export function openCashShiftFromBundle(
  bundle: TablesOverviewBundle,
): OpenCashShift | null {
  if (!bundle.open_shift?.id) return null;
  return {
    id: bundle.open_shift.id,
    opened_at: bundle.open_shift.opened_at || "",
  };
}
