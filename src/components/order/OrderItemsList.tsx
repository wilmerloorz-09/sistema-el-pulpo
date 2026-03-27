import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Ban, Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

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

function formatLineTotal(unitPrice: number, quantity: number) {
  return (Number(unitPrice ?? 0) * Number(quantity ?? 0)).toFixed(2);
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
      {items.map((item) => {
        const isPending = item.status === "DRAFT";
        const canCancelOperational = !isPending && !!onRequestCancel && !disableOperationalCancel;
        const maxOperationalQty = Math.max(0, item.quantity_cancellable ?? item.quantity_remaining ?? 0);
        const draftDisabled = isPending && disableDraftEditing;
        const operationalDisabled = !isPending && disableOperationalCancel;
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

        return (
          <div
            key={item.id}
            className={cn(
              "rounded-2xl border bg-white px-3 py-3 transition-all",
              isPending
                ? "border-orange-200 shadow-[0_10px_24px_-22px_rgba(249,115,22,0.45)]"
                : operationalDisabled
                  ? "border-border opacity-60"
                  : "border-border"
            )}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <Badge className="mt-0.5 min-w-[2.35rem] shrink-0 justify-center rounded-lg border-orange-200 bg-gradient-to-r from-orange-500 to-orange-400 px-1.5 py-1 text-[11px] font-black uppercase leading-none text-white shadow-[0_10px_18px_-16px_rgba(249,115,22,0.95)]">
                  {displayQuantity}x
                </Badge>

                <div className="min-w-0 flex-1">
                <p className="break-words whitespace-normal text-sm font-medium text-foreground">
                  {item.description_snapshot}
                </p>

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

                {item.item_note && (
                  <p className="mt-1 text-xs italic text-muted-foreground">Nota: {item.item_note}</p>
                )}

                <p className="mt-1 text-xs text-muted-foreground">
                  ${item.unit_price.toFixed(2)} x {displayQuantity} ={" "}
                  <span className="font-semibold text-foreground">${formatLineTotal(item.unit_price, displayQuantity)}</span>
                </p>

                <div className="mt-1 flex flex-nowrap gap-x-2 overflow-hidden text-[11px] text-muted-foreground sm:text-xs">
                  <span className="shrink-0">Env: {item.quantity_sent ?? 0}</span>
                  <span className="shrink-0">Desp: {item.quantity_dispatched ?? 0}</span>
                  <span className="shrink-0">Falt: {item.quantity_remaining ?? 0}</span>
                  <span className="shrink-0">Canc: {item.quantity_cancelled ?? 0}</span>
                </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2 self-start">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-xl",
                      isPending
                        ? "border border-destructive/20 bg-red-50 text-destructive hover:bg-red-100"
                        : "border border-destructive/20 bg-red-50 text-destructive hover:bg-red-100",
                    )}
                    disabled={controlDisabled || (!isPending && (!canCancelOperational || maxOperationalQty <= 0))}
                    onClick={() => {
                      if (isPending) {
                        onRemove(item.id);
                        return;
                      }

                      if (onRequestCancel && !disableOperationalCancel) {
                        onRequestCancel(item, maxOperationalQty || displayQuantity || 1);
                      }
                    }}
                    title={isPending ? "Eliminar item" : "Anular todo el item"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 rounded-xl", operationalControlClass)}
                    disabled={controlDisabled}
                    onClick={() => {
                      if (isPending) {
                        if (item.quantity > 1) {
                          onUpdateQty(item.id, item.quantity - 1, item.unit_price);
                        }
                        return;
                      }

                      if (canCancelOperational && selectedOperationalQty > 1) {
                        setOperationalQtyByItem((prev) => ({
                          ...prev,
                          [item.id]: selectedOperationalQty - 1,
                        }));
                      }
                    }}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>

                  <QuantityInput
                    key={`${item.id}-${isPending ? "draft" : "cancel"}-${isPending ? displayQuantity : selectedOperationalQty}`}
                    initialQuantity={isPending ? displayQuantity : selectedOperationalQty}
                    min={1}
                    max={isPending ? Math.max(1, item.quantity) : Math.max(1, maxOperationalQty || displayQuantity || 1)}
                    disabled={controlDisabled}
                    updateOnChange={!isPending}
                    className={!isPending && !operationalDisabled ? "border-orange-200 bg-white text-foreground shadow-[0_10px_24px_-22px_rgba(249,115,22,0.35)]" : undefined}
                    onUpdate={(newQty) => {
                      if (isPending) {
                        if (newQty <= 0) {
                          onRemove(item.id);
                        } else if (newQty !== item.quantity) {
                          onUpdateQty(item.id, newQty, item.unit_price);
                        }
                        return;
                      }

                      const normalized = Math.max(1, Math.min(maxOperationalQty || displayQuantity || 1, newQty));
                      setOperationalQtyByItem((prev) => ({
                        ...prev,
                        [item.id]: normalized,
                      }));
                    }}
                  />

                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 rounded-xl", operationalControlClass)}
                    disabled={controlDisabled}
                    onClick={() => {
                      if (isPending) {
                        onUpdateQty(item.id, item.quantity + 1, item.unit_price);
                        return;
                      }

                      if (canCancelOperational && selectedOperationalQty < (maxOperationalQty || displayQuantity || 1)) {
                        setOperationalQtyByItem((prev) => ({
                          ...prev,
                          [item.id]: selectedOperationalQty + 1,
                        }));
                      }
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {!isPending && (
                  <Button
                    variant="destructive"
                    className={cn(
                      "h-9 min-w-[6.75rem] rounded-xl px-4 font-display text-sm font-semibold",
                      !operationalDisabled && "opacity-100 saturate-100",
                    )}
                    disabled={operationalDisabled}
                    onClick={() => {
                      if (onRequestCancel && !disableOperationalCancel) {
                        onRequestCancel(item, selectedOperationalQty);
                      }
                    }}
                  >
                    <Ban className="h-4 w-4" />
                    Anular
                  </Button>
                )}
              </div>
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
        "h-8 w-11 rounded-xl border-border bg-background px-1 text-center text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        className,
      )}
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
