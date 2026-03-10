import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  full_name: string;
  username: string;
  email?: string | null;
  is_active: boolean;
  active_branch_id?: string | null;
  is_protected_superadmin?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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
      // ignore edge error body failures
    }
  }

  return err.message || "Error de autenticacion";
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
  });

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) throw error;
    return (data ?? null) as Profile | null;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const profile = await fetchProfile(state.user.id);
    setState((prev) => ({ ...prev, profile }));
  }, [fetchProfile, state.user]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({ ...prev, session, user: session?.user ?? null, loading: true }));

      if (session?.user) {
        setTimeout(async () => {
          try {
            const profile = await fetchProfile(session.user.id);
            setState((prev) => ({ ...prev, profile, loading: false }));
          } catch {
            setState((prev) => ({ ...prev, profile: null, loading: false }));
          }
        }, 0);
      } else {
        setState({ session: null, user: null, profile: null, loading: false });
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setState((prev) => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        try {
          const profile = await fetchProfile(session.user.id);
          setState((prev) => ({ ...prev, profile, loading: false }));
        } catch {
          setState((prev) => ({ ...prev, profile: null, loading: false }));
        }
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

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
    localStorage.removeItem("activeBranchId");
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ ...state, signIn, signOut, refreshProfile }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
