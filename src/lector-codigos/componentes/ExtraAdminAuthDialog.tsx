import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  open: boolean;
  branchId: string;
  onClose: () => void;
  onAuthorized: () => void;
};

async function esAdministrador(userId: string, branchId: string): Promise<boolean> {
  const [globalRes, branchAdminRes, adminGlobalPerm, adminSucursalPerm] = await Promise.all([
    supabase.rpc("is_global_admin" as any, { _user_id: userId }),
    supabase.rpc("can_manage_branch_admin" as any, {
      p_user_id: userId,
      p_branch_id: branchId,
    }),
    supabase.rpc("has_branch_permission" as any, {
      p_user_id: userId,
      p_branch_id: branchId,
      p_module_code: "admin_global",
      p_required: "MANAGE",
    }),
    supabase.rpc("has_branch_permission" as any, {
      p_user_id: userId,
      p_branch_id: branchId,
      p_module_code: "admin_sucursal",
      p_required: "MANAGE",
    }),
  ]);

  if (globalRes.error) throw globalRes.error;
  if (branchAdminRes.error) throw branchAdminRes.error;
  // Permisos por módulo: si el RPC no existe o falla, no bloquear el resto.
  const adminGlobal = !adminGlobalPerm.error && Boolean(adminGlobalPerm.data);
  const adminSucursal = !adminSucursalPerm.error && Boolean(adminSucursalPerm.data);

  return Boolean(globalRes.data) || Boolean(branchAdminRes.data) || adminGlobal || adminSucursal;
}

export default function ExtraAdminAuthDialog({ open, branchId, onClose, onAuthorized }: Props) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setIdentifier("");
      setPassword("");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError("Ingresa usuario y contraseña.");
      return;
    }
    if (!branchId) {
      setError("No hay sucursal activa.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Valida credenciales en el edge (no reemplaza la sesión del mesero).
      const { data, error: invokeError } = await supabase.functions.invoke("login-with-identifier", {
        body: { identifier: identifier.trim(), password },
      });
      if (invokeError || data?.error) {
        throw new Error(data?.error || invokeError?.message || "Credenciales inválidas");
      }

      const userId = String(data?.user?.id ?? "");
      if (!userId) throw new Error("No se pudo identificar al usuario.");

      const ok = await esAdministrador(userId, branchId);
      if (!ok) {
        throw new Error("Solo administradores pueden gestionar frecuentes.");
      }

      onAuthorized();
      onClose();
    } catch (err: any) {
      setError(err?.message || "No se pudo autorizar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="extra-freq-overlay"
      role="presentation"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <form
        className="extra-admin-auth"
        role="dialog"
        aria-modal="true"
        aria-label="Autorización administrador"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h2>Autorización requerida</h2>
        <p>Ingresa usuario y contraseña de un administrador para gestionar frecuentes.</p>

        <label>
          Usuario
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={loading}
            placeholder="Usuario, alias o correo"
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            placeholder="Contraseña"
          />
        </label>

        {error ? <div className="extra-admin-auth-error">{error}</div> : null}

        <div className="extra-admin-auth-actions">
          <button type="button" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="submit" disabled={loading}>
            {loading ? "Validando…" : "Continuar"}
          </button>
        </div>
      </form>
    </div>
  );
}
