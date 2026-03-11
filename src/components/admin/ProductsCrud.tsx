import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/BranchContext";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Product {
  id: string;
  description: string;
  subcategory_id: string;
  display_order: number;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  is_active: boolean;
}

interface Category {
  id: string;
  description: string;
  display_order: number;
}

interface Sub {
  id: string;
  description: string;
  category_id: string;
  display_order: number;
}

const ProductsCrud = () => {
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-product-categories-list", activeBranchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("categories")
        .select("id, description, display_order")
        .eq("branch_id", activeBranchId!)
        .order("display_order");
      return (data ?? []) as Category[];
    },
    enabled: !!activeBranchId,
  });

  const categoryIds = categories.map((category) => category.id);

  const { data: subs = [] } = useQuery({
    queryKey: ["admin-subcategories-list", activeBranchId, categoryIds],
    queryFn: async () => {
      if (categoryIds.length === 0) return [];
      const { data } = await supabase
        .from("subcategories")
        .select("id, description, category_id, display_order")
        .in("category_id", categoryIds);
      return ((data ?? []) as Sub[]).sort((a, b) => {
        const categoryOrderA = categories.find((category) => category.id === a.category_id)?.display_order ?? 999999;
        const categoryOrderB = categories.find((category) => category.id === b.category_id)?.display_order ?? 999999;
        if (categoryOrderA !== categoryOrderB) return categoryOrderA - categoryOrderB;
        if (a.display_order !== b.display_order) return a.display_order - b.display_order;
        return a.description.localeCompare(b.description);
      });
    },
    enabled: !!activeBranchId && categoryIds.length > 0,
  });

  const subIds = subs.map((s) => s.id);

  const crud = useCrud<Product>({
    table: "products",
    queryKey: "admin-products",
    orderBy: { column: "display_order" },
    branchScoped: false,
    filters: subIds.length > 0 ? [{ column: "subcategory_id", op: "in", value: subIds }] : undefined,
  });

  const edit = useEditState<Product>({
    description: "",
    subcategory_id: "",
    display_order: 1,
    unit_price: 0,
    price_mode: "FIXED",
    is_active: true,
  } as any);

  const getNextDisplayOrder = (subcategoryId: string) => {
    const scoped = crud.data.filter((item) => item.subcategory_id === subcategoryId);
    if (scoped.length === 0) return 1;
    return Math.max(...scoped.map((item) => Number(item.display_order) || 0)) + 1;
  };

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: Product; target: Product }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("products").update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("products").update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("products").update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["menu-products"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover el producto"),
  });

  const subMap = Object.fromEntries(subs.map((s) => [s.id, s.description]));
  const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category.description]));
  const categoryOrderMap = Object.fromEntries(categories.map((category) => [category.id, category.display_order]));
  const subOrderMap = Object.fromEntries(subs.map((sub) => [sub.id, sub.display_order]));
  const subCategoryMap = Object.fromEntries(subs.map((sub) => [sub.id, sub.category_id]));

  const sortedData = useMemo(() => {
    return [...crud.data].sort((a, b) => {
      const categoryOrderA = categoryOrderMap[subCategoryMap[a.subcategory_id] ?? ""] ?? 999999;
      const categoryOrderB = categoryOrderMap[subCategoryMap[b.subcategory_id] ?? ""] ?? 999999;
      if (categoryOrderA !== categoryOrderB) return categoryOrderA - categoryOrderB;

      const subOrderA = subOrderMap[a.subcategory_id] ?? 999999;
      const subOrderB = subOrderMap[b.subcategory_id] ?? 999999;
      if (subOrderA !== subOrderB) return subOrderA - subOrderB;

      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.description.localeCompare(b.description);
    });
  }, [crud.data, categoryOrderMap, subCategoryMap, subOrderMap]);

  const columns: ColumnDef<Product>[] = [
    { key: "description", header: "Producto", width: "1fr", type: "text" },
    {
      key: "subcategory_id",
      header: "Subcategoria",
      width: "10rem",
      render: (item) => <span className="text-xs">{subMap[item.subcategory_id] ?? "-"}</span>,
      editRender: (value, onChange) => (
        <Select
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue);
            edit.setField("display_order", getNextDisplayOrder(nextValue));
          }}
        >
          <SelectTrigger className="h-8 rounded-lg text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {subs.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.description}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    { key: "unit_price", header: "Precio", width: "6rem", type: "number", render: (item) => <span>${item.unit_price ?? 0}</span> },
    {
      key: "price_mode",
      header: "Modo",
      width: "6rem",
      render: (item) => <Badge variant={item.price_mode === "FIXED" ? "default" : "secondary"} className="text-[10px]">{item.price_mode}</Badge>,
      editRender: (value, onChange) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 rounded-lg text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="FIXED">FIXED</SelectItem>
            <SelectItem value="MANUAL">MANUAL</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
    { key: "display_order", header: "Orden", width: "5rem", render: (item) => <span>{item.display_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
  ];

  const handleSave = () => {
    const description = String(edit.editValues.description ?? "").trim();
    const subcategoryId = String(edit.editValues.subcategory_id ?? "");
    const displayOrder = Math.trunc(Number(edit.editValues.display_order ?? 0));
    const unitPrice = Number(edit.editValues.unit_price ?? 0);

    if (!description) {
      toast.error("El nombre del producto es obligatorio");
      return;
    }

    if (!subcategoryId) {
      toast.error("La subcategoria es obligatoria");
      return;
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 1) {
      toast.error("El numero de orden debe ser mayor a 0");
      return;
    }

    const duplicate = crud.data.find(
      (item) => item.id !== edit.editingId && item.subcategory_id === subcategoryId && Number(item.display_order) === displayOrder,
    );

    if (duplicate) {
      toast.error(`Ya existe un producto con el orden ${displayOrder} en esa subcategoria`);
      return;
    }

    crud.save({
      ...edit.editValues,
      description,
      subcategory_id: subcategoryId,
      display_order: displayOrder,
      unit_price: unitPrice,
    } as any);
  };

  const renderRowActions = (item: Product) => {
    const scoped = sortedData.filter((row) => row.subcategory_id === item.subcategory_id);
    const index = scoped.findIndex((row) => row.id === item.id);
    const prev = index > 0 ? scoped[index - 1] : null;
    const next = index >= 0 && index < scoped.length - 1 ? scoped[index + 1] : null;

    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!prev || moveMutation.isPending}
          onClick={() => prev && moveMutation.mutate({ current: item, target: prev })}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!next || moveMutation.isPending}
          onClick={() => next && moveMutation.mutate({ current: item, target: next })}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  };

  return (
    <AdminTable<Product>
      columns={columns}
      data={sortedData}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={crud.remove}
      onAdd={() => {
        const subcategoryId = subs[0]?.id ?? "";
        edit.startAdd({ subcategory_id: subcategoryId, display_order: subcategoryId ? getNextDisplayOrder(subcategoryId) : 1, unit_price: 0, price_mode: "FIXED", is_active: true });
      }}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar producto"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
      groupBy={(item) => item.subcategory_id}
      renderGroupHeader={(groupKey, items) => {
        const categoryId = subCategoryMap[groupKey] ?? "";
        const categoryLabel = categoryMap[categoryId];
        const subcategoryLabel = subMap[groupKey] ?? "Sin subcategoria";

        return (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-foreground">{subcategoryLabel}</span>
              {categoryLabel ? <span className="text-[11px] normal-case text-muted-foreground">{categoryLabel}</span> : null}
            </div>
            <span className="text-[11px] normal-case text-muted-foreground">{items.length} producto(s)</span>
          </div>
        );
      }}
    />
  );
};

export default ProductsCrud;
