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
      return toJson({ error: "Solo administradores globales pueden crear usuarios" }, 403);
    }

    const payload = await req.json();
    const email = String(payload?.email ?? "").trim().toLowerCase();
    const password = String(payload?.password ?? "");
    const full_name = String(payload?.full_name ?? "").trim();
    const username = String(payload?.username ?? "").trim();
    const branch_roles = payload?.branch_roles;
    const global_roles = payload?.global_roles;

    if (!email || !password || !full_name || !username) {
      return toJson({ error: "Faltan campos requeridos" }, 400);
    }

    const { data: existingUsername, error: existingUsernameError } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .limit(1)
      .maybeSingle();

    if (existingUsernameError) {
      return toJson({ error: "No se pudo validar el nombre de usuario" }, 500);
    }

    if (existingUsername?.id) {
      return toJson({ error: "El nombre de usuario ya existe. Usa otro diferente." }, 400);
    }

    const { data: existingEmail, error: existingEmailError } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (existingEmailError) {
      return toJson({ error: "No se pudo validar el correo electronico" }, 500);
    }

    if (existingEmail?.id) {
      return toJson({ error: "El correo electronico ya esta registrado." }, 400);
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
      const authMessage = String(authError?.message ?? "").trim();
      if (authMessage.toLowerCase().includes("database error creating new user")) {
        return toJson({ error: "No se pudo crear el usuario. Revisa que el correo y el nombre de usuario no esten repetidos." }, 400);
      }
      return toJson({ error: authMessage || "No se pudo crear el usuario auth" }, 400);
    }

    const userId = authData.user.id;

    try {
      if (globalRoleList.length > 0) {
        const { data: globalRolesData, error: globalRolesError } = await adminClient
          .from("roles")
          .select("id, code")
          .eq("scope", "GLOBAL")
          .eq("is_active", true)
          .in("code", globalRoleList);

        if (globalRolesError) {
          throw new Error("No se pudieron resolver los roles globales");
        }

        const globalRoleMap = new Map((globalRolesData ?? []).map((role) => [role.code, role.id]));
        for (const roleCode of globalRoleList) {
          const roleId = globalRoleMap.get(roleCode);
          if (!roleId) {
            throw new Error(`Rol global invalido: ${roleCode}`);
          }

          const { error } = await adminClient
            .from("user_global_roles")
            .upsert({
              user_id: userId,
              role_id: roleId,
              is_active: true,
              assigned_by: caller.id,
            }, {
              onConflict: "user_id,role_id",
              ignoreDuplicates: false,
            });

          if (error) {
            throw new Error(`No se pudo asignar rol global '${roleCode}': ${error.message}`);
          }
        }
      }

      if (branchRoleList.length > 0) {
        const branchRoleCodes = [...new Set(branchRoleList.map((entry) => entry.role_code))];
        const { data: branchRolesData, error: branchRolesError } = await adminClient
          .from("roles")
          .select("id, code")
          .eq("scope", "BRANCH")
          .eq("is_active", true)
          .in("code", branchRoleCodes);

        if (branchRolesError) {
          throw new Error("No se pudieron resolver los roles de sucursal");
        }

        const branchRoleMap = new Map((branchRolesData ?? []).map((role) => [role.code, role.id]));

        for (const assignment of branchRoleList) {
          const roleId = branchRoleMap.get(assignment.role_code);
          if (!roleId) {
            throw new Error(`Rol de sucursal invalido: ${assignment.role_code}`);
          }

          const { error: branchLinkError } = await adminClient
            .from("user_branches")
            .upsert({
              user_id: userId,
              branch_id: assignment.branch_id,
            }, {
              onConflict: "user_id,branch_id",
              ignoreDuplicates: false,
            });

          if (branchLinkError) {
            throw new Error(`No se pudo asignar sucursal '${assignment.branch_id}': ${branchLinkError.message}`);
          }

          const { error: branchRoleError } = await adminClient
            .from("user_branch_roles")
            .upsert({
              user_id: userId,
              branch_id: assignment.branch_id,
              role_id: roleId,
              is_active: true,
              assigned_by: caller.id,
            }, {
              onConflict: "user_id,branch_id,role_id",
              ignoreDuplicates: false,
            });

          if (branchRoleError) {
            throw new Error(`No se pudo asignar rol de sucursal '${assignment.role_code}': ${branchRoleError.message}`);
          }
        }

        const { error: activeError } = await adminClient
          .from("profiles")
          .update({ active_branch_id: branchRoleList[0].branch_id })
          .eq("id", userId);

        if (activeError) {
          throw new Error(`No se pudo definir sucursal activa: ${activeError.message}`);
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
          const { error: fallbackBranchError } = await adminClient
            .from("profiles")
            .update({ active_branch_id: firstBranch.id })
            .eq("id", userId);

          if (fallbackBranchError) {
            throw new Error(`No se pudo definir sucursal activa inicial: ${fallbackBranchError.message}`);
          }
        }
      }
    } catch (assignmentError) {
      await adminClient.auth.admin.deleteUser(userId);
      throw assignmentError;
    }

    return toJson({ id: userId, email, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
