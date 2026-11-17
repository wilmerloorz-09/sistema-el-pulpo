import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMenuTreeNodes, getMenuTreeQueryKey } from "@/hooks/useMenuTree";
import {
  fetchInventarioStockVendibleMap,
  resolveMenuNodeProductId,
} from "@/lib/inventarioMenuData";
import { dinero } from "../dominio/formato";
import {
  FILA_MARCAS_COCA,
  FILA_MARCAS_PEPSI,
  FILA_OTRAS,
  type MarcaAtajo,
  type ProductoAtajo,
  marcasConStock,
  productosDeMarcaConStock,
  productosFila1,
} from "../dominio/atajosLayout";

type Props = {
  branchId: string;
  disabled?: boolean;
  onAddProduct: (productId: string, nombre: string) => void;
};

export default function AtajosBebidas({ branchId, disabled, onAddProduct }: Props) {
  const [picker, setPicker] = useState<{
    title: string;
    productos: ProductoAtajo[];
  } | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const tocarYAgregar = (key: string, productId: string, nombre: string) => {
    // Quitar y volver a poner la clase para que la animación se repita en clics seguidos.
    setFlashKey(null);
    window.requestAnimationFrame(() => {
      setFlashKey(key);
      window.setTimeout(() => {
        setFlashKey((cur) => (cur === key ? null : cur));
      }, 280);
    });
    onAddProduct(productId, nombre);
  };

  const menuQuery = useQuery({
    queryKey: getMenuTreeQueryKey({ branchId, menuScope: "TABLE" }),
    queryFn: () => fetchMenuTreeNodes({ branchId, menuScope: "TABLE" }),
    enabled: Boolean(branchId),
    staleTime: 60_000,
  });

  const stockQuery = useQuery({
    queryKey: ["lector-stock-vendible", branchId],
    queryFn: () => fetchInventarioStockVendibleMap(branchId),
    enabled: Boolean(branchId),
    staleTime: 30_000,
  });

  const productos = useMemo<ProductoAtajo[]>(() => {
    const stockMap = stockQuery.data;
    const nodes = (menuQuery.data ?? []).filter((n) => n.node_type === "product" && n.is_active);
    return nodes
      .map((node) => {
        const productId = resolveMenuNodeProductId(node);
        if (!productId) return null;
        const stockInfo = stockMap?.get(productId);
        return {
          id: node.id,
          productId,
          nombre: node.name,
          precio: Number(node.price ?? 0),
          imageUrl: node.image_url ?? null,
          stock: stockInfo ? stockInfo.cantidadDisponible : null,
        } satisfies ProductoAtajo;
      })
      .filter((p): p is ProductoAtajo => Boolean(p));
  }, [menuQuery.data, stockQuery.data]);

  const fila1 = useMemo(() => productosFila1(productos), [productos]);
  const marcasCoca = useMemo(
    () => marcasConStock(FILA_MARCAS_COCA, productos),
    [productos],
  );
  const marcasPepsi = useMemo(
    () => marcasConStock(FILA_MARCAS_PEPSI, productos),
    [productos],
  );
  const marcasOtras = useMemo(
    () => marcasConStock(FILA_OTRAS, productos),
    [productos],
  );

  const abrirMarca = (marca: MarcaAtajo) => {
    const matches = productosDeMarcaConStock(productos, marca);
    if (!matches.length) return;
    if (matches.length === 1) {
      tocarYAgregar(`marca-${marca.id}`, matches[0].productId, matches[0].nombre);
      return;
    }
    setPicker({ title: marca.label, productos: matches });
  };

  const elegirProducto = (producto: ProductoAtajo) => {
    setPicker(null);
    tocarYAgregar(`pick-${producto.id}`, producto.productId, producto.nombre);
  };

  return (
    <div className="atajos-bebidas">
      <div className="atajos-row">
        {fila1.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`atajo-product${flashKey === `p-${p.id}` ? " atajo-flash" : ""}`}
            disabled={disabled}
            onClick={() => tocarYAgregar(`p-${p.id}`, p.productId, p.nombre)}
          >
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="atajo-thumb" />
            ) : (
              <span className="atajo-thumb atajo-thumb-empty" />
            )}
            <strong>{p.nombre}</strong>
            <small>{dinero(p.precio)}</small>
          </button>
        ))}
        {!fila1.length && !menuQuery.isLoading ? (
          <p className="atajos-empty">Sin Chifle / jugos con stock</p>
        ) : null}
      </div>

      {marcasCoca.length > 0 ? (
        <div className="atajos-row atajos-row-brands">
          {marcasCoca.map((marca) => (
            <button
              key={marca.id}
              type="button"
              className={`atajo-brand${flashKey === `marca-${marca.id}` ? " atajo-flash" : ""}`}
              disabled={disabled}
              onClick={() => abrirMarca(marca)}
            >
              <span className="atajo-brand-logo">
                <img src={marca.logo} alt="" />
              </span>
              <strong>{marca.label}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {marcasPepsi.length > 0 ? (
        <div className="atajos-row atajos-row-brands">
          {marcasPepsi.map((marca) => (
            <button
              key={marca.id}
              type="button"
              className={`atajo-brand${flashKey === `marca-${marca.id}` ? " atajo-flash" : ""}`}
              disabled={disabled}
              onClick={() => abrirMarca(marca)}
            >
              <span className="atajo-brand-logo">
                <img src={marca.logo} alt="" />
              </span>
              <strong>{marca.label}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {marcasOtras.length > 0 ? (
        <div className="atajos-row atajos-row-brands">
          {marcasOtras.map((marca) => (
            <button
              key={marca.id}
              type="button"
              className={`atajo-brand${flashKey === `marca-${marca.id}` ? " atajo-flash" : ""}`}
              disabled={disabled}
              onClick={() => abrirMarca(marca)}
            >
              <span className="atajo-brand-logo">
                <img src={marca.logo} alt="" />
              </span>
              <strong>{marca.label}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {picker ? (
        <div className="atajo-picker-backdrop" role="presentation" onClick={() => setPicker(null)}>
          <div
            className="atajo-picker"
            role="dialog"
            aria-modal="true"
            aria-label={picker.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="atajo-picker-head">
              <h3>{picker.title}</h3>
              <button type="button" className="btn btn-white" onClick={() => setPicker(null)}>
                Cerrar
              </button>
            </div>
            <div className="atajo-picker-grid">
              {picker.productos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`atajo-product${flashKey === `pick-${p.id}` ? " atajo-flash" : ""}`}
                  disabled={disabled}
                  onClick={() => elegirProducto(p)}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="atajo-thumb" />
                  ) : (
                    <span className="atajo-thumb atajo-thumb-empty" />
                  )}
                  <strong>{p.nombre}</strong>
                  <small>
                    {dinero(p.precio)}
                    {p.stock != null ? ` · stock ${p.stock}` : ""}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
