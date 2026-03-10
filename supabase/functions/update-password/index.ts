import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const toJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("update-password: missing authorization header");
      return toJson({ error: "No autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("update-password: missing env vars");
      return toJson({ error: "Faltan secretos SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const callerClient = createClient(supabaseUrl, anonKey ?? serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerToken);

    if (callerError) {
      console.error("update-password: auth.getUser failed", callerError.message);
    }

    if (!caller) {
      console.error("update-password: caller not resolved");
      return toJson({ error: "No autorizado" }, 401);
    }

    const { target_user_id, new_password } = await req.json();
    console.log("update-password: request", {
      caller_id: caller.id,
      target_user_id: target_user_id ?? caller.id,
      changing_other_user: Boolean(target_user_id && target_user_id !== caller.id),
    });

    if (!new_password || new_password.length < 6) {
      console.error("update-password: password too short");
      return toJson({ error: "La contrasena debe tener al menos 6 caracteres" }, 400);
    }

    if (target_user_id && target_user_id !== caller.id) {
      const { data: isAdmin, error: adminCheckError } = await adminClient.rpc("is_global_admin", {
        _user_id: caller.id,
      });

      if (adminCheckError) {
        console.error("update-password: admin check failed", adminCheckError.message);
        return toJson({ error: "No se pudo validar el permiso administrativo" }, 500);
      }

      if (!isAdmin) {
        console.error("update-password: caller lacks admin permission", caller.id);
        return toJson({ error: "Solo administradores pueden cambiar contrasenas de otros usuarios" }, 403);
      }
    }

    const userId = target_user_id || caller.id;

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      password: new_password,
    });

    if (error) {
      console.error("update-password: updateUserById failed", error.message);
      return toJson({ error: error.message }, 400);
    }

    console.log("update-password: password updated", { caller_id: caller.id, target_user_id: userId });
    return toJson({ status: "password_updated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno al cambiar contrasena";
    console.error("update-password: unexpected error", message);
    return toJson({ error: message }, 500);
  }
});
