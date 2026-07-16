import { useState } from "react";
import { Check, Loader2, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useAutopedidosQrMutations,
  useAutopedidosQrPendientes,
} from "@/hooks/useAutopedidosQrPendientes";
import { cn } from "@/lib/utils";

type AutopedidosQrPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AutopedidosQrPanel({ open, onOpenChange }: AutopedidosQrPanelProps) {
  const { agrupadosPorMesa, isLoading, refetch } = useAutopedidosQrPendientes({ enabled: open });
  const { aprobar, rechazar } = useAutopedidosQrMutations();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const handleAprobar = async (ordenId: string) => {
    setActionError(null);
    setBusyOrderId(ordenId);
    try {
      await aprobar.mutateAsync(ordenId);
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo aprobar.");
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleRechazar = async (ordenId: string) => {
    setActionError(null);
    setBusyOrderId(ordenId);
    try {
      await rechazar.mutateAsync({ ordenId, motivo: "Rechazado desde panel de autopedidos" });
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo rechazar.");
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-orange-100 px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 font-display">
            <QrCode className="h-5 w-5 text-primary" />
            Autopedidos entrantes
          </SheetTitle>
          <SheetDescription>
            Pedidos QR pendientes de aprobación. Al aprobar pasan a En Caja.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {actionError ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agrupadosPorMesa.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 px-4 py-10 text-center text-sm text-muted-foreground">
              No hay autopedidos pendientes.
            </div>
          ) : (
            agrupadosPorMesa.map((grupo) => (
              <section key={grupo.mesaId ?? grupo.mesaNombre} className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
                  {grupo.mesaNombre}
                </h3>
                {grupo.ordenes.map((orden) => {
                  const busy = busyOrderId === orden.orden_id;
                  return (
                    <article
                      key={orden.orden_id}
                      className="rounded-2xl border border-orange-200 bg-white p-3 shadow-sm"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            {orden.cliente_nombre || "Cliente anónimo"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(orden.creado_en)} · {formatMoney(orden.total)}
                          </p>
                        </div>
                      </div>

                      <ul className="mb-3 space-y-1.5">
                        {orden.items.map((item) => (
                          <li key={item.id} className="text-sm text-foreground">
                            <span className="font-semibold">{item.quantity}x</span>{" "}
                            {item.description}
                            {item.modifiers?.length ? (
                              <span className="block text-xs text-muted-foreground">
                                {item.modifiers.join(", ")}
                              </span>
                            ) : null}
                            {item.item_note ? (
                              <span className="block text-xs italic text-muted-foreground">
                                Nota: {item.item_note}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>

                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void handleRechazar(orden.orden_id)}
                          className="h-11 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          {busy && rechazar.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <X className="mr-1.5 h-4 w-4" />
                              Rechazar
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleAprobar(orden.orden_id)}
                          className={cn("h-11 rounded-xl font-bold")}
                        >
                          {busy && aprobar.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Check className="mr-1.5 h-4 w-4" />
                              Aprobar
                            </>
                          )}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type AutopedidosQrBadgeButtonProps = {
  className?: string;
  onClick: () => void;
};

export function AutopedidosQrBadgeButton({ className, onClick }: AutopedidosQrBadgeButtonProps) {
  const { count } = useAutopedidosQrPendientes();

  if (count <= 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex h-11 min-w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-primary shadow-sm transition hover:bg-orange-100",
        className,
      )}
      aria-label={`${count} autopedidos pendientes`}
    >
      <QrCode className="h-5 w-5" />
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
}
