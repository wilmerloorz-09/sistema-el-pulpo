import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CierreCajaConteoTabla from "@/components/caja/CierreCajaConteoTabla";
import {
  aprobarCierreCaja,
  fetchClosedOpeningCount,
  type ClosedOpeningListRow,
} from "@/lib/openingCashReport";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type CierreCajaDialogModo = "ver" | "aprobar";

interface CierreCajaDetalleDialogProps {
  apertura: ClosedOpeningListRow | null;
  modo?: CierreCajaDialogModo;
  onClose: () => void;
}

export default function CierreCajaDetalleDialog({ apertura, modo = "ver", onClose }: CierreCajaDetalleDialogProps) {
  const qc = useQueryClient();
  const aprobando = modo === "aprobar" && apertura?.aprobacion_estado === "PENDIENTE";
  const [borrador, setBorrador] = useState<Record<string, string>>({});

  const conteoQuery = useQuery({
    queryKey: ["cierre-caja-conteo", apertura?.id],
    enabled: Boolean(apertura),
    queryFn: () =>
      fetchClosedOpeningCount({
        openingId: apertura!.id,
        shiftId: apertura!.shift_id,
        cashierId: apertura!.cashier_id,
      }),
  });

  useEffect(() => {
    if (!aprobando || !conteoQuery.data) return;
    setBorrador(Object.fromEntries(conteoQuery.data.map((fila) => [fila.key, String(fila.qtyCounted)])));
  }, [aprobando, conteoQuery.data]);

  const filas = useMemo(() => {
    const base = conteoQuery.data ?? [];
    if (!aprobando) return base;
    return base.map((fila) => {
      const raw = borrador[fila.key] ?? "";
      return { ...fila, qtyCounted: raw === "" ? fila.qtySystem : Number.parseInt(raw, 10) };
    });
  }, [aprobando, borrador, conteoQuery.data]);

  const aprobarMutation = useMutation({
    mutationFn: () =>
      aprobarCierreCaja({
        openingId: apertura!.id,
        counts: filas.map((fila) => ({
          denomination_id: fila.denominationId,
          qty_system: fila.qtySystem,
          qty_counted: fila.qtyCounted,
        })),
      }),
    onSuccess: () => {
      toast.success("Cierre de caja aprobado");
      void qc.invalidateQueries({ queryKey: ["cierres-caja-openings"] });
      void qc.invalidateQueries({ queryKey: ["cierre-caja-conteo", apertura?.id] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo aprobar el cierre de caja");
    },
  });

  const handleClose = () => {
    if (aprobarMutation.isPending) return;
    setBorrador({});
    onClose();
  };

  const notas = apertura?.notes?.trim();

  return (
    <Dialog open={Boolean(apertura)} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="flex max-h-dialog-safe w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] flex-col gap-2 overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:max-w-md sm:gap-3 sm:p-5 sm:pb-5">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="text-base sm:text-lg">
            {aprobando ? "Aprobar cierre de caja" : "Cierre de caja"}
          </DialogTitle>
          {apertura ? (
            <p className="text-[11px] text-muted-foreground">
              {apertura.cashier_username || apertura.cashier_name} · {formatDateTime(apertura.opened_at)} →{" "}
              {formatDateTime(apertura.closed_at)}
            </p>
          ) : null}
          {apertura?.aprobacion_estado === "APROBADO" ? (
            <p className="text-[11px] font-medium text-emerald-700">
              Aprobado
              {apertura.aprobado_por_nombre ? ` por ${apertura.aprobado_por_nombre}` : ""}
              {apertura.aprobado_en ? ` · ${formatDateTime(apertura.aprobado_en)}` : ""}
            </p>
          ) : (
            <p className="text-[11px] font-medium text-amber-700">Pendiente de aprobación</p>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain sm:space-y-3">
          {conteoQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando cierre...
            </div>
          ) : conteoQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {(conteoQuery.error as Error)?.message || "No se pudo cargar el cierre"}
            </p>
          ) : (
            <CierreCajaConteoTabla
              filas={filas}
              edicion={
                aprobando
                  ? {
                      borrador,
                      onChange: (key, valor) => setBorrador((prev) => ({ ...prev, [key]: valor })),
                    }
                  : undefined
              }
            />
          )}

          {notas ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5 text-sm">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Notas</p>
              <p className="whitespace-pre-wrap text-foreground">{notas}</p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="footer-safe-bottom shrink-0 flex-row gap-2 border-t border-border/60 pt-2 sm:pb-0 sm:pt-3">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={aprobarMutation.isPending}
            className="flex-1 rounded-xl sm:flex-none"
          >
            Cerrar
          </Button>
          {aprobando ? (
            <Button
              onClick={() => aprobarMutation.mutate()}
              disabled={aprobarMutation.isPending || conteoQuery.isLoading || conteoQuery.isError}
              className="flex-1 gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none"
            >
              {aprobarMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Aprobar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
