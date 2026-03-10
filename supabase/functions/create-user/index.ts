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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
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

    if (callerError || !caller) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const { data: isGlobalAdmin } = await adminClient.rpc("is_global_admin", { _user_id: caller.id });
    if (!isGlobalAdmin) {
      return toJson({ error: "Solo administradores globales pueden crear usuarios" }, 403);
    }

    const { email, password, full_name, username, branch_roles, global_roles } = await req.json();

    if (!email || !password || !full_name || !username) {
      return toJson({ error: "Faltan campos requeridos" }, 400);
    }

    const branchRoleList = Array.isArray(branch_roles)
      ? branch_roles
          .map((entry: any) => ({
            branch_id: String(entry?.branch_id ?? "").trim(),
            role_code: String(entry?.role_code ?? "").trim(),
          }))
          .filter((entry) => entry.branch_id && entry.role_code)
      : [];

    const globalRoleList = Array.isArray(global_roles)
      ? [...new Set(global_roles.map((role: unknown) => String(role).trim()).filter(Boolean))]
      : [];

    if (branchRoleList.length === 0 && globalRoleList.length === 0) {
      return toJson({ error: "Debes asignar al menos un rol global o una sucursal con rol" }, 400);
    }

    const branchIds = [...new Set(branchRoleList.map((entry) => entry.branch_id))];

    if (branchIds.length > 0) {
      const { data: validBranches, error: validBranchesError } = await adminClient
        .from("branches")
        .select("id, is_active")
        .in("id", branchIds);

      if (validBranchesError) {
        return toJson({ error: "No se pudo validar sucursales" }, 500);
      }

      if (!validBranches || validBranches.length !== branchIds.length) {
        return toJson({ error: "Una o mas sucursales no existen" }, 400);
      }

      if (validBranches.some((branch) => branch.is_active === false)) {
        return toJson({ error: "No puedes asignar sucursales inactivas" }, 400);
      }
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, username },
    });

    if (authError || !authData?.user?.id) {
      return toJson({ error: authError?.message ?? "No se pudo crear el usuario auth" }, 400);
    }

    const userId = authData.user.id;

    for (const roleCode of globalRoleList) {
      const { error } = await callerClient.rpc("assign_user_global_role", {
        p_target_user_id: userId,
        p_role_code: roleCode,
      });
      if (error) {
        return toJson({ error: `No se pudo asignar rol global '${roleCode}': ${error.message}` }, 400);
      }
    }

    for (const assignment of branchRoleList) {
      const { error } = await callerClient.rpc("assign_user_branch_role", {
        p_target_user_id: userId,
        p_branch_id: assignment.branch_id,
        p_role_code: assignment.role_code,
        p_reason: "Asignacion inicial al crear usuario",
      });
      if (error) {
        return toJson({ error: `No se pudo asignar sucursal '${assignment.branch_id}': ${error.message}` }, 400);
      }
    }

    if (branchRoleList.length > 0) {
      const { error: activeError } = await callerClient.rpc("set_user_active_branch", {
        p_target_user_id: userId,
        p_new_branch_id: branchRoleList[0].branch_id,
        p_reason: "Sucursal activa inicial",
      });

      if (activeError) {
        return toJson({ error: `No se pudo definir sucursal activa: ${activeError.message}` }, 400);
      }
    } else {
      const { data: firstBranch } = await adminClient
        .from("branches")
        .select("id")
        .eq("is_active", true)
        .order("name")
        .limit(1)
        .maybeSingle();

      if (firstBranch?.id) {
        await adminClient.from("profiles").update({ active_branch_id: firstBranch.id }).eq("id", userId);
      }
    }

    return toJson({ id: userId, email, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
