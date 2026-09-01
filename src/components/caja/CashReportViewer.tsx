import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import { printHtmlDocumentSync, prefersDedicatedPrintWindow } from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
} | null;

/**
 * Visor a pantalla completa del reporte de caja.
 * Evita window.open / onclick inline, que en tablet Capacitor no responden.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);

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

  const handlePrint = () => {
    if (!state?.html) return;

    if (!prefersDedicatedPrintWindow()) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (frameWindow) {
        try {
          frameWindow.focus();
          frameWindow.print();
          return;
        } catch {
          // Continúa con ventana dedicada.
        }
      }
    }

    const result = printHtmlDocumentSync(state.html);
    if (result === "failed") {
      toast.error(
        "No se pudo abrir la impresión. Permita ventanas emergentes o use Compartir > Imprimir en el navegador.",
      );
      return;
    }
    if (result === "opened-window") {
      toast.message("Reporte listo para imprimir", {
        description: "Si no aparece el diálogo, use el menú del navegador (Compartir o Imprimir).",
      });
    }
  };

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current) return;
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
      className="fixed inset-0 z-[200] flex flex-col bg-white"
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
