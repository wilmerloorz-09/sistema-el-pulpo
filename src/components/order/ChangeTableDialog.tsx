import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, LayoutGrid, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TableWithStatus } from "@/hooks/useTablesWithStatus";
import { cn } from "@/lib/utils";

interface ChangeTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTableId: string | null | undefined;
  currentTableName?: string | null;
  currentSplitCode?: string | null;
  tables: TableWithStatus[] | undefined;
  moving: boolean;
  onConfirm: (destinationTableId: string) => void;
}

const STATUS_META: Record<TableWithStatus["status"], { label: string; badgeClass: string; hint: string }> = {
  free: {
    label: "Libre",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
    hint: "Se movera directamente a esta mesa sin crear una division nueva.",
  },
  occupied: {
    label: "Ocupada",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
    hint: "Se creara una nueva division en esta mesa para no mezclar grupos.",
  },
  to_pay: {
    label: "Por pagar",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    hint: "Se creara una nueva division en esta mesa para no mezclar grupos.",
  },
};

export default function ChangeTableDialog({
  open,
  onOpenChange,
  currentTableId,
  currentTableName,
  currentSplitCode,
  tables,
  moving,
  onConfirm,
}: ChangeTableDialogProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const candidateTables = useMemo(
    () => (tables ?? []).filter((table) => table.id !== currentTableId),
    [currentTableId, tables],
  );

  const selectedTable = candidateTables.find((table) => table.id === selectedTableId) ?? null;
  const originLabel = currentSplitCode?.trim() || currentTableName?.trim() || "Mesa actual";

  useEffect(() => {
    if (!open) {
      setSelectedTableId(null);
      return;
    }

    setSelectedTableId((current) => {
      if (current && candidateTables.some((table) => table.id === current)) {
        return current;
      }
      return candidateTables[0]?.id ?? null;
    });
  }, [candidateTables, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="font-display text-xl font-black text-foreground">Cambiar de mesa</DialogTitle>
          <DialogDescription>
            Elige la mesa destino para mover esta orden `DINE_IN`. Si la mesa esta ocupada, el sistema creara una division nueva en destino.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-[22px] border border-orange-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Origen</p>
            <div className="mt-3 rounded-[18px] border border-sky-200 bg-sky-50/80 p-3">
              <p className="font-display text-lg font-black text-sky-800">{originLabel}</p>
              {currentTableName && currentSplitCode && currentSplitCode !== currentTableName ? (
                <p className="mt-1 text-xs text-sky-700">Mesa base: {currentTableName}</p>
              ) : null}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-[18px] border border-orange-100 bg-orange-50/70 px-3 py-2 text-xs text-orange-700">
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              La mesa destino definira si el movimiento es directo o por division.
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {candidateTables.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground sm:col-span-2">
                  No hay otra mesa activa disponible para mover esta orden.
                </div>
              ) : (
                candidateTables.map((table) => {
                  const status = STATUS_META[table.status];
                  const selected = selectedTableId === table.id;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => setSelectedTableId(table.id)}
                      className={cn(
                        "rounded-[22px] border p-4 text-left transition-all",
                        selected
                          ? "border-orange-400 bg-orange-50 shadow-[0_18px_34px_-28px_rgba(249,115,22,0.9)]"
                          : "border-orange-100 bg-white/85 hover:border-orange-200 hover:bg-orange-50/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-base font-black text-foreground">{table.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {table.splitCount > 0 ? `${table.splitCount} division(es) activas` : "Sin divisiones activas"}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", status.badgeClass)}>
                          {status.label}
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        {table.status === "free" ? <LayoutGrid className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                        <span>{status.hint}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="rounded-[22px] border border-orange-200/80 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resultado esperado</p>
              <p className="mt-2 text-sm text-foreground">
                {selectedTable
                  ? STATUS_META[selectedTable.status].hint
                  : "Selecciona una mesa para ver como se resolvera el movimiento."}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            Cancelar
          </Button>
          <Button onClick={() => selectedTable && onConfirm(selectedTable.id)} disabled={!selectedTable || moving}>
            {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Confirmar cambio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
