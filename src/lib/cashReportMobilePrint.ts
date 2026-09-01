import { Capacitor } from "@capacitor/core";
import { parseReportHtml } from "@/lib/printHtmlDocument";

export type MobileCashReportPrintResult = "shared" | "failed";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("No se pudo leer el PDF."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el PDF."));
    reader.readAsDataURL(blob);
  });
}

function buildPdfSourceElement(html: string): { element: HTMLElement; cleanup: () => void } {
  const { styles, bodyHtml } = parseReportHtml(html);
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:794px",
    "background:#fff",
    "z-index:-9999",
    "opacity:0.01",
    "pointer-events:none",
  ].join(";");
  wrapper.innerHTML = `<style>${styles}</style><div class="cash-report-print-document">${bodyHtml}</div>`;
  document.body.appendChild(wrapper);
  return {
    element: wrapper,
    cleanup: () => wrapper.remove(),
  };
}

async function generateCashReportPdfBlob(html: string): Promise<Blob> {
  const { element, cleanup } = buildPdfSourceElement(html);
  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const blob = await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(element)
      .outputPdf("blob");

    if (!(blob instanceof Blob)) {
      throw new Error("No se pudo crear el PDF.");
    }
    return blob;
  } finally {
    cleanup();
  }
}

/**
 * Tablet/móvil: genera PDF y abre el menú nativo de Android
 * (Epson iPrint, Drive, Gmail, etc.). Un solo paso, sin pantallas extra.
 */
export async function printCashReportOnMobile(html: string): Promise<MobileCashReportPrintResult> {
  const filename = `reporte-caja-${Date.now()}.pdf`;

  try {
    const blob = await generateCashReportPdfBlob(html);

    if (Capacitor.isNativePlatform()) {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
      ]);

      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });

      const { uri } = await Filesystem.getUri({
        directory: Directory.Cache,
        path: filename,
      });

      await Share.share({
        title: "Reporte de caja",
        text: "Reporte de caja",
        url: uri,
        dialogTitle: "Imprimir reporte",
      });
      return "shared";
    }

    const file = new File([blob], filename, { type: "application/pdf" });
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      const payload = { files: [file], title: "Reporte de caja", text: "Reporte de caja" };
      if (typeof navigator.canShare !== "function" || navigator.canShare(payload)) {
        await navigator.share(payload);
        return "shared";
      }
    }

    return "failed";
  } catch (error: unknown) {
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return "shared";
    }
    console.error("[cash-report-mobile-print]", error);
    return "failed";
  }
}
