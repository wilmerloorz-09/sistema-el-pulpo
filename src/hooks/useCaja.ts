import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { generateUUID } from "@/lib/uuid";

export interface Denomination {
  id: string;
  label: string;
  value: number;
  display_order: number;
}

export interface ShiftDenom {
  id: string;
  denomination_id: string;
  label: string;
  value: number;
  qty_initial: number;
  qty_current: number;
}

export interface CashShift {
  id: string;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  denoms: ShiftDenom[];
}

export interface PayableOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  total: number;
  items: { id: string; description_snapshot: string; quantity: number; total: number; paid_at: string | null }[];
}

export interface PayOrderParams {
  orderId: string;
  methodId: string;
  itemIds: string[];
  amount: number;
  receivedDenoms: { denomination_id: string; qty: number }[];
  changeDenoms: { denomination_id: string; qty: number }[];
}

export function useCaja() {
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  // Fetch active denominations via DatabaseService (cached offline)
  const denomsQuery = useQuery({
    queryKey: ["denominations", activeBranchId],
    queryFn: () =>
      dbSelect<Denomination>("denominations", {
        select: "id, label, value, display_order",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "display_order" },
      }),
    enabled: !!activeBranchId,
  });

  // Fetch current open shift for this user
  const shiftQuery = useQuery({
    queryKey: ["current-shift", activeBranchId],
    queryFn: async () => {
      if (!user || !activeBranchId) return null;

      // Complex query with maybeSingle — supabase passthrough
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id, status, opened_at, closed_at, notes")
        .eq("cashier_id", user.id)
        .eq("branch_id", activeBranchId)
        .eq("status", "OPEN")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // Fetch shift denoms via DatabaseService
      const denoms = await dbSelect<any>("cash_shift_denoms", {
        select: "id, denomination_id, qty_initial, qty_current",
        filters: [{ column: "shift_id", op: "eq", value: data.id }],
      });

      const allDenoms = denomsQuery.data ?? [];
      const enriched: ShiftDenom[] = (denoms ?? []).map((d: any) => {
        const denom = allDenoms.find((ad) => ad.id === d.denomination_id);
        return {
          ...d,
          label: denom?.label ?? "",
          value: denom?.value ?? 0,
        };
      });

      return { ...data, denoms: enriched } as CashShift;
    },
    enabled: !!user && !!denomsQuery.data,
  });

  // Fetch payable orders (KITCHEN_DISPATCHED) — complex relational query
  const ordersQuery = useQuery({
    queryKey: ["payable-orders"],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_code, order_type, table_id, split_id")
        .eq("status", "KITCHEN_DISPATCHED")
        .order("updated_at");
      if (error) throw error;
      if (!orders || orders.length === 0) return [];

      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      }

      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      const orderIds = orders.map((o) => o.id);
      const { data: items } = await supabase
        .from("order_items")
        .select("id, order_id, description_snapshot, quantity, total, paid_at")
        .in("order_id", orderIds);

      return orders.map((o) => {
        const orderItems = (items ?? []).filter((i) => i.order_id === o.id);
        return {
          id: o.id,
          order_number: o.order_number,
          order_code: (o as any).order_code ?? null,
          order_type: o.order_type,
          table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
          split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
          total: orderItems.reduce((s, i) => s + Number(i.total), 0),
          items: orderItems.map((i) => ({
            id: i.id,
            description_snapshot: i.description_snapshot,
            quantity: i.quantity,
            total: Number(i.total),
            paid_at: i.paid_at,
          })),
        } as PayableOrder;
      });
    },
    refetchInterval: 10000,
  });

  // Fetch payment methods via DatabaseService (cached offline)
  const methodsQuery = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () =>
      dbSelect<{ id: string; name: string }>("payment_methods", {
        select: "id, name",
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "name" },
      }),
  });

  // Open shift
  const openShift = useMutation({
    mutationFn: async (denomCounts: { denomination_id: string; qty: number }[]) => {
      if (!user) throw new Error("No user");
      if (!activeBranchId) throw new Error("No branch selected");

      const shiftId = generateUUID();
      await dbInsert("cash_shifts", {
        id: shiftId,
        cashier_id: user.id,
        branch_id: activeBranchId,
        status: "OPEN",
        opened_at: new Date().toISOString(),
      });

      // Insert shift denoms
      for (const d of denomCounts) {
        await dbInsert("cash_shift_denoms", {
          id: generateUUID(),
          shift_id: shiftId,
          denomination_id: d.denomination_id,
          qty_initial: d.qty,
          qty_current: d.qty,
        });
      }

      // Insert opening movements
      for (const d of denomCounts.filter((d) => d.qty > 0)) {
        await dbInsert("cash_movements", {
          id: generateUUID(),
          shift_id: shiftId,
          denomination_id: d.denomination_id,
          movement_type: "OPENING",
          qty_delta: d.qty,
          created_at: new Date().toISOString(),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      toast.success("Turno abierto");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Pay order (supports partial item payment + denomination tracking)
  const payOrder = useMutation({
    mutationFn: async ({ orderId, methodId, itemIds, amount, receivedDenoms, changeDenoms }: PayOrderParams) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      // 1. Insert payment
      const paymentId = generateUUID();
      await dbInsert("payments", {
        id: paymentId,
        order_id: orderId,
        payment_method_id: methodId,
        amount,
        created_by: user.id,
        created_at: new Date().toISOString(),
      });

      // 2. Mark selected items as paid
      for (const itemId of itemIds) {
        await dbUpdate("order_items", itemId, { paid_at: new Date().toISOString() });
      }

      // 3. Check if all items are now paid
      const { count } = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .is("paid_at", null);
      if (count === 0) {
        const { data: orderData } = await supabase
          .from("orders")
          .select("order_type")
          .eq("id", orderId)
          .single();
        const nextStatus = orderData?.order_type === "TAKEOUT" ? "SENT_TO_KITCHEN" : "PAID";
        await dbUpdate("orders", orderId, { status: nextStatus });
      }

      // 4. Update cash_shift_denoms
      const denomChanges: Record<string, number> = {};
      for (const rd of receivedDenoms) {
        denomChanges[rd.denomination_id] = (denomChanges[rd.denomination_id] || 0) + rd.qty;
      }
      for (const cd of changeDenoms) {
        denomChanges[cd.denomination_id] = (denomChanges[cd.denomination_id] || 0) - cd.qty;
      }
      for (const [denomId, delta] of Object.entries(denomChanges)) {
        if (delta === 0) continue;
        const existing = shift.denoms.find((d) => d.denomination_id === denomId);
        if (existing) {
          await dbUpdate("cash_shift_denoms", existing.id, {
            qty_current: existing.qty_current + delta,
          });
        }
      }

      // 5. Record cash movements
      await dbInsert("cash_movements", {
        id: generateUUID(),
        shift_id: shift.id,
        payment_id: paymentId,
        movement_type: "PAYMENT_IN",
        qty_delta: 1,
        created_at: new Date().toISOString(),
      });

      for (const cd of changeDenoms) {
        await dbInsert("cash_movements", {
          id: generateUUID(),
          shift_id: shift.id,
          payment_id: paymentId,
          denomination_id: cd.denomination_id,
          movement_type: "CHANGE_OUT",
          qty_delta: cd.qty,
          created_at: new Date().toISOString(),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Pago registrado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Close shift
  const closeShift = useMutation({
    mutationFn: async (notes?: string) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      await dbUpdate("cash_shifts", shift.id, {
        status: "CLOSED",
        closed_at: new Date().toISOString(),
        notes: notes ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      toast.success("Turno cerrado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    denominations: denomsQuery.data ?? [],
    shift: shiftQuery.data,
    isLoadingShift: shiftQuery.isLoading || denomsQuery.isLoading,
    payableOrders: ordersQuery.data ?? [],
    paymentMethods: methodsQuery.data ?? [],
    openShift,
    payOrder,
    closeShift,
  };
}
