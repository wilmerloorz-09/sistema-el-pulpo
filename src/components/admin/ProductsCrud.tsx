import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useBranch } from "@/contexts/BranchContext";

interface Product {
  id: string;
  description: string;
  subcategory_id: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  is_active: boolean;
}

interface Sub { id: string; description: string; }

const ProductsCrud = () => {
  const { activeBranchId } = useBranch();

  // Get categories for this branch, then subcategories for those categories
  const { data: branchCats = [] } = useQuery({
    queryKey: ["admin-categories-ids", activeBranchId],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id").eq("branch_id", activeBranchId!);
      return (data ?? []).map((c: any) => c.id as string);
    },
    enabled: !!activeBranchId,
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["admin-subcategories-list", activeBranchId, branchCats],
    queryFn: async () => {
      if (branchCats.length === 0) return [];
      const { data } = await supabase.from("subcategories").select("id, description").in("category_id", branchCats).order("display_order");
      return (data ?? []) as Sub[];
    },
    enabled: !!activeBranchId && branchCats.length > 0,
  });

  const subIds = subs.map((s) => s.id);

  const crud = useCrud<Product>({
    table: "products",
    queryKey: "admin-products",
    orderBy: { column: "description" },
    branchScoped: false,
    filters: subIds.length > 0 ? [{ column: "subcategory_id", op: "in", value: subIds }] : undefined,
  });
  const edit = useEditState<Product>({ description: "", subcategory_id: "", unit_price: 0, price_mode: "FIXED", is_active: true } as any);

  const subMap = Object.fromEntries(subs.map((s) => [s.id, s.description]));

  const columns: ColumnDef<Product>[] = [
    { key: "description", header: "Producto", width: "1fr", type: "text" },
    {
      key: "subcategory_id",
      header: "Subcategoría",
      width: "10rem",
      render: (item) => <span className="text-xs">{subMap[item.subcategory_id] ?? "—"}</span>,
      editRender: (value, onChange) => (
        <Select value={value} onValueChange={onChange}>
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
  ];

  return (
    <AdminTable<Product>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={() => crud.save(edit.editValues as any)}
      onDelete={crud.remove}
      onAdd={() => edit.startAdd({ subcategory_id: subs[0]?.id ?? "" })}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar producto"
    />
  );
};

export default ProductsCrud;
