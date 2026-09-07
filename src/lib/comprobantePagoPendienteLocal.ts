import Dexie, { type Table } from "dexie";
import { supabase } from "@/integrations/supabase/client";
import { guardarComprobantePagoTransferencia } from "@/lib/comprobantePagoTransferencia";

export const MARCADOR_FOTO_COMPROBANTE_PENDIENTE = "FOTO_COMPROBANTE_PENDIENTE:1";
export const MARCADOR_FOTO_COMPROBANTE_OK = "FOTO_COMPROBANTE_PENDIENTE:0";
export const COMPROBANTES_PENDIENTES_QUERY_KEY = "comprobantes-pago-pendientes";

export interface ComprobantePagoPendienteLocal {
  pagoId: string;
  ordenId: string;
  sucursalId: string;
  usuarioId: string;
  /** Contexto operativo que originó el cobro. Ausente únicamente en registros legados. */
  shiftId?: string;
  openingId?: string;
  ordenNumero: number | null;
  ordenCodigo: string | null;
  monto: number | null;
  blob: Blob;
  mimeType: string;
  creadoEn: string;
  ultimoError: string | null;
  intentos: number;
  archivadoEn?: string | null;
  motivoArchivo?: "CAJA_CERRADA" | "LEGACY_SIN_CONTEXTO" | null;
}

class ComprobantesPendientesDB extends Dexie {
  pendientes!: Table<ComprobantePagoPendienteLocal, string>;

  constructor() {
    super("comprobantes_pago_pendientes_db");
    this.version(1).stores({
      pendientes: "pagoId, sucursalId, creadoEn",
    });
    this.version(2).stores({
      pendientes: "pagoId, sucursalId, shiftId, openingId, usuarioId, creadoEn, archivadoEn",
    });
  }
}

const db = new ComprobantesPendientesDB();

function appendNoteMarker(existingNotes: string | null | undefined, marker: string): string {
  const current = (existingNotes ?? "").trim();
  if (!current) return marker;
  if (current.includes(marker)) return current;
  // Evitar tener 0 y 1 a la vez.
  const cleaned = current
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("FOTO_COMPROBANTE_PENDIENTE:"))
    .join("|");
  return cleaned ? `${cleaned}|${marker}` : marker;
}

async function marcarEstadoFotoEnPago(pagoId: string, pendiente: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("payments")
    .select("notes")
    .eq("id", pagoId)
    .maybeSingle();
  if (error || !data) return;

  const notes = appendNoteMarker(
    data.notes,
    pendiente ? MARCADOR_FOTO_COMPROBANTE_PENDIENTE : MARCADOR_FOTO_COMPROBANTE_OK,
  );
  await supabase.from("payments").update({ notes }).eq("id", pagoId);
}

export async function encolarComprobantePagoPendiente(params: {
  pagoId: string;
  ordenId: string;
  sucursalId: string;
  usuarioId: string;
  shiftId: string;
  openingId: string;
  ordenNumero?: number | null;
  ordenCodigo?: string | null;
  monto?: number | null;
  archivo: File | Blob;
}): Promise<void> {
  await db.pendientes.put({
    pagoId: params.pagoId,
    ordenId: params.ordenId,
    sucursalId: params.sucursalId,
    usuarioId: params.usuarioId,
    shiftId: params.shiftId,
    openingId: params.openingId,
    ordenNumero: params.ordenNumero ?? null,
    ordenCodigo: params.ordenCodigo ?? null,
    monto: params.monto ?? null,
    blob: params.archivo,
    mimeType: params.archivo.type || "image/jpeg",
    creadoEn: new Date().toISOString(),
    ultimoError: null,
    intentos: 0,
    archivadoEn: null,
    motivoArchivo: null,
  });
}

export async function listarComprobantesPagoPendientes(
  contexto: {
    sucursalId?: string | null;
    shiftId?: string | null;
    openingId?: string | null;
    openingOpenedAt?: string | null;
    usuarioId?: string | null;
  },
): Promise<ComprobantePagoPendienteLocal[]> {
  const { sucursalId, shiftId, openingId, openingOpenedAt, usuarioId } = contexto;
  if (!sucursalId || !shiftId || !openingId || !openingOpenedAt || !usuarioId) {
    return [];
  }

  const pendientesSucursal = await db.pendientes
    .where("sucursalId")
    .equals(sucursalId)
    .toArray();
  const openingStartedAt = new Date(openingOpenedAt).getTime();
  const archivadoEn = new Date().toISOString();

  for (const pendiente of pendientesSucursal) {
    if (pendiente.shiftId && pendiente.openingId) continue;

    const creadoEn = new Date(pendiente.creadoEn).getTime();
    const perteneceAperturaActual =
      pendiente.usuarioId === usuarioId
      && Number.isFinite(creadoEn)
      && Number.isFinite(openingStartedAt)
      && creadoEn >= openingStartedAt;

    if (perteneceAperturaActual) {
      pendiente.shiftId = shiftId;
      pendiente.openingId = openingId;
      pendiente.archivadoEn = null;
      pendiente.motivoArchivo = null;
    } else {
      pendiente.archivadoEn = pendiente.archivadoEn ?? archivadoEn;
      pendiente.motivoArchivo = pendiente.motivoArchivo ?? "LEGACY_SIN_CONTEXTO";
    }
    await db.pendientes.put(pendiente);
  }

  return pendientesSucursal
    .filter(
      (pendiente) =>
        !pendiente.archivadoEn
        && pendiente.shiftId === shiftId
        && pendiente.openingId === openingId
        && pendiente.usuarioId === usuarioId,
    )
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

export async function obtenerComprobantePagoPendiente(
  pagoId: string,
): Promise<ComprobantePagoPendienteLocal | undefined> {
  return db.pendientes.get(pagoId);
}

export async function eliminarComprobantePagoPendiente(pagoId: string): Promise<void> {
  await db.pendientes.delete(pagoId);
}

export async function archivarComprobantesPagoPendientesDeApertura(params: {
  sucursalId: string;
  shiftId: string;
  openingId: string;
  usuarioId: string;
}): Promise<void> {
  const archivadoEn = new Date().toISOString();
  await db.pendientes
    .where("sucursalId")
    .equals(params.sucursalId)
    .filter(
      (pendiente) =>
        !pendiente.archivadoEn
        && pendiente.shiftId === params.shiftId
        && pendiente.openingId === params.openingId
        && pendiente.usuarioId === params.usuarioId,
    )
    .modify({
      archivadoEn,
      motivoArchivo: "CAJA_CERRADA",
    });
}

export async function subirComprobantePagoPendiente(pagoId: string): Promise<void> {
  const pendiente = await db.pendientes.get(pagoId);
  if (!pendiente) {
    throw new Error("No hay foto pendiente en esta tablet para ese pago.");
  }

  await db.pendientes.update(pagoId, {
    intentos: pendiente.intentos + 1,
    ultimoError: null,
  });

  try {
    await guardarComprobantePagoTransferencia({
      pagoId: pendiente.pagoId,
      sucursalId: pendiente.sucursalId,
      usuarioId: pendiente.usuarioId,
      archivo: pendiente.blob,
    });
    await eliminarComprobantePagoPendiente(pagoId);
    await marcarEstadoFotoEnPago(pagoId, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo subir el comprobante";
    await db.pendientes.update(pagoId, { ultimoError: message });
    await marcarEstadoFotoEnPago(pagoId, true);
    throw error;
  }
}

/**
 * Encola la foto, intenta subir en segundo plano y deja el pendiente si falla.
 * No debe bloquear el cierre del cobro.
 */
export function iniciarSubidaComprobanteEnSegundoPlano(params: {
  pagoId: string;
  ordenId: string;
  sucursalId: string;
  usuarioId: string;
  shiftId: string;
  openingId: string;
  ordenNumero?: number | null;
  ordenCodigo?: string | null;
  monto?: number | null;
  archivo: File | Blob;
  onResult?: (ok: boolean, errorMessage?: string) => void;
}): void {
  void (async () => {
    try {
      await encolarComprobantePagoPendiente(params);
      await subirComprobantePagoPendiente(params.pagoId);
      params.onResult?.(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir el comprobante";
      params.onResult?.(false, message);
    }
  })();
}

export async function reemplazarFotoComprobantePendiente(params: {
  pagoId: string;
  archivo: File | Blob;
  sucursalId: string;
  usuarioId: string;
  shiftId: string;
  openingId: string;
  ordenId: string;
  ordenNumero?: number | null;
  ordenCodigo?: string | null;
  monto?: number | null;
}): Promise<void> {
  await encolarComprobantePagoPendiente({
    pagoId: params.pagoId,
    ordenId: params.ordenId,
    sucursalId: params.sucursalId,
    usuarioId: params.usuarioId,
    shiftId: params.shiftId,
    openingId: params.openingId,
    ordenNumero: params.ordenNumero,
    ordenCodigo: params.ordenCodigo,
    monto: params.monto,
    archivo: params.archivo,
  });
  await subirComprobantePagoPendiente(params.pagoId);
}
