import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Printer, X } from "lucide-react";
import { getCashReportPrintChannelName, readCashReportHtml } from "@/lib/cashReportInkjetPrint";
import { Button } from "@/components/ui/button";

export default function PrintCashReport() {
  const [searchParams] = useSearchParams();
  const [html, setHtml] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const key = searchParams.get("k");
    const stored = readCashReportHtml(key);
    if (stored) {
      setHtml(stored);
      return;
    }

    if (typeof BroadcastChannel === "undefined") {
      setMissing(true);
      return;
    }

    const channel = new BroadcastChannel(getCashReportPrintChannelName());
    const timeoutId = window.setTimeout(() => {
      setMissing(true);
    }, 4000);

    channel.onmessage = (event: MessageEvent<{ type?: string; key?: string; html?: string }>) => {
      if (event.data?.type !== "report" || event.data.key !== key || !event.data.html) return;
      window.clearTimeout(timeoutId);
      setHtml(event.data.html);
      setMissing(false);
    };

    return () => {
      window.clearTimeout(timeoutId);
      channel.close();
    };
  }, [searchParams]);

  const handlePrint = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.focus();
      frameWindow.print();
      return;
    }
    window.print();
  };

  const handleClose = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
        return;
      } catch {
        /* fallback below */
      }
    }

    window.close();
    window.setTimeout(() => {
      if (window.history.length > 1) {
        window.history.back();
      }
    }, 120);
  };

  if (missing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-bold text-slate-900">Reporte no disponible</h1>
          <p className="text-sm text-slate-600">
            Vuelva a Caja, abra el reporte y pulse Imprimir de nuevo.
          </p>
        </div>
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
        Cargando reporte…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="no-print flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          Elija su impresora (ej. <strong>Epson L395</strong>) en el diálogo de impresión.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-1.5 rounded-full border-red-300 px-4 font-bold text-red-700 hover:bg-red-50"
            onClick={() => void handleClose()}
          >
            <X className="h-4 w-4" />
            Cerrar
          </Button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        title="Reporte de caja para imprimir"
        srcDoc={html}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
