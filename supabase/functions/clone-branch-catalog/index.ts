import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("No autorizado");

    const { data: roleCheck } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    const { data: superCheck } = await supabase.rpc("has_role", { _user_id: user.id, _role: "superadmin" });
    if (!roleCheck && !superCheck) throw new Error("Se requiere rol admin");

    const { source_branch_id, target_branch_id, items } = await req.json();
    if (!source_branch_id || !target_branch_id) throw new Error("Faltan IDs de sucursal");
    if (source_branch_id === target_branch_id) throw new Error("Las sucursales deben ser diferentes");

    const selectedItems: Set<string> = new Set(items ?? ["tables", "categories", "modifiers", "payment_methods", "denominations"]);
    const stats: Record<string, number> = {};

    // 1. Clone restaurant_tables
    if (selectedItems.has("tables")) {
      const { data: tables } = await supabase.from("restaurant_tables").select("name, visual_order, is_active").eq("branch_id", source_branch_id);
      if (tables?.length) {
        const rows = tables.map((t: any) => ({ ...t, branch_id: target_branch_id }));
        await supabase.from("restaurant_tables").insert(rows);
        stats.mesas = rows.length;
      }
    }

    // 2. Clone modifiers
    if (selectedItems.has("modifiers")) {
      const { data: mods } = await supabase.from("modifiers").select("description, is_active").eq("branch_id", source_branch_id);
      if (mods?.length) {
        const rows = mods.map((m: any) => ({ ...m, branch_id: target_branch_id }));
        await supabase.from("modifiers").insert(rows);
        stats.modificadores = rows.length;
      }
    }

    // 3. Clone payment_methods
    if (selectedItems.has("payment_methods")) {
      const { data: pms } = await supabase.from("payment_methods").select("name, is_active").eq("branch_id", source_branch_id);
      if (pms?.length) {
        const rows = pms.map((p: any) => ({ ...p, branch_id: target_branch_id }));
        await supabase.from("payment_methods").insert(rows);
        stats.metodos_pago = rows.length;
      }
    }

    // 4. Clone denominations
    if (selectedItems.has("denominations")) {
      const { data: denoms } = await supabase.from("denominations").select("label, value, display_order, is_active").eq("branch_id", source_branch_id);
      if (denoms?.length) {
        const rows = denoms.map((d: any) => ({ ...d, branch_id: target_branch_id }));
        await supabase.from("denominations").insert(rows);
        stats.denominaciones = rows.length;
      }
    }

    // 5. Clone categories → subcategories → products
    if (selectedItems.has("categories")) {
      const { data: cats } = await supabase.from("categories").select("id, description, display_order, is_active").eq("branch_id", source_branch_id);
      let totalSubs = 0;
      let totalProds = 0;

      if (cats?.length) {
        for (const cat of cats) {
          const oldCatId = cat.id;
          const { data: newCat } = await supabase.from("categories").insert({
            description: cat.description,
            display_order: cat.display_order,
            is_active: cat.is_active,
            branch_id: target_branch_id,
          }).select("id").single();

          if (!newCat) continue;

          const { data: subs } = await supabase.from("subcategories").select("id, description, display_order, is_active").eq("category_id", oldCatId);
          if (subs?.length) {
            for (const sub of subs) {
              const oldSubId = sub.id;
              const { data: newSub } = await supabase.from("subcategories").insert({
                description: sub.description,
                display_order: sub.display_order,
                is_active: sub.is_active,
                category_id: newCat.id,
              }).select("id").single();

              if (!newSub) continue;
              totalSubs++;

              const { data: prods } = await supabase.from("products").select("description, unit_price, price_mode, is_active").eq("subcategory_id", oldSubId);
              if (prods?.length) {
                const prodRows = prods.map((p: any) => ({ ...p, subcategory_id: newSub.id }));
                await supabase.from("products").insert(prodRows);
                totalProds += prodRows.length;
              }
            }
          }
        }
        stats.categorias = cats.length;
        stats.subcategorias = totalSubs;
        stats.productos = totalProds;
      }
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
