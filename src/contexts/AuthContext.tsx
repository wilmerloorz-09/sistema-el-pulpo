import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Profile {
  id: string;
  full_name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  is_protected_superadmin?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setActiveRole: (role: AppRole | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const resolveEdgeError = async (err: any): Promise<string> => {
  if (!err) return "Error de autenticacion";

  const context = err.context;
  if (context && typeof context.text === "function") {
    try {
      const raw = await context.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.error) return parsed.error;
          return raw;
        } catch {
          return raw;
        }
      }
    } catch {
      // ignore
    }
  }

  return err.message || "Error de autenticacion";
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    roles: [],
    activeRole: null,
    loading: true,
  });

  const fetchUserData = useCallback(async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    const profile = profileRes.data as Profile | null;
    const roles = (rolesRes.data?.map((r) => r.role) ?? []) as AppRole[];

    const savedRole = localStorage.getItem("activeRole") as AppRole | null;
    const activeRole = savedRole && roles.includes(savedRole) ? savedRole : roles[0] ?? null;

    setState((prev) => ({ ...prev, profile, roles, activeRole, loading: false }));
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        setTimeout(() => fetchUserData(session.user.id), 0);
      } else {
        setState((prev) => ({
          ...prev,
          profile: null,
          roles: [],
          activeRole: null,
          loading: false,
        }));
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setState((prev) => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchUserData(session.user.id);
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUserData]);

  const signIn = async (identifier: string, password: string) => {
    const normalized = identifier.trim();

    const res = await supabase.functions.invoke("login-with-identifier", {
      body: {
        identifier: normalized,
        password,
      },
    });

    if (res.error) {
      throw new Error(await resolveEdgeError(res.error));
    }

    if (res.data?.error) {
      throw new Error(res.data.error);
    }

    const accessToken = res.data?.access_token;
    const refreshToken = res.data?.refresh_token;

    if (!accessToken || !refreshToken) {
      throw new Error("No se recibio sesion valida del servidor");
    }

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (setSessionError) throw setSessionError;
  };

  const signOut = async () => {
    localStorage.removeItem("activeRole");
    await supabase.auth.signOut();
  };

  const setActiveRole = (role: AppRole | null) => {
    if (role) {
      localStorage.setItem("activeRole", role);
    } else {
      localStorage.removeItem("activeRole");
    }
    setState((prev) => ({ ...prev, activeRole: role }));
  };

  return <AuthContext.Provider value={{ ...state, signIn, signOut, setActiveRole }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

