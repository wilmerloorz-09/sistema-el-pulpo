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
      items ?? ["tables", "categories", "modifiers"],
    );
    const stats: Record<string, number> = {};

    // 1. CLEAN TARGET BRANCH
    if (clean_first) {
      if (selectedItems.has("categories")) {
        // Clean menu_nodes completely first (cascades menu_node_modifiers)
        const { error: deleteMenuNodesError } = await adminClient
          .from("menu_nodes")
          .delete()
          .eq("branch_id", target_branch_id);
        if (deleteMenuNodesError) {
          return toJson({ error: `No se pudo limpiar menu visual: ${deleteMenuNodesError.message}` }, 400);
        }

        const { data: targetCats, error: targetCatsError } = await adminClient
          .from("categories")
          .select("id")
          .eq("branch_id", target_branch_id);
        if (targetCatsError) {
          return toJson({ error: `No se pudo encontrar categorias destino: ${targetCatsError.message}` }, 400);
        }

        if (targetCats?.length) {
          const catIds = targetCats.map((c: any) => c.id);
          const { data: targetSubs, error: targetSubsError } = await adminClient
            .from("subcategories")
            .select("id")
            .in("category_id", catIds);
          if (targetSubsError) {
            return toJson({ error: `No se pudo encontrar subcategorias destino: ${targetSubsError.message}` }, 400);
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
      ] as const) {
        if (!selectedItems.has(itemKey)) continue;
        const { error } = await adminClient.from(tableName).delete().eq("branch_id", target_branch_id);
        if (error) {
          return toJson({ error: `No se pudo limpiar ${tableName}: ${error.message}` }, 400);
        }
      }
    }

    // 2. COPY TABLES
    if (selectedItems.has("tables")) {
      const { data: sourceBranch, error: sourceBranchError } = await adminClient
        .from("branches")
        .select("reference_table_count")
        .eq("id", source_branch_id)
        .single();
      if (sourceBranchError) return toJson({ error: `No se pudo leer referencia de mesas: ${sourceBranchError.message}` }, 400);

      const referenceCount = Number(sourceBranch.reference_table_count ?? 0);
      const { error: updateBranchError } = await adminClient
        .from("branches")
        .update({ reference_table_count: referenceCount })
        .eq("id", target_branch_id);
      if (updateBranchError) return toJson({ error: `No se pudo copiar referencia de mesas: ${updateBranchError.message}` }, 400);

      const { error: ensureTablesError } = await adminClient.rpc("ensure_branch_table_capacity", {
        p_branch_id: target_branch_id,
        p_requested_count: referenceCount,
      });
      if (ensureTablesError) return toJson({ error: `No se pudo preparar mesas internas: ${ensureTablesError.message}` }, 400);

      stats.mesas = referenceCount;
    }

    // 3. COPY MODIFIERS AND CACHE MAP
    const modifierMap = new Map<string, string>(); // oldId -> newId
    if (selectedItems.has("modifiers")) {
      const { data: mods, error } = await adminClient
        .from("modifiers")
        .select("*")
        .eq("branch_id", source_branch_id);
      if (error) return toJson({ error: `No se pudo leer modificadores: ${error.message}` }, 400);

      if (mods?.length) {
        const rows = mods.map((m: any) => {
          const newId = crypto.randomUUID();
          modifierMap.set(m.id, newId);
          return { ...m, id: newId, branch_id: target_branch_id };
        });
        const { error: insertError } = await adminClient.from("modifiers").insert(rows);
        if (insertError) return toJson({ error: `No se pudo duplicar modificadores: ${insertError.message}` }, 400);
        stats.modificadores = rows.length;
      }
    }

    // 4. COPY CATEGORIES, LEGACY CATALOG & MENU NODES
    if (selectedItems.has("categories")) {
      let displayOrderOffset = 0;
      if (!clean_first) {
        const { data: maxCat } = await adminClient
          .from("categories")
          .select("display_order")
          .eq("branch_id", target_branch_id)
          .order("display_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (maxCat) displayOrderOffset = (maxCat.display_order ?? 0) + 10;
      }

      // Legacy maps
      const categoryMap = new Map<string, string>(); // oldId -> newId
      const subcategoryMap = new Map<string, string>(); // oldId -> newId
      const productMap = new Map<string, string>(); // oldId -> newId

      // Copy Categories
      const { data: cats, error: catsError } = await adminClient
        .from("categories")
        .select("*")
        .eq("branch_id", source_branch_id);
      if (catsError) return toJson({ error: `No se pudo leer categorias: ${catsError.message}` }, 400);

      if (cats?.length) {
        const catRows = cats.map((c: any) => {
          const newId = crypto.randomUUID();
          categoryMap.set(c.id, newId);
          return { ...c, id: newId, branch_id: target_branch_id, display_order: c.display_order + displayOrderOffset };
        });
        const { error: insCatsError } = await adminClient.from("categories").insert(catRows);
        if (insCatsError) return toJson({ error: `Error clonando categorias: ${insCatsError.message}` }, 400);
        stats.categorias = catRows.length;

        // Copy Subcategories
        const catIds = cats.map((c: any) => c.id);
        const { data: subs, error: subsError } = await adminClient
          .from("subcategories")
          .select("*")
          .in("category_id", catIds);
        if (subsError) return toJson({ error: `No se pudo leer subcategorias: ${subsError.message}` }, 400);

        if (subs?.length) {
          const subRows = subs.map((s: any) => {
            const newId = crypto.randomUUID();
            subcategoryMap.set(s.id, newId);
            return { ...s, id: newId, category_id: categoryMap.get(s.category_id) };
          });
          const { error: insSubsError } = await adminClient.from("subcategories").insert(subRows);
          if (insSubsError) return toJson({ error: `Error clonando subcategorias: ${insSubsError.message}` }, 400);
          stats.subcategorias = subRows.length;

          // Copy Products
          const subIds = subs.map((s: any) => s.id);
          const { data: prods, error: prodsError } = await adminClient
            .from("products")
            .select("*")
            .in("subcategory_id", subIds);
          if (prodsError) return toJson({ error: `No se pudo leer productos: ${prodsError.message}` }, 400);

          if (prods?.length) {
            const prodRows = prods.map((p: any) => {
              const newId = crypto.randomUUID();
              productMap.set(p.id, newId);
              return { ...p, id: newId, subcategory_id: subcategoryMap.get(p.subcategory_id) };
            });
            const { error: insProdsError } = await adminClient.from("products").insert(prodRows);
            if (insProdsError) return toJson({ error: `Error clonando productos: ${insProdsError.message}` }, 400);
            stats.productos = prodRows.length;
          }
        }
      }

      // Copy Menu Nodes (The visual tree)
      const menuNodeMap = new Map<string, string>(); // oldNodeId -> newNodeId
      const { data: nodes, error: nodesError } = await adminClient
        .from("menu_nodes")
        .select("*")
        .eq("branch_id", source_branch_id)
        .order("depth", { ascending: true });
      
      if (nodesError) return toJson({ error: `No se pudo leer menu_nodes: ${nodesError.message}` }, 400);

      if (nodes?.length) {
        for (const n of nodes) {
          menuNodeMap.set(n.id, crypto.randomUUID());
        }

        const nodeRows = nodes.map((n: any) => ({
          ...n,
          id: menuNodeMap.get(n.id),
          branch_id: target_branch_id,
          parent_id: n.parent_id ? menuNodeMap.get(n.parent_id) : null,
          legacy_product_id: n.legacy_product_id ? (productMap.get(n.legacy_product_id) || n.legacy_product_id) : null,
          display_order: n.depth === 0 ? n.display_order + displayOrderOffset : n.display_order
        }));

        const maxDepth = Math.max(...nodes.map((n: any) => n.depth));
        for (let d = 0; d <= maxDepth; d++) {
          const layer = nodeRows.filter((n: any) => n.depth === d);
          if (layer.length > 0) {
            const { error: layerError } = await adminClient.from("menu_nodes").insert(layer);
            if (layerError) return toJson({ error: `Error clonando arbol de menu en prof. ${d}: ${layerError.message}` }, 400);
          }
        }
        stats.menu_nodos = nodeRows.length;

        // Copy Menu Node Modifiers
        const oldNodeIds = nodes.map((n: any) => n.id);
        const chunkSize = 500;
        const allNodeMods = [];
        
        for (let i = 0; i < oldNodeIds.length; i += chunkSize) {
          const chunk = oldNodeIds.slice(i, i + chunkSize);
          const { data: modChunk, error: modError } = await adminClient
            .from("menu_node_modifiers")
            .select("*")
            .in("node_id", chunk);
          if (modError) return toJson({ error: `No se pudo leer modificadores de nodos: ${modError.message}` }, 400);
          if (modChunk) allNodeMods.push(...modChunk);
        }

        if (allNodeMods.length > 0) {
          const nodeModRows = allNodeMods.map((nm: any) => {
             const newNodeId = menuNodeMap.get(nm.node_id);
             const newModId = modifierMap.get(nm.modifier_id) || nm.modifier_id;
             // Remove id to allow db to generate it
             const { id, ...rest } = nm;
             return { ...rest, node_id: newNodeId, modifier_id: newModId };
          });
          const { error: insNodeModsError } = await adminClient.from("menu_node_modifiers").insert(nodeModRows);
          if (insNodeModsError) return toJson({ error: `Error clonando asignacion de modificadores: ${insNodeModsError.message}` }, 400);
          stats.asignaciones_nodos_modificadores = nodeModRows.length;
        }

        // Copy Bulk Included Products if they exist for these nodes
        const allBulkProducts = [];
        for (let i = 0; i < oldNodeIds.length; i += chunkSize) {
          const chunk = oldNodeIds.slice(i, i + chunkSize);
          const { data: bulkChunk, error: bulkError } = await adminClient
            .from("bulk_included_products")
            .select("*")
            .in("node_id", chunk);
          if (bulkError && bulkError.code !== "PGRST116" && bulkError.code !== "42P01") { 
             // 42P01: relation does not exist (just in case)
          } else if (bulkChunk) {
             allBulkProducts.push(...bulkChunk);
          }
        }

        if (allBulkProducts.length > 0) {
          const bulkRows = allBulkProducts.map((bp: any) => {
             const newNodeId = menuNodeMap.get(bp.node_id);
             const newProductId = productMap.get(bp.product_id) || bp.product_id;
             const { id, ...rest } = bp;
             return { ...rest, node_id: newNodeId, product_id: newProductId };
          });
          const { error: insBulkError } = await adminClient.from("bulk_included_products").insert(bulkRows);
          if (insBulkError) return toJson({ error: `Error clonando configuracion bulk: ${insBulkError.message}` }, 400);
          stats.productos_bulto = bulkRows.length;
        }
      }
    }

    return toJson({ success: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno inesperado";
    return toJson({ error: message }, 500);
  }
});
