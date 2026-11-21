import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getExtraStationBranchId } from "./extraStationBranch";

/**
 * Solo empaquetador habilitado en el turno OPEN de la sucursal, o administradores.
 */
export default function ExtraPackerOrAdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const branchId = getExtraStationBranchId();
  const [status, setStatus] = useState<"loading" | "allowed" | "denied">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (authLoading) return;
      if (!user) {
        if (!cancel) setStatus("denied");
        return;
      }
      if (!branchId) {
        if (!cancel) setStatus("denied");
        return;
      }
      setStatus("loading");
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.rpc("extra_acceso_can_use_station" as any, {
          p_branch_id: branchId,
        } as any);
        if (error) throw error;
        if (!cancel) setStatus(data ? "allowed" : "denied");
      } catch (e: any) {
        if (!cancel) {
          setErrorMsg(e?.message || "No se pudo validar el acceso.");
          setStatus("denied");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [authLoading, user, branchId]);

  if (authLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">Validando acceso…</p>
      </div>
    );
  }

  if (!branchId) {
    return <Navigate to="/extra-acceso" replace />;
  }

  if (status !== "allowed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-center">
        <div className="max-w-md space-y-4">
          <p className="font-display text-lg font-bold text-foreground">Sin acceso a Extra</p>
          <p className="text-sm text-muted-foreground">
            Solo puede entrar el empaquetador habilitado en el turno de esta sucursal, o un administrador.
          </p>
          {errorMsg ? <p className="text-sm text-destructive">{errorMsg}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/extra-acceso"
              className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold"
            >
              Elegir otra sucursal
            </Link>
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold"
              onClick={() => void signOut()}
            >
              Cambiar usuario
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
