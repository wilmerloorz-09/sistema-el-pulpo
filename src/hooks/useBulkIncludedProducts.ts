import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { dbSelect } from "@/services/DatabaseService";

interface CategoryRow {
  id: string;
  display_order: number | null;
}

interface SubcategoryRow {
  id: string;
  category_id: string;
}

interface LegacyProductRow {
  id: string;
  description: string;
  subcategory_id: string;
  display_order: number | null;
}

interface MenuNodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: "category" | "product";
  menu_scope: "TABLE" | "TAKEOUT" | "BULK";
  display_order: number;
  is_active: boolean;
  legacy_product_id?: string | null;
}

interface TableEligibleProductRow {
  node_id: string;
  legacy_product_id: string;
  name: string;
  display_order: number;
}

interface BulkIncludedProductRow {
  id: string;
  menu_node_id: string;
  included_node_id: string;
  is_active: boolean;
  display_order: number | null;
}

interface BulkIncludedProductRangeRow {
  id: string;
  bulk_included_product_id: string;
  amount_from: number | string;
  amount_to: number | string;
  included_quantity: number;
  display_order: number | null;
}

export interface IncludedProductRange {
  id: string;
  amount_from: number;
  amount_to: number;
  included_quantity: number;
  display_order: number;
}

export interface IncludedProductAssignment {
  id: string;
  included_node_id: string;
  included_node_name: string;
  ranges: IncludedProductRange[];
}

export interface AvailableIncludedProduct {
  node_id: string;
  name: string;
  display_order: number;
}

export interface EditableIncludedProductRange {
  id?: string;
  amount_from: string;
  amount_to: string;
  included_quantity: string;
}

const emptyState = {
  assignments: [] as IncludedProductAssignment[],
  availableProducts: [] as AvailableIncludedProduct[],
};

const BULK_INCLUDED_PRODUCTS_QUERY_KEY = "bulk-included-products-root-order-v4";

const normalizeError = (error: unknown) => {
  if (!(error instanceof Error)) return toErrorMessage(error, "No se pudo cargar la configuracion de productos incluidos.");

  const message = error.message.toLowerCase();
  if (message.includes("bulk_included_products")) {
    return "No se pudo leer la tabla bulk_included_products. Falta aplicar la migracion de productos incluidos.";
  }
  if (message.includes("bulk_included_product_ranges")) {
    return "No se pudo leer la tabla bulk_included_product_ranges. Falta aplicar la migracion de rangos de productos incluidos.";
  }
  if (message.includes("get_table_products_by_root_orders")) {
    return "No se pudo ejecutar la consulta de productos de Menu Mesa por orden raiz. Falta aplicar la migracion nueva.";
  }

  return error.message;
};

const parseMoneyValue = (value: string | number) => {
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return NaN;
  return Number(normalized);
};

const MAX_RANGE_AMOUNT = 9999999999.99;

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const parts = [
      typeof candidate.message === "string" ? candidate.message : fallback,
      typeof candidate.details === "string" && candidate.details.trim() ? candidate.details.trim() : null,
      typeof candidate.hint === "string" && candidate.hint.trim() ? `Sugerencia: ${candidate.hint.trim()}` : null,
      typeof candidate.code === "string" && candidate.code.trim() ? `Codigo: ${candidate.code.trim()}` : null,
    ].filter((part): part is string => Boolean(part));

    return parts.join(" | ");
  }

  return fallback;
};

const toError = (error: unknown, fallback: string) => new Error(toErrorMessage(error, fallback));

export function useBulkIncludedProducts(nodeId: string) {
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();
  const [actionPending, setActionPending] = useState(false);

  const query = useQuery({
    queryKey: [BULK_INCLUDED_PRODUCTS_QUERY_KEY, activeBranchId, nodeId],
    queryFn: async () => {
      if (!activeBranchId || !nodeId) return emptyState;

      const { data: nodes, error: nodesError } = await supabase
        .from("menu_nodes" as any)
        .select("id, parent_id, name, node_type, menu_scope, display_order, is_active, legacy_product_id")
        .eq("branch_id", activeBranchId)
        .order("depth", { ascending: true })
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (nodesError) throw nodesError;

      const nodeRows = (nodes ?? []) as unknown as MenuNodeRow[];
      const nodesById = new Map(nodeRows.map((row) => [row.id, row]));
      const currentNode = nodesById.get(nodeId) ?? null;
      if (!currentNode || currentNode.node_type !== "product" || currentNode.menu_scope !== "BULK") {
        return emptyState;
      }

      const tableNodeRows = nodeRows.filter((row) => row.menu_scope === "TABLE");
      const tableNodesById = new Map(tableNodeRows.map((row) => [row.id, row]));
      const lookupNodeRows = [...nodeRows];

      const getTableRootNode = (startNodeId: string) => {
        let current = tableNodesById.get(startNodeId) ?? null;
        while (current?.parent_id) {
          const parent = tableNodesById.get(current.parent_id) ?? null;
          if (!parent) break;
          current = parent;
        }
        return current;
      };

      const eligibleCategories = await dbSelect<CategoryRow>("categories", {
        select: "id, display_order",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "display_order" },
      });

      const eligibleRootCategoryIds = new Set(
        eligibleCategories
          .filter((row) => {
            const rootOrder = Number(row.display_order ?? 0);
            return rootOrder === 2 || rootOrder === 3;
          })
          .map((row) => row.id),
      );

      const eligibleSubcategories = eligibleRootCategoryIds.size > 0
        ? await dbSelect<SubcategoryRow>("subcategories", {
            select: "id, category_id",
            filters: [
              { column: "is_active", op: "eq", value: true },
              { column: "category_id", op: "in", value: [...eligibleRootCategoryIds] },
            ],
            orderBy: { column: "display_order" },
          })
        : [];

      const rootCategoryIdBySubcategoryId = new Map(
        eligibleSubcategories.map((row) => [row.id, row.category_id]),
      );
      const eligibleSubcategoryIds = eligibleSubcategories.map((row) => row.id);

      const eligibleLegacyProducts = eligibleSubcategoryIds.length > 0
        ? await dbSelect<LegacyProductRow>("products", {
            select: "id, description, subcategory_id, display_order",
            filters: [
              { column: "is_active", op: "eq", value: true },
              { column: "subcategory_id", op: "in", value: eligibleSubcategoryIds },
            ],
            orderBy: { column: "display_order" },
          })
        : [];

      const eligibleLegacyProductsById = new Map(
        eligibleLegacyProducts.map((row) => [row.id, row]),
      );
      const tableCandidatesByLegacyId = new Map<string, TableEligibleProductRow[]>();

      for (const row of tableNodeRows) {
        if (row.node_type !== "product" || !row.is_active) continue;

        const legacyProductId = row.legacy_product_id ?? row.id;
        const legacyProduct = eligibleLegacyProductsById.get(legacyProductId);
        if (!legacyProduct) continue;

        const root = getTableRootNode(row.id);
        const expectedRootCategoryId = rootCategoryIdBySubcategoryId.get(legacyProduct.subcategory_id) ?? null;
        if (expectedRootCategoryId && root?.id !== expectedRootCategoryId) continue;

        const bucket = tableCandidatesByLegacyId.get(legacyProductId) ?? [];
        bucket.push({
          node_id: row.id,
          legacy_product_id: legacyProductId,
          name: row.name || legacyProduct.description,
          display_order: Number(row.display_order ?? legacyProduct.display_order ?? 0),
        });
        tableCandidatesByLegacyId.set(legacyProductId, bucket);
      }

      const eligibleProductRows = eligibleLegacyProducts.flatMap((legacyProduct) => {
        const candidates = tableCandidatesByLegacyId.get(legacyProduct.id) ?? [];
        if (candidates.length === 0) return [];

        const selectedCandidate = [...candidates].sort((a, b) => {
          if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order;
          }
          return a.name.localeCompare(b.name);
        })[0];

        return [selectedCandidate];
      });

      const { data: assignments, error: assignmentsError } = await supabase
        .from("bulk_included_products" as any)
        .select("id, menu_node_id, included_node_id, is_active, display_order")
        .eq("menu_node_id", nodeId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (assignmentsError) throw assignmentsError;

      const assignmentRows = (assignments ?? []) as unknown as BulkIncludedProductRow[];
      const assignmentIds = assignmentRows.map((row) => row.id);

      let rangeRows: BulkIncludedProductRangeRow[] = [];
      if (assignmentIds.length > 0) {
        const { data: ranges, error: rangesError } = await supabase
          .from("bulk_included_product_ranges" as any)
          .select("id, bulk_included_product_id, amount_from, amount_to, included_quantity, display_order")
          .in("bulk_included_product_id", assignmentIds)
          .order("display_order", { ascending: true });

        if (rangesError) throw rangesError;
        rangeRows = (ranges ?? []) as unknown as BulkIncludedProductRangeRow[];
      }

      const assignedIds = new Set(assignmentRows.map((row) => row.included_node_id));
      const assignedLegacyProductIds = new Set(
        assignmentRows.flatMap((row) => {
          const includedNode = lookupNodeRows.find((candidate) => candidate.id === row.included_node_id) ?? null;
          if (!includedNode) return [];
          return [includedNode.legacy_product_id ?? includedNode.id];
        }),
      );

      const availableProducts = eligibleProductRows
        .filter((row) => !assignedIds.has(row.node_id) && !assignedLegacyProductIds.has(row.legacy_product_id))
        .sort((a, b) => {
          if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order;
          }
          return a.name.localeCompare(b.name);
        })
        .map((row) => ({
          node_id: row.node_id,
          name: row.name,
          display_order: row.display_order,
        }));

      const assignmentsWithRanges = assignmentRows
        .map((assignment) => {
          const includedNode = lookupNodeRows.find((row) => row.id === assignment.included_node_id) ?? null;
          return {
            id: assignment.id,
            included_node_id: assignment.included_node_id,
            included_node_name: includedNode?.name ?? "Producto",
            ranges: rangeRows
              .filter((range) => range.bulk_included_product_id === assignment.id)
              .map((range) => ({
                id: range.id,
                amount_from: Number(range.amount_from),
                amount_to: Number(range.amount_to),
                included_quantity: Number(range.included_quantity),
                display_order: Number(range.display_order ?? 0),
              }))
              .sort((a, b) => a.display_order - b.display_order),
          } satisfies IncludedProductAssignment;
        })
        .sort((a, b) => a.included_node_name.localeCompare(b.included_node_name));

      return {
        assignments: assignmentsWithRanges,
        availableProducts,
      };
    },
    enabled: !!activeBranchId && !!nodeId,
  });

  const invalidateQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: [BULK_INCLUDED_PRODUCTS_QUERY_KEY, activeBranchId, nodeId] });
  };

  const addIncludedProduct = async (includedNodeId: string) => {
    if (!nodeId) throw new Error("El producto actual todavia no existe.");
    if (!includedNodeId) throw new Error("Selecciona un producto incluido.");

    setActionPending(true);
    try {
      const { data, error } = await supabase
        .from("bulk_included_products" as any)
        .select("id, included_node_id, is_active, display_order")
        .eq("menu_node_id", nodeId);

      if (error) throw toError(error, "No se pudo validar si el producto incluido ya existia.");

      const rows = (data ?? []) as unknown as BulkIncludedProductRow[];
      const existing = rows.find((row) => row.included_node_id === includedNodeId) ?? null;
      if (existing?.is_active) {
        await invalidateQueries();
        return;
      }

      const usedOrders = rows
        .filter((row) => row.id !== existing?.id && row.is_active)
        .map((row) => Number(row.display_order) || 0);
      const nextDisplayOrder = usedOrders.length > 0 ? Math.max(...usedOrders) + 1 : 0;

      const { error: upsertError } = await supabase
        .from("bulk_included_products" as any)
        .upsert({
          id: existing?.id,
          menu_node_id: nodeId,
          included_node_id: includedNodeId,
          is_active: true,
          display_order: Number(existing?.display_order ?? nextDisplayOrder),
        } as any, { onConflict: "menu_node_id,included_node_id" });

      if (upsertError) throw toError(upsertError, "No se pudo guardar el producto incluido.");

      await invalidateQueries();
    } finally {
      setActionPending(false);
    }
  };

  const removeIncludedProduct = async (assignmentId: string) => {
    if (!assignmentId) throw new Error("No se pudo resolver el producto incluido a quitar.");

    setActionPending(true);
    try {
      const { error } = await supabase
        .from("bulk_included_products" as any)
        .update({ is_active: false } as any)
        .eq("id", assignmentId);

      if (error) throw toError(error, "No se pudo quitar el producto incluido.");

      await invalidateQueries();
    } finally {
      setActionPending(false);
    }
  };

  const saveRanges = async (assignmentId: string, ranges: EditableIncludedProductRange[]) => {
    if (!assignmentId) throw new Error("No se pudo resolver el producto incluido.");

    const normalizedRanges = ranges.map((range, index) => {
      const amountFrom = parseMoneyValue(range.amount_from);
      const quantity = Number.parseInt(String(range.included_quantity).trim(), 10);

      if (!Number.isFinite(amountFrom) || amountFrom < 0) {
        throw new Error(`Fila ${index + 1}: el monto "Desde" no es valido.`);
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Fila ${index + 1}: la cantidad a entregar debe ser un entero mayor que 0.`);
      }

      return {
        id: range.id,
        amount_from: Number(amountFrom.toFixed(2)),
        amount_to: 0,
        included_quantity: quantity,
        display_order: index,
      };
    });

    const orderedRanges = [...normalizedRanges].sort((a, b) => a.amount_from - b.amount_from);
    for (let index = 1; index < orderedRanges.length; index += 1) {
      if (orderedRanges[index].amount_from <= orderedRanges[index - 1].amount_from) {
        throw new Error("Cada fila debe tener un monto 'Desde' mayor a la fila anterior.");
      }
    }

    const computedRanges = orderedRanges.map((range, index) => {
      const nextRange = orderedRanges[index + 1] ?? null;
      const computedAmountTo = nextRange
        ? Number(Math.max(range.amount_from, nextRange.amount_from - 0.01).toFixed(2))
        : MAX_RANGE_AMOUNT;

      return {
        ...range,
        amount_to: computedAmountTo,
      };
    });

    const currentAssignment = (query.data?.assignments ?? []).find((assignment) => assignment.id === assignmentId) ?? null;
    const existingRangeIds = new Set((currentAssignment?.ranges ?? []).map((range) => range.id));
    const nextRangeIds = new Set(computedRanges.map((range) => range.id).filter((value): value is string => Boolean(value)));
    const idsToDelete = [...existingRangeIds].filter((id) => !nextRangeIds.has(id));

    setActionPending(true);
    try {
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("bulk_included_product_ranges" as any)
          .delete()
          .in("id", idsToDelete);

        if (deleteError) throw toError(deleteError, "No se pudieron borrar las reglas anteriores.");
      }

      if (computedRanges.length > 0) {
        const existingPayload = computedRanges
          .filter((range) => Boolean(range.id))
          .map((range) => ({
            id: range.id as string,
            bulk_included_product_id: assignmentId,
            amount_from: range.amount_from,
            amount_to: range.amount_to,
            included_quantity: range.included_quantity,
            display_order: range.display_order,
          }));

        if (existingPayload.length > 0) {
          const { error: upsertError } = await supabase
            .from("bulk_included_product_ranges" as any)
            .upsert(existingPayload as any[]);

          if (upsertError) throw toError(upsertError, "No se pudieron actualizar las reglas existentes.");
        }

        const newPayload = computedRanges
          .filter((range) => !range.id)
          .map((range) => ({
            bulk_included_product_id: assignmentId,
            amount_from: range.amount_from,
            amount_to: range.amount_to,
            included_quantity: range.included_quantity,
            display_order: range.display_order,
          }));

        if (newPayload.length > 0) {
          const { error: insertError } = await supabase
            .from("bulk_included_product_ranges" as any)
            .insert(newPayload as any[]);

          if (insertError) throw toError(insertError, "No se pudieron crear las reglas nuevas.");
        }
      }

      await invalidateQueries();
    } finally {
      setActionPending(false);
    }
  };

  const data = query.data ?? emptyState;

  return useMemo(
    () => ({
      assignments: data.assignments,
      availableProducts: data.availableProducts,
      addIncludedProduct,
      removeIncludedProduct,
      saveRanges,
      loading: query.isLoading || query.isFetching || actionPending,
      error: query.error ? normalizeError(query.error) : null,
    }),
    [actionPending, data.assignments, data.availableProducts, query.error, query.isFetching, query.isLoading],
  );
}
