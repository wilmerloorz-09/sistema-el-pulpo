import { supabase } from "@/integrations/supabase/client";
import { dbDelete, dbInsert, dbSelect, dbUpdate } from "@/services/DatabaseService";
import { generateUUID } from "@/lib/uuid";
import type { CampanaPromocional } from "@/types/campanaPromocional";

const TABLA = "campanas_promocionales" as const;

const COLUMNAS =
  "id, titulo, consumo_minimo, porcentaje_descuento, descuento_maximo, dias_vigencia_descuento, cartelera_ofertas, ofertas_cumplidas, activa, creado_el";

function mapCampana(row: Record<string, unknown>): CampanaPromocional {
  return {
    id: String(row.id),
    titulo: String(row.titulo),
    consumo_minimo: Number(row.consumo_minimo),
    porcentaje_descuento: Number(row.porcentaje_descuento),
    descuento_maximo: Number(row.descuento_maximo),
    dias_vigencia_descuento: Number(row.dias_vigencia_descuento),
    cartelera_ofertas: (row.cartelera_ofertas as CampanaPromocional["cartelera_ofertas"]) ?? [],
    ofertas_cumplidas: (row.ofertas_cumplidas as string[]) ?? [],
    activa: Boolean(row.activa),
    creado_el: String(row.creado_el),
  };
}

export async function listarCampanasPromocionales(): Promise<CampanaPromocional[]> {
  const filas = await dbSelect<Record<string, unknown>>(TABLA, {
    select: COLUMNAS,
    orderBy: { column: "creado_el", ascending: false },
    skipLocalCache: true,
  });
  return filas.map(mapCampana);
}

export async function obtenerCampanaPorId(id: string): Promise<CampanaPromocional | null> {
  const filas = await dbSelect<Record<string, unknown>>(TABLA, {
    select: COLUMNAS,
    filters: [{ column: "id", op: "eq", value: id }],
    skipLocalCache: true,
  });
  return filas[0] ? mapCampana(filas[0]) : null;
}

export async function listarCampanasActivas(): Promise<CampanaPromocional[]> {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq("activa", true)
    .order("creado_el", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapCampana(row as Record<string, unknown>));
}

/** @deprecated Preferir listarCampanasActivas cuando puedan coexistir varias activas. */
export async function obtenerCampanaActiva(): Promise<CampanaPromocional | null> {
  const activas = await listarCampanasActivas();
  return activas[0] ?? null;
}

export async function crearCampanaPromocional(
  payload: Omit<CampanaPromocional, "id" | "creado_el" | "ofertas_cumplidas"> & { ofertas_cumplidas?: string[] },
): Promise<CampanaPromocional> {
  const id = generateUUID();
  await dbInsert(TABLA, {
    id,
    ...payload,
    ofertas_cumplidas: payload.ofertas_cumplidas ?? [],
    creado_el: new Date().toISOString(),
  });
  const filas = await dbSelect<Record<string, unknown>>(TABLA, {
    select: COLUMNAS,
    filters: [{ column: "id", op: "eq", value: id }],
    skipLocalCache: true,
  });
  return mapCampana(filas[0]);
}

export async function actualizarCampanaPromocional(
  id: string,
  payload: Partial<Omit<CampanaPromocional, "id" | "creado_el">>,
): Promise<CampanaPromocional> {
  await dbUpdate(TABLA, id, payload);
  const filas = await dbSelect<Record<string, unknown>>(TABLA, {
    select: COLUMNAS,
    filters: [{ column: "id", op: "eq", value: id }],
    skipLocalCache: true,
  });
  return mapCampana(filas[0]);
}

export async function eliminarCampanaPromocional(id: string): Promise<void> {
  await dbDelete(TABLA, id);
}

export async function cerrarOfertaCampana(
  campanaId: string,
  ofertaId: string,
  esGanadora: boolean,
): Promise<{
  campana_id: string;
  oferta_id: string;
  es_ganadora: boolean;
  predicciones_actualizadas: number;
}> {
  const { data, error } = await supabase.rpc("cerrar_oferta_campana", {
    p_campana_id: campanaId,
    p_oferta_id: ofertaId,
    p_es_ganadora: esGanadora,
  });
  if (error) throw error;
  return data as {
    campana_id: string;
    oferta_id: string;
    es_ganadora: boolean;
    predicciones_actualizadas: number;
  };
}

export async function cerrarOfertasCampana(campanaId: string, ofertasGanadoras: string[]): Promise<{
  campana_id: string;
  ofertas_ganadoras: string[];
  ganadas: number;
  perdidas: number;
}> {
  const { data, error } = await supabase.rpc("cerrar_ofertas_campana", {
    p_campana_id: campanaId,
    p_ofertas_ganadoras: ofertasGanadoras,
  });
  if (error) throw error;
  return data as {
    campana_id: string;
    ofertas_ganadoras: string[];
    ganadas: number;
    perdidas: number;
  };
}
