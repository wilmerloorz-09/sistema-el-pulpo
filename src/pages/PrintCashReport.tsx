import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  decodeCashReportPayloadFromUrl,
  readStashedCashReportHtml,
} from "@/lib/cashReportPrintSession";
import { parseReportHtml } from "@/lib/printHtmlDocument";
import { needsNativePrintApkForAndroid, printNativeWebView } from "@/lib/pulpoNativePrint";

export default function PrintCashReport() {
  const [searchParams] = useSearchParams();
  const [html, setHtml] = useState<string | null>(null);
  const [autoPrintDone, setAutoPrintDone] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const stashed = readStashedCashReportHtml(searchParams.get("id"));
    if (stashed) {
      setHtml(stashed);
      return;
    }
    setHtml(decodeCashReportPayloadFromUrl(searchParams.get("d")));
  }, [searchParams]);

  useEffect(() => {
    document.body.classList.add("printing-cash-report");
    return () => {
      document.body.classList.remove("printing-cash-report");
    };
  }, []);

  const parsed = useMemo(() => (html ? parseReportHtml(html) : null), [html]);

  const handlePrint = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    try {
      if (needsNativePrintApkForAndroid()) {
        toast.error("Actualice la app de la tablet", {
          description: "Instale el APK nuevo para abrir el dialogo de impresion de Android.",
          duration: 12000,
        });
        return;
      }

      const outcome = await printNativeWebView("Reporte de caja");
      if (!outcome.ok) {
        toast.error("No se abrio el dialogo de impresion", {
          description: outcome.error ?? "Intente Enviar a Epson iPrint desde el reporte.",
          duration: 10000,
        });
      }
    } finally {
      setPrinting(false);
    }
  }, [printing]);

  useEffect(() => {
    if (!html || !parsed || autoPrintDone || searchParams.get("print") !== "1") return;
    const timer = window.setTimeout(() => {
      void handlePrint().finally(() => setAutoPrintDone(true));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [html, parsed, autoPrintDone, searchParams, handlePrint]);

  if (!html || !parsed) {
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
          <Button
            type="button"
            className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white"
            disabled={printing}
            onClick={() => void handlePrint()}
          >
            <Printer className="h-4 w-4" />
            {printing ? "Abriendo…" : "Imprimir"}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full px-4" onClick={() => window.history.back()}>
            <X className="h-4 w-4" />
            Volver
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          Pulse <strong>Imprimir</strong> para abrir el menu de impresion de Android y elija la <strong>Epson L395</strong>.
          Si no aparece, use <strong>Epson iPrint</strong> desde el reporte en Caja.
        </p>
      </div>
      <div id="print-cash-report" className="min-h-0 flex-1 overflow-auto bg-white">
        <style>{parsed.styles}</style>
        <div className="cash-report-print-document" dangerouslySetInnerHTML={{ __html: parsed.bodyHtml }} />
      </div>
    </div>
  );
}
