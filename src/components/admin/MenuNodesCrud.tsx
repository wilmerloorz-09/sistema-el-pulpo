import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderTree, Plus, Power, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { generateUUID } from "@/lib/uuid";
import type { MenuNode } from "@/hooks/useMenuTree";

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
  display_order: number | null;
}

interface FormState {
  id: string | null;
  name: string;
  node_type: "category" | "product";
  parent_id: string | null;
  icon: string;
  price: string;
  display_order: string;
  description: string;
  image_url: string;
  is_active: boolean;
}

const SUGGESTED_ICONS = [
  "🍤", "🦐", "🦑", "🐙", "🐟", "🍲", "🍛", "🥩", "🍗", "🍔", "🍟", "🥗",
  "🍚", "🍜", "🍝", "🍕", "🌮", "🥪", "🥤", "☕", "🍺", "🍰", "🔥", "⭐",
];

const emptyForm = (parentId: string | null = null): FormState => ({
  id: null,
  name: "",
  node_type: "category",
  parent_id: parentId,
  icon: "",
  price: "",
  display_order: "0",
  description: "",
  image_url: "",
  is_active: true,
});

const sortedNumbers = (values: number[]) => values.filter((value) => value > 0).sort((a, b) => a - b);

const nextAvailableOrder = (usedOrders: number[], preferred: number) => {
  const normalized = sortedNumbers(usedOrders);
  if (preferred > 0 && !normalized.includes(preferred)) return preferred;
  return (normalized.length > 0 ? normalized[normalized.length - 1] : 0) + 1;
};

const MenuNodesCrud = () => {
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());

  const query = useQuery({
    queryKey: ["admin-menu-nodes", activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_nodes" as never)
        .select("*")
        .eq("branch_id", activeBranchId!)
        .order("depth", { ascending: true })
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AdminMenuNode[];
    },
    enabled: !!activeBranchId,
  });

  const nodes = query.data ?? [];
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

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

  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;
  const selectedDescendants = selectedNode ? getDescendantIds(selectedNode.id) : new Set<string>();

  const parentOptions = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.node_type === "category" &&
          node.id !== form.id &&
          !selectedDescendants.has(node.id),
      ),
    [form.id, nodes, selectedDescendants],
  );

  const resetForm = (nextParentId: string | null = null) => {
    setSelectedId(null);
    setForm(emptyForm(nextParentId));
  };

  const startEdit = (node: AdminMenuNode) => {
    setSelectedId(node.id);
    setForm({
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      parent_id: node.parent_id,
      icon: node.icon ?? "",
      price: node.price == null ? "" : String(node.price),
      display_order: String(node.display_order ?? 0),
      description: node.description ?? "",
      image_url: node.image_url ?? "",
      is_active: node.is_active,
    });
  };

  const ensureLegacyCategoryMirror = async (
    categoryNodeId: string,
    categoryName: string,
    parentId: string | null,
    preferredDisplayOrder: number,
    isActive: boolean,
  ) => {
    if (!activeBranchId) throw new Error("No se pudo resolver la categoria operativa legacy.");

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa");

      const id = form.id ?? generateUUID();
      const name = form.name.trim();
      if (!name) throw new Error("El nombre es obligatorio");

      const displayOrder = Number.parseInt(form.display_order, 10);
      if (Number.isNaN(displayOrder)) throw new Error("El orden debe ser numerico");

      if (form.parent_id) {
        const parent = nodesById.get(form.parent_id);
        if (!parent) throw new Error("El nodo padre ya no existe");
        if (parent.node_type !== "category") throw new Error("Solo una categoria puede tener hijos");
      }

      let price: number | null = null;
      if (form.node_type === "product") {
        if (!form.parent_id) throw new Error("El producto debe crearse desde el nivel 2 en adelante.");
        price = Number.parseFloat(form.price);
        if (!Number.isFinite(price) || price < 0) throw new Error("El producto requiere un precio valido");
      }

      if (form.id) {
        const children = getChildren(form.id);
        if (form.node_type === "product" && children.length > 0) {
          throw new Error("No puedes convertir en producto un nodo que ya tiene hijos");
        }
      }

      const { error: menuNodeError } = await supabase.from("menu_nodes" as never).upsert({
        id,
        branch_id: activeBranchId,
        parent_id: form.parent_id,
        name,
        node_type: form.node_type,
        display_order: displayOrder,
        is_active: form.is_active,
        icon: form.icon.trim() || null,
        price,
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
      } as never);
      if (menuNodeError) throw menuNodeError;

      if (form.node_type === "category") {
        await ensureLegacyCategoryMirror(id, name, form.parent_id, displayOrder > 0 ? displayOrder : 1, form.is_active);
        return;
      }

      const nearestCategoryAncestorId = findNearestCategoryAncestorId(form.parent_id);
      if (!nearestCategoryAncestorId) throw new Error("El producto debe colgar de una categoria valida.");

      const ancestorCategory = nodesById.get(nearestCategoryAncestorId);
      if (!ancestorCategory) throw new Error("No se pudo resolver la categoria ancestro del producto.");

      const legacySubcategoryId = await ensureLegacyCategoryMirror(
        ancestorCategory.id,
        ancestorCategory.name,
        ancestorCategory.parent_id,
        Number(ancestorCategory.display_order ?? 1) || 1,
        true,
      );

      const { data: siblingProducts, error: siblingProductsError } = await supabase
        .from("products")
        .select("id, display_order")
        .eq("subcategory_id", legacySubcategoryId);
      if (siblingProductsError) throw siblingProductsError;

      const rows = (siblingProducts ?? []) as ProductRecord[];
      const existingProduct = rows.find((product) => product.id === id) ?? null;
      const usedOrders = rows
        .filter((product) => product.id !== id)
        .map((product) => Number(product.display_order) || 0);

      const productDisplayOrder = existingProduct
        ? nextAvailableOrder(usedOrders, Number(existingProduct.display_order) || displayOrder)
        : nextAvailableOrder(usedOrders, displayOrder > 0 ? displayOrder : 1);

      const { error: productError } = await supabase.from("products").upsert({
        id,
        subcategory_id: legacySubcategoryId,
        description: name,
        unit_price: price,
        price_mode: "FIXED",
        display_order: productDisplayOrder,
        is_active: form.is_active,
      });
      if (productError) throw productError;
    },
    onSuccess: () => {
      toast.success("Nodo guardado");
      queryClient.invalidateQueries({ queryKey: ["admin-menu-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["menu-tree"] });
      queryClient.invalidateQueries({ queryKey: ["menu-products"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menu-subcategories"] });
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (node: AdminMenuNode) => {
      const childrenCount = getChildren(node.id).length;
      const message = node.node_type === "category" && childrenCount > 0
        ? "Esta categoria tiene hijos. Si la desactivas, su rama quedara inaccesible en la UI."
        : "Se desactivara el nodo seleccionado.";

      if (!window.confirm(message)) return false;

      const { error: menuNodeError } = await supabase
        .from("menu_nodes" as never)
        .update({ is_active: false } as never)
        .eq("id", node.id);
      if (menuNodeError) throw menuNodeError;

      if (node.node_type === "product") {
        const { error: productError } = await supabase.from("products").update({ is_active: false }).eq("id", node.id);
        if (productError) throw productError;
      } else {
        if (node.parent_id === null) {
          const { error: categoryError } = await supabase.from("categories").update({ is_active: false }).eq("id", node.id);
          if (categoryError) throw categoryError;
        }
        const { error: subcategoryError } = await supabase.from("subcategories").update({ is_active: false }).eq("id", node.id);
        if (subcategoryError) throw subcategoryError;
      }

      return true;
    },
    onSuccess: (didDeactivate) => {
      if (!didDeactivate) return;
      toast.success("Nodo desactivado");
      queryClient.invalidateQueries({ queryKey: ["admin-menu-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["menu-tree"] });
      queryClient.invalidateQueries({ queryKey: ["menu-products"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menu-subcategories"] });
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleCollapsed = (nodeId: string) => {
    setCollapsedIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]));
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
                {node.icon ? <span className="text-sm leading-none">{node.icon}</span> : null}
                <span className="truncate font-medium">{node.name}</span>
                <Badge variant={node.node_type === "product" ? "secondary" : "default"} className="text-[10px] uppercase">
                  {node.node_type === "product" ? "Producto" : "Categoria"}
                </Badge>
                {!node.is_active ? <Badge variant="outline" className="text-[10px]">Inactivo</Badge> : null}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Nivel {node.depth + 1} · Orden {node.display_order}
              </div>
            </div>
          </button>
          {hasChildren && !collapsed ? renderTree(node.id, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_380px]">
      <div className="rounded-3xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">Arbol de menu</h2>
            <p className="text-xs text-muted-foreground">Vista colapsable de la jerarquia completa de menu_nodes.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => resetForm(null)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva raiz
            </Button>
            <Button
              size="sm"
              className="rounded-xl"
              onClick={() => {
                setSelectedId(null);
                setForm(emptyForm(selectedNode?.node_type === "category" ? selectedNode.id : null));
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
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">Editor de nodo</h2>
            <p className="text-xs text-muted-foreground">Crear, editar y desactivar sin borrar historico.</p>
          </div>
          {selectedNode ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-destructive"
              onClick={() => deactivateMutation.mutate(selectedNode)}
              disabled={deactivateMutation.isPending}
            >
              <Power className="mr-1.5 h-4 w-4" />
              Desactivar
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="rounded-xl" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.node_type} onValueChange={(value: "category" | "product") => setForm((prev) => ({ ...prev, node_type: value, price: value === "product" ? prev.price : "" }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Categoria</SelectItem>
                  <SelectItem value="product">Producto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Padre</Label>
              <Select value={form.parent_id ?? "ROOT"} onValueChange={(value) => setForm((prev) => ({ ...prev, parent_id: value === "ROOT" ? null : value }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROOT">Sin padre (raiz)</SelectItem>
                  {parentOptions.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {"  ".repeat(node.depth)}{node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label>Icono</Label>
              <Input
                value={form.icon}
                onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))}
                className="rounded-xl"
                placeholder="Pega cualquier emoji o usa las sugerencias"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, icon }))}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl border text-lg transition-colors",
                    form.icon === icon
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:border-primary/40 hover:bg-muted/60",
                  )}
                  title={`Usar ${icon}`}
                >
                  {icon}
                </button>
              ))}
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => setForm((prev) => ({ ...prev, icon: "" }))}
              >
                Limpiar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Puedes elegir uno sugerido o pegar cualquier otro emoji manualmente en el campo.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input value={form.display_order} onChange={(event) => setForm((prev) => ({ ...prev, display_order: event.target.value }))} className="rounded-xl" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>Imagen URL</Label>
              <Input value={form.image_url} onChange={(event) => setForm((prev) => ({ ...prev, image_url: event.target.value }))} className="rounded-xl" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Precio</Label>
              <Input
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                className="rounded-xl"
                inputMode="decimal"
                disabled={form.node_type === "category"}
                placeholder={form.node_type === "product" ? "0.00" : "Solo para productos"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vista previa</Label>
              <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
                <span className="text-lg leading-none">{form.icon || "◌"}</span>
                <span>{form.icon ? "Icono seleccionado" : "Sin icono"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-muted/40 p-3 text-xs text-muted-foreground">
            El nivel 1 es el unico obligatorio para navegar y los productos pueden colgar desde el nivel 2 en adelante. El arbol sincroniza automaticamente la estructura legacy necesaria para que esos productos puedan venderse en ordenes.
          </div>

          <div className="space-y-1.5">
            <Label>Descripcion</Label>
            <Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="min-h-24 rounded-2xl" />
          </div>

          <div className="rounded-2xl bg-muted/40 p-3 text-xs text-muted-foreground">
            Los nodos de tipo producto no pueden tener hijos. Si desactivas una categoria, su rama completa quedara fuera de la navegacion operativa.
          </div>

          <div className="flex gap-2">
            <Button className="flex-1 rounded-xl" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="mr-1.5 h-4 w-4" />
              Guardar nodo
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => resetForm(selectedNode?.parent_id ?? null)}>
              Limpiar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuNodesCrud;
