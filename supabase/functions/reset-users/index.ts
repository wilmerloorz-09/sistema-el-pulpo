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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resetMasterKey = Deno.env.get("RESET_MASTER_KEY");

    if (!supabaseUrl || !serviceRoleKey || !resetMasterKey) {
      return toJson({ error: "Configuracion incompleta para reset" }, 500);
    }

    const {
      master_key,
      new_superadmin_email,
      new_superadmin_password,
      new_superadmin_full_name,
      new_superadmin_username,
      reason,
    } = await req.json();

    if (master_key !== resetMasterKey) {
      return toJson({ error: "Clave maestra invalida" }, 403);
    }

    if (!new_superadmin_email || !new_superadmin_password || !new_superadmin_full_name || !new_superadmin_username) {
      return toJson({ error: "Faltan datos del nuevo superadmin" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Delete all auth users (cascades to profiles and related data through existing FKs)
    const allUsers: string[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) return toJson({ error: `Error listando usuarios: ${error.message}` }, 500);

      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const u of users) allUsers.push(u.id);
      if (users.length < perPage) break;
      page += 1;
    }

    for (const userId of allUsers) {
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) {
        return toJson({ error: `Error eliminando usuario ${userId}: ${error.message}` }, 500);
      }
    }

    // Create fresh superadmin
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: String(new_superadmin_email).toLowerCase(),
      password: new_superadmin_password,
      email_confirm: true,
      user_metadata: {
        full_name: new_superadmin_full_name,
        username: new_superadmin_username,
      },
    });

    if (createErr || !created?.user?.id) {
      return toJson({ error: createErr?.message ?? "No se pudo crear el nuevo superadmin" }, 500);
    }

    const newUserId = created.user.id;

    const { error: roleErr } = await adminClient.from("user_roles").insert({
      user_id: newUserId,
      role: "superadmin",
    });

    if (roleErr) {
      return toJson({ error: `No se pudo asignar rol superadmin: ${roleErr.message}` }, 500);
    }

    const { data: branches, error: branchErr } = await adminClient
      .from("branches")
      .select("id")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (branchErr) {
      return toJson({ error: `No se pudo leer sucursales: ${branchErr.message}` }, 500);
    }

    let effectiveBranches = branches ?? [];

    if (effectiveBranches.length === 0) {
      const { data: createdBranch, error: createBranchErr } = await adminClient
        .from("branches")
        .insert({
          name: "Sucursal Principal",
          address: "Inicializada por reset",
          is_active: true,
          branch_code: "MAIN",
        })
        .select("id")
        .single();

      if (createBranchErr || !createdBranch?.id) {
        return toJson({ error: `No se pudo crear sucursal inicial: ${createBranchErr?.message ?? "desconocido"}` }, 500);
      }

      effectiveBranches = [{ id: createdBranch.id }];
    }

    if (effectiveBranches.length > 0) {
      const firstBranchId = effectiveBranches[0].id;

      for (const b of effectiveBranches) {
        const { error } = await adminClient.from("user_branches").insert({
          user_id: newUserId,
          branch_id: b.id,
        });

        if (error && !error.message.includes("duplicate")) {
          return toJson({ error: `No se pudo asignar sucursal ${b.id}: ${error.message}` }, 500);
        }
      }

      const { error: activeErr } = await adminClient
        .from("profiles")
        .update({ active_branch_id: firstBranchId })
        .eq("id", newUserId);

      if (activeErr) {
        return toJson({ error: `No se pudo setear sucursal activa: ${activeErr.message}` }, 500);
      }

      const { data: adminModules, error: modErr } = await adminClient
        .from("modules")
        .select("id, code")
        .in("code", ["sucursales", "usuarios", "configuracion"]);

      if (modErr) {
        return toJson({ error: `No se pudo leer modulos administrativos: ${modErr.message}` }, 500);
      }

      for (const b of effectiveBranches) {
        for (const m of adminModules ?? []) {
          const { error } = await adminClient.from("user_branch_modules").upsert(
            {
              user_id: newUserId,
              branch_id: b.id,
              module_id: m.id,
              is_active: true,
              assigned_by: null,
            },
            { onConflict: "user_id,branch_id,module_id" }
          );

          if (error) {
            return toJson({ error: `No se pudo asignar modulo ${m.code}: ${error.message}` }, 500);
          }
        }
      }
    }

    const { error: protectErr } = await adminClient
      .from("profiles")
      .update({
        is_active: true,
        is_protected_superadmin: true,
      })
      .eq("id", newUserId);

    if (protectErr) {
      return toJson({ error: `No se pudo proteger superadmin inicial: ${protectErr.message}` }, 500);
    }

    await adminClient.from("audit_log").insert({
      user_id: null,
      action: "RESET_USERS_AND_BOOTSTRAP_SUPERADMIN",
      entity: "auth.users",
      entity_id: newUserId,
      before_data: { deleted_users_count: allUsers.length, reason: reason ?? null },
      after_data: {
        new_superadmin_user_id: newUserId,
        new_superadmin_email: String(new_superadmin_email).toLowerCase(),
      },
    });

    return toJson({
      status: "ok",
      deleted_users_count: allUsers.length,
      new_superadmin_user_id: newUserId,
      new_superadmin_email: String(new_superadmin_email).toLowerCase(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});

