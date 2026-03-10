import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, type ColumnDef } from "./AdminTable";
import SubcategoryModifiersCrud from "./SubcategoryModifiersCrud";
import { toast } from "sonner";

interface CategoryRow {
  id: string;
  description: string;
  is_active: boolean;
}

interface SubcategoryRow {
  id: string;
  description: string;
  category_id: string;
  is_active: boolean;
}

interface ModifierRow {
  id: string;
  description: string;
  is_active: boolean;
  category_id: string | null;
  subcategory_id: string | null;
}

const ModifiersCrud = () => {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const edit = useEditState<ModifierRow>({ description: "", is_active: true, category_id: null, subcategory_id: null } as any);

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-modifiers-categories", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("categories")
        .select("id, description, is_active")
        .eq("branch_id", activeBranchId)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
    enabled: !!activeBranchId,
  });

  const { data: subcategories = [], isLoading: isLoadingSubcategories } = useQuery({
    queryKey: ["admin-modifiers-subcategories", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("subcategories")
        .select("id, description, category_id, is_active, categories!inner(branch_id)")
        .eq("categories.branch_id", activeBranchId)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        description: row.description,
        category_id: row.category_id,
        is_active: Boolean(row.is_active),
      })) as SubcategoryRow[];
    },
    enabled: !!activeBranchId,
  });

  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.description])), [categories]);
  const subcategoryMap = useMemo(() => Object.fromEntries(subcategories.map((s) => [s.id, s.description])), [subcategories]);

  const { data: modifiers = [], isLoading } = useQuery({
    queryKey: ["admin-modifiers", activeBranchId, subcategories.length],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const { data: mods, error: modsError } = await supabase
        .from("modifiers")
        .select("id, description, is_active")
        .eq("branch_id", activeBranchId)
        .order("description", { ascending: true });
      if (modsError) throw modsError;

      const modifierIds = (mods ?? []).map((m) => m.id);
      if (modifierIds.length === 0) return [] as ModifierRow[];

      const { data: links, error: linksError } = await supabase
        .from("subcategory_modifiers" as never)
        .select("modifier_id, subcategory_id, display_order")
        .in("modifier_id", modifierIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (linksError) throw linksError;

      const primaryLinkByModifier = new Map<string, { subcategory_id: string }>();
      for (const link of (links ?? []) as any[]) {
        if (!primaryLinkByModifier.has(link.modifier_id)) {
          primaryLinkByModifier.set(link.modifier_id, { subcategory_id: link.subcategory_id });
        }
      }

      return (mods ?? []).map((mod) => {
        const subcategoryId = primaryLinkByModifier.get(mod.id)?.subcategory_id ?? null;
        const categoryId = subcategoryId
          ? (subcategories.find((sub) => sub.id === subcategoryId)?.category_id ?? null)
          : null;

        return {
          id: mod.id,
          description: mod.description,
          is_active: mod.is_active,
          category_id: categoryId,
          subcategory_id: subcategoryId,
        } as ModifierRow;
      });
    },
    enabled: !!activeBranchId && !isLoadingSubcategories,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");

      const description = String(values.description ?? "").trim();
      const categoryId = values.category_id ? String(values.category_id) : "";
      const subcategoryId = values.subcategory_id ? String(values.subcategory_id) : "";

      if (!description) throw new Error("El nombre del modificador es obligatorio");
      if (!categoryId) throw new Error("La categoria es obligatoria");
      if (!subcategoryId) throw new Error("La subcategoria es obligatoria");

      const selectedSubcategory = subcategories.find((sub) => sub.id === subcategoryId);
      if (!selectedSubcategory) throw new Error("Subcategoria invalida");
      if (selectedSubcategory.category_id !== categoryId) throw new Error("La subcategoria no pertenece a la categoria seleccionada");
      const subcategoriesForCategory = subcategories.filter((sub) => sub.category_id === categoryId && sub.is_active);
      if (subcategoriesForCategory.length === 0) {
        throw new Error("La categoria seleccionada no tiene subcategorias activas");
      }

      const modifierPayload = {
        id: values.id,
        description,
        is_active: Boolean(values.is_active),
        branch_id: activeBranchId,
      };

      const { error: modifierError } = await supabase.from("modifiers").upsert(modifierPayload as never);
      if (modifierError) throw modifierError;

      const { data: existingLink } = await supabase
        .from("subcategory_modifiers" as never)
        .select("display_order")
        .eq("modifier_id", values.id)
        .eq("subcategory_id", subcategoryId)
        .maybeSingle();

      const { error: linkError } = await supabase.from("subcategory_modifiers" as never).upsert(
        {
          subcategory_id: subcategoryId,
          modifier_id: values.id,
          is_active: true,
          display_order: Number((existingLink as any)?.display_order ?? 0),
        } as never,
        { onConflict: "subcategory_id,modifier_id" },
      );

      if (linkError) throw linkError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modifiers", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["admin-subcategory-modifiers-assignments"] });
      edit.cancelEdit();
      toast.success("Modificador guardado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo guardar"),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modifiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modifiers", activeBranchId] });
      toast.success("Modificador eliminado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo eliminar"),
  });

  const columns: ColumnDef<ModifierRow>[] = useMemo(
    () => [
      { key: "description", header: "Nombre", width: "1fr", type: "text" },
      {
        key: "category_id",
        header: "Categoria",
        width: "0.9fr",
        render: (item) => categoryMap[item.category_id ?? ""] ?? "-",
        editRender: () => (
          <select
            value={edit.editValues.category_id ?? ""}
            onChange={(e) => {
              edit.setField("category_id", e.target.value || null);
              edit.setField("subcategory_id", null);
            }}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
          >
            <option value="">Selecciona...</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.description}{category.is_active ? "" : " (Inactiva)"}
              </option>
            ))}
          </select>
        ),
      },
      {
        key: "subcategory_id",
        header: "Subcategoria",
        width: "0.9fr",
        render: (item) => subcategoryMap[item.subcategory_id ?? ""] ?? "-",
        editRender: () => {
          const selectedCategory = edit.editValues.category_id;
          const filteredSubcategories = selectedCategory
            ? subcategories.filter((subcategory) => subcategory.category_id === selectedCategory)
            : [];

          return (
            <select
              value={edit.editValues.subcategory_id ?? ""}
              onChange={(e) => edit.setField("subcategory_id", e.target.value || null)}
              disabled={!selectedCategory || filteredSubcategories.length === 0}
              className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs disabled:opacity-60"
            >
              <option value="">{selectedCategory && filteredSubcategories.length === 0 ? "Sin subcategorias" : "Selecciona..."}</option>
              {filteredSubcategories.map((subcategory) => (
                <option key={subcategory.id} value={subcategory.id}>
                  {subcategory.description}{subcategory.is_active ? "" : " (Inactiva)"}
                </option>
              ))}
            </select>
          );
        },
      },
      { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
    ],
    [categories, subcategories, categoryMap, subcategoryMap, edit.editValues, edit.setField],
  );

  return (
    <div className="space-y-4">
      <AdminTable<ModifierRow>
        columns={columns}
        data={modifiers}
        isLoading={isLoading}
        editingId={edit.editingId}
        editValues={edit.editValues}
        onEdit={edit.startEdit}
        onCancelEdit={edit.cancelEdit}
        onSave={() => saveMutation.mutate(edit.editValues)}
        onDelete={(id) => removeMutation.mutate(id)}
        onAdd={() => edit.startAdd({ is_active: true, category_id: null, subcategory_id: null })}
        onFieldChange={edit.setField}
        saving={saveMutation.isPending}
        addLabel="Agregar modificador"
      />

      <div className="rounded-xl border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Asociacion por subcategoria</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Puedes agregar asociaciones adicionales, activar/desactivar y ajustar el orden visual.
        </p>
        <SubcategoryModifiersCrud />
      </div>
    </div>
  );
};

export default ModifiersCrud;
