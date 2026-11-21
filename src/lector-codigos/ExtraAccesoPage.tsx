import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, PackageCheck, ScanBarcode, Store } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Sucursal } from "./dominio/tipos";
import { setExtraStationBranchId } from "./extraStationBranch";

type Step = "branch" | "mode" | "loading";

/** Entrada externa a Extra / Extra Empaquetador. No requiere sesión. */
export default function ExtraAccesoPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [step, setStep] = useState<Step>("loading");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [selected, setSelected] = useState<Sucursal | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cssId = "extra-station-css";
    const bodyClass = "extra-station-active";
    let link = document.getElementById(cssId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "/lector-codigos/extra-station.css?v=20261121-extra-acceso-public";
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
    let cancel = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("list_extra_acceso_open_branches" as any);
        if (error) throw error;
        const list: Sucursal[] = (Array.isArray(data) ? data : []).map((row: any) => ({
          id: String(row.id),
          nombre: String(row.nombre ?? "Sucursal"),
          codigo: row.codigo ? String(row.codigo) : null,
        }));
        if (cancel) return;
        setSucursales(list);
        setStep("branch");
      } catch (e: any) {
        if (!cancel) {
          setErrorMsg(e?.message || "No se pudieron cargar las sucursales.");
          setStep("branch");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const activarSucursal = useCallback(async (sucursal: Sucursal) => {
    setExtraStationBranchId(sucursal.id);
    if (!user) return;
    const { error } = await supabase.rpc("set_my_active_branch" as any, {
      p_branch_id: sucursal.id,
    } as any);
    if (error) throw error;
  }, [user]);

  const irAModulo = useCallback(
    async (sucursal: Sucursal, destino: "/extra" | "/extra-empaquetador") => {
      setBusy(true);
      setErrorMsg(null);
      try {
        await activarSucursal(sucursal);
        // Extra normal y Extra Empaquetador requieren sesión para operar.
        if (!user) {
          navigate(`/login?next=${encodeURIComponent(destino)}`, { replace: true });
          return;
        }
        navigate(destino, { replace: true });
      } catch (e: any) {
        setErrorMsg(e?.message || "No se pudo activar la sucursal.");
        setBusy(false);
      }
    },
    [activarSucursal, navigate, user],
  );

  const onSelectBranch = useCallback(
    async (sucursal: Sucursal) => {
      setBusy(true);
      setErrorMsg(null);
      setSelected(sucursal);
      try {
        const { data, error } = await supabase.rpc("extra_acceso_branch_has_packer" as any, {
          p_branch_id: sucursal.id,
        } as any);
        if (error) throw error;
        const hasPacker = Boolean(data);
        if (!hasPacker) {
          await irAModulo(sucursal, "/extra");
          return;
        }
        setStep("mode");
        setBusy(false);
      } catch (e: any) {
        setErrorMsg(e?.message || "No se pudo revisar el turno de la sucursal.");
        setBusy(false);
      }
    },
    [irAModulo],
  );

  const titulo = useMemo(() => {
    if (step === "mode") return "¿Qué Extra vas a usar?";
    return "Estación Extra";
  }, [step]);

  return (
    <div className="extra-station" style={{ placeItems: "center", display: "grid", padding: 24 }}>
      <div
        style={{
          width: "min(560px, 96vw)",
          background: "#fff",
          border: "1px solid #d5e0d4",
          borderRadius: 18,
          boxShadow: "0 18px 40px rgba(12,28,20,.14)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            background: "linear-gradient(180deg, #1a6840 0%, #134f2f 100%)",
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff" }} />
            <div>
              <strong style={{ display: "block", fontFamily: "Georgia, serif", color: "#f6e27a", fontSize: 18 }}>
                Picantería El Pulpo
              </strong>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{titulo}</span>
            </div>
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {errorMsg ? (
            <div
              role="alert"
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#fff1e9",
                border: "1px solid #efd7c8",
                color: "#ad6846",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          ) : null}

          {step === "loading" || busy ? (
            <div style={{ display: "grid", placeItems: "center", gap: 10, padding: "28px 8px" }}>
              <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
              <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                {busy ? "Abriendo estación…" : "Cargando sucursales…"}
              </p>
            </div>
          ) : null}

          {step === "branch" && !busy ? (
            <>
              <p style={{ margin: "0 0 14px", color: "#5b6f63", fontSize: 14 }}>
                Selecciona la sucursal para entrar a Extra.
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                {sucursales.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void onSelectBranch(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      border: "1px solid #d5e0d4",
                      background: "#f8fbf7",
                      borderRadius: 12,
                      padding: "14px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                      color: "#1f3a2e",
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "#dff0e4",
                        color: "#17633b",
                        flex: "0 0 auto",
                      }}
                    >
                      <Store size={18} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: "block" }}>{s.nombre}</strong>
                      {s.codigo ? (
                        <small style={{ color: "#7a8882", fontWeight: 500 }}>{s.codigo}</small>
                      ) : null}
                    </span>
                  </button>
                ))}
                {!sucursales.length ? (
                  <p style={{ margin: 0, color: "#809284", fontSize: 13 }}>
                    No hay sucursales con turno abierto.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {step === "mode" && selected && !busy ? (
            <>
              <p style={{ margin: "0 0 6px", color: "#5b6f63", fontSize: 14 }}>
                Sucursal: <strong style={{ color: "#1f3a2e" }}>{selected.nombre}</strong>
              </p>
              <p style={{ margin: "0 0 14px", color: "#7a8882", fontSize: 13 }}>
                Hay empaquetador habilitado en el turno. Elige el módulo.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void irAModulo(selected, "/extra")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    border: "1px solid #d5e0d4",
                    background: "#f8fbf7",
                    borderRadius: 12,
                    padding: "16px 14px",
                    cursor: "pointer",
                    color: "#1f3a2e",
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: "#dff0e4",
                      color: "#17633b",
                    }}
                  >
                    <ScanBarcode size={20} />
                  </span>
                  <span>
                    <strong style={{ display: "block", fontSize: 15 }}>Extra Normal</strong>
                    <small style={{ color: "#7a8882" }}>Estación Extra estándar</small>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void irAModulo(selected, "/extra-empaquetador")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    border: "1px solid #d5e0d4",
                    background: "#f8fbf7",
                    borderRadius: 12,
                    padding: "16px 14px",
                    cursor: "pointer",
                    color: "#1f3a2e",
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: "#dcf5ef",
                      color: "#0f766e",
                    }}
                  >
                    <PackageCheck size={20} />
                  </span>
                  <span>
                    <strong style={{ display: "block", fontSize: 15 }}>Extra para Empaquetador</strong>
                    <small style={{ color: "#7a8882" }}>Cola de empaque + catálogo</small>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setStep("branch");
                    setErrorMsg(null);
                  }}
                  style={{
                    marginTop: 4,
                    border: 0,
                    background: "transparent",
                    color: "#5b6f63",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "8px 4px",
                  }}
                >
                  ← Cambiar sucursal
                </button>
              </div>
            </>
          ) : null}

          {user ? (
            <div style={{ marginTop: 18, borderTop: "1px solid #e4ebe4", paddingTop: 14 }}>
              <button
                type="button"
                onClick={() => void signOut()}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "#809284",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
