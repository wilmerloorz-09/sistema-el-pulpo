import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer, Share2, ExternalLink } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import {
  buildCashReportPdf,
  downloadCashReportPdfWeb,
  openCashReportPdfTab,
  revokeCashReportPdfUrl,
  shareCashReportPdfNative,
  shareCashReportPdfWeb,
  type BuiltCashReportPdf,
} from "@/lib/cashReportPdf";
import { hideCashReport, subscribeCashReport } from "@/lib/cashReportViewerStore";
import {
  openCashReportInNewTab,
  prefersDedicatedPrintWindow,
  printCashReportDesktop,
  shareCashReportHtml,
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
 * Desktop: Imprimir. Móvil/tablet: generar PDF y luego Compartir/Abrir con un segundo toque.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [busy, setBusy] = useState(false);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [readyPdf, setReadyPdf] = useState<BuiltCashReportPdf | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoPrintDoneRef = useRef(false);
  const readyPdfRef = useRef<BuiltCashReportPdf | null>(null);
  const isMobileLike = prefersDedicatedPrintWindow();

  useEffect(() => subscribeCashReport(setState), []);

  useEffect(() => {
    readyPdfRef.current = readyPdf;
  }, [readyPdf]);

  useEffect(() => {
    if (!state) {
      autoPrintDoneRef.current = false;
      setStatus(null);
      setBusy(false);
      setDeliverBusy(false);
      const previous = readyPdfRef.current;
      setReadyPdf(null);
      revokeCashReportPdfUrl(previous?.objectUrl);
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

  const handleGeneratePdf = async () => {
    if (!state?.html || busy) return;
    setBusy(true);
    setStatus({ kind: "info", text: "Generando PDF… puede tardar unos segundos en tablet." });
    const previous = readyPdf;
    setReadyPdf(null);
    revokeCashReportPdfUrl(previous?.objectUrl);

    try {
      const sourceElement = iframeRef.current?.contentDocument?.body ?? null;
      const built = await buildCashReportPdf(state.html, { sourceElement });
      setReadyPdf(built);
      setStatus({
        kind: "ok",
        text: `PDF listo (${built.filename}). Toque Compartir o Abrir PDF para guardarlo.`,
      });
    } catch (error: unknown) {
      console.error("[cash-report-viewer-pdf]", error);
      const message = error instanceof Error ? error.message : "No se pudo generar el PDF";
      setStatus({
        kind: "error",
        text: `${message}. Puede usar Abrir HTML como alternativa.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSharePdf = async () => {
    if (!readyPdf || deliverBusy) return;
    setDeliverBusy(true);
    setStatus(null);
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          if (await shareCashReportPdfNative(readyPdf.bytes, readyPdf.filename)) {
            setStatus({ kind: "ok", text: "Menú Compartir abierto. Elija Guardar o una app." });
            return;
          }
        } catch (error: unknown) {
          console.error("[cash-report-viewer-native-share]", error);
        }
      }

      if (await shareCashReportPdfWeb(readyPdf.blob, readyPdf.filename)) {
        setStatus({ kind: "ok", text: "Menú Compartir abierto. Elija Guardar o una app." });
        return;
      }

      if (openCashReportPdfTab(readyPdf.objectUrl)) {
        setStatus({ kind: "ok", text: "PDF abierto. Use Guardar/Compartir del visor del sistema." });
        return;
      }

      setStatus({
        kind: "error",
        text: "No se pudo compartir en este dispositivo. Pruebe Abrir PDF o Abrir HTML.",
      });
    } finally {
      setDeliverBusy(false);
    }
  };

  const handleOpenPdf = () => {
    if (!readyPdf) return;
    if (openCashReportPdfTab(readyPdf.objectUrl)) {
      setStatus({ kind: "ok", text: "PDF abierto. Use Guardar/Compartir del visor del sistema." });
      return;
    }
    // Último recurso: algunos WebViews permiten download en gesto directo.
    downloadCashReportPdfWeb(readyPdf.blob, readyPdf.filename);
    setStatus({
      kind: "info",
      text: "Se intentó descargar el PDF. Si no aparece, use Compartir o Abrir HTML.",
    });
  };

  const handleOpenHtml = async () => {
    if (!state?.html) return;
    if (await shareCashReportHtml(state.html)) {
      setStatus({ kind: "ok", text: "Reporte HTML listo para compartir/guardar." });
      return;
    }
    if (openCashReportInNewTab(state.html)) {
      setStatus({ kind: "ok", text: "Reporte abierto en otra pestaña. Use Guardar/Compartir del navegador." });
      return;
    }
    setStatus({ kind: "error", text: "No se pudo abrir el reporte HTML en este dispositivo." });
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
            <>
              <Button
                type="button"
                className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"
                disabled={busy || deliverBusy}
                onClick={() => void handleGeneratePdf()}
              >
                <FileDown className="h-4 w-4" />
                {busy ? "Generando PDF…" : readyPdf ? "Regenerar PDF" : "Generar PDF"}
              </Button>
              {readyPdf ? (
                <>
                  <Button
                    type="button"
                    className="min-h-11 gap-1.5 rounded-full bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-700"
                    disabled={deliverBusy}
                    onClick={() => void handleSharePdf()}
                  >
                    <Share2 className="h-4 w-4" />
                    {deliverBusy ? "Abriendo…" : "Compartir"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-1.5 rounded-full border-orange-300 px-5 font-bold text-orange-800 hover:bg-orange-50"
                    disabled={deliverBusy}
                    onClick={handleOpenPdf}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir PDF
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-1.5 rounded-full px-4 font-semibold"
                disabled={busy || deliverBusy}
                onClick={() => void handleOpenHtml()}
              >
                Abrir HTML
              </Button>
            </>
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
            className={`mt-2 text-sm ${
              status.kind === "error"
                ? "font-medium text-red-700"
                : status.kind === "info"
                  ? "text-slate-600"
                  : "text-slate-700"
            }`}
            role="status"
          >
            {status.text}
          </p>
        ) : isMobileLike ? (
          <p className="mt-2 text-sm text-slate-600" role="status">
            En teléfono/tablet: primero Generar PDF y luego Compartir o Abrir PDF (así sí se puede guardar).
          </p>
        ) : null}
      </div>
      <iframe ref={iframeRef} title="Reporte de caja" srcDoc={state.html} onLoad={handleIframeLoad} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>,
    document.body,
  );
}
