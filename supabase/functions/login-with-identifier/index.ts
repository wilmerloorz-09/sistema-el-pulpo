import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const toJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientDbError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("timeout")
    || m.includes("timed out")
    || m.includes("57014")
    || m.includes("57p01")
    || m.includes("53300")
    || m.includes("connection")
    || m.includes("503")
    || m.includes("502")
    || m.includes("fetch failed")
    || m.includes("network")
  );
}

/**
 * Lookup barato: eq exacto (usa índice) en vez de ilike.
 * Reintentos cortos bajo saturación de BD.
 */
async function lookupProfileEmail(
  adminClient: SupabaseClient,
  identifier: string,
): Promise<{ email: string | null; error: string | null }> {
  const candidates = Array.from(
    new Set([identifier, identifier.toLowerCase()].filter(Boolean)),
  );

  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);

    for (const candidate of candidates) {
      const byUsername = await adminClient
        .from("profiles")
        .select("email")
        .eq("username", candidate)
        .limit(1);

      if (byUsername.error) {
        lastError = byUsername.error.message ?? "error username";
        if (!isTransientDbError(lastError)) {
          return { email: null, error: lastError };
        }
        continue;
      }

      const emailFromUser = byUsername.data?.[0]?.email;
      if (emailFromUser) return { email: String(emailFromUser), error: null };

      const byAlias = await adminClient
        .from("profiles")
        .select("email")
        .eq("alias", candidate)
        .limit(1);

      if (byAlias.error) {
        lastError = byAlias.error.message ?? "error alias";
        if (!isTransientDbError(lastError)) {
          return { email: null, error: lastError };
        }
        continue;
      }

      const emailFromAlias = byAlias.data?.[0]?.email;
      if (emailFromAlias) return { email: String(emailFromAlias), error: null };
    }

    if (lastError && isTransientDbError(lastError)) continue;
    break;
  }

  if (lastError && isTransientDbError(lastError)) {
    return {
      email: null,
      error: "Servidor saturado. Espera unos segundos e intenta de nuevo.",
    };
  }

  if (lastError) {
    return { email: null, error: "Error validando identificador" };
  }

  return { email: null, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return toJson({ error: "Configuracion incompleta del servidor" }, 500);
    }

    const { identifier, password } = await req.json();

    if (!identifier || !password) {
      return toJson({ error: "Debes enviar identificador y contrasena" }, 400);
    }

    const rawIdentifier = String(identifier).trim();
    const normalized = rawIdentifier.toLowerCase();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const anonClient = createClient(supabaseUrl, anonKey);

    let resolvedEmail = normalized;

    // Si ya viene email, no tocamos profiles (evita el fallo bajo saturación).
    if (!normalized.includes("@")) {
      const lookup = await lookupProfileEmail(adminClient, rawIdentifier);
      if (lookup.error && !lookup.email) {
        return toJson({ error: lookup.error }, 503);
      }
      if (!lookup.email) {
        return toJson({ error: "Credenciales invalidas" }, 401);
      }
      resolvedEmail = lookup.email.toLowerCase();
    }

    let signInData = null;
    let signInError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await anonClient.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      });
      signInData = result.data;
      signInError = result.error;
      if (!signInError && signInData.session && signInData.user) break;
      if (signInError && isTransientDbError(signInError.message) && attempt === 0) {
        await sleep(300);
        continue;
      }
      break;
    }

    if (signInError || !signInData?.session || !signInData?.user) {
      return toJson({ error: "Credenciales invalidas" }, 401);
    }

    const { data: profile, error: stateError } = await adminClient
      .from("profiles")
      .select("is_active")
      .eq("id", signInData.user.id)
      .limit(1);

    if (stateError) {
      // No bloquear login si solo falla el check de activo bajo saturación:
      // Auth ya validó la contraseña. Preferir entrar.
      console.warn("[login-with-identifier] is_active check failed:", stateError.message);
    } else {
      const row = profile?.[0];
      if (row && row.is_active === false) {
        await anonClient.auth.signOut();
        return toJson({ error: "Usuario inactivo" }, 403);
      }
    }

    return toJson({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      token_type: signInData.session.token_type,
      expires_in: signInData.session.expires_in,
      expires_at: signInData.session.expires_at,
      user: signInData.user,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    const status = isTransientDbError(message) ? 503 : 500;
    return toJson(
      {
        error: status === 503
          ? "Servidor saturado. Espera unos segundos e intenta de nuevo."
          : message,
      },
      status,
    );
  }
});
