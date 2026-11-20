import { useEffect, useMemo, useRef, useState } from "react";
import { useFrequentProducts, type FrequentProductRow } from "@/hooks/useFrequentProducts";
import { resolveMenuNodeProductId } from "@/lib/inventarioMenuData";
import { dinero } from "../dominio/formato";

type CatalogItem = {
  menuNodeId: string;
  productId: string;
  nombre: string;
  precio: number;
  imageUrl: string | null;
};

type Props = {
  open: boolean;
  branchId: string;
  catalog: CatalogItem[];
  onClose: () => void;
};

export default function ExtraFrecuentesManager({ open, branchId, catalog, onClose }: Props) {
  const { products, isLoading, addProduct, removeProduct, reorderProducts } = useFrequentProducts(
    branchId,
    "EXTRA",
  );
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localProducts, setLocalProducts] = useState<FrequentProductRow[]>([]);
  const pendingOrderRef = useRef<string[] | null>(null);
  const flushingRef = useRef(false);

  useEffect(() => {
    // No pisar el orden local mientras hay un reorden pendiente o en vuelo.
    if (flushingRef.current || pendingOrderRef.current) return;
    setLocalProducts(products);
  }, [products]);

  const listedProducts =
    localProducts.length > 0 || !isLoading ? localProducts : products;

  const already = useMemo(
    () => new Set(listedProducts.map((row) => row.menu_node_id)),
    [listedProducts],
  );

  const disponibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return catalog
      .filter((p) => !already.has(p.menuNodeId))
      .filter((p) => (!q ? true : p.nombre.toLowerCase().includes(q)));
  }, [already, busqueda, catalog]);

  if (!open) return null;

  const onAdd = async (menuNodeId: string) => {
    setError(null);
    setBusyId(menuNodeId);
    try {
      await addProduct.mutateAsync(menuNodeId);
    } catch (e: any) {
      if (String(e?.message) === "ALREADY_IN_LIST") {
        setError("Ese producto ya está en frecuentes de Extra.");
      } else {
        setError(e?.message || "No se pudo agregar.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (rowId: string) => {
    setError(null);
    setBusyId(rowId);
    setLocalProducts((prev) => prev.filter((row) => row.id !== rowId));
    try {
      await removeProduct.mutateAsync(rowId);
    } catch (e: any) {
      setLocalProducts(products);
      setError(e?.message || "No se pudo quitar.");
    } finally {
      setBusyId(null);
    }
  };

  const flushReorder = async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (pendingOrderRef.current) {
        const ids = pendingOrderRef.current;
        pendingOrderRef.current = null;
        try {
          await reorderProducts.mutateAsync(ids);
        } catch (e: any) {
          setError(e?.message || "No se pudo reordenar.");
          setLocalProducts(products);
          pendingOrderRef.current = null;
          break;
        }
      }
    } finally {
      flushingRef.current = false;
      if (pendingOrderRef.current) {
        void flushReorder();
      }
    }
  };

  const onMove = (rowId: string, direction: "up" | "down") => {
    const index = listedProducts.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= listedProducts.length) return;

    const next = [...listedProducts];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const nextWithOrder = next.map((row, i) => ({ ...row, display_order: i + 1 }));

    setError(null);
    setLocalProducts(nextWithOrder);
    pendingOrderRef.current = nextWithOrder.map((row) => row.id);
    void flushReorder();
  };

  return (
    <div className="extra-freq-overlay" role="dialog" aria-modal="true" aria-label="Gestionar frecuentes de Extra">
      <div className="extra-freq-modal">
        <div className="extra-freq-head">
          <div>
            <strong>Frecuentes de Extra</strong>
            <p>Solo afectan la pestaña Más Frecuentes de este módulo.</p>
          </div>
          <button type="button" className="extra-freq-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {error ? <div className="extra-freq-error">{error}</div> : null}

        <div className="extra-freq-body">
          <section className="extra-freq-col">
            <h3>Agregar del catálogo</h3>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto..."
              className="extra-freq-search"
            />
            <div className="extra-freq-scroll">
              <div className="extra-freq-list">
                {disponibles.map((p) => (
                  <button
                    key={p.menuNodeId}
                    type="button"
                    className="extra-freq-item"
                    disabled={busyId === p.menuNodeId || addProduct.isPending}
                    onClick={() => void onAdd(p.menuNodeId)}
                  >
                    {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="thumb">—</span>}
                    <span className="meta">
                      <strong>{p.nombre}</strong>
                      <small>{dinero(p.precio)}</small>
                    </span>
                    <span className="action" aria-hidden>+</span>
                  </button>
                ))}
                {!disponibles.length ? (
                  <p className="extra-freq-empty">
                    {busqueda.trim() ? "Sin coincidencias." : "Todos los productos ya están en la lista."}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="extra-freq-col">
            <h3>Lista actual ({listedProducts.length})</h3>
            <div className="extra-freq-scroll">
              <div className="extra-freq-list">
                {isLoading ? <p className="extra-freq-empty">Cargando…</p> : null}
                {!isLoading
                  && listedProducts.map((row, index) => {
                    const node = row.menu_node;
                    const nombre = node?.name ?? "Producto";
                    const productId = node ? resolveMenuNodeProductId(node) : null;
                    const fromCatalog = productId
                      ? catalog.find((c) => c.productId === productId)
                      : null;
                    const imageUrl = fromCatalog?.imageUrl ?? node?.image_url ?? null;
                    const precio = fromCatalog?.precio ?? Number(node?.price ?? 0);
                    return (
                      <div key={row.id} className="extra-freq-item is-listed">
                        {imageUrl ? <img src={imageUrl} alt="" /> : <span className="thumb">—</span>}
                        <span className="meta">
                          <strong>{nombre}</strong>
                          <small>{dinero(precio)}</small>
                        </span>
                        <div className="extra-freq-move">
                          <button
                            type="button"
                            className="move-btn"
                            disabled={index === 0}
                            onClick={() => onMove(row.id, "up")}
                            aria-label={`Subir ${nombre}`}
                            title="Subir"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="move-btn"
                            disabled={index === listedProducts.length - 1}
                            onClick={() => onMove(row.id, "down")}
                            aria-label={`Bajar ${nombre}`}
                            title="Bajar"
                          >
                            ▼
                          </button>
                        </div>
                        <button
                          type="button"
                          className="action remove"
                          disabled={busyId === row.id || removeProduct.isPending}
                          onClick={() => void onRemove(row.id)}
                          aria-label={`Quitar ${nombre}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                {!isLoading && !listedProducts.length ? (
                  <p className="extra-freq-empty">Aún no hay frecuentes de Extra. Agrégalos a la izquierda.</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        <div className="extra-freq-foot">
          <button type="button" className="extra-freq-done" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
