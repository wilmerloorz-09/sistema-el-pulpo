import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { useBranch } from "@/contexts/BranchContext";
import { generateUUID } from "@/lib/uuid";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Denomination {
  id: string;
  label: string;
  denomination_type: "coin" | "bill";
  value: number;
  display_order: number;
  image_url: string | null;
  is_active: boolean;
}

const DENOMINATION_IMAGE_BUCKET = "denomination-images";
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const DENOMINATION_TYPE_OPTIONS = [
  { value: "coin", label: "Moneda" },
  { value: "bill", label: "Billete" },
] as const;

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

const buildDenominationImagePath = (branchId: string, denominationId: string, file: File) => {
  const extension = getFileExtension(file);
  return `${branchId}/${denominationId}/${Date.now()}-${generateUUID()}.${extension}`;
};

const extractManagedImagePath = (imageUrl: string | null | undefined) => {
  const normalized = normalizeImageUrl(imageUrl);
  const marker = `/storage/v1/object/public/${DENOMINATION_IMAGE_BUCKET}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;
  return decodeURIComponent(normalized.slice(markerIndex + marker.length));
};

const getPublicImageUrl = (path: string) => supabase.storage.from(DENOMINATION_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

const DenominationsCrud = () => {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const crud = useCrud<Denomination>({ table: "denominations", queryKey: "admin-denominations", orderBy: { column: "display_order" } });
  const edit = useEditState<Denomination>({ label: "", denomination_type: "coin", value: 0, display_order: 1, image_url: "", is_active: true } as any);
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

  const getNextDisplayOrder = () => {
    if (crud.data.length === 0) return 1;
    return Math.max(...crud.data.map((item) => Number(item.display_order) || 0)) + 1;
  };

  const resetImageState = () => {
    setSelectedImageFile(null);
    setRemoveImage(false);
    setLocalPreviewUrl(null);
  };

  const currentDenomination = useMemo(
    () => crud.data.find((item) => item.id === edit.editingId) ?? null,
    [crud.data, edit.editingId],
  );

  const imagePreviewUrl = localPreviewUrl ?? (removeImage ? "" : normalizeImageUrl(edit.editValues.image_url));
  const hasCurrentImage = Boolean(normalizeImageUrl(edit.editValues.image_url)) && !removeImage;

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: Denomination; target: Denomination }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("denominations").update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("denominations").update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("denominations").update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-denominations"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la denominacion"),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");

      const label = String(values.label ?? "").trim();
      const value = Number(values.value ?? 0);
      const displayOrder = Math.trunc(Number(values.display_order ?? 0));
      const id = String(values.id ?? "").trim() || generateUUID();

      if (!label) throw new Error("La etiqueta es obligatoria");
      if (!Number.isFinite(value) || value <= 0) throw new Error("El valor debe ser mayor a 0");
      if (!Number.isFinite(displayOrder) || displayOrder < 1) throw new Error("El numero de orden debe ser mayor a 0");

      const duplicate = crud.data.find(
        (item) => item.id !== values.id && Number(item.display_order) === displayOrder,
      );
      if (duplicate) {
        throw new Error(`Ya existe una denominacion con el orden ${displayOrder}`);
      }

      const previousImageUrl = normalizeImageUrl(currentDenomination?.image_url ?? "");
      const previousManagedPath = extractManagedImagePath(previousImageUrl);
      let uploadedImagePath: string | null = null;
      let imageUrlToPersist = removeImage ? "" : previousImageUrl;

      try {
        if (selectedImageFile) {
          validateImageFile(selectedImageFile);
          uploadedImagePath = buildDenominationImagePath(activeBranchId, id, selectedImageFile);
          const { error: uploadError } = await supabase.storage
            .from(DENOMINATION_IMAGE_BUCKET)
            .upload(uploadedImagePath, selectedImageFile, {
              cacheControl: "3600",
              upsert: false,
              contentType: selectedImageFile.type,
            });
          if (uploadError) throw uploadError;
          imageUrlToPersist = getPublicImageUrl(uploadedImagePath);
        }

        const { error } = await supabase.from("denominations").upsert({
          id,
          branch_id: activeBranchId,
          label,
          denomination_type: values.denomination_type === "bill" ? "bill" : "coin",
          value,
          display_order: displayOrder,
          image_url: imageUrlToPersist || null,
          is_active: Boolean(values.is_active),
        } as never);
        if (error) throw error;

        if (previousManagedPath && (removeImage || uploadedImagePath) && previousManagedPath !== uploadedImagePath) {
          const { error: removeStorageError } = await supabase.storage
            .from(DENOMINATION_IMAGE_BUCKET)
            .remove([previousManagedPath]);
          if (removeStorageError) {
            console.warn("No se pudo eliminar la imagen anterior de la denominacion", removeStorageError);
          }
        }
      } catch (error) {
        if (uploadedImagePath) {
          await supabase.storage.from(DENOMINATION_IMAGE_BUCKET).remove([uploadedImagePath]);
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-denominations"] });
      qc.invalidateQueries({ queryKey: ["denominations"] });
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      edit.cancelEdit();
      resetImageState();
      toast.success("Denominacion guardada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo guardar la denominacion"),
  });

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
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
    edit.setField("image_url", "");
  };

  const startEdit = (item: Denomination) => {
    edit.startEdit(item);
    resetImageState();
  };

  const startAdd = () => {
    edit.startAdd({ denomination_type: "coin", display_order: getNextDisplayOrder(), image_url: "", is_active: true });
    resetImageState();
  };

  const cancelEdit = () => {
    edit.cancelEdit();
    resetImageState();
  };

  const columns: ColumnDef<Denomination>[] = [
    { key: "label", header: "Etiqueta", width: "1fr", type: "text" },
    {
      key: "denomination_type",
      header: "Tipo",
      width: "8rem",
      render: (item) => <span>{item.denomination_type === "bill" ? "Billete" : "Moneda"}</span>,
      editRender: (value, onChange) => (
        <select
          value={value ?? "coin"}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
        >
          {DENOMINATION_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "image_url",
      header: "Imagen",
      width: "19rem",
      render: (item) => (
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
            {normalizeImageUrl(item.image_url) ? (
              <img src={item.image_url ?? ""} alt={item.label} className="h-full w-full object-cover" />
            ) : (
              <ImageUp className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">{normalizeImageUrl(item.image_url) ? "Con imagen" : "Sin imagen"}</span>
        </div>
      ),
      editRender: () => (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="Vista previa de denominacion" className="h-full w-full object-cover" />
              ) : (
                <ImageUp className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 text-xs text-muted-foreground">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 font-medium text-foreground hover:bg-muted/50">
                <ImageUp className="h-4 w-4" />
                Seleccionar imagen
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
              </label>
              <div className="mt-2 truncate">
                {selectedImageFile ? `Archivo nuevo: ${selectedImageFile.name}` : hasCurrentImage ? "Imagen actual cargada" : "Sin imagen"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={clearSelectedUpload} disabled={!selectedImageFile}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Quitar archivo nuevo
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={clearCurrentImage} disabled={!hasCurrentImage}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Quitar imagen actual
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Acepta JPG, PNG, WEBP o GIF hasta 2 MB.
          </div>
        </div>
      ),
    },
    { key: "value", header: "Valor", width: "6rem", type: "number", render: (item) => <span>${item.value}</span> },
    { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
    { key: "display_order", header: "Orden", width: "5rem", render: (item) => <span>{item.display_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
  ];

  const renderRowActions = (item: Denomination) => {
    const index = crud.data.findIndex((row) => row.id === item.id);
    const prev = index > 0 ? crud.data[index - 1] : null;
    const next = index >= 0 && index < crud.data.length - 1 ? crud.data[index + 1] : null;

    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!prev || moveMutation.isPending}
          onClick={() => prev && moveMutation.mutate({ current: item, target: prev })}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!next || moveMutation.isPending}
          onClick={() => next && moveMutation.mutate({ current: item, target: next })}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  };

  return (
    <AdminTable<Denomination>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={startEdit}
      onCancelEdit={cancelEdit}
      onSave={() => saveMutation.mutate(edit.editValues)}
      onDelete={crud.remove}
      onAdd={startAdd}
      onFieldChange={edit.setField}
      saving={saveMutation.isPending}
      addLabel="Agregar denominacion"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
    />
  );
};

export default DenominationsCrud;
