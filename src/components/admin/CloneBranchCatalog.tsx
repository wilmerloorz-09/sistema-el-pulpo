import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
}

const CATALOG_ITEMS = [
  { key: "tables", label: "Mesas" },
  { key: "categories", label: "Categorías, subcategorías y productos" },
  { key: "modifiers", label: "Modificadores" },
  { key: "payment_methods", label: "Métodos de pago" },
  { key: "denominations", label: "Denominaciones" },
] as const;

type CatalogKey = (typeof CATALOG_ITEMS)[number]["key"];

const CloneBranchCatalog = () => {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cleanFirst, setCleanFirst] = useState(false);
  const [selected, setSelected] = useState<Set<CatalogKey>>(new Set(CATALOG_ITEMS.map(i => i.key)));
  const [result, setResult] = useState<Record<string, number> | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ["clone-branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name, branch_code").eq("is_active", true).order("name");
      return (data ?? []) as Branch[];
    },
  });

  const toggle = (key: CatalogKey) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleClone = async () => {
    if (!sourceId || !targetId || selected.size === 0) return;
    if (sourceId === targetId) {
      toast.error("Las sucursales deben ser diferentes");
      return;
    }

    const targetName = branches.find(b => b.id === targetId)?.name;
    const labels = CATALOG_ITEMS.filter(i => selected.has(i.key)).map(i => i.label).join(", ");
    const cleanWarning = cleanFirst
      ? `\n\n⚠️ ATENCIÓN: Se ELIMINARÁN primero los datos seleccionados de "${targetName}" antes de copiar.`
      : "";
    const confirmed = window.confirm(
      `¿Copiar ${labels} de "${branches.find(b => b.id === sourceId)?.name}" a "${targetName}"?${cleanWarning}`
    );
    if (!confirmed) return;

    setCloning(true);
    setResult(null);

    try {
      const res = await supabase.functions.invoke("clone-branch-catalog", {
        body: {
          source_branch_id: sourceId,
          target_branch_id: targetId,
          items: Array.from(selected),
          clean_first: cleanFirst,
        },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setResult(res.data.stats);
      toast.success("Catálogo duplicado correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al duplicar");
    } finally {
      setCloning(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Copy className="h-5 w-5" />
          Duplicar catálogo entre sucursales
        </CardTitle>
        <CardDescription>
          Selecciona qué elementos copiar de una sucursal a otra.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Si no activas la limpieza previa, los registros se <strong>agregarán</strong> a la sucursal destino y podrían duplicarse.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Sucursal origen</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar origen…" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} {b.branch_code ? `(${b.branch_code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Sucursal destino</label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar destino…" /></SelectTrigger>
            <SelectContent>
              {branches.filter(b => b.id !== sourceId).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} {b.branch_code ? `(${b.branch_code})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Elementos a duplicar</label>
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            {CATALOG_ITEMS.map((item) => (
              <label key={item.key} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={selected.has(item.key)}
                  onCheckedChange={() => toggle(item.key)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Limpiar destino antes de copiar</p>
              <p className="text-xs text-muted-foreground">Elimina los ítems seleccionados en la sucursal destino primero</p>
            </div>
          </div>
          <Switch checked={cleanFirst} onCheckedChange={setCleanFirst} />
        </div>

        <Button
          onClick={handleClone}
          disabled={!sourceId || !targetId || selected.size === 0 || cloning}
          className="w-full"
          variant={cleanFirst ? "destructive" : "default"}
        >
          {cloning ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Duplicando…</> : cleanFirst ? "Limpiar y duplicar catálogo" : "Duplicar catálogo"}
        </Button>

        {result && (
          <div className="rounded-lg border bg-muted/50 p-3 text-sm space-y-1">
            <p className="font-medium text-foreground">Registros copiados:</p>
            {Object.entries(result).map(([key, val]) => (
              <p key={key} className="text-muted-foreground">• {key}: <span className="font-mono text-foreground">{val}</span></p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CloneBranchCatalog;


