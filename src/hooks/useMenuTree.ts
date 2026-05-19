import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

export type MenuScope = "TABLE" | "TAKEOUT" | "BULK" | "EXTRA";
const MENU_TREE_SELECT =
  "id, branch_id, menu_scope, parent_id, name, node_type, depth, display_order, is_active, manual_price_enabled, icon, price, description, image_url, legacy_product_id, is_tray_category";

export interface MenuNode {
  id: string;
  branch_id: string;
  menu_scope: MenuScope;
  parent_id: string | null;
  name: string;
  node_type: "category" | "product";
  depth: number;
  display_order: number;
  is_active: boolean;
  manual_price_enabled?: boolean;
  icon?: string | null;
  price?: number | null;
  description?: string | null;
  image_url?: string | null;
  legacy_product_id?: string | null;
  is_tray_category?: boolean;
  ancestor_ids?: string[];
  manual_price_inherited?: boolean;
}

function normalizeCategoryLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

interface UseMenuTreeOptions {
  includeInactive?: boolean;
  menuScope?: MenuScope;
  nodesOverride?: MenuNode[] | null;
  /** Oculta categorias raiz cuyo nombre contenga alguno de estos textos (ej. PLATOS). */
  excludedRootCategoryNames?: string[];
}

interface UseMenuTreeReturn {
  visibleNodes: MenuNode[];
  breadcrumb: MenuNode[];
  activeL1: MenuNode | null;
  selectL1: (nodeId: string) => void;
  drillDown: (node: MenuNode) => boolean;
  goBack: () => void;
  goToBreadcrumbIndex: (index: number) => void;
  getChildren: (parentId: string | null) => MenuNode[];
  hasChildren: (nodeId: string) => boolean;
  countDescendantDepth: (nodeId: string) => number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const sortNodes = (nodes: MenuNode[]) =>
  [...nodes].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });

export function getMenuTreeQueryKey(params: {
  branchId: string | null | undefined;
  menuScope?: MenuScope;
  includeInactive?: boolean;
  hasOverride?: boolean;
}) {
  return [
    "menu-tree",
    params.branchId ?? null,
    params.menuScope ?? "TABLE",
    params.includeInactive ?? false,
    params.hasOverride ? "override" : "db",
  ] as const;
}

export async function fetchMenuTreeNodes(params: {
  branchId: string;
  menuScope?: MenuScope;
  includeInactive?: boolean;
}) {
  const menuScope = params.menuScope ?? "TABLE";
  const includeInactive = params.includeInactive ?? false;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 15_000);

  let queryBuilder = supabase
    .from("menu_nodes" as any)
    .select(MENU_TREE_SELECT)
    .eq("branch_id", params.branchId)
    .eq("menu_scope", menuScope)
    .order("depth", { ascending: true })
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeInactive) {
    queryBuilder = queryBuilder.eq("is_active", true);
  }

  try {
    const { data, error } = await (queryBuilder as any).abortSignal(controller.signal);
    if (error) throw error;
    return (data ?? []) as unknown as MenuNode[];
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("La carga de productos tardo demasiado. Revisa la conexion e intenta otra vez.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function useMenuTree(options: UseMenuTreeOptions = {}): UseMenuTreeReturn {
  const { activeBranchId } = useBranch();
  const [pathIds, setPathIds] = useState<string[]>([]);
  const includeInactive = options.includeInactive ?? false;
  const menuScope = options.menuScope ?? "TABLE";
  const overrideNodes = options.nodesOverride ?? null;
  const excludedRootCategoryNames = options.excludedRootCategoryNames ?? [];

  const query = useQuery({
    queryKey: getMenuTreeQueryKey({
      branchId: activeBranchId,
      menuScope,
      includeInactive,
      hasOverride: Boolean(overrideNodes),
    }),
    queryFn: () =>
      fetchMenuTreeNodes({
        branchId: activeBranchId!,
        menuScope,
        includeInactive,
      }),
    enabled: !!activeBranchId && !overrideNodes,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const nodes = overrideNodes ?? (query.data ?? []);

  const nodesById = useMemo(() => {
    const baseNodes = new Map<string, MenuNode>();
    for (const node of nodes) {
      baseNodes.set(node.id, {
        ...node,
        price: node.price == null ? null : Number(node.price),
      });
    }

    const ancestorCache = new Map<string, string[]>();
    const manualPriceCache = new Map<string, boolean>();

    const resolveAncestorIds = (node: MenuNode): string[] => {
      const cached = ancestorCache.get(node.id);
      if (cached) return cached;

      const parentId = node.parent_id ?? null;
      if (!parentId) {
        ancestorCache.set(node.id, []);
        return [];
      }

      const parentNode = baseNodes.get(parentId);
      const nextAncestors = parentNode ? [parentNode.id, ...resolveAncestorIds(parentNode)] : [];
      ancestorCache.set(node.id, nextAncestors);
      return nextAncestors;
    };

    const resolveManualPrice = (node: MenuNode): boolean => {
      const cached = manualPriceCache.get(node.id);
      if (cached != null) return cached;

      const inherited = resolveAncestorIds(node).some((ancestorId) => {
        const ancestorNode = baseNodes.get(ancestorId);
        return ancestorNode?.node_type === "category" && Boolean(ancestorNode.manual_price_enabled);
      });

      manualPriceCache.set(node.id, inherited);
      return inherited;
    };

    const next = new Map<string, MenuNode>();
    for (const node of baseNodes.values()) {
      next.set(node.id, {
        ...node,
        ancestor_ids: resolveAncestorIds(node),
        manual_price_inherited: resolveManualPrice(node),
      });
    }

    return next;
  }, [nodes]);

  const childrenByParent = useMemo(() => {
    const next = new Map<string | null, MenuNode[]>();
    for (const node of nodesById.values()) {
      const key = node.parent_id ?? null;
      const bucket = next.get(key) ?? [];
      bucket.push(node);
      next.set(key, bucket);
    }

    for (const [key, value] of next.entries()) {
      next.set(key, sortNodes(value));
    }

    return next;
  }, [nodesById]);

  const getChildren = (parentId: string | null) => childrenByParent.get(parentId) ?? [];

  const excludedRootMatchers = useMemo(
    () => excludedRootCategoryNames.map((name) => normalizeCategoryLabel(name)).filter(Boolean),
    [excludedRootCategoryNames],
  );

  const excludedRootIds = useMemo(() => {
    if (excludedRootMatchers.length === 0) return new Set<string>();
    return new Set(
      getChildren(null)
        .filter((node) => {
          if (node.node_type !== "category") return false;
          const normalizedName = normalizeCategoryLabel(node.name);
          return excludedRootMatchers.some((matcher) => normalizedName.includes(matcher));
        })
        .map((node) => node.id),
    );
  }, [childrenByParent, excludedRootMatchers]);

  const isNodeUnderExcludedRoot = (node: MenuNode) =>
    excludedRootIds.size > 0
    && (excludedRootIds.has(node.id) || (node.ancestor_ids ?? []).some((ancestorId) => excludedRootIds.has(ancestorId)));

  const rootNodes = useMemo(
    () =>
      getChildren(null).filter(
        (node) => node.node_type === "category" && !excludedRootIds.has(node.id),
      ),
    [childrenByParent, excludedRootIds],
  );

  useEffect(() => {
    if (!nodes.length) {
      setPathIds([]);
      return;
    }

    const currentPath = pathIds.map((id) => nodesById.get(id)).filter(Boolean) as MenuNode[];
    const root = currentPath[0];
    const isValidRoot = root && root.parent_id === null && nodesById.has(root.id);

    if (isValidRoot && currentPath.every((node) => nodesById.has(node.id))) {
      return;
    }

    const firstL1 = rootNodes[0] ?? null;
    setPathIds(firstL1 ? [firstL1.id] : []);
  }, [nodes.length, nodesById, pathIds, rootNodes]);

  const breadcrumb = useMemo(
    () => pathIds.map((id) => nodesById.get(id)).filter(Boolean) as MenuNode[],
    [nodesById, pathIds],
  );

  const activeL1 = breadcrumb[0] ?? null;
  const currentNode = breadcrumb[breadcrumb.length - 1] ?? activeL1 ?? null;

  const visibleNodes = useMemo(() => {
    if (!currentNode) return [];
    return getChildren(currentNode.id).filter((node) => !isNodeUnderExcludedRoot(node));
  }, [currentNode, childrenByParent, excludedRootIds]);

  const selectL1 = (nodeId: string) => {
    const l1 = nodesById.get(nodeId);
    if (!l1) return;
    setPathIds([l1.id]);
  };

  const hasChildren = (nodeId: string) => getChildren(nodeId).length > 0;

  const drillDown = (node: MenuNode) => {
    if (!hasChildren(node.id)) return false;
    setPathIds((prev) => [...prev, node.id]);
    return true;
  };

  const goBack = () => {
    setPathIds((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const goToBreadcrumbIndex = (index: number) => {
    setPathIds((prev) => prev.slice(0, index + 1));
  };

  const countDescendantDepth = (nodeId: string) => {
    const start = nodesById.get(nodeId);
    if (!start) return 0;

    let maxDepth = start.depth;
    const queue = [...getChildren(nodeId)];
    while (queue.length > 0) {
      const current = queue.shift()!;
      maxDepth = Math.max(maxDepth, current.depth);
      queue.push(...getChildren(current.id));
    }

    return Math.max(0, maxDepth - start.depth);
  };

  return {
    visibleNodes,
    breadcrumb,
    activeL1,
    selectL1,
    drillDown,
    goBack,
    goToBreadcrumbIndex,
    getChildren,
    hasChildren,
    countDescendantDepth,
    loading: overrideNodes ? false : query.isLoading,
    error: overrideNodes ? null : query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
