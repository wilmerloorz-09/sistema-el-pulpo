import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  openCashReportPdf,
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
} from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";
import { PdfInlineViewer } from "@/components/caja/PdfInlineViewer";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
} | null;

const PRINT_TOAST = {
  "print-dialog": null,
  failed: {
    title: "No se pudo imprimir",
    description: "Use Abrir PDF en móvil o imprima desde una PC.",
  },
} as const;

/**
 * Visor a pantalla completa del reporte de caja.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);
  const isMobileLike = prefersDedicatedPrintWindow();

  useEffect(() => subscribeCashReport(setState), []);

  useEffect(() => {
    if (!state) {
      autoPrintDoneRef.current = false;
      setPdfBlob(null);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pdfBlob) {
          setPdfBlob(null);
          return;
        }
        hideCashReport();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [state, pdfBlob]);

  const notifyPrintResult = (result: keyof typeof PRINT_TOAST) => {
    const message = PRINT_TOAST[result];
    if (!message) return;
    toast.error(message.title, { description: message.description });
  };

  const handlePrint = () => {
    if (!state?.html) return;

    const result = printCashReportDesktop(iframeRef.current, state.html);
    notifyPrintResult(result === "print-dialog" ? "print-dialog" : result);
  };

  const handleOpenPdf = async () => {
    if (!state?.html || openingPdf) return;
    setOpeningPdf(true);
    try {
      const { result, blob } = await openCashReportPdf(state.html, iframeRef.current);
      if (result === "failed") {
        toast.error("No se pudo abrir el PDF", {
          description: "Intente de nuevo en unos segundos.",
        });
        return;
      }

      if (blob && isMobileLike) {
        setPdfBlob(blob);
      }
    } finally {
      setOpeningPdf(false);
    }
  };

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current || isMobileLike) return;
    autoPrintDoneRef.current = true;
    window.setTimeout(() => {
      handlePrint();
    }, 350);
  };

  if (!state || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <div
        className="cash-report-viewer-overlay fixed inset-0 z-[200] flex flex-col bg-white"
        role="dialog"
        aria-modal="true"
        aria-label="Reporte de caja"
      >
        <div className="no-print flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
          {isMobileLike ? (
            <Button
              type="button"
              className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
              onClick={() => void handleOpenPdf()}
              disabled={openingPdf}
            >
              <FileText className="h-4 w-4" />
              {openingPdf ? "Generando PDF…" : "Abrir PDF"}
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
              onClick={handlePrint}
            >
              Imprimir
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-full border-red-300 px-5 font-bold text-red-700 hover:bg-red-50"
            onClick={() => hideCashReport()}
          >
            Cerrar
          </Button>
        </div>

        <iframe
          ref={iframeRef}
          title="Reporte de caja"
          srcDoc={state.html}
          onLoad={handleIframeLoad}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      </div>

      {pdfBlob ? (
        <PdfInlineViewer blob={pdfBlob} onClose={() => setPdfBlob(null)} />
      ) : null}
    </>,
    document.body,
  );
}
