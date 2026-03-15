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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return toJson({ error: "Faltan secretos SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(bearerToken);

    if (authError || !user) {
      return toJson({ error: "No autorizado" }, 401);
    }

    const { data: isGlobalAdmin, error: adminError } = await adminClient.rpc("is_global_admin", {
      _user_id: user.id,
    });

    if (adminError) {
      return toJson({ error: "No se pudo validar el permiso administrativo" }, 500);
    }

    if (!isGlobalAdmin) {
      return toJson({ error: "Solo administradores globales pueden duplicar catalogos" }, 403);
    }

    const { source_branch_id, target_branch_id, items, clean_first } = await req.json();
    if (!source_branch_id || !target_branch_id) {
      return toJson({ error: "Faltan IDs de sucursal" }, 400);
    }
    if (source_branch_id === target_branch_id) {
      return toJson({ error: "Las sucursales deben ser diferentes" }, 400);
    }

    const selectedItems = new Set(
      items ?? ["tables", "categories", "modifiers", "payment_methods", "denominations"],
    );
    const stats: Record<string, number> = {};

    if (clean_first) {
      if (selectedItems.has("categories")) {
        const { data: targetCats, error: targetCatsError } = await adminClient
          .from("categories")
          .select("id")
          .eq("branch_id", target_branch_id);

        if (targetCatsError) {
          return toJson({ error: `No se pudo limpiar categorias destino: ${targetCatsError.message}` }, 400);
        }

        if (targetCats?.length) {
          const catIds = targetCats.map((c: any) => c.id);
          const { data: targetSubs, error: targetSubsError } = await adminClient
            .from("subcategories")
            .select("id")
            .in("category_id", catIds);

          if (targetSubsError) {
            return toJson({ error: `No se pudo limpiar subcategorias destino: ${targetSubsError.message}` }, 400);
          }

          if (targetSubs?.length) {
            const subIds = targetSubs.map((s: any) => s.id);
            const { error: deleteProductsError } = await adminClient
              .from("products")
              .delete()
              .in("subcategory_id", subIds);

            if (deleteProductsError) {
              return toJson({ error: `No se pudo limpiar productos destino: ${deleteProductsError.message}` }, 400);
            }

            const { error: deleteSubcategoriesError } = await adminClient
              .from("subcategories")
              .delete()
              .in("category_id", catIds);

            if (deleteSubcategoriesError) {
              return toJson({ error: `No se pudo limpiar subcategorias destino: ${deleteSubcategoriesError.message}` }, 400);
            }
          }

          const { error: deleteCategoriesError } = await adminClient
            .from("categories")
            .delete()
            .eq("branch_id", target_branch_id);

          if (deleteCategoriesError) {
            return toJson({ error: `No se pudo limpiar categorias destino: ${deleteCategoriesError.message}` }, 400);
          }
        }
      }

      for (const [itemKey, tableName] of [
        ["modifiers", "modifiers"],
        ["payment_methods", "payment_methods"],
        ["denominations", "denominations"],
      ] as const) {
        if (!selectedItems.has(itemKey)) continue;

        const { error } = await adminClient.from(tableName).delete().eq("branch_id", target_branch_id);
        if (error) {
          return toJson({ error: `No se pudo limpiar ${tableName}: ${error.message}` }, 400);
        }
      }
    }

    if (selectedItems.has("tables")) {
      const { data: sourceBranch, error: sourceBranchError } = await adminClient
        .from("branches")
        .select("reference_table_count")
        .eq("id", source_branch_id)
        .single();

      if (sourceBranchError) {
        return toJson({ error: `No se pudo leer referencia de mesas: ${sourceBranchError.message}` }, 400);
      }

      const referenceCount = Number(sourceBranch.reference_table_count ?? 0);
      const { error: updateBranchError } = await adminClient
        .from("branches")
        .update({ reference_table_count: referenceCount })
        .eq("id", target_branch_id);

      if (updateBranchError) {
        return toJson({ error: `No se pudo copiar referencia de mesas: ${updateBranchError.message}` }, 400);
      }

      const { error: ensureTablesError } = await adminClient.rpc("ensure_branch_table_capacity", {
        p_branch_id: target_branch_id,
        p_requested_count: referenceCount,
      });

      if (ensureTablesError) {
        return toJson({ error: `No se pudo preparar mesas internas: ${ensureTablesError.message}` }, 400);
      }

      stats.mesas = referenceCount;
    }

    if (selectedItems.has("modifiers")) {
      const { data: mods, error } = await adminClient
        .from("modifiers")
        .select("description, is_active")
        .eq("branch_id", source_branch_id);

      if (error) return toJson({ error: `No se pudo leer modificadores: ${error.message}` }, 400);
      if (mods?.length) {
        const rows = mods.map((m: any) => ({ ...m, branch_id: target_branch_id }));
        const { error: insertError } = await adminClient.from("modifiers").insert(rows);
        if (insertError) return toJson({ error: `No se pudo duplicar modificadores: ${insertError.message}` }, 400);
        stats.modificadores = rows.length;
      }
    }

    if (selectedItems.has("payment_methods")) {
      const { data: paymentMethods, error } = await adminClient
        .from("payment_methods")
        .select("name, is_active")
        .eq("branch_id", source_branch_id);

      if (error) return toJson({ error: `No se pudo leer metodos de pago: ${error.message}` }, 400);
      if (paymentMethods?.length) {
        const rows = paymentMethods.map((p: any) => ({ ...p, branch_id: target_branch_id }));
        const { error: insertError } = await adminClient.from("payment_methods").insert(rows);
        if (insertError) return toJson({ error: `No se pudo duplicar metodos de pago: ${insertError.message}` }, 400);
        stats.metodos_pago = rows.length;
      }
    }

    if (selectedItems.has("denominations")) {
      const { data: denoms, error } = await adminClient
        .from("denominations")
        .select("label, value, display_order, is_active")
        .eq("branch_id", source_branch_id);

      if (error) return toJson({ error: `No se pudo leer denominaciones: ${error.message}` }, 400);
      if (denoms?.length) {
        const rows = denoms.map((d: any) => ({ ...d, branch_id: target_branch_id }));
        const { error: insertError } = await adminClient.from("denominations").insert(rows);
        if (insertError) return toJson({ error: `No se pudo duplicar denominaciones: ${insertError.message}` }, 400);
        stats.denominaciones = rows.length;
      }
    }

    if (selectedItems.has("categories")) {
      const { data: cats, error: catsError } = await adminClient
        .from("categories")
        .select("id, description, display_order, is_active")
        .eq("branch_id", source_branch_id);

      if (catsError) return toJson({ error: `No se pudo leer categorias: ${catsError.message}` }, 400);

      let totalSubs = 0;
      let totalProds = 0;

      if (cats?.length) {
        for (const cat of cats) {
          const oldCatId = cat.id;
          const { data: newCat, error: newCatError } = await adminClient
            .from("categories")
            .insert({
              description: cat.description,
              display_order: cat.display_order,
              is_active: cat.is_active,
              branch_id: target_branch_id,
            })
            .select("id")
            .single();

          if (newCatError || !newCat) {
            return toJson({ error: `No se pudo duplicar categoria '${cat.description}': ${newCatError?.message ?? "error"}` }, 400);
          }

          const { data: subs, error: subsError } = await adminClient
            .from("subcategories")
            .select("id, description, display_order, is_active")
            .eq("category_id", oldCatId);

          if (subsError) {
            return toJson({ error: `No se pudo leer subcategorias: ${subsError.message}` }, 400);
          }

          if (subs?.length) {
            for (const sub of subs) {
              const oldSubId = sub.id;
              const { data: newSub, error: newSubError } = await adminClient
                .from("subcategories")
                .insert({
                  description: sub.description,
                  display_order: sub.display_order,
                  is_active: sub.is_active,
                  category_id: newCat.id,
                })
                .select("id")
                .single();

              if (newSubError || !newSub) {
                return toJson({ error: `No se pudo duplicar subcategoria '${sub.description}': ${newSubError?.message ?? "error"}` }, 400);
              }

              totalSubs++;

              const { data: products, error: productsError } = await adminClient
                .from("products")
                .select("description, unit_price, price_mode, is_active")
                .eq("subcategory_id", oldSubId);

              if (productsError) {
                return toJson({ error: `No se pudo leer productos: ${productsError.message}` }, 400);
              }

              if (products?.length) {
                const productRows = products.map((p: any) => ({ ...p, subcategory_id: newSub.id }));
                const { error: insertProductsError } = await adminClient.from("products").insert(productRows);
                if (insertProductsError) {
                  return toJson({ error: `No se pudo duplicar productos: ${insertProductsError.message}` }, 400);
                }
                totalProds += productRows.length;
              }
            }
          }
        }

        stats.categorias = cats.length;
        stats.subcategorias = totalSubs;
        stats.productos = totalProds;
      }
    }

    return toJson({ success: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
