import type { MenuNode } from "@/hooks/useMenuTree";

export function sortMenuNodes(nodes: MenuNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });
}

/** Mezcla arbol TAKEOUT con categorias raiz adicionales de TABLE (como en ordenes Para llevar / Express). */
export function buildCompositeMenuNodes(scopeNodes: MenuNode[], tableNodes: MenuNode[]) {
  const scopeRootNodes = sortMenuNodes(
    scopeNodes.filter((node) => node.parent_id === null && node.node_type === "category"),
  );
  const tableRootNodes = sortMenuNodes(
    tableNodes.filter((node) => node.parent_id === null && node.node_type === "category"),
  );

  const tableRootsToAppend = tableRootNodes.slice(1);
  if (tableRootsToAppend.length === 0) {
    return scopeNodes;
  }

  const allowedRootIds = new Set(tableRootsToAppend.map((node) => node.id));
  const tableNodesById = new Map(tableNodes.map((node) => [node.id, node]));
  const includedTableNodes = tableNodes.filter((node) => {
    if (allowedRootIds.has(node.id)) return true;

    let currentParentId = node.parent_id;
    while (currentParentId) {
      if (allowedRootIds.has(currentParentId)) return true;
      currentParentId = tableNodesById.get(currentParentId)?.parent_id ?? null;
    }

    return false;
  });

  const nextRootDisplayOrder = scopeRootNodes.reduce(
    (maxValue, node) => Math.max(maxValue, Number(node.display_order ?? 0)),
    0,
  );
  const appendedRootDisplayOrder = new Map(
    tableRootsToAppend.map((node, index) => [node.id, nextRootDisplayOrder + index + 1]),
  );

  const normalizedTableNodes = includedTableNodes.map((node) => ({
    ...node,
    display_order:
      node.parent_id === null
        ? (appendedRootDisplayOrder.get(node.id) ?? node.display_order)
        : node.display_order,
  }));

  return [...scopeNodes, ...normalizedTableNodes];
}
