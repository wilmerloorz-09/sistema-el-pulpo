import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface OrderItem {
  id: string;
  description_snapshot: string;
  item_note?: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  status: string;
  modifiers: { id: string; description: string }[];
}

interface Props {
  items: OrderItem[];
  onRemove: (id: string) => void;
  onUpdateQty: (id: string, qty: number, unit_price: number) => void;
  disabled?: boolean;
}

const OrderItemsList = ({ items, onRemove, onUpdateQty, disabled }: Props) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">Orden vacia</p>
        <p className="text-xs mt-1">Selecciona productos del menu</p>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.total, 0);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const isPending = item.status === "DRAFT";
        const itemDisabled = disabled || !isPending;

        return (
          <div
            key={item.id}
            className={cn(
              "flex items-start gap-2 rounded-xl border p-2.5 transition-all",
              isPending
                ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
                : "border-border bg-card opacity-60"
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.description_snapshot}
                </p>
                {isPending && (
                  <Badge className="text-[10px] font-medium" variant="secondary">
                    Pendiente
                  </Badge>
                )}
              </div>

              {item.modifiers.length > 0 && (
                <div className="mt-1 space-y-0.5 text-xs text-red-600">
                  {item.modifiers.filter((modifier) => String(modifier.description ?? "").trim().length > 0).map((modifier) => (
                    <p key={modifier.id}>- {modifier.description}</p>
                  ))}
                </div>
              )}

              {item.item_note && (
                <p className="mt-1 text-xs italic text-muted-foreground">Nota: {item.item_note}</p>
              )}

              <p className="mt-1 text-xs text-muted-foreground">
                ${item.unit_price} x {item.quantity} = <span className="font-semibold text-foreground">${item.total.toFixed(2)}</span>
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-9 sm:w-9"
                disabled={itemDisabled}
                onClick={() => {
                  if (item.quantity <= 1) {
                    onRemove(item.id);
                  } else {
                    onUpdateQty(item.id, item.quantity - 1, item.unit_price);
                  }
                }}
              >
                {item.quantity <= 1 ? <Trash2 className="h-3.5 w-3.5 text-destructive sm:h-4 sm:w-4" /> : <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
              </Button>
              
              <QuantityInput
                initialQuantity={item.quantity}
                disabled={itemDisabled}
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
                className="h-7 w-7 sm:h-9 sm:w-9"
                disabled={itemDisabled}
                onClick={() => onUpdateQty(item.id, item.quantity + 1, item.unit_price)}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
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
  disabled,
  onUpdate,
}: {
  initialQuantity: number;
  disabled?: boolean;
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
      setValue(parsed.toString());
      onUpdate(parsed);
    }
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      className="h-7 w-12 text-center text-sm font-bold px-1 sm:h-9 sm:w-14 sm:text-base [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        setIsEditing(true);
        setValue(e.target.value);
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
