import { supabase } from "@/integrations/supabase/client";
import type { Banco } from "@/hooks/useBancosActivos";

export interface AnalisisComprobanteTransferencia {
  numeroTransferencia: string | null;
  monto: number | null;
  bancoOrigen: string | null;
  bancoDestino: string | null;
  titularDestino: string | null;
  cuentaDestino: string | null;
  fechaTransferencia: string | null;
  confianza: number;
  observaciones: string;
}

interface FunctionPayload {
  data?: {
    numero_transferencia?: unknown;
    monto?: unknown;
    banco_origen?: unknown;
    banco_destino?: unknown;
    titular_destino?: unknown;
    cuenta_destino?: unknown;
    fecha_transferencia?: unknown;
    confianza?: unknown;
    observaciones?: unknown;
  };
  error?: unknown;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function buscarBancoDetectado(
  nombreDetectado: string | null,
  bancos: Banco[],
): Banco | null {
  if (!nombreDetectado) return null;
  const detected = normalizeText(nombreDetectado);
  if (!detected) return null;

  return bancos.find((banco) => {
    const configured = normalizeText(banco.nombre);
    return configured === detected
      || configured.includes(detected)
      || detected.includes(configured);
  }) ?? null;
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = "No se pudo leer el comprobante. Ingresa los datos manualmente.";
  if (!error || typeof error !== "object") return fallback;

  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    } catch {
      // La respuesta puede no ser JSON; se usa el mensaje seguro.
    }
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

async function prepararImagenParaAnalisis(imagen: File | Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return imagen;

  try {
    const bitmap = await createImageBitmap(imagen);
    // Suficiente para OCR de comprobantes, con bastante menos peso de subida
    // que la foto original de la camara.
    const maxDimension = 1400;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return imagen;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ?? imagen),
        "image/jpeg",
        0.84,
      );
    });
  } catch {
    return imagen;
  }
}

export async function analizarComprobanteTransferencia(
  imagen: File | Blob,
  bancos: Banco[],
  montoEsperado: number,
): Promise<AnalisisComprobanteTransferencia> {
  const imagenOptimizada = await prepararImagenParaAnalisis(imagen);

  const analizarConDetalle = async (
    detalle: "low" | "high",
  ): Promise<AnalisisComprobanteTransferencia> => {
    const formData = new FormData();
    formData.append(
      "imagen",
      imagenOptimizada,
      "comprobante-analisis.jpg",
    );
    formData.append("detalle", detalle);
    formData.append("bancos", bancos.map((banco) => banco.nombre).join(", "));
    if (Number.isFinite(montoEsperado) && montoEsperado > 0) {
      formData.append("monto_esperado", montoEsperado.toFixed(2));
    }

    const { data, error } = await supabase.functions.invoke<FunctionPayload>(
      "analizar-comprobante-transferencia",
      { body: formData },
    );

    if (error) throw new Error(await getFunctionErrorMessage(error));
    if (!data?.data) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "La lectura no devolvió datos. Ingresa los datos manualmente.",
      );
    }

    const result = data.data;
    return {
      numeroTransferencia:
        typeof result.numero_transferencia === "string"
          ? result.numero_transferencia.trim() || null
          : null,
      monto:
        typeof result.monto === "number"
          && Number.isFinite(result.monto)
          && result.monto > 0
          ? Math.round(result.monto * 100) / 100
          : null,
      bancoOrigen:
        typeof result.banco_origen === "string"
          ? result.banco_origen.trim() || null
          : null,
      bancoDestino:
        typeof result.banco_destino === "string"
          ? result.banco_destino.trim() || null
          : null,
      titularDestino:
        typeof result.titular_destino === "string"
          ? result.titular_destino.trim() || null
          : null,
      cuentaDestino:
        typeof result.cuenta_destino === "string"
          ? result.cuenta_destino.trim() || null
          : null,
      fechaTransferencia:
        typeof result.fecha_transferencia === "string"
          ? result.fecha_transferencia.trim() || null
          : null,
      confianza:
        typeof result.confianza === "number"
          ? Math.max(0, Math.min(1, result.confianza))
          : 0,
      observaciones:
        typeof result.observaciones === "string"
          ? result.observaciones.trim()
          : "",
    };
  };

  // La mayoría de comprobantes claros se resuelve con una lectura rápida.
  // Si faltan los dos datos críticos del cobro, repetimos automáticamente con
  // mayor detalle para no sacrificar confiabilidad por velocidad.
  const lecturaRapida = await analizarConDetalle("low");
  if (lecturaRapida.numeroTransferencia && lecturaRapida.monto) {
    return lecturaRapida;
  }

  return analizarConDetalle("high");
}
