import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pencil, Trash2, Plus, Save, X, Loader2 } from "lucide-react";

/* ── Generic inline-editable table for admin CRUDs ── */

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: string;
  render?: (item: T) => React.ReactNode;
  editRender?: (value: any, onChange: (v: any) => void) => React.ReactNode;
  type?: "text" | "number" | "switch" | "select";
}

interface Props<T extends { id: string }> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading: boolean;
  editingId: string | null;
  editValues: Record<string, any>;
  onEdit: (item: T) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onFieldChange: (key: string, value: any) => void;
  saving?: boolean;
  addLabel?: string;
}

export function AdminTable<T extends { id: string }>({
  columns,
  data,
  isLoading,
  editingId,
  editValues,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onAdd,
  onFieldChange,
  saving,
  addLabel = "Agregar",
}: Props<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isAddingNew = !!editingId && !data.some((item) => item.id === editingId);
  const rows = isAddingNew
    ? ([{ ...(editValues as T), id: editingId! }, ...data] as T[])
    : data;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd} className="gap-1.5 rounded-xl font-display text-xs">
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="hidden sm:grid bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns: `${columns.map(c => c.width || "1fr").join(" ")} 5rem` }}>
          {columns.map(c => <div key={c.key}>{c.header}</div>)}
          <div className="text-right">Acciones</div>
        </div>

        {/* Rows */}
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Sin registros</div>
        )}
        {rows.map((item) => {
          const isEditing = editingId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "grid items-center gap-2 px-3 py-2.5 border-t border-border text-sm",
                isEditing && "bg-primary/5"
              )}
              style={{ gridTemplateColumns: `${columns.map(c => c.width || "1fr").join(" ")} 5rem` }}
            >
              {columns.map((col) => (
                <div key={col.key} className="min-w-0">
                  {isEditing ? (
                    col.editRender ? (
                      col.editRender(editValues[col.key], (v) => onFieldChange(col.key, v))
                    ) : col.type === "switch" ? (
                      <Switch
                        checked={!!editValues[col.key]}
                        onCheckedChange={(v) => onFieldChange(col.key, v)}
                      />
                    ) : col.type === "number" ? (
                      <Input
                        type="number"
                        value={editValues[col.key] ?? ""}
                        onChange={(e) => onFieldChange(col.key, parseFloat(e.target.value) || 0)}
                        className="h-8 rounded-lg text-sm"
                      />
                    ) : (
                      <Input
                        value={editValues[col.key] ?? ""}
                        onChange={(e) => onFieldChange(col.key, e.target.value)}
                        className="h-8 rounded-lg text-sm"
                      />
                    )
                  ) : col.render ? (
                    col.render(item)
                  ) : col.type === "switch" ? (
                    <Switch checked={!!(item as any)[col.key]} disabled />
                  ) : (
                    <span className="truncate">{String((item as any)[col.key] ?? "")}</span>
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-1">
                {isEditing ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSave} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-accent" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancelEdit}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
