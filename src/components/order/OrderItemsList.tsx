import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
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
                className="h-7 w-7"
                disabled={itemDisabled}
                onClick={() => {
                  if (item.quantity <= 1) {
                    onRemove(item.id);
                  } else {
                    onUpdateQty(item.id, item.quantity - 1, item.unit_price);
                  }
                }}
              >
                {item.quantity <= 1 ? <Trash2 className="h-3.5 w-3.5 text-destructive" /> : <Minus className="h-3.5 w-3.5" />}
              </Button>
              <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={itemDisabled}
                onClick={() => onUpdateQty(item.id, item.quantity + 1, item.unit_price)}
              >
                <Plus className="h-3.5 w-3.5" />
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

export default OrderItemsList;

