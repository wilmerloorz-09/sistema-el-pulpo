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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return toJson({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return toJson({ error: "Faltan secretos SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerToken);

    if (callerError || !caller) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const { data: isGlobalAdmin } = await adminClient.rpc("is_global_admin", { _user_id: caller.id });
    if (!isGlobalAdmin) {
      return toJson({ error: "Solo administradores globales pueden eliminar usuarios" }, 403);
    }

    const payload = await req.json();
    const targetUserId = String(payload?.user_id ?? "").trim();

    if (!targetUserId) {
      return toJson({ error: "No se indico el ID del usuario a eliminar" }, 400);
    }

    if (targetUserId === caller.id) {
       return toJson({ error: "No puedes eliminar tu propia cuenta" }, 400);
    }

    // 1. Check if user has historical records
    const { data: checkData, error: checkError } = await adminClient.rpc("admin_can_delete_user", {
      p_user_id: targetUserId
    });

    if (checkError) {
      return toJson({ error: `Error al validar registros historicos: ${checkError.message}` }, 500);
    }

    if (!checkData?.can_delete) {
      return toJson({ error: checkData?.reason || "El usuario tiene actividad historica y no puede eliminarse" }, 400);
    }

    // 2. Perform deletion
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    
    if (authDeleteError) {
      return toJson({ error: `Error al eliminar de Auth: ${authDeleteError.message}` }, 500);
    }

    return toJson({ success: true, message: "Usuario eliminado correctamente" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
