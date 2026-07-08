import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { generateUUID } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { showSystemAlert } from "@/lib/systemAlert";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
}

type CloneMode = "edge_function" | "direct_fallback" | null;

async function cloneCatalogDirectly(
  sourceBranchId: string,
  targetBranchId: string,
  cleanFirst: boolean,
) {
  const stats: Record<string, number> = {};
  const selectedItems = new Set(["categories", "modifiers", "tables"]);

  if (cleanFirst) {
    if (selectedItems.has("categories")) {
      const { error: deleteMenuNodesError } = await supabase.from("menu_nodes" as any).delete().eq("branch_id", targetBranchId);
      if (deleteMenuNodesError) throw deleteMenuNodesError;

      const { data: targetCategories, error: targetCategoriesError } = await supabase.from("categories").select("id").eq("branch_id", targetBranchId);
      if (targetCategoriesError) throw targetCategoriesError;
      
      const categoryIds = (targetCategories ?? []).map((category) => category.id);
      if (categoryIds.length > 0) {
        const { data: targetSubs, error: targetSubsError } = await supabase.from("subcategories").select("id").in("category_id", categoryIds);
        if (targetSubsError) throw targetSubsError;

        const subIds = (targetSubs ?? []).map((subcategory) => subcategory.id);
        if (subIds.length > 0) {
          const { error: deleteProductsError } = await supabase.from("products").delete().in("subcategory_id", subIds);
          if (deleteProductsError) throw deleteProductsError;
          const { error: deleteSubsError } = await supabase.from("subcategories").delete().in("category_id", categoryIds);
          if (deleteSubsError) throw deleteSubsError;
        }

        const { error: deleteCategoriesError } = await supabase.from("categories").delete().eq("branch_id", targetBranchId);
        if (deleteCategoriesError) throw deleteCategoriesError;
      }
    }

    if (selectedItems.has("modifiers")) {
      const { error } = await supabase.from("modifiers").delete().eq("branch_id", targetBranchId);
      if (error) throw error;
    }
  }

  const modifierMap = new Map<string, string>();
  if (selectedItems.has("modifiers")) {
    const { data: modifiers, error } = await supabase.from("modifiers").select("*").eq("branch_id", sourceBranchId);
    if (error) throw error;

    if ((modifiers ?? []).length > 0) {
      const rows = (modifiers ?? []).map((modifier) => {
        const newId = generateUUID();
        modifierMap.set(modifier.id, newId);
        return { ...modifier, id: newId, branch_id: targetBranchId };
      });
      const { error: insertError } = await supabase.from("modifiers").insert(rows);
      if (insertError) throw insertError;
      stats.modificadores = rows.length;
    }
  }

  if (selectedItems.has("categories")) {
    let displayOrderOffset = 0;
    if (!cleanFirst) {
      const { data: maxCat } = await supabase.from("categories").select("display_order").eq("branch_id", targetBranchId).order("display_order", { ascending: false }).limit(1).maybeSingle();
      if (maxCat) displayOrderOffset = (maxCat.display_order ?? 0) + 10;
    }

    const categoryMap = new Map<string, string>();
    const subcategoryMap = new Map<string, string>();
    const productMap = new Map<string, string>();

    const { data: categories, error: categoriesError } = await supabase.from("categories").select("*").eq("branch_id", sourceBranchId);
    if (categoriesError) throw categoriesError;

    if ((categories ?? []).length > 0) {
      const catRows = (categories ?? []).map((c) => {
        const newId = generateUUID();
        categoryMap.set(c.id, newId);
        return { ...c, id: newId, branch_id: targetBranchId, display_order: c.display_order + displayOrderOffset };
      });
      const { error: insCatsError } = await supabase.from("categories").insert(catRows);
      if (insCatsError) throw insCatsError;
      stats.categorias = catRows.length;

      const catIds = (categories ?? []).map((c) => c.id);
      const { data: subs, error: subsError } = await supabase.from("subcategories").select("*").in("category_id", catIds);
      if (subsError) throw subsError;

      if ((subs ?? []).length > 0) {
        const subRows = (subs ?? []).map((s) => {
          const newId = generateUUID();
          subcategoryMap.set(s.id, newId);
          return { ...s, id: newId, category_id: categoryMap.get(s.category_id) };
        });
        const { error: insSubsError } = await supabase.from("subcategories").insert(subRows);
        if (insSubsError) throw insSubsError;
        stats.subcategorias = subRows.length;

        const subIds = (subs ?? []).map((s) => s.id);
        const { data: prods, error: prodsError } = await supabase.from("products").select("*").in("subcategory_id", subIds);
        if (prodsError) throw prodsError;

        if ((prods ?? []).length > 0) {
          const prodRows = (prods ?? []).map((p) => {
            const newId = generateUUID();
            productMap.set(p.id, newId);
            return { ...p, id: newId, subcategory_id: subcategoryMap.get(p.subcategory_id) };
          });
          const { error: insProdsError } = await supabase.from("products").insert(prodRows);
          if (insProdsError) throw insProdsError;
          stats.productos = prodRows.length;
        }
      }
    }

    const menuNodeMap = new Map<string, string>();
    const { data: nodes, error: nodesError } = await supabase.from("menu_nodes" as any).select("*").eq("branch_id", sourceBranchId).order("depth", { ascending: true });
    if (nodesError) throw nodesError;

    if ((nodes ?? []).length > 0) {
      for (const n of nodes ?? []) {
        menuNodeMap.set(n.id, generateUUID());
      }
      
      const nodeRows = (nodes ?? []).map((n) => ({
        ...n,
        id: menuNodeMap.get(n.id),
        branch_id: targetBranchId,
        parent_id: n.parent_id ? menuNodeMap.get(n.parent_id) : null,
        legacy_product_id: n.legacy_product_id ? (productMap.get(n.legacy_product_id) || n.legacy_product_id) : null,
        display_order: n.depth === 0 ? n.display_order + displayOrderOffset : n.display_order
      }));

      const maxDepth = Math.max(...(nodes ?? []).map((n) => n.depth));
      for (let d = 0; d <= maxDepth; d++) {
        const layer = nodeRows.filter((n) => n.depth === d);
        if (layer.length > 0) {
          const { error: layerError } = await supabase.from("menu_nodes" as any).insert(layer);
          if (layerError) throw layerError;
        }
      }
      stats.menu_nodos = nodeRows.length;

      const oldNodeIds = (nodes ?? []).map((n) => n.id);
      const chunkSize = 500;
      const allNodeMods = [];
      const allBulkProducts = [];
      
      for (let i = 0; i < oldNodeIds.length; i += chunkSize) {
        const chunk = oldNodeIds.slice(i, i + chunkSize);
        const { data: modChunk, error: modError } = await supabase.from("menu_node_modifiers" as any).select("*").in("node_id", chunk);
        if (modError) throw modError;
        if (modChunk) allNodeMods.push(...modChunk);

        const { data: bulkChunk, error: bulkError } = await supabase.from("bulk_included_products" as any).select("*").in("node_id", chunk);
        if (bulkError && bulkError.code !== "PGRST116" && bulkError.code !== "42P01") {
           // Ignore relation does not exist
        } else if (bulkChunk) {
           allBulkProducts.push(...bulkChunk);
        }
      }

      if (allNodeMods.length > 0) {
        const nodeModRows = allNodeMods.map((nm) => {
           const newNodeId = menuNodeMap.get(nm.node_id);
           const newModId = modifierMap.get(nm.modifier_id) || nm.modifier_id;
           const { id, ...rest } = nm;
           return { ...rest, node_id: newNodeId, modifier_id: newModId };
        });
        const { error: insNodeModsError } = await supabase.from("menu_node_modifiers" as any).insert(nodeModRows);
        if (insNodeModsError) throw insNodeModsError;
        stats.asignaciones_nodos_modificadores = nodeModRows.length;
      }

      if (allBulkProducts.length > 0) {
        const bulkRows = allBulkProducts.map((bp) => {
           const newNodeId = menuNodeMap.get(bp.node_id);
           const newProductId = productMap.get(bp.product_id) || bp.product_id;
           const { id, ...rest } = bp;
           return { ...rest, node_id: newNodeId, product_id: newProductId };
        });
        const { error: insBulkError } = await supabase.from("bulk_included_products" as any).insert(bulkRows);
        if (insBulkError) throw insBulkError;
        stats.productos_bulto = bulkRows.length;
      }
    }
  }

  return stats;
}

const CloneBranchCatalog = () => {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [cloneMode, setCloneMode] = useState<CloneMode>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ["clone-branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name, branch_code").eq("is_active", true).order("name");
      return (data ?? []) as Branch[];
    },
  });

  const handleCloneRequest = () => {
    if (!sourceId || !targetId) return;
    if (sourceId === targetId) {
      toast.error("Las sucursales deben ser diferentes");
      return;
    }
    setConfirmOpen(true);
  };

  const executeClone = async () => {
    setConfirmOpen(false);
    setCloning(true);
    setResult(null);
    setCloneMode(null);

    try {
      const { count: operationalCount, error: countError } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", targetId);

      if (countError) throw countError;

      if ((operationalCount ?? 0) > 0) {
        showSystemAlert("Seguridad del Sistema El Pulpo", "ERROR CRÍTICO:\n\nLa sucursal destino ya tiene órdenes o registros operacionales guardados. \n\nPor seguridad del sistema, no se puede vaciar ni duplicar el menú en esta sucursal.");
        setCloning(false);
        return;
      }

      const res = await supabase.functions.invoke("clone-branch-catalog", {
        body: {
          source_branch_id: sourceId,
          target_branch_id: targetId,
          items: ["categories", "modifiers", "tables"],
          clean_first: true,
        },
      });

      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(res.data.error);

      setResult(res.data.stats ?? {});
      setCloneMode("edge_function");
      toast.success("Menú duplicado correctamente por el servidor.");
    } catch (edgeError: any) {
      try {
        toast.info("Ejecutando duplicacion en modo cliente local (fallback)... Puede demorar un poco.", { duration: 5000 });
        const stats = await cloneCatalogDirectly(sourceId, targetId, true);
        setResult(stats);
        setCloneMode("direct_fallback");
        toast.success("Menú duplicado correctamente.");
      } catch (fallbackError: any) {
        const message = fallbackError?.message || edgeError?.message || "Error al duplicar";
        toast.error(message);
      }
    } finally {
      setCloning(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Copy className="h-5 w-5" />
          Duplicar menú entre sucursales
        </CardTitle>
        <CardDescription>Selecciona que elementos del menú y sus dependencias copiar de una sucursal a otra.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Esta operacion obligatoriamente <strong>LIMPIARÁ</strong> y eliminará todos los elementos del menú actual en la sucursal destino antes de copiar. NO se permite si la sucursal ya tiene ordenes registradas.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Sucursal origen</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar origen..." /></SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name} {branch.branch_code ? `(${branch.branch_code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Sucursal destino</label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar destino..." /></SelectTrigger>
            <SelectContent>
              {branches.filter((branch) => branch.id !== sourceId).map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name} {branch.branch_code ? `(${branch.branch_code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleCloneRequest}
          disabled={!sourceId || !targetId || cloning}
          className="w-full"
          variant="destructive"
        >
          {cloning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Duplicando...
            </>
          ) : "Limpiar destino y duplicar menú"}
        </Button>

        {result && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground">Registros copiados:</p>
              {cloneMode && (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  {cloneMode === "edge_function" ? "Modo: Servidor" : "Modo: Fallback directo"}
                </span>
              )}
            </div>
            {Object.entries(result).map(([key, value]) => (
              <p key={key} className="text-muted-foreground">- {key}: <span className="font-mono text-foreground">{value}</span></p>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Atención: Limpieza requerida
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-sm text-foreground/90 font-medium">
              {`¿Copiar el menú completo de "${branches.find(b => b.id === sourceId)?.name}" a "${branches.find(b => b.id === targetId)?.name}"?\n\nSe eliminará por completo todo el menú actual configurado en la sucursal de destino.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cloning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={executeClone} disabled={cloning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Aceptar y limpiar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default CloneBranchCatalog;
