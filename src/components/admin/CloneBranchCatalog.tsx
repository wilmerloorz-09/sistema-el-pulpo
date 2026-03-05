import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
}

const CloneBranchCatalog = () => {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ["clone-branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name, branch_code").eq("is_active", true).order("name");
      return (data ?? []) as Branch[];
    },
  });

  const handleClone = async () => {
    if (!sourceId || !targetId) return;
    if (sourceId === targetId) {
      toast.error("Las sucursales deben ser diferentes");
      return;
    }

    const confirmed = window.confirm(
      `¿Estás seguro de copiar TODO el catálogo de "${branches.find(b => b.id === sourceId)?.name}" a "${branches.find(b => b.id === targetId)?.name}"?\n\nEsto agregará mesas, categorías, productos, modificadores, métodos de pago y denominaciones.`
    );
    if (!confirmed) return;

    setCloning(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("clone-branch-catalog", {
        body: { source_branch_id: sourceId, target_branch_id: targetId },
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
          Copia mesas, categorías, subcategorías, productos, modificadores, métodos de pago y denominaciones de una sucursal a otra.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Esta acción <strong>agrega</strong> registros a la sucursal destino. Si ya existen datos, se duplicarán.
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

        <Button
          onClick={handleClone}
          disabled={!sourceId || !targetId || cloning}
          className="w-full"
        >
          {cloning ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Duplicando…</> : "Duplicar catálogo"}
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
