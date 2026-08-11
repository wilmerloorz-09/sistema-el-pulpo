import type { QueryClient } from "@tanstack/react-query";
import { fetchMenuTreeNodes, type MenuNode, type MenuScope } from "@/hooks/useMenuTree";
import { supabase } from "@/integrations/supabase/client";
import { CATALOG_GC_MS, CATALOG_STALE_MS } from "@/lib/queryEgress";

export function normalizeMenuCategoryLabel(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function isPlatosRootCategoryName(value?: string | null) {
  return normalizeMenuCategoryLabel(value).includes("PLATOS");
}

export function resolveRootCategoryName(node: MenuNode, nodesById: Map<string, MenuNode>) {
  let parentId = node.parent_id;
  let rootCategoryName: string | null = null;

  while (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) break;
    if (parent.node_type === "category") {
      rootCategoryName = parent.name;
      if (parent.depth === 0 || !parent.parent_id) return parent.name;
    }
    parentId = parent.parent_id;
  }

  return rootCategoryName;
}

/** Product IDs (`products.id`) whose menu node belongs to a root category named PLATOS. */
export function buildPlatosProductIdSet(menuNodes: MenuNode[]) {
  const nodesById = new Map(menuNodes.map((node) => [node.id, node]));
  const productIds = new Set<string>();

  for (const node of menuNodes) {
    if (node.node_type !== "product") continue;
    const legacyProductId = node.legacy_product_id?.trim();
    if (!legacyProductId) continue;
    const rootName = resolveRootCategoryName(node, nodesById);
    if (isPlatosRootCategoryName(rootName)) {
      productIds.add(legacyProductId);
    }
  }

  return productIds;
}

const SERVIR_MENU_SCOPES: MenuScope[] = ["TABLE", "TAKEOUT", "BULK"];

export const platosProductIdsQueryKey = (branchId: string) =>
  ["platos-product-ids", branchId] as const;

/** Catálogo: casi no cambia en el turno; 30 min evita martillar menú en cada refresh de cola. */
const PLATOS_MEMORY_TTL_MS = CATALOG_STALE_MS;
const PLATOS_LS_PREFIX = "elpulpo:platos-product-ids:";

type MemoryEntry = { ids: string[]; expiresAt: number };
const platosMemoryCache = new Map<string, MemoryEntry>();

function readPlatosIdsFromStorage(branchId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${PLATOS_LS_PREFIX}${branchId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MemoryEntry;
    if (!parsed || !Array.isArray(parsed.ids) || Number(parsed.expiresAt) <= Date.now()) return null;
    const ids = parsed.ids.map(String).filter(Boolean);
    // Vacío no cuenta como hit: envenena Despacho (deja todos los ítems ahí).
    if (ids.length === 0) return null;
    return ids;
  } catch {
    return null;
  }
}

function writePlatosIdsToStorage(branchId: string, ids: string[]) {
  try {
    if (ids.length === 0) {
      // Nunca persistir catálogo vacío (TTL 30 min dejaba platos en Despacho).
      platosMemoryCache.delete(branchId);
      localStorage.removeItem(`${PLATOS_LS_PREFIX}${branchId}`);
      return;
    }
    const entry: MemoryEntry = {
      ids,
      expiresAt: Date.now() + PLATOS_MEMORY_TTL_MS,
    };
    localStorage.setItem(`${PLATOS_LS_PREFIX}${branchId}`, JSON.stringify(entry));
    platosMemoryCache.set(branchId, entry);
  } catch {
    // ignore quota / private mode
  }
}

async function loadPlatosProductIds(branchId: string): Promise<string[]> {
  const scopeNodes = await Promise.all(
    SERVIR_MENU_SCOPES.map((menuScope) =>
      fetchMenuTreeNodes({ branchId, menuScope, includeInactive: false }),
    ),
  );

  const productIds = buildPlatosProductIdSet(scopeNodes.flat());

  const { data: forcedProducts } = await supabase
    .from("products")
    .select("id")
    .eq("force_servir_module", true);

  if (forcedProducts) {
    for (const p of forcedProducts) {
      productIds.add(p.id);
    }
  }

  return Array.from(productIds);
}

export function invalidatePlatosProductIdsCache(branchId?: string | null) {
  if (branchId) {
    platosMemoryCache.delete(branchId);
    try {
      localStorage.removeItem(`${PLATOS_LS_PREFIX}${branchId}`);
    } catch {
      // ignore
    }
    return;
  }
  platosMemoryCache.clear();
}

/** Lectura con caché en memoria (TTL catálogo). */
export async function fetchPlatosProductIdsForBranch(branchId: string): Promise<Set<string>> {
  const cached = platosMemoryCache.get(branchId);
  if (cached && cached.expiresAt > Date.now() && cached.ids.length > 0) {
    return new Set(cached.ids);
  }
  if (cached && cached.ids.length === 0) {
    platosMemoryCache.delete(branchId);
  }

  const fromLs = readPlatosIdsFromStorage(branchId);
  if (fromLs && fromLs.length > 0) {
    platosMemoryCache.set(branchId, {
      ids: fromLs,
      expiresAt: Date.now() + PLATOS_MEMORY_TTL_MS,
    });
    return new Set(fromLs);
  }

  const ids = await loadPlatosProductIds(branchId);
  writePlatosIdsToStorage(branchId, ids);
  return new Set(ids);
}

/**
 * Comparte el catálogo entre Despacho/Servir vía React Query.
 * Un refresh de cola no vuelve a bajar 3 árboles de menú si el dato está fresco.
 */
export async function ensurePlatosProductIdsForBranch(
  qc: QueryClient,
  branchId: string,
): Promise<Set<string>> {
  // Hit rápido memoria / localStorage antes de ensureQueryData (evita esperar al scheduler RQ).
  const mem = platosMemoryCache.get(branchId);
  if (mem && mem.expiresAt > Date.now() && mem.ids.length > 0) {
    return new Set(mem.ids);
  }
  if (mem && mem.ids.length === 0) {
    platosMemoryCache.delete(branchId);
  }

  const fromLs = readPlatosIdsFromStorage(branchId);
  if (fromLs && fromLs.length > 0) {
    platosMemoryCache.set(branchId, {
      ids: fromLs,
      expiresAt: Date.now() + PLATOS_MEMORY_TTL_MS,
    });
    // Revalidar en background sin bloquear la cola.
    void qc.prefetchQuery({
      queryKey: platosProductIdsQueryKey(branchId),
      queryFn: async () => {
        const loaded = await loadPlatosProductIds(branchId);
        writePlatosIdsToStorage(branchId, loaded);
        return loaded;
      },
      staleTime: CATALOG_STALE_MS,
      gcTime: CATALOG_GC_MS,
    });
    return new Set(fromLs);
  }

  const ids = await qc.ensureQueryData({
    queryKey: platosProductIdsQueryKey(branchId),
    queryFn: async () => {
      const loaded = await loadPlatosProductIds(branchId);
      writePlatosIdsToStorage(branchId, loaded);
      return loaded;
    },
    staleTime: CATALOG_STALE_MS,
    gcTime: CATALOG_GC_MS,
  });

  // RQ pudo cachear [] de un fallo previo: no reutilizar vacío.
  if (!ids || ids.length === 0) {
    qc.removeQueries({ queryKey: platosProductIdsQueryKey(branchId) });
    const reloaded = await loadPlatosProductIds(branchId);
    writePlatosIdsToStorage(branchId, reloaded);
    if (reloaded.length > 0) {
      qc.setQueryData(platosProductIdsQueryKey(branchId), reloaded);
    }
    return new Set(reloaded);
  }

  return new Set(ids);
}

export function isPlatosOrderItem(
  productId: string | null | undefined,
  platosProductIds: Set<string>,
) {
  if (!productId) return false;
  return platosProductIds.has(productId);
}
