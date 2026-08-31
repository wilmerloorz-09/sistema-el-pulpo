import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ImageIcon, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
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
  /** Si el producto aun se reconcilia en red, espera antes de confirmar el id real */
  ensureProduct?: () => Promise<Product | null>;
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
  /**
   * Si el producto integra con inventario en la sucursal, tope de cantidad (= stock).
   * null/undefined = sin control de inventario en este diálogo.
   */
  maxStock?: number | null;
  extraContent?: ReactNode | ((context: { unitPrice: number; quantity: number; isManual: boolean }) => ReactNode);
  buildItemNote?: (context: { unitPrice: number; quantity: number; isManual: boolean }) => string | null;
}

function formatStockLabel(stock: number): string {
  const n = Math.round(Number(stock) * 1000) / 1000;
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function maxQtyFromStock(stock: number): number {
  const n = Number(stock);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

const AddItemDialog = ({
  product,
  resolvingShell = null,
  ensureProduct,
  modifiers,
  open,
  onClose,
  onConfirm,
  adding,
  priceModeOverride,
  manualPriceLabel = "Precio",
  confirmLabel = "Agregar",
  hideQuantity = false,
  maxStock = null,
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

  const controlsInventory = maxStock != null && Number.isFinite(Number(maxStock));
  const stockCap = controlsInventory ? maxQtyFromStock(Number(maxStock)) : null;

  const [quantity, setQuantity] = useState(1);
  const [quantityInput, setQuantityInput] = useState("1");
  const [manualPrice, setManualPrice] = useState("");
  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  /** Orden especial: precio bloqueado al catálogo hasta pulsar Editar */
  const [specialPriceEditing, setSpecialPriceEditing] = useState(false);
  const [ensuringProduct, setEnsuringProduct] = useState(false);
  const specialPriceInputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef<number>(0);

  const dialogOpen = Boolean(open && displayProduct);

  const applyQuantity = (next: number) => {
    let value = Math.max(0, Math.floor(next));
    if (stockCap != null) {
      value = Math.min(value, stockCap);
    }
    setQuantity(value);
    setQuantityInput(String(value));
  };

  useEffect(() => {
    if (!dialogOpen) return;
    openedAtRef.current = Date.now();
    const initial = stockCap != null ? Math.min(1, stockCap) : 1;
    setQuantity(initial);
    setQuantityInput(String(initial));
    setSpecialPriceEditing(false);
    setEnsuringProduct(false);
    setManualPrice(
      displayProduct?.unit_price != null ? String(displayProduct.unit_price) : "",
    );
    setSelectedMods([]);
  }, [dialogOpen, product?.id, displayProduct?.unit_price, isSpecial]);

  useEffect(() => {
    if (!dialogOpen || stockCap == null) return;
    setQuantity((current) => Math.min(Math.max(0, current), stockCap));
    setQuantityInput((prev) => {
      if (!prev) return prev;
      const parsed = parseIntegerInput(prev);
      if (Number.isNaN(parsed)) return prev;
      return String(Math.min(Math.max(0, parsed), stockCap));
    });
  }, [dialogOpen, stockCap]);

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
  const exceedsStock =
    stockCap != null
    && !hideQuantity
    && (effectiveQuantity > stockCap || stockCap <= 0);
  const canAdd =
    displayProduct != null &&
    (Boolean(product) || Boolean(ensureProduct) || !isResolving) &&
    effectiveQuantity > 0 &&
    !exceedsStock &&
    (!isManual ||
      (isSpecial && !specialPriceEditing ? catalogUnitPrice > 0 : price > 0));
  const dialogContext = { unitPrice: price, quantity: effectiveQuantity, isManual };
  const confirmBusy = Boolean(adding || ensuringProduct);
  const plusDisabled = stockCap != null && quantity >= stockCap;

  const handleConfirm = async () => {
    if (!displayProduct || !canAdd || confirmBusy) return;

    let readyProduct = product;
    if (ensureProduct) {
      setEnsuringProduct(true);
      try {
        readyProduct = await ensureProduct();
      } finally {
        setEnsuringProduct(false);
      }
    }
    if (!readyProduct) {
      return;
    }

    onConfirm({
      product_id: readyProduct.id,
      description_snapshot: readyProduct.description,
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

  const suppressAccidentalDismiss = (event: Event) => {
    // Evita que el mismo tap que abrió el modal lo cierre al soltar sobre el overlay.
    if (Date.now() - openedAtRef.current < 450) {
      event.preventDefault();
    }
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

    let next = Math.max(0, parsed);
    if (stockCap != null) {
      next = Math.min(next, stockCap);
      setQuantityInput(String(next));
    }
    setQuantity(next);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={(value) => !value && onClose()}>
      {displayProduct ? (
      <DialogContent
        className="max-w-sm rounded-[24px] p-5 shadow-xl sm:rounded-[28px] border-orange-200/40 bg-background"
        onPointerDownOutside={suppressAccidentalDismiss}
        onInteractOutside={suppressAccidentalDismiss}
      >
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
                {controlsInventory ? (
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                      stockCap != null && stockCap > 0
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-red-200 bg-red-50 text-red-700",
                    )}
                  >
                    Stock: {formatStockLabel(Number(maxStock))}
                  </span>
                ) : null}
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
                  onClick={() => applyQuantity(quantity - 1)}
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
                  disabled={plusDisabled}
                  className="h-11 w-11 rounded-xl shadow-sm text-foreground hover:bg-muted disabled:opacity-50"
                  onClick={() => applyQuantity(quantity + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {exceedsStock ? (
                <p className="text-xs font-semibold text-red-600">
                  {stockCap != null && stockCap <= 0
                    ? "Sin stock disponible"
                    : `Máximo disponible: ${stockCap}`}
                </p>
              ) : null}
            </div>
          )}

          {sortedModifiers.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-orange-600">Modificaciones</Label>
              <div className="grid max-h-[35vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
                {sortedModifiers.map((modifier) => {
                  const isChecked = selectedMods.includes(modifier.id);
                  return (
                    <button
                      key={modifier.id}
                      type="button"
                      onClick={() => toggleMod(modifier.id)}
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-1 rounded-xl border px-2.5 py-1.5 text-left text-xs font-semibold leading-tight",
                        isChecked
                          ? "border-primary bg-orange-50 text-primary"
                          : "border-orange-100 bg-white text-foreground",
                      )}
                    >
                      <span className="line-clamp-2">{modifier.description}</span>
                      {isChecked ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-2 flex items-end justify-between gap-3 border-t border-border/60 pt-4">
            <span className="flex flex-col text-[13px] font-medium text-muted-foreground">
              Total
              <span className="font-display text-2xl font-black text-foreground">${(price * effectiveQuantity).toFixed(2)}</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={confirmBusy}
                className="h-11 rounded-xl px-4 font-bold shadow-sm"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => void handleConfirm()}
                disabled={confirmBusy || !canAdd}
                className="flex h-11 items-center gap-1.5 rounded-xl px-5 font-bold shadow-sm"
              >
                {confirmBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingBag className="h-4 w-4" />
                )}
                {confirmBusy ? "Agregando..." : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
      ) : null}
    </Dialog>
  );
};

export default AddItemDialog;
