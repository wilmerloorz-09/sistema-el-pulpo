import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CierreCajaConteoTabla from "@/components/caja/CierreCajaConteoTabla";
import { fetchClosedOpeningCount, type ClosedOpeningListRow } from "@/lib/openingCashReport";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CierreCajaDetalleDialogProps {
  apertura: ClosedOpeningListRow | null;
  onClose: () => void;
}

export default function CierreCajaDetalleDialog({ apertura, onClose }: CierreCajaDetalleDialogProps) {
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

  const notas = apertura?.notes?.trim();

  return (
    <Dialog open={Boolean(apertura)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-dialog-safe w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] flex-col gap-2 overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:max-w-md sm:gap-3 sm:p-5 sm:pb-5">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="text-base sm:text-lg">Cierre de caja</DialogTitle>
          {apertura ? (
            <p className="text-[11px] text-muted-foreground">
              {apertura.cashier_username || apertura.cashier_name} · {formatDateTime(apertura.opened_at)} →{" "}
              {formatDateTime(apertura.closed_at)}
            </p>
          ) : null}
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
            <CierreCajaConteoTabla filas={conteoQuery.data ?? []} />
          )}

          {notas ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5 text-sm">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Notas</p>
              <p className="whitespace-pre-wrap text-foreground">{notas}</p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="footer-safe-bottom shrink-0 flex-row border-t border-border/60 pt-2 sm:pb-0 sm:pt-3">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl sm:flex-none">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
