import { Loader2, X, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTable: (tableId: string | null) => void;
  isCreating: boolean;
}

export function ExtraTableSelectorModal({ open, onOpenChange, onSelectTable, isCreating }: Props) {
  const { data, isLoading, isError } = useTablesWithStatus();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-dialog-safe flex max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b bg-slate-50/80 px-6 py-4">
          <DialogTitle className="font-display text-xl text-slate-800">Seleccionar Mesa</DialogTitle>
          <DialogDescription>
            Selecciona la mesa a la que le pertenece esta orden extra.
          </DialogDescription>
        </DialogHeader>

        <div className="footer-safe-bottom flex-1 overflow-y-auto bg-slate-50 p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>Cargando mesas...</p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-20 text-rose-500">
              <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
              <p>Ocurrió un error al cargar las mesas.</p>
            </div>
          ) : data?.tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <p>No hay mesas configuradas en esta sucursal.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">


              {data?.tables.map((table) => {
                const isOccupied = table.status === "occupied" || table.status === "to_pay";
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={isCreating}
                    onClick={() => onSelectTable(table.id)}
                    className={cn(
                      "relative flex flex-col items-center justify-center p-4 min-h-[110px] rounded-2xl border-2 shadow-sm transition-all active:scale-95",
                      isOccupied 
                        ? "border-amber-200 bg-gradient-to-b from-amber-50 to-orange-50/50 hover:border-amber-300 hover:shadow-md text-amber-900" 
                        : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md text-slate-700",
                      isCreating && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <span className={cn(
                      "text-lg font-black tracking-tight",
                      isOccupied ? "text-amber-800" : "text-slate-800"
                    )}>
                      {table.name}
                    </span>
                    <span className={cn(
                      "text-[11px] font-semibold mt-1 px-2 py-0.5 rounded-full",
                      isOccupied ? "bg-amber-200/50 text-amber-800" : "bg-slate-100 text-slate-500"
                    )}>
                      {isOccupied ? "Ocupada" : "Libre"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
