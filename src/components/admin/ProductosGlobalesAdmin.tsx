import { useEffect, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { canManage } from "@/lib/permissions";
import { generateUUID } from "@/lib/uuid";
import type { TipoProducto } from "@/lib/inventarioProductos";

const PRODUCTO_GLOBAL_IMAGE_BUCKET = "menu-node-images";
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

type CategoriaProductoGlobal = "PLATOS" | "BEBIDAS" | "VARIOS";

const CATEGORIA_OPTIONS: { value: CategoriaProductoGlobal; label: string }[] = [
  { value: "PLATOS", label: "Platos" },
  { value: "BEBIDAS", label: "Bebidas" },
  { value: "VARIOS", label: "Varios" },
];

type ProductoGlobal = {
  id: string;
  nombre_principal: string;
  nombre_qr_default: string | null;
  precio_default: number;
  price_mode: "FIXED" | "MANUAL";
  descripcion_default: string | null;
  imagen_default_url: string | null;
  categoria: CategoriaProductoGlobal;
  tipo_producto: TipoProducto;
  force_servir_default: boolean;
  codigo: string | null;
  activo: boolean;
};

const emptyGlobal = (): Omit<ProductoGlobal, "id"> & { id?: string } => ({
  nombre_principal: "",
  nombre_qr_default: "",
  precio_default: 0,
  price_mode: "FIXED",
  descripcion_default: "",
  imagen_default_url: "",
  categoria: "PLATOS",
  tipo_producto: "COMPRADO",
  force_servir_default: false,
  codigo: "",
  activo: true,
});

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

const buildProductoGlobalImagePath = (productId: string, file: File) => {
  const extension = getFileExtension(file);
  return `global-products/${productId}/${Date.now()}-${generateUUID()}.${extension}`;
};

const extractManagedImagePath = (imageUrl: string | null | undefined) => {
  const normalized = normalizeImageUrl(imageUrl);
  const marker = `/storage/v1/object/public/${PRODUCTO_GLOBAL_IMAGE_BUCKET}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;
  return decodeURIComponent(normalized.slice(markerIndex + marker.length));
};

const getPublicImageUrl = (path: string) =>
  supabase.storage.from(PRODUCTO_GLOBAL_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

const ProductosGlobalesAdmin = () => {
  const qc = useQueryClient();
  const { activeBranch, isGlobalAdmin, permissions } = useBranch();
  const usaCatalogoGlobal = Boolean(activeBranch?.usa_catalogo_global);
  const canEditGlobal = isGlobalAdmin || canManage(permissions, "admin_global");

  const [form, setForm] = useState(emptyGlobal());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedImageFile) {
      setLocalPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedImageFile);
    setLocalPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImageFile]);

  const imagePreviewUrl = localPreviewUrl ?? (removeImage ? "" : normalizeImageUrl(form.imagen_default_url));
  const hasCurrentImage = Boolean(normalizeImageUrl(form.imagen_default_url)) && !removeImage;

  const { data: globales = [], isLoading } = useQuery({
    queryKey: ["productos-globales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("productos_globales" as any)
        .select(
          "id, nombre_principal, nombre_qr_default, precio_default, price_mode, descripcion_default, imagen_default_url, categoria, tipo_producto, force_servir_default, codigo, activo",
        )
        .order("categoria")
        .order("nombre_principal");
      if (error) throw error;
      return (data ?? []) as ProductoGlobal[];
    },
  });

  const resetImageState = () => {
    setSelectedImageFile(null);
    setRemoveImage(false);
    setLocalPreviewUrl(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyGlobal());
    resetImageState();
  };

  const saveGlobalMutation = useMutation({
    mutationFn: async () => {
      if (!canEditGlobal) throw new Error("Sin permiso para editar el catálogo global");
      const nombre = form.nombre_principal.trim();
      if (!nombre) throw new Error("El nombre principal es obligatorio");
      if (
        globales.some(
          (row) => row.id !== editingId && row.nombre_principal.trim().toLowerCase() === nombre.toLowerCase(),
        )
      ) {
        throw new Error("Ya existe un producto global con ese nombre principal.");
      }
      const precio = Number(form.precio_default);
      if (!Number.isFinite(precio) || precio < 0) throw new Error("Precio default inválido");

      if (!form.categoria) throw new Error("La categoría es obligatoria");

      const id = editingId ?? generateUUID();
      const previousImageUrl = normalizeImageUrl(editingId ? form.imagen_default_url : "");
      const previousManagedPath = extractManagedImagePath(previousImageUrl);
      let uploadedImagePath: string | null = null;
      let imageUrlToPersist = removeImage ? "" : previousImageUrl;

      if (!editingId && !selectedImageFile) {
        throw new Error("La imagen del producto es obligatoria");
      }
      if (editingId && removeImage && !selectedImageFile) {
        throw new Error("La imagen del producto es obligatoria");
      }

      try {
        if (selectedImageFile) {
          validateImageFile(selectedImageFile);
          uploadedImagePath = buildProductoGlobalImagePath(id, selectedImageFile);
          const { error: uploadError } = await supabase.storage
            .from(PRODUCTO_GLOBAL_IMAGE_BUCKET)
            .upload(uploadedImagePath, selectedImageFile, {
              cacheControl: "3600",
              upsert: false,
              contentType: selectedImageFile.type,
            });
          if (uploadError) throw uploadError;
          imageUrlToPersist = getPublicImageUrl(uploadedImagePath);
        }

        if (!normalizeImageUrl(imageUrlToPersist)) {
          throw new Error("La imagen del producto es obligatoria");
        }

        const { error } = await supabase.from("productos_globales" as any).upsert({
          id,
          nombre_principal: nombre,
          nombre_qr_default: form.nombre_qr_default?.trim() || null,
          precio_default: precio,
          price_mode: form.price_mode,
          descripcion_default: form.descripcion_default?.trim() || null,
          imagen_default_url: imageUrlToPersist,
          categoria: form.categoria,
          tipo_producto: form.tipo_producto,
          force_servir_default: Boolean(form.force_servir_default),
          codigo: form.codigo?.trim() || null,
          activo: Boolean(form.activo),
        });
        if (error) throw error;

        if (previousManagedPath && (removeImage || uploadedImagePath) && previousManagedPath !== uploadedImagePath) {
          const { error: removeStorageError } = await supabase.storage
            .from(PRODUCTO_GLOBAL_IMAGE_BUCKET)
            .remove([previousManagedPath]);
          if (removeStorageError) {
            console.warn("No se pudo eliminar la imagen anterior del producto global", removeStorageError);
          }
        }
      } catch (error) {
        if (uploadedImagePath) {
          await supabase.storage.from(PRODUCTO_GLOBAL_IMAGE_BUCKET).remove([uploadedImagePath]);
        }
        throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["productos-globales"] });
      void qc.invalidateQueries({ queryKey: ["productos-globales-menu"] });
      resetForm();
      toast.success("Producto global guardado");
    },
    onError: (e: Error & { code?: string; details?: string }) => {
      const msg = e.message || "No se pudo guardar";
      toast.error(
        msg.includes("row-level security") || msg.includes("security policy") || msg.toLowerCase().includes("storage")
          ? "No se pudo subir la imagen (permisos de almacenamiento). Recarga e intenta de nuevo."
          : msg.includes("display_order") || msg.includes("uq_products")
            ? "No se pudo crear el producto (conflicto de orden interno). Recarga e intenta de nuevo."
            : msg.includes("productos_globales_nombre_principal") || msg.includes("Ya existe un producto")
              ? "Ya existe un producto con ese nombre principal."
              : msg.includes("La imagen del producto es obligatoria")
                ? "Selecciona una imagen antes de crear el producto."
                : msg,
        { description: e.details || undefined, duration: 6000 },
      );
    },
  });

  const hasImageForSave = Boolean(selectedImageFile) || hasCurrentImage;
  const nombreNormalizado = form.nombre_principal.trim().toLowerCase();
  const nombreDuplicado = Boolean(
    nombreNormalizado
    && globales.some(
      (row) => row.id !== editingId && row.nombre_principal.trim().toLowerCase() === nombreNormalizado,
    ),
  );
  const canSubmitForm =
    Boolean(form.nombre_principal.trim())
    && Boolean(form.categoria)
    && hasImageForSave
    && !nombreDuplicado
    && !saveGlobalMutation.isPending;

  const handleImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    try {
      validateImageFile(file);
      setSelectedImageFile(file);
      setRemoveImage(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo usar la imagen seleccionada");
    }
  };

  const clearSelectedUpload = () => {
    setSelectedImageFile(null);
  };

  const clearCurrentImage = () => {
    setSelectedImageFile(null);
    setRemoveImage(true);
    setForm((p) => ({ ...p, imagen_default_url: "" }));
  };

  const startEdit = (row: ProductoGlobal) => {
    setEditingId(row.id);
    setForm({
      ...row,
      categoria: row.categoria || "PLATOS",
      nombre_qr_default: row.nombre_qr_default ?? "",
      descripcion_default: row.descripcion_default ?? "",
      imagen_default_url: row.imagen_default_url ?? "",
      codigo: row.codigo ?? "",
    });
    resetImageState();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Package className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Productos generales</h3>
            <p className="text-xs text-muted-foreground">
              Catálogo único del sistema: creá el producto una sola vez. En sucursales con catálogo global
              (piloto: El Pulpo 4) lo colgás desde el árbol de menú; el vínculo con la sucursal se crea al usarlo ahí.
            </p>
            {!usaCatalogoGlobal ? (
              <p className="text-xs font-medium text-amber-700">
                La sucursal activa ({activeBranch?.name ?? "—"}) no tiene catálogo global. Puedes crear productos
                globales; el uso en menú aplica en El Pulpo 4 (Prueba).
              </p>
            ) : (
              <p className="text-xs text-emerald-700">
                Sucursal activa con catálogo global: {activeBranch?.name}
              </p>
            )}
          </div>
        </div>
      </div>

      {canEditGlobal ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{editingId ? "Editar producto" : "Nuevo producto global"}</h4>
            {editingId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetForm}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nombre principal</Label>
              <Input
                value={form.nombre_principal}
                onChange={(e) => setForm((p) => ({ ...p, nombre_principal: e.target.value }))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nombre QR default</Label>
              <Input
                value={form.nombre_qr_default ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, nombre_qr_default: e.target.value }))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precio default</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.precio_default}
                onChange={(e) => setForm((p) => ({ ...p, precio_default: Number(e.target.value) }))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select
                value={form.categoria}
                onValueChange={(v) => setForm((p) => ({ ...p, categoria: v as CategoriaProductoGlobal }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIA_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.tipo_producto}
                onValueChange={(v) => setForm((p) => ({ ...p, tipo_producto: v as TipoProducto }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPRADO">Comprado</SelectItem>
                  <SelectItem value="PREPARADO">Preparado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Descripción default</Label>
              <Input
                value={form.descripcion_default ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, descripcion_default: e.target.value }))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3 md:col-span-2">
              <div className="space-y-1.5">
                <Label>Imagen default *</Label>
                <input
                  id="producto-global-image-input"
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={handleImageFileChange}
                  className="sr-only"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="producto-global-image-input"
                    className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                  >
                    Seleccionar imagen
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {selectedImageFile ? selectedImageFile.name : "Ningún archivo seleccionado"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={clearSelectedUpload}
                  disabled={!selectedImageFile}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Quitar archivo nuevo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={clearCurrentImage}
                  disabled={!hasCurrentImage}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Quitar imagen actual
                </Button>
              </div>
              <div className="grid gap-3 pt-2 sm:grid-cols-[1fr_9rem]">
                <div className="rounded-2xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  Obligatoria. Se usa como imagen por defecto al colgar el producto en el menú. JPG, PNG, WEBP o GIF hasta 2 MB.
                  {hasCurrentImage ? (
                    <div className="mt-2 text-foreground">Este producto ya tiene una imagen guardada.</div>
                  ) : null}
                  {selectedImageFile ? (
                    <div className="mt-2 text-foreground">Archivo nuevo: {selectedImageFile.name}</div>
                  ) : null}
                </div>
                <div className="flex h-36 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="Vista previa del producto" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                      <ImageUp className="h-5 w-5" />
                      <span>Sin imagen</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(form.force_servir_default)}
                onCheckedChange={(v) => setForm((p) => ({ ...p, force_servir_default: v }))}
              />
              <Label>Servir por defecto</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(form.activo)}
                onCheckedChange={(v) => setForm((p) => ({ ...p, activo: v }))}
              />
              <Label>Activo</Label>
            </div>
          </div>
          {!hasImageForSave && !editingId ? (
            <p className="text-xs font-medium text-amber-700">Falta seleccionar la imagen (obligatoria para crear).</p>
          ) : null}
          {nombreDuplicado ? (
            <p className="text-xs font-medium text-destructive">
              Ya existe un producto con ese nombre principal. Usa otro nombre.
            </p>
          ) : null}
          <Button
            type="button"
            className="rounded-xl"
            disabled={!canSubmitForm}
            title={
              !hasImageForSave && !editingId
                ? "Selecciona una imagen"
                : nombreDuplicado
                  ? "Nombre duplicado"
                  : undefined
            }
            onClick={() => saveGlobalMutation.mutate()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {saveGlobalMutation.isPending ? "Guardando…" : editingId ? "Actualizar" : "Crear producto"}
          </Button>
        </div>
      ) : null}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Productos ({isLoading ? "…" : globales.length})
        </div>
        <div className="divide-y max-h-[28rem] overflow-auto">
          {globales.map((row) => {
            const thumb = normalizeImageUrl(row.imagen_default_url);
            return (
              <div key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40">
                  {thumb ? (
                    <img src={thumb} alt={row.nombre_principal} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageUp className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{row.nombre_principal}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.categoria} · ${Number(row.precio_default).toFixed(2)} · {row.tipo_producto}
                    {!row.activo ? " · inactivo" : ""}
                  </div>
                </div>
                {canEditGlobal ? (
                  <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => startEdit(row)}>
                    Editar
                  </Button>
                ) : null}
              </div>
            );
          })}
          {!isLoading && globales.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Aún no hay productos globales.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ProductosGlobalesAdmin;
