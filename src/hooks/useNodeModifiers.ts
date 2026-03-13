import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";

interface MenuNodeRow {
  id: string;
  parent_id: string | null;
  name: string;
}

interface ModifierRow {
  id: string;
  description: string;
  is_active: boolean;
}

interface MenuNodeModifierRow {
  id: string;
  node_id: string;
  modifier_id: string;
  is_active: boolean;
  display_order: number | null;
}

export interface InheritedNodeModifier {
  modifier_id: string;
  name: string;
  description: string;
  from_node_id: string;
  from_node_name: string;
}

export interface OwnNodeModifier {
  modifier_id: string;
  name: string;
  description: string;
  menu_node_modifier_id: string;
}

export interface AvailableNodeModifier {
  modifier_id: string;
  name: string;
}

const emptyState = {
  inheritedModifiers: [] as InheritedNodeModifier[],
  ownModifiers: [] as OwnNodeModifier[],
  allModifiers: [] as AvailableNodeModifier[],
};

const normalizeNodeModifierError = (error: unknown) => {
  if (!(error instanceof Error)) return "No se pudieron cargar los modificadores del nodo.";

  const message = error.message.toLowerCase();
  if (message.includes("menu_node_modifiers")) {
    return "No se pudo leer la tabla menu_node_modifiers. Falta aplicar la migracion nueva de modificadores por nodo.";
  }

  return error.message;
};

export function useNodeModifiers(nodeId: string) {
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();
  const [actionPending, setActionPending] = useState(false);

  const query = useQuery({
    queryKey: ["node-modifiers", activeBranchId, nodeId],
    queryFn: async () => {
      if (!activeBranchId || !nodeId) return emptyState;

      const [{ data: nodes, error: nodesError }, { data: modifiers, error: modifiersError }] = await Promise.all([
        supabase
          .from("menu_nodes" as never)
          .select("id, parent_id, name")
          .eq("branch_id", activeBranchId),
        supabase
          .from("modifiers")
          .select("id, description, is_active")
          .eq("branch_id", activeBranchId)
          .eq("is_active", true)
          .order("description", { ascending: true }),
      ]);

      if (nodesError) throw nodesError;
      if (modifiersError) throw modifiersError;

      const nodeRows = (nodes ?? []) as unknown as MenuNodeRow[];
      const modifierRows = (modifiers ?? []) as ModifierRow[];
      const nodesById = new Map(nodeRows.map((row) => [row.id, row]));
      const modifiersById = new Map(modifierRows.map((row) => [row.id, row]));

      const currentNode = nodesById.get(nodeId) ?? null;
      if (!currentNode) return emptyState;

      const ancestorChain: MenuNodeRow[] = [];
      let currentParentId = currentNode.parent_id;
      while (currentParentId) {
        const parent = nodesById.get(currentParentId) ?? null;
        if (!parent) break;
        ancestorChain.push(parent);
        currentParentId = parent.parent_id;
      }

      const relevantNodeIds = [nodeId, ...ancestorChain.map((node) => node.id)];
      const { data: links, error: linksError } = await supabase
        .from("menu_node_modifiers" as never)
        .select("id, node_id, modifier_id, is_active, display_order")
        .eq("is_active", true)
        .in("node_id", relevantNodeIds)
        .order("display_order", { ascending: true });

      if (linksError) throw linksError;

      const linkRows = (links ?? []) as unknown as MenuNodeModifierRow[];

      const ownModifiers = linkRows
        .filter((row) => row.node_id === nodeId && modifiersById.has(row.modifier_id))
        .map((row) => {
          const modifier = modifiersById.get(row.modifier_id)!;
          return {
            modifier_id: row.modifier_id,
            name: modifier.description,
            description: modifier.description,
            menu_node_modifier_id: row.id,
          } satisfies OwnNodeModifier;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const inheritedModifiers: InheritedNodeModifier[] = [];
      const seenModifierIds = new Set<string>();
      for (const ancestor of ancestorChain) {
        const ancestorLinks = linkRows.filter(
          (row) => row.node_id === ancestor.id && modifiersById.has(row.modifier_id),
        );

        for (const row of ancestorLinks) {
          if (seenModifierIds.has(row.modifier_id)) continue;
          const modifier = modifiersById.get(row.modifier_id)!;
          inheritedModifiers.push({
            modifier_id: row.modifier_id,
            name: modifier.description,
            description: modifier.description,
            from_node_id: ancestor.id,
            from_node_name: ancestor.name,
          });
          seenModifierIds.add(row.modifier_id);
        }
      }

      const allModifiers = modifierRows
        .map((row) => ({
          modifier_id: row.id,
          name: row.description,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        inheritedModifiers,
        ownModifiers,
        allModifiers,
      };
    },
    enabled: !!activeBranchId && !!nodeId,
  });

  const invalidateRelatedQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["node-modifiers", activeBranchId, nodeId] }),
      queryClient.invalidateQueries({ queryKey: ["admin-modifiers", activeBranchId] }),
      queryClient.invalidateQueries({ queryKey: ["menu-modifiers", activeBranchId] }),
    ]);
  };

  const addModifier = async (modifierId: string) => {
    if (!nodeId) throw new Error("El nodo todavia no existe.");
    if (!modifierId) throw new Error("Selecciona un modificador.");

    setActionPending(true);
    try {
      const { data, error } = await supabase
        .from("menu_node_modifiers" as never)
        .select("id, modifier_id, is_active, display_order")
        .eq("node_id", nodeId);

      if (error) throw error;

      const assignments = (data ?? []) as unknown as MenuNodeModifierRow[];
      const existingAssignment = assignments.find((row) => row.modifier_id === modifierId) ?? null;

      if (existingAssignment?.is_active) {
        await invalidateRelatedQueries();
        return;
      }

      const usedOrders = assignments
        .filter((row) => row.id !== existingAssignment?.id && row.is_active)
        .map((row) => Number(row.display_order) || 0);
      const nextDisplayOrder = usedOrders.length > 0 ? Math.max(...usedOrders) + 1 : 0;

      const { error: upsertError } = await supabase
        .from("menu_node_modifiers" as never)
        .upsert({
          id: existingAssignment?.id,
          node_id: nodeId,
          modifier_id: modifierId,
          is_active: true,
          display_order: Number(existingAssignment?.display_order ?? nextDisplayOrder),
        } as never, { onConflict: "node_id,modifier_id" });

      if (upsertError) throw upsertError;

      await invalidateRelatedQueries();
    } finally {
      setActionPending(false);
    }
  };

  const removeModifier = async (menuNodeModifierId: string) => {
    if (!menuNodeModifierId) throw new Error("No se pudo resolver la asignacion a quitar.");

    setActionPending(true);
    try {
      const { error } = await supabase
        .from("menu_node_modifiers" as never)
        .update({ is_active: false } as never)
        .eq("id", menuNodeModifierId);

      if (error) throw error;

      await invalidateRelatedQueries();
    } finally {
      setActionPending(false);
    }
  };

  const data = query.data ?? emptyState;

  return useMemo(
    () => ({
      inheritedModifiers: data.inheritedModifiers,
      ownModifiers: data.ownModifiers,
      allModifiers: data.allModifiers,
      addModifier,
      removeModifier,
      loading: query.isLoading || query.isFetching || actionPending,
      error: query.error ? normalizeNodeModifierError(query.error) : null,
    }),
    [actionPending, data.allModifiers, data.inheritedModifiers, data.ownModifiers, query.error, query.isFetching, query.isLoading],
  );
}
