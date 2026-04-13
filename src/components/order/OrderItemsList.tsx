import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import type { TrayItemType } from "@/hooks/useTrayOrder";

interface OrderItem {
  id: string;
  product_id?: string;
  description_snapshot: string;
  item_note?: string | null;
  quantity: number;
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
  onRemove: (id: string) => void;
  onUpdateQty: (id: string, qty: number, unit_price: number) => void;
  onRequestCancel?: (item: OrderItem, qty: number) => void;
  disableDraftEditing?: boolean;
  disableOperationalCancel?: boolean;
}

type OrderItemStage = "sent" | "partial" | "dispatched" | "draft";

function formatLineTotal(unitPrice: number, quantity: number) {
  return (Number(unitPrice ?? 0) * Number(quantity ?? 0)).toFixed(2);
}

function getOrderItemStage(item: OrderItem): OrderItemStage {
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));

  if (item.status === "DRAFT") {
    return "draft";
  }

  if (dispatchedQty > 0 && remainingQty === 0) {
    return "dispatched";
  }

  if (dispatchedQty > 0 && remainingQty > 0) {
    return "partial";
  }

  return "sent";
}

function getOrderItemStageStyles(stage: OrderItemStage) {
  switch (stage) {
    case "sent":
      return {
        card: "border-orange-200 bg-orange-50/30",
        badge: "border-orange-200 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
      };
    case "partial":
      return {
        card: "border-amber-200 bg-amber-50/30",
        badge: "border-orange-200 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
      };
    case "dispatched":
      return {
        card: "border-emerald-200 bg-emerald-50/30",
        badge: "border-orange-200 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
      };
    default:
      return {
        card: "border-orange-200 bg-white",
        badge: "border-orange-200 bg-gradient-to-r from-orange-500 to-orange-400 text-white",
      };
  }
}

function getOrderItemStageLabel(stage: OrderItemStage) {
  switch (stage) {
    case "draft":
      return "No enviado";
    case "sent":
      return "En cocina";
    case "partial":
      return "Despacho parcial";
    case "dispatched":
      return "Despachado";
  }
}

function getOrderItemStageLegendClass(stage: OrderItemStage) {
  switch (stage) {
    case "draft":
      return "border-slate-200 bg-white text-slate-700";
    case "sent":
      return "border-orange-200 bg-orange-100 text-orange-800";
    case "partial":
      return "border-amber-200 bg-amber-100 text-amber-900";
    case "dispatched":
      return "border-emerald-200 bg-emerald-100 text-emerald-900";
  }
}

const OrderItemsList = ({
  items,
  onRemove,
  onUpdateQty,
  onRequestCancel,
  disableDraftEditing = false,
  disableOperationalCancel = false,
}: Props) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">Orden vacia</p>
        <p className="text-xs mt-1">Selecciona productos del menu</p>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.total, 0);
  const [operationalQtyByItem, setOperationalQtyByItem] = useState<Record<string, number>>({});

  const buildDefaultOperationalQty = (item: OrderItem) => {
    const maxQty = Math.max(0, item.quantity_cancellable ?? item.quantity_remaining ?? item.quantity);
    return maxQty > 0 ? maxQty : 0;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto text-[11px] font-semibold sm:flex-wrap sm:gap-2 sm:text-[11px]">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 whitespace-nowrap text-slate-700 sm:gap-1.5 sm:px-2 sm:py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white ring-1 ring-slate-300 sm:h-2 sm:w-2" />
          No enviado
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-100 px-2 py-1 whitespace-nowrap text-orange-800 sm:gap-1.5 sm:px-2 sm:py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 sm:h-2 sm:w-2" />
          En cocina
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-1 whitespace-nowrap text-amber-900 sm:gap-1.5 sm:px-2 sm:py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 sm:h-2 sm:w-2" />
          <span className="sm:hidden">Parcial</span>
          <span className="hidden sm:inline">Despacho parcial</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 whitespace-nowrap text-emerald-900 sm:gap-1.5 sm:px-2 sm:py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 sm:h-2 sm:w-2" />
          Despachado
        </span>
      </div>

      {items.map((item) => {
        const isPending = item.status === "DRAFT";
        const isRequestedCancel = item.status === "ITEM_PENDING_CANCELLATION" || item.status === "PENDING_CANCELLATION";
        const canCancelOperational = !isPending && !isRequestedCancel && !!onRequestCancel && !disableOperationalCancel;
        const maxOperationalQty = Math.max(0, item.quantity_cancellable ?? item.quantity_remaining ?? 0);
        const draftDisabled = isPending && disableDraftEditing;
        const operationalDisabled = (!isPending && disableOperationalCancel) || isRequestedCancel;
        const controlDisabled = isPending ? draftDisabled : operationalDisabled;
        const operationalControlClass = !isPending && !operationalDisabled
          ? "border-orange-200 bg-white text-foreground shadow-[0_10px_24px_-22px_rgba(249,115,22,0.35)] hover:border-orange-300 hover:bg-orange-50"
          : "border-border bg-background";
        const displayQuantity = Math.max(1, item.quantity);
        const requestedOperationalQty = (operationalQtyByItem[item.id] ?? buildDefaultOperationalQty(item)) || 1;
        const selectedOperationalQty = Math.max(
          1,
          Math.min(
            maxOperationalQty || displayQuantity || 1,
            requestedOperationalQty,
          ),
        );
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
                ? "shadow-[0_10px_24px_-22px_rgba(249,115,22,0.45)]"
                : operationalDisabled
                  ? "opacity-60"
                  : "",
              itemStageStyles.card,
            )}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
              <div className="flex min-w-0 items-start gap-1.5 sm:gap-3">
                {!isBulkItem ? (
                  <Badge className={cn("mt-0.5 min-w-[2.2rem] shrink-0 justify-center rounded-lg px-1.5 py-1 text-[11px] font-black leading-none shadow-[0_10px_18px_-16px_rgba(249,115,22,0.95)] sm:min-w-[2.7rem] sm:px-2 sm:text-xs", itemStageStyles.badge)}>
                    {displayQuantity}
                  </Badge>
                ) : null}

                <div className="min-w-0 flex-1">
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                  <p
                    className="min-w-0 max-w-full flex-1 truncate whitespace-nowrap text-[13px] font-medium text-foreground sm:break-words sm:whitespace-normal sm:text-sm"
                    title={item.description_snapshot}
                  >
                    {item.description_snapshot}
                  </p>
                  {itemStage !== "draft" ? (
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold sm:ml-auto sm:gap-1.5 sm:px-2 sm:text-[11px]", getOrderItemStageLegendClass(itemStage))}>
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2",
                        itemStage === "sent"
                          ? "bg-orange-500"
                          : itemStage === "partial"
                            ? "bg-amber-500"
                            : "bg-emerald-500",
                      )} />
                      {getOrderItemStageLabel(itemStage)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {item.tray_item_type ? (
                    <TrayItemChip type={item.tray_item_type as TrayItemType} size="xs" />
                  ) : null}
                  {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                    <span className="text-[11px] font-semibold text-orange-600">
                      + ${Number(item.tray_container_cost ?? 0).toFixed(2)} tarrina
                    </span>
                  ) : null}
                </div>

                {item.modifiers.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5 text-xs font-semibold text-red-600">
                    {item.modifiers
                      .filter((modifier) => String(modifier.description ?? "").trim().length > 0)
                      .map((modifier) => (
                        <p key={modifier.id} className="break-words whitespace-normal">
                          - {modifier.description}
                        </p>
                      ))}
                  </div>
                )}

                {trimmedItemNote && (
                  <p
                    className={cn(
                      "mt-1 break-words whitespace-normal",
                      isDeliveryInstruction
                        ? "text-sm font-semibold text-orange-700"
                        : "text-xs italic text-muted-foreground",
                    )}
                  >
                    {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
                  </p>
                )}

                <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                  {isBulkItem ? (
                    <span className="font-semibold text-foreground">${Number(item.total ?? item.unit_price ?? 0).toFixed(2)}</span>
                  ) : (
                    <>
                      ${item.unit_price.toFixed(2)} x {displayQuantity} ={" "}
                      <span className="font-semibold text-foreground">${formatLineTotal(item.unit_price, displayQuantity)}</span>
                    </>
                  )}
                </p>

                {!isPending && (
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-medium text-muted-foreground sm:gap-x-3 sm:text-[11px]">
                    <span>Despachado: {Number(item.quantity_dispatched ?? 0)}</span>
                    <span>Falta: {Number(item.quantity_remaining ?? 0)}</span>
                  </div>
                )}
                </div>
              </div>

              {isPending && (
                <div className="flex shrink-0 flex-col items-end gap-1.5 self-start sm:gap-2">
                  <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border border-destructive/20 bg-red-50 !p-0 text-destructive hover:bg-red-100 [&_svg]:!h-3 [&_svg]:!w-3 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                      disabled={draftDisabled}
                      onClick={() => onRemove(item.id)}
                      title="Eliminar item"
                    >
                      <Trash2 />
                    </Button>

                    {!isBulkItem ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border-border bg-background !p-0 [&_svg]:!h-2.5 [&_svg]:!w-2.5 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                          disabled={draftDisabled}
                          onClick={() => {
                            if (item.quantity > 1) {
                              onUpdateQty(item.id, item.quantity - 1, item.unit_price);
                            }
                          }}
                        >
                          <Minus />
                        </Button>

                        <QuantityInput
                          key={`${item.id}-draft-${displayQuantity}`}
                          initialQuantity={displayQuantity}
                          min={1}
                          max={Math.max(1, item.quantity)}
                          disabled={draftDisabled}
                          updateOnChange={false}
                          onUpdate={(newQty) => {
                            if (newQty <= 0) {
                              onRemove(item.id);
                            } else if (newQty !== item.quantity) {
                              onUpdateQty(item.id, newQty, item.unit_price);
                            }
                          }}
                        />

                        <Button
                          variant="ghost"
                          size="icon"
                          className="!h-6 !w-6 !min-h-6 !min-w-6 rounded-md border-border bg-background !p-0 [&_svg]:!h-2.5 [&_svg]:!w-2.5 sm:!h-8 sm:!w-8 sm:!min-h-8 sm:!min-w-8 sm:rounded-xl sm:[&_svg]:!h-3.5 sm:[&_svg]:!w-3.5"
                          disabled={draftDisabled}
                          onClick={() => onUpdateQty(item.id, item.quantity + 1, item.unit_price)}
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
      })}

      <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
        <span className="text-sm font-medium text-muted-foreground">Total</span>
        <span className="font-display text-xl font-bold text-foreground">${total.toFixed(2)}</span>
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
      type="number"
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
