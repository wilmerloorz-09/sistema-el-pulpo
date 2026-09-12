import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { saveCashReportPdf } from "@/lib/cashReportPdf";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
} from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
  printParams: CashClosureReportParams | null;
} | null;

/**
 * Visor a pantalla completa del reporte de caja.
 * Desktop: Imprimir. Móvil/tablet: Guardar PDF.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);
  const isMobileLike = prefersDedicatedPrintWindow();

  useEffect(() => subscribeCashReport(setState), []);

  useEffect(() => {
    if (!state) {
      autoPrintDoneRef.current = false;
      setStatus(null);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideCashReport();
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [state]);

  const handlePrintDesktop = () => {
    if (!state?.html) return;
    printCashReportDesktop(iframeRef.current, state.html);
  };

  const handleSavePdf = async () => {
    if (!state?.html || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveCashReportPdf(state.html);
      if (!result.ok) {
        const text = result.message || "No se pudo guardar el PDF";
        setStatus({ kind: "error", text });
        toast.error("No se pudo guardar el PDF", { description: result.message, duration: 10000 });
        return;
      }
      const text =
        result.mode === "share"
          ? `PDF listo (${result.filename}). En el menú elija Guardar o una app.`
          : result.mode === "open"
            ? `PDF abierto (${result.filename}). Use Guardar/Compartir del visor.`
            : `PDF generado (${result.filename}). Revise Descargas si no ve el archivo.`;
      setStatus({ kind: "ok", text });
    } finally {
      setBusy(false);
    }
  };

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current || isMobileLike) return;
    autoPrintDoneRef.current = true;
    window.setTimeout(handlePrintDesktop, 350);
  };

  if (!state || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="cash-report-viewer-overlay fixed inset-0 z-[200] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Reporte de caja">
      <div className="no-print shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isMobileLike ? (
            <Button
              type="button"
              className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
              disabled={busy}
              onClick={() => void handleSavePdf()}
            >
              <FileDown className="h-4 w-4" />
              {busy ? "Generando PDF…" : "Guardar PDF"}
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
              onClick={handlePrintDesktop}
            >
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11 rounded-full border-red-300 px-5 font-bold text-red-700 hover:bg-red-50" onClick={() => hideCashReport()}>
            Cerrar
          </Button>
        </div>
        {status ? (
          <p
            className={`mt-2 text-sm ${status.kind === "error" ? "font-medium text-red-700" : "text-slate-700"}`}
            role="status"
          >
            {status.text}
          </p>
        ) : null}
      </div>
      <iframe ref={iframeRef} title="Reporte de caja" srcDoc={state.html} onLoad={handleIframeLoad} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>,
    document.body,
  );
}
