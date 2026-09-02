import { Capacitor, registerPlugin } from "@capacitor/core";

export interface PulpoPrintPlugin {
  printWebView(options?: { jobName?: string }): Promise<{ ok: boolean }>;
  openHtmlInEpsonIPrint(options: {
    uri: string;
  }): Promise<{ opened: boolean; usedChooser?: boolean; package?: string; error?: string }>;
}

export const PulpoPrint = registerPlugin<PulpoPrintPlugin>("PulpoPrint", {
  web: () => import("./pulpoNativePrint.web").then((module) => module.default),
});

/** Impresion nativa en Android WebView; en escritorio usa window.print(). */
export async function printNativeWebView(jobName = "Reporte de caja"): Promise<{
  ok: boolean;
  usedNative: boolean;
  error?: string;
}> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      await PulpoPrint.printWebView({ jobName });
      return { ok: true, usedNative: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo abrir el dialogo de impresion";
      return { ok: false, usedNative: true, error: message };
    }
  }

  try {
    window.print();
    return { ok: true, usedNative: false };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo imprimir";
    return { ok: false, usedNative: false, error: message };
  }
}

export async function openHtmlInEpsonIPrint(uri: string): Promise<{
  ok: boolean;
  usedChooser: boolean;
  error?: string;
}> {
  if (!uri) {
    return { ok: false, usedChooser: false, error: "Archivo del reporte no disponible" };
  }

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const result = await PulpoPrint.openHtmlInEpsonIPrint({ uri });
      if (!result.opened) {
        return {
          ok: false,
          usedChooser: false,
          error: result.error ?? "No se pudo abrir Epson iPrint",
        };
      }
      return { ok: true, usedChooser: Boolean(result.usedChooser) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo abrir Epson iPrint";
      return { ok: false, usedChooser: false, error: message };
    }
  }

  return {
    ok: false,
    usedChooser: false,
    error: "Epson iPrint solo esta disponible en la app de la tablet",
  };
}

export function needsNativePrintApkForAndroid(): boolean {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === "android"
    && !Capacitor.isPluginAvailable("PulpoPrint");
}
