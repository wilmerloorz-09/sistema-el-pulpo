import { supabase } from "@/integrations/supabase/client";
import { generateUUID } from "@/lib/uuid";

export const BUCKET_COMPROBANTES_PAGO = "comprobantes-pago";

export async function comprimirImagenComprobante(
  archivo: File | Blob,
  maxDim = 1200,
  calidad = 0.8,
): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > height && width > maxDim) {
        height *= maxDim / width;
        width = maxDim;
      } else if (height > maxDim) {
        width *= maxDim / height;
        height = maxDim;
      }

      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(archivo);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else resolve(archivo);
        },
        "image/jpeg",
        calidad,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(archivo);
    };
    img.src = url;
  });
}

export function construirRutaComprobantePago(params: {
  sucursalId: string;
  pagoId: string;
  comprobanteId: string;
}): string {
  return `${params.sucursalId}/pagos/${params.pagoId}/${params.comprobanteId}.jpg`;
}

/**
 * Sube la foto a Storage e inserta metadatos en `comprobantes_pago`.
 * No debe revertir el cobro si falla: el llamador decide el manejo.
 */
export async function guardarComprobantePagoTransferencia(params: {
  pagoId: string;
  sucursalId: string;
  usuarioId: string;
  archivo: File | Blob;
}): Promise<{ comprobanteId: string; rutaObjeto: string }> {
  const comprobanteId = generateUUID();
  const rutaObjeto = construirRutaComprobantePago({
    sucursalId: params.sucursalId,
    pagoId: params.pagoId,
    comprobanteId,
  });

  const comprimido = await comprimirImagenComprobante(params.archivo);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_COMPROBANTES_PAGO)
    .upload(rutaObjeto, comprimido, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || "No se pudo subir el comprobante");
  }

  const { error: insertError } = await supabase.from("comprobantes_pago").insert({
    id: comprobanteId,
    pago_id: params.pagoId,
    sucursal_id: params.sucursalId,
    nombre_bucket: BUCKET_COMPROBANTES_PAGO,
    ruta_objeto: rutaObjeto,
    nombre_archivo: "comprobante.jpg",
    tipo_mime: "image/jpeg",
    tamano_bytes: comprimido.size,
    subido_por_usuario_id: params.usuarioId,
  });

  if (insertError) {
    void supabase.storage.from(BUCKET_COMPROBANTES_PAGO).remove([rutaObjeto]);
    throw new Error(insertError.message || "No se pudo registrar el comprobante");
  }

  return { comprobanteId, rutaObjeto };
}
