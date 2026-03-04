import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

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
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  total: number;
  items: { description_snapshot: string; quantity: number; total: number }[];
}

export function useCaja() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fetch active denominations
  const denomsQuery = useQuery({
    queryKey: ["denominations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("denominations")
        .select("id, label, value, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data as Denomination[];
    },
  });

  // Fetch current open shift for this user
  const shiftQuery = useQuery({
    queryKey: ["current-shift"],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id, status, opened_at, closed_at, notes")
        .eq("cashier_id", user.id)
        .eq("status", "OPEN")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // Fetch shift denoms
      const { data: denoms } = await supabase
        .from("cash_shift_denoms")
        .select("id, denomination_id, qty_initial, qty_current")
        .eq("shift_id", data.id);

      const allDenoms = denomsQuery.data ?? [];
      const enriched: ShiftDenom[] = (denoms ?? []).map((d) => {
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

  // Fetch payable orders (KITCHEN_DISPATCHED)
  const ordersQuery = useQuery({
    queryKey: ["payable-orders"],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_type, table_id, split_id")
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
        .select("order_id, description_snapshot, quantity, total")
        .in("order_id", orderIds);

      return orders.map((o) => {
        const orderItems = (items ?? []).filter((i) => i.order_id === o.id);
        return {
          id: o.id,
          order_number: o.order_number,
          order_type: o.order_type,
          table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
          split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
          total: orderItems.reduce((s, i) => s + Number(i.total), 0),
          items: orderItems.map((i) => ({
            description_snapshot: i.description_snapshot,
            quantity: i.quantity,
            total: Number(i.total),
          })),
        } as PayableOrder;
      });
    },
    refetchInterval: 10000,
  });

  // Fetch payment methods
  const methodsQuery = useQuery({
    queryKey: ["payment-methods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Open shift
  const openShift = useMutation({
    mutationFn: async (denomCounts: { denomination_id: string; qty: number }[]) => {
      if (!user) throw new Error("No user");
      const { data: shift, error } = await supabase
        .from("cash_shifts")
        .insert({ cashier_id: user.id })
        .select("id")
        .single();
      if (error) throw error;

      // Insert shift denoms
      if (denomCounts.length > 0) {
        const { error: denomErr } = await supabase.from("cash_shift_denoms").insert(
          denomCounts.map((d) => ({
            shift_id: shift.id,
            denomination_id: d.denomination_id,
            qty_initial: d.qty,
            qty_current: d.qty,
          }))
        );
        if (denomErr) throw denomErr;

        // Insert opening movements
        const { error: movErr } = await supabase.from("cash_movements").insert(
          denomCounts
            .filter((d) => d.qty > 0)
            .map((d) => ({
              shift_id: shift.id,
              denomination_id: d.denomination_id,
              movement_type: "OPENING" as const,
              qty_delta: d.qty,
            }))
        );
        if (movErr) throw movErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      toast.success("Turno abierto");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Pay order
  const payOrder = useMutation({
    mutationFn: async ({ orderId, methodId, amount }: { orderId: string; methodId: string; amount: number }) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      const { data: payment, error } = await supabase
        .from("payments")
        .insert({
          order_id: orderId,
          payment_method_id: methodId,
          amount,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Update order status
      const { error: statusErr } = await supabase
        .from("orders")
        .update({ status: "PAID" })
        .eq("id", orderId);
      if (statusErr) throw statusErr;

      // Record payment movement
      const { error: movErr } = await supabase.from("cash_movements").insert({
        shift_id: shift.id,
        payment_id: payment.id,
        movement_type: "PAYMENT_IN" as const,
        qty_delta: 1,
      });
      if (movErr) throw movErr;
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

      const { error } = await supabase
        .from("cash_shifts")
        .update({
          status: "CLOSED",
          closed_at: new Date().toISOString(),
          notes: notes ?? null,
        })
        .eq("id", shift.id);
      if (error) throw error;
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
