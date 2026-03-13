import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNodeModifiers } from "@/hooks/useNodeModifiers";
import { cn } from "@/lib/utils";

interface NodeModifiersPanelProps {
  nodeId: string;
  nodeType: "category" | "product";
}

interface SectionProps {
  title: string;
  description: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
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

const NodeModifiersPanel = ({ nodeId, nodeType }: NodeModifiersPanelProps) => {
  const {
    inheritedModifiers,
    ownModifiers,
    allModifiers,
    addModifier,
    removeModifier,
    loading,
    error,
  } = useNodeModifiers(nodeId);

  const [selectedModifierId, setSelectedModifierId] = useState("");
  const [inheritedOpen, setInheritedOpen] = useState(true);
  const [ownOpen, setOwnOpen] = useState(true);
  const [combinedOpen, setCombinedOpen] = useState(false);

  const ownModifierIds = useMemo(() => new Set(ownModifiers.map((modifier) => modifier.modifier_id)), [ownModifiers]);
  const inheritedModifierIds = useMemo(() => new Set(inheritedModifiers.map((modifier) => modifier.modifier_id)), [inheritedModifiers]);
  const assignedModifierIds = useMemo(
    () => new Set([...inheritedModifiers.map((modifier) => modifier.modifier_id), ...ownModifiers.map((modifier) => modifier.modifier_id)]),
    [inheritedModifiers, ownModifiers],
  );

  const availableModifiers = useMemo(
    () => allModifiers.filter((modifier) => !assignedModifierIds.has(modifier.modifier_id)),
    [allModifiers, assignedModifierIds],
  );

  const catalogOptions = useMemo(
    () => allModifiers.map((modifier) => ({
      ...modifier,
      status: ownModifierIds.has(modifier.modifier_id)
        ? "Propio"
        : inheritedModifierIds.has(modifier.modifier_id)
          ? "Heredado"
          : "Disponible",
    })),
    [allModifiers, inheritedModifierIds, ownModifierIds],
  );

  const selectedOption = useMemo(
    () => catalogOptions.find((modifier) => modifier.modifier_id === selectedModifierId) ?? null,
    [catalogOptions, selectedModifierId],
  );

  const effectiveModifiers = useMemo(() => {
    const combined = new Map<string, { modifier_id: string; name: string; origin: "inherited" | "own"; source: string }>();

    for (const modifier of inheritedModifiers) {
      combined.set(modifier.modifier_id, {
        modifier_id: modifier.modifier_id,
        name: modifier.name,
        origin: "inherited",
        source: modifier.from_node_name,
      });
    }

    for (const modifier of ownModifiers) {
      combined.set(modifier.modifier_id, {
        modifier_id: modifier.modifier_id,
        name: modifier.name,
        origin: "own",
        source: "Este nodo",
      });
    }

    return [...combined.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inheritedModifiers, ownModifiers]);

  const catalogSummary = useMemo(
    () => ({
      total: allModifiers.length,
      available: availableModifiers.length,
    }),
    [allModifiers.length, availableModifiers.length],
  );

  const handleAddModifier = async () => {
    if (!selectedModifierId) {
      toast.error("Selecciona un modificador para agregar.");
      return;
    }

    if (selectedOption?.status !== "Disponible") {
      toast.error("Ese modificador ya esta aplicado a este nodo, de forma propia o heredada.");
      return;
    }

    try {
      await addModifier(selectedModifierId);
      setSelectedModifierId("");
      toast.success("Modificador agregado al nodo.");
    } catch (currentError) {
      toast.error(currentError instanceof Error ? currentError.message : "No se pudo agregar el modificador.");
    }
  };

  const handleRemoveModifier = async (menuNodeModifierId: string) => {
    try {
      await removeModifier(menuNodeModifierId);
      toast.success("Modificador quitado del nodo.");
    } catch (currentError) {
      toast.error(currentError instanceof Error ? currentError.message : "No se pudo quitar el modificador.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-muted/40 p-3 text-xs text-muted-foreground">
        Este {nodeType === "product" ? "producto" : "nodo categoria"} hereda acumulativamente los modificadores de sus ancestros.
        Las asignaciones propias de este nodo se suman a los heredados y un mismo modificador puede reutilizarse en diferentes nodos.
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Cargando modificadores del nodo...
        </div>
      ) : (
        <>
          <Section
            title="Heredados de niveles superiores"
            description="Se aplican por padre, abuelo o niveles superiores."
            count={inheritedModifiers.length}
            open={inheritedOpen}
            onOpenChange={setInheritedOpen}
          >
            {inheritedModifiers.length === 0 ? (
              <div className="text-sm text-muted-foreground">Este nodo no hereda modificadores de ancestros.</div>
            ) : (
              <div className="space-y-2">
                {inheritedModifiers.map((modifier) => (
                  <div key={`${modifier.modifier_id}-${modifier.from_node_id}`} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{modifier.name}</div>
                      <div className="text-xs text-muted-foreground">Origen: {modifier.from_node_name}</div>
                    </div>
                    <Badge variant="secondary" className="rounded-lg">
                      Heredado
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Propios de este nodo"
            description="Asignaciones directas editables del nodo actual."
            count={ownModifiers.length}
            open={ownOpen}
            onOpenChange={setOwnOpen}
          >
            <div className="space-y-3">
              {ownModifiers.length === 0 ? (
                <div className="text-sm text-muted-foreground">Este nodo todavia no tiene modificadores propios.</div>
              ) : (
                <div className="space-y-2">
                  {ownModifiers.map((modifier) => (
                    <div key={modifier.menu_node_modifier_id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{modifier.name}</div>
                        <div className="text-xs text-muted-foreground">{modifier.description}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => handleRemoveModifier(modifier.menu_node_modifier_id)}
                        disabled={loading || !!error}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Quitar
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  Catalogo activo en esta sucursal: {catalogSummary.total} | Disponibles para este nodo: {catalogSummary.available}
                </div>
                {allModifiers.length === 0 ? (
                  <div className="rounded-xl bg-muted/30 p-3 text-sm text-muted-foreground">
                    No hay modificadores activos creados en la sucursal actual.
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={selectedModifierId}
                  onChange={(event) => setSelectedModifierId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  disabled={loading || !!error || allModifiers.length === 0}
                >
                  <option value="">
                    {error
                      ? "No se pudieron cargar"
                      : allModifiers.length === 0
                        ? "No hay modificadores activos"
                        : "Selecciona un modificador"}
                  </option>
                  {catalogOptions.map((modifier) => (
                    <option key={modifier.modifier_id} value={modifier.modifier_id}>
                      {modifier.name} {modifier.status === "Disponible" ? "" : `(${modifier.status})`}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={handleAddModifier}
                  disabled={loading || !!error || !selectedModifierId || selectedOption?.status !== "Disponible"}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Agregar modificador
                </Button>
              </div>

              {selectedOption && selectedOption.status !== "Disponible" ? (
                <div className="rounded-xl bg-muted/30 p-3 text-sm text-muted-foreground">
                  {selectedOption.name} ya esta aplicado a este nodo como {selectedOption.status.toLowerCase()}.
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            title="Vista combinada efectiva"
            description="Lo que vera el operador al seleccionar este producto en Ordenes."
            count={effectiveModifiers.length}
            open={combinedOpen}
            onOpenChange={setCombinedOpen}
          >
            {effectiveModifiers.length === 0 ? (
              <div className="text-sm text-muted-foreground">Este nodo no tiene modificadores efectivos por ahora.</div>
            ) : (
              <div className="space-y-2">
                {effectiveModifiers.map((modifier) => (
                  <div key={`${modifier.modifier_id}-${modifier.origin}`} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{modifier.name}</div>
                      <div className="text-xs text-muted-foreground">{modifier.source}</div>
                    </div>
                    <Badge variant={modifier.origin === "own" ? "default" : "secondary"} className="rounded-lg">
                      {modifier.origin === "own" ? "Propio" : "Heredado"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

export default NodeModifiersPanel;
