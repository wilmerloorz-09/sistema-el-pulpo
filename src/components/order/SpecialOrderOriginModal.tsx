import { AlertCircle, Loader2, ShoppingBag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { cn } from "@/lib/utils";
import { formatTableNameLabel } from "@/lib/orderPresentation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTakeout: () => void;
  onSelectTable: (tableId: string) => void;
  isCreating: boolean;
}

export function SpecialOrderOriginModal({
  open,
  onOpenChange,
  onSelectTakeout,
  onSelectTable,
  isCreating,
}: Props) {
  const { data, isLoading, isError } = useTablesWithStatus();
  const tables = data?.tables ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-dialog-safe flex max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b bg-slate-50/80 px-6 py-4">
          <DialogTitle className="font-display text-xl text-slate-800">Nueva orden especial</DialogTitle>
          <DialogDescription>
            Toca <strong>Para llevar</strong> o una mesa. La orden se crea al instante.
          </DialogDescription>
        </DialogHeader>

        <div className="footer-safe-bottom flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <Loader2 className="mb-4 h-8 w-8 animate-spin" />
              <p>Cargando opciones...</p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-rose-500">
              <AlertCircle className="mb-4 h-12 w-12 opacity-50" />
              <p>No se pudieron cargar las mesas.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                disabled={isCreating}
                onClick={onSelectTakeout}
                className={cn(
                  "flex w-full min-h-[88px] items-center gap-4 rounded-2xl border-2 px-4 py-3 shadow-sm transition-all active:scale-[0.99]",
                  "border-emerald-300 bg-gradient-to-r from-emerald-50 to-white text-emerald-900 hover:border-emerald-400 hover:shadow-md",
                  isCreating && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-sm">
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-base font-black tracking-tight">Para llevar</span>
                  <span className="mt-0.5 block text-xs font-medium text-emerald-700">Orden especial sin mesa</span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
                  Especial
                </span>
              </button>

              {tables.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No hay mesas configuradas en esta sucursal.</p>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mesas</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {tables.map((table) => {
                      const isOccupied = table.status === "occupied" || table.status === "to_pay";
                      const label = formatTableNameLabel(table.name);
                      return (
                        <button
                          key={table.id}
                          type="button"
                          disabled={isCreating}
                          onClick={() => onSelectTable(table.id)}
                          className={cn(
                            "relative flex min-h-[110px] flex-col items-center justify-center rounded-2xl border-2 p-4 shadow-sm transition-all active:scale-95",
                            isOccupied
                              ? "border-amber-200 bg-gradient-to-b from-amber-50 to-orange-50/50 text-amber-900 hover:border-amber-300 hover:shadow-md"
                              : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:shadow-md",
                            isCreating && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span
                            className={cn(
                              "text-lg font-black tracking-tight",
                              isOccupied ? "text-amber-800" : "text-slate-800",
                            )}
                          >
                            {label}
                          </span>
                          <span
                            className={cn(
                              "mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              isOccupied ? "bg-amber-200/50 text-amber-800" : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {isOccupied ? "Ocupada" : "Libre"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
