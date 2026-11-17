import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AtajosBebidas from "./componentes/AtajosBebidas";
import { Icono, MarcaPulpo } from "./componentes/iconos";
import {
  agregarPorCodigo,
  listarActividad,
  listarCatalogoProductos,
  listarItemsLectorOrden,
  listarMesasSucursal,
  listarOrdenesAbiertas,
  obtenerSucursalActiva,
  quitarCantidadesOrden,
} from "./dominio/api";
import {
  consolidarItemsLector,
  type LineaLectorConsolidada,
} from "./dominio/consolidarItems";
import {
  dinero,
  dineroMesa,
  esCodigoBarrasValido,
  etiquetaOrden,
  etiquetaPago,
  etiquetaTipoOrden,
  formatearHora,
  normalizarCodigo,
  nuevoIdOperacion,
} from "./dominio/formato";
import type {
  ProductoCatalogo,
  ItemOrden,
  MesaSucursal,
  OperacionActividad,
  OrdenAbierta,
  OrdenEnMesa,
  ResultadoAgregar,
  Sucursal,
} from "./dominio/tipos";

type Vista = "work" | "history" | "catalog";
type FiltroOrden = "mesa" | "llevar";

/** Temporalmente off: al avisar, poner en true para reactivar el auto-deseleccionado. */
const IDLE_DESELECCION_ACTIVA = false;
/** Sin interacción con la mesa/orden seleccionada, se limpia el contexto. */
const IDLE_DESELECCION_MS = 20_000;

export default function LectorCodigosPage() {
  const { user, signOut, loading: authLoading } = useAuth();

  const [sucursal, setSucursal] = useState<Sucursal | null>(null);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [errorSucursal, setErrorSucursal] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>("work");
  const [mesas, setMesas] = useState<MesaSucursal[]>([]);
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenAbierta[]>([]);
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [filtroOrden, setFiltroOrden] = useState<FiltroOrden>("mesa");
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false);
  const [pickerMesa, setPickerMesa] = useState<{
    mesa: MesaSucursal;
    ordenes: OrdenEnMesa[];
  } | null>(null);
  const pickerRef = useRef<HTMLDialogElement | null>(null);

  const [items, setItems] = useState<ItemOrden[]>([]);
  const [codigo, setCodigo] = useState("");
  const [errorScan, setErrorScan] = useState<string | null>(null);
  /** Solo bloquea el input de código (no los atajos) mientras se confirma un escaneo. */
  const [procesando, setProcesando] = useState(false);
  const [ultimoProductoId, setUltimoProductoId] = useState<string | null>(null);
  const [pulsoOrden, setPulsoOrden] = useState(0);
  const [pendienteRetry, setPendienteRetry] = useState<{
    idOperacion: string;
    codigo: string;
    cantidad: number;
  } | null>(null);

  const [actividad, setActividad] = useState<OperacionActividad[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  /** Ítems confirmados en servidor; la UI = servidor + adds − removes pendientes. */
  const serverItemsRef = useRef<ItemOrden[]>([]);
  const pendingAddsRef = useRef(
    new Map<string, { qty: number; nombre: string; precio: number }>(),
  );
  const pendingRemovesRef = useRef(new Map<string, number>());
  const itemsRefreshSeq = useRef(0);
  const lastActivityRef = useRef(Date.now());

  const ordenActiva = useMemo(
    () => ordenes.find((o) => o.id === ordenId) ?? null,
    [ordenes, ordenId],
  );

  const publicarItems = useCallback(() => {
    const pendingAdds = pendingAddsRef.current;
    const pendingRemoves = pendingRemovesRef.current;
    const base = serverItemsRef.current.map((row) => ({ ...row }));

    for (const [productId, info] of pendingAdds) {
      const idx = base.findIndex((row) => row.id_producto === productId);
      if (idx >= 0) {
        const cantidad = Number(base[idx].cantidad) + info.qty;
        const precio = Number(base[idx].precio);
        base[idx] = {
          ...base[idx],
          cantidad,
          total: cantidad * precio,
          creado_en: new Date().toISOString(),
        };
      } else {
        base.unshift({
          id: `pending-${productId}`,
          id_producto: productId,
          descripcion: info.nombre,
          cantidad: info.qty,
          precio: info.precio,
          total: info.qty * info.precio,
          creado_en: new Date().toISOString(),
        });
      }
    }

    for (const [productId, qtyRemove] of pendingRemoves) {
      let restante = qtyRemove;
      for (let i = 0; i < base.length && restante > 0; i += 1) {
        if (base[i].id_producto !== productId) continue;
        const actual = Number(base[i].cantidad);
        const take = Math.min(actual, restante);
        const cantidad = actual - take;
        const precio = Number(base[i].precio);
        base[i] = {
          ...base[i],
          cantidad,
          total: cantidad * precio,
        };
        restante -= take;
      }
    }

    setItems(base.filter((row) => Number(row.cantidad) > 0));
  }, []);

  const registrarAddOptimista = useCallback(
    (productId: string, nombre: string, precio: number) => {
      const cur = pendingAddsRef.current.get(productId);
      if (cur) cur.qty += 1;
      else pendingAddsRef.current.set(productId, { qty: 1, nombre, precio });
      setUltimoProductoId(productId);
      setPulsoOrden((n) => n + 1);
      publicarItems();
    },
    [publicarItems],
  );

  const liberarAddOptimista = useCallback(
    (productId: string) => {
      const cur = pendingAddsRef.current.get(productId);
      if (!cur) return;
      cur.qty -= 1;
      if (cur.qty <= 0) pendingAddsRef.current.delete(productId);
      publicarItems();
    },
    [publicarItems],
  );

  const registrarRemoveOptimista = useCallback(
    (productId: string, qty: number) => {
      const prev = pendingRemovesRef.current.get(productId) ?? 0;
      pendingRemovesRef.current.set(productId, prev + qty);
      setPulsoOrden((n) => n + 1);
      publicarItems();
    },
    [publicarItems],
  );

  const liberarRemoveOptimista = useCallback(
    (productId: string, qty: number) => {
      const prev = pendingRemovesRef.current.get(productId) ?? 0;
      const next = prev - qty;
      if (next <= 0) pendingRemovesRef.current.delete(productId);
      else pendingRemovesRef.current.set(productId, next);
      publicarItems();
    },
    [publicarItems],
  );

  const aplicarItemsServidor = useCallback(
    (rows: ItemOrden[]) => {
      serverItemsRef.current = rows;
      publicarItems();
    },
    [publicarItems],
  );

  // Estilos del lector (sin tocar el shell del POS).
  useEffect(() => {
    const cssId = "lector-codigos-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "/lector-codigos/styles.css?v=20261117-orden-chip";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      setCargandoSucursales(true);
      setErrorSucursal(null);
      try {
        // Misma sucursal del POS; no pedir selección ni tocar set_my_active_branch.
        const activa = await obtenerSucursalActiva();
        if (cancel) return;
        if (!activa) {
          setSucursal(null);
          setErrorSucursal("No hay sucursal activa. Entra desde el menú con una sucursal ya seleccionada.");
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

  const marcarActividad = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const limpiarContextoOrden = useCallback(() => {
    pendingAddsRef.current.clear();
    pendingRemovesRef.current.clear();
    serverItemsRef.current = [];
    setMesaId(null);
    setOrdenId(null);
    setItems([]);
    setCodigo("");
    setErrorScan(null);
    setUltimoProductoId(null);
    setPendienteRetry(null);
    setPickerMesa(null);
  }, []);

  // Si hay mesa/orden seleccionada y pasan 20s sin uso, se deselecciona.
  useEffect(() => {
    if (!IDLE_DESELECCION_ACTIVA) return;
    if (!mesaId && !ordenId) return;
    marcarActividad();
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < IDLE_DESELECCION_MS) return;
      limpiarContextoOrden();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mesaId, ordenId, marcarActividad, limpiarContextoOrden]);

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
      setMesaId((prevMesa) => {
        const mesa = prevMesa ? mesasList.find((m) => m.id === prevMesa) : null;
        // Mesas desocupadas no se pueden usar en el lector.
        if (!mesa || mesa.estado === "libre") {
          setOrdenId((prevOrden) =>
            prevOrden && ordenesList.some((o) => o.id === prevOrden) && !prevMesa
              ? prevOrden
              : null,
          );
          return null;
        }
        setOrdenId(mesa.id_orden_activa);
        return mesa.id;
      });
    } catch (e: any) {
      setErrorScan(e?.message || "Error al cargar mesas/órdenes");
    } finally {
      setCargandoOrdenes(false);
    }
  }, [sucursal]);

  useEffect(() => {
    if (!sucursal) return;
    void refrescarOrdenes();
    const t = window.setInterval(() => void refrescarOrdenes(), 20000);
    return () => window.clearInterval(t);
  }, [sucursal, refrescarOrdenes]);

  useEffect(() => {
    pendingAddsRef.current.clear();
    pendingRemovesRef.current.clear();
    if (!ordenId) {
      serverItemsRef.current = [];
      setItems([]);
    }
  }, [ordenId]);

  useEffect(() => {
    if (!ordenId) return;
    let cancel = false;
    const seq = ++itemsRefreshSeq.current;
    (async () => {
      try {
        const rows = await listarItemsLectorOrden(ordenId);
        if (cancel || seq !== itemsRefreshSeq.current) return;
        aplicarItemsServidor(rows);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
    // Solo al cambiar de orden: los refrescos tras agregar/quitar van explícitos
    // para no pisar pendientes optimistas con un poll de órdenes.
  }, [ordenId, aplicarItemsServidor]);

  useEffect(() => {
    if (!sucursal || vista !== "history") return;
    void listarActividad(sucursal.id).then(setActividad).catch(() => undefined);
  }, [sucursal, vista]);

  useEffect(() => {
    if (!sucursal) return;
    void listarCatalogoProductos().then(setCatalogo).catch(() => undefined);
  }, [sucursal]);

  useEffect(() => {
    const dialog = pickerRef.current;
    if (!dialog) return;
    if (pickerMesa) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pickerMesa]);

  const mesasFiltradas = mesas;

  const ordenesLlevar = useMemo(
    () => ordenes.filter((o) => etiquetaTipoOrden(o.tipo) === "llevar"),
    [ordenes],
  );

  const aplicarOrdenMesa = (m: MesaSucursal, ordenIdElegida: string | null) => {
    marcarActividad();
    setPickerMesa(null);
    setMesaId(m.id);
    setErrorScan(null);
    setUltimoProductoId(null);
    if (ordenIdElegida) {
      setOrdenId(ordenIdElegida);
    } else {
      setOrdenId(null);
      setErrorScan("Esta mesa está libre. Ábrela en el POS antes de escanear.");
    }
  };

  const seleccionarMesa = (m: MesaSucursal) => {
    marcarActividad();
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
      setErrorScan(null);
      setPickerMesa({ mesa: m, ordenes: candidatas });
      return;
    }

    aplicarOrdenMesa(m, candidatas[0]?.id ?? null);
  };

  const lineasConsolidadas = useMemo(
    () => consolidarItemsLector(items),
    [items],
  );

  const totalProductosLector = useMemo(
    () => lineasConsolidadas.reduce((n, i) => n + Number(i.total || 0), 0),
    [lineasConsolidadas],
  );

  const totalUnidadesLector = useMemo(
    () => lineasConsolidadas.reduce((n, i) => n + Number(i.cantidad || 0), 0),
    [lineasConsolidadas],
  );

  const refrescarItemsOrden = useCallback(async () => {
    if (!ordenActiva) return;
    const seq = ++itemsRefreshSeq.current;
    const rows = await listarItemsLectorOrden(ordenActiva.id);
    if (seq !== itemsRefreshSeq.current) return;
    aplicarItemsServidor(rows);
    await refrescarOrdenes();
    if (vista === "history" && sucursal) {
      setActividad(await listarActividad(sucursal.id));
    }
  }, [ordenActiva, refrescarOrdenes, sucursal, vista, aplicarItemsServidor]);

  const procesarCodigo = useCallback(
    async (
      raw: string | null,
      fuente: string,
      idFijo?: string,
      idProducto?: string | null,
      meta?: { nombre?: string; precio?: number },
    ) => {
      if (!sucursal || !ordenActiva) {
        setErrorScan("Selecciona una orden antes de escanear.");
        return;
      }
      const code = raw ? normalizarCodigo(raw) : "";
      if (!idProducto && !esCodigoBarrasValido(code)) {
        setErrorScan("Código no válido.");
        return;
      }
      marcarActividad();

      // Cada lectura/menú agrega 1 unidad despachada.
      const cantidad = 1;
      const idOperacion = idFijo || nuevoIdOperacion();
      const catalogoHit = idProducto
        ? catalogo.find((c) => c.id_producto === idProducto)
        : null;
      const nombreOptimistic =
        meta?.nombre?.trim()
        || catalogoHit?.nombre
        || "Producto";
      const precioOptimistic = Number(
        meta?.precio ?? catalogoHit?.precio ?? 0,
      );
      const esAtajoOMenu = Boolean(idProducto);

      // Atajos/menú: UI inmediata, sin desactivar botones.
      if (esAtajoOMenu && idProducto) {
        registrarAddOptimista(idProducto, nombreOptimistic, precioOptimistic);
        setErrorScan(null);
        setCodigo("");
      } else {
        setProcesando(true);
        setErrorScan(null);
      }

      try {
        const res: ResultadoAgregar = await agregarPorCodigo({
          idOperacion,
          idOrden: ordenActiva.id,
          codigo: code || null,
          idProducto: idProducto ?? null,
          cantidad,
          fuente,
        });
        setPendienteRetry(null);
        const pid = String(res.id_producto || idProducto || "");
        if (pid) setUltimoProductoId(pid);
        setCodigo("");
        // Refresh en segundo plano: no bloquea el siguiente clic.
        // Liberamos el pendiente solo al aplicar ítems del servidor (evita parpadeo).
        void (async () => {
          try {
            const seq = ++itemsRefreshSeq.current;
            const [rows] = await Promise.all([
              listarItemsLectorOrden(ordenActiva.id),
              refrescarOrdenes(),
            ]);
            if (seq !== itemsRefreshSeq.current) return;
            if (esAtajoOMenu && idProducto) {
              const cur = pendingAddsRef.current.get(idProducto);
              if (cur) {
                cur.qty -= 1;
                if (cur.qty <= 0) pendingAddsRef.current.delete(idProducto);
              }
            }
            aplicarItemsServidor(rows);
            if (vista === "history") {
              const act = await listarActividad(sucursal.id);
              setActividad(act);
            }
          } catch {
            /* Si falla el refresh, soltamos el pendiente para no inflar de más. */
            if (esAtajoOMenu && idProducto) liberarAddOptimista(idProducto);
          }
        })();
      } catch (e: any) {
        if (esAtajoOMenu && idProducto) {
          liberarAddOptimista(idProducto);
        }
        setPendienteRetry({ idOperacion, codigo: code || idProducto || "", cantidad });
        setErrorScan(e?.message || "No se pudo agregar. Puedes reintentar la misma lectura.");
      } finally {
        if (!esAtajoOMenu) setProcesando(false);
      }
    },
    [
      sucursal,
      ordenActiva,
      catalogo,
      marcarActividad,
      registrarAddOptimista,
      liberarAddOptimista,
      aplicarItemsServidor,
      refrescarOrdenes,
      vista,
    ],
  );

  const onSubmitCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim() || procesando) return;
    void procesarCodigo(codigo, "lector");
  };

  const onSumarProducto = (linea: LineaLectorConsolidada) => {
    if (!ordenActiva) return;
    const mapped = catalogo.find((c) => c.id_producto === linea.id_producto);
    void procesarCodigo(
      mapped?.codigo_barras ?? null,
      "ajuste",
      undefined,
      linea.id_producto,
      { nombre: linea.descripcion, precio: linea.precio },
    );
  };

  const onQuitarCantidad = (linea: LineaLectorConsolidada, cantidad: number) => {
    if (!ordenActiva || !user?.id) return;
    marcarActividad();

    const productId = linea.id_producto;
    const idOrden = ordenActiva.id;
    const idUsuario = user.id;

    const serverQty = serverItemsRef.current
      .filter((row) => row.id_producto === productId)
      .reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
    const addQty = pendingAddsRef.current.get(productId)?.qty ?? 0;
    const remQty = pendingRemovesRef.current.get(productId) ?? 0;
    const disponible = serverQty + addQty - remQty;
    const qty = Math.max(0, Math.min(disponible, Math.floor(cantidad)));
    if (qty <= 0) return;

    // Si hay adds aún no confirmados, primero descontamos de esos (sin RPC).
    let qtyServidor = qty;
    const pendingAdd = pendingAddsRef.current.get(productId);
    if (pendingAdd && pendingAdd.qty > 0) {
      const absorb = Math.min(pendingAdd.qty, qtyServidor);
      pendingAdd.qty -= absorb;
      if (pendingAdd.qty <= 0) pendingAddsRef.current.delete(productId);
      qtyServidor -= absorb;
    }

    if (qty >= disponible && ultimoProductoId === productId) {
      setUltimoProductoId(null);
    }

    if (qtyServidor <= 0) {
      publicarItems();
      return;
    }

    registrarRemoveOptimista(productId, qtyServidor);
    setErrorScan(null);

    void (async () => {
      try {
        await quitarCantidadesOrden({
          idOrden,
          idProducto: productId,
          cantidad: qtyServidor,
          idOperacion: nuevoIdOperacion(),
          idUsuario,
        });
        const seq = ++itemsRefreshSeq.current;
        const [rows] = await Promise.all([
          listarItemsLectorOrden(idOrden),
          refrescarOrdenes(),
        ]);
        if (seq !== itemsRefreshSeq.current) return;
        const prev = pendingRemovesRef.current.get(productId) ?? 0;
        const next = prev - qtyServidor;
        if (next <= 0) pendingRemovesRef.current.delete(productId);
        else pendingRemovesRef.current.set(productId, next);
        aplicarItemsServidor(rows);
      } catch (e: any) {
        liberarRemoveOptimista(productId, qtyServidor);
        const raw = String(e?.message || "");
        setErrorScan(
          /cancelar mas cantidad|disponibles para quitar/i.test(raw)
            ? "No se pudo quitar: actualiza el listado e intenta de nuevo."
            : raw || "No se pudo quitar",
        );
        try {
          await refrescarItemsOrden();
        } catch {
          /* ignore */
        }
      }
    })();
  };

  if (authLoading || cargandoSucursales) {
    return (
      <div className="app-shell" style={{ marginLeft: 0, padding: 40 }}>
        <p>Cargando…</p>
      </div>
    );
  }

  if (!sucursal) {
    return (
      <div className="app-shell" style={{ marginLeft: 0 }}>
        <main style={{ maxWidth: 560, margin: "48px auto", padding: 24 }}>
          <div className="panel" style={{ padding: 28 }}>
            <a className="brand" href="#" style={{ marginBottom: 24 }} onClick={(e) => e.preventDefault()}>
              <MarcaPulpo />
              <span>
                <strong>
                  el pulpo<span className="brand-dot">.</span>
                </strong>
                <small>PICANTERÍA</small>
              </span>
            </a>
            <h1 style={{ fontSize: 24, marginBottom: 12 }}>Lector</h1>
            {errorSucursal ? (
              <div className="inline-error">{errorSucursal}</div>
            ) : (
              <p style={{ color: "var(--muted)" }}>No hay sucursal activa.</p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <Link to="/mesas" className="btn btn-dark">
                Ir a Mesas
              </Link>
              <button type="button" className="btn btn-white" onClick={() => void signOut()}>
                Cerrar sesión
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      <a href="#main" className="skip">
        Saltar al contenido
      </a>

      <div className="app-shell tablet-shell">
        <main id="main" className="tablet-main">
          <div className="lector-backbar">
            <Link to="/mesas" className="btn btn-white lector-back-btn">
              <Icono name="back" />
              Volver al sistema
            </Link>
            <span className="lector-branch-chip" title={sucursal.nombre}>
              <Icono name="store" />
              <span>{sucursal.nombre}</span>
            </span>
          </div>
          {vista === "work" && (
            <section>
              <div className="work-grid">
                <section
                  className="panel order-panel"
                  aria-label={filtroOrden === "mesa" ? "Mesas" : "Para llevar"}
                >
                  <div className="filter-tabs" aria-label="Filtrar">
                    {(
                      [
                        ["mesa", "Mesas"],
                        ["llevar", "Para llevar"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={filtroOrden === id ? "active" : ""}
                        onClick={() => {
                          setFiltroOrden(id);
                          setMesaId(null);
                          setOrdenId(null);
                          setErrorScan(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {filtroOrden === "mesa" ? (
                    <div className="mesa-grid">
                      {mesasFiltradas.map((m) => {
                        const selected = m.id === mesaId;
                        const badge = m.nombre.replace(/^Mesa\s*/i, "").trim() || m.nombre;
                        const libre = m.estado === "libre";
                        const label = libre ? "Libre" : m.estado === "por_cobrar" ? "Por pagar" : "Ocupada";
                        const artIcon = libre ? "grid" : m.estado === "por_cobrar" ? "dollar" : "users";
                        const statusIcon = libre ? null : m.estado === "por_cobrar" ? "dollar" : "users";
                        // Misma lógica de totales visibles que MesasV2.
                        const moneySplits = m.ordenes.filter((o) => o.total > 0);
                        const visibleSplits =
                          moneySplits.length > 0 && moneySplits.length <= 2 ? moneySplits.slice(0, 2) : [];
                        const showSingleTotal = m.total_pendiente > 0 && visibleSplits.length === 0;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className={`mesa-tile estado-${m.estado} ${selected ? "selected" : ""} ${
                              showSingleTotal || visibleSplits.length > 0 ? "con-total" : ""
                            }`}
                            disabled={libre}
                            aria-disabled={libre}
                            title={libre ? "Mesa desocupada: ábrela en el POS" : undefined}
                            onClick={() => {
                              if (libre) return;
                              seleccionarMesa(m);
                            }}
                          >
                            {!libre && m.especial && (
                              <span className="mesa-orders-badge especial">
                                {m.cantidad_ordenes > 1
                                  ? `${m.cantidad_ordenes} ordenes · Esp.`
                                  : "Especial"}
                              </span>
                            )}
                            {!libre && !m.especial && m.cantidad_ordenes > 0 && (
                              <span className="mesa-orders-badge">
                                {m.cantidad_ordenes}{" "}
                                {m.cantidad_ordenes === 1 ? "orden" : "ordenes"}
                              </span>
                            )}
                            <span className="mesa-badge">{badge}</span>
                            <span className="mesa-art">
                              <Icono name={artIcon} />
                            </span>
                            <span className="mesa-status">
                              {statusIcon && <Icono name={statusIcon} />}
                              <span>{label}</span>
                            </span>
                            {!libre && m.creado_por && (
                              <span className="mesa-creator">
                                <Icono name="user" />
                                <span>{m.creado_por}</span>
                              </span>
                            )}
                            {libre && (
                              <span className="mesa-ready">
                                Desocupada
                              </span>
                            )}
                            {showSingleTotal && (
                              <span className="mesa-total">{dineroMesa(m.total_pendiente)}</span>
                            )}
                            {visibleSplits[0] && (
                              <span className="mesa-total mesa-total-split-a">
                                {dineroMesa(visibleSplits[0].total)}
                              </span>
                            )}
                            {visibleSplits[1] && (
                              <span className="mesa-total mesa-total-split-b">
                                {dineroMesa(visibleSplits[1].total)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {!mesasFiltradas.length && !cargandoOrdenes && (
                        <div className="no-orders">No hay mesas habilitadas en esta sucursal.</div>
                      )}
                    </div>
                  ) : (
                    <div className="order-list">
                      {ordenesLlevar.map((o) => {
                        const selected = o.id === ordenId;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            className={`order-card ${selected ? "selected" : ""}`}
                            onClick={() => {
                              marcarActividad();
                              setMesaId(null);
                              setOrdenId(o.id);
                              setErrorScan(null);
                              setUltimoProductoId(null);
                            }}
                          >
                            <div className="order-card-head">
                              <span className="order-type-icon takeaway">
                                <Icono name="bag" />
                              </span>
                              <div>
                                <strong>{etiquetaOrden(o)}</strong>
                                <span className="order-number">{o.cliente || "Para llevar"}</span>
                              </div>
                              <span className="order-time">{formatearHora(o.creada_en)}</span>
                            </div>
                            <div className="order-card-bottom">
                              <span className={`order-status ${o.saldo <= 0.009 ? "paid" : ""}`}>
                                <i />
                                {etiquetaPago(o.saldo, o.estado)}
                              </span>
                              <strong>{dinero(o.total)}</strong>
                            </div>
                          </button>
                        );
                      })}
                      {!ordenesLlevar.length && !cargandoOrdenes && (
                        <div className="no-orders">No hay órdenes para llevar abiertas.</div>
                      )}
                    </div>
                  )}
                </section>

                <div className="working-column">
                  <section
                    className="panel scanner-panel"
                    onPointerDownCapture={marcarActividad}
                    onKeyDownCapture={marcarActividad}
                  >
                    {pendienteRetry && (
                      <div className="reader-controls">
                        <button
                          type="button"
                          onClick={() =>
                            void procesarCodigo(
                              pendienteRetry.codigo,
                              "reintento",
                              pendienteRetry.idOperacion,
                            )
                          }
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                    {errorScan && (
                      <div className="inline-error" role="alert">
                        {errorScan}
                      </div>
                    )}

                    {sucursal ? (
                      <AtajosBebidas
                        branchId={sucursal.id}
                        disabled={!ordenActiva}
                        onAddProduct={(productId, nombre) => {
                          if (!ordenActiva) {
                            setErrorScan("Selecciona una orden antes de agregar.");
                            return;
                          }
                          const mapped = catalogo.find((c) => c.id_producto === productId);
                          void procesarCodigo(
                            mapped?.codigo_barras ?? null,
                            "atajo",
                            undefined,
                            productId,
                            { nombre, precio: mapped?.precio },
                          );
                        }}
                      />
                    ) : null}
                  </section>

                  <section
                    className="panel draft-panel"
                    onPointerDownCapture={marcarActividad}
                    onKeyDownCapture={marcarActividad}
                  >
                    <div className="panel-title">
                      <h2>
                        En la orden <span>{totalUnidadesLector}</span>
                      </h2>
                      {ordenActiva ? (
                        <strong className="lector-orden-chip">
                          {etiquetaOrden(ordenActiva)}
                        </strong>
                      ) : (
                        <span className="lector-orden-chip muted">Sin orden</span>
                      )}
                    </div>
                    <div>
                      {lineasConsolidadas.map((linea, index) => {
                        const esUltimo =
                          ultimoProductoId != null
                            ? linea.id_producto === ultimoProductoId
                            : index === 0;
                        return (
                          <div
                            key={esUltimo ? `${linea.id_producto}-${pulsoOrden}` : linea.id_producto}
                            className={`draft-row${esUltimo ? " draft-row-latest draft-row-pulse" : ""}`}
                          >
                            <div className="draft-product">
                              <strong>{linea.descripcion}</strong>
                              <small>
                                {linea.cantidad} × {dinero(linea.precio)}
                              </small>
                            </div>
                            <div className="draft-row-actions">
                              <div className="qty-stepper">
                                <button
                                  type="button"
                                  aria-label="Quitar uno"
                                  disabled={!ordenActiva}
                                  onClick={() => onQuitarCantidad(linea, 1)}
                                >
                                  <Icono name="minus" />
                                </button>
                                <span>{linea.cantidad}</span>
                                <button
                                  type="button"
                                  aria-label="Agregar uno"
                                  disabled={!ordenActiva}
                                  onClick={() => onSumarProducto(linea)}
                                >
                                  <Icono name="plus" />
                                </button>
                              </div>
                              <button
                                type="button"
                                className="draft-trash"
                                aria-label={`Eliminar ${linea.descripcion}`}
                                disabled={!ordenActiva}
                                onClick={() => onQuitarCantidad(linea, linea.cantidad)}
                              >
                                <Icono name="trash" />
                              </button>
                              <strong>{dinero(linea.total)}</strong>
                            </div>
                          </div>
                        );
                      })}
                      {!lineasConsolidadas.length ? (
                        <div className="empty-draft">
                          <strong>Sin productos del lector</strong>
                          <small>Usa los atajos para agregar.</small>
                        </div>
                      ) : null}
                    </div>
                    <div className="draft-footer">
                      <div>
                        <span>Total</span>
                        <strong>{dinero(totalProductosLector)}</strong>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </section>
          )}

          {vista === "history" && (
            <section className="panel content-panel">
              {!actividad.length ? (
                <div className="history-empty">
                  <h3>Sin actividad</h3>
                </div>
              ) : (
                actividad.map((op) => (
                  <div key={op.id} className="history-item">
                    <div className="history-info">
                      <strong>
                        {op.tipo === "deshacer" ? "Deshacer · " : ""}
                        {op.descripcion || op.codigo_barras || "Producto"} ×{op.cantidad}
                      </strong>
                      <small>
                        {op.orden_codigo || op.id_orden.slice(0, 8)} · {formatearHora(op.fecha_registro)}
                      </small>
                    </div>
                    <span className={`history-amount ${op.tipo === "deshacer" ? "negative" : ""}`}>
                      {op.monto == null ? "—" : dinero(op.monto)}
                    </span>
                  </div>
                ))
              )}
            </section>
          )}

          {vista === "catalog" && (
            <section className="panel content-panel">
              <div className="catalog-grid">
                {catalogo.map((p) => (
                  <div key={p.codigo_barras} className="catalog-card">
                    <h3>{p.nombre}</h3>
                    <div className="catalog-meta">
                      <code>{p.codigo_barras}</code>
                      <strong>{dinero(p.precio)}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-dark"
                      disabled={!ordenActiva || procesando}
                      onClick={() => {
                        setVista("work");
                        void procesarCodigo(p.codigo_barras, "catalogo");
                      }}
                    >
                      Agregar
                    </button>
                  </div>
                ))}
              </div>
              {!catalogo.length && (
                <div className="history-empty">
                  <h3>Sin códigos</h3>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      <dialog
        ref={pickerRef}
        className="mesa-picker-dialog"
        onClose={() => setPickerMesa(null)}
        onCancel={(e) => {
          e.preventDefault();
          setPickerMesa(null);
        }}
      >
        {pickerMesa && (
          <>
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">Varias órdenes</p>
                <h2>{pickerMesa.mesa.nombre}</h2>
                <p>Elige la orden a la que vas a agregar productos.</p>
              </div>
              <button
                type="button"
                className="close-modal"
                aria-label="Cerrar"
                onClick={() => setPickerMesa(null)}
              >
                <Icono name="close" />
              </button>
            </div>
            <div className="modal-body mesa-picker-list">
              {pickerMesa.ordenes.map((o, idx) => (
                <button
                  key={o.id}
                  type="button"
                  className="mesa-picker-card"
                  onClick={() => aplicarOrdenMesa(pickerMesa.mesa, o.id)}
                >
                  <span className="mesa-picker-index">{idx + 1}</span>
                  <span className="mesa-picker-info">
                    <strong>
                      {o.especial
                        ? "Orden especial"
                        : o.codigo
                          ? String(o.codigo)
                          : `Orden ${idx + 1}`}
                    </strong>
                    <small>{o.id.slice(0, 8)}</small>
                  </span>
                  <strong className="mesa-picker-total">{dinero(o.total)}</strong>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-white" onClick={() => setPickerMesa(null)}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
