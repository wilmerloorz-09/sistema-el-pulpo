import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canOperate } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type StockRow = {
  producto_id: string;
  codigo: string;
  nombre: string;
  cantidad_lb: number;
};

type TipoMov = "INGRESO" | "SALIDA" | "AJUSTE";

function formatLb(value: number): string {
  return value.toLocaleString("es-EC", { maximumFractionDigits: 3 });
}

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

const AjustePescadoFrescoAdmin = () => {
  const { isGlobalAdmin, permissions } = useBranch();
  const canAjustar =
    isGlobalAdmin
    || canOperate(permissions, "gestion_pescado")
    || canOperate(permissions, "bodega_general");
  const qc = useQueryClient();

  const [selected, setSelected] = useState<StockRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoMov>("AJUSTE");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stockQuery = useQuery({
    queryKey: ["stock-pescado-fresco"],
    queryFn: async (): Promise<StockRow[]> => {
      const { data, error: qError } = await supabase.rpc("listar_stock_pescado_fresco" as any);
      if (qError) throw qError;
      return ((data as StockRow[]) ?? []).map((r) => ({
        ...r,
        cantidad_lb: Number(r.cantidad_lb ?? 0),
      }));
    },
  });

  useEffect(() => {
    if (!dialogOpen) return;
    setTipo("AJUSTE");
    setCantidad("");
    setMotivo("");
    setError(null);
  }, [dialogOpen, selected?.producto_id]);

  const cantidadNum = parseLb(cantidad);
  const cantidadNueva = useMemo(() => {
    if (!selected) return 0;
    if (tipo === "INGRESO") return selected.cantidad_lb + cantidadNum;
    if (tipo === "SALIDA") return Math.max(0, selected.cantidad_lb - cantidadNum);
    return cantidadNum;
  }, [selected, tipo, cantidadNum]);

  const cantidadLabel =
    tipo === "AJUSTE" ? "Cantidad final (lb)" : tipo === "SALIDA" ? "Cantidad a retirar (lb)" : "Cantidad a ingresar (lb)";

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecciona un producto");
      if (!canAjustar) throw new Error("No tienes permiso para ajustar");
      if (tipo !== "AJUSTE" && cantidadNum <= 0) throw new Error("La cantidad debe ser mayor a 0");
      if (tipo === "AJUSTE" && cantidadNum < 0) throw new Error("La cantidad no puede ser negativa");
      if (tipo === "SALIDA" && cantidadNum > selected.cantidad_lb) {
        throw new Error(`Stock insuficiente: hay ${formatLb(selected.cantidad_lb)} lb`);
      }
      if (tipo !== "INGRESO" && !motivo.trim()) {
        throw new Error("El motivo es obligatorio");
      }

      const { error: rpcError } = await supabase.rpc("registrar_movimiento_pescado_fresco" as any, {
        p_producto_id: selected.producto_id,
        p_tipo_movimiento: tipo,
        p_cantidad_lb: cantidadNum,
        p_motivo: motivo.trim() || null,
      } as any);
      if (rpcError) throw rpcError;
    },
    onSuccess: async () => {
      toast.success("Movimiento registrado");
      setDialogOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["stock-pescado-fresco"] }),
        qc.invalidateQueries({ queryKey: ["historial-pescado-fresco"] }),
      ]);
    },
    onError: (err: Error) => {
      setError(err.message || "No se pudo registrar el movimiento");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-200 bg-white text-amber-700 shadow-sm">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Ajuste de cantidades</h2>
          <p className="text-xs text-muted-foreground">
            Corrige el stock de pescado fresco (ingreso, salida o cantidad final)
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60">
        {stockQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : stockQuery.isError ? (
          <div className="p-4 text-sm text-destructive">
            {(stockQuery.error as Error)?.message || "No se pudo cargar el stock"}
          </div>
        ) : (stockQuery.data ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No hay productos de pescado fresco configurados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Stock (lb)</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(stockQuery.data ?? []).map((row) => (
                  <tr key={row.producto_id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{row.nombre}</p>
                      <p className="text-[11px] text-muted-foreground">{row.codigo}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {formatLb(row.cantidad_lb)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-lg text-[10px] font-bold",
                          row.cantidad_lb > 0
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-50 text-slate-600",
                        )}
                      >
                        {row.cantidad_lb > 0 ? "Con stock" : "Sin stock"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl"
                        disabled={!canAjustar}
                        onClick={() => {
                          setSelected(row);
                          setDialogOpen(true);
                        }}
                      >
                        Ajustar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!canAjustar ? (
        <p className="text-xs text-muted-foreground">Solo lectura: no puedes registrar ajustes.</p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-[24px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar · {selected?.nombre ?? "Producto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Stock actual:{" "}
              <span className="font-semibold text-foreground">
                {formatLb(selected?.cantidad_lb ?? 0)} lb
              </span>
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de movimiento</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMov)}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="AJUSTE">Ajuste (cantidad final)</SelectItem>
                  <SelectItem value="INGRESO">Ingreso</SelectItem>
                  <SelectItem value="SALIDA">Salida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{cantidadLabel}</Label>
              <Input
                value={cantidad}
                onChange={(e) => setCantidad(soloCantidadLb(e.target.value))}
                className="h-10 rounded-xl tabular-nums"
                inputMode="decimal"
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">
                Quedará en {formatLb(cantidadNueva)} lb
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Motivo {tipo === "INGRESO" ? "(opcional)" : "*"}
              </Label>
              <Textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="min-h-[72px] rounded-xl"
                placeholder="Ej. Corrección de inventario"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={saveMutation.isPending}
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
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
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AjustePescadoFrescoAdmin;
