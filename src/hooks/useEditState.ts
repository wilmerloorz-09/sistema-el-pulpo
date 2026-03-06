import { useState, useCallback } from "react";
import { generateUUID } from "@/lib/uuid";

export function useEditState<T extends { id: string }>(defaults: Partial<T> = {}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const startEdit = useCallback((item: T) => {
    setEditingId(item.id);
    setEditValues({ ...(item as any) });
  }, []);

  const startAdd = useCallback((extraDefaults: Record<string, any> = {}) => {
    const newId = generateUUID();
    setEditingId(newId);
    setEditValues({ id: newId, ...defaults, ...extraDefaults });
  }, [defaults]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValues({});
  }, []);

  const setField = useCallback((key: string, value: any) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { editingId, editValues, startEdit, startAdd, cancelEdit, setField, setEditingId };
}
