import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const users = [
    { email: "admin@elpulpo.com", password: "admin123", full_name: "Administrador", username: "admin", roles: ["admin"] },
    { email: "mesero1@elpulpo.com", password: "mesero123", full_name: "Carlos Mesero", username: "mesero1", roles: ["mesero"] },
    { email: "mesero2@elpulpo.com", password: "mesero123", full_name: "María Mesera", username: "mesero2", roles: ["mesero"] },
    { email: "cajero@elpulpo.com", password: "cajero123", full_name: "Ana Cajera", username: "cajero1", roles: ["cajero"] },
    { email: "cocina@elpulpo.com", password: "cocina123", full_name: "Pedro Cocina", username: "cocina1", roles: ["cocina"] },
    { email: "super@elpulpo.com", password: "super123", full_name: "Super Usuario", username: "superuser", roles: ["admin", "mesero", "cajero", "cocina"] },
  ];

  const results = [];

  for (const u of users) {
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
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

    // Assign roles
    for (const role of u.roles) {
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (roleError) {
        results.push({ email: u.email, role, roleError: roleError.message });
      }
    }

    results.push({ email: u.email, id: userId, roles: u.roles, status: "created" });
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
