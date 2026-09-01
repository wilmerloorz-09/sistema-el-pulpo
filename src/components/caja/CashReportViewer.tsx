import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import {
  copyCashReportSummary,
  getMobilePrintStage,
  openCashReportShareMenu,
  stageCashReportForShare,
  type MobilePrintStage,
} from "@/lib/cashReportMobilePrint";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
} from "@/lib/printHtmlDocument";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";

type CashReportViewState = {
  html: string;
  autoPrint: boolean;
  printParams: CashClosureReportParams | null;
} | null;

const EMPTY_STAGE: MobilePrintStage = {
  ready: false,
  shareUri: null,
  error: null,
  ...getMobilePrintStage(),
};

/**
 * Visor a pantalla completa del reporte de caja.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [shareStage, setShareStage] = useState<MobilePrintStage>(EMPTY_STAGE);
  const [openingShare, setOpeningShare] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);
  const isMobileLike = prefersDedicatedPrintWindow();

  useEffect(() => subscribeCashReport(setState), []);

  useEffect(() => {
    if (!state) {
      autoPrintDoneRef.current = false;
      setPrintDialogOpen(false);
      setShareStage(EMPTY_STAGE);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (printDialogOpen) {
          setPrintDialogOpen(false);
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
  }, [state, printDialogOpen]);

  useEffect(() => {
    if (!state?.html || !isMobileLike) return;

    let cancelled = false;
    setShareStage({ ...EMPTY_STAGE, ready: false });

    void stageCashReportForShare(state.html).then((stage) => {
      if (!cancelled) setShareStage(stage);
    });

    return () => {
      cancelled = true;
    };
  }, [state?.html, isMobileLike]);

  const handlePrint = () => {
    if (!state?.html) return;

    if (isMobileLike) {
      setPrintDialogOpen(true);
      return;
    }

    printCashReportDesktop(iframeRef.current, state.html);
  };

  const handleOpenShareMenu = async () => {
    if (!state || openingShare) return;
    setOpeningShare(true);
    try {
      const outcome = await openCashReportShareMenu(shareStage, state.printParams);
      if (outcome.ok) {
        setPrintDialogOpen(false);
        toast.message("Elija Epson iPrint o Impresion", {
          description: "En el menu de Android, seleccione la app de su impresora.",
        });
        return;
      }
      toast.error("No se pudo abrir el menu", {
        description: outcome.message,
        duration: 10000,
      });
    } finally {
      setOpeningShare(false);
    }
  };

  const handleCopySummary = async () => {
    if (!state?.printParams) return;
    const copied = await copyCashReportSummary(state.printParams);
    if (copied) {
      toast.message("Resumen copiado", {
        description: "Peguelo en WhatsApp o correo si no puede imprimir aqui.",
      });
      return;
    }
    toast.error("No se pudo copiar el resumen");
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

  const dialogDescription = shareStage.error
    ? shareStage.error
    : !shareStage.ready
      ? "Preparando el reporte para imprimir…"
      : shareStage.shareUri
        ? "Pulse «Abrir menu» y elija Epson iPrint, Impresion o la app de su impresora Epson L395."
        : state.printParams
          ? "Pulse «Abrir menu» para enviar el resumen del reporte a otra app."
          : "Impresion desde tablet no disponible. Use una PC con la Epson conectada.";

  return createPortal(
    <>
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
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4" />
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
      </div>

      <AlertDialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <AlertDialogContent className="z-[300] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Imprimir en Epson L395</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm leading-relaxed text-slate-700">
              <span className="block">{dialogDescription}</span>
              {!shareStage.ready ? null : (
                <span className="block text-xs text-slate-500">
                  App: {shareStage.platform}
                  {shareStage.native ? " (nativa)" : " (navegador)"}
                  {shareStage.sharePlugin ? "" : " · sin plugin Compartir"}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              className="min-h-11 w-full bg-orange-600 hover:bg-orange-700"
              disabled={!shareStage.ready || openingShare || (!shareStage.shareUri && !state.printParams)}
              onClick={(event) => {
                event.preventDefault();
                void handleOpenShareMenu();
              }}
            >
              {openingShare ? "Abriendo…" : "Abrir menu de impresion"}
            </AlertDialogAction>
            {state.printParams ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => void handleCopySummary()}
              >
                Copiar resumen
              </Button>
            ) : null}
            <AlertDialogCancel className="min-h-11 w-full">Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
    document.body,
  );
}
