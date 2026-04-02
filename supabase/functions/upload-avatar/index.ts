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
      return toJson({ error: "Faltan secretos de configuración" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verificar que el caller es admin global
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user: caller }, error: callerError } = await adminClient.auth.getUser(bearerToken);

    if (callerError || !caller) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const { data: isGlobalAdmin } = await adminClient.rpc("is_global_admin", { _user_id: caller.id });
    if (!isGlobalAdmin) {
      return toJson({ error: "Solo administradores globales pueden modificar avatares de otros usuarios" }, 403);
    }

    // Leer el FormData: target_user_id + file
    const formData = await req.formData();
    const targetUserId = String(formData.get("target_user_id") ?? "").trim();
    const file = formData.get("file") as File | null;

    if (!targetUserId) return toJson({ error: "Falta target_user_id" }, 400);
    if (!file) return toJson({ error: "Falta el archivo de imagen" }, 400);
    if (file.size > 2 * 1024 * 1024) return toJson({ error: "La imagen no puede superar los 2 MB" }, 400);

    // Determinar extensión
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${targetUserId}/avatar.${ext}`;

    // Subir con service role (bypasea RLS del storage)
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await adminClient.storage
      .from("avatars")
      .upload(path, arrayBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      return toJson({ error: `Error al subir imagen: ${uploadError.message}` }, 500);
    }

    // Obtener URL pública
    const { data: urlData } = adminClient.storage.from("avatars").getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Actualizar el perfil con la nueva URL
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ avatar_url: publicUrl } as any)
      .eq("id", targetUserId);

    if (updateError) {
      return toJson({ error: `Error al actualizar perfil: ${updateError.message}` }, 500);
    }

    return toJson({ avatar_url: publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
