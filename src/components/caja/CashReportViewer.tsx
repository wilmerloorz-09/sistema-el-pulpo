import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer, Share2, ExternalLink, Eye } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import {
  revokeCashReportPdfUrl,
  saveCashReportPdf,
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
 * Móvil: genera PDF y muestra visor + enlaces reales (gesto del usuario) para que funcione en más dispositivos.
 */
export function CashReportViewer() {
  const [state, setState] = useState<CashReportViewState>(null);
  const [busy, setBusy] = useState(false);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [readyPdf, setReadyPdf] = useState<BuiltCashReportPdf | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
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
      setShowPdfPreview(false);
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

  const keepReadyPdf = (pdf: BuiltCashReportPdf | null | undefined) => {
    const previous = readyPdfRef.current;
    if (previous && previous.objectUrl !== pdf?.objectUrl) {
      revokeCashReportPdfUrl(previous.objectUrl);
    }
    setReadyPdf(pdf ?? null);
  };

  const handlePrintDesktop = () => {
    if (!state?.html) return;
    printCashReportDesktop(iframeRef.current, state.html);
  };

  const handleSavePdf = async () => {
    if (!state?.html || busy) return;
    setBusy(true);
    setShowPdfPreview(false);
    setStatus({ kind: "info", text: "Generando PDF…" });
    keepReadyPdf(null);

    try {
      const result = await saveCashReportPdf(state.html);
      if (result.pdf) {
        keepReadyPdf(result.pdf);
        setShowPdfPreview(true);
      }

      if (!result.ok) {
        setStatus({
          kind: "error",
          text: `${result.message || "No se pudo generar el PDF"}. Pruebe Abrir HTML.`,
        });
        return;
      }

      if (result.mode === "share") {
        setStatus({
          kind: "ok",
          text: `PDF listo (${result.filename}). En el menú del teléfono elija Guardar en Drive/Archivos/Descargas.`,
        });
        return;
      }

      if (result.mode === "open" || result.mode === "download") {
        setStatus({
          kind: "ok",
          text: `PDF listo (${result.filename}).`,
        });
        return;
      }

      // mode === "ready": hay que tocar un enlace/botón (gesto fresco).
      setStatus({
        kind: "ok",
        text:
          "PDF listo. Toque Compartir (recomendado) o Abrir/Descargar abajo. Si ve el PDF, también puede usar el botón de descarga del visor.",
      });
    } catch (error: unknown) {
      console.error("[cash-report-viewer-pdf]", error);
      setStatus({
        kind: "error",
        text: `${error instanceof Error ? error.message : "No se pudo generar el PDF"}. Pruebe Abrir HTML.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSharePdf = async () => {
    if (!readyPdf || deliverBusy) return;
    setDeliverBusy(true);
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          if (await shareCashReportPdfNative(readyPdf.bytes, readyPdf.filename)) {
            setStatus({
              kind: "ok",
              text: "Menú Compartir abierto. Elija Guardar en Drive, Archivos o Descargas.",
            });
            return;
          }
        } catch (error: unknown) {
          console.error("[cash-report-viewer-native-share]", error);
        }
      }
      if (await shareCashReportPdfWeb(readyPdf.blob, readyPdf.filename)) {
        setStatus({
          kind: "ok",
          text: "Menú Compartir abierto. Elija Guardar en Drive, Archivos o Descargas.",
        });
        return;
      }
      setStatus({
        kind: "error",
        text: "Este teléfono no permite Compartir archivos desde el navegador. Use Abrir o Descargar (enlace de abajo).",
      });
    } finally {
      setDeliverBusy(false);
    }
  };

  const handleOpenHtml = async () => {
    if (!state?.html) return;
    if (await shareCashReportHtml(state.html)) {
      setStatus({ kind: "ok", text: "Reporte HTML listo para compartir/guardar." });
      return;
    }
    if (openCashReportInNewTab(state.html)) {
      setStatus({ kind: "ok", text: "Reporte abierto en otra pestaña." });
      return;
    }
    setStatus({ kind: "error", text: "No se pudo abrir el reporte HTML." });
  };

  const handleIframeLoad = () => {
    if (!state?.autoPrint || autoPrintDoneRef.current || isMobileLike) return;
    autoPrintDoneRef.current = true;
    window.setTimeout(handlePrintDesktop, 350);
  };

  if (!state || typeof document === "undefined") {
    return null;
  }

  const linkClass =
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-orange-300 bg-white px-5 text-sm font-bold text-orange-800 no-underline hover:bg-orange-50";

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
                onClick={() => void handleSavePdf()}
              >
                <FileDown className="h-4 w-4" />
                {busy ? "Generando PDF…" : readyPdf ? "Regenerar PDF" : "Guardar PDF"}
              </Button>

              {readyPdf ? (
                <>
                  <Button
                    type="button"
                    className="min-h-11 gap-1.5 rounded-full bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-700"
                    disabled={busy || deliverBusy}
                    onClick={() => void handleSharePdf()}
                  >
                    <Share2 className="h-4 w-4" />
                    {deliverBusy ? "Abriendo…" : "Compartir"}
                  </Button>

                  {/* Enlaces reales: el toque del usuario es lo que permite Abrir/Descargar en Android. */}
                  <a
                    className={linkClass}
                    href={readyPdf.objectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setStatus({
                        kind: "ok",
                        text: "PDF abierto. Use el menú del visor (⋮ o compartir) para Guardar.",
                      })
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir
                  </a>
                  <a
                    className={linkClass}
                    href={readyPdf.objectUrl}
                    download={readyPdf.filename}
                    onClick={() =>
                      setStatus({
                        kind: "info",
                        text: "Si no aparece en Descargas, use Compartir → Guardar en Archivos/Drive.",
                      })
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Descargar
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-1.5 rounded-full px-4 font-semibold"
                    disabled={busy}
                    onClick={() => setShowPdfPreview((v) => !v)}
                  >
                    <Eye className="h-4 w-4" />
                    {showPdfPreview ? "Ver reporte" : "Ver PDF"}
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
            En teléfono: Generar con Guardar PDF. Si no sale el menú solo, toque Compartir o Abrir.
          </p>
        ) : null}
      </div>

      {isMobileLike && readyPdf && showPdfPreview ? (
        <iframe
          title="PDF del reporte de caja"
          src={readyPdf.objectUrl}
          className="min-h-0 w-full flex-1 border-0 bg-slate-100"
        />
      ) : (
        <iframe
          ref={iframeRef}
          title="Reporte de caja"
          srcDoc={state.html}
          onLoad={handleIframeLoad}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </div>,
    document.body,
  );
}
