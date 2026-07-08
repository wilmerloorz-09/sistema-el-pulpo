import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";
import { isTemporaryOrderItemId } from "@/hooks/useOrder";
import { getSentItemStageLabel, isOrderItemFreelyEditableInDispatchFirst } from "@/lib/orderFlow";
import { useBranch } from "@/contexts/BranchContext";

interface OrderItem {
  id: string;
  product_id?: string;
  description_snapshot: string;
  item_note?: string | null;
  quantity: number;
  quantity_requested?: number;
  quantity_ordered?: number;
  quantity_sent?: number;
  quantity_ready_available?: number;
  quantity_dispatched?: number;
  quantity_remaining?: number;
  quantity_cancelled?: number;
  quantity_cancellable?: number;
  unit_price: number;
  total: number;
  status: string;
  tray_item_type?: "A" | "B" | "C" | null;
  tray_container_cost?: number;
  modifiers: { id: string; description: string }[];
}

interface Props {
  items: OrderItem[];
  onRemove: (id: string | string[]) => void;
  onUpdateQty: (id: string, qty: number, unit_price: number) => void;
  onRequestCancel?: (item: OrderItem, qty: number) => void;
  disableDraftEditing?: boolean;
  disableOperationalCancel?: boolean;
  alwaysShowControls?: boolean;
  hideItemControls?: boolean;
  editableItemIds?: string[];
  /** Total manual de orden especial (lo que debe mandar en caja). */
  specialOrderChargeTotal?: number | null;
  /** Suma de líneas a precio catálogo; solo referencia junto al total especial. */
  specialOrderCatalogTotal?: number | null;
  /** TAKEOUT / EXPRESS / DINE_IN: etiqueta de linea enviada ("En caja" vs "En despacho"). */
  orderType?: string | null;
  isSpecialOrder?: boolean;
  /** Despacho primero: permite +/- en lineas "En despacho" sin modo Editar orden. */
  allowSentStageEditing?: boolean;
  /** Despacho primero: separar visualmente "En despacho" y "Despachados". */
  splitDispatchSections?: boolean;
}

type OrderItemStage = "sent" | "partial" | "dispatched" | "draft" | "pendingCancellation" | "paid";

function formatLineTotal(unitPrice: number, quantity: number) {
  return (Number(unitPrice ?? 0) * Number(quantity ?? 0)).toFixed(2);
}

function PriceInput({
  itemId,
  initialPrice,
  quantity,
  onUpdateQty,
}: {
  itemId: string;
  initialPrice: number;
  quantity: number;
  onUpdateQty: (id: string, qty: number, price: number) => void;
}) {
  const [value, setValue] = useState(String(initialPrice));

  // Sync with prop when prop changes
  useEffect(() => {
    setValue(String(initialPrice));
  }, [initialPrice]);

  // Debounced callback to update parent state/optimistic cache on input changes
  useEffect(() => {
    const val = parseFloat(value);
    if (!isNaN(val) && val >= 0 && val !== initialPrice) {
      const timer = setTimeout(() => {
        onUpdateQty(itemId, quantity, val);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [value, itemId, quantity, initialPrice, onUpdateQty]);

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const val = parseFloat(value);
        if (!isNaN(val) && val >= 0 && val !== initialPrice) {
          onUpdateQty(itemId, quantity, val);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function getOrderItemStage(item: OrderItem): OrderItemStage {
  const requestedQty = Math.max(0, Number(item.quantity_requested ?? 0));
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));

  if (item.status === "DRAFT") {
    return "draft";
  }

  if (item.status === "ITEM_PENDING_CANCELLATION" || item.status === "PENDING_CANCELLATION" || requestedQty > 0) {
    return "pendingCancellation";
  }

  if (dispatchedQty > 0 && remainingQty === 0) {
    return "dispatched";
  }

  if (dispatchedQty > 0 && remainingQty > 0) {
    return "partial";
  }

  if (item.status === "PAID" || (Number(item.quantity_ordered ?? 0) > 0 && Number(item.quantity ?? 0) === 0 && !String(item.status ?? "").includes("CANCEL"))) {
    return "paid";
  }

  return "sent";
}

function getOrderItemStageStyles(stage: OrderItemStage) {
  switch (stage) {
    case "draft":
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
    case "sent":
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
    case "partial":
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
    case "dispatched":
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
    case "pendingCancellation":
      return {
        card: "border-rose-200 bg-rose-50/40",
        badge: "border-rose-700 bg-rose-700 text-white",
      };
    case "paid":
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
    default:
      return {
        card: "border-slate-200 bg-white",
        badge: "border-slate-300 bg-slate-100 text-slate-950",
      };
  }
}

function getOrderItemStageLabel(stage: OrderItemStage, orderType?: string | null, workflowMode?: string | null) {
  switch (stage) {
    case "draft":
      return "No enviado";
    case "sent":
      return getSentItemStageLabel(orderType, workflowMode);
    case "partial":
      return "Despacho parcial";
    case "dispatched":
      return "Despachado";
    case "pendingCancellation":
      return "Pendiente anulacion";
    case "paid":
      return "Pagado";
  }
}

function getOrderItemStageLegendClass(stage: OrderItemStage) {
  switch (stage) {
    case "draft":
      return "border-slate-200 bg-white text-slate-700";
    case "sent":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "partial":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "dispatched":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "pendingCancellation":
      return "border-rose-200 bg-rose-100 text-rose-900";
    case "paid":
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getOrderItemStageDotClass(stage: OrderItemStage) {
  switch (stage) {
    case "sent":
      return "bg-slate-500";
    case "partial":
      return "bg-slate-500";
    case "dispatched":
      return "bg-slate-500";
    case "pendingCancellation":
      return "bg-rose-500";
    case "paid":
      return "bg-slate-500";
    case "draft":
      return "bg-slate-400";
  }
}

function buildSectionItemTotals(item: OrderItem, quantity: number): OrderItem {
  const containerCost = Number(item.tray_container_cost ?? 0);
  const normalizedQty = Math.max(0, Number(quantity ?? 0));
  const lineTotal = normalizedQty > 0 ? normalizedQty * item.unit_price + containerCost : 0;

  return {
    ...item,
    quantity: normalizedQty,
    quantity_ordered: normalizedQty,
    total: lineTotal,
  };
}

function splitItemsForDispatchFirstSections(items: OrderItem[]) {
  const inDispatch: OrderItem[] = [];
  const dispatched: OrderItem[] = [];

  for (const item of items) {
    const stage = getOrderItemStage(item);
    const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
    const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));
    const visibleQty = Math.max(0, Number(item.quantity ?? 0));

    if (stage === "dispatched") {
      if (visibleQty > 0) dispatched.push(item);
      continue;
    }

    if (stage === "partial") {
      if (remainingQty > 0) {
        inDispatch.push(buildSectionItemTotals({
          ...item,
          quantity_dispatched: 0,
          quantity_remaining: remainingQty,
        }, remainingQty));
      }
      if (dispatchedQty > 0) {
        dispatched.push(buildSectionItemTotals({
          ...item,
          quantity: dispatchedQty,
          quantity_dispatched: dispatchedQty,
          quantity_remaining: 0,
        }, dispatchedQty));
      }
      continue;
    }

    if (visibleQty > 0 || stage === "pendingCancellation") {
      inDispatch.push(item);
    }
  }

  return { inDispatch, dispatched };
}

function shouldUseDispatchFirstSections(
  items: OrderItem[],
  orderType?: string | null,
  workflowMode?: string | null,
) {
  const isDispatchFirstWorkflow =
    orderType === "EXPRESS"
    || (workflowMode === "DISPATCH_THEN_CASH" && orderType !== "TAKEOUT");

  if (!isDispatchFirstWorkflow) return false;

  return items.some((item) => {
    const stage = getOrderItemStage(item);
    return stage === "dispatched" || stage === "partial" || stage === "sent";
  });
}

const OrderItemsList = ({
  items,
  onRemove,
  onUpdateQty,
  onRequestCancel,
  disableDraftEditing = false,
  disableOperationalCancel = false,
  alwaysShowControls = false,
  hideItemControls = false,
  editableItemIds = [],
  specialOrderChargeTotal = null,
  specialOrderCatalogTotal = null,
  orderType = null,
  isSpecialOrder = false,
  allowSentStageEditing = false,
  splitDispatchSections = false,
}: Props) => {
  const { activeBranch } = useBranch();
  const workflowMode = activeBranch?.workflow_mode ?? "CASH_THEN_DISPATCH";
  const total = items.reduce((sum, i) => sum + i.total, 0);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">Orden vacia</p>
        <p className="text-xs mt-1">Selecciona productos del menu</p>
      </div>
    );
  }
  const renderList = (subItems: typeof items, isPaidGroup: boolean) => {
    const listHideControls = isPaidGroup ? true : hideItemControls;
    const listAlwaysShowControls = isPaidGroup ? false : alwaysShowControls;

    const groups: Record<string, OrderItem & { groupItemIds: string[]; modifierQuantities: Array<{ mod: any; qty: number }> }> = {};
    for (const item of subItems) {
      const modKey = (item.modifiers || [])
        .map((m) => m.description.trim().toLowerCase())
        .sort()
        .join("|");
      const isDraft = item.status === "DRAFT";
      const key = `${item.description_snapshot}_${item.unit_price}_${isDraft ? "draft" : "non-draft"}_${modKey}`;
      const itemQty = item.quantity || item.quantity_ordered || 0;
      if (!groups[key]) {
        groups[key] = {
          ...item,
          groupItemIds: [item.id],
          modifierQuantities: item.modifiers.map((m) => ({ mod: m, qty: itemQty })),
        };
      } else {
        groups[key].quantity += item.quantity;
        groups[key].total += item.total;
        groups[key].groupItemIds.push(item.id);
        groups[key].modifierQuantities.push(...item.modifiers.map((m) => ({ mod: m, qty: itemQty })));
      }
    }

    const consolidatedGroups = Object.values(groups).map((group) => {
      const modCounts: Record<string, { description: string; count: number; firstId: string }> = {};
      for (const mq of group.modifierQuantities) {
        const desc = mq.mod.description.trim();
        if (!desc) continue;
        const mk = desc.toLowerCase();
        if (!modCounts[mk]) {
          modCounts[mk] = { description: desc, count: mq.qty, firstId: mq.mod.id };
        } else {
          modCounts[mk].count += mq.qty;
        }
      }

      const consolidatedModifiers = Object.values(modCounts).map((mc) => ({
        id: mc.firstId,
        description: mc.count > 1 ? `${mc.description} (${mc.count})` : mc.description,
      }));

      return { ...group, modifiers: consolidatedModifiers };
    });

    return consolidatedGroups.map((item) => {
      const isPending = item.status === "DRAFT";
      const isTemporaryItem = isTemporaryOrderItemId(item.id);
      const editableById = editableItemIds.some((id) => item.groupItemIds.includes(id));
      const canShowControlsForItem = !listHideControls || editableById;
      const freelyEditableInDispatchFirst =
        allowSentStageEditing && !listAlwaysShowControls && isOrderItemFreelyEditableInDispatchFirst(item);
      const showControls =
        canShowControlsForItem &&
        !isTemporaryItem &&
        (isPending || listAlwaysShowControls || freelyEditableInDispatchFirst || editableById);
      const draftDisabled = isPending && disableDraftEditing;
      const controlsDisabled = listAlwaysShowControls ? false : draftDisabled;
      const displayQuantity =
        item.status === "DRAFT"
          ? Math.max(item.quantity, Number(item.quantity_ordered ?? 0))
          : item.quantity;
      const trimmedItemNote = String(item.item_note ?? "").trim();
      const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");
      const isBulkItem = item.tray_item_type === "C" || isDeliveryInstruction;
      const itemStage = getOrderItemStage(item);
      const itemStageStyles = getOrderItemStageStyles(itemStage);

      return (
        <div
          key={item.id}
          className={cn(
            "rounded-2xl border py-3 pl-1.5 pr-2.5 transition-all sm:px-3",
            isPending
              ? "shadow-[0_10px_24px_-22px_rgba(15,23,42,0.18)]"
              : (displayQuantity === 0 && itemStage !== "paid" && itemStage !== "dispatched") ? "opacity-50 border-red-200 bg-red-50/50" : "",
            displayQuantity > 0 ? itemStageStyles.card : "",
          )}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
            <div
              className={cn(
                "min-w-0 flex-1 grid gap-y-1",
                isBulkItem
                  ? "grid-cols-[minmax(0,1fr)_auto]"
                  : "grid-cols-[auto_minmax(0,1fr)_auto] gap-x-1.5 sm:gap-x-3",
              )}
            >
              {!isBulkItem ? (
                <Badge
                  variant="secondary"
                  className={cn(
                    "col-start-1 row-start-1 flex h-7 w-11 self-center justify-center rounded-lg bg-none px-0 py-0 text-sm font-black leading-none shadow-none hover:brightness-100",
                    itemStageStyles.badge,
                    (displayQuantity === 0 && itemStage !== "paid" && itemStage !== "dispatched") && "opacity-50 !border-red-300 !bg-red-100 !text-red-900"
                  )}
                >
                  {(displayQuantity || item.quantity_ordered) ?? 0}
                </Badge>
              ) : null}

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 self-center truncate whitespace-nowrap pr-1 text-left text-[13px] font-medium text-foreground sm:pr-0 sm:text-sm",
                      isBulkItem ? "col-start-1 row-start-1" : "col-start-2 row-start-1"
                    )}
                  >
                    {item.description_snapshot}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-auto max-w-[18rem] break-words px-3 py-2 text-xs sm:text-sm">
                  {item.description_snapshot}
                </PopoverContent>
              </Popover>

              {itemStage !== "draft" && !showControls ? (
                itemStage === "partial" ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "col-start-3 row-start-1 inline-flex shrink-0 self-center items-center justify-self-end gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap sm:gap-1.5 sm:text-[11px]",
                          isBulkItem && "col-start-2",
                          getOrderItemStageLegendClass(itemStage),
                          (displayQuantity === 0 && itemStage !== "paid" && itemStage !== "dispatched") && "opacity-50"
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-500 sm:h-2 sm:w-2" />
                        {getOrderItemStageLabel(itemStage, orderType, workflowMode)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="top" className="w-auto px-3 py-2 text-xs font-medium sm:text-sm">
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span>Despachado: {Math.max(0, Number(item.quantity_dispatched ?? 0))}</span>
                        <span>Falta: {Math.max(0, Number(item.quantity_remaining ?? 0))}</span>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span
                    className={cn(
                      "col-start-3 row-start-1 inline-flex shrink-0 self-center items-center justify-self-end gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap sm:gap-1.5 sm:text-[11px]",
                      isBulkItem && "col-start-2",
                      getOrderItemStageLegendClass(itemStage),
                      (displayQuantity === 0 && itemStage !== "paid" && itemStage !== "dispatched") && "opacity-50"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2",
                        getOrderItemStageDotClass(itemStage),
                      )}
                    />
                    {getOrderItemStageLabel(itemStage, orderType, workflowMode)}
                  </span>
                )
              ) : null}

              {(item.tray_item_type || (item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0)) ? (
                <div
                  className={cn(
                    "mt-0.5 flex flex-wrap items-center gap-1.5 sm:gap-2",
                    isBulkItem ? "col-span-2" : "col-start-2 col-span-2",
                  )}
                >
                  {item.tray_item_type ? (
                    <TrayItemChip type={item.tray_item_type as TrayItemType} size="xs" />
                  ) : null}
                  {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                    <span className="text-[11px] font-semibold text-orange-600">
                      + ${Number(item.tray_container_cost ?? 0).toFixed(2)} tarrina
                    </span>
                  ) : null}
                </div>
              ) : null}

              {trimmedItemNote && (
                <p
                  className={cn(
                    "mt-0.5 break-words whitespace-normal",
                    isBulkItem ? "col-span-2" : "col-start-2 col-span-2",
                    isDeliveryInstruction
                      ? "w-fit rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 sm:text-[13px]"
                      : "text-xs italic text-muted-foreground",
                  )}
                >
                  {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
                </p>
              )}

              <p className={cn("-mt-1 text-[11px] font-medium text-slate-500 sm:text-xs", isBulkItem ? "col-span-2" : "col-start-2 col-span-2")}>
                {isBulkItem ? (
                  <span className="font-bold text-slate-900">${Number(item.total ?? item.unit_price ?? 0).toFixed(2)}</span>
                ) : (
                  <>
                    <span>${item.unit_price.toFixed(2)}</span>
                    <span className="px-1 text-slate-400">x</span>
                    <span>{displayQuantity || item.quantity_ordered}</span>
                    <span className="px-1 text-slate-400">=</span>
                    <span className="font-bold text-slate-900">${formatLineTotal(item.unit_price, displayQuantity || item.quantity_ordered)}</span>
                  </>
                )}
              </p>

              {item.modifiers.length > 0 && (
                <div className={cn("mt-1 flex flex-col gap-0.5 text-xs font-semibold text-red-600", isBulkItem ? "col-span-2" : "col-start-2 col-span-2")}>
                  {item.modifiers
                    .filter((modifier) => String(modifier.description ?? "").trim().length > 0)
                    .map((modifier) => (
                      <p key={modifier.id} className="break-words whitespace-normal">
                        - {modifier.description}
                      </p>
                    ))}
                </div>
              )}
            </div>

            {showControls && (
              <div className="flex shrink-0 flex-col items-end gap-1.5 self-start sm:gap-2">
                <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border border-destructive/20 bg-red-50 !p-0 text-destructive hover:bg-red-100 [&_svg]:!h-3 [&_svg]:!w-3 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                    disabled={controlsDisabled}
                    onClick={() => {
                      const ids = item.groupItemIds.length > 1 ? item.groupItemIds : item.id;
                      onRemove(ids);
                    }}
                    title="Eliminar item"
                  >
                    <Trash2 />
                  </Button>

                  {showControls && !isBulkItem ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border-border bg-background !p-0 [&_svg]:!h-2.5 [&_svg]:!w-2.5 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                        disabled={controlsDisabled || displayQuantity === 0}
                        onClick={() => {
                          if (displayQuantity > 0) {
                            onUpdateQty(item.id, displayQuantity - 1, item.unit_price);
                          }
                        }}
                      >
                        <Minus />
                      </Button>

                      <QuantityInput
                        key={`${item.id}-draft-${displayQuantity}`}
                        initialQuantity={displayQuantity}
                        min={0}
                        max={listAlwaysShowControls || allowSentStageEditing ? 9999 : Math.max(1, item.quantity)}
                        disabled={controlsDisabled}
                        updateOnChange={false}
                        onUpdate={(newQty) => {
                          if (newQty < 0) {
                            onUpdateQty(item.id, 0, item.unit_price);
                          } else if (newQty !== displayQuantity) {
                            onUpdateQty(item.id, newQty, item.unit_price);
                          }
                        }}
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border-border bg-background !p-0 [&_svg]:!h-2.5 [&_svg]:!w-2.5 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                        disabled={controlsDisabled}
                        onClick={() => onUpdateQty(item.id, displayQuantity + 1, item.unit_price)}
                      >
                        <Plus />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    });
  };

  const hasPaidItems = items.some((item) => (item.quantity_paid ?? 0) > 0);

  if (hasPaidItems) {
    const pendingItems = items
      .map((item) => {
        const pendingQty = item.quantity;
        const containerCost = Number(item.tray_container_cost ?? 0);
        const pendingTotal = pendingQty > 0 ? pendingQty * item.unit_price + containerCost : 0;
        return {
          ...item,
          quantity: pendingQty,
          quantity_ordered: pendingQty,
          original_quantity: pendingQty,
          total: pendingTotal,
        };
      })
      .filter((item) => item.quantity > 0);

    const paidItems = items
      .map((item) => {
        const paidQty = item.quantity_paid ?? 0;
        const containerCost = Number(item.tray_container_cost ?? 0);
        const paidTotal = paidQty > 0 ? paidQty * item.unit_price + containerCost : 0;
        return {
          ...item,
          status: "PAID",
          quantity: paidQty,
          quantity_ordered: paidQty,
          original_quantity: paidQty,
          quantity_paid: paidQty,
          total: paidTotal,
        };
      })
      .filter((item) => item.quantity > 0);

    const pendingSubtotal = pendingItems.reduce((sum, i) => sum + i.total, 0);
    const paidSubtotal = paidItems.reduce((sum, i) => sum + i.total, 0);
    const orderTotal = pendingSubtotal + paidSubtotal;

    const catalogTotal = pendingSubtotal + paidSubtotal;
    const isSpecial = isSpecialOrder && specialOrderChargeTotal != null;

    const displayPendingSubtotal = isSpecial
      ? catalogTotal > 0
        ? specialOrderChargeTotal * (pendingSubtotal / catalogTotal)
        : 0
      : pendingSubtotal;

    const displayPaidSubtotal = isSpecial
      ? catalogTotal > 0
        ? specialOrderChargeTotal * (paidSubtotal / catalogTotal)
        : 0
      : paidSubtotal;

    const displayOrderTotal = isSpecial ? specialOrderChargeTotal : orderTotal;

    return (
      <div className="flex flex-col gap-4">
        {pendingItems.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 px-3 py-1 rounded-lg w-fit">
              Productos Pendientes
            </h3>
            <div className="flex flex-col gap-3">
              {renderList(pendingItems, false)}
            </div>
          </div>
        )}

        {paidItems.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1 rounded-lg w-fit">
              Productos Pagados
            </h3>
            <div className="flex flex-col gap-3">
              {renderList(paidItems, true)}
            </div>
          </div>
        )}

        <div className="mt-2 space-y-1.5 border-t border-border pt-2.5">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground">Subtotal Pendiente</span>
            <span className="font-semibold text-foreground">${displayPendingSubtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground">Subtotal Pagado</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-500">${displayPaidSubtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-border pt-1.5">
            <span className="text-sm font-bold text-foreground">Total de la Orden</span>
            <span className="font-display text-xl font-black text-foreground">
              ${displayOrderTotal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (splitDispatchSections && shouldUseDispatchFirstSections(items, orderType, workflowMode)) {
    const { inDispatch, dispatched } = splitItemsForDispatchFirstSections(items);
    const inDispatchLabel = getSentItemStageLabel(orderType, workflowMode);

    return (
      <div className="flex flex-col gap-4">
        {inDispatch.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="w-fit rounded-lg bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950/20 dark:text-amber-500">
              {inDispatchLabel}
            </h3>
            <div className="flex flex-col gap-3">
              {renderList(inDispatch, false)}
            </div>
          </div>
        )}

        {dispatched.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="w-fit rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              Despachados
            </h3>
            <div className="flex flex-col gap-3">
              {renderList(dispatched, false)}
            </div>
          </div>
        )}

        <div className="mt-1 space-y-1 border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {specialOrderChargeTotal != null ? "Total a cobrar" : "Total"}
            </span>
            <span
              className={cn(
                "font-display text-xl font-bold",
                specialOrderChargeTotal != null ? "text-orange-700" : "text-foreground",
              )}
            >
              $
              {(specialOrderChargeTotal != null ? specialOrderChargeTotal : total).toFixed(2)}
            </span>
          </div>
          {specialOrderChargeTotal != null && specialOrderCatalogTotal != null ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total real de ítems (referencia)</span>
              <span>${specialOrderCatalogTotal.toFixed(2)}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {renderList(items, false)}

      <div className="mt-1 space-y-1 border-t border-border pt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {specialOrderChargeTotal != null ? "Total a cobrar" : "Total"}
          </span>
          <span
            className={cn(
              "font-display text-xl font-bold",
              specialOrderChargeTotal != null ? "text-orange-700" : "text-foreground",
            )}
          >
            $
            {(specialOrderChargeTotal != null ? specialOrderChargeTotal : total).toFixed(2)}
          </span>
        </div>
        {specialOrderChargeTotal != null && specialOrderCatalogTotal != null ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total real de ítems (referencia)</span>
            <span>${specialOrderCatalogTotal.toFixed(2)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const QuantityInput = ({
  initialQuantity,
  min = 1,
  max,
  disabled,
  updateOnChange = false,
  className,
  onUpdate,
}: {
  initialQuantity: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  updateOnChange?: boolean;
  className?: string;
  onUpdate: (val: number) => void;
}) => {
  const [value, setValue] = useState(initialQuantity.toString());
  const [isEditing, setIsEditing] = useState(false);

  // Sync external changes when not editing
  if (!isEditing && value !== initialQuantity.toString()) {
    setValue(initialQuantity.toString());
  }

  const handleCommit = () => {
    setIsEditing(false);
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      setValue(initialQuantity.toString());
    } else {
      const normalized = Math.max(min, Math.min(max ?? parsed, parsed));
      setValue(normalized.toString());
      onUpdate(normalized);
    }
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      min={min}
      max={max}
      className={cn(
        "!h-6 !w-8 rounded-md border-border bg-background !px-0.5 !text-[11px] text-center font-medium leading-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none sm:!h-8 sm:!w-11 sm:rounded-xl sm:!px-1 sm:!text-sm sm:font-bold",
        className,
      )}
      style={{ fontSize: "11px", lineHeight: 1 }}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        setIsEditing(true);
        const rawValue = e.target.value;
        if (rawValue === "") {
          setValue("");
          return;
        }

        const sanitized = rawValue.replace(/[^\d]/g, "");
        if (!sanitized) {
          setValue(String(min));
          return;
        }

        const parsed = Math.floor(Number(sanitized));
        const normalized = Math.max(min, Math.min(max ?? parsed, parsed));
        setValue(String(normalized));
        if (updateOnChange) {
          onUpdate(normalized);
        }
      }}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      onFocus={(e) => e.target.select()}
    />
  );
};

export default OrderItemsList;
