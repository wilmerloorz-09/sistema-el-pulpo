import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useBulkIncludedProducts,
  type EditableIncludedProductRange,
  type IncludedProductAssignment,
} from "@/hooks/useBulkIncludedProducts";
import { cn } from "@/lib/utils";

interface BulkIncludedProductsPanelProps {
  nodeId: string;
}

interface SectionProps {
  title: string;
  description: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

interface RangeEditorProps {
  assignment: IncludedProductAssignment;
  disabled: boolean;
  onSave: (ranges: EditableIncludedProductRange[]) => Promise<void>;
  onRemoveProduct: () => Promise<void>;
}

const Section = ({ title, description, count, open, onOpenChange, children }: SectionProps) => (
  <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-2xl border border-border bg-card">
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{title}</span>
            <Badge variant="outline" className="rounded-lg text-[10px]">
              {count}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="border-t border-border px-4 py-3">
      {children}
    </CollapsibleContent>
  </Collapsible>
);

const formatMoneyInput = (value: number) => {
  const fixed = value.toFixed(2);
  return fixed.endsWith(".00") ? String(Math.trunc(value)) : fixed;
};

const RangeEditor = ({ assignment, disabled, onSave, onRemoveProduct }: RangeEditorProps) => {
  const [rows, setRows] = useState<EditableIncludedProductRange[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(
      assignment.ranges.length > 0
        ? assignment.ranges.map((range) => ({
            id: range.id,
            amount_from: formatMoneyInput(range.amount_from),
            amount_to: "",
            included_quantity: String(range.included_quantity),
          }))
        : [{ amount_from: "", amount_to: "", included_quantity: "1" }],
    );
  }, [assignment]);

  const serializedRows = JSON.stringify(rows);
  const serializedAssignment = JSON.stringify(
    assignment.ranges.length > 0
      ? assignment.ranges.map((range) => ({
          id: range.id,
          amount_from: formatMoneyInput(range.amount_from),
          amount_to: "",
          included_quantity: String(range.included_quantity),
        }))
      : [{ amount_from: "", amount_to: "", included_quantity: "1" }],
  );

  const isDirty = serializedRows !== serializedAssignment;

  const updateRow = (index: number, key: keyof EditableIncludedProductRange, value: string) => {
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { amount_from: "", amount_to: "", included_quantity: "1" }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => {
      const next = prev.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [{ amount_from: "", amount_to: "", included_quantity: "1" }];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const meaningfulRows = rows.filter(
        (row) =>
          row.amount_from.trim() !== "" ||
          row.included_quantity.trim() !== "",
      );

      await onSave(meaningfulRows);
      toast.success(`Reglas guardadas para ${assignment.included_node_name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar las reglas.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveProduct = async () => {
    try {
      await onRemoveProduct();
      toast.success(`Producto incluido quitado: ${assignment.included_node_name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar el producto incluido.");
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{assignment.included_node_name}</div>
          <p className="text-xs text-muted-foreground">
            Configura desde que monto se deben entregar productos adicionales.
          </p>
        </div>
        <Badge variant="secondary" className="rounded-lg">
          Filas: {rows.length}
        </Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={handleRemoveProduct}
          disabled={disabled || saving}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Quitar producto
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-background">
        <Table className="min-w-[520px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">Fila</TableHead>
              <TableHead className="w-[180px]">Desde $</TableHead>
              <TableHead className="w-[220px]">Entregar (cantidad)</TableHead>
              <TableHead className="w-[120px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.id ?? `new-${index}`}>
                <TableCell className="p-2 text-sm font-medium text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell className="p-2">
                  <Input
                    value={row.amount_from}
                    onChange={(event) => updateRow(index, "amount_from", event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={disabled || saving}
                  />
                </TableCell>
                <TableCell className="p-2">
                  <Input
                    value={row.included_quantity}
                    onChange={(event) => updateRow(index, "included_quantity", event.target.value)}
                    inputMode="numeric"
                    placeholder="1"
                    disabled={disabled || saving}
                  />
                </TableCell>
                <TableCell className="p-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeRow(index)}
                    disabled={disabled || saving}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" className="rounded-xl" onClick={addRow} disabled={disabled || saving}>
          <Plus className="mr-1.5 h-4 w-4" />
          Agregar fila
        </Button>
        <Button type="button" className="rounded-xl" onClick={handleSave} disabled={disabled || saving || !isDirty}>
          <Save className="mr-1.5 h-4 w-4" />
          Guardar reglas
        </Button>
      </div>
    </div>
  );
};

const BulkIncludedProductsPanel = ({ nodeId }: BulkIncludedProductsPanelProps) => {
  const {
    assignments,
    availableProducts,
    addIncludedProduct,
    removeIncludedProduct,
    saveRanges,
    loading,
    error,
  } = useBulkIncludedProducts(nodeId);

  const [selectedIncludedNodeId, setSelectedIncludedNodeId] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);

  const selectedAvailableProduct = useMemo(
    () => availableProducts.find((product) => product.node_id === selectedIncludedNodeId) ?? null,
    [availableProducts, selectedIncludedNodeId],
  );

  const handleAddIncludedProduct = async () => {
    if (!selectedIncludedNodeId) {
      toast.error("Selecciona un producto para incluir.");
      return;
    }

    try {
      await addIncludedProduct(selectedIncludedNodeId);
      setSelectedIncludedNodeId("");
      toast.success(`Producto incluido agregado: ${selectedAvailableProduct?.name ?? "Producto"}.`);
    } catch (currentError) {
      toast.error(currentError instanceof Error ? currentError.message : "No se pudo agregar el producto incluido.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-muted/40 p-3 text-xs text-muted-foreground">
        Solo en <span className="font-medium text-foreground">A Granel</span>: puedes definir productos incluidos para este producto
        y una tabla de entrega por monto cobrado. La lista elegible se toma desde <span className="font-medium text-foreground">Menu Mesa</span>,
        solo de categorias raiz con orden 2 y 3.
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Cargando configuracion de productos incluidos...
        </div>
      ) : (
        <Section
          title="Producto incluido"
          description="Asigna uno o mas productos adicionales y define sus rangos de entrega."
          count={assignments.length}
          open={sectionOpen}
          onOpenChange={setSectionOpen}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Elegibles para este producto: {availableProducts.length} | Ya configurados: {assignments.length}
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={selectedIncludedNodeId}
                  onChange={(event) => setSelectedIncludedNodeId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  disabled={loading || !!error || availableProducts.length === 0}
                >
                  <option value="">
                    {availableProducts.length === 0 ? "No hay productos elegibles disponibles" : "Selecciona un producto incluido"}
                  </option>
                  {availableProducts.map((product) => (
                    <option key={product.node_id} value={product.node_id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={handleAddIncludedProduct}
                  disabled={loading || !!error || !selectedIncludedNodeId}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Agregar producto
                </Button>
              </div>
            </div>

            {assignments.length === 0 ? (
              <div className="rounded-2xl bg-muted/30 p-3 text-sm text-muted-foreground">
                Este producto todavia no tiene productos incluidos configurados.
              </div>
            ) : (
              <div className="space-y-3">
                {assignments.map((assignment) => (
                  <RangeEditor
                    key={assignment.id}
                    assignment={assignment}
                    disabled={loading || !!error}
                    onSave={(ranges) => saveRanges(assignment.id, ranges)}
                    onRemoveProduct={() => removeIncludedProduct(assignment.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
};

export default BulkIncludedProductsPanel;
