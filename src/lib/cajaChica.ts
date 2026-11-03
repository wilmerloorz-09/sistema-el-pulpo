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

async function subirComprobante(params: {
  sucursalEfectivaId: string;
  movimientoId: string;
  archivo: File | Blob;
  upsert?: boolean;
}): Promise<{ rutaObjeto: string; tamanoBytes: number }> {
  const comprimido = await comprimirImagenComprobante(params.archivo);
  const rutaObjeto = construirRutaComprobanteCajaChica({
    sucursalEfectivaId: params.sucursalEfectivaId,
    movimientoId: params.movimientoId,
  });
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_COMPROBANTES_CAJA_CHICA)
    .upload(rutaObjeto, comprimido, {
      contentType: "image/jpeg",
      upsert: Boolean(params.upsert),
    });
  if (uploadError) {
    throw new Error(uploadError.message || "No se pudo subir el comprobante");
  }
  return { rutaObjeto, tamanoBytes: comprimido.size };
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
    const uploaded = await subirComprobante({
      sucursalEfectivaId: params.sucursalEfectivaId,
      movimientoId,
      archivo: params.archivo,
    });
    rutaObjeto = uploaded.rutaObjeto;
    nombreArchivo = "comprobante.jpg";
    tipoMime = "image/jpeg";
    tamanoBytes = uploaded.tamanoBytes;
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

export async function actualizarMovimientoCajaChica(params: {
  movimientoId: string;
  sucursalEfectivaId: string;
  tipo: CajaChicaTipo;
  monto: number;
  concepto: string;
  notas?: string;
  /** keep = no tocar; replace = nueva foto; clear = quitar */
  comprobante: "keep" | "replace" | "clear";
  archivo?: File | Blob | null;
}): Promise<{ id: string; saldo: number }> {
  let rutaObjeto: string | null = null;
  let nombreArchivo: string | null = null;
  let tipoMime: string | null = null;
  let tamanoBytes: number | null = null;
  const actualizarComprobante = params.comprobante !== "keep";

  if (params.comprobante === "replace") {
    if (!params.archivo) throw new Error("Selecciona una foto para reemplazar el comprobante");
    const uploaded = await subirComprobante({
      sucursalEfectivaId: params.sucursalEfectivaId,
      movimientoId: params.movimientoId,
      archivo: params.archivo,
      upsert: true,
    });
    rutaObjeto = uploaded.rutaObjeto;
    nombreArchivo = "comprobante.jpg";
    tipoMime = "image/jpeg";
    tamanoBytes = uploaded.tamanoBytes;
  }

  const { data, error } = await supabase.rpc("caja_chica_actualizar_movimiento" as any, {
    p_movimiento_id: params.movimientoId,
    p_tipo: params.tipo,
    p_monto: params.monto,
    p_concepto: params.concepto,
    p_notas: params.notas ?? null,
    p_actualizar_comprobante: actualizarComprobante,
    p_ruta_objeto: rutaObjeto,
    p_nombre_archivo: nombreArchivo,
    p_tipo_mime: tipoMime,
    p_tamano_bytes: tamanoBytes,
  } as any);

  if (error) throw error;
  const row = data as { id: string; saldo: number };
  return { id: row.id, saldo: Number(row.saldo) };
}

export async function eliminarMovimientoCajaChica(movimientoId: string): Promise<{ id: string; saldo: number }> {
  const { data, error } = await supabase.rpc("caja_chica_eliminar_movimiento" as any, {
    p_movimiento_id: movimientoId,
  } as any);
  if (error) throw error;
  const row = data as { id: string; saldo: number };
  return { id: row.id, saldo: Number(row.saldo) };
}
