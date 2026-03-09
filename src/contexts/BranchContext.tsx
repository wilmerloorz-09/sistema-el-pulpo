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
  setActiveBranch: (branch: Branch | null) => void;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, activeRole } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async (userId: string, role: string | null) => {
    setLoading(true);
    try {
      if (role === "superadmin") {
        // Superadmin sees all branches
        const { data } = await supabase.from("branches").select("*").eq("is_active", true).order("name");
        setBranches((data as Branch[]) ?? []);
      } else {
        // Other roles see only assigned branches
        const { data: ub } = await supabase
          .from("user_branches")
          .select("branch_id, branches(id, name, address, is_active)")
          .eq("user_id", userId);
        const list = (ub ?? [])
          .map((r: any) => r.branches as Branch)
          .filter((b: Branch) => b && b.is_active);
        setBranches(list);
      }
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && activeRole) {
      fetchBranches(user.id, activeRole);
    } else {
      setBranches([]);
      setActiveBranchState(null);
      setLoading(false);
    }
  }, [user, activeRole, fetchBranches]);

  // Auto-select branch
  useEffect(() => {
    if (branches.length === 0) {
      setActiveBranchState(null);
      return;
    }
    const savedId = localStorage.getItem("activeBranchId");
    const saved = branches.find((b) => b.id === savedId);
    if (saved) {
      setActiveBranchState(saved);
    } else {
      setActiveBranchState(branches[0]);
      localStorage.setItem("activeBranchId", branches[0].id);
    }
  }, [branches]);

  const setActiveBranch = (branch: Branch | null) => {
    setActiveBranchState(branch);
    if (branch) {
      localStorage.setItem("activeBranchId", branch.id);
    } else {
      localStorage.removeItem("activeBranchId");
    }
  };

  return (
    <BranchContext.Provider
      value={{
        branches,
        activeBranch,
        activeBranchId: activeBranch?.id ?? null,
        setActiveBranch,
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


