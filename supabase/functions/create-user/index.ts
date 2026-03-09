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

const ROLE_DEFAULT_MODULES: Record<string, string[]> = {
  admin: ["mesas", "ordenes", "despacho", "caja", "pagos", "reportes", "usuarios", "configuracion", "sucursales"],
  superadmin: ["mesas", "ordenes", "despacho", "caja", "pagos", "reportes", "usuarios", "configuracion", "sucursales"],
  supervisor: ["mesas", "ordenes", "despacho", "caja", "pagos", "reportes", "usuarios"],
  mesero: ["mesas", "ordenes"],
  cajero: ["caja", "pagos"],
  cocina: ["despacho"],
  despachador_mesas: ["despacho"],
  despachador_takeout: ["despacho"],
};

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

    const [{ data: isAdmin }, { data: isSuperadmin }] = await Promise.all([
      adminClient.rpc("has_role", { _user_id: caller.id, _role: "admin" }),
      adminClient.rpc("has_role", { _user_id: caller.id, _role: "superadmin" }),
    ]);

    if (!isAdmin && !isSuperadmin) {
      return toJson({ error: "Solo admin/superadmin pueden crear usuarios" }, 403);
    }

    const { email, password, full_name, username, roles, branch_ids } = await req.json();

    if (!email || !password || !full_name || !username) {
      return toJson({ error: "Faltan campos requeridos" }, 400);
    }

    const roleList = Array.isArray(roles)
      ? [...new Set(roles.map((r: unknown) => String(r).trim()).filter(Boolean))]
      : [];
    const branchList = Array.isArray(branch_ids)
      ? [...new Set(branch_ids.map((b: unknown) => String(b).trim()).filter(Boolean))]
      : [];

    if (roleList.length === 0) {
      return toJson({ error: "Debes asignar al menos un rol" }, 400);
    }

    if (branchList.length === 0) {
      return toJson({ error: "Debes asignar al menos una sucursal" }, 400);
    }

    const { data: validBranches, error: validBranchesError } = await adminClient
      .from("branches")
      .select("id, is_active")
      .in("id", branchList);

    if (validBranchesError) {
      return toJson({ error: "No se pudo validar sucursales" }, 500);
    }

    if (!validBranches || validBranches.length !== branchList.length) {
      return toJson({ error: "Una o mas sucursales no existen" }, 400);
    }

    if (validBranches.some((b) => b.is_active === false)) {
      return toJson({ error: "No puedes asignar sucursales inactivas" }, 400);
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

    for (const role of roleList) {
      const { error } = await adminClient.from("user_roles").insert({ user_id: userId, role });
      if (error) return toJson({ error: `No se pudo asignar rol '${role}': ${error.message}` }, 400);
    }

    for (const branch_id of branchList) {
      const { error } = await callerClient.rpc("assign_user_branch", {
        p_target_user_id: userId,
        p_branch_id: branch_id,
        p_reason: "Asignacion inicial al crear usuario",
      });
      if (error) {
        return toJson({ error: `No se pudo asignar sucursal '${branch_id}': ${error.message}` }, 400);
      }
    }

    const { error: activeError } = await callerClient.rpc("set_user_active_branch", {
      p_target_user_id: userId,
      p_new_branch_id: branchList[0],
      p_reason: "Sucursal activa inicial",
    });

    if (activeError) {
      return toJson({ error: `No se pudo definir sucursal activa: ${activeError.message}` }, 400);
    }

    const defaultModules = [...new Set(roleList.flatMap((role) => ROLE_DEFAULT_MODULES[role] ?? []))];

    for (const branch_id of branchList) {
      for (const moduleCode of defaultModules) {
        const { error } = await callerClient.rpc("upsert_user_branch_module", {
          p_target_user_id: userId,
          p_branch_id: branch_id,
          p_module_code: moduleCode,
          p_is_active: true,
          p_reason: "Asignacion automatica inicial por rol",
        });

        if (error) {
          return toJson({
            error: `No se pudo asignar modulo '${moduleCode}' para sucursal '${branch_id}': ${error.message}`,
          }, 400);
        }
      }
    }

    return toJson({ id: userId, email, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
