import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const toJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    if (!normalized.includes("@")) {
      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("email")
        .ilike("username", rawIdentifier)
        .limit(1)
        .maybeSingle();

      if (profileError) {
        return toJson({ error: "Error validando identificador" }, 500);
      }

      if (!profile?.email) {
        return toJson({ error: "Credenciales invalidas" }, 401);
      }

      resolvedEmail = String(profile.email).toLowerCase();
    }

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    });

    if (signInError || !signInData.session || !signInData.user) {
      return toJson({ error: "Credenciales invalidas" }, 401);
    }

    const { data: profile, error: stateError } = await adminClient
      .from("profiles")
      .select("is_active")
      .eq("id", signInData.user.id)
      .maybeSingle();

    if (stateError) {
      return toJson({ error: "Error validando estado del usuario" }, 500);
    }

    if (!profile || profile.is_active === false) {
      await anonClient.auth.signOut();
      return toJson({ error: "Usuario inactivo" }, 403);
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
    return toJson({ error: message }, 500);
  }
});
