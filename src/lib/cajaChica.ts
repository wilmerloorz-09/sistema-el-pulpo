import { supabase } from "@/integrations/supabase/client";
import { comprimirImagenComprobante } from "@/lib/comprobantePagoTransferencia";
import { generateUUID } from "@/lib/uuid";

export const BUCKET_COMPROBANTES_CAJA_CHICA = "comprobantes-caja-chica";

export type CajaChicaTipo = "EGRESO" | "REPOSICION";

export type CajaChicaEstado = {
  sucursal_id: string;
  sucursal_efectiva_id: string;
  sucursal_efectiva_nombre: string;
  saldo: number;
  comparten: { id: string; name: string }[];
};

export type CajaChicaMovimiento = {
  id: string;
  sucursal_id: string;
  tipo: CajaChicaTipo;
  monto: number;
  concepto: string;
  notas: string | null;
  saldo_antes: number;
  saldo_despues: number;
  ruta_objeto: string | null;
  nombre_bucket: string | null;
  registrado_por_nombre: string | null;
  creado_en: string;
};

export function construirRutaComprobanteCajaChica(params: {
  sucursalEfectivaId: string;
  movimientoId: string;
}): string {
  return `${params.sucursalEfectivaId}/${params.movimientoId}.jpg`;
}

export async function obtenerEstadoCajaChica(sucursalId: string): Promise<CajaChicaEstado> {
  const { data, error } = await supabase.rpc("caja_chica_obtener_estado" as any, {
    p_sucursal_id: sucursalId,
  } as any);
  if (error) throw error;
  const row = data as CajaChicaEstado;
  return {
    ...row,
    saldo: Number(row?.saldo ?? 0),
    comparten: Array.isArray(row?.comparten) ? row.comparten : [],
  };
}

export async function listarMovimientosCajaChica(
  sucursalId: string,
  limit = 50,
  offset = 0,
): Promise<CajaChicaMovimiento[]> {
  const { data, error } = await supabase.rpc("caja_chica_listar_movimientos" as any, {
    p_sucursal_id: sucursalId,
    p_limit: limit,
    p_offset: offset,
  } as any);
  if (error) throw error;
  return ((data as CajaChicaMovimiento[]) ?? []).map((row) => ({
    ...row,
    monto: Number(row.monto),
    saldo_antes: Number(row.saldo_antes),
    saldo_despues: Number(row.saldo_despues),
  }));
}

export async function urlFirmadaComprobanteCajaChica(
  rutaObjeto: string,
  bucket = BUCKET_COMPROBANTES_CAJA_CHICA,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(rutaObjeto, 60 * 30);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function registrarMovimientoCajaChica(params: {
  sucursalId: string;
  sucursalEfectivaId: string;
  tipo: CajaChicaTipo;
  monto: number;
  concepto: string;
  notas?: string;
  archivo?: File | Blob | null;
}): Promise<{ id: string; saldo_despues: number }> {
  const movimientoId = generateUUID();
  let rutaObjeto: string | null = null;
  let nombreArchivo: string | null = null;
  let tipoMime: string | null = null;
  let tamanoBytes: number | null = null;

  if (params.archivo) {
    const comprimido = await comprimirImagenComprobante(params.archivo);
    rutaObjeto = construirRutaComprobanteCajaChica({
      sucursalEfectivaId: params.sucursalEfectivaId,
      movimientoId,
    });
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_COMPROBANTES_CAJA_CHICA)
      .upload(rutaObjeto, comprimido, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploadError) {
      throw new Error(uploadError.message || "No se pudo subir el comprobante");
    }
    nombreArchivo = "comprobante.jpg";
    tipoMime = "image/jpeg";
    tamanoBytes = comprimido.size;
  }

  const { data, error } = await supabase.rpc("caja_chica_registrar_movimiento" as any, {
    p_sucursal_id: params.sucursalId,
    p_tipo: params.tipo,
    p_monto: params.monto,
    p_concepto: params.concepto,
    p_notas: params.notas ?? null,
    p_movimiento_id: movimientoId,
    p_ruta_objeto: rutaObjeto,
    p_nombre_archivo: nombreArchivo,
    p_tipo_mime: tipoMime,
    p_tamano_bytes: tamanoBytes,
  } as any);

  if (error) {
    if (rutaObjeto) {
      await supabase.storage.from(BUCKET_COMPROBANTES_CAJA_CHICA).remove([rutaObjeto]).catch(() => undefined);
    }
    throw error;
  }

  const row = data as { id: string; saldo_despues: number };
  return { id: row.id, saldo_despues: Number(row.saldo_despues) };
}
