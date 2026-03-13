import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
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

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_ACTIVITY_STORAGE_KEY = "authSessionActivity";
const SESSION_ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
const SESSION_EXPIRY_CHECK_INTERVAL_MS = 30 * 1000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type SessionActivity = {
  userId: string;
  lastActivityAt: number;
};

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

const readStoredSessionActivity = (): SessionActivity | null => {
  const raw = localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SessionActivity>;
    if (typeof parsed.userId !== "string" || typeof parsed.lastActivityAt !== "number") {
      return null;
    }
    return parsed as SessionActivity;
  } catch {
    return null;
  }
};

const writeStoredSessionActivity = (userId: string, lastActivityAt: number) => {
  localStorage.setItem(
    SESSION_ACTIVITY_STORAGE_KEY,
    JSON.stringify({
      userId,
      lastActivityAt,
    }),
  );
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
  });
  const expiringSessionRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) throw error;
    return (data ?? null) as Profile | null;
  }, []);

  const clearSessionTracking = useCallback(() => {
    localStorage.removeItem(SESSION_ACTIVITY_STORAGE_KEY);
  }, []);

  const touchSessionActivity = useCallback((userId: string) => {
    writeStoredSessionActivity(userId, Date.now());
  }, []);

  const signOut = useCallback(async () => {
    clearSessionTracking();
    localStorage.removeItem("activeBranchId");
    await supabase.auth.signOut();
  }, [clearSessionTracking]);

  const expireSession = useCallback(async () => {
    if (expiringSessionRef.current) return;
    expiringSessionRef.current = true;

    try {
      await signOut();
      toast.warning("Sesion cerrada por inactividad");
    } finally {
      expiringSessionRef.current = false;
    }
  }, [signOut]);

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
        clearSessionTracking();
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
  }, [clearSessionTracking, fetchProfile]);

  useEffect(() => {
    const userId = state.user?.id;
    if (!userId) {
      clearSessionTracking();
      return;
    }

    const existingActivity = readStoredSessionActivity();
    if (!existingActivity || existingActivity.userId !== userId) {
      touchSessionActivity(userId);
    }

    let lastWriteAt = 0;

    const checkSessionAge = async () => {
      const activity = readStoredSessionActivity();

      if (!activity || activity.userId !== userId) {
        touchSessionActivity(userId);
        return;
      }

      if (Date.now() - activity.lastActivityAt >= SESSION_TIMEOUT_MS) {
        await expireSession();
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWriteAt < SESSION_ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteAt = now;
      touchSessionActivity(userId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkSessionAge();
      }
    };

    const handleFocus = () => {
      void checkSessionAge();
    };

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      void checkSessionAge();
    }, SESSION_EXPIRY_CHECK_INTERVAL_MS);

    void checkSessionAge();

    return () => {
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [clearSessionTracking, expireSession, state.user?.id, touchSessionActivity]);

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

  return <AuthContext.Provider value={{ ...state, signIn, signOut, refreshProfile }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
