import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  copyCashReportSummary,
  openCashReportByEmail,
  openCashReportPrintView,
  openCashReportShareMenu,
  stageCashReportForShare,
  type MobilePrintStage,
} from "@/lib/cashReportMobilePrint";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
} from "@/lib/printHtmlDocument";
import { isThermalBridgeEnabled, printCashReportReceipt } from "@/lib/thermalPrint";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
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
  needsApkUpdate: false,
  ...getEmptyCapabilities(),
};

function getEmptyCapabilities() {
  return {
    native: false,
    sharePlugin: false,
    filesystemPlugin: false,
    browserPlugin: false,
    platform: "web",
  };
}

/**
 * Visor a pantalla completa del reporte de caja.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [shareStage, setShareStage] = useState<MobilePrintStage>(EMPTY_STAGE);
  const [busy, setBusy] = useState(false);
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
    if (openingGuard()) return;
    setBusy(true);
    try {
      const outcome = await openCashReportShareMenu(shareStage);
      if (outcome.ok) {
        toast.message("Elija la app Epson iPrint", {
          description: "La impresora no sale en esta lista; se elige dentro de Epson iPrint.",
          duration: 12000,
        });
        return;
      }
      toast.error("No se pudo abrir el menu", { description: outcome.message, duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPrintView = async () => {
    if (!state?.html || openingGuard()) return;
    setBusy(true);
    try {
      const outcome = await openCashReportPrintView(state.html);
      if (outcome.ok) {
        setPrintDialogOpen(false);
        hideCashReport();
        toast.message("Vista de impresion", {
          description: "Use el boton Imprimir o el menu del sistema. Si no aparece la Epson, pruebe Impresora de red.",
          duration: 12000,
        });
        return;
      }
      toast.error("No se pudo abrir la vista de impresion", { description: outcome.message, duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const handleThermalPrint = async () => {
    if (!state?.printParams || openingGuard()) return;
    setBusy(true);
    try {
      const result = await printCashReportReceipt(state.printParams);
      if (result.mode === "escpos") {
        setPrintDialogOpen(false);
        toast.success("Reporte enviado a la impresora de red");
        return;
      }
      toast.error("No se pudo imprimir en la impresora", {
        description:
          result.error
          || "Revise IP/puerto de la impresora en Administracion de sucursal y que este en la misma WiFi.",
        duration: 12000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCopySummary = async () => {
    if (!state?.printParams || openingGuard()) return;
    setBusy(true);
    try {
      if (await copyCashReportSummary(state.printParams)) {
        toast.message("Resumen copiado al portapapeles");
        return;
      }
      toast.error("No se pudo copiar");
    } finally {
      setBusy(false);
    }
  };

  const handleEmail = () => {
    if (!state?.printParams) return;
    openCashReportByEmail(state.printParams);
    toast.message("Abriendo correo con el resumen del reporte");
  };

  function openingGuard() {
    return busy;
  }

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current || isMobileLike) return;
    autoPrintDoneRef.current = true;
    window.setTimeout(handlePrint, 350);
  };

  if (!state || typeof document === "undefined") {
    return null;
  }

  const needsUpdate = shareStage.needsApkUpdate;
  const canThermalPrint = Boolean(state.printParams) && isThermalBridgeEnabled();

  return createPortal(
    <>
      <div className="cash-report-viewer-overlay fixed inset-0 z-[200] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Reporte de caja">
        <div className="no-print flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
          <Button type="button" className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full border-red-300 px-5 font-bold text-red-700 hover:bg-red-50" onClick={() => hideCashReport()}>
            Cerrar
          </Button>
        </div>
        <iframe ref={iframeRef} title="Reporte de caja" srcDoc={state.html} onLoad={handleIframeLoad} className="min-h-0 w-full flex-1 border-0 bg-white" />
      </div>

      <AlertDialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <AlertDialogContent className="z-[300] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{needsUpdate ? "Actualice la app de la tablet" : "Imprimir reporte de caja"}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm leading-relaxed text-slate-700">
              {needsUpdate ? (
                <>
                  <span className="block">
                    La app instalada es antigua y <strong>no puede abrir el menu de impresion</strong>. Hay que reinstalar el APK nuevo en la tablet.
                  </span>
                  <span className="block text-xs text-slate-500">
                    Mientras tanto use Vista de impresion o imprima desde una PC con la Epson conectada.
                  </span>
                </>
              ) : (
                <>
                  <span className="block">
                    {canThermalPrint
                      ? "Si la sucursal tiene IP de impresora configurada, use Impresora de red (igual que los comprobantes)."
                      : "Use Vista de impresion y el menu Imprimir del sistema."}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Epson L395: misma WiFi que la tablet. Si no aparece, instale Epson iPrint o configure la IP en Administracion.
                  </span>
                </>
              )}
              {shareStage.error ? <span className="block text-red-600">{shareStage.error}</span> : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            {canThermalPrint ? (
              <Button
                type="button"
                className="min-h-11 w-full bg-orange-600 hover:bg-orange-700"
                disabled={busy}
                onClick={() => void handleThermalPrint()}
              >
                {busy ? "Enviando…" : "Impresora de red"}
              </Button>
            ) : null}
            <Button
              type="button"
              className={canThermalPrint ? "min-h-11 w-full" : "min-h-11 w-full bg-orange-600 hover:bg-orange-700"}
              variant={canThermalPrint ? "outline" : "default"}
              disabled={busy}
              onClick={() => void handleOpenPrintView()}
            >
              {busy ? "Abriendo…" : "Vista de impresion"}
            </Button>
            {!needsUpdate && shareStage.ready ? (
              <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => void handleOpenShareMenu()}>
                Enviar a Epson iPrint
              </Button>
            ) : null}
            {state.printParams ? (
              <>
                <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => void handleCopySummary()}>
                  Copiar resumen
                </Button>
                <Button type="button" variant="outline" className="min-h-11 w-full gap-1.5" onClick={handleEmail}>
                  <Mail className="h-4 w-4" />
                  Enviar por correo
                </Button>
              </>
            ) : null}
            <AlertDialogCancel className="min-h-11 w-full">Cerrar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
    document.body,
  );
}
