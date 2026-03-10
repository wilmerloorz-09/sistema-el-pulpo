import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

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
}

const SubcategoriesCrud = () => {
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-categories-list", activeBranchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("categories")
        .select("id, description")
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
    display_order: 0,
    is_active: true,
  } as any);

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
      toast.success("Subcategoria desactivada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo desactivar la subcategoria"),
  });

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.description]));

  const columns: ColumnDef<Subcategory>[] = [
    { key: "description", header: "Nombre", width: "1fr", type: "text" },
    {
      key: "category_id",
      header: "Categoria",
      width: "10rem",
      render: (item) => <span>{catMap[item.category_id] ?? "-"}</span>,
      editRender: (value, onChange) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 rounded-lg text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.description}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    { key: "display_order", header: "Orden", width: "5rem", type: "number" },
    { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
  ];

  return (
    <AdminTable<Subcategory>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={() => crud.save(edit.editValues as any)}
      onDelete={(id) => deactivateMutation.mutate(id)}
      onAdd={() => edit.startAdd({ category_id: categories[0]?.id ?? "" })}
      onFieldChange={edit.setField}
      saving={crud.saving || deactivateMutation.isPending}
      addLabel="Agregar subcategoria"
    />
  );
};

export default SubcategoriesCrud;
