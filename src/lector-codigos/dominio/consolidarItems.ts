import type { ItemOrden } from "./tipos";

export type LineaItemLector = {
  id: string;
  cantidad: number;
  creado_en: string;
};

export type LineaLectorConsolidada = {
  id_producto: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  total: number;
  /** Filas de order_items, más reciente primero. */
  lineas: LineaItemLector[];
};

/** Agrupa por producto; el último agregado queda arriba. */
export function consolidarItemsLector(items: ItemOrden[]): LineaLectorConsolidada[] {
  const map = new Map<string, LineaLectorConsolidada>();

  for (const it of items) {
    if (!it.id_producto || Number(it.cantidad) <= 0) continue;
    const key = it.id_producto;
    const linea: LineaItemLector = {
      id: it.id,
      cantidad: Number(it.cantidad),
      creado_en: it.creado_en ?? "",
    };
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        id_producto: key,
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        precio: Number(it.precio),
        total: Number(it.total),
        lineas: [linea],
      });
      continue;
    }
    prev.cantidad += Number(it.cantidad);
    prev.total += Number(it.total);
    prev.lineas.push(linea);
  }

  for (const grupo of map.values()) {
    grupo.lineas.sort((a, b) => b.creado_en.localeCompare(a.creado_en));
  }

  return [...map.values()].sort((a, b) => {
    const ta = a.lineas[0]?.creado_en ?? "";
    const tb = b.lineas[0]?.creado_en ?? "";
    return tb.localeCompare(ta);
  });
}

/** Selecciones para cancel_order_quantities (quita desde las filas más recientes). */
export function selectionsParaQuitar(
  linea: LineaLectorConsolidada,
  cantidad: number,
): { order_item_id: string; quantity_cancelled: number }[] {
  let restante = Math.max(0, Math.floor(cantidad));
  const out: { order_item_id: string; quantity_cancelled: number }[] = [];
  for (const l of linea.lineas) {
    if (restante <= 0) break;
    const take = Math.min(l.cantidad, restante);
    if (take > 0) {
      out.push({ order_item_id: l.id, quantity_cancelled: take });
      restante -= take;
    }
  }
  return out;
}
