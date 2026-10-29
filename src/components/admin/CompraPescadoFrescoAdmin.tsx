import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
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

type ProveedorOption = {
  id: string;
  nombre: string;
  ruc_cedula: string;
};

type ProductoOption = {
  id: string;
  nombre: string;
  codigo: string;
};

type LineaCompra = {
  key: string;
  productoId: string;
  cantidadLb: string;
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
  productoId: "",
  cantidadLb: "",
});

function parseLb(raw: string): number {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function soloCantidadLb(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const sep = cleaned.includes(",") ? "," : cleaned.includes(".") ? "." : null;
  if (!sep) return cleaned.replace(/\D/g, "");
  const [intPart, ...rest] = cleaned.split(sep);
  const decimals = rest.join("").replace(/\D/g, "").slice(0, 3);
  return `${intPart.replace(/\D/g, "")}${sep}${decimals}`;
}

const CompraPescadoFrescoAdmin = () => {
  const { isGlobalAdmin, permissions } = useBranch();
  const canRegistrar =
    isGlobalAdmin
    || canOperate(permissions, "gestion_pescado")
    || canOperate(permissions, "bodega_general");
  const qc = useQueryClient();

  const [proveedorId, setProveedorId] = useState("");
  const [numeroComprobante, setNumeroComprobante] = useState("");
  const [fechaCompra, setFechaCompra] = useState(todayLocal());
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([newLinea()]);
  const [error, setError] = useState<string | null>(null);

  const proveedoresQuery = useQuery({
    queryKey: ["proveedores-pescado-fresco-activos"],
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
    queryKey: ["pescado-fresco-productos"],
    queryFn: async (): Promise<ProductoOption[]> => {
      const { data, error: qError } = await supabase
        .from("pescado_fresco_productos" as any)
        .select("id, nombre, codigo")
        .eq("activo", true)
        .order("nombre");
      if (qError) throw qError;
      return (data as ProductoOption[]) ?? [];
    },
  });

  const productosUsados = useMemo(
    () => new Set(lineas.map((l) => l.productoId).filter(Boolean)),
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
          producto_id: linea.productoId,
          cantidad_lb: parseLb(linea.cantidadLb),
        }))
        .filter((row) => row.producto_id);

      if (detalle.length === 0) throw new Error("Agrega al menos un producto");
      if (detalle.some((row) => row.cantidad_lb <= 0)) {
        throw new Error("Cada producto debe tener cantidad (lb) mayor a 0");
      }

      const ids = detalle.map((d) => d.producto_id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("No puedes repetir el mismo producto en la compra");
      }

      const { data, error: rpcError } = await supabase.rpc("registrar_compra_pescado_fresco" as any, {
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
      toast.success("Compra de pescado fresco registrada");
      resetForm();
      void qc.invalidateQueries({ queryKey: ["historial-pescado-fresco"] });
      void qc.invalidateQueries({ queryKey: ["stock-pescado-fresco"] });
    },
    onError: (err: Error) => {
      setError(err.message || "No se pudo registrar la compra");
      toast.error(err.message || "No se pudo registrar la compra");
    },
  });

  if (!canRegistrar) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Solo lectura: no tienes permiso para registrar compras de pescado fresco.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200 bg-white text-cyan-700 shadow-sm">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Compra</h2>
          <p className="text-xs text-muted-foreground">
            Registra factura/comprobante e ingresa pescado fresco (libras)
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
          {lineas.map((linea, index) => (
            <div
              key={linea.key}
              className="grid gap-2 rounded-xl border border-border/70 bg-muted/10 p-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]"
            >
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Producto {index + 1}
                </Label>
                <Select
                  value={linea.productoId || undefined}
                  onValueChange={(productoId) =>
                    setLineas((prev) =>
                      prev.map((row) => (row.key === linea.key ? { ...row, productoId } : row)),
                    )
                  }
                >
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {(productosQuery.data ?? []).map((p) => {
                      const usedElsewhere = productosUsados.has(p.id) && p.id !== linea.productoId;
                      return (
                        <SelectItem key={p.id} value={p.id} disabled={usedElsewhere}>
                          {p.nombre}
                          {p.codigo ? ` · ${p.codigo}` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">Cantidad (lb)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={linea.cantidadLb}
                  onChange={(e) =>
                    setLineas((prev) =>
                      prev.map((row) =>
                        row.key === linea.key
                          ? { ...row, cantidadLb: soloCantidadLb(e.target.value) }
                          : row,
                      ),
                    )
                  }
                  className="h-10 rounded-xl tabular-nums"
                  placeholder="0"
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
          ))}
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

export default CompraPescadoFrescoAdmin;
