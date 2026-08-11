import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logBackgroundTaskError } from "@/lib/benignAsyncErrors";
import { AUTH_SESSION_POLL_MS } from "@/lib/queryEgress";

const PROFILE_SELECT =
  "id, full_name, first_name, last_name, username, alias, email, is_active, active_branch_id, is_protected_superadmin, avatar_url, current_app_session_id, current_app_session_started_at, current_app_session_device, current_app_secondary_session_id, current_app_secondary_session_started_at, current_app_secondary_session_device";

interface Profile {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  username: string;
  alias?: string;
  email?: string | null;
  is_active: boolean;
  active_branch_id?: string | null;
  is_protected_superadmin?: boolean;
  avatar_url?: string | null;
  current_app_session_id?: string | null;
  current_app_session_started_at?: string | null;
  current_app_session_device?: string | null;
  current_app_secondary_session_id?: string | null;
  current_app_secondary_session_started_at?: string | null;
  current_app_secondary_session_device?: string | null;
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

const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_ACTIVITY_STORAGE_KEY = "authSessionActivity";
const OWNED_SESSION_STORAGE_KEY = "authOwnedSingleSession";
const SESSION_ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
const SESSION_EXPIRY_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const SINGLE_SESSION_CHECK_INTERVAL_MS = AUTH_SESSION_POLL_MS;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type SessionActivity = {
  userId: string;
  lastActivityAt: number;
};

type OwnedSingleSession = {
  userId: string;
  sessionId: string;
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

const generateClientSessionId = () =>
  crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const readOwnedSingleSession = (): OwnedSingleSession | null => {
  const raw = localStorage.getItem(OWNED_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OwnedSingleSession>;
    if (typeof parsed.userId !== "string" || typeof parsed.sessionId !== "string") {
      return null;
    }
    return parsed as OwnedSingleSession;
  } catch {
    return null;
  }
};

const writeOwnedSingleSession = (userId: string, sessionId: string) => {
  localStorage.setItem(
    OWNED_SESSION_STORAGE_KEY,
    JSON.stringify({
      userId,
      sessionId,
    }),
  );
};

const buildClientDeviceLabel = () => {
  if (typeof navigator === "undefined") return "Dispositivo no identificado";

  const userAgent = navigator.userAgent ?? "";
  const platform = navigator.platform || "Plataforma desconocida";

  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) {
    return `Movil - ${platform}`;
  }

  return `PC - ${platform}`;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
  });
  const expiringSessionRef = useRef(false);
  const validatingSingleSessionRef = useRef(false);
  const lastWriteAtRef = useRef(0);

  /**
   * Lectura directa de perfil (sin dbSelect): un timeout/fallo debe LANZAR,
   * no devolver [] y apagar el alias a "Usuario".
   */
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return (data as Profile | null) ?? null;
  }, []);

  /** Lectura fresca solo de slots de sesion (sin cache offline / sin dbSelect). */
  const fetchAppSessionSlots = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("current_app_session_id, current_app_secondary_session_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data as {
      current_app_session_id: string | null;
      current_app_secondary_session_id: string | null;
    } | null;
  }, []);

  const clearSessionTracking = useCallback(() => {
    localStorage.removeItem(SESSION_ACTIVITY_STORAGE_KEY);
  }, []);

  const clearOwnedSingleSession = useCallback(() => {
    localStorage.removeItem(OWNED_SESSION_STORAGE_KEY);
  }, []);

  const touchSessionActivity = useCallback((userId: string) => {
    writeStoredSessionActivity(userId, Date.now());
  }, []);

  const signOut = useCallback(async () => {
    const ownedSession = readOwnedSingleSession();
    clearSessionTracking();
    clearOwnedSingleSession();
    localStorage.removeItem("activeBranchId");

    if (ownedSession?.sessionId) {
      await supabase.rpc("clear_my_single_session" as any, {
        p_session_id: ownedSession.sessionId,
      } as any);
    }

    await supabase.auth.signOut();
  }, [clearOwnedSingleSession, clearSessionTracking]);

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
    try {
      const profile = await fetchProfile(state.user.id);
      if (!profile) return;
      setState((prev) => ({ ...prev, profile }));
    } catch (error) {
      logBackgroundTaskError("AuthContext.refreshProfile", error);
    }
  }, [fetchProfile, state.user]);

  const registerOwnedSingleSession = useCallback(async (userId: string, sessionId?: string) => {
    const resolvedSessionId = sessionId ?? generateClientSessionId();
    // Reservar id local ANTES del RPC: evita dos UUID nuevos en paralelo
    // (uno quedaria en secundario y echaria al otro dispositivo).
    writeOwnedSingleSession(userId, resolvedSessionId);

    const { error } = await supabase.rpc("register_my_single_session" as any, {
      p_session_id: resolvedSessionId,
      p_device_label: buildClientDeviceLabel(),
    } as any);

    if (error) throw error;

    return resolvedSessionId;
  }, []);

  const forceSignOutDueToConcurrentSession = useCallback(async () => {
    if (expiringSessionRef.current) return;
    expiringSessionRef.current = true;

    try {
      const ownedSession = readOwnedSingleSession();
      clearSessionTracking();
      clearOwnedSingleSession();
      localStorage.removeItem("activeBranchId");

      if (ownedSession?.sessionId) {
        await supabase.rpc("clear_my_single_session" as any, {
          p_session_id: ownedSession.sessionId,
        } as any);
      }

      await supabase.auth.signOut();
      toast.error("Tu sesion fue cerrada porque se inicio sesion con este usuario en otro dispositivo.");
    } finally {
      expiringSessionRef.current = false;
    }
  }, [clearOwnedSingleSession, clearSessionTracking]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Un evento sin sesion que no sea SIGNED_OUT es un parpadeo de refresh de token:
      // limpiar `user` aqui recalcula el gate de turno con estado vacio y el menu
      // lateral alterna entre la vista operativa y la vista solo-admin.
      if (!session?.user && event !== "SIGNED_OUT") {
        return;
      }

      // TOKEN_REFRESHED: solo actualizar session/user. No refetch de perfil
      // (bajo Disk IO satura y un fallo apagaba el alias a "Usuario").
      if (event === "TOKEN_REFRESHED" && session?.user) {
        setState((prev) => ({
          ...prev,
          session,
          user: session.user,
          loading: false,
        }));
        return;
      }

      // Prevent flipping the global "loading" switch if we already have a session and profile.
      // This stops the whole app from unmounting (flashing white) when the browser refocuses or tokens refresh.
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        loading: session?.user && prev.profile ? false : true,
      }));

      if (session?.user) {
        const userId = session.user.id;
        setTimeout(async () => {
          try {
            const profile = await fetchProfile(userId);
            setState((prev) => ({
              ...prev,
              // Conservar perfil previo si la lectura viene vacia/fallida.
              profile: profile ?? prev.profile,
              loading: false,
            }));
          } catch (error) {
            logBackgroundTaskError("AuthContext.fetchProfile", error);
            setState((prev) => ({ ...prev, loading: false }));
          }
        }, 0);
      } else {
        clearSessionTracking();
        setState({ session: null, user: null, profile: null, loading: false });
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Similarly here, only set loading: false once we are sure about the profile
      if (session?.user) {
        try {
          const profile = await fetchProfile(session.user.id);
          setState((prev) => ({
            ...prev,
            session,
            user: session.user,
            profile: profile ?? prev.profile,
            loading: false,
          }));
        } catch (error) {
          logBackgroundTaskError("AuthContext.getSession.fetchProfile", error);
          setState((prev) => ({
            ...prev,
            session,
            user: session.user,
            loading: false,
          }));
        }
      } else {
        setState((prev) => ({ ...prev, session: null, user: null, loading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, [clearSessionTracking, fetchProfile]);

  useEffect(() => {
    const userId = state.user?.id;
    // No borrar authOwnedSingleSession si user parpadea a null (refresh de token):
    // un sessionId nuevo pisaria el slot secundario y cerraria el otro dispositivo.
    if (!userId) {
      return;
    }

    const validateSingleSession = async () => {
      if (validatingSingleSessionRef.current) return;
      validatingSingleSessionRef.current = true;

      try {
        const ownedSession = readOwnedSingleSession();
        const sessionSlots = await fetchAppSessionSlots(userId);

        if (!ownedSession || ownedSession.userId !== userId) {
          await registerOwnedSingleSession(userId);
          return;
        }

        const activeSessionIds = [
          sessionSlots?.current_app_session_id ?? null,
          sessionSlots?.current_app_secondary_session_id ?? null,
        ].filter((value): value is string => Boolean(value));

        if (activeSessionIds.length === 0) {
          await registerOwnedSingleSession(userId, ownedSession.sessionId);
          return;
        }

        if (!activeSessionIds.includes(ownedSession.sessionId)) {
          await forceSignOutDueToConcurrentSession();
        }
      } catch (error) {
        logBackgroundTaskError("AuthContext.validateSingleSession", error);
      } finally {
        validatingSingleSessionRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void validateSingleSession();
      }
    };

    const handleFocus = () => {
      void validateSingleSession();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    const intervalId = window.setInterval(() => {
      void validateSingleSession();
    }, SINGLE_SESSION_CHECK_INTERVAL_MS);

    void validateSingleSession();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.clearInterval(intervalId);
    };
  }, [
    fetchAppSessionSlots,
    forceSignOutDueToConcurrentSession,
    registerOwnedSingleSession,
    state.user?.id,
  ]);

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

    const checkSessionAge = async () => {
      try {
        const activity = readStoredSessionActivity();

        if (!activity || activity.userId !== userId) {
          touchSessionActivity(userId);
          return;
        }

        if (Date.now() - activity.lastActivityAt >= SESSION_TIMEOUT_MS) {
          await expireSession();
        }
      } catch (error) {
        logBackgroundTaskError("AuthContext.checkSessionAge", error);
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWriteAtRef.current < SESSION_ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteAtRef.current = now;
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

  const signIn = useCallback(async (identifier: string, password: string) => {
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
  }, []);

  const value = useMemo(
    () => ({ ...state, signIn, signOut, refreshProfile }),
    [state, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
