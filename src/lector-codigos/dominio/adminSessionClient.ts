import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseFetchWithOfflineGuard } from "@/lib/offlineAction";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Sesión admin temporal: no toca localStorage ni la sesión del usuario de Extra. */
export async function createAdminSessionClient(params: {
  accessToken: string;
  refreshToken: string;
}): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    },
    global: {
      fetch: supabaseFetchWithOfflineGuard,
    },
  });

  const { error } = await client.auth.setSession({
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
  });
  if (error) throw error;
  return client;
}

export type ExtraFreqAdminAuth = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};
