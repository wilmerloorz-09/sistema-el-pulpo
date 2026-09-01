import { useEffect, useRef, useState } from "react";
import { Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shareCashReportPdfBlob } from "@/lib/printHtmlDocument";

type PdfInlineViewerProps = {
  blob: Blob;
  title?: string;
  onClose: () => void;
};

export function PdfInlineViewer({ blob, title = "Reporte de caja", onClose }: PdfInlineViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    const renderPdf = async () => {
      if (!container) return;

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const buffer = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buffer }).promise;

        if (cancelled) return;

        container.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-3 block max-w-full rounded border border-slate-200 bg-white shadow-sm";

          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("No se pudo preparar el visor PDF.");
          }

          await page.render({ canvasContext: context, viewport }).promise;
          fragment.appendChild(canvas);
        }

        if (cancelled) return;
        container.appendChild(fragment);
        setError(null);
      } catch (renderError: unknown) {
        if (cancelled) return;
        const message =
          renderError instanceof Error ? renderError.message : "No se pudo mostrar el PDF.";
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareCashReportPdfBlob(blob, title);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex flex-col bg-slate-100">
      <div className="no-print flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] shadow-sm">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-1.5 rounded-full px-4 font-bold"
            onClick={() => void handleShare()}
            disabled={sharing || loading}
          >
            <Share2 className="h-4 w-4" />
            {sharing ? "Compartiendo…" : "Compartir"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-1.5 rounded-full border-red-300 px-4 font-bold text-red-700 hover:bg-red-50"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
            Cerrar
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Abriendo PDF…</p>
        ) : null}
        {error ? (
          <p className="py-8 text-center text-sm text-red-600">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
