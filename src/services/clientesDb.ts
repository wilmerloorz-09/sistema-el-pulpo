import { supabase } from "@/integrations/supabase/client";
import { dbDelete, dbInsert, dbSelect, dbUpdate } from "@/services/DatabaseService";
import { generateUUID } from "@/lib/uuid";
import type { Cliente, ClienteSexo } from "@/types/cliente";

const TABLA = "clientes" as const;

const COLUMNAS_LISTADO =
  "id, cedula, sexo, nombres, apellidos, celular, correo, direccion, creado_por, creado_el, actualizado_el, saldo_promocional";

export type ClienteInsertPayload = {
  id: string;
  cedula: string;
  sexo: ClienteSexo;
  nombres: string;
  apellidos: string;
  celular: string;
  correo: string | null;
  direccion: string | null;
  creado_por: string;
};

export type ClienteUpdatePayload = Omit<ClienteInsertPayload, "id" | "creado_por">;

/** Lectura del catálogo; búsqueda opcional por cédula o apellidos. */
export async function listarClientes(terminoBusqueda?: string): Promise<Cliente[]> {
  const termino = (terminoBusqueda ?? "").trim();

  if (!termino) {
    return dbSelect<Cliente>(TABLA, {
      select: COLUMNAS_LISTADO,
      orderBy: { column: "apellidos", ascending: true },
      skipLocalCache: true,
    });
  }

  const patron = `%${termino.replace(/[%_]/g, "")}%`;
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS_LISTADO)
    .or(`cedula.ilike.${patron},apellidos.ilike.${patron},nombres.ilike.${patron}`)
    .order("apellidos", { ascending: true })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as Cliente[];
}

/** Alta rápida sin .select() inmediato (hotPath). */
export async function crearCliente(payload: ClienteInsertPayload): Promise<Cliente> {
  await dbInsert<Cliente>(
    TABLA,
    {
      ...payload,
      creado_el: new Date().toISOString(),
      actualizado_el: new Date().toISOString(),
    },
    { hotPath: true },
  );

  return payload as Cliente;
}

export function nuevoIdCliente(): string {
  return generateUUID();
}

/** Actualización con lectura limpia del registro guardado. */
export async function actualizarCliente(id: string, payload: ClienteUpdatePayload): Promise<Cliente> {
  await dbUpdate(TABLA, id, {
    ...payload,
    actualizado_el: new Date().toISOString(),
  });
  const cliente = await obtenerClientePorId(id);
  if (!cliente) {
    throw new Error("No se encontró el cliente actualizado.");
  }
  return cliente;
}

export async function obtenerClientePorId(id: string): Promise<Cliente | null> {
  const filas = await dbSelect<Cliente>(TABLA, {
    select: COLUMNAS_LISTADO,
    filters: [{ column: "id", op: "eq", value: id }],
    skipLocalCache: true,
  });
  return filas[0] ?? null;
}

export async function obtenerClientePorCedula(cedula: string): Promise<Cliente | null> {
  const filas = await dbSelect<Cliente>(TABLA, {
    select: COLUMNAS_LISTADO,
    filters: [{ column: "cedula", op: "eq", value: cedula }],
    skipLocalCache: true,
  });
  return filas[0] ?? null;
}

/** Elimina un comensal del catálogo. */
export async function eliminarCliente(id: string): Promise<void> {
  await dbDelete(TABLA, id);
}
