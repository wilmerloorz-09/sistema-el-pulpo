import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { allowedModulesFromPermissions, type PermissionMap } from "@/lib/permissions";
import { toast } from "sonner";

interface Branch {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  workflow_mode?: 'CASH_THEN_DISPATCH' | 'DISPATCH_THEN_CASH';
  printer_ip?: string | null;
  printer_port?: number | null;
}

interface AccessContextPayload {
  active_branch_id: string | null;
  branches: Branch[];
  permissions: PermissionMap;
  is_global_admin: boolean;
}

interface BranchContextType {
  branches: Branch[];
  activeBranch: Branch | null;
  activeBranchId: string | null;
  allowedModules: string[];
  permissions: PermissionMap;
  isGlobalAdmin: boolean;
  setActiveBranch: (branch: Branch | null) => Promise<void>;
  refreshAccess: () => Promise<void>;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const emptyAccess: AccessContextPayload = {
  active_branch_id: null,
  branches: [],
  permissions: {},
  is_global_admin: false,
};

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [access, setAccess] = useState<AccessContextPayload>(emptyAccess);
  const [loading, setLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (!user) {
      setAccess(emptyAccess);
      setLoading(false);
      return;
    }

    // Only set global loading true if we don't have branch data yet.
    // This allows background refreshes (e.g. when tokens update or tab is refocused) 
    // to happen without unmounting the whole app and closing modals.
    if (access.branches.length === 0) {
      setLoading(true);
    }
    try {
      const { data, error } = await supabase.rpc("get_my_access_context" as any);
      if (error) throw error;

      const next = (data ?? emptyAccess) as unknown as AccessContextPayload;
      setAccess({
        active_branch_id: next.active_branch_id,
        branches: next.branches ?? [],
        permissions: next.permissions ?? {},
        is_global_admin: Boolean(next.is_global_admin),
      });

      if (next.active_branch_id) {
        localStorage.setItem("activeBranchId", next.active_branch_id);
      } else {
        localStorage.removeItem("activeBranchId");
      }
    } catch (error) {
      // Un fallo transitorio no debe vaciar sucursal activa ni permisos: eso cambia
      // la queryKey del gate de turno y colapsa el menu lateral a la vista solo-admin.
      console.warn("[BranchContext] get_my_access_context fallo; se conserva el acceso previo", error);
      setAccess((prev) => (prev.branches.length > 0 ? prev : emptyAccess));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchAccess();
  }, [fetchAccess]);

  const setActiveBranch = useCallback(async (branch: Branch | null) => {
    if (!user) return;

    if (!branch) {
      setAccess((prev) => ({ ...prev, active_branch_id: null, permissions: {} }));
      localStorage.removeItem("activeBranchId");
      return;
    }

    // Optimistic Update
    const prevBranchId = access.active_branch_id;
    setAccess((prev) => ({ ...prev, active_branch_id: branch.id }));
    localStorage.setItem("activeBranchId", branch.id);

    try {
      const { error } = await supabase.rpc("set_my_active_branch" as any, {
        p_branch_id: branch.id,
      } as any);

      if (error) {
        console.error("Error cambiando sucursal:", error);
        toast.error(`No se pudo cambiar de sucursal: ${error.message}`);
        // Revert Optimistic Update
        setAccess((prev) => ({ ...prev, active_branch_id: prevBranchId }));
        if (prevBranchId) localStorage.setItem("activeBranchId", prevBranchId);
        return;
      }
      await fetchAccess();
    } catch (e: any) {
      console.error("Catch error cambiando sucursal:", e);
      toast.error(`Error catch: ${e.message}`);
      // Revert Optimistic Update
      setAccess((prev) => ({ ...prev, active_branch_id: prevBranchId }));
      if (prevBranchId) localStorage.setItem("activeBranchId", prevBranchId);
    }
  }, [user, access.active_branch_id, fetchAccess]);

  const activeBranch = access.branches.find((branch) => branch.id === access.active_branch_id) ?? null;

  useEffect(() => {
    if (activeBranch) {
      if (activeBranch.printer_ip) {
        localStorage.setItem("activePrinterIp", activeBranch.printer_ip);
      } else {
        localStorage.removeItem("activePrinterIp");
      }
      if (activeBranch.printer_port) {
        localStorage.setItem("activePrinterPort", String(activeBranch.printer_port));
      } else {
        localStorage.removeItem("activePrinterPort");
      }
    } else {
      localStorage.removeItem("activePrinterIp");
      localStorage.removeItem("activePrinterPort");
    }
  }, [activeBranch]);

  const allowedModules = useMemo(
    () => allowedModulesFromPermissions(access.permissions),
    [access.permissions],
  );

  const value = useMemo(
    () => ({
      branches: access.branches,
      activeBranch,
      activeBranchId: access.active_branch_id,
      allowedModules,
      permissions: access.permissions,
      isGlobalAdmin: access.is_global_admin,
      setActiveBranch,
      refreshAccess: fetchAccess,
      loading,
    }),
    [
      access.branches,
      access.active_branch_id,
      access.permissions,
      access.is_global_admin,
      activeBranch,
      allowedModules,
      setActiveBranch,
      fetchAccess,
      loading,
    ],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
};

export const useBranch = () => {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
};
