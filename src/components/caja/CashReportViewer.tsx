import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { openCashReportForInkjetPrint } from "@/lib/cashReportInkjetPrint";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
} from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
  printParams: import("@/lib/cashReportUtils").CashClosureReportParams | null;
} | null;

/**
 * Visor a pantalla completa del reporte de caja.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [printing, setPrinting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);
  const isMobileLike = prefersDedicatedPrintWindow();

  useEffect(() => subscribeCashReport(setState), []);

  useEffect(() => {
    if (!state) {
      autoPrintDoneRef.current = false;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
  }, [state]);

  const handlePrint = async () => {
    if (!state?.html || printing) return;

    if (isMobileLike) {
      setPrinting(true);
      try {
        const result = await openCashReportForInkjetPrint(state.html);
        if (result === "opened") {
          toast.message("Reporte abierto para imprimir", {
            description: "Pulse Imprimir y elija su Epson L395 (u otra impresora).",
          });
          return;
        }
        toast.error("No se pudo abrir la impresión", {
          description: "Intente de nuevo o use una PC con la impresora conectada.",
        });
      } finally {
        setPrinting(false);
      }
      return;
    }

    printCashReportDesktop(iframeRef.current, state.html);
  };

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current || isMobileLike) return;
    autoPrintDoneRef.current = true;
    window.setTimeout(() => {
      void handlePrint();
    }, 350);
  };

  if (!state || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="cash-report-viewer-overlay fixed inset-0 z-[200] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Reporte de caja"
    >
      <div className="no-print flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
        <Button
          type="button"
          className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
          onClick={() => void handlePrint()}
          disabled={printing}
        >
          <Printer className="h-4 w-4" />
          {printing ? "Abriendo…" : "Imprimir"}
        </Button>
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
    </div>,
    document.body,
  );
}
