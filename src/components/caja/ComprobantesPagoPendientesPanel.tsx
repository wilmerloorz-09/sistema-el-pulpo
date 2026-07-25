import { useRef, useState } from "react";
import { AlertTriangle, Camera, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrderRef } from "@/lib/orderPresentation";
import type { ComprobantePagoPendienteLocal } from "@/lib/comprobantePagoPendienteLocal";
import { useComprobantesPagoPendientes } from "@/hooks/useComprobantesPagoPendientes";

export default function ComprobantesPagoPendientesPanel() {
  const { pendientes, reintentar, adjuntarOtraFoto } = useComprobantesPagoPendientes();
  const [busyPagoId, setBusyPagoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<ComprobantePagoPendienteLocal | null>(null);

  if (pendientes.length === 0) return null;

  const handleRetry = async (pagoId: string) => {
    setBusyPagoId(pagoId);
    try {
      await reintentar.mutateAsync(pagoId);
    } finally {
      setBusyPagoId(null);
    }
  };

  const handlePickFile = (pendiente: ComprobantePagoPendienteLocal) => {
    targetRef.current = pendiente;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (file: File | undefined) => {
    const pendiente = targetRef.current;
    targetRef.current = null;
    if (!file || !pendiente) return;
    if (!file.type.startsWith("image/")) return;

    setBusyPagoId(pendiente.pagoId);
    try {
      await adjuntarOtraFoto.mutateAsync({ pendiente, archivo: file });
    } finally {
      setBusyPagoId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-bold text-amber-950">
              Pagos con foto de comprobante pendiente ({pendientes.length})
            </p>
            <p className="mt-0.5 text-xs text-amber-900/80">
              El cobro ya quedó registrado. Reintenta la subida o adjunta otra foto si la tablet perdió la imagen.
            </p>
          </div>

          <ul className="space-y-2">
            {pendientes.map((item) => {
              const busy = busyPagoId === item.pagoId;
              const orderLabel = getOrderRef(item.ordenCodigo, item.ordenNumero);
              return (
                <li
                  key={item.pagoId}
                  className="rounded-xl border border-amber-200 bg-white/80 px-3 py-2.5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        Orden {orderLabel}
                        {item.monto != null ? (
                          <span className="ml-2 tabular-nums text-muted-foreground">
                            ${item.monto.toFixed(2)}
                          </span>
                        ) : null}
                      </p>
                      {item.ultimoError ? (
                        <p className="mt-0.5 text-xs text-destructive">{item.ultimoError}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Foto guardada en esta tablet · intentos: {item.intentos}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        className="h-9 gap-1.5 border-amber-300 bg-white"
                        onClick={() => void handleRetry(item.pagoId)}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Reintentar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        className="h-9 gap-1.5"
                        onClick={() => handlePickFile(item)}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Camera className="h-3.5 w-3.5" />
                        )}
                        Otra foto
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <Upload className="hidden h-4 w-4 text-amber-700 sm:block" />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFileChange(e.target.files?.[0]);
        }}
      />
    </div>
  );
}
