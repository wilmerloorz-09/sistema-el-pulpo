import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageIcon, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { parseDecimalInput, parseIntegerInput, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/numericInput";
import { cn } from "@/lib/utils";

interface Modifier {
  id: string;
  description: string;
}

interface Product {
  id: string;
  description: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  icon?: string | null;
  image_url?: string | null;
}

/** Vista previa instantánea desde el nodo de menú mientras se resuelve el catálogo en red */
export interface AddItemResolvingShell {
  description: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  icon?: string | null;
  image_url?: string | null;
}

interface Props {
  product: Product | null;
  /** Datos del menú ya en memoria: permite abrir el modal de inmediato */
  resolvingShell?: AddItemResolvingShell | null;
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
  priceModeOverride?: "FIXED" | "MANUAL";
  manualPriceLabel?: string;
  isSpecial?: boolean;
  confirmLabel?: string;
  hideQuantity?: boolean;
  extraContent?: ReactNode | ((context: { unitPrice: number; quantity: number; isManual: boolean }) => ReactNode);
  buildItemNote?: (context: { unitPrice: number; quantity: number; isManual: boolean }) => string | null;
}

const AddItemDialog = ({
  product,
  resolvingShell = null,
  modifiers,
  open,
  onClose,
  onConfirm,
  adding,
  priceModeOverride,
  manualPriceLabel = "Precio",
  confirmLabel = "Agregar",
  hideQuantity = false,
  extraContent,
  buildItemNote,
  isSpecial = false,
}: Props) => {
  const isResolving = Boolean(resolvingShell && !product);
  const displayProduct: Product | null =
    product ??
    (resolvingShell
      ? {
          id: "__resolving__",
          description: resolvingShell.description,
          unit_price: resolvingShell.unit_price,
          price_mode: resolvingShell.price_mode,
          icon: resolvingShell.icon,
          image_url: resolvingShell.image_url,
        }
      : null);

  const [quantity, setQuantity] = useState(1);
  const [quantityInput, setQuantityInput] = useState("1");
  const [manualPrice, setManualPrice] = useState("");
  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  /** Orden especial: precio bloqueado al catálogo hasta pulsar Editar */
  const [specialPriceEditing, setSpecialPriceEditing] = useState(false);
  const specialPriceInputRef = useRef<HTMLInputElement>(null);

  const dialogOpen = Boolean(open && displayProduct);

  useEffect(() => {
    if (dialogOpen) {
      setQuantity(1);
      setQuantityInput("1");
      setSpecialPriceEditing(false);
      setManualPrice(
        displayProduct?.unit_price != null ? String(displayProduct.unit_price) : "",
      );
      setSelectedMods([]);
    }
  }, [dialogOpen, product?.id, displayProduct?.unit_price, isSpecial]);

  const sortedModifiers = useMemo(
    () => [...modifiers].sort((a, b) => a.description.localeCompare(b.description)),
    [modifiers],
  );

  const isManual =
    displayProduct != null ? (priceModeOverride ?? displayProduct.price_mode) === "MANUAL" : false;
  const catalogUnitPrice = displayProduct?.unit_price ?? 0;
  const price =
    displayProduct != null
      ? isManual
        ? isSpecial && !specialPriceEditing
          ? catalogUnitPrice
          : parseDecimalInput(manualPrice)
        : catalogUnitPrice
      : 0;
  const effectiveQuantity = hideQuantity ? 1 : quantity;
  const canAdd =
    Boolean(product) &&
    displayProduct != null &&
    effectiveQuantity > 0 &&
    (!isManual ||
      (isSpecial && !specialPriceEditing ? catalogUnitPrice > 0 : price > 0));
  const dialogContext = { unitPrice: price, quantity: effectiveQuantity, isManual };

  const handleConfirm = () => {
    if (!product || !displayProduct || !canAdd) return;

    onConfirm({
      product_id: product.id,
      description_snapshot: product.description,
      unit_price: price,
      quantity: effectiveQuantity,
      modifier_ids: selectedMods,
      item_note: buildItemNote?.(dialogContext) ?? null,
    });

    setQuantity(1);
    setQuantityInput("1");
    setManualPrice("");
    setSpecialPriceEditing(false);
    setSelectedMods([]);
  };

  const handleStartSpecialPriceEdit = () => {
    setSpecialPriceEditing(true);
    setManualPrice("");
    requestAnimationFrame(() => specialPriceInputRef.current?.focus());
  };

  const toggleMod = (id: string) => {
    setSelectedMods((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const handleManualQuantityChange = (value: string) => {
    const sanitizedValue = sanitizeIntegerInput(value);
    setQuantityInput(sanitizedValue);

    if (!sanitizedValue) {
      setQuantity(0);
      return;
    }

    const parsed = parseIntegerInput(sanitizedValue);
    if (Number.isNaN(parsed)) {
      setQuantity(0);
      return;
    }

    setQuantity(Math.max(0, parsed));
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={(value) => !value && onClose()}>
      {displayProduct ? (
      <DialogContent className="max-w-sm rounded-[24px] p-5 shadow-xl sm:rounded-[28px] border-orange-200/40 bg-background">
        <DialogHeader className="mb-1 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-100 text-primary shadow-sm">
              {displayProduct.image_url ? (
                <img src={displayProduct.image_url} alt={displayProduct.description} className="h-full w-full object-cover" />
              ) : displayProduct.icon ? (
                <span className="text-[1.5rem] leading-none">{displayProduct.icon}</span>
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-xl font-bold leading-tight text-foreground">
                {displayProduct.description}
              </DialogTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-800">
                  Precio unitario
                </span>
                <span className="font-display text-lg font-black text-foreground">
                  {`$${(displayProduct.unit_price ?? 0).toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {isManual && (
            <div className="space-y-1.5 mt-2">
              <Label className="text-sm font-semibold text-muted-foreground">{manualPriceLabel}</Label>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    ref={isSpecial ? specialPriceInputRef : undefined}
                    type="text"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={
                      isSpecial && !specialPriceEditing
                        ? catalogUnitPrice > 0
                          ? catalogUnitPrice.toFixed(2)
                          : ""
                        : manualPrice
                    }
                    onChange={(event) => setManualPrice(sanitizeDecimalInput(event.target.value))}
                    placeholder={isSpecial && specialPriceEditing ? "" : "0.00"}
                    disabled={isSpecial && !specialPriceEditing}
                    className={cn(
                      "h-11 rounded-xl pl-8 text-lg font-bold shadow-sm",
                      isSpecial && !specialPriceEditing && "cursor-default bg-muted/40 text-foreground opacity-100",
                    )}
                    autoFocus={!isSpecial}
                  />
                </div>
                {isSpecial && !specialPriceEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 rounded-xl px-4 font-semibold"
                    onClick={handleStartSpecialPriceEdit}
                  >
                    Editar
                  </Button>
                )}
              </div>
            </div>
          )}

          {typeof extraContent === "function" ? extraContent(dialogContext) : extraContent}

          {!hideQuantity && (
            <div className="space-y-1.5 mt-2">
              <Label className="text-sm font-semibold text-muted-foreground">Cantidad</Label>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-xl shadow-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    const nextQuantity = Math.max(0, quantity - 1);
                    setQuantity(nextQuantity);
                    setQuantityInput(String(nextQuantity));
                  }}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="text"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantityInput}
                  onChange={(event) => handleManualQuantityChange(event.target.value)}
                  className="h-11 w-20 rounded-xl text-center font-display text-xl font-bold shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-xl shadow-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    const nextQuantity = quantity + 1;
                    setQuantity(nextQuantity);
                    setQuantityInput(String(nextQuantity));
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {sortedModifiers.length > 0 && (
            <div className="space-y-2.5">
              <Label className="text-sm font-semibold text-orange-600">Modificaciones</Label>
              <div className="grid max-h-[35vh] grid-cols-2 gap-x-2 gap-y-1.5 overflow-y-auto pr-1">
                {sortedModifiers.map((modifier) => {
                  const isChecked = selectedMods.includes(modifier.id);
                  return (
                    <label
                      key={modifier.id}
                      className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-2 rounded-[14px] border p-2 transition-all",
                        isChecked
                          ? "border-orange-200 bg-orange-50 shadow-sm"
                          : "border-border/60 bg-white/60 hover:border-orange-100 hover:bg-white",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleMod(modifier.id)}
                        className={cn(
                          "h-4 w-4 rounded-[4px] border-orange-300",
                          isChecked && "data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500",
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12px] font-medium leading-tight",
                          isChecked ? "text-orange-900" : "text-muted-foreground",
                        )}
                      >
                        {modifier.description}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-4">
            <span className="flex flex-col text-[13px] font-medium text-muted-foreground">
              Total
              <span className="font-display text-2xl font-black text-foreground">${(price * effectiveQuantity).toFixed(2)}</span>
            </span>
            <Button
              onClick={handleConfirm}
              disabled={adding || !canAdd || isResolving}
              className="flex h-11 items-center gap-1.5 rounded-xl px-5 font-bold shadow-sm"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingBag className="h-4 w-4" />
              )}
              {adding ? "Agregando..." : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
      ) : null}
    </Dialog>
  );
};

export default AddItemDialog;
