import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Minus, Plus } from "lucide-react";

interface Modifier {
  id: string;
  description: string;
}

interface Product {
  id: string;
  description: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
}

interface Props {
  product: Product | null;
  modifiers: Modifier[];
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    product_id: string;
    description_snapshot: string;
    unit_price: number;
    quantity: number;
    modifier_ids: string[];
    item_note?: string | null;
  }) => void;
  adding?: boolean;
}

const AddItemDialog = ({ product, modifiers, open, onClose, onConfirm, adding }: Props) => {
  const [quantity, setQuantity] = useState(1);
  const [manualPrice, setManualPrice] = useState("");
  const [selectedMods, setSelectedMods] = useState<string[]>([]);

  const sortedModifiers = useMemo(
    () => [...modifiers].sort((a, b) => a.description.localeCompare(b.description)),
    [modifiers],
  );

  if (!product) return null;

  const isManual = product.price_mode === "MANUAL";
  const price = isManual ? parseFloat(manualPrice) || 0 : (product.unit_price ?? 0);

  const handleConfirm = () => {
    if (isManual && price <= 0) return;

    onConfirm({
      product_id: product.id,
      description_snapshot: product.description,
      unit_price: price,
      quantity,
      modifier_ids: selectedMods,
      item_note: null,
    });

    setQuantity(1);
    setManualPrice("");
    setSelectedMods([]);
  };

  const toggleMod = (id: string) => {
    setSelectedMods((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const handleManualQuantityChange = (value: string) => {
    if (!value) {
      setQuantity(1);
      return;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;

    setQuantity(Math.max(1, parsed));
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{product.description}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isManual && (
            <div className="space-y-1.5">
              <Label className="text-sm">Precio</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={manualPrice}
                onChange={(event) => setManualPrice(event.target.value)}
                placeholder="0.00"
                className="h-11 rounded-xl text-lg font-display"
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm">Cantidad</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => handleManualQuantityChange(event.target.value)}
                onBlur={(event) => handleManualQuantityChange(event.target.value)}
                className="h-10 w-20 rounded-xl text-center font-display text-lg font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={() => setQuantity((current) => current + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {sortedModifiers.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-red-600">Modificaciones</Label>
              <div className="grid grid-cols-1 gap-2">
                {sortedModifiers.map((modifier) => (
                  <label
                    key={modifier.id}
                    className="flex items-center gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedMods.includes(modifier.id)}
                      onCheckedChange={() => toggleMod(modifier.id)}
                    />
                    <span className="text-sm text-red-600">{modifier.description}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-sm text-muted-foreground">
              Total: <span className="font-display text-lg font-bold text-foreground">${(price * quantity).toFixed(2)}</span>
            </span>
            <Button onClick={handleConfirm} disabled={adding || (isManual && price <= 0)} className="rounded-xl font-display">
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddItemDialog;
