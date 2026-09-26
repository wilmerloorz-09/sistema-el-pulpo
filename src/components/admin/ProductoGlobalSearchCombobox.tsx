import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ProductoGlobalOption = {
  id: string;
  nombre_principal: string;
  codigo: string | null;
  stock?: number;
};

type ProductoGlobalSearchComboboxProps = {
  productos: ProductoGlobalOption[];
  value: string;
  usedIds?: Set<string>;
  onChange: (productoGlobalId: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  showStock?: boolean;
};

const ProductoGlobalSearchCombobox = ({
  productos,
  value,
  usedIds,
  onChange,
  placeholder = "Seleccionar producto general",
  searchPlaceholder = "Escribir para buscar producto...",
  showStock = false,
}: ProductoGlobalSearchComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const selected = productos.find((p) => p.id === value) ?? null;
  const label = selected
    ? `${selected.nombre_principal}${selected.codigo ? ` · ${selected.codigo}` : ""}${
        showStock && selected.stock != null ? ` · Stock ${Number(selected.stock)}` : ""
      }`
    : placeholder;

  const q = busqueda.trim().toLowerCase();
  const filtrados = !q
    ? productos
    : productos.filter((p) =>
        p.nombre_principal.toLowerCase().includes(q)
        || (p.codigo ?? "").toLowerCase().includes(q),
      );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setBusqueda("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between rounded-xl px-3 font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] rounded-xl p-2"
        align="start"
      >
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 rounded-lg pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No se encontró el producto.
            </p>
          ) : (
            filtrados.map((p) => {
              const usedElsewhere = Boolean(usedIds?.has(p.id) && p.id !== value);
              const stock = Number(p.stock ?? 0);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={usedElsewhere}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted/70",
                    value === p.id && "bg-muted",
                    usedElsewhere && "cursor-not-allowed opacity-40",
                  )}
                  onClick={() => {
                    if (usedElsewhere) return;
                    onChange(p.id);
                    setOpen(false);
                    setBusqueda("");
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === p.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {p.nombre_principal}
                    {p.codigo ? ` · ${p.codigo}` : ""}
                  </span>
                  {showStock ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      Stock {stock}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ProductoGlobalSearchCombobox;
