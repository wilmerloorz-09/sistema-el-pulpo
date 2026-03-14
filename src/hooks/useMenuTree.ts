import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

export interface MenuNode {
  id: string;
  branch_id: string;
  parent_id: string | null;
  name: string;
  node_type: "category" | "product";
  depth: number;
  display_order: number;
  is_active: boolean;
  icon?: string | null;
  price?: number | null;
  description?: string | null;
  image_url?: string | null;
}

interface UseMenuTreeOptions {
  includeInactive?: boolean;
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
}

const sortNodes = (nodes: MenuNode[]) =>
  [...nodes].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });

export function useMenuTree(options: UseMenuTreeOptions = {}): UseMenuTreeReturn {
  const { activeBranchId } = useBranch();
  const [pathIds, setPathIds] = useState<string[]>([]);
  const includeInactive = options.includeInactive ?? false;

  const query = useQuery({
    queryKey: ["menu-tree", activeBranchId, includeInactive],
    queryFn: async () => {
      let queryBuilder = supabase
        .from("menu_nodes" as never)
        .select("*")
        .eq("branch_id", activeBranchId!)
        .order("depth", { ascending: true })
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (!includeInactive) {
        queryBuilder = queryBuilder.eq("is_active", true);
      }

      const { data, error } = await queryBuilder;

      if (error) throw error;
      return (data ?? []) as unknown as MenuNode[];
    },
    enabled: !!activeBranchId,
  });

  const nodes = query.data ?? [];

  const nodesById = useMemo(() => {
    const next = new Map<string, MenuNode>();
    for (const node of nodes) {
      next.set(node.id, {
        ...node,
        price: node.price == null ? null : Number(node.price),
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

  const rootNodes = useMemo(
    () => getChildren(null).filter((node) => node.node_type === "category"),
    [childrenByParent],
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
    return getChildren(currentNode.id);
  }, [currentNode, childrenByParent]);

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
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
