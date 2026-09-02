import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  decodeCashReportPayloadFromUrl,
  readStashedCashReportHtml,
} from "@/lib/cashReportPrintSession";

export default function PrintCashReport() {
  const [searchParams] = useSearchParams();
  const [html, setHtml] = useState<string | null>(null);
  const [autoPrintDone, setAutoPrintDone] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const stashed = readStashedCashReportHtml(searchParams.get("id"));
    if (stashed) {
      setHtml(stashed);
      return;
    }
    setHtml(decodeCashReportPayloadFromUrl(searchParams.get("d")));
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

  useEffect(() => {
    if (!html || autoPrintDone || searchParams.get("print") !== "1") return;
    const timer = window.setTimeout(() => {
      handlePrint();
      setAutoPrintDone(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [html, autoPrintDone, searchParams]);

  if (!html) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <p className="text-sm text-slate-600">Reporte no disponible. Vuelva a Caja e intente Imprimir de nuevo.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="no-print flex shrink-0 flex-col gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Button type="button" className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full px-4" onClick={() => window.history.back()}>
            <X className="h-4 w-4" />
            Volver
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          Pulse <strong>Imprimir</strong> o use el menu del sistema (tres puntos) → <strong>Imprimir</strong> → elija la impresora.
          Si no aparece la Epson, vuelva a Caja y use <strong>Impresora de red</strong> o configure la IP en Administracion de sucursal.
        </p>
      </div>
      <iframe ref={iframeRef} title="Reporte" srcDoc={html} className="min-h-0 w-full flex-1 border-0" />
    </div>
  );
}
