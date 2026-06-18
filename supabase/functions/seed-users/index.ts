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

// ─────────────────────────────────────────────────────────────────────────────
// ADVERTENCIA DE SEGURIDAD:
// Esta función solo puede ser invocada por un Administrador Global autenticado.
// No está pensada para uso en producción normal. Úsala únicamente en ambientes
// de desarrollo/staging o para bootstrapping inicial, con extrema precaución.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Verificar que hay un header de autorización ─────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return toJson({ error: "No autorizado. Se requiere autenticación." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return toJson({ error: "Configuración de servidor incompleta" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    // ── 2. Verificar que el token es válido y pertenece a un usuario real ──
    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerToken);

    if (callerError || !caller) {
      return toJson({ error: "Token de autenticación inválido o expirado" }, 401);
    }

    // ── 3. Verificar que el usuario es Administrador Global ────────────────
    const { data: isGlobalAdmin } = await adminClient.rpc("is_global_admin", {
      _user_id: caller.id,
    });

    if (!isGlobalAdmin) {
      return toJson(
        { error: "Acceso denegado. Solo Administradores Globales pueden ejecutar seed-users." },
        403
      );
    }

    // ── 4. Verificar que hay un header especial de confirmación ───────────
    // Doble seguridad: requiere un header explícito para evitar ejecuciones accidentales
    const confirmHeader = req.headers.get("X-Confirm-Seed");
    if (confirmHeader !== "CONFIRMAR_SEED_USUARIOS") {
      return toJson(
        {
          error:
            "Se requiere el header 'X-Confirm-Seed: CONFIRMAR_SEED_USUARIOS' para ejecutar esta operación.",
        },
        400
      );
    }

    // ── 5. Registrar en audit_log quién ejecutó el seed ───────────────────
    await adminClient.from("audit_log").insert({
      user_id: caller.id,
      action: "SEED_USERS_EXECUTED",
      entity: "auth.users",
      entity_id: null,
      before_data: null,
      after_data: {
        executed_by: caller.email,
        executed_at: new Date().toISOString(),
        note: "Ejecución manual del seeder de usuarios de desarrollo",
      },
    });

    // ── 6. Ejecutar el seed ────────────────────────────────────────────────
    const users = [
      {
        email: "admin@elpulpo.com",
        password: "admin123",
        full_name: "Administrador",
        username: "admin",
        roles: ["admin"],
      },
      {
        email: "mesero1@elpulpo.com",
        password: "mesero123",
        full_name: "Carlos Mesero",
        username: "mesero1",
        roles: ["mesero"],
      },
      {
        email: "mesero2@elpulpo.com",
        password: "mesero123",
        full_name: "María Mesera",
        username: "mesero2",
        roles: ["mesero"],
      },
      {
        email: "cajero@elpulpo.com",
        password: "cajero123",
        full_name: "Ana Cajera",
        username: "cajero1",
        roles: ["cajero"],
      },
      {
        email: "cocina@elpulpo.com",
        password: "cocina123",
        full_name: "Pedro Cocina",
        username: "cocina1",
        roles: ["cocina"],
      },
      {
        email: "super@elpulpo.com",
        password: "super123",
        full_name: "Super Usuario",
        username: "superuser",
        roles: ["admin", "mesero", "cajero", "cocina"],
      },
    ];

    const results = [];

    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const emailToId = new Map(existingUsers?.users?.map((u) => [u.email, u.id]) ?? []);

    for (const u of users) {
      const existingId = emailToId.get(u.email);

      if (existingId) {
        const { error } = await adminClient.auth.admin.updateUserById(existingId, {
          password: u.password,
          email_confirm: true,
          user_metadata: { full_name: u.full_name, username: u.username },
        });

        if (error) {
          results.push({ email: u.email, error: error.message });
          continue;
        }

        for (const role of u.roles) {
          await adminClient
            .from("user_roles")
            .upsert({ user_id: existingId, role }, { onConflict: "user_id,role" });
        }

        results.push({ email: u.email, id: existingId, status: "updated" });
      } else {
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { full_name: u.full_name, username: u.username },
        });

        if (authError) {
          results.push({ email: u.email, error: authError.message });
          continue;
        }

        const userId = authData.user.id;
        for (const role of u.roles) {
          await adminClient.from("user_roles").insert({ user_id: userId, role });
        }

        results.push({ email: u.email, id: userId, status: "created" });
      }
    }

    return toJson({ results }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
