import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2 } from "lucide-react";

interface OrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
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
        <p className="text-sm">Orden vacía</p>
        <p className="text-xs mt-1">Selecciona productos del menú</p>
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.total, 0);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {item.description_snapshot}
            </p>
            <p className="text-xs text-muted-foreground">
              ${item.unit_price} × {item.quantity} = <span className="font-semibold text-foreground">${item.total.toFixed(2)}</span>
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={disabled}
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
              disabled={disabled}
              onClick={() => onUpdateQty(item.id, item.quantity + 1, item.unit_price)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {/* Total */}
      <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
        <span className="text-sm font-medium text-muted-foreground">Total</span>
        <span className="font-display text-xl font-bold text-foreground">${total.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default OrderItemsList;
