import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface Branch {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
}

interface BranchContextType {
  branches: Branch[];
  activeBranch: Branch | null;
  activeBranchId: string | null;
  allowedModules: string[];
  setActiveBranch: (branch: Branch | null) => Promise<void>;
  refreshAccess: () => Promise<void>;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, activeRole } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(null);
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAllowedModules = useCallback(async (userId: string, branchId: string, role: string | null) => {
    try {
      if (role === "superadmin") {
        const { data: allModules } = await supabase
          .from("modules")
          .select("code")
          .eq("is_active", true);
        setAllowedModules((allModules ?? []).map((m: any) => m.code));
        return;
      }

      const { data, error } = await supabase
        .from("user_branch_modules")
        .select("module_id, modules(code)")
        .eq("user_id", userId)
        .eq("branch_id", branchId)
        .eq("is_active", true);

      if (error) throw error;

      const modules = (data ?? [])
        .map((row: any) => row.modules?.code)
        .filter((code: string | null | undefined): code is string => Boolean(code));

      setAllowedModules(modules);
    } catch {
      setAllowedModules([]);
    }
  }, []);

  const fetchBranches = useCallback(async (userId: string, role: string | null) => {
    setLoading(true);
    try {
      let branchList: Branch[] = [];

      if (role === "superadmin") {
        const { data } = await supabase.from("branches").select("*").eq("is_active", true).order("name");
        branchList = (data as Branch[]) ?? [];
      } else {
        const { data: ub } = await supabase
          .from("user_branches")
          .select("branch_id, branches(id, name, address, is_active)")
          .eq("user_id", userId);

        branchList = (ub ?? [])
          .map((r: any) => r.branches as Branch)
          .filter((b: Branch) => b && b.is_active);
      }

      setBranches(branchList);

      if (branchList.length === 0) {
        setActiveBranchState(null);
        setAllowedModules([]);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("active_branch_id")
        .eq("id", userId)
        .single();

      const dbActiveBranchId = (profile as any)?.active_branch_id as string | null;
      const savedId = localStorage.getItem("activeBranchId");

      const selected =
        branchList.find((b) => b.id === dbActiveBranchId) ||
        branchList.find((b) => b.id === savedId) ||
        branchList[0];

      setActiveBranchState(selected);
      localStorage.setItem("activeBranchId", selected.id);
      await fetchAllowedModules(userId, selected.id, role);

      if (dbActiveBranchId !== selected.id) {
        await supabase.rpc("set_user_active_branch", {
          p_target_user_id: userId,
          p_new_branch_id: selected.id,
          p_reason: "Sincronizacion de sucursal activa",
        });
      }
    } catch {
      setBranches([]);
      setActiveBranchState(null);
      setAllowedModules([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAllowedModules]);

  useEffect(() => {
    if (user && activeRole) {
      fetchBranches(user.id, activeRole);
    } else {
      setBranches([]);
      setActiveBranchState(null);
      setAllowedModules([]);
      setLoading(false);
    }
  }, [user, activeRole, fetchBranches]);

  const setActiveBranch = async (branch: Branch | null) => {
    if (!user) return;

    if (!branch) {
      setActiveBranchState(null);
      setAllowedModules([]);
      localStorage.removeItem("activeBranchId");
      return;
    }

    const { error } = await supabase.rpc("set_user_active_branch", {
      p_target_user_id: user.id,
      p_new_branch_id: branch.id,
      p_reason: "Cambio de sucursal activa desde app",
    });

    if (error) return;

    setActiveBranchState(branch);
    localStorage.setItem("activeBranchId", branch.id);
    await fetchAllowedModules(user.id, branch.id, activeRole);
  };

  const refreshAccess = useCallback(async () => {
    if (!user || !activeRole || !activeBranch) return;
    await fetchAllowedModules(user.id, activeBranch.id, activeRole);
  }, [user, activeRole, activeBranch, fetchAllowedModules]);

  return (
    <BranchContext.Provider
      value={{
        branches,
        activeBranch,
        activeBranchId: activeBranch?.id ?? null,
        allowedModules,
        setActiveBranch,
        refreshAccess,
        loading,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
};

export const useBranch = () => {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
};
