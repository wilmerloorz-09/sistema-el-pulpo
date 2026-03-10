import { useState } from "react";
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

interface Branch {
  id: string;
  name: string;
  branch_code: string;
}

const CATALOG_ITEMS = [
  { key: "tables", label: "Mesas" },
  { key: "categories", label: "Categorias, subcategorias y productos" },
  { key: "modifiers", label: "Modificadores" },
  { key: "payment_methods", label: "Metodos de pago" },
  { key: "denominations", label: "Denominaciones" },
] as const;

type CatalogKey = (typeof CATALOG_ITEMS)[number]["key"];
type CloneMode = "edge_function" | "direct_fallback" | null;

async function cloneCatalogDirectly(
  sourceBranchId: string,
  targetBranchId: string,
  selectedItems: Set<CatalogKey>,
  cleanFirst: boolean,
) {
  const stats: Record<string, number> = {};

  if (cleanFirst) {
    if (selectedItems.has("categories")) {
      const { data: targetCategories, error: targetCategoriesError } = await supabase
        .from("categories")
        .select("id")
        .eq("branch_id", targetBranchId);
      if (targetCategoriesError) throw targetCategoriesError;

      const categoryIds = (targetCategories ?? []).map((category) => category.id);
      if (categoryIds.length > 0) {
        const { data: targetSubs, error: targetSubsError } = await supabase
          .from("subcategories")
          .select("id")
          .in("category_id", categoryIds);
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

    if (selectedItems.has("tables")) {
      const { error } = await supabase.from("restaurant_tables").delete().eq("branch_id", targetBranchId);
      if (error) throw error;
    }

    if (selectedItems.has("modifiers")) {
      const { error } = await supabase.from("modifiers").delete().eq("branch_id", targetBranchId);
      if (error) throw error;
    }

    if (selectedItems.has("payment_methods")) {
      const { error } = await supabase.from("payment_methods").delete().eq("branch_id", targetBranchId);
      if (error) throw error;
    }

    if (selectedItems.has("denominations")) {
      const { error } = await supabase.from("denominations").delete().eq("branch_id", targetBranchId);
      if (error) throw error;
    }
  }

  if (selectedItems.has("tables")) {
    const { data: tables, error } = await supabase
      .from("restaurant_tables")
      .select("name, visual_order, is_active")
      .eq("branch_id", sourceBranchId);
    if (error) throw error;

    if ((tables ?? []).length > 0) {
      const rows = (tables ?? []).map((table) => ({ ...table, branch_id: targetBranchId }));
      const { error: insertError } = await supabase.from("restaurant_tables").insert(rows);
      if (insertError) throw insertError;
      stats.mesas = rows.length;
    }
  }

  if (selectedItems.has("modifiers")) {
    const { data: modifiers, error } = await supabase
      .from("modifiers")
      .select("description, is_active")
      .eq("branch_id", sourceBranchId);
    if (error) throw error;

    if ((modifiers ?? []).length > 0) {
      const rows = (modifiers ?? []).map((modifier) => ({ ...modifier, branch_id: targetBranchId }));
      const { error: insertError } = await supabase.from("modifiers").insert(rows);
      if (insertError) throw insertError;
      stats.modificadores = rows.length;
    }
  }

  if (selectedItems.has("payment_methods")) {
    const { data: methods, error } = await supabase
      .from("payment_methods")
      .select("name, is_active")
      .eq("branch_id", sourceBranchId);
    if (error) throw error;

    if ((methods ?? []).length > 0) {
      const rows = (methods ?? []).map((method) => ({ ...method, branch_id: targetBranchId }));
      const { error: insertError } = await supabase.from("payment_methods").insert(rows);
      if (insertError) throw insertError;
      stats.metodos_pago = rows.length;
    }
  }

  if (selectedItems.has("denominations")) {
    const { data: denominations, error } = await supabase
      .from("denominations")
      .select("label, value, display_order, is_active")
      .eq("branch_id", sourceBranchId)
      .order("display_order");
    if (error) throw error;

    if ((denominations ?? []).length > 0) {
      const rows = (denominations ?? []).map((denomination) => ({ ...denomination, branch_id: targetBranchId }));
      const { error: insertError } = await supabase.from("denominations").insert(rows);
      if (insertError) throw insertError;
      stats.denominaciones = rows.length;
    }
  }

  if (selectedItems.has("categories")) {
    const { data: categories, error: categoriesError } = await supabase
      .from("categories")
      .select("id, description, display_order, is_active")
      .eq("branch_id", sourceBranchId)
      .order("display_order");
    if (categoriesError) throw categoriesError;

    let totalSubs = 0;
    let totalProducts = 0;

    for (const category of categories ?? []) {
      const { data: newCategory, error: newCategoryError } = await supabase
        .from("categories")
        .insert({
          description: category.description,
          display_order: category.display_order,
          is_active: category.is_active,
          branch_id: targetBranchId,
        })
        .select("id")
        .single();
      if (newCategoryError) throw newCategoryError;
      if (!newCategory) continue;

      const { data: subcategories, error: subcategoriesError } = await supabase
        .from("subcategories")
        .select("id, description, display_order, is_active")
        .eq("category_id", category.id)
        .order("display_order");
      if (subcategoriesError) throw subcategoriesError;

      for (const subcategory of subcategories ?? []) {
        const { data: newSubcategory, error: newSubcategoryError } = await supabase
          .from("subcategories")
          .insert({
            description: subcategory.description,
            display_order: subcategory.display_order,
            is_active: subcategory.is_active,
            category_id: newCategory.id,
          })
          .select("id")
          .single();
        if (newSubcategoryError) throw newSubcategoryError;
        if (!newSubcategory) continue;
        totalSubs += 1;

        const { data: products, error: productsError } = await supabase
          .from("products")
          .select("description, unit_price, price_mode, is_active")
          .eq("subcategory_id", subcategory.id);
        if (productsError) throw productsError;

        if ((products ?? []).length > 0) {
          const rows = (products ?? []).map((product) => ({ ...product, subcategory_id: newSubcategory.id }));
          const { error: insertProductsError } = await supabase.from("products").insert(rows);
          if (insertProductsError) throw insertProductsError;
          totalProducts += rows.length;
        }
      }
    }

    stats.categorias = (categories ?? []).length;
    stats.subcategorias = totalSubs;
    stats.productos = totalProducts;
  }

  return stats;
}

const CloneBranchCatalog = () => {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cleanFirst, setCleanFirst] = useState(false);
  const [selected, setSelected] = useState<Set<CatalogKey>>(new Set(CATALOG_ITEMS.map((item) => item.key)));
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [cloneMode, setCloneMode] = useState<CloneMode>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ["clone-branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name, branch_code").eq("is_active", true).order("name");
      return (data ?? []) as Branch[];
    },
  });

  const toggle = (key: CatalogKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleClone = async () => {
    if (!sourceId || !targetId || selected.size === 0) return;
    if (sourceId === targetId) {
      toast.error("Las sucursales deben ser diferentes");
      return;
    }

    const targetName = branches.find((branch) => branch.id === targetId)?.name;
    const sourceName = branches.find((branch) => branch.id === sourceId)?.name;
    const labels = CATALOG_ITEMS.filter((item) => selected.has(item.key)).map((item) => item.label).join(", ");
    const cleanWarning = cleanFirst
      ? `\n\nATENCION: Se eliminaran primero los datos seleccionados de "${targetName}" antes de copiar.`
      : "";

    const confirmed = window.confirm(`Copiar ${labels} de "${sourceName}" a "${targetName}"?${cleanWarning}`);
    if (!confirmed) return;

    setCloning(true);
    setResult(null);
    setCloneMode(null);

    try {
      const res = await supabase.functions.invoke("clone-branch-catalog", {
        body: {
          source_branch_id: sourceId,
          target_branch_id: targetId,
          items: Array.from(selected),
          clean_first: cleanFirst,
        },
      });

      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(res.data.error);

      setResult(res.data.stats ?? {});
      setCloneMode("edge_function");
      toast.success("Catalogo duplicado correctamente");
    } catch (edgeError: any) {
      try {
        const stats = await cloneCatalogDirectly(sourceId, targetId, selected, cleanFirst);
        setResult(stats);
        setCloneMode("direct_fallback");
        toast.success("Catalogo duplicado correctamente");
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
          Duplicar catalogo entre sucursales
        </CardTitle>
        <CardDescription>Selecciona que elementos copiar de una sucursal a otra.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Si no activas la limpieza previa, los registros se <strong>agregaran</strong> a la sucursal destino y podrian duplicarse.
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

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Elementos a duplicar</label>
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            {CATALOG_ITEMS.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={selected.has(item.key)} onCheckedChange={() => toggle(item.key)} />
                {item.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Limpiar destino antes de copiar</p>
              <p className="text-xs text-muted-foreground">Elimina los items seleccionados en la sucursal destino primero</p>
            </div>
          </div>
          <Switch checked={cleanFirst} onCheckedChange={setCleanFirst} />
        </div>

        <Button
          onClick={handleClone}
          disabled={!sourceId || !targetId || selected.size === 0 || cloning}
          className="w-full"
          variant={cleanFirst ? "destructive" : "default"}
        >
          {cloning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Duplicando...
            </>
          ) : cleanFirst ? "Limpiar y duplicar catalogo" : "Duplicar catalogo"}
        </Button>

        {result && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground">Registros copiados:</p>
              {cloneMode && (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  {cloneMode === "edge_function" ? "Modo: Edge Function" : "Modo: Fallback directo"}
                </span>
              )}
            </div>
            {Object.entries(result).map(([key, value]) => (
              <p key={key} className="text-muted-foreground">- {key}: <span className="font-mono text-foreground">{value}</span></p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CloneBranchCatalog;
