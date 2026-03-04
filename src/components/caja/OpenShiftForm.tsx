import { useState } from "react";
import type { Denomination } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, Loader2 } from "lucide-react";

interface Props {
  denominations: Denomination[];
  onOpen: (counts: { denomination_id: string; qty: number }[]) => void;
  opening: boolean;
}

export default function OpenShiftForm({ denominations, onOpen, opening }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(denominations.map((d) => [d.id, 0]))
  );

  const total = denominations.reduce((s, d) => s + d.value * (counts[d.id] ?? 0), 0);

  const handleSubmit = () => {
    const data = denominations.map((d) => ({
      denomination_id: d.id,
      qty: counts[d.id] ?? 0,
    }));
    onOpen(data);
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
          <DollarSign className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-xl font-bold text-foreground">Abrir Turno</h2>
        <p className="text-sm text-muted-foreground mt-1">Ingresa el conteo inicial de caja</p>
      </div>

      <div className="space-y-3 mb-6">
        {denominations.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl bg-card border border-border p-3">
            <span className="text-sm font-medium text-foreground flex-1">{d.label}</span>
            <span className="text-xs text-muted-foreground w-16 text-right">${d.value.toFixed(2)}</span>
            <Input
              type="number"
              min={0}
              value={counts[d.id] ?? 0}
              onChange={(e) => setCounts({ ...counts, [d.id]: parseInt(e.target.value) || 0 })}
              className="w-20 text-center h-9 rounded-lg"
            />
            <span className="text-sm font-semibold text-foreground w-20 text-right">
              ${((counts[d.id] ?? 0) * d.value).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-primary/10 p-4 mb-6 text-center">
        <p className="text-xs text-muted-foreground">Total en caja</p>
        <p className="font-display text-2xl font-bold text-primary">${total.toFixed(2)}</p>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={opening}
        className="w-full h-12 rounded-xl font-display text-base font-semibold gap-2"
      >
        {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abrir Turno"}
      </Button>
    </div>
  );
}
