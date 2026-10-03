import { supabase } from "@/integrations/supabase/client";

/** sucursal_id -> sucursal dueña del inventario (bodega sucursal y nevera). */
type MapaInventarioSucursal = Map<string, string>;

let mapaPromise: Promise<MapaInventarioSucursal> | null = null;

export function cargarMapaInventarioSucursal(): Promise<MapaInventarioSucursal> {
  if (!mapaPromise) {
    mapaPromise = (async () => {
      const { data, error } = await supabase.rpc("obtener_inventario_sucursales" as any);
      if (error) throw error;
      const mapa: MapaInventarioSucursal = new Map();
      for (const row of (data as { sucursal_id: string; inventario_sucursal_id: string }[]) ?? []) {
        mapa.set(row.sucursal_id, row.inventario_sucursal_id);
      }
      return mapa;
    })().catch((error) => {
      mapaPromise = null;
      throw error;
    });
  }
  return mapaPromise;
}

export async function resolverSucursalInventario(sucursalId: string): Promise<string> {
  const mapa = await cargarMapaInventarioSucursal();
  return mapa.get(sucursalId) ?? sucursalId;
}

/** Todas las sucursales que usan el mismo inventario que `sucursalId` (incluida ella). */
export async function sucursalesQueCompartenInventario(sucursalId: string): Promise<string[]> {
  const mapa = await cargarMapaInventarioSucursal();
  const efectiva = mapa.get(sucursalId) ?? sucursalId;
  const ids = new Set<string>([sucursalId]);
  for (const [id, inventarioId] of mapa) {
    if (inventarioId === efectiva) ids.add(id);
  }
  return [...ids];
}

/** "El Pulpo 1 - Mañana" + "El Pulpo 1 - Tarde" -> "El Pulpo 1 (Mañana y Tarde)". */
export function nombreGrupoInventario(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? "";
  let prefijo = nombres[0];
  for (const nombre of nombres.slice(1)) {
    let i = 0;
    while (i < prefijo.length && i < nombre.length && prefijo[i] === nombre[i]) i += 1;
    prefijo = prefijo.slice(0, i);
  }
  const base = prefijo.replace(/[\s\-–—·|/]+$/u, "").trim();
  const sufijos = nombres.map((n) => n.slice(prefijo.length).replace(/^[\s\-–—·|/]+/u, "").trim());
  if (!base || sufijos.some((s) => !s)) return nombres.join(" / ");
  const lista = sufijos.length === 2
    ? `${sufijos[0]} y ${sufijos[1]}`
    : `${sufijos.slice(0, -1).join(", ")} y ${sufijos[sufijos.length - 1]}`;
  return `${base} (${lista})`;
}
