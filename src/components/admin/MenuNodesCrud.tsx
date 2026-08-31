import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderTree, ImageUp, Plus, Power, Save, Trash2, Eraser } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { parseDecimalInput, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/numericInput";
import { cn } from "@/lib/utils";
import { generateUUID } from "@/lib/uuid";
import type { MenuNode, MenuScope } from "@/hooks/useMenuTree";
import { invalidatePlatosProductIdsCache } from "@/lib/menuPlatosCategory";
import { invalidateDispatchServirQueueBundleCache } from "@/lib/dispatchServirQueueBundle";
import { invalidateOperationalQueueCache } from "@/lib/operationalQueue";
import NodeModifiersPanel from "@/components/admin/NodeModifiersPanel";
import BulkIncludedProductsPanel from "@/components/admin/BulkIncludedProductsPanel";

function invalidateMenuCatalogQueries(queryClient: ReturnType<typeof useQueryClient>, branchId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ["admin-menu-nodes"] });
  queryClient.invalidateQueries({ queryKey: ["menu-tree"] });
  queryClient.invalidateQueries({ queryKey: ["scope-composite-menu-tree"] });
  queryClient.invalidateQueries({ queryKey: ["menu-product-lookup"] });
  queryClient.invalidateQueries({ queryKey: ["branch-modifiers-catalog"] });
  queryClient.invalidateQueries({ queryKey: ["menu-products"] });
  queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
  queryClient.invalidateQueries({ queryKey: ["menu-subcategories"] });
  queryClient.removeQueries({ queryKey: ["platos-product-ids", branchId] });
  queryClient.invalidateQueries({ queryKey: ["producto-sucursal"] });
  queryClient.invalidateQueries({ queryKey: ["inventario-producto-map"] });
  invalidatePlatosProductIdsCache(branchId);
  if (branchId) {
    invalidateDispatchServirQueueBundleCache(branchId);
    invalidateOperationalQueueCache(branchId);
    void queryClient.refetchQueries({ queryKey: ["dispatch-orders", branchId], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["servir-orders", branchId], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["packing-orders", branchId], type: "active" });
  }
}

interface AdminMenuNode extends MenuNode {}

interface CategoryRecord {
  id: string;
  display_order: number | null;
}

interface SubcategoryRecord {
  id: string;
  category_id: string;
  display_order: number | null;
}

interface ProductRecord {
  id: string;
  subcategory_id?: string | null;
  display_order: number | null;
}

interface FormState {
  id: string | null;
  name: string;
  qr_name: string;
  node_type: "category" | "product";
  parent_id: string | null;
  manual_price_enabled: boolean;
  price: string;
  display_order: string;
  description: string;
  image_url: string;
  is_active: boolean;
  force_servir_module: boolean;
  producto_global_id: string | null;
}

const MENU_NODE_IMAGE_BUCKET = "menu-node-images";
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const getCollapsedNodesStorageKey = (branchId: string) => `adminMenuNodesCollapsed:${branchId}`;

const emptyForm = (parentId: string | null = null, displayOrder: string = "1"): FormState => ({
  id: null,
  name: "",
  qr_name: "",
  node_type: "category",
  parent_id: parentId,
  manual_price_enabled: false,
  price: "",
  display_order: displayOrder,
  description: "",
  image_url: "",
  is_active: true,
  force_servir_module: false,
  producto_global_id: null,
});

const sortedNumbers = (values: number[]) => values.filter((value) => value > 0).sort((a, b) => a - b);

const nextAvailableOrder = (usedOrders: number[], preferred: number) => {
  const normalized = sortedNumbers(usedOrders);
  if (preferred > 0 && !normalized.includes(preferred)) return preferred;
  return (normalized.length > 0 ? normalized[normalized.length - 1] : 0) + 1;
};

const normalizeImageUrl = (value: string | null | undefined) => value?.trim() || "";

const validateImageFile = (file: File) => {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("La imagen debe ser JPG, PNG, WEBP o GIF.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("La imagen no puede superar 2 MB.");
  }
};

const getFileExtension = (file: File) => {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
  if (fromName) return fromName;

  switch (file.type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
};

const buildMenuNodeImagePath = (branchId: string, nodeId: string, file: File) => {
  const extension = getFileExtension(file);
  return `${branchId}/${nodeId}/${Date.now()}-${generateUUID()}.${extension}`;
};

const extractManagedImagePath = (imageUrl: string | null | undefined) => {
  const normalized = normalizeImageUrl(imageUrl);
  const marker = `/storage/v1/object/public/${MENU_NODE_IMAGE_BUCKET}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;
  return decodeURIComponent(normalized.slice(markerIndex + marker.length));
};

const getPublicImageUrl = (path: string) => supabase.storage.from(MENU_NODE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
const sortMenuNodes = (items: AdminMenuNode[]) =>
  [...items].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });

const upsertMenuNodeInList = (items: AdminMenuNode[], nextNode: AdminMenuNode) => {
  const filtered = items.filter((item) => item.id !== nextNode.id);
  return sortMenuNodes([...filtered, nextNode]);
};

interface MenuNodesCrudProps {
  menuScope?: MenuScope;
  title?: string;
  showCopyFromTableButton?: boolean;
}

const MenuNodesCrud = ({
  menuScope = "TABLE",
  title = "Arbol de menu",
  showCopyFromTableButton = false,
}: MenuNodesCrudProps) => {
  const { activeBranchId, activeBranch } = useBranch();
  const usaCatalogoGlobal = Boolean(activeBranch?.usa_catalogo_global);
  const queryClient = useQueryClient();
  const isTableScope = menuScope === "TABLE";
  const isBulkScope = menuScope === "BULK";
  const [formLoading, setFormLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-menu-nodes", activeBranchId, menuScope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_nodes" as any)
        .select("id, branch_id, parent_id, name, qr_name, node_type, menu_scope, depth, display_order, price, manual_price_enabled, is_active, is_tray_category, legacy_product_id, producto_global_id, image_url, icon, description, created_at, updated_at")
        .eq("branch_id", activeBranchId!)
        .eq("menu_scope", menuScope)
        .order("depth", { ascending: true })
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AdminMenuNode[];
    },
    enabled: !!activeBranchId,
  });

  const productosGlobalesMenuQuery = useQuery({
    queryKey: ["productos-globales-menu"],
    enabled: Boolean(activeBranchId) && usaCatalogoGlobal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("productos_globales" as any)
        .select(
          "id, nombre_principal, nombre_qr_default, precio_default, force_servir_default, descripcion_default, imagen_default_url",
        )
        .eq("activo", true)
        .order("nombre_principal");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        nombre_principal: string;
        nombre_qr_default: string | null;
        precio_default: number;
        force_servir_default: boolean;
        descripcion_default: string | null;
        imagen_default_url: string | null;
      }>;
    },
  });
  const productosParaMenu = productosGlobalesMenuQuery.data ?? [];
  const productosParaMenuById = useMemo(
    () => new Map(productosParaMenu.map((p) => [p.id, p])),
    [productosParaMenu],
  );

  const nodes = query.data ?? [];
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const productosYaEnEsteMenu = useMemo(() => {
    const used = new Set<string>();
    for (const node of nodes) {
      if (
        node.node_type === "product"
        && node.menu_scope === menuScope
        && node.producto_global_id
        && node.id !== form.id
      ) {
        used.add(node.producto_global_id);
      }
    }
    return used;
  }, [form.id, menuScope, nodes]);

  useEffect(() => {
      if (!activeBranchId || nodes.length === 0) return;

    const storageKey = `${getCollapsedNodesStorageKey(activeBranchId)}:${menuScope}`;
    const availableNodeIds = new Set(nodes.map((node) => node.id));
    const defaultCollapsedIds = nodes.filter((node) => node.parent_id !== null).map((node) => node.id);

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setCollapsedIds(defaultCollapsedIds);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setCollapsedIds(defaultCollapsedIds);
        return;
      }

      const restored = parsed.filter((id): id is string => typeof id === "string" && availableNodeIds.has(id));
      setCollapsedIds(restored);
    } catch {
      setCollapsedIds(defaultCollapsedIds);
    }
  }, [activeBranchId, menuScope, nodes]);

  useEffect(() => {
    if (!activeBranchId) return;
    localStorage.setItem(`${getCollapsedNodesStorageKey(activeBranchId)}:${menuScope}`, JSON.stringify(collapsedIds));
  }, [activeBranchId, collapsedIds, menuScope]);

  useEffect(() => {
    if (!selectedImageFile) {
      setLocalPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImageFile);
    setLocalPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImageFile]);

  const childrenByParent = useMemo(() => {
    const next = new Map<string | null, AdminMenuNode[]>();
    for (const node of nodes) {
      const key = node.parent_id ?? null;
      const bucket = next.get(key) ?? [];
      bucket.push(node);
      next.set(key, bucket);
    }

    for (const [key, value] of next.entries()) {
      next.set(
        key,
        [...value].sort((a, b) => {
          if (a.display_order !== b.display_order) return a.display_order - b.display_order;
          return a.name.localeCompare(b.name);
        }),
      );
    }

    return next;
  }, [nodes]);

  const getChildren = (parentId: string | null) => childrenByParent.get(parentId) ?? [];

  const getDescendantIds = (nodeId: string) => {
    const descendants = new Set<string>();
    const queue = [...getChildren(nodeId)];
    while (queue.length > 0) {
      const current = queue.shift()!;
      descendants.add(current.id);
      queue.push(...getChildren(current.id));
    }
    return descendants;
  };

  const getRootCategoryId = (nodeId: string) => {
    let current = nodesById.get(nodeId) ?? null;
    while (current?.parent_id) {
      current = nodesById.get(current.parent_id) ?? null;
    }
    return current?.id ?? nodeId;
  };

  const findNearestCategoryAncestorId = (startParentId: string | null) => {
    let currentId = startParentId;
    while (currentId) {
      const current = nodesById.get(currentId) ?? null;
      if (current?.node_type === "category") return current.id;
      currentId = current?.parent_id ?? null;
    }
    return null;
  };

  const getCategoryLineage = (nodeId: string) => {
    const lineage: Array<{ name: string; displayOrder: number }> = [];
    let current = nodesById.get(nodeId) ?? null;

    while (current) {
      if (current.node_type === "category") {
        lineage.unshift({
          name: current.name.trim().toLowerCase(),
          displayOrder: Number(current.display_order ?? 0),
        });
      }
      current = current.parent_id ? nodesById.get(current.parent_id) ?? null : null;
    }

    return lineage;
  };

  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;
  const selectedDescendants = selectedNode ? getDescendantIds(selectedNode.id) : new Set<string>();
  const imagePreviewUrl = localPreviewUrl ?? (removeImage ? "" : normalizeImageUrl(form.image_url));
  const hasCurrentImage = Boolean(normalizeImageUrl(form.image_url)) && !removeImage;

  const parentOptions = useMemo(
    () => {
      const flattenCategoryBranch = (parentId: string | null): AdminMenuNode[] =>
        getChildren(parentId).flatMap((node) => {
          if (
            node.node_type !== "category" ||
            node.id === form.id ||
            selectedDescendants.has(node.id)
          ) {
            return [];
          }

          return [
            node,
            ...flattenCategoryBranch(node.id),
          ];
        });

      return flattenCategoryBranch(null);
    },
    [form.id, getChildren, selectedDescendants],
  );

  const getSuggestedDisplayOrder = (parentId: string | null, _nodeType: "category" | "product") => {
    const siblingOrders = nodes
      .filter((node) => node.parent_id === parentId)
      .map((node) => Number(node.display_order) || 0);

    return String(nextAvailableOrder(siblingOrders, 1));
  };

  const renderParentOptionLabel = (node: AdminMenuNode) => (
    <span className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {Array.from({ length: node.depth }).map((_, index) => (
          <span key={`${node.id}-branch-${index}`} className="block h-px w-3 bg-orange-300" />
        ))}
        {node.depth > 0 ? <span className="text-xs">└</span> : null}
      </span>
      <span>{node.name}</span>
    </span>
  );

  const resetForm = (nextParentId: string | null = null) => {
    setSelectedId(null);
    setSelectedImageFile(null);
    setRemoveImage(false);
    setForm(emptyForm(nextParentId, getSuggestedDisplayOrder(nextParentId, "category")));
  };

  const startEdit = async (node: AdminMenuNode) => {
    setSelectedId(node.id);
    setSelectedImageFile(null);
    setRemoveImage(false);
    setFormLoading(true);

    let forceServir = false;
    if (node.node_type === "product" && (node.legacy_product_id || node.producto_global_id)) {
      const productId = node.producto_global_id ?? node.legacy_product_id!;
      const { data, error } = await supabase
        .from("products")
        .select("force_servir_module")
        .eq("id", productId)
        .maybeSingle();
      if (error) {
        console.error("Error loading product:", error);
      } else if (data) {
        forceServir = Boolean(data.force_servir_module);
      }
    }

    const catalogImage = node.producto_global_id
      ? normalizeImageUrl(productosParaMenuById.get(node.producto_global_id)?.imagen_default_url)
      : "";
    const nodeImage = normalizeImageUrl(node.image_url);

    setForm({
      id: node.id,
      name: node.name,
      qr_name: node.qr_name ?? "",
      node_type: node.node_type,
      parent_id: node.parent_id,
      manual_price_enabled: Boolean(node.manual_price_enabled),
      price: node.price == null ? "" : String(node.price),
      display_order: String(node.display_order ?? 0),
      description: node.description ?? "",
      image_url: nodeImage || catalogImage,
      is_active: node.is_active,
      force_servir_module: forceServir,
      producto_global_id: node.producto_global_id ?? null,
    });
    setFormLoading(false);
  };

  const ensureLegacyCategoryMirror = async (
    categoryNodeId: string,
    categoryName: string,
    parentId: string | null,
    preferredDisplayOrder: number,
    isActive: boolean,
  ): Promise<string> => {
    if (!activeBranchId) throw new Error("No se pudo resolver la categoria operativa legacy.");

    // Recursively ensure parent category is mirrored first
    if (parentId) {
      const parentNode = nodesById.get(parentId);
      if (parentNode) {
        await ensureLegacyCategoryMirror(
          parentNode.id,
          parentNode.name,
          parentNode.parent_id,
          Number(parentNode.display_order ?? 1) || 1,
          parentNode.is_active ?? true,
        );
      }
    }

    const rootCategoryId = parentId ? getRootCategoryId(parentId) : categoryNodeId;
    const isRootCategory = parentId === null;

    if (isRootCategory) {
      const { data: categories, error: categoriesError } = await supabase
        .from("categories")
        .select("id, display_order")
        .eq("branch_id", activeBranchId);
      if (categoriesError) throw categoriesError;

      const rows = (categories ?? []) as CategoryRecord[];
      const existing = rows.find((row) => row.id === categoryNodeId) ?? null;
      const usedOrders = rows
        .filter((row) => row.id !== categoryNodeId)
        .map((row) => Number(row.display_order) || 0);

      const categoryDisplayOrder = existing
        ? nextAvailableOrder(usedOrders, Number(existing.display_order) || preferredDisplayOrder)
        : nextAvailableOrder(usedOrders, preferredDisplayOrder);

      const { error: categoryError } = await supabase.from("categories").upsert({
        id: categoryNodeId,
        branch_id: activeBranchId,
        description: categoryName,
        display_order: categoryDisplayOrder,
        is_active: isActive,
      });
      if (categoryError) throw categoryError;
    }

    const { data: subcategories, error: subcategoriesError } = await supabase
      .from("subcategories")
      .select("id, category_id, display_order")
      .eq("category_id", rootCategoryId);
    if (subcategoriesError) throw subcategoriesError;

    const rows = (subcategories ?? []) as SubcategoryRecord[];
    const existing = rows.find((row) => row.id === categoryNodeId) ?? null;
    const usedOrders = rows
      .filter((row) => row.id !== categoryNodeId)
      .map((row) => Number(row.display_order) || 0);

    const subcategoryDisplayOrder = existing
      ? nextAvailableOrder(usedOrders, Number(existing.display_order) || preferredDisplayOrder)
      : nextAvailableOrder(usedOrders, preferredDisplayOrder);

    const { error: subcategoryError } = await supabase.from("subcategories").upsert({
      id: categoryNodeId,
      category_id: rootCategoryId,
      description: categoryName,
      display_order: subcategoryDisplayOrder,
      is_active: isActive,
    });
    if (subcategoryError) throw subcategoryError;

    return categoryNodeId;
  };

  const resolveTableLegacySubcategoryId = async (takeoutCategoryId: string) => {
    if (!activeBranchId) throw new Error("No hay sucursal activa");

    const lineage = getCategoryLineage(takeoutCategoryId);
    if (lineage.length === 0) {
      throw new Error("No se pudo resolver la categoria equivalente en Arbol Menu Mesa.");
    }

    const { data: tableCategories, error: tableCategoriesError } = await supabase
      .from("menu_nodes" as any)
      .select("id, parent_id, name, node_type, display_order")
      .eq("branch_id", activeBranchId)
      .eq("menu_scope", "TABLE")
      .eq("node_type", "category");
    if (tableCategoriesError) throw tableCategoriesError;

    const tableCategoryList = ((tableCategories ?? []) as unknown as AdminMenuNode[]).filter(
      (node) => node.node_type === "category",
    );
    const tableCategoryMap = new Map(tableCategoryList.map((node) => [node.id, node]));

    const buildTableLineage = (nodeId: string) => {
      const chain: Array<{ name: string; displayOrder: number }> = [];
      let current = tableCategoryMap.get(nodeId) ?? null;

      while (current) {
        chain.unshift({
          name: current.name.trim().toLowerCase(),
          displayOrder: Number(current.display_order ?? 0),
        });
        current = current.parent_id ? tableCategoryMap.get(current.parent_id) ?? null : null;
      }

      return chain;
    };

    const exactMatch = tableCategoryList.find((candidate) => {
      const candidateLineage = buildTableLineage(candidate.id);
      return (
        candidateLineage.length === lineage.length &&
        candidateLineage.every(
          (segment, index) =>
            segment.name === lineage[index]?.name && segment.displayOrder === lineage[index]?.displayOrder,
        )
      );
    });

    if (exactMatch) return exactMatch.id;

    const nameOnlyMatch = tableCategoryList.find((candidate) => {
      const candidateLineage = buildTableLineage(candidate.id);
      return (
        candidateLineage.length === lineage.length &&
        candidateLineage.every((segment, index) => segment.name === lineage[index]?.name)
      );
    });

    if (nameOnlyMatch) return nameOnlyMatch.id;

    throw new Error(
      "El producto para llevar no tiene categoria equivalente en Arbol Menu Mesa. Copia el arbol desde Mesa o crea primero esa categoria en Mesa.",
    );
  };
  const saveMutation = useMutation({
    mutationFn: async (formData: FormState) => {
      if (!activeBranchId) throw new Error("No hay sucursal activa");

      const id = formData.id ?? generateUUID();
      const previousImageUrl = normalizeImageUrl(formData.id ? nodesById.get(formData.id)?.image_url : "");
      const previousManagedImagePath = extractManagedImagePath(previousImageUrl);
      let uploadedImagePath: string | null = null;

      try {
        const name = formData.name.trim();
        if (!name) throw new Error("El nombre es obligatorio");

        const displayOrder = Number.parseInt(formData.display_order, 10);
        if (Number.isNaN(displayOrder)) throw new Error("El orden debe ser numerico");

        if (formData.parent_id) {
          const parent = nodesById.get(formData.parent_id);
          if (!parent) throw new Error("El nodo padre ya no existe");
          if (parent.node_type !== "category") throw new Error("Solo una categoria puede tener hijos");
        }

        let price: number | null = null;
        if (formData.node_type === "product") {
          if (!formData.parent_id) throw new Error("El producto debe crearse desde el nivel 2 en adelante.");
          if (!isBulkScope) {
            price = parseDecimalInput(formData.price);
            if (!Number.isFinite(price) || price < 0) throw new Error("El producto requiere un precio valido");
          }
        }

        if (formData.id) {
          const children = getChildren(formData.id);
          if (formData.node_type === "product" && children.length > 0) {
            throw new Error("No puedes convertir en producto un nodo que ya tiene hijos");
          }
        }

        let imageUrlToPersist = removeImage
          ? ""
          : normalizeImageUrl(formData.image_url) || previousImageUrl;

        if (selectedImageFile) {
          validateImageFile(selectedImageFile);
          uploadedImagePath = buildMenuNodeImagePath(activeBranchId, id, selectedImageFile);
          const { error: uploadError } = await supabase.storage
            .from(MENU_NODE_IMAGE_BUCKET)
            .upload(uploadedImagePath, selectedImageFile, {
              cacheControl: "3600",
              upsert: false,
              contentType: selectedImageFile.type,
            });
          if (uploadError) throw uploadError;

          imageUrlToPersist = getPublicImageUrl(uploadedImagePath);
        }

        // Si eligió producto global y no hay imagen de nodo, heredar la default del catálogo.
        if (
          !removeImage
          && !imageUrlToPersist
          && formData.producto_global_id
        ) {
          const fromCatalog = productosParaMenuById.get(formData.producto_global_id)?.imagen_default_url;
          imageUrlToPersist = normalizeImageUrl(fromCatalog);
        }

        const existingNode = formData.id ? nodesById.get(formData.id) : undefined;
        const isNewMenuNode = !formData.id;
        const useGlobalPath =
          usaCatalogoGlobal
          && formData.node_type === "product"
          && Boolean(formData.producto_global_id);

        if (usaCatalogoGlobal && formData.node_type === "product" && isNewMenuNode && !formData.producto_global_id) {
          throw new Error("Selecciona un producto del catálogo global.");
        }

        if (
          formData.node_type === "product"
          && formData.producto_global_id
        ) {
          const duplicateInMenu = nodes.find(
            (node) =>
              node.id !== id
              && node.node_type === "product"
              && node.menu_scope === menuScope
              && node.producto_global_id === formData.producto_global_id,
          );
          if (duplicateInMenu) {
            throw new Error(
              `Ese producto ya está en este menú (“${duplicateInMenu.name}”). Puede repetirse en otro menú (mesa / para llevar), pero no dos veces en el mismo.`,
            );
          }
        }

        const currentLegacyProductId = useGlobalPath
          ? formData.producto_global_id
          : formData.node_type === "product"
            ? (existingNode?.legacy_product_id?.trim() || (isTableScope ? id : null))
            : null;

        let savedMenuNode: { id: string; legacy_product_id?: string | null; price?: number | null; image_url?: string | null } | null = null;
        try {
          const { data, error: menuNodeError } = await supabase
            .from("menu_nodes" as any)
            .upsert({
              id,
              branch_id: activeBranchId,
              menu_scope: menuScope,
              parent_id: formData.parent_id,
              name,
              qr_name: formData.node_type === "product" ? (formData.qr_name.trim() || null) : null,
              node_type: formData.node_type,
              display_order: displayOrder,
              is_active: formData.is_active,
              icon: null,
              price,
              description: formData.description.trim() || null,
              image_url: imageUrlToPersist || null,
              manual_price_enabled: formData.node_type === "category" ? formData.manual_price_enabled : false,
              legacy_product_id:
                formData.node_type === "product"
                  ? currentLegacyProductId
                  : null,
              producto_global_id: useGlobalPath ? formData.producto_global_id : (existingNode?.producto_global_id ?? null),
            } as any)
            .select("id, legacy_product_id, price, image_url")
            .single();
          if (menuNodeError) throw menuNodeError;
          savedMenuNode = data as typeof savedMenuNode;
        } catch (menuSaveError) {
          // Si es alta nueva y falla (p.ej. trigger de legacy), no dejar basura parcial.
          if (isNewMenuNode) {
            await supabase.from("menu_nodes" as any).delete().eq("id", id);
          }
          throw menuSaveError;
        }

        if (formData.node_type === "category") {
          if (isTableScope || isBulkScope) {
            await ensureLegacyCategoryMirror(id, name, formData.parent_id, displayOrder > 0 ? displayOrder : 1, formData.is_active);
          }
        } else if (useGlobalPath) {
          // Catálogo global: el product ya existe (mismo id). Solo actualizar force_servir si aplica.
          const { error: productError } = await supabase
            .from("products")
            .update({
              force_servir_module: formData.force_servir_module,
              is_active: formData.is_active,
            })
            .eq("id", formData.producto_global_id!);
          if (productError) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw productError;
          }
          // Vínculo sucursal + inventario al colgar en el menú (no hace falta “asignar” antes).
          const { data: existingLink, error: existingLinkError } = await supabase
            .from("producto_sucursal" as any)
            .select("id, activo")
            .eq("sucursal_id", activeBranchId!)
            .eq("producto_global_id", formData.producto_global_id!)
            .maybeSingle();
          if (existingLinkError) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw existingLinkError;
          }
          if (!existingLink) {
            const { error: linkError } = await supabase.from("producto_sucursal" as any).insert({
              sucursal_id: activeBranchId,
              producto_global_id: formData.producto_global_id!,
              cantidad_disponible: 0,
              integra_con_ventas: false,
              activo: true,
            });
            if (linkError) {
              if (isNewMenuNode) {
                await supabase.from("menu_nodes" as any).delete().eq("id", id);
              }
              throw linkError;
            }
          } else if (!(existingLink as { activo?: boolean }).activo) {
            const { error: reactivateError } = await supabase
              .from("producto_sucursal" as any)
              .update({ activo: true })
              .eq("id", (existingLink as { id: string }).id);
            if (reactivateError) {
              if (isNewMenuNode) {
                await supabase.from("menu_nodes" as any).delete().eq("id", id);
              }
              throw reactivateError;
            }
          }
          if (savedMenuNode) {
            savedMenuNode.legacy_product_id = formData.producto_global_id;
          }
        } else {
          const nearestCategoryAncestorId = findNearestCategoryAncestorId(formData.parent_id);
          if (!nearestCategoryAncestorId) throw new Error("El producto debe colgar de una categoria valida.");

          const ancestorCategory = nodesById.get(nearestCategoryAncestorId);
          if (!ancestorCategory) throw new Error("No se pudo resolver la categoria ancestro del producto.");

          // Garantiza enlace válido (mesa exacta / equivalente / alta nueva). El trigger de BD también lo exige.
          const { data: syncedLegacyId, error: syncLegacyError } = await supabase.rpc(
            "sync_menu_node_to_legacy_product" as any,
            { p_menu_node_id: id },
          );
          if (syncLegacyError) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw new Error(
              syncLegacyError.message ||
                "No se pudo enlazar el producto con el catalogo operativo (products).",
            );
          }

          const legacyProductId = String(syncedLegacyId ?? savedMenuNode?.legacy_product_id ?? "").trim();
          if (!legacyProductId) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw new Error("El producto quedo sin enlace valido a products. No se guardo.");
          }

          const { data: existingLegacyProduct, error: existingLegacyProductError } = await supabase
            .from("products")
            .select("id, subcategory_id, display_order, description")
            .eq("id", legacyProductId)
            .maybeSingle();
          if (existingLegacyProductError) throw existingLegacyProductError;
          if (!existingLegacyProduct) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw new Error("El enlace legacy no apunta a un producto existente.");
          }

          let legacySubcategoryId: string | null = existingLegacyProduct.subcategory_id ?? null;

          if (!legacySubcategoryId) {
            if (isTableScope || isBulkScope) {
              legacySubcategoryId = await ensureLegacyCategoryMirror(
                ancestorCategory.id,
                ancestorCategory.name,
                ancestorCategory.parent_id,
                Number(ancestorCategory.display_order ?? 1) || 1,
                true,
              );
            } else {
              try {
                legacySubcategoryId = await resolveTableLegacySubcategoryId(ancestorCategory.id);
              } catch {
                legacySubcategoryId = await ensureLegacyCategoryMirror(
                  ancestorCategory.id,
                  ancestorCategory.name,
                  ancestorCategory.parent_id,
                  Number(ancestorCategory.display_order ?? 1) || 1,
                  true,
                );
              }
            }
          }

          if (!isTableScope && !isBulkScope && legacySubcategoryId) {
            const { data: tableCategoryNode, error: tableCategoryNodeError } = await supabase
              .from("menu_nodes" as any)
              .select("id, name, parent_id, display_order, is_active")
              .eq("id", legacySubcategoryId)
              .maybeSingle();
            if (tableCategoryNodeError) throw tableCategoryNodeError;
            if (tableCategoryNode) {
              legacySubcategoryId = await ensureLegacyCategoryMirror(
                tableCategoryNode.id,
                tableCategoryNode.name,
                tableCategoryNode.parent_id,
                Number(tableCategoryNode.display_order ?? 1) || 1,
                tableCategoryNode.is_active ?? true,
              );
            }
          }

          if (!legacySubcategoryId) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw new Error("No se pudo resolver la subcategoria operativa del producto.");
          }

          const { data: siblingProducts, error: siblingProductsError } = await supabase
            .from("products")
            .select("id, display_order")
            .eq("subcategory_id", legacySubcategoryId);
          if (siblingProductsError) throw siblingProductsError;

          const rows = (siblingProducts ?? []) as ProductRecord[];
          const existingProduct = rows.find((product) => product.id === legacyProductId) ?? null;
          const usedOrders = rows
            .filter((product) => product.id !== legacyProductId)
            .map((product) => Number(product.display_order) || 0);

          const productDisplayOrder = existingProduct
            ? nextAvailableOrder(usedOrders, Number(existingProduct.display_order) || displayOrder)
            : nextAvailableOrder(usedOrders, displayOrder > 0 ? displayOrder : 1);

          // En TAKEOUT, si el sync reutilizó el product de mesa, no pisar su descripción operativa.
          const productDescription =
            isTableScope || isBulkScope
              ? name
              : (existingLegacyProduct.description?.trim() || name);

          const { error: productError } = await supabase.from("products").upsert({
            id: legacyProductId,
            subcategory_id: legacySubcategoryId,
            description: productDescription,
            unit_price: price,
            price_mode: isBulkScope ? "MANUAL" : "FIXED",
            display_order: productDisplayOrder,
            is_active: formData.is_active,
            force_servir_module: formData.force_servir_module,
          });
          if (productError) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw productError;
          }

          const { error: syncLegacyRefError } = await supabase
            .from("menu_nodes" as any)
            .update({ legacy_product_id: legacyProductId } as any)
            .eq("id", id);
          if (syncLegacyRefError) {
            if (isNewMenuNode) {
              await supabase.from("menu_nodes" as any).delete().eq("id", id);
            }
            throw syncLegacyRefError;
          }

          if (savedMenuNode) {
            savedMenuNode.legacy_product_id = legacyProductId;
          }
        }

        const nextManagedImagePath = uploadedImagePath ?? extractManagedImagePath(imageUrlToPersist);
        if (previousManagedImagePath && previousManagedImagePath !== nextManagedImagePath) {
          const { error: removePreviousError } = await supabase.storage
            .from(MENU_NODE_IMAGE_BUCKET)
            .remove([previousManagedImagePath]);
          if (removePreviousError) {
            console.warn("No se pudo eliminar la imagen anterior del nodo", removePreviousError);
          }
        }

        return {
          ...(savedMenuNode as unknown as AdminMenuNode),
          name,
          qr_name: formData.node_type === "product" ? (formData.qr_name.trim() || null) : null,
          price: savedMenuNode?.price == null ? null : Number(savedMenuNode.price),
          image_url: normalizeImageUrl(savedMenuNode?.image_url),
        } satisfies AdminMenuNode;
      } catch (error) {
        if (uploadedImagePath) {
          const { error: rollbackError } = await supabase.storage
            .from(MENU_NODE_IMAGE_BUCKET)
            .remove([uploadedImagePath]);
          if (rollbackError) {
            console.warn("No se pudo limpiar la imagen recien subida tras un error", rollbackError);
          }
        }
        throw error;
      }
    },
    onSuccess: (savedNode) => {
      toast.success("Nodo guardado");
      if (savedNode && activeBranchId) {
        queryClient.setQueryData(["admin-menu-nodes", activeBranchId, menuScope], (current: AdminMenuNode[] | undefined) =>
          upsertMenuNodeInList(current ?? [], savedNode),
        );
        queryClient.setQueryData(["menu-tree", activeBranchId, menuScope, false], (current: MenuNode[] | undefined) =>
          upsertMenuNodeInList((current ?? []) as AdminMenuNode[], savedNode),
        );
      }
      invalidateMenuCatalogQueries(queryClient, activeBranchId);
      resetForm();
    },
    onError: (error: Error) => {
      const msg = error.message || "No se pudo guardar";
      toast.error(
        msg.includes("uq_menu_nodes_scope_producto_global")
          || msg.includes("uq_menu_nodes_parent_producto_global")
          ? "Ese producto ya está en este menú. No se puede repetir en el mismo menú."
          : msg,
      );
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (node: AdminMenuNode) => {
      const childrenCount = getChildren(node.id).length;
      const nextIsActive = !node.is_active;
      const message = nextIsActive
        ? "Se activara el nodo seleccionado."
        : node.node_type === "category" && childrenCount > 0
          ? "Esta categoria tiene hijos. Si la desactivas, su rama quedara inaccesible en la UI."
          : "Se desactivara el nodo seleccionado.";

      if (!window.confirm(message)) return false;

      const { error: menuNodeError } = await supabase
        .from("menu_nodes" as any)
        .update({ is_active: nextIsActive } as any)
        .eq("id", node.id);
      if (menuNodeError) throw menuNodeError;

      if (node.node_type === "product") {
        const legacyProductId = node.legacy_product_id ?? node.id;
        const { error: productError } = await supabase.from("products").update({ is_active: nextIsActive }).eq("id", legacyProductId);
        if (productError) throw productError;
      } else if (isTableScope) {
        if (node.parent_id === null) {
          const { error: categoryError } = await supabase.from("categories").update({ is_active: nextIsActive }).eq("id", node.id);
          if (categoryError) throw categoryError;
        }
        const { error: subcategoryError } = await supabase.from("subcategories").update({ is_active: nextIsActive }).eq("id", node.id);
        if (subcategoryError) throw subcategoryError;
      }

      return true;
    },
    onSuccess: (_didToggle, node) => {
      if (!_didToggle) return;
      toast.success(node.is_active ? "Nodo desactivado" : "Nodo activado");
      invalidateMenuCatalogQueries(queryClient, activeBranchId);
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async (node: AdminMenuNode) => {
      const childrenCount = getChildren(node.id).length;
      if (node.node_type === "category" && childrenCount > 0) {
        throw new Error("No puedes eliminar una categoria que tiene hijos. Elimina primero sus hijos.");
      }

      const confirmed = window.confirm(
        "¿Estas seguro de eliminar permanentemente este nodo? Esta accion solo funcionara si NO tiene historial de ventas."
      );
      if (!confirmed) return false;

      // 1. Delete from legacy tables first to fail fast if there is history
      if (node.node_type === "product") {
        // En catálogo global el product es compartido: no borrarlo al quitar un nodo de menú.
        if (!usaCatalogoGlobal) {
          const legacyProductId = node.legacy_product_id ?? node.id;
          const { error: productError } = await supabase.from("products").delete().eq("id", legacyProductId);
          if (productError) {
            if (productError.code === "23503") {
              throw new Error("No se puede eliminar: Este producto tiene historial de ventas. Desactivalo en su lugar.");
            }
            throw productError;
          }
        }
      } else if (isTableScope || menuScope === "BULK") {
        // Enforce legacy cleanup for table and bulk scopes
        
        // If it was a root category in legacy
        const { error: categoryError } = await supabase.from("categories").delete().eq("id", node.id);
        if (categoryError && categoryError.code !== "PGRST116" && categoryError.code !== "42703") {
          if (categoryError.code === "23503") throw new Error("No se puede eliminar: Esta categoria tiene productos con historial.");
          // ignore other errors like column not exists if it's not a root cat
        }
        
        // Also subcategories
        const { error: subcategoryError } = await supabase.from("subcategories").delete().eq("id", node.id);
        if (subcategoryError && subcategoryError.code !== "PGRST116") {
          if (subcategoryError.code === "23503") throw new Error("No se puede eliminar: Esta subcategoria tiene productos con historial.");
        }
      }

      // 2. Delete from menu_nodes
      const { error: menuNodeError } = await supabase
        .from("menu_nodes" as any)
        .delete()
        .eq("id", node.id);
      if (menuNodeError) throw menuNodeError;

      // 3. Delete image from storage
      const managedPath = extractManagedImagePath(node.image_url);
      if (managedPath) {
        try {
          await supabase.storage.from(MENU_NODE_IMAGE_BUCKET).remove([managedPath]);
        } catch (storageErr) {
          console.warn("No se pudo eliminar la imagen de storage tras eliminar el nodo", storageErr);
        }
      }

      return true;
    },
    onSuccess: (didDelete) => {
      if (!didDelete) return;
      toast.success("Nodo eliminado permanentemente");
      invalidateMenuCatalogQueries(queryClient, activeBranchId);
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyFromTableMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa");

      const confirmed = window.confirm(
        "Se reemplazara completamente el arbol Para Llevar actual con una copia del arbol Mesa. Esta accion no afecta ordenes historicas.",
      );
      if (!confirmed) return false;

      const { error } = await supabase.rpc("copy_menu_scope_tree", {
        p_branch_id: activeBranchId,
        p_source_scope: "TABLE",
        p_target_scope: "TAKEOUT",
      });
      if (error) throw error;

      return true;
    },
    onSuccess: (didCopy) => {
      if (!didCopy) return;
      toast.success("Arbol Para Llevar copiado desde Arbol Menu Mesa");
      invalidateMenuCatalogQueries(queryClient, activeBranchId);
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleCollapsed = (nodeId: string) => {
    setCollapsedIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]));
  };

  const handleImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    try {
      validateImageFile(file);
      setSelectedImageFile(file);
      setRemoveImage(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la imagen seleccionada.");
      event.target.value = "";
      return;
    }

    event.target.value = "";
  };

  const clearSelectedUpload = () => {
    setSelectedImageFile(null);
  };

  const clearCurrentImage = () => {
    setSelectedImageFile(null);
    setRemoveImage(true);
    setForm((prev) => ({ ...prev, image_url: "" }));
  };

  const renderTree = (parentId: string | null = null, depth = 0): ReactNode => {
    const branch = getChildren(parentId);
    if (branch.length === 0) return null;

    return branch.map((node) => {
      const hasChildren = getChildren(node.id).length > 0;
      const collapsed = collapsedIds.includes(node.id);

      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => startEdit(node)}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60",
              selectedId === node.id && "bg-primary/10 text-primary",
            )}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
          >
            <span className="flex h-5 w-5 items-center justify-center text-muted-foreground">
              {hasChildren ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleCollapsed(node.id);
                  }}
                >
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </span>
              ) : (
                <FolderTree className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {node.image_url ? (
                  <img src={node.image_url} alt={node.name} className="h-6 w-6 rounded-lg object-cover" />
                ) : node.icon ? (
                  <span className="text-sm leading-none">{node.icon}</span>
                ) : null}
                <span className="truncate font-medium">{node.name}</span>
                <Badge
                  variant={node.node_type === "product" ? "secondary" : "default"}
                  className={cn(
                    "text-[10px] uppercase",
                    node.node_type === "product" && "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
                  )}
                >
                  {node.node_type === "product" ? "Producto" : "Categoria"}
                </Badge>
                {node.node_type === "product" && typeof node.price === "number" ? (
                  <span className="text-xs font-semibold text-emerald-700">${node.price.toFixed(2)}</span>
                ) : null}
                {!node.is_active ? <Badge variant="outline" className="text-[10px]">Inactivo</Badge> : null}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Nivel {node.depth + 1} | Orden {node.display_order}
              </div>
            </div>
          </button>
          {hasChildren && !collapsed ? renderTree(node.id, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)] xl:grid-cols-[minmax(0,0.96fr)_minmax(480px,1fr)]">
      <div className="rounded-3xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold">{title}</h2>
            <p className="text-xs text-muted-foreground">Vista colapsable de la jerarquia completa de menu_nodes.</p>
          </div>
          <div className="flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:justify-end">
            {showCopyFromTableButton ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                onClick={() => copyFromTableMutation.mutate()}
                disabled={copyFromTableMutation.isPending}
              >
                <FolderTree className="mr-1.5 h-4 w-4" />
                Copiar desde Mesa
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => resetForm(null)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva raiz
            </Button>
            <Button
              size="sm"
              className="rounded-xl"
              onClick={() => {
                setSelectedId(null);
                setSelectedImageFile(null);
                setRemoveImage(false);
                const nextParentId = selectedNode?.node_type === "category" ? selectedNode.id : null;
                setForm(emptyForm(nextParentId, getSuggestedDisplayOrder(nextParentId, "category")));
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Nuevo hijo
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          {query.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Cargando nodos...</div>
          ) : nodes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Todavia no hay nodos cargados.</div>
          ) : (
            renderTree()
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold">Editor de nodo</h2>
            <p className="text-xs text-muted-foreground">Crear, editar y desactivar sin borrar historico.</p>
          </div>
          {selectedNode ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "rounded-xl",
                  selectedNode.is_active ? "text-destructive" : "text-emerald-700",
                )}
                onClick={() => toggleActiveMutation.mutate(selectedNode)}
                disabled={toggleActiveMutation.isPending}
              >
                <Power className="mr-1.5 h-4 w-4" />
                {selectedNode.is_active ? "Desactivar" : "Activar"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-destructive hover:bg-destructive/10"
                onClick={() => hardDeleteMutation.mutate(selectedNode)}
                disabled={hardDeleteMutation.isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Borrar fisico
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="rounded-xl" />
              </div>

              {form.node_type === "product" && usaCatalogoGlobal ? (
                <div className="space-y-1.5">
                  <Label>Producto del catálogo</Label>
                  <Select
                    value={form.producto_global_id ?? ""}
                    onValueChange={(value) => {
                      const producto = productosParaMenuById.get(value);
                      setForm((prev) => ({
                        ...prev,
                        producto_global_id: value,
                        name: producto?.nombre_principal || prev.name,
                        qr_name: producto?.nombre_qr_default || prev.qr_name,
                        price:
                          producto?.precio_default != null
                            ? String(producto.precio_default)
                            : prev.price,
                        description: producto?.descripcion_default || prev.description,
                        image_url: normalizeImageUrl(producto?.imagen_default_url) || prev.image_url,
                        force_servir_module: Boolean(producto?.force_servir_default),
                      }));
                      setRemoveImage(false);
                      setSelectedImageFile(null);
                    }}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Selecciona producto del catálogo" />
                    </SelectTrigger>
                    <SelectContent>
                      {productosParaMenu
                        .filter((p) => !productosYaEnEsteMenu.has(p.id) || p.id === form.producto_global_id)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nombre_principal}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Solo productos del catálogo que aún no están en este menú. Un producto puede repetirse en otro menú (mesa / para llevar).
                  </p>
                </div>
              ) : null}

              {form.node_type === "product" ? (
                <div className="space-y-1.5">
                  <Label>Nombre QR</Label>
                  <Input
                    value={form.qr_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, qr_name: event.target.value }))}
                    placeholder="Nombre que verá el cliente en el menú QR"
                    className="rounded-xl"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Si lo dejas vacío, el menú QR muestra el nombre interno.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={form.node_type}
                    onValueChange={(value: "category" | "product") =>
                      setForm((prev) => {
                        if (prev.id) {
                          return {
                            ...prev,
                            node_type: value,
                            price: value === "product" ? prev.price : "",
                            qr_name: value === "product" ? prev.qr_name : "",
                          };
                        }

                        return {
                          ...prev,
                          node_type: value,
                          price: value === "product" ? prev.price : "",
                          qr_name: value === "product" ? prev.qr_name : "",
                          display_order: getSuggestedDisplayOrder(prev.parent_id, value),
                        };
                      })
                    }
                  >
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="category">Categoria</SelectItem>
                      <SelectItem value="product">Producto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Padre</Label>
                  <Select
                    value={form.parent_id ?? "ROOT"}
                    onValueChange={(value) =>
                      setForm((prev) => {
                        const nextParentId = value === "ROOT" ? null : value;
                        if (prev.id) {
                          return { ...prev, parent_id: nextParentId };
                        }

                        return {
                          ...prev,
                          parent_id: nextParentId,
                          display_order: getSuggestedDisplayOrder(nextParentId, prev.node_type),
                        };
                      })
                    }
                  >
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent className="border-orange-200 bg-white">
                      <SelectItem value="ROOT">Sin padre (raiz)</SelectItem>
                      {parentOptions.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {renderParentOptionLabel(node)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Orden</Label>
                  <Input
                    value={form.display_order}
                    onChange={(event) => {
                      const nextOrder = sanitizeIntegerInput(event.target.value);
                      setForm((prev) => ({ ...prev, display_order: nextOrder }));
                    }}
                    className="rounded-xl"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                </div>
                {isBulkScope && form.node_type === "product" ? (
                  <div className="space-y-1.5">
                    <Label>Precio</Label>
                    <div className="rounded-xl border border-dashed border-orange-200 bg-orange-50/60 px-3 py-2.5 text-sm text-muted-foreground">
                      En A Granel el precio se ingresa manualmente al generar la orden.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Precio</Label>
                    <Input
                      value={form.price}
                      onChange={(event) => {
                        const nextPrice = sanitizeDecimalInput(event.target.value);
                        setForm((prev) => ({ ...prev, price: nextPrice }));
                      }}
                      className="rounded-xl"
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      disabled={form.node_type === "category"}
                      placeholder={form.node_type === "product" ? "0.00" : "Solo para productos"}
                    />
                  </div>
                )}
              </div>

              {form.node_type === "product" && (
                <div className="flex items-center gap-2 rounded-xl border border-orange-100 bg-orange-50/20 p-3">
                  <input
                    type="checkbox"
                    id="force_servir_module"
                    checked={form.force_servir_module}
                    disabled={formLoading}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setForm((prev) => ({ ...prev, force_servir_module: val }));
                    }}
                    className="h-4 w-4 rounded border-orange-200 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                  <Label htmlFor="force_servir_module" className="cursor-pointer font-semibold text-slate-800">
                    Despachar este producto por el Módulo Servir (e.g. platos/mesa)
                  </Label>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Descripcion</Label>
                <Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="min-h-28 rounded-2xl" />
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
              <div className="space-y-1.5">
                <Label>Imagen</Label>
                <input
                  id="menu-node-image-input"
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={handleImageFileChange}
                  className="sr-only"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="menu-node-image-input"
                    className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                  >
                    Seleccionar imagen
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {selectedImageFile ? selectedImageFile.name : "Ningun archivo seleccionado"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="rounded-xl" onClick={clearSelectedUpload} disabled={!selectedImageFile}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Quitar archivo nuevo
                </Button>
                <Button type="button" variant="outline" className="rounded-xl" onClick={clearCurrentImage} disabled={!hasCurrentImage}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Quitar imagen actual
                </Button>
              </div>

              <div className="grid gap-3 pt-2 sm:grid-cols-1">
                <div className="rounded-2xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  Por defecto usa la imagen del producto global. Podés reemplazarla subiendo un archivo (JPG, PNG, WEBP o GIF hasta 2 MB).
                  {hasCurrentImage ? (
                    <div className="mt-2 text-foreground">Este nodo ya tiene una imagen.</div>
                  ) : null}
                  {selectedImageFile ? (
                    <div className="mt-2 text-foreground">Archivo nuevo: {selectedImageFile.name}</div>
                  ) : null}
                </div>
                <div className="flex h-36 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="Vista previa del nodo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                      <ImageUp className="h-5 w-5" />
                      <span>Sin imagen</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {selectedNode ? (
            <div className="space-y-3 border-t border-border pt-4">
              {isBulkScope && selectedNode.node_type === "product" ? (
                <div>
                  <h3 className="font-display text-sm font-semibold">Producto incluido</h3>
                  <p className="text-xs text-muted-foreground">
                    Configura productos adicionales a entregar para este producto de A Granel segun rangos de monto.
                  </p>
                  <div className="mt-3">
                    <BulkIncludedProductsPanel nodeId={selectedNode.id} />
                  </div>
                </div>
              ) : null}

              <div>
                <h3 className="font-display text-sm font-semibold">Modificadores del nodo</h3>
                <p className="text-xs text-muted-foreground">
                  Gestiona aqui los modificadores propios y revisa los heredados desde ancestros sin salir del arbol.
                </p>
              </div>
              <NodeModifiersPanel nodeId={selectedNode.id} nodeType={selectedNode.node_type} />
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              className="flex-1 rounded-xl"
              onClick={() => {
                saveMutation.mutate(form);
              }}
              disabled={saveMutation.isPending || formLoading}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Guardar nodo
            </Button>
            <Button variant="outline" className="rounded-xl gap-1.5" onClick={() => resetForm(selectedNode?.parent_id ?? null)}>
              <Eraser className="h-4 w-4" />
              Limpiar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuNodesCrud;

