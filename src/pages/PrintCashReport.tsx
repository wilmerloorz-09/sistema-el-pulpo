import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

function decodeReportPayload(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    const binary = atob(decodeURIComponent(encoded));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export default function PrintCashReport() {
  const [searchParams] = useSearchParams();
  const [html, setHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setHtml(decodeReportPayload(searchParams.get("d")));
  }, [searchParams]);

  const handlePrint = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.focus();
      frameWindow.print();
      return;
    }
    window.print();
  };

  if (!html) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <p className="text-sm text-slate-600">Reporte no disponible.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="no-print flex shrink-0 items-center justify-end gap-2 border-b border-slate-200 px-4 py-3">
        <Button type="button" className="min-h-11 gap-1.5 rounded-full bg-orange-600 px-5 font-bold text-white" onClick={handlePrint}>
          <Printer className="h-4 w-4" />
          Imprimir
        </Button>
        <Button type="button" variant="outline" className="min-h-11 rounded-full px-4" onClick={() => window.history.back()}>
          <X className="h-4 w-4" />
          Volver
        </Button>
      </div>
      <iframe ref={iframeRef} title="Reporte" srcDoc={html} className="min-h-0 w-full flex-1 border-0" />
    </div>
  );
}
