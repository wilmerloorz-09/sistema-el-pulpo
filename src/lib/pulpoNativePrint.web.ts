import type { PulpoPrintPlugin } from "@/lib/pulpoNativePrint";

const PulpoPrintWeb: PulpoPrintPlugin = {
  async printWebView() {
    window.print();
    return { ok: true };
  },
  async openHtmlInEpsonIPrint() {
    return { opened: false, usedChooser: false, error: "Solo disponible en la app Android" };
  },
};

export default PulpoPrintWeb;
