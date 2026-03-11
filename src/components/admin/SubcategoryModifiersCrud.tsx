import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface CategoryRow {
  id: string;
  description: string;
}

interface SubcategoryRow {
  id: string;
  description: string;
  category_id: string;
}

interface ModifierRow {
  id: string;
  description: string;
}

interface AssignmentRow {
  id: string;
  subcategory_id: string;
  modifier_id: string;
  is_active: boolean;
  display_order: number;
  modifiers?: { description: string } | null;
}

const SubcategoryModifiersCrud = () => {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [selectedModifier, setSelectedModifier] = useState<string>("");

  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["admin-subcategory-modifiers-categories", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("categories")
        .select("id, description")
        .eq("branch_id", activeBranchId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
    enabled: !!activeBranchId,
  });

  const { data: subcategories = [], isLoading: loadingSubcategories } = useQuery({
    queryKey: ["admin-subcategory-modifiers-subcategories", selectedCategory],
    queryFn: async () => {
      if (!selectedCategory) return [];
      const { data, error } = await supabase
        .from("subcategories")
        .select("id, description, category_id")
        .eq("category_id", selectedCategory)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubcategoryRow[];
    },
    enabled: !!selectedCategory,
  });

  const { data: modifiers = [], isLoading: loadingModifiers } = useQuery({
    queryKey: ["admin-subcategory-modifiers-modifiers", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("modifiers")
        .select("id, description")
        .eq("branch_id", activeBranchId)
        .order("description", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ModifierRow[];
    },
    enabled: !!activeBranchId,
  });

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ["admin-subcategory-modifiers-assignments", selectedSubcategory],
    queryFn: async () => {
      if (!selectedSubcategory) return [];
      const { data, error } = await supabase
        .from("subcategory_modifiers" as never)
        .select("id, subcategory_id, modifier_id, is_active, display_order, modifiers(description)")
        .eq("subcategory_id", selectedSubcategory)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AssignmentRow[];
    },
    enabled: !!selectedSubcategory,
  });

  const availableModifiers = useMemo(() => {
    const used = new Set(assignments.map((a) => a.modifier_id));
    return modifiers.filter((m) => !used.has(m.id));
  }, [modifiers, assignments]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-subcategory-modifiers-assignments", selectedSubcategory] });
    qc.invalidateQueries({ queryKey: ["menu-modifiers"] });
  };

  const addAssignment = useMutation({
    mutationFn: async () => {
      if (!selectedSubcategory) throw new Error("Selecciona una subcategoria");
      if (!selectedModifier) throw new Error("Selecciona un modificador");
      const nextOrder = assignments.length > 0 ? Math.max(...assignments.map((a) => Number(a.display_order ?? 0))) + 1 : 1;
      const { error } = await supabase.from("subcategory_modifiers" as never).insert({
        subcategory_id: selectedSubcategory,
        modifier_id: selectedModifier,
        is_active: true,
        display_order: nextOrder,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedModifier("");
      refresh();
      toast.success("Modificacion asociada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo asociar"),
  });

  const updateAssignment = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AssignmentRow> }) => {
      const { error } = await supabase.from("subcategory_modifiers" as never).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Asociacion actualizada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo actualizar"),
  });

  const moveAssignment = useMutation({
    mutationFn: async ({ current, target }: { current: AssignmentRow; target: AssignmentRow }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("subcategory_modifiers" as never).update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("subcategory_modifiers" as never).update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("subcategory_modifiers" as never).update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la asociacion"),
  });

  const removeAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("subcategory_modifiers" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Asociacion eliminada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo eliminar"),
  });

  if (loadingCategories || loadingModifiers) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoria</label>
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedSubcategory("");
              setSelectedModifier("");
            }}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">Selecciona categoria...</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.description}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Subcategoria</label>
          <select
            value={selectedSubcategory}
            onChange={(e) => {
              setSelectedSubcategory(e.target.value);
              setSelectedModifier("");
            }}
            disabled={!selectedCategory || loadingSubcategories}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-60"
          >
            <option value="">Selecciona subcategoria...</option>
            {subcategories.map((subcategory) => (
              <option key={subcategory.id} value={subcategory.id}>{subcategory.description}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedSubcategory && (
        <>
          <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-lg border border-border p-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Agregar modificacion</label>
              <select
                value={selectedModifier}
                onChange={(e) => setSelectedModifier(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">Selecciona...</option>
                {availableModifiers.map((modifier) => (
                  <option key={modifier.id} value={modifier.id}>{modifier.description}</option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              className="gap-1"
              onClick={() => addAssignment.mutate()}
              disabled={!selectedModifier || addAssignment.isPending}
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </Button>
          </div>

          {loadingAssignments ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {assignments.map((assignment) => {
                const index = assignments.findIndex((item) => item.id === assignment.id);
                const prev = index > 0 ? assignments[index - 1] : null;
                const next = index >= 0 && index < assignments.length - 1 ? assignments[index + 1] : null;

                return (
                  <div key={assignment.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                    <div className="min-w-[220px] flex-1 text-sm">{assignment.modifiers?.description ?? "Modificador"}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Activo</span>
                      <Switch
                        checked={assignment.is_active}
                        onCheckedChange={(checked) => updateAssignment.mutate({ id: assignment.id, patch: { is_active: checked } })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Orden</span>
                      <span className="min-w-[2rem] text-sm text-foreground">{assignment.display_order}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={!prev || moveAssignment.isPending}
                      onClick={() => prev && moveAssignment.mutate({ current: assignment, target: prev })}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={!next || moveAssignment.isPending}
                      onClick={() => next && moveAssignment.mutate({ current: assignment, target: next })}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeAssignment.mutate(assignment.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SubcategoryModifiersCrud;
