import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchFrequentProducts,
  getFrequentProductsQueryKey,
} from "@/hooks/useFrequentProducts";
import {
  fetchMenuTreeNodes,
  getMenuTreeQueryKey,
  type MenuNode,
} from "@/hooks/useMenuTree";
import {
  fetchInventarioBodegaSucursalMap,
  resolveMenuNodeProductId,
} from "@/lib/inventarioMenuData";
import ExtraFrecuentesManager from "./componentes/ExtraFrecuentesManager";
import {
  agregarPorCodigo,
  listarMesasSucursal,
  listarOrdenesAbiertas,
  obtenerSucursalActiva,
} from "./dominio/api";
import {
  esChifle,
  esJugo,
  FILA_MARCAS_COCA,
  FILA_MARCAS_PEPSI,
  FILA_OTRAS,
  normalizarNombreProducto,
} from "./dominio/atajosLayout";
import { dinero, etiquetaTipoOrden, nuevoIdOperacion } from "./dominio/formato";
import type {
  MesaSucursal,
  OrdenAbierta,
  OrdenEnMesa,
  Sucursal,
} from "./dominio/tipos";

const PARA_LLEVAR_ID = "__para-llevar__";
const MARCAS_IMAGEN = [...FILA_MARCAS_COCA, ...FILA_MARCAS_PEPSI, ...FILA_OTRAS];
type CategoriaTab = "frecuentes" | "bebidas" | "jugos" | "otros";

type ImageFit = "cover" | "contain";

type CatalogProduct = {
  menuNodeId: string;
  productId: string;
  nombre: string;
  precio: number;
  imageUrl: string | null;
  imageFit: ImageFit;
  categoryKey: Exclude<CategoriaTab, "frecuentes">;
};

type DraftLine = {
  productId: string;
  nombre: string;
  precio: number;
  imageUrl: string | null;
  imageFit: ImageFit;
  qty: number;
};

/** Archivos con damero u otros defectos: no usar. */
const BAD_LOGOS = new Set([
  "/lector-codigos/marcas/naranja.png",
]);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatClock(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function normCat(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Imagen del producto.
 * Siempre contain: en tablet queda cuadrado y alineado (sin zooms raros).
 */
function resolveProductImage(
  nombre: string,
  imageUrl: string | null | undefined,
): { url: string | null; fit: ImageFit } {
  const raw = String(imageUrl ?? "").trim();
  if (raw) return { url: raw, fit: "contain" };

  if (esChifle(nombre)) {
    return { url: "/lector-codigos/marcas/chifle.jpg", fit: "contain" };
  }

  const n = normalizarNombreProducto(nombre);
  for (const marca of MARCAS_IMAGEN) {
    if (!marca.match(n)) continue;
    if (BAD_LOGOS.has(marca.logo)) continue;
    return { url: marca.logo, fit: "contain" };
  }
  return { url: null, fit: "contain" };
}

function classifyCategory(
  nombre: string,
  pathNames: string[],
): Exclude<CategoriaTab, "frecuentes"> {
  if (esJugo(nombre)) return "jugos";
  if (esChifle(nombre)) return "otros";

  const n = normalizarNombreProducto(nombre);
  const joined = `${pathNames.map(normCat).join(" / ")} ${n}`;
  if (
    joined.includes("bebida")
    || joined.includes("gaseosa")
    || joined.includes("refresco")
    || joined.includes("cerveza")
    || joined.includes("agua")
    || joined.includes("cola")
    || joined.includes("coca")
    || joined.includes("pepsi")
    || joined.includes("fanta")
    || joined.includes("sprite")
    || joined.includes("inca")
  ) {
    return "bebidas";
  }
  if (joined.includes("jugo") || joined.includes("batido") || joined.includes("natural")) {
    return "jugos";
  }
  return "otros";
}

function buildCatalog(nodes: MenuNode[]): CatalogProduct[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const excludedRoots = new Set(
    nodes
      .filter(
        (n) =>
          n.node_type === "category"
          && n.parent_id == null
          && normCat(n.name).includes("plato"),
      )
      .map((n) => n.id),
  );

  const isUnderExcluded = (node: MenuNode) => {
    let cur: MenuNode | undefined = node;
    while (cur) {
      if (excludedRoots.has(cur.id)) return true;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  const pathNames = (node: MenuNode) => {
    const names: string[] = [];
    let cur: MenuNode | undefined = node;
    while (cur) {
      names.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return names;
  };

  const out: CatalogProduct[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (node.node_type !== "product" || !node.is_active) continue;
    if (isUnderExcluded(node)) continue;
    const productId = resolveMenuNodeProductId(node);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const path = pathNames(node);
    const img = resolveProductImage(node.name, node.image_url);
    out.push({
      menuNodeId: node.id,
      productId,
      nombre: node.name,
      precio: Number(node.price ?? 0),
      imageUrl: img.url,
      imageFit: img.fit,
      categoryKey: classifyCategory(node.name, path),
    });
  }

  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function MesaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="8" width="18" height="3" rx="1" fill="currentColor" />
      <path d="M6 11v7M18 11v7M10 11v5M14 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 8h12l-1 12H7L6 8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ExtraStationPage() {
  const { user, signOut, loading: authLoading } = useAuth();

  const [sucursal, setSucursal] = useState<Sucursal | null>(null);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [errorSucursal, setErrorSucursal] = useState<string | null>(null);

  const [mesas, setMesas] = useState<MesaSucursal[]>([]);
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenAbierta[]>([]);
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false);
  const [pickerMesa, setPickerMesa] = useState<{
    mesa: MesaSucursal;
    ordenes: OrdenEnMesa[];
  } | null>(null);
  const pickerRef = useRef<HTMLDialogElement | null>(null);

  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [tab, setTab] = useState<CategoriaTab>("frecuentes");
  const [busqueda, setBusqueda] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [gestionarFrecuentes, setGestionarFrecuentes] = useState(false);

  const ordenActiva = useMemo(
    () => ordenes.find((o) => o.id === ordenId) ?? null,
    [ordenes, ordenId],
  );

  const mesaActiva = useMemo(() => {
    if (mesaId === PARA_LLEVAR_ID) return null;
    return mesas.find((m) => m.id === mesaId) ?? null;
  }, [mesas, mesaId]);

  const llevarSeleccionado = mesaId === PARA_LLEVAR_ID || (!mesaId && Boolean(ordenId));

  const tituloPedidos = useMemo(() => {
    if (llevarSeleccionado) return "Pedidos Para Llevar";
    if (mesaActiva) return `Pedidos de la ${mesaActiva.nombre}`;
    return "Pedidos";
  }, [llevarSeleccionado, mesaActiva]);

  // CSS aislado: entra con Extra y se quita al salir.
  useEffect(() => {
    const cssId = "extra-station-css";
    const bodyClass = "extra-station-active";
    let link = document.getElementById(cssId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "/lector-codigos/extra-station.css?v=20261119-extra-freq-arrows-h";
      document.head.appendChild(link);
    }
    document.documentElement.classList.add(bodyClass);
    document.body.classList.add(bodyClass);
    return () => {
      document.getElementById(cssId)?.remove();
      document.documentElement.classList.remove(bodyClass);
      document.body.classList.remove(bodyClass);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      setCargandoSucursales(true);
      setErrorSucursal(null);
      try {
        const activa = await obtenerSucursalActiva();
        if (cancel) return;
        if (!activa) {
          setSucursal(null);
          setErrorSucursal(
            "No hay sucursal activa. Entra desde el menú con una sucursal ya seleccionada.",
          );
          return;
        }
        setSucursal(activa);
      } catch (e: any) {
        if (!cancel) setErrorSucursal(e?.message || "No se pudo cargar la sucursal activa");
      } finally {
        if (!cancel) setCargandoSucursales(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [user]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.clearInterval(t);
    };
  }, []);

  const refrescarOrdenes = useCallback(async () => {
    if (!sucursal) return;
    setCargandoOrdenes(true);
    try {
      const [mesasList, ordenesList] = await Promise.all([
        listarMesasSucursal(sucursal.id),
        listarOrdenesAbiertas(sucursal.id),
      ]);
      setMesas(mesasList);
      setOrdenes(ordenesList);

      setOrdenId((prevOrden) => {
        if (!prevOrden) return null;
        const stillOpen = ordenesList.some((o) => o.id === prevOrden);
        return stillOpen ? prevOrden : null;
      });
      setMesaId((prevMesa) => {
        if (!prevMesa) return null;
        if (prevMesa === PARA_LLEVAR_ID) return PARA_LLEVAR_ID;
        return mesasList.some((m) => m.id === prevMesa) ? prevMesa : null;
      });
    } catch (e: any) {
      setErrorMsg(e?.message || "Error al cargar mesas/órdenes");
    } finally {
      setCargandoOrdenes(false);
    }
  }, [sucursal]);

  useEffect(() => {
    if (!sucursal) return;
    void refrescarOrdenes();
    const t = window.setInterval(() => void refrescarOrdenes(), 20_000);
    return () => window.clearInterval(t);
  }, [sucursal, refrescarOrdenes]);

  useEffect(() => {
    setDraft([]);
    setErrorMsg(null);
  }, [ordenId, mesaId]);

  useEffect(() => {
    const dialog = pickerRef.current;
    if (!dialog) return;
    if (pickerMesa) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pickerMesa]);

  const menuQuery = useQuery({
    queryKey: getMenuTreeQueryKey({ branchId: sucursal?.id, menuScope: "TABLE" }),
    queryFn: () => fetchMenuTreeNodes({ branchId: sucursal!.id, menuScope: "TABLE" }),
    enabled: Boolean(sucursal?.id),
    staleTime: 60_000,
  });

  const frequentQuery = useQuery({
    queryKey: getFrequentProductsQueryKey(sucursal?.id, "EXTRA"),
    queryFn: () => fetchFrequentProducts(sucursal!.id, "EXTRA"),
    enabled: Boolean(sucursal?.id),
    staleTime: 30_000,
  });

  const stockBodegaQuery = useQuery({
    queryKey: ["extra-stock-bodega-sucursal", sucursal?.id],
    queryFn: () => fetchInventarioBodegaSucursalMap(sucursal!.id),
    enabled: Boolean(sucursal?.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const stockBodegaMap = stockBodegaQuery.data;

  const tieneStockBodega = useCallback(
    (productId: string) => (stockBodegaMap?.get(productId)?.cantidadDisponible ?? 0) > 0,
    [stockBodegaMap],
  );

  const catalog = useMemo(() => {
    const all = buildCatalog(menuQuery.data ?? []);
    // Sin mapa aún: no mostrar nada (evita flash de productos sin stock).
    if (!stockBodegaMap) return [];
    return all.filter((p) => tieneStockBodega(p.productId));
  }, [menuQuery.data, stockBodegaMap, tieneStockBodega]);

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogProduct>();
    for (const p of catalog) map.set(p.productId, p);
    return map;
  }, [catalog]);

  const frecuentes = useMemo(() => {
    const rows = frequentQuery.data ?? [];
    const out: CatalogProduct[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const node = row.menu_node;
      if (!node || !node.is_active) continue;
      const productId = resolveMenuNodeProductId(node);
      if (!productId || seen.has(productId)) continue;
      if (!tieneStockBodega(productId)) continue;
      seen.add(productId);
      const fromCatalog = catalogById.get(productId);
      if (fromCatalog) {
        out.push(fromCatalog);
      } else {
        const img = resolveProductImage(node.name, node.image_url);
        out.push({
          menuNodeId: node.id,
          productId,
          nombre: node.name,
          precio: Number(node.price ?? 0),
          imageUrl: img.url,
          imageFit: img.fit,
          categoryKey: classifyCategory(node.name, [node.name]),
        });
      }
    }
    return out;
  }, [frequentQuery.data, catalogById, tieneStockBodega]);

  const productosTab = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base =
      tab === "frecuentes"
        ? frecuentes
        : catalog.filter((p) => p.categoryKey === tab);
    if (!q) return base;
    return base.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [tab, busqueda, frecuentes, catalog]);

  const ordenesLlevar = useMemo(
    () => ordenes.filter((o) => etiquetaTipoOrden(o.tipo) === "llevar"),
    [ordenes],
  );

  const totalLlevar = useMemo(
    () => ordenesLlevar.reduce((sum, o) => sum + (o.saldo > 0 ? o.saldo : o.total), 0),
    [ordenesLlevar],
  );

  const totalDraft = useMemo(
    () => draft.reduce((sum, line) => sum + line.precio * line.qty, 0),
    [draft],
  );

  const mesaLibreSeleccionada = Boolean(mesaActiva && mesaActiva.estado === "libre");

  const limpiarDraft = () => {
    setDraft([]);
    setErrorMsg(null);
  };

  const agregarAlDraft = (producto: CatalogProduct) => {
    if (!ordenActiva) {
      setErrorMsg(
        mesaLibreSeleccionada
          ? "Esta mesa está libre. Ábrela en el POS antes de registrar extras."
          : "Selecciona una mesa u orden con cuenta abierta.",
      );
      return;
    }
    setErrorMsg(null);
    setDraft((prev) => {
      const idx = prev.findIndex((l) => l.productId === producto.productId);
      if (idx < 0) {
        return [
          ...prev,
          {
            productId: producto.productId,
            nombre: producto.nombre,
            precio: producto.precio,
            imageUrl: producto.imageUrl,
            imageFit: producto.imageFit,
            qty: 1,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      return next;
    });
  };

  const quitarLineaDraft = (productId: string) => {
    setDraft((prev) => prev.filter((l) => l.productId !== productId));
  };

  const aplicarOrdenMesa = (m: MesaSucursal, ordenIdElegida: string | null) => {
    setPickerMesa(null);
    setErrorMsg(null);

    if (m.id === PARA_LLEVAR_ID) {
      setMesaId(PARA_LLEVAR_ID);
      setOrdenId(ordenIdElegida);
      if (!ordenIdElegida) {
        setErrorMsg("No hay órdenes para llevar abiertas.");
      }
      return;
    }

    setMesaId(m.id);
    if (ordenIdElegida) {
      setOrdenId(ordenIdElegida);
    } else {
      setOrdenId(null);
      if (m.estado === "libre") {
        setErrorMsg("Mesa libre: puedes seleccionarla, pero ábrela en el POS para registrar extras.");
      } else {
        setErrorMsg("Esta mesa no tiene orden abierta.");
      }
    }
  };

  const seleccionarParaLlevar = () => {
    const candidatas: OrdenEnMesa[] = ordenesLlevar.map((o) => ({
      id: o.id,
      codigo: o.codigo,
      total: o.saldo > 0 ? o.saldo : o.total,
    }));

    if (!candidatas.length) {
      setMesaId(PARA_LLEVAR_ID);
      setOrdenId(null);
      setErrorMsg("No hay órdenes para llevar abiertas.");
      return;
    }

    if (candidatas.length === 1) {
      setMesaId(PARA_LLEVAR_ID);
      setOrdenId(candidatas[0].id);
      setErrorMsg(null);
      return;
    }

    setPickerMesa({
      mesa: {
        id: PARA_LLEVAR_ID,
        nombre: "Para Llevar",
        orden_visual: 0,
        estado: "ocupada",
        id_orden_activa: candidatas[0].id,
        total_pendiente: totalLlevar,
        ordenes: candidatas,
        cantidad_ordenes: candidatas.length,
        especial: false,
        creado_por: null,
      },
      ordenes: candidatas,
    });
  };

  const seleccionarMesa = (m: MesaSucursal) => {
    const porOverview = m.ordenes.length
      ? m.ordenes
      : m.id_orden_activa
        ? [{ id: m.id_orden_activa, codigo: null, total: m.total_pendiente }]
        : [];

    const porLista = ordenes
      .filter((o) => o.id_mesa === m.id && etiquetaTipoOrden(o.tipo) === "mesa")
      .map((o) => ({
        id: o.id,
        codigo: o.codigo,
        total: o.saldo > 0 ? o.saldo : o.total,
      }));

    const byId = new Map<string, OrdenEnMesa>();
    for (const row of [...porOverview, ...porLista]) {
      const prev = byId.get(row.id);
      byId.set(row.id, {
        id: row.id,
        codigo: row.codigo || prev?.codigo || null,
        total: Math.max(prev?.total ?? 0, row.total ?? 0),
        especial: Boolean((row as OrdenEnMesa).especial || prev?.especial),
      });
    }
    const candidatas = [...byId.values()];

    if (candidatas.length > 1) {
      setErrorMsg(null);
      setPickerMesa({ mesa: m, ordenes: candidatas });
      return;
    }

    aplicarOrdenMesa(m, candidatas[0]?.id ?? null);
  };

  const registrarExtras = async () => {
    if (!sucursal || !ordenActiva) {
      setErrorMsg(
        mesaLibreSeleccionada
          ? "Esta mesa está libre. Ábrela en el POS antes de registrar."
          : "Selecciona una mesa u orden abierta.",
      );
      return;
    }
    if (!draft.length) {
      setErrorMsg("Agrega productos antes de registrar.");
      return;
    }

    setRegistrando(true);
    setErrorMsg(null);
    try {
      for (const line of draft) {
        await agregarPorCodigo({
          idOperacion: nuevoIdOperacion(),
          idOrden: ordenActiva.id,
          codigo: null,
          idProducto: line.productId,
          cantidad: line.qty,
          fuente: "extra",
        });
      }
      setDraft([]);
      await refrescarOrdenes();
    } catch (e: any) {
      setErrorMsg(e?.message || "No se pudieron registrar los extras.");
    } finally {
      setRegistrando(false);
    }
  };

  if (authLoading || cargandoSucursales) {
    return (
      <div className="extra-station" style={{ placeItems: "center", display: "grid" }}>
        <p>Cargando…</p>
      </div>
    );
  }

  if (!sucursal) {
    return (
      <div className="extra-station" style={{ placeItems: "center", display: "grid", padding: 24 }}>
        <div style={{ maxWidth: 420, background: "#fff", borderRadius: 16, padding: 24 }}>
          <h1 style={{ marginTop: 0 }}>Extra</h1>
          <p>{errorSucursal || "No hay sucursal activa."}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Link to="/mesas">Ir a Mesas</Link>
            <button type="button" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="extra-station">
      <header className="extra-topbar">
        <div className="extra-brand">
          <img src="/logo.png" alt="" />
          <strong>Picantería El Pulpo</strong>
        </div>
        <div className="extra-top-center">
          <span title={online ? "Conectado" : "Sin conexión"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 18.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-4.95-3.05a7 7 0 0 1 9.9 0l-1.4 1.4a5 5 0 0 0-7.1 0l-1.4-1.4Zm-2.85-2.85a11 11 0 0 1 15.6 0l-1.4 1.4a9 9 0 0 0-12.8 0l-1.4-1.4Z" />
            </svg>
            {online ? "En línea" : "Sin conexión"}
          </span>
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4 10h16v9H4v-9Zm2-6h3v2h6V4h3v2h2v3H4V6h2V4Z" />
            </svg>
            Sucursal {sucursal.nombre}
          </span>
        </div>
        <div className="extra-top-right">
          <span className="extra-clock">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm11 8H6v10h12V10Z" />
            </svg>
            {formatClock(now)}
          </span>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="extra-icon-btn"
              aria-label="Ajustes"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.8c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.1.54 0 .68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
              </svg>
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 42,
                  background: "#fff",
                  color: "#1f3a2e",
                  borderRadius: 12,
                  border: "1px solid #d5e0d4",
                  minWidth: 180,
                  zIndex: 20,
                  boxShadow: "0 10px 30px rgba(0,0,0,.12)",
                  overflow: "hidden",
                }}
              >
                <Link
                  to="/mesas"
                  className="extra-back-link"
                  style={{ display: "block", padding: "12px 14px", color: "#1f3a2e", fontWeight: 600 }}
                  onClick={() => setMenuOpen(false)}
                >
                  Volver al sistema
                </Link>
                <button
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    background: "transparent",
                    padding: "12px 14px",
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#1f3a2e",
                  }}
                  onClick={() => {
                    setMenuOpen(false);
                    setGestionarFrecuentes(true);
                  }}
                >
                  Gestionar Frecuentes
                </button>
                <button
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    background: "transparent",
                    padding: "12px 14px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="extra-body">
        <section className="extra-panel" aria-label="Mesas">
          <div className="extra-panel-head">
            <MesaIcon />
            Mesas
            {cargandoOrdenes ? <small style={{ fontWeight: 500, opacity: 0.7 }}> · sync</small> : null}
          </div>
          <div className="extra-mesas-grid">
            <button
              type="button"
              className={`extra-mesa-card para-llevar ${llevarSeleccionado ? "selected" : ""} ${
                ordenesLlevar.length ? "ocupada" : "libre"
              }`}
              onClick={seleccionarParaLlevar}
            >
              <strong>Para Llevar</strong>
              <span className="mesa-ico">
                <BagIcon />
              </span>
              <span className="mesa-pill">
                {ordenesLlevar.length
                  ? `Pedidos: ${ordenesLlevar.length}`
                  : "Sin órdenes"}
              </span>
            </button>

            {mesas.map((m) => {
              const selected = m.id === mesaId;
              const libre = m.estado === "libre";
              const pedidos = Math.max(m.cantidad_ordenes, m.ordenes.length);
              const numero =
                m.nombre.replace(/^Mesa\s*/i, "").trim() || m.nombre;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`extra-mesa-card solo-numero ${libre ? "libre" : m.estado === "por_cobrar" ? "por_cobrar" : "ocupada"} ${
                    selected ? "selected" : ""
                  }`}
                  title={m.nombre}
                  aria-label={m.nombre}
                  onClick={() => seleccionarMesa(m)}
                >
                  <strong className="mesa-numero">{numero}</strong>
                  <span className="mesa-pill">
                    {libre ? "Libre" : `Pedidos: ${Math.max(1, pedidos)}`}
                  </span>
                </button>
              );
            })}

            {!mesas.length && !cargandoOrdenes ? (
              <div style={{ gridColumn: "1 / -1", padding: 12, color: "#809284", fontSize: 13 }}>
                No hay mesas habilitadas en esta sucursal.
              </div>
            ) : null}
          </div>
        </section>

        <section className="extra-panel extra-catalog" aria-label="Catálogo">
          <div className="extra-tabs">
            {(
              [
                ["frecuentes", "Más Frecuentes"],
                ["bebidas", "Bebidas"],
                ["jugos", "Jugos"],
                ["otros", "Otros"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="extra-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="#809284" strokeWidth="2" />
              <path d="M16.5 16.5 21 21" stroke="#809284" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto..."
              inputMode="search"
            />
          </div>

          <div className="extra-products">
            {productosTab.map((p) => (
              <button
                key={p.productId}
                type="button"
                className="extra-product"
                onClick={() => agregarAlDraft(p)}
                aria-label={`Agregar ${p.nombre}`}
              >
                <div
                  className={`extra-product-img fit-${p.imageFit}${p.imageUrl ? "" : " is-empty"}`}
                >
                  <span className="extra-product-price">{dinero(p.precio)}</span>
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        const fallback = resolveProductImage(p.nombre, null);
                        const el = e.currentTarget;
                        if (fallback.url && !el.dataset.fallback) {
                          el.dataset.fallback = "1";
                          el.src = fallback.url;
                          el.parentElement?.classList.remove("fit-cover", "fit-contain");
                          el.parentElement?.classList.add(`fit-${fallback.fit}`);
                          return;
                        }
                        el.style.display = "none";
                        el.parentElement?.classList.add("is-empty");
                      }}
                    />
                  ) : (
                    <span>{p.nombre.slice(0, 1)}</span>
                  )}
                </div>
                <div className="extra-product-name">{p.nombre}</div>
              </button>
            ))}
            {!productosTab.length ? (
              <div style={{ gridColumn: "1 / -1", padding: 20, color: "#809284", textAlign: "center" }}>
                {menuQuery.isLoading || frequentQuery.isLoading || stockBodegaQuery.isLoading
                  ? "Cargando productos…"
                  : tab === "frecuentes"
                    ? "No hay frecuentes de Extra con stock en bodega sucursal."
                    : "No hay productos con stock en bodega sucursal en esta categoría."}
              </div>
            ) : null}
          </div>
        </section>

        <section className="extra-panel" aria-label="Pedidos">
          <div className="extra-orders-head">
            <span>{tituloPedidos}</span>
            <span aria-hidden>+</span>
          </div>

          {errorMsg ? <div className="extra-alert" role="alert">{errorMsg}</div> : null}

          <div className="extra-orders-list">
            {draft.map((line) => (
              <div key={line.productId} className="extra-order-row">
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt=""
                    className={`thumb fit-${line.imageFit}`}
                  />
                ) : (
                  <span className="thumb-empty">—</span>
                )}
                <strong>
                  {line.nombre} x {line.qty}
                </strong>
                <span className="price">{dinero(line.precio * line.qty)}</span>
                <button
                  type="button"
                  className="extra-order-remove"
                  aria-label={`Quitar ${line.nombre}`}
                  onClick={() => quitarLineaDraft(line.productId)}
                >
                  ×
                </button>
              </div>
            ))}
            {!draft.length ? (
              <div className="extra-empty-orders">
                {ordenActiva
                  ? "Toca un producto para armar el pedido extra."
                  : "Selecciona una mesa u orden abierta."}
              </div>
            ) : null}
          </div>

          <div className="extra-total-bar">
            <span>Total Extras:</span>
            <strong>{dinero(totalDraft)}</strong>
          </div>

          <div className="extra-actions">
            <button
              type="button"
              className="extra-btn-clear"
              disabled={!draft.length || registrando}
              onClick={limpiarDraft}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v10h-2V9Zm4 0h2v10h-2V9ZM7 9h2v10H7V9Z" />
              </svg>
              Limpiar
            </button>
            <button
              type="button"
              className="extra-btn-register"
              disabled={!draft.length || !ordenActiva || registrando}
              onClick={() => void registrarExtras()}
            >
              {registrando ? (
                "Registrando…"
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8-8 1.4 1.4-9.4 9.4Z" />
                  </svg>
                  Registrar Extras
                </>
              )}
            </button>
          </div>
        </section>
      </div>

      <dialog
        ref={pickerRef}
        onClose={() => setPickerMesa(null)}
        onCancel={(e) => {
          e.preventDefault();
          setPickerMesa(null);
        }}
        style={{
          border: 0,
          borderRadius: 16,
          padding: 0,
          width: "min(420px, 92vw)",
          boxShadow: "0 20px 50px rgba(0,0,0,.25)",
        }}
      >
        {pickerMesa ? (
          <div style={{ padding: 18 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Varias órdenes</h2>
            <p style={{ margin: "0 0 14px", color: "#667", fontSize: 13 }}>
              Elige la orden de {pickerMesa.mesa.nombre} a la que vas a agregar extras.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {pickerMesa.ordenes.map((o, idx) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => aplicarOrdenMesa(pickerMesa.mesa, o.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #d5e0d4",
                    background: "#f8fbf7",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  <span>
                    {o.especial
                      ? "Orden especial"
                      : o.codigo
                        ? String(o.codigo)
                        : `Orden ${idx + 1}`}
                  </span>
                  <strong>{dinero(o.total)}</strong>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPickerMesa(null)}
              style={{
                marginTop: 14,
                width: "100%",
                minHeight: 42,
                borderRadius: 10,
                border: "1px solid #d5e0d4",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Cancelar
            </button>
          </div>
        ) : null}
      </dialog>

      {sucursal ? (
        <ExtraFrecuentesManager
          open={gestionarFrecuentes}
          branchId={sucursal.id}
          catalog={catalog}
          onClose={() => setGestionarFrecuentes(false)}
        />
      ) : null}
    </div>
  );
}
