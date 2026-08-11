import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { getOpenCashShiftIdForBranch } from "@/lib/openCashShift";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOrderDetail } from "@/hooks/useOrder";
import { getOrderOriginLabel } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronsDown, ChevronsUp, Loader2, X } from "lucide-react";
import { invalidateOperationalOrderQueries } from "@/lib/queryEgress";

interface MergeSplitOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSourceOrderId?: string | null;
  initialSourceOption?: TransferableOrderOption | null;
}

interface TransferableOrderOption {
  id: string;
  orderId: string | null;
  label: string;
  orderCode: string | null;
  tableName: string;
  tableId: string | null;
  splitCode: string | null;
  splitId: string | null;
  status: string;
  menuScope: "TABLE" | "TAKEOUT";
  sortKey: string;
  hasOperationalItems: boolean;
}

interface TransferableItem {
  id: string;
  description: string;
  modifiers: string[];
  note: string | null;
  trayItemType: "A" | "B" | "C" | null;
  quantityMovable: number;
  status: string;
}

interface DisplayTransferRow {
  item: TransferableItem;
  qty: number;
  mode: "available" | "incoming";
}

const clampQty = (value: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0)));

function formatCompactOrderLabel(tableName: string, orderNumber: number | null) {
  const cleanTableName = tableName.trim() || "Mesa";
  if (orderNumber == null || Number.isNaN(Number(orderNumber))) return cleanTableName;
  return `${cleanTableName} (${String(orderNumber).padStart(4, "0").slice(-4)})`;
}

function filterOrdersByMode(items: TransferableOrderOption[], filter: "ALL" | "ACTIVE" | "FREE") {
  if (filter === "ACTIVE") {
    return items.filter((order) => order.hasOperationalItems);
  }
  if (filter === "FREE") {
    return items.filter((order) => !order.hasOperationalItems || order.status === "DRAFT");
  }
  return items;
}

function normalizeMovableItems(order: Awaited<ReturnType<typeof fetchOrderDetail>>): TransferableItem[] {
  if (!order) return [];

  return order.items
    .map((item) => {
      const movableQty = Math.max(
        0,
        Math.min(
          Number(item.quantity ?? 0),
          Number(item.quantity_remaining ?? 0) + Number(item.quantity_dispatched ?? 0),
        ),
      );

      return {
        id: item.id,
        description: item.description_snapshot,
        modifiers: item.modifiers
          .map((modifier) => String(modifier.description ?? "").trim())
          .filter((modifier) => modifier.length > 0),
        note: String(item.item_note ?? "").trim() || null,
        trayItemType: item.tray_item_type ?? null,
        quantityMovable: movableQty,
        status: item.status,
      };
    })
    .filter((item) => item.status !== "DRAFT" && item.quantityMovable > 0);
}

function TransferRow({
  item,
  qty,
  right,
  disabled,
  onOne,
  onAll,
}: {
  item: TransferableItem;
  qty: number;
  right?: boolean;
  disabled?: boolean;
  onOne: () => void;
  onAll: () => void;
}) {
  const isBulk = item.trayItemType === "C";

  return (
    <div className={cn(
      "grid items-start gap-2 rounded-2xl border px-3 py-2",
      right ? "border-orange-200 bg-orange-50/40" : "border-stone-200 bg-stone-50/50",
      "grid-cols-[78px_44px_minmax(0,1fr)]",
    )}>
      <div className={`flex ${right ? "justify-start" : "justify-end"} gap-2`}>
        {right ? (
          <>
            <button type="button" disabled={disabled} onClick={onAll} className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50">
              <ChevronsUp className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">&lt;&lt;</span>
            </button>
            <button type="button" disabled={disabled} onClick={onOne} className="h-8 w-8 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-50">
              <ArrowUp className="mx-auto h-4 w-4 sm:hidden" />
              <ArrowLeft className="mx-auto hidden h-4 w-4 sm:block" />
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={disabled} onClick={onOne} className="h-8 w-8 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-50">
              <ArrowDown className="mx-auto h-4 w-4 sm:hidden" />
              <ArrowRight className="mx-auto hidden h-4 w-4 sm:block" />
            </button>
            <button type="button" disabled={disabled} onClick={onAll} className="flex h-8 min-w-[38px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50">
              <ChevronsDown className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">&gt;&gt;</span>
            </button>
          </>
        )}
      </div>

      <span className="pt-1 text-center text-sm font-semibold text-slate-900">{isBulk ? "AG" : qty}</span>

      <div className="min-w-0">
        <div className="break-words text-sm font-medium leading-snug text-slate-900">{item.description}</div>
        {item.modifiers.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 text-xs font-semibold text-red-600">
            {item.modifiers.map((modifier) => (
              <p key={`${item.id}-${modifier}`} className="break-words">
                - {modifier}
              </p>
            ))}
          </div>
        )}
        {item.note && (
          <p className="mt-1 break-words text-xs italic text-slate-500">
            Nota: {item.note}
          </p>
        )}
      </div>
    </div>
  );
}

export default function MergeSplitOrdersDialog({
  open,
  onOpenChange,
  initialSourceOrderId = null,
  initialSourceOption = null,
}: MergeSplitOrdersDialogProps) {
  type OrderFilterValue = "ALL" | "ACTIVE" | "FREE";

  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [leftOrderId, setLeftOrderId] = useState<string>(initialSourceOrderId ?? "");
  const [rightOrderId, setRightOrderId] = useState<string>("");
  const [leftSelectedQty, setLeftSelectedQty] = useState<Record<string, number>>({});
  const [rightSelectedQty, setRightSelectedQty] = useState<Record<string, number>>({});
  const [leftOrderFilter, setLeftOrderFilter] = useState<OrderFilterValue>("ALL");
  const [rightOrderFilter, setRightOrderFilter] = useState<OrderFilterValue>("ALL");
  const [confirmingEmptyOrderCleanup, setConfirmingEmptyOrderCleanup] = useState(false);
  const [didApplyInitialSource, setDidApplyInitialSource] = useState(false);

  useEffect(() => {
    if (!open) {
      setLeftOrderId(initialSourceOrderId ?? "");
      setRightOrderId("");
      setLeftSelectedQty({});
      setRightSelectedQty({});
      setLeftOrderFilter("ALL");
      setRightOrderFilter("ALL");
      setConfirmingEmptyOrderCleanup(false);
      setDidApplyInitialSource(false);
      return;
    }
  }, [open, initialSourceOrderId]);

  const ordersQuery = useQuery({
    queryKey: ["merge-split-order-options", activeBranchId],
    enabled: open && !!activeBranchId,
    queryFn: async (): Promise<TransferableOrderOption[]> => {
      const openShiftId = await getOpenCashShiftIdForBranch(activeBranchId!);
      if (!openShiftId) return [];

      const { data: activeTables, error: activeTablesError } = await supabase
        .from("restaurant_tables")
        .select("id, name, visual_order")
        .eq("branch_id", activeBranchId!)
        .eq("is_active", true)
        .order("visual_order", { ascending: true });
      if (activeTablesError) throw activeTablesError;

      const { data: ordersData, error: ordersError } = await supabase
        .from("orders")
        .select("id, order_number, order_code, table_id, table_name_snapshot, split_id, status, menu_scope")
        .eq("branch_id", activeBranchId!)
        .eq("cash_shift_id", openShiftId)
        .eq("order_type", "DINE_IN")
        .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
        .not("table_id", "is", null)
        .order("created_at", { ascending: true });
      if (ordersError) throw ordersError;

      const orders = (ordersData ?? []) as Array<{
        id: string;
        order_number: number | null;
        order_code: string | null;
        table_id: string | null;
        table_name_snapshot: string | null;
        split_id: string | null;
        status: string;
        menu_scope: "TABLE" | "TAKEOUT";
      }>;

      const orderIds = orders.map((order) => order.id);
      if (orderIds.length === 0) return [];

      const { data: orderItems, error: orderItemsError } = await supabase
        .from("order_items")
        .select("order_id, id, status")
        .in("order_id", orderIds);
      if (orderItemsError) throw orderItemsError;

      const operationalItemCountByOrder = (orderItems ?? []).reduce<Record<string, number>>((acc, row) => {
        if (String(row.status ?? "").toUpperCase() !== "DRAFT") {
          acc[row.order_id] = (acc[row.order_id] ?? 0) + 1;
        }
        return acc;
      }, {});

      if (orders.length === 0) return [];

      const tableIdSet = new Set<string>(orders.map((order) => order.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      const splitIdSet = new Set<string>(orders.map((order) => order.split_id).filter(Boolean));
      const splitIds = Array.from(splitIdSet);

      const [tablesResult, splitsResult] = await Promise.all([
        tableIds.length > 0
          ? supabase.from("restaurant_tables").select("id, name, visual_order").in("id", tableIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string; visual_order: number }>, error: null }),
        splitIds.length > 0
          ? supabase.from("table_splits").select("id, split_code").in("id", splitIds)
          : Promise.resolve({ data: [] as Array<{ id: string; split_code: string }>, error: null }),
      ]);

      if (tablesResult.error) throw tablesResult.error;
      if (splitsResult.error) throw splitsResult.error;

      const tableMap = new Map((tablesResult.data ?? []).map((table) => [table.id, table]));
      const splitMap = new Map((splitsResult.data ?? []).map((split) => [split.id, split.split_code]));
      const orderOptions = orders
        .map((order) => {
          const table = order.table_id ? tableMap.get(order.table_id) : null;
          const tableName =
            table?.name?.trim()
            || String(order.table_name_snapshot ?? "").trim()
            || "Mesa";
          const splitCode = order.split_id ? splitMap.get(order.split_id) ?? null : null;
          const fallbackLabel = getOrderOriginLabel({
            orderType: "DINE_IN",
            tableName,
            splitCode,
            isSpecial: false,
          });
          const label = formatCompactOrderLabel(tableName, order.order_number) || fallbackLabel;

          return {
            id: order.id,
            orderId: order.id,
            label,
            orderCode: order.order_code,
            tableName,
            tableId: order.table_id,
            splitCode,
            splitId: order.split_id,
            status: order.status,
            menuScope: order.menu_scope ?? "TABLE",
            sortKey: `${String(table?.visual_order ?? 9999).padStart(4, "0")}-${label}`,
            hasOperationalItems: (operationalItemCountByOrder[order.id] ?? 0) > 0,
          };
        });

      const usedTableIds = new Set(orderOptions.map((order) => order.tableId).filter(Boolean));
      const tableOptions = (activeTables ?? [])
        .filter((table) => !usedTableIds.has(table.id))
        .map((table) => ({
          id: `table:${table.id}`,
          orderId: null,
          label: table.name?.trim() || "Mesa",
          orderCode: null,
          tableName: table.name?.trim() || "Mesa",
          tableId: table.id,
          splitCode: null,
          splitId: null,
          status: "FREE",
          menuScope: "TABLE" as const,
          sortKey: `${String(table.visual_order ?? 9999).padStart(4, "0")}-${table.name?.trim() || "Mesa"}`,
          hasOperationalItems: false,
        }));

      return [...orderOptions, ...tableOptions]
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey, "es"));
    },
  });

  const mergedOrderOptions = useMemo(() => {
    const items = ordersQuery.data ?? [];
    if (!initialSourceOption) return items;
    if (items.some((order) => order.id === initialSourceOption.id)) return items;
    return [initialSourceOption, ...items];
  }, [initialSourceOption, ordersQuery.data]);

  const leftOptions = useMemo(() => {
    return filterOrdersByMode(mergedOrderOptions, leftOrderFilter)
      .filter((order) => order.id !== rightOrderId);
  }, [mergedOrderOptions, leftOrderFilter, rightOrderId]);

  const rightOptions = useMemo(() => {
    return filterOrdersByMode(mergedOrderOptions, rightOrderFilter)
      .filter((order) => order.id !== leftOrderId);
  }, [mergedOrderOptions, rightOrderFilter, leftOrderId]);

  const leftOrderQuery = useQuery({
    queryKey: ["merge-split-left-order", leftOrderId],
    enabled: open && mergedOrderOptions.some((option) => option.id === leftOrderId && option.orderId),
    queryFn: async () => {
      const selected = mergedOrderOptions.find((option) => option.id === leftOrderId);
      return selected?.orderId ? fetchOrderDetail(selected.orderId) : null;
    },
  });

  const rightOrderQuery = useQuery({
    queryKey: ["merge-split-right-order", rightOrderId],
    enabled: open && mergedOrderOptions.some((option) => option.id === rightOrderId && option.orderId),
    queryFn: async () => {
      const selected = mergedOrderOptions.find((option) => option.id === rightOrderId);
      return selected?.orderId ? fetchOrderDetail(selected.orderId) : null;
    },
  });

  const leftItems = useMemo<TransferableItem[]>(
    () => normalizeMovableItems(leftOrderQuery.data),
    [leftOrderQuery.data],
  );

  const rightItems = useMemo<TransferableItem[]>(
    () => normalizeMovableItems(rightOrderQuery.data),
    [rightOrderQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    const next = Object.fromEntries(leftItems.map((item) => [item.id, clampQty(Number(leftSelectedQty[item.id] ?? 0), item.quantityMovable)]));
    setLeftSelectedQty(next);
  }, [open, leftItems]);

  useEffect(() => {
    if (!open) return;
    const next = Object.fromEntries(rightItems.map((item) => [item.id, clampQty(Number(rightSelectedQty[item.id] ?? 0), item.quantityMovable)]));
    setRightSelectedQty(next);
  }, [open, rightItems]);

  useEffect(() => {
    if (leftOrderId && rightOrderId) return;
    setLeftSelectedQty({});
    setRightSelectedQty({});
  }, [leftOrderId, rightOrderId]);

  useEffect(() => {
    if (!open || !initialSourceOrderId || leftOrderId || didApplyInitialSource) return;
    const hasInitialSource = mergedOrderOptions.some((order) => order.id === initialSourceOrderId);
    if (hasInitialSource) {
      setLeftOrderId(initialSourceOrderId);
      setDidApplyInitialSource(true);
    }
  }, [open, initialSourceOrderId, leftOrderId, mergedOrderOptions, didApplyInitialSource]);

  useEffect(() => {
    if (!leftOrderId) return;
    if (ordersQuery.isLoading || !ordersQuery.data) return;
    if (leftOptions.some((order) => order.id === leftOrderId)) return;
    setLeftOrderId("");
  }, [leftOptions, leftOrderId, ordersQuery.data, ordersQuery.isLoading]);

  useEffect(() => {
    if (!rightOrderId) return;
    if (rightOptions.some((order) => order.id === rightOrderId)) return;
    setRightOrderId("");
  }, [rightOptions, rightOrderId]);

  useEffect(() => {
    if (!leftOrderId || !rightOrderId) return;
    if (leftOrderId !== rightOrderId) return;
    setRightOrderId("");
  }, [leftOrderId, rightOrderId]);

  const leftRows = useMemo(
    () => leftItems
      .map((item) => ({ ...item, qty: Math.max(0, item.quantityMovable - clampQty(Number(leftSelectedQty[item.id] ?? 0), item.quantityMovable)) }))
      .filter((item) => item.qty > 0),
    [leftItems, leftSelectedQty],
  );

  const rightRows = useMemo(
    () => rightItems
      .map((item) => ({ ...item, qty: Math.max(0, item.quantityMovable - clampQty(Number(rightSelectedQty[item.id] ?? 0), item.quantityMovable)) }))
      .filter((item) => item.qty > 0),
    [rightItems, rightSelectedQty],
  );

  const leftSelectedRows = useMemo(
    () => leftItems
      .map((item) => ({ ...item, qty: clampQty(Number(leftSelectedQty[item.id] ?? 0), item.quantityMovable) }))
      .filter((item) => item.qty > 0),
    [leftItems, leftSelectedQty],
  );

  const rightSelectedRows = useMemo(
    () => rightItems
      .map((item) => ({ ...item, qty: clampQty(Number(rightSelectedQty[item.id] ?? 0), item.quantityMovable) }))
      .filter((item) => item.qty > 0),
    [rightItems, rightSelectedQty],
  );

  const totalSelected = useMemo(
    () => leftSelectedRows.reduce((sum, item) => sum + item.qty, 0) + rightSelectedRows.reduce((sum, item) => sum + item.qty, 0),
    [leftSelectedRows, rightSelectedRows],
  );
  const leftWillBeEmpty = leftOrderId.length > 0 && leftRows.length === 0 && leftSelectedRows.length > 0;
  const rightWillBeEmpty = rightOrderId.length > 0 && rightRows.length === 0 && rightSelectedRows.length > 0;
  const incomingLeftRows = rightSelectedRows;
  const incomingRightRows = leftSelectedRows;
  const leftDisplayRows = useMemo<DisplayTransferRow[]>(
    () => [
      ...incomingLeftRows.map((entry) => ({ item: entry, qty: entry.qty, mode: "incoming" as const })),
      ...leftRows.map((entry) => ({ item: entry, qty: entry.qty, mode: "available" as const })),
    ],
    [incomingLeftRows, leftRows],
  );
  const rightDisplayRows = useMemo<DisplayTransferRow[]>(
    () => [
      ...incomingRightRows.map((entry) => ({ item: entry, qty: entry.qty, mode: "incoming" as const })),
      ...rightRows.map((entry) => ({ item: entry, qty: entry.qty, mode: "available" as const })),
    ],
    [incomingRightRows, rightRows],
  );

  const setLeftQty = (id: string, nextQty: number, maxQty: number) => {
    const clamped = clampQty(nextQty, maxQty);
    setLeftSelectedQty((prev) => ({ ...prev, [id]: clamped }));
  };

  const setRightQty = (id: string, nextQty: number, maxQty: number) => {
    const clamped = clampQty(nextQty, maxQty);
    setRightSelectedQty((prev) => ({ ...prev, [id]: clamped }));
  };

  const resolveOrderIdForMove = async (selectionId: string, mode: "source" | "destination") => {
    const option = (ordersQuery.data ?? []).find((candidate) => candidate.id === selectionId);
    if (!option) {
      throw new Error("No se pudo resolver la mesa u orden seleccionada.");
    }

    if (option.orderId) {
      return option.orderId;
    }

    if (mode === "source") {
      throw new Error("La mesa origen debe tener una orden activa para mover items.");
    }

    if (!user?.id || !activeBranchId || !option.tableId) {
      throw new Error("No se pudo preparar la mesa destino.");
    }

    const { data, error } = await supabase.rpc("create_dine_in_order" as any, {
      p_branch_id: activeBranchId,
      p_created_by: user.id,
      p_table_id: option.tableId,
      p_is_special: false,
    } as any);
    if (error) throw error;

    return String(data);
  };

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (willMoveWholeLeftOrderToEmptyRightTable) {
        const { error } = await supabase.rpc("move_dine_in_order_to_table", {
          p_order_id: leftSelection!.orderId!,
          p_destination_table_id: rightSelection!.tableId!,
        });
        if (error) throw error;
        return;
      }

      if (willMoveWholeRightOrderToEmptyLeftTable) {
        const { error } = await supabase.rpc("move_dine_in_order_to_table", {
          p_order_id: rightSelection!.orderId!,
          p_destination_table_id: leftSelection!.tableId!,
        });
        if (error) throw error;
        return;
      }

      const resolvedLeftOrderId = await resolveOrderIdForMove(leftOrderId, "source");
      const resolvedRightOrderId = await resolveOrderIdForMove(rightOrderId, "destination");

      const leftPayload = leftSelectedRows.map((item) => ({
        order_item_id: item.id,
        quantity: item.qty,
      }));
      const rightPayload = rightSelectedRows.map((item) => ({
        order_item_id: item.id,
        quantity: item.qty,
      }));

      if (leftPayload.length > 0) {
        const { error } = await (supabase as any).rpc("move_dine_in_order_items_between_orders", {
          p_source_order_id: resolvedLeftOrderId,
          p_destination_order_id: resolvedRightOrderId,
          p_items: leftPayload,
        });
        if (error) throw error;
      }

      if (rightPayload.length > 0) {
        const { error } = await (supabase as any).rpc("move_dine_in_order_items_between_orders", {
          p_source_order_id: resolvedRightOrderId,
          p_destination_order_id: resolvedLeftOrderId,
          p_items: rightPayload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Los items se movieron entre mesas correctamente.");
      invalidateOperationalOrderQueries(qc, {
        branchId: activeBranchId,
        includeTables: true,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error?.message || "No se pudo mover los items seleccionados.");
    },
  });

  const canSubmit =
    leftOrderId.length > 0 &&
    rightOrderId.length > 0 &&
    leftOrderId !== rightOrderId &&
    totalSelected > 0 &&
    !moveMutation.isPending &&
    !leftOrderQuery.isLoading &&
    !rightOrderQuery.isLoading &&
    !ordersQuery.isLoading;

  const canSelectAcrossSides =
    leftOrderId.length > 0 &&
    rightOrderId.length > 0 &&
    leftOrderId !== rightOrderId;

  const leftSelection = useMemo(
    () => (ordersQuery.data ?? []).find((order) => order.id === leftOrderId) ?? null,
    [ordersQuery.data, leftOrderId],
  );
  const rightSelection = useMemo(
    () => (ordersQuery.data ?? []).find((order) => order.id === rightOrderId) ?? null,
    [ordersQuery.data, rightOrderId],
  );
  const willMoveWholeLeftOrderToEmptyRightTable =
    Boolean(leftSelection?.orderId) &&
    Boolean(rightSelection?.tableId) &&
    !rightSelection?.orderId &&
    leftWillBeEmpty &&
    rightSelectedRows.length === 0;
  const willMoveWholeRightOrderToEmptyLeftTable =
    Boolean(rightSelection?.orderId) &&
    Boolean(leftSelection?.tableId) &&
    !leftSelection?.orderId &&
    rightWillBeEmpty &&
    leftSelectedRows.length === 0;

  const emptyOrderConfirmationMessage = useMemo(() => {
    if (willMoveWholeLeftOrderToEmptyRightTable) {
      return `La orden de ${leftSelection?.label ?? "la mesa origen"} se trasladara completa a ${rightSelection?.label ?? "la mesa destino"}, conservando su numero y sin crear una orden nueva.`;
    }

    if (willMoveWholeRightOrderToEmptyLeftTable) {
      return `La orden de ${rightSelection?.label ?? "la mesa origen"} se trasladara completa a ${leftSelection?.label ?? "la mesa destino"}, conservando su numero y sin crear una orden nueva.`;
    }

    const labels = [
      leftWillBeEmpty ? (leftSelection?.label ?? "la mesa origen") : null,
      rightWillBeEmpty ? (rightSelection?.label ?? "la mesa destino") : null,
    ].filter(Boolean) as string[];

    if (labels.length === 0) return "";
    if (labels.length === 1) {
      return `La orden de ${labels[0]} quedara sin items y se eliminara al completar el movimiento.`;
    }

    return `Las ordenes de ${labels[0]} y ${labels[1]} quedaran sin items y se eliminaran al completar el movimiento.`;
  }, [
    leftSelection,
    rightSelection,
    leftWillBeEmpty,
    rightWillBeEmpty,
    willMoveWholeLeftOrderToEmptyRightTable,
    willMoveWholeRightOrderToEmptyLeftTable,
  ]);

  const submitMove = () => {
    if (leftWillBeEmpty || rightWillBeEmpty) {
      setConfirmingEmptyOrderCleanup(true);
      return;
    }

    moveMutation.mutate();
  };

  const moveAllLeftToRight = () => {
    if (incomingLeftRows.length > 0) {
      setRightSelectedQty({});
      return;
    }
    setLeftSelectedQty(Object.fromEntries(leftItems.map((item) => [item.id, item.quantityMovable])));
  };

  const moveAllRightToLeft = () => {
    if (incomingRightRows.length > 0) {
      setLeftSelectedQty({});
      return;
    }
    setRightSelectedQty(Object.fromEntries(rightItems.map((item) => [item.id, item.quantityMovable])));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-dialog-safe min-h-[34rem] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[92vw] lg:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Mover Items/Mesa</DialogTitle>
          </DialogHeader>
          <div className="sticky top-0 z-10 -mx-1 flex gap-2 border-b border-stone-200/80 bg-white/95 px-1 pb-3 backdrop-blur">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              <X className="h-4 w-4" />
              Cerrar
            </Button>
            <Button onClick={submitMove} disabled={!canSubmit} className="flex-1">
              {moveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Moviendo...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Aceptar
                </>
              )}
            </Button>
          </div>

        <div className="flex min-h-[26rem] flex-col space-y-4">
          <Label className="text-sm font-medium">Mover items entre mesas</Label>

          {ordersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando mesas y divisiones activas...
            </div>
          ) : ordersQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>No se pudo cargar el listado de mesas y divisiones disponibles.</AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="flex min-h-[22rem] flex-col space-y-2 rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)]">
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <Select value={leftOrderFilter} onValueChange={(value) => setLeftOrderFilter(value as OrderFilterValue)}>
                      <SelectTrigger className="h-11 rounded-2xl border-orange-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Todos</SelectItem>
                        <SelectItem value="ACTIVE">Enviadas/Despachadas</SelectItem>
                        <SelectItem value="FREE">Libres/Borrador</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={leftOrderId} onValueChange={setLeftOrderId}>
                      <SelectTrigger className="h-auto min-h-11 rounded-2xl border-orange-200 pr-2 text-left text-xs [&>span]:line-clamp-2 [&>span]:flex-1 [&>span]:text-left [&>span]:leading-tight sm:text-sm">
                        <SelectValue placeholder="Selecciona mesa o division" />
                      </SelectTrigger>
                      <SelectContent>
                        {leftOptions.map((order) => (
                          <SelectItem key={order.id} value={order.id}>
                            {order.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={!canSelectAcrossSides} className="h-11 w-9 shrink-0 rounded-full px-0 text-slate-600" onClick={moveAllLeftToRight}>
                    <ArrowDown className="h-4 w-4 sm:hidden" />
                    <ArrowRight className="hidden h-4 w-4 sm:block" />
                  </Button>
                </div>

                {leftOrderQuery.isLoading ? (
                  <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cargando items operativos...
                  </div>
                ) : leftOrderQuery.isError ? (
                  <Alert variant="destructive">
                    <AlertDescription>No se pudo cargar los items de esta mesa o division.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex min-h-[16rem] flex-1 flex-col space-y-3">
                    {leftDisplayRows.length === 0 ? (
                      <div className="flex-1 rounded-2xl border border-dashed border-stone-200/80 bg-stone-50/35" />
                    ) : (
                      <div className="flex-1 space-y-1.5">
                        <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                          {leftDisplayRows.map(({ item, qty, mode }) => (
                            <TransferRow
                              key={`left-${mode}-${item.id}`}
                              item={item}
                              qty={qty}
                              disabled={!canSelectAcrossSides}
                              onOne={() => mode === "incoming"
                                ? setRightQty(item.id, Number(rightSelectedQty[item.id] ?? 0) - 1, item.quantityMovable)
                                : setLeftQty(item.id, Number(leftSelectedQty[item.id] ?? 0) + 1, item.quantityMovable)}
                              onAll={() => mode === "incoming"
                                ? setRightQty(item.id, 0, item.quantityMovable)
                                : setLeftQty(item.id, item.quantityMovable, item.quantityMovable)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="flex min-h-[22rem] flex-col space-y-2 rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)]">
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <Select value={rightOrderFilter} onValueChange={(value) => setRightOrderFilter(value as OrderFilterValue)}>
                      <SelectTrigger className="h-11 rounded-2xl border-orange-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Todos</SelectItem>
                        <SelectItem value="ACTIVE">Enviadas/Despachadas</SelectItem>
                        <SelectItem value="FREE">Libres/Borrador</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={rightOrderId} onValueChange={setRightOrderId}>
                      <SelectTrigger className="h-auto min-h-11 rounded-2xl border-orange-200 pr-2 text-left text-xs [&>span]:line-clamp-2 [&>span]:flex-1 [&>span]:text-left [&>span]:leading-tight sm:text-sm">
                        <SelectValue placeholder="Selecciona mesa o division" />
                      </SelectTrigger>
                      <SelectContent>
                        {rightOptions.map((order) => (
                          <SelectItem key={order.id} value={order.id}>
                            {order.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={!canSelectAcrossSides} className="h-11 w-9 shrink-0 rounded-full px-0 text-slate-600" onClick={moveAllRightToLeft}>
                    <ArrowUp className="h-4 w-4 sm:hidden" />
                    <ArrowLeft className="hidden h-4 w-4 sm:block" />
                  </Button>
                </div>

                {rightOrderQuery.isLoading ? (
                  <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cargando items operativos...
                  </div>
                ) : rightOrderQuery.isError ? (
                  <Alert variant="destructive">
                    <AlertDescription>No se pudo cargar los items de esta mesa o division.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex min-h-[16rem] flex-1 flex-col space-y-3">
                    {rightDisplayRows.length === 0 ? (
                      <div className="flex-1 rounded-2xl border border-dashed border-stone-200/80 bg-stone-50/35" />
                    ) : (
                      <div className="flex-1 space-y-1.5">
                        <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                          {rightDisplayRows.map(({ item, qty, mode }) => (
                            <TransferRow
                              key={`right-${mode}-${item.id}`}
                              item={item}
                              qty={qty}
                              right
                              disabled={!canSelectAcrossSides}
                              onOne={() => mode === "incoming"
                                ? setLeftQty(item.id, Number(leftSelectedQty[item.id] ?? 0) - 1, item.quantityMovable)
                                : setRightQty(item.id, Number(rightSelectedQty[item.id] ?? 0) + 1, item.quantityMovable)}
                              onAll={() => mode === "incoming"
                                ? setLeftQty(item.id, 0, item.quantityMovable)
                                : setRightQty(item.id, item.quantityMovable, item.quantityMovable)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

        </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmingEmptyOrderCleanup} onOpenChange={setConfirmingEmptyOrderCleanup}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar eliminacion de orden vacia</AlertDialogTitle>
            <AlertDialogDescription>
              {emptyOrderConfirmationMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moveMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => moveMutation.mutate()} disabled={moveMutation.isPending}>
              {moveMutation.isPending ? "Moviendo..." : "Aceptar y eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
