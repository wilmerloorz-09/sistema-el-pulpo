import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { normalizarCantidadInventario } from "@/lib/inventarioProductos";
import { cn } from "@/lib/utils";

type ProveedorOption = {
  id: string;
  nombre: string;
  ruc_cedula: string;
};

type ProductoOption = {
  id: string;
  nombre_principal: string;
  codigo: string | null;
};

type LineaCompra = {
  key: string;
  productoGlobalId: string;
  cantidad: string;
  precioUnitario: string;
};

type ProductoSearchComboboxProps = {
  productos: ProductoOption[];
  value: string;
  usedIds: Set<string>;
  onChange: (productoGlobalId: string) => void;
};

const ProductoSearchCombobox = ({
  productos,
  value,
  usedIds,
  onChange,
}: ProductoSearchComboboxProps) => {
  const [open, setOpen] = useState(false);
  const selected = productos.find((p) => p.id === value) ?? null;
  const label = selected
    ? `${selected.nombre_principal}${selected.codigo ? ` · ${selected.codigo}` : ""}`
    : "Seleccionar producto general";

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        className="w-[var(--radix-popover-trigger-width)] rounded-xl p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            const q = search.trim().toLowerCase();
            if (!q) return 1;
            return itemValue.toLowerCase().includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Escribir para buscar producto..." />
          <CommandList>
            <CommandEmpty>No se encontró el producto.</CommandEmpty>
            <CommandGroup>
              {productos.map((p) => {
                const usedElsewhere = usedIds.has(p.id) && p.id !== value;
                const searchValue = `${p.nombre_principal} ${p.codigo ?? ""}`;
                return (
                  <CommandItem
                    key={p.id}
                    value={searchValue}
                    disabled={usedElsewhere}
                    onSelect={() => {
                      if (usedElsewhere) return;
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">
                      {p.nombre_principal}
                      {p.codigo ? ` · ${p.codigo}` : ""}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const todayLocal = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const newLinea = (): LineaCompra => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productoGlobalId: "",
  cantidad: "",
  precioUnitario: "",
});

const CompraBodegaGeneralAdmin = () => {
  const { isGlobalAdmin, permissions } = useBranch();
  const canRegistrar = isGlobalAdmin || canOperate(permissions, "bodega_general");
  const qc = useQueryClient();

  const [proveedorId, setProveedorId] = useState("");
  const [numeroComprobante, setNumeroComprobante] = useState("");
  const [fechaCompra, setFechaCompra] = useState(todayLocal());
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([newLinea()]);
  const [error, setError] = useState<string | null>(null);

  const proveedoresQuery = useQuery({
    queryKey: ["proveedores-bodega-general-activos"],
    queryFn: async (): Promise<ProveedorOption[]> => {
      const { data, error: qError } = await supabase
        .from("proveedores" as any)
        .select("id, nombre, ruc_cedula")
        .eq("activo", true)
        .order("nombre");
      if (qError) throw qError;
      return (data as ProveedorOption[]) ?? [];
    },
  });

  const productosQuery = useQuery({
    queryKey: ["productos-globales-compra"],
    queryFn: async (): Promise<ProductoOption[]> => {
      const { data, error: qError } = await supabase
        .from("productos_globales" as any)
        .select("id, nombre_principal, codigo")
        .eq("activo", true)
        .order("nombre_principal");
      if (qError) throw qError;
      return (data as ProductoOption[]) ?? [];
    },
  });

  const total = useMemo(() => {
    return lineas.reduce((acc, linea) => {
      const cantidad = normalizarCantidadInventario(linea.cantidad);
      const precio = Number(String(linea.precioUnitario).replace(",", ".")) || 0;
      return acc + cantidad * Math.max(0, precio);
    }, 0);
  }, [lineas]);

  const productosUsados = useMemo(
    () => new Set(lineas.map((l) => l.productoGlobalId).filter(Boolean)),
    [lineas],
  );

  const resetForm = () => {
    setProveedorId("");
    setNumeroComprobante("");
    setFechaCompra(todayLocal());
    setObservaciones("");
    setLineas([newLinea()]);
    setError(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canRegistrar) throw new Error("No tienes permiso para registrar compras");
      if (!proveedorId) throw new Error("Selecciona un proveedor");
      if (!numeroComprobante.trim()) throw new Error("Ingresa el número de comprobante/factura");
      if (!fechaCompra) throw new Error("Ingresa la fecha de compra");

      const detalle = lineas
        .map((linea) => ({
          producto_global_id: linea.productoGlobalId,
          cantidad: normalizarCantidadInventario(linea.cantidad),
          precio_unitario: Number(String(linea.precioUnitario).replace(",", ".")) || 0,
        }))
        .filter((row) => row.producto_global_id);

      if (detalle.length === 0) throw new Error("Agrega al menos un producto");
      if (detalle.some((row) => row.cantidad <= 0)) {
        throw new Error("Cada producto debe tener cantidad mayor a 0");
      }
      if (detalle.some((row) => row.precio_unitario < 0)) {
        throw new Error("El precio unitario no puede ser negativo");
      }

      const ids = detalle.map((d) => d.producto_global_id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("No puedes repetir el mismo producto en la compra");
      }

      const { data, error: rpcError } = await supabase.rpc("registrar_compra_bodega_general" as any, {
        p_proveedor_id: proveedorId,
        p_numero_comprobante: numeroComprobante.trim(),
        p_fecha_compra: fechaCompra,
        p_detalle: detalle,
        p_observaciones: observaciones.trim() || null,
      } as any);

      if (rpcError) throw rpcError;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Compra registrada e inventarios actualizados");
      resetForm();
      void qc.invalidateQueries({ queryKey: ["historial-bodega-general"] });
      void qc.invalidateQueries({ queryKey: ["inventario-bodega-general-map"] });
      void qc.invalidateQueries({ queryKey: ["admin-movimientos-bodega-general"] });
    },
    onError: (err: Error) => {
      setError(err.message || "No se pudo registrar la compra");
      toast.error(err.message || "No se pudo registrar la compra");
    },
  });

  if (!canRegistrar) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Solo lectura: no tienes permiso para registrar compras.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Compra</h2>
          <p className="text-xs text-muted-foreground">
            Registra factura/comprobante e ingresa productos a bodega general
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/80 bg-card/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Encabezado</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Proveedor *</Label>
            <Select value={proveedorId || undefined} onValueChange={setProveedorId}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder="Seleccionar proveedor" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {(proveedoresQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre} · {p.ruc_cedula}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Nº comprobante / factura *</Label>
            <Input
              value={numeroComprobante}
              onChange={(e) => setNumeroComprobante(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="Ej. 001-001-0001234"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Fecha de compra *</Label>
            <Input
              type="date"
              value={fechaCompra}
              onChange={(e) => setFechaCompra(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Observaciones</Label>
            <Textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="min-h-[72px] rounded-xl"
              placeholder="Opcional"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Detalle</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-xl"
            onClick={() => setLineas((prev) => [...prev, newLinea()])}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar producto
          </Button>
        </div>

        <div className="space-y-3">
          {lineas.map((linea, index) => {
            const cantidad = normalizarCantidadInventario(linea.cantidad);
            const precio = Number(String(linea.precioUnitario).replace(",", ".")) || 0;
            const subtotal = cantidad * Math.max(0, precio);

            return (
              <div
                key={linea.key}
                className="grid gap-2 rounded-xl border border-border/70 bg-muted/10 p-3 sm:grid-cols-[minmax(0,1.4fr)_6.5rem_7rem_7rem_auto]"
              >
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    Producto {index + 1}
                  </Label>
                  <ProductoSearchCombobox
                    productos={productosQuery.data ?? []}
                    value={linea.productoGlobalId}
                    usedIds={productosUsados}
                    onChange={(productoGlobalId) =>
                      setLineas((prev) =>
                        prev.map((row) =>
                          row.key === linea.key ? { ...row, productoGlobalId } : row,
                        ),
                      )
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">Cantidad</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    inputMode="decimal"
                    value={linea.cantidad}
                    onChange={(e) =>
                      setLineas((prev) =>
                        prev.map((row) =>
                          row.key === linea.key ? { ...row, cantidad: e.target.value } : row,
                        ),
                      )
                    }
                    className="h-10 rounded-xl tabular-nums"
                    placeholder="0"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">P. unitario</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    inputMode="decimal"
                    value={linea.precioUnitario}
                    onChange={(e) =>
                      setLineas((prev) =>
                        prev.map((row) =>
                          row.key === linea.key ? { ...row, precioUnitario: e.target.value } : row,
                        ),
                      )
                    }
                    className="h-10 rounded-xl tabular-nums"
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">Subtotal</Label>
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={`$${subtotal.toFixed(2)}`}
                    className="h-10 rounded-xl bg-muted/40 tabular-nums text-foreground"
                  />
                </div>

                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 rounded-xl text-destructive"
                    disabled={lineas.length <= 1}
                    onClick={() => setLineas((prev) => prev.filter((row) => row.key !== linea.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 text-sm text-teal-900">
          <span className="font-semibold">Total compra</span>
          <span className="font-bold tabular-nums">${total.toFixed(2)}</span>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={saveMutation.isPending}
          onClick={resetForm}
        >
          Limpiar
        </Button>
        <Button
          type="button"
          className="rounded-xl"
          disabled={saveMutation.isPending}
          onClick={() => {
            setError(null);
            saveMutation.mutate();
          }}
        >
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Registrar compra
        </Button>
      </div>
    </div>
  );
};

export default CompraBodegaGeneralAdmin;
