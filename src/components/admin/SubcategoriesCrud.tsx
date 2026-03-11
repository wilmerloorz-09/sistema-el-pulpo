import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/BranchContext";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Subcategory {
  id: string;
  description: string;
  category_id: string;
  display_order: number;
  is_active: boolean;
}

interface Category {
  id: string;
  description: string;
  display_order: number;
}

const SubcategoriesCrud = () => {
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-categories-list", activeBranchId],
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

  const catIds = categories.map((c) => c.id);

  const crud = useCrud<Subcategory>({
    table: "subcategories",
    queryKey: "admin-subcategories",
    orderBy: { column: "display_order" },
    branchScoped: false,
    filters: catIds.length > 0 ? [{ column: "category_id", op: "in", value: catIds }] : undefined,
  });

  const edit = useEditState<Subcategory>({
    description: "",
    category_id: "",
    display_order: 1,
    is_active: true,
  } as any);

  const getNextDisplayOrder = (categoryId: string) => {
    const scoped = crud.data.filter((item) => item.category_id === categoryId);
    if (scoped.length === 0) return 1;
    return Math.max(...scoped.map((item) => Number(item.display_order) || 0)) + 1;
  };

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("subcategories")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subcategories"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subcategories-list"] });
      queryClient.invalidateQueries({ queryKey: ["menu-subcategories"] });
      toast.success("Subcategoria desactivada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo desactivar la subcategoria"),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: Subcategory; target: Subcategory }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("subcategories").update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("subcategories").update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("subcategories").update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subcategories"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subcategories-list"] });
      queryClient.invalidateQueries({ queryKey: ["menu-subcategories"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la subcategoria"),
  });

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.description]));
  const categoryOrderMap = Object.fromEntries(categories.map((category) => [category.id, category.display_order]));

  const sortedData = useMemo(() => {
    return [...crud.data].sort((a, b) => {
      const categoryOrderA = categoryOrderMap[a.category_id] ?? 999999;
      const categoryOrderB = categoryOrderMap[b.category_id] ?? 999999;
      if (categoryOrderA !== categoryOrderB) return categoryOrderA - categoryOrderB;
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.description.localeCompare(b.description);
    });
  }, [crud.data, categoryOrderMap]);

  const columns: ColumnDef<Subcategory>[] = [
    { key: "description", header: "Nombre", width: "1fr", type: "text" },
    {
      key: "category_id",
      header: "Categoria",
      width: "10rem",
      render: (item) => <span>{catMap[item.category_id] ?? "-"}</span>,
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
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.description}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
    { key: "display_order", header: "Orden", width: "5rem", render: (item) => <span>{item.display_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
  ];

  const handleSave = () => {
    const description = String(edit.editValues.description ?? "").trim();
    const categoryId = String(edit.editValues.category_id ?? "");
    const displayOrder = Math.trunc(Number(edit.editValues.display_order ?? 0));

    if (!description) {
      toast.error("El nombre de la subcategoria es obligatorio");
      return;
    }

    if (!categoryId) {
      toast.error("La categoria es obligatoria");
      return;
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 1) {
      toast.error("El numero de orden debe ser mayor a 0");
      return;
    }

    const duplicate = crud.data.find(
      (item) => item.id !== edit.editingId && item.category_id === categoryId && Number(item.display_order) === displayOrder,
    );

    if (duplicate) {
      toast.error(`Ya existe una subcategoria con el orden ${displayOrder} en esa categoria`);
      return;
    }

    crud.save({
      ...edit.editValues,
      description,
      category_id: categoryId,
      display_order: displayOrder,
    } as any);
  };

  const renderRowActions = (item: Subcategory) => {
    const scoped = sortedData.filter((row) => row.category_id === item.category_id);
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
    <AdminTable<Subcategory>
      columns={columns}
      data={sortedData}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={(id) => deactivateMutation.mutate(id)}
      onAdd={() => {
        const categoryId = categories[0]?.id ?? "";
        edit.startAdd({ category_id: categoryId, display_order: categoryId ? getNextDisplayOrder(categoryId) : 1, is_active: true });
      }}
      onFieldChange={edit.setField}
      saving={crud.saving || deactivateMutation.isPending}
      addLabel="Agregar subcategoria"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
      groupBy={(item) => item.category_id}
      renderGroupHeader={(groupKey, items) => (
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground">{catMap[groupKey] ?? "Sin categoria"}</span>
          <span className="text-[11px] normal-case text-muted-foreground">{items.length} subcategoria(s)</span>
        </div>
      )}
    />
  );
};

export default SubcategoriesCrud;
