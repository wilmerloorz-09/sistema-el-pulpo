import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  prefersDedicatedPrintWindow,
  openCashReportInNewTab,
  printCashReportDesktop,
  printCashReportMobile,
  shareCashReportHtml,
} from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
} | null;

const PRINT_TOAST = {
  "opened-tab": {
    title: "Reporte abierto en otra pestaña",
    description: "Use el menú del navegador (⋮ o Compartir) y elija Imprimir o Guardar como PDF.",
  },
  "print-dialog": null,
  failed: {
    title: "No se pudo imprimir",
    description: "Pruebe el botón Compartir o abra la app en Chrome/Safari (no solo el acceso directo).",
  },
} as const;

/**
 * Visor a pantalla completa del reporte de caja.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [sharing, setSharing] = useState(false);
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

  const notifyPrintResult = (result: keyof typeof PRINT_TOAST) => {
    const message = PRINT_TOAST[result];
    if (!message) return;
    if (result === "failed") {
      toast.error(message.title, { description: message.description });
      return;
    }
    toast.message(message.title, { description: message.description });
  };

  const handlePrint = () => {
    if (!state?.html) return;

    const result = isMobileLike
      ? printCashReportMobile(state.html, iframeRef.current)
      : printCashReportDesktop(iframeRef.current, state.html);

    notifyPrintResult(result === "print-dialog" ? "print-dialog" : result);
  };

  const handleShare = async () => {
    if (!state?.html || sharing) return;
    setSharing(true);
    try {
      const shared = await shareCashReportHtml(state.html);
      if (shared) return;

      if (openCashReportInNewTab(state.html)) {
        notifyPrintResult("opened-tab");
        return;
      }
      notifyPrintResult("failed");
    } finally {
      setSharing(false);
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
    <div
      className="cash-report-viewer-overlay fixed inset-0 z-[200] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Reporte de caja"
    >
      <div className="no-print flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
        <Button
          type="button"
          className="min-h-11 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
          onClick={handlePrint}
        >
          Imprimir
        </Button>
        {isMobileLike ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-1.5 rounded-full px-4 font-bold"
            onClick={() => void handleShare()}
            disabled={sharing}
          >
            <Share2 className="h-4 w-4" />
            Compartir
          </Button>
        ) : null}
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
