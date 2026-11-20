import { useMemo, useState } from "react";
import { useFrequentProducts } from "@/hooks/useFrequentProducts";
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
  const { products, isLoading, addProduct, removeProduct } = useFrequentProducts(branchId, "EXTRA");
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const already = useMemo(
    () => new Set(products.map((row) => row.menu_node_id)),
    [products],
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
    try {
      await removeProduct.mutateAsync(rowId);
    } catch (e: any) {
      setError(e?.message || "No se pudo quitar.");
    } finally {
      setBusyId(null);
    }
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
                  <span className="action">+</span>
                </button>
              ))}
              {!disponibles.length ? (
                <p className="extra-freq-empty">
                  {busqueda.trim() ? "Sin coincidencias." : "Todos los productos ya están en la lista."}
                </p>
              ) : null}
            </div>
          </section>

          <section className="extra-freq-col">
            <h3>Lista actual ({products.length})</h3>
            <div className="extra-freq-list">
              {isLoading ? <p className="extra-freq-empty">Cargando…</p> : null}
              {!isLoading
                && products.map((row) => {
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
              {!isLoading && !products.length ? (
                <p className="extra-freq-empty">Aún no hay frecuentes de Extra. Agrégalos a la izquierda.</p>
              ) : null}
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
