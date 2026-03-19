import { Badge } from "@/components/ui/badge";
import type { CashRegisterOpeningHistoryEntry } from "@/hooks/useCaja";
import { Clock3, FileText, ShieldAlert, UserRound } from "lucide-react";

interface Props {
  entries: CashRegisterOpeningHistoryEntry[];
  title?: string;
  description?: string;
  className?: string;
  compact?: boolean;
}

function formatDateTime(value: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: CashRegisterOpeningHistoryEntry["status"]) {
  if (status === "anulada") {
    return <Badge variant="destructive">Anulada</Badge>;
  }

  if (status === "cerrada") {
    return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">Cerrada</Badge>;
  }

  return <Badge className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400">Abierta</Badge>;
}

export default function CashRegisterOpeningHistory({
  entries,
  title = "Historial de aperturas de caja",
  description = "Aqui ves las aperturas registradas en este turno.",
  className = "",
  compact = false,
}: Props) {
  if (entries.length === 0) return null;

  return (
    <div className={`${compact ? "space-y-2 rounded-xl border border-rose-100 bg-white/90 p-2.5 shadow-sm" : "space-y-3 rounded-2xl border border-rose-100 bg-white/85 p-3 shadow-sm"} ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xs text-muted-foreground">{entries.length} registro(s)</span>
      </div>

      <div className={compact ? "max-h-[240px] space-y-1.5 overflow-y-auto pr-1" : "space-y-2"}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`${compact ? "rounded-xl border px-2.5 py-2" : "rounded-2xl border px-3 py-3"} ${
              entry.status === "anulada"
                ? "border-rose-200 bg-gradient-to-r from-white via-rose-50 to-orange-50"
                : entry.status === "abierta"
                  ? "border-emerald-200 bg-gradient-to-r from-white via-emerald-50 to-teal-50"
                  : "border-slate-200 bg-gradient-to-r from-white via-slate-50 to-slate-100"
            }`}
          >
            <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"} sm:flex-row sm:items-start sm:justify-between`}>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(entry.status)}
                  {entry.is_current && entry.status === "abierta" && (
                    <Badge variant="secondary" className="border-emerald-200 text-emerald-700">
                      Actual
                    </Badge>
                  )}
                </div>
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Apertura: {formatDateTime(entry.opened_at)}
                  {entry.closed_at ? <> - Cierre: {formatDateTime(entry.closed_at)}</> : null}
                </p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  Cajero: {entry.cashier_name || entry.cashier_username || "Sin nombre"}
                </p>
              </div>

              <div className={`${compact ? "rounded-lg border border-white/70 bg-white/90 px-2.5 py-1.5 text-right shadow-sm" : "rounded-xl border border-white/60 bg-white/80 px-3 py-2 text-right shadow-sm"}`}>
                <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Monto inicial</p>
                <p className="font-display text-base font-black text-foreground">${entry.initial_total.toFixed(2)}</p>
              </div>
            </div>

            {entry.status === "anulada" && (
              <div className={`${compact ? "mt-2 space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/80 p-2.5" : "mt-3 space-y-2 rounded-xl border border-rose-200 bg-rose-50/80 p-3"}`}>
                <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                  <ShieldAlert className="h-4 w-4" />
                  Apertura anulada
                </p>
                <p className="text-xs text-rose-800/90">
                  {entry.anulada_por_nombre || entry.anulada_por_username || "Usuario no identificado"} - {formatDateTime(entry.anulada_at)}
                </p>
                {entry.motivo_anulacion ? (
                  <p className="flex items-start gap-2 text-xs text-rose-800/90">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {entry.motivo_anulacion}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
