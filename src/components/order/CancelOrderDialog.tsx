import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useCancellation } from "@/hooks/useCancellation";
import { useBranch } from "@/contexts/BranchContext";
import { CANCELLATION_REASONS, type CancellationReason } from "@/types/cancellation";
import type { OrderItemSummary } from "@/hooks/useOrdersByStatus";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp, Loader2, RotateCcw } from "lucide-react";

interface CancelOrderDialogProps {
  orderId: string;
  orderNumber: string | number;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAuthorizeCancel?: boolean;
  isCancelRequested?: boolean;
  visibleItems?: OrderItemSummary[];
  initialCancellationType?: "partial" | "total";
  initialCancelQtyByItem?: Record<string, number>;
  compactPresetMode?: boolean;
  requiresAuthorizationOverride?: boolean;
  onBufferedCancel?: (items: any[], cancelData: { reason: string; notes: string }) => void;
}

interface SnapshotItem {
  order_item_id: string;
  product_id?: string | null;
  description_snapshot: string;
  tray_item_type?: "A" | "B" | "C" | null;
  item_status: string;
  quantity_paid: number;
  quantity_ready_available: number;
  quantity_dispatched_available: number;
  quantity_cancelled_total: number;
  quantity_pending_prepare: number;
  quantity_cancellable: number;
  unit_price: number;
}

const clampQty = (value: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0)));
function TransferRow({
  item,
  qty,
  right,
  disabled,
  onOne,
  onAll,
}: {
  item: SnapshotItem;
  qty: number;
  right?: boolean;
  disabled?: boolean;
  onOne: () => void;
  onAll: () => void;
}) {
  const isBulk = item.tray_item_type === "C";
  return (
    <div className={`grid items-center gap-2 rounded-2xl border px-3 py-2 ${right ? "border-orange-200 bg-orange-50/40" : "border-stone-200 bg-stone-50/50"} grid-cols-[78px_44px_minmax(0,1fr)]`}>
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
      <span className="text-center text-sm font-semibold text-slate-900">{isBulk ? "AG" : qty}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium leading-snug text-slate-900 break-words">{item.description_snapshot}</div>
      </div>
    </div>
  );
}

export default function CancelOrderDialog({
  orderId,
  orderNumber,
  userId,
  open,
  onOpenChange,
  canAuthorizeCancel = true,
  isCancelRequested = false,
  visibleItems = [],
  initialCancellationType = "total",
  initialCancelQtyByItem = {},
  compactPresetMode = false,
  requiresAuthorizationOverride,
  onBufferedCancel,
}: CancelOrderDialogProps) {
  const { activeBranchId } = useBranch();
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [notes, setNotes] = useState("");
  const [snapshotItems, setSnapshotItems] = useState<SnapshotItem[]>([]);
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({});
  const [allowDirectCancelByProductId, setAllowDirectCancelByProductId] = useState<Record<string, boolean>>({});
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initializedScopeKeyRef = useRef<string | null>(null);
  const { cancelOrderMutation } = useCancellation();

  const visibleItemsSignature = useMemo(() => JSON.stringify(
    (Array.isArray(visibleItems) ? visibleItems : [])
      .map((item) => ({
        id: item.id,
        product_id: item.product_id ?? null,
        quantity: Number(item.quantity ?? 0),
        description_snapshot: item.description_snapshot ?? "",
        tray_item_type: item.tray_item_type ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ), [visibleItems]);

  const normalizedVisibleItems = useMemo(
    () => (Array.isArray(visibleItems) ? visibleItems : []).map((item) => ({
      id: item.id,
      product_id: item.product_id ?? null,
      quantity: Number(item.quantity ?? 0),
      description_snapshot: item.description_snapshot,
      tray_item_type: item.tray_item_type ?? null,
    })),
    [visibleItemsSignature],
  );

  const initialQtySignature = useMemo(() => JSON.stringify(
    Object.entries(initialCancelQtyByItem ?? {})
      .map(([itemId, qty]) => [itemId, Math.max(0, Math.floor(Number(qty) || 0))] as const)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
  ), [initialCancelQtyByItem]);

  const normalizedInitialQtyByItem = useMemo(
    () => Object.fromEntries(
      Object.entries(initialCancelQtyByItem ?? {}).map(([itemId, qty]) => [
        itemId,
        Math.max(0, Math.floor(Number(qty) || 0)),
      ]),
    ) as Record<string, number>,
    [initialQtySignature],
  );

  const visibleItemMap = useMemo(
    () => new Map(normalizedVisibleItems.map((item) => [item.id, item])),
    [normalizedVisibleItems],
  );

  const items = useMemo(
    () => snapshotItems
      .filter((item) => visibleItemMap.size === 0 || visibleItemMap.has(item.order_item_id))
      .map((item) => {
        const visibleItem = visibleItemMap.get(item.order_item_id);
        return {
          ...item,
          product_id: visibleItem?.product_id ?? null,
          description_snapshot: visibleItem?.description_snapshot ?? item.description_snapshot,
          tray_item_type: visibleItem?.tray_item_type ?? item.tray_item_type ?? null,
          quantity_cancellable: visibleItem
            ? Math.min(item.quantity_cancellable, Number(visibleItem.quantity ?? 0))
            : item.quantity_cancellable,
        };
      })
      .filter((item) => item.quantity_cancellable > 0),
    [snapshotItems, visibleItemMap],
  );

  const scopeIncludesWholeOrder = useMemo(
    () => visibleItemMap.size === 0 || snapshotItems.every((item) => visibleItemMap.has(item.order_item_id)),
    [snapshotItems, visibleItemMap],
  );

  const initialSelectedQty = useMemo(() => {
    const shouldSeedAll = initialCancellationType === "total" && scopeIncludesWholeOrder;
    return Object.fromEntries(
      items.map((item) => [
        item.order_item_id,
        shouldSeedAll
          ? item.quantity_cancellable
          : clampQty(Number(normalizedInitialQtyByItem[item.order_item_id] ?? 0), item.quantity_cancellable),
      ]),
    );
  }, [items, normalizedInitialQtyByItem, initialCancellationType, scopeIncludesWholeOrder]);

  const selectionScopeKey = useMemo(
    () => `${orderId}|${visibleItemsSignature}|${initialQtySignature}|${initialCancellationType}|${scopeIncludesWholeOrder ? "full" : "scoped"}`,
    [orderId, visibleItemsSignature, initialQtySignature, initialCancellationType, scopeIncludesWholeOrder],
  );

  useEffect(() => {
    if (!open) {
      initializedScopeKeyRef.current = null;
      setSnapshotItems([]);
      setSelectedQty({});
      setAllowDirectCancelByProductId({});
      setLoadError(null);
      setReason("");
      setNotes("");
      return;
    }

    let cancelled = false;

    const loadSnapshot = async () => {
      setLoadingSnapshot(true);
      setLoadError(null);
      try {
        const { data, error } = await (supabase as any).rpc("get_order_operational_snapshot", { p_order_id: orderId });
        if (error) throw error;
        const snapshotRows = Array.isArray(data) ? data : [];
        const nextItems = (snapshotRows as any[])
          .map((item) => {
            const qtyCancellable =
              Number(item.quantity_pending_prepare ?? 0) +
              Number(item.quantity_ready_available ?? 0) +
              Math.max(0, Number(item.quantity_dispatched_total ?? item.quantity_dispatched ?? 0) - Number(item.quantity_cancelled_dispatched ?? 0));
            return {
              order_item_id: item.order_item_id,
              description_snapshot: item.description_snapshot,
              tray_item_type: null,
              item_status: item.item_status ?? "SENT",
              quantity_paid: Number(item.quantity_paid ?? 0),
              quantity_ready_available: Number(item.quantity_ready_available ?? 0),
              quantity_dispatched_available: Math.max(0, Number(item.quantity_dispatched_total ?? item.quantity_dispatched ?? 0) - Number(item.quantity_cancelled_dispatched ?? 0)),
              quantity_cancelled_total: Number(item.quantity_cancelled_total ?? 0),
              quantity_pending_prepare: Number(item.quantity_pending_prepare ?? 0),
              quantity_cancellable: qtyCancellable,
              unit_price: Number(item.unit_price ?? 0),
            } as SnapshotItem;
          })
          .filter((item) => item.quantity_cancellable > 0);

        if (cancelled) return;
        setSnapshotItems(nextItems);
      } catch (error: any) {
        if (cancelled) return;
        console.error("Error cargando snapshot para anulacion:", error);
        setSnapshotItems([]);
        setSelectedQty({});
        setLoadError(error?.message || "No se pudo cargar la informacion anulable de esta orden.");
      } finally {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      }
    };

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open || loadingSnapshot) return;
    if (initializedScopeKeyRef.current === selectionScopeKey) return;
    setSelectedQty(initialSelectedQty);
    initializedScopeKeyRef.current = selectionScopeKey;
  }, [open, loadingSnapshot, selectionScopeKey, initialSelectedQty]);

  const directCancelPolicyProductIds = useMemo(
    () => Array.from(new Set(
      normalizedVisibleItems
        .map((item) => String(item.product_id ?? "").trim())
        .filter((productId) => productId.length > 0)
    )),
    [normalizedVisibleItems],
  );

  const directCancelPolicyKey = useMemo(
    () => JSON.stringify([...directCancelPolicyProductIds].sort()),
    [directCancelPolicyProductIds],
  );

  useEffect(() => {
    if (!open || canAuthorizeCancel || !activeBranchId || directCancelPolicyProductIds.length === 0) {
      setAllowDirectCancelByProductId({});
      return;
    }

    let cancelled = false;

    const loadDirectCancelPolicy = async () => {
      try {
        const entries = await Promise.all(
          directCancelPolicyProductIds.map(async (productId) => {
            const { data, error } = await (supabase as any).rpc("get_branch_cancel_policy_for_product", {
              p_branch_id: activeBranchId,
              p_product_id: productId,
            });
            if (error) throw error;

            const policyRow = Array.isArray(data) ? data[0] : data;
            return [productId, Boolean(policyRow?.allow_direct_cancel)] as const;
          }),
        );

        if (cancelled) return;
        setAllowDirectCancelByProductId(Object.fromEntries(entries));
      } catch (error) {
        if (cancelled) return;
        console.error("Error cargando politica de anulacion directa:", error);
        setAllowDirectCancelByProductId({});
      }
    };

    void loadDirectCancelPolicy();

    return () => {
      cancelled = true;
    };
  }, [open, canAuthorizeCancel, activeBranchId, directCancelPolicyKey]);

  const selectedItems = useMemo(() => items.map((item) => {
    const qty = clampQty(Number(selectedQty[item.order_item_id] ?? 0), item.quantity_cancellable);
    const cancelledPending = Math.min(qty, item.quantity_pending_prepare);
    const remAfterPending = Math.max(0, qty - cancelledPending);
    const cancelledReady = Math.min(remAfterPending, item.quantity_ready_available);
    return {
      ...item,
      selected_cancel_qty: qty,
      quantity_cancelled_pending: cancelledPending,
      quantity_cancelled_ready: cancelledReady,
      quantity_cancelled_dispatched: Math.max(0, remAfterPending - cancelledReady),
    };
  }).filter((item) => item.selected_cancel_qty > 0), [items, selectedQty]);

  const availableRows = useMemo(() => items.map((item) => ({ ...item, qty: Math.max(0, item.quantity_cancellable - clampQty(Number(selectedQty[item.order_item_id] ?? 0), item.quantity_cancellable)) })).filter((item) => item.qty > 0), [items, selectedQty]);
  const selectedRows = useMemo(() => items.map((item) => ({ ...item, qty: clampQty(Number(selectedQty[item.order_item_id] ?? 0), item.quantity_cancellable) })).filter((item) => item.qty > 0), [items, selectedQty]);
  const selectedTouchesDispatchedItems = useMemo(
    () => selectedItems.some((item) => Number(item.quantity_dispatched_available ?? 0) > 0),
    [selectedItems],
  );
  const selectedTouchesBlockedCategories = useMemo(
    () => selectedItems.some((item) => {
      const productId = String(item.product_id ?? "").trim();
      return productId.length > 0 && allowDirectCancelByProductId[productId] === false;
    }),
    [selectedItems, allowDirectCancelByProductId],
  );
  const requiresAuthorization = requiresAuthorizationOverride ?? (
    !canAuthorizeCancel
    && !isCancelRequested
    && (selectedTouchesDispatchedItems || selectedTouchesBlockedCategories)
  );
  const cancellationType = useMemo<"partial" | "total">(
    () =>
      snapshotItems.length > 0 &&
      snapshotItems.every((item) => clampQty(Number(selectedQty[item.order_item_id] ?? 0), item.quantity_cancellable) === item.quantity_cancellable)
        ? "total"
        : "partial",
    [snapshotItems, selectedQty],
  );
  const canSubmit = !!reason && !loadingSnapshot && !cancelOrderMutation.isPending && selectedItems.length > 0;

  const setQty = (id: string, nextQty: number, maxQty: number) => {
    const clamped = clampQty(nextQty, maxQty);
    setSelectedQty((prev) => ({ ...prev, [id]: clamped }));
  };

  const fillAll = () => {
    const next = Object.fromEntries(items.map((item) => [item.order_item_id, item.quantity_cancellable]));
    setSelectedQty(next);
  };

  const clearAll = () => {
    const next = Object.fromEntries(items.map((item) => [item.order_item_id, 0]));
    setSelectedQty(next);
  };

  const handleConfirm = () => {
    if (!canSubmit) return;
    
    if (onBufferedCancel) {
      onBufferedCancel(
        selectedItems.map((item) => ({
          order_item_id: item.order_item_id,
          quantity_cancelled: item.selected_cancel_qty,
          status: item.item_status,
          description_snapshot: item.description_snapshot,
          unit_price: item.unit_price,
          quantity_cancelled_pending: item.quantity_cancelled_pending,
          quantity_cancelled_ready: item.quantity_cancelled_ready,
          quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
        })),
        { reason, notes }
      );
      onOpenChange(false);
      return;
    }

    cancelOrderMutation.mutate({
      orderId,
      userId,
      cancellationType,
      items: selectedItems.map((item) => ({
        order_item_id: item.order_item_id,
        quantity_cancelled: item.selected_cancel_qty,
        status: item.item_status,
        description_snapshot: item.description_snapshot,
        unit_price: item.unit_price,
        quantity_cancelled_pending: item.quantity_cancelled_pending,
        quantity_cancelled_ready: item.quantity_cancelled_ready,
        quantity_cancelled_dispatched: item.quantity_cancelled_dispatched,
      })),
      cancellationData: { reason, notes, cancelledBy: userId },
      requiresAuthorization,
    }, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[92vw] lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Anular orden</DialogTitle>
          <DialogDescription>{String(orderNumber)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cantidades operativas...</div>
          ) : loadError ? (
            <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
          ) : items.length === 0 ? (
            <Alert><AlertDescription>Esta orden ya no tiene cantidades anulables.</AlertDescription></Alert>
          ) : (
            <div className="space-y-3">
              <Label className="text-sm font-medium">{compactPresetMode ? "Detalle de anulacion" : "Seleccion de cantidades a anular"}</Label>
              <div className="grid gap-3 lg:grid-cols-2">
                <section className="space-y-2 rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)]">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div><h3 className="text-base font-semibold text-slate-950">Items anulables</h3><p className="text-xs text-slate-500">Mueve desde aqui lo que vas a anular ahora.</p></div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto" onClick={fillAll}>
                      <ArrowDown className="h-4 w-4 sm:hidden" />
                      <ArrowRight className="hidden h-4 w-4 sm:block" />
                      Todo
                    </Button>
                  </div>
                  {availableRows.length === 0 ? <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 px-6 text-center text-sm text-slate-500">No quedan items anulables para mover en esta operacion.</div> : <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">{availableRows.map((item) => <TransferRow key={item.order_item_id} item={item} qty={item.qty} onOne={() => setQty(item.order_item_id, Number(selectedQty[item.order_item_id] ?? 0) + 1, item.quantity_cancellable)} onAll={() => setQty(item.order_item_id, item.quantity_cancellable, item.quantity_cancellable)} />)}</div>}
                </section>
                <section className="space-y-2 rounded-[22px] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.18)]">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div><h3 className="text-base font-semibold text-slate-950">Items a anular ahora</h3><p className="text-xs text-slate-500">Esto es lo que se registra en esta operacion.</p></div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-slate-600 sm:ml-auto" onClick={clearAll}><RotateCcw className="h-4 w-4" />Vaciar</Button>
                  </div>
                  {selectedRows.length === 0 ? <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 px-6 text-center text-sm text-slate-500">Mueve items desde la izquierda para incluirlos en esta anulacion.</div> : <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">{selectedRows.map((item) => <TransferRow key={item.order_item_id} item={item} qty={item.qty} right onOne={() => setQty(item.order_item_id, Number(selectedQty[item.order_item_id] ?? 0) - 1, item.quantity_cancellable)} onAll={() => setQty(item.order_item_id, 0, item.quantity_cancellable)} />)}</div>}
                </section>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <Label htmlFor="order-cancel-reason" className="text-sm font-medium">Motivo de anulacion *</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as CancellationReason)}>
              <SelectTrigger id="order-cancel-reason">
                <SelectValue placeholder="Selecciona un motivo" />
              </SelectTrigger>
              <SelectContent>
              {Object.entries(CANCELLATION_REASONS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>
          {!compactPresetMode && (
            <div className="space-y-2">
              <Label htmlFor="order-notes" className="text-sm font-medium">Notas adicionales (opcional)</Label>
              <Textarea id="order-notes" placeholder="Detalle adicional de la anulacion..." value={notes} onChange={(e) => setNotes(e.target.value)} className="h-20" />
            </div>
          )}
          {!compactPresetMode && (
            <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Se anula primero la cantidad pendiente, luego la lista y finalmente la despachada no pagada.</AlertDescription></Alert>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cerrar</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit} className="w-full sm:w-auto">
            {cancelOrderMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...</> : isCancelRequested && canAuthorizeCancel ? "Autorizar anulacion" : requiresAuthorization ? "Solicitar anulacion" : "Confirmar anulacion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
