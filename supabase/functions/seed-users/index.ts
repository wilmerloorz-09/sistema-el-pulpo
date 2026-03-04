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

  // List all existing users
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const emailToId = new Map(existingUsers?.users?.map(u => [u.email, u.id]) ?? []);

  for (const u of users) {
    const existingId = emailToId.get(u.email);
    
    if (existingId) {
      // Update existing user: confirm email and reset password
      const { error } = await supabase.auth.admin.updateUserById(existingId, {
        password: u.password,
        email_confirm: true,
        user_metadata: { full_name: u.full_name, username: u.username },
      });

      if (error) {
        results.push({ email: u.email, error: error.message });
        continue;
      }

      // Ensure roles exist
      for (const role of u.roles) {
        await supabase.from("user_roles").upsert(
          { user_id: existingId, role },
          { onConflict: "user_id,role" }
        );
      }

      results.push({ email: u.email, id: existingId, status: "updated" });
    } else {
      // Create new user
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
      for (const role of u.roles) {
        await supabase.from("user_roles").insert({ user_id: userId, role });
      }

      results.push({ email: u.email, id: userId, status: "created" });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
