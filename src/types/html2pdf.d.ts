declare module "html2pdf.js" {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: Record<string, unknown>;
    jsPDF?: Record<string, unknown>;
    pagebreak?: { mode?: string | string[] };
  }

  interface Html2PdfWorker {
    set(options: Html2PdfOptions): Html2PdfWorker;
    from(element: HTMLElement | string, type?: string): Html2PdfWorker;
    outputPdf(type: "blob", options?: Record<string, unknown>): Promise<Blob>;
  }

  function html2pdf(): Html2PdfWorker;
  export default html2pdf;
}
