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

const normalizeText = (value: unknown) => String(value ?? "").trim();
const normalizeEmail = (value: unknown) => normalizeText(value).toLowerCase();
const isUserNotFoundMessage = (value: unknown) =>
  normalizeText(value).toLowerCase().includes("user not found");

async function resolveAuthUserId(
  adminClient: ReturnType<typeof createClient>,
  requestedId: string | null,
  requestedEmail: string | null,
  requestedUsername: string | null,
) {
  const normalizedId = normalizeText(requestedId);
  const normalizedEmail = normalizeEmail(requestedEmail);
  const normalizedUsername = normalizeText(requestedUsername).toLowerCase();

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`No se pudo listar usuarios auth: ${error.message}`);
    }

    const users = data?.users ?? [];
    const matchedUser = users.find((user) => {
      const userEmail = normalizeEmail(user.email);
      const userUsername = normalizeText(user.user_metadata?.username).toLowerCase();

      return (
        (normalizedId.length > 0 && user.id === normalizedId)
        || (normalizedEmail.length > 0 && userEmail === normalizedEmail)
        || (normalizedUsername.length > 0 && userUsername === normalizedUsername)
      );
    });

    if (matchedUser) {
      return matchedUser.id;
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
}

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
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("update-password: missing env vars");
      return toJson({ error: "Faltan secretos SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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

    const { target_user_id, target_user_email, target_username, new_password } = await req.json();
    console.log("update-password: request", {
      caller_id: caller.id,
      target_user_id: target_user_id ?? caller.id,
      target_user_email: target_user_email ?? null,
      target_username: target_username ?? null,
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

    const changingOtherUser = Boolean(target_user_id && target_user_id !== caller.id);
    let userId = target_user_id || caller.id;
    let targetProfile:
      | {
          id: string;
          email: string | null;
          username: string | null;
        }
      | null = null;

    if (changingOtherUser) {
      const { data, error: profileError } = await adminClient
        .from("profiles")
        .select("id, email, username")
        .eq("id", target_user_id)
        .maybeSingle();

      if (profileError) {
        console.error("update-password: target profile lookup failed", profileError.message);
        return toJson({ error: "No se pudo validar el usuario objetivo" }, 500);
      }

      if (!data) {
        return toJson({ error: "El perfil del usuario no existe" }, 404);
      }
      targetProfile = data;
    }

    let { error } = await adminClient.auth.admin.updateUserById(userId, {
      password: new_password,
    });

    if (error && changingOtherUser && isUserNotFoundMessage(error.message)) {
      const resolvedUserId = await resolveAuthUserId(
        adminClient,
        target_user_id,
        target_user_email ?? targetProfile?.email ?? null,
        target_username ?? targetProfile?.username ?? null,
      );

      if (!resolvedUserId) {
        console.error("update-password: target auth user not found", {
          target_user_id,
          target_user_email: target_user_email ?? targetProfile?.email ?? null,
          target_username: target_username ?? targetProfile?.username ?? null,
        });
        return toJson({ error: "No se encontro el usuario en Auth para cambiar la contrasena" }, 404);
      }

      userId = resolvedUserId;
      ({ error } = await adminClient.auth.admin.updateUserById(userId, {
        password: new_password,
      }));
    }

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
