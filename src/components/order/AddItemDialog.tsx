import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  }) => void;
  adding?: boolean;
}

const AddItemDialog = ({ product, modifiers, open, onClose, onConfirm, adding }: Props) => {
  const [quantity, setQuantity] = useState(1);
  const [manualPrice, setManualPrice] = useState("");
  const [selectedMods, setSelectedMods] = useState<string[]>([]);

  if (!product) return null;

  const isManual = product.price_mode === "MANUAL";
  const price = isManual ? parseFloat(manualPrice) || 0 : (product.unit_price ?? 0);

  const handleConfirm = () => {
    if (isManual && price <= 0) return;

    const modDescriptions = selectedMods
      .map((id) => modifiers.find((m) => m.id === id)?.description)
      .filter(Boolean);

    const desc = modDescriptions.length > 0
      ? `${product.description} (${modDescriptions.join(", ")})`
      : product.description;

    onConfirm({
      product_id: product.id,
      description_snapshot: desc,
      unit_price: price,
      quantity,
      modifier_ids: selectedMods,
    });

    // Reset
    setQuantity(1);
    setManualPrice("");
    setSelectedMods([]);
  };

  const toggleMod = (id: string) => {
    setSelectedMods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{product.description}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Manual price */}
          {isManual && (
            <div className="space-y-1.5">
              <Label className="text-sm">Precio</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="0.00"
                className="h-11 rounded-xl text-lg font-display"
                autoFocus
              />
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label className="text-sm">Cantidad</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="font-display text-xl font-bold w-10 text-center">{quantity}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Modifiers */}
          {modifiers.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">Modificadores</Label>
              <div className="grid grid-cols-2 gap-2">
                {modifiers.map((mod) => (
                  <label
                    key={mod.id}
                    className="flex items-center gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedMods.includes(mod.id)}
                      onCheckedChange={() => toggleMod(mod.id)}
                    />
                    <span className="text-xs font-medium">{mod.description}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Total & Confirm */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Total: <span className="font-display font-bold text-foreground text-lg">${(price * quantity).toFixed(2)}</span>
            </span>
            <Button
              onClick={handleConfirm}
              disabled={adding || (isManual && price <= 0)}
              className="rounded-xl font-display"
            >
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddItemDialog;
