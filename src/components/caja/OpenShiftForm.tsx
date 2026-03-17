import { useState } from "react";
import type { Denomination } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { AlertCircle, DollarSign, Loader2 } from "lucide-react";
import DenominationVisual from "@/components/caja/DenominationVisual";

interface Props {
  denominations: Denomination[];
  onOpen: (payload: { counts: { denomination_id: string; qty: number }[] }) => void;
  opening: boolean;
  readOnly?: boolean;
  title?: string;
  description?: string;
}

export default function OpenShiftForm({
  denominations,
  onOpen,
  opening,
  readOnly = false,
  title = "Abrir Caja",
  description = "Ingresa el conteo inicial de caja",
}: Props) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(denominations.map((d) => [d.id, 0]))
  );

  const hasDenominations = denominations.length > 0;
  const total = denominations.reduce((sum, denomination) => sum + denomination.value * (counts[denomination.id] ?? 0), 0);

  const handleSubmit = () => {
    const data = denominations.map((denomination) => ({
      denomination_id: denomination.id,
      qty: counts[denomination.id] ?? 0,
    }));
    onOpen({ counts: data });
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <DollarSign className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {readOnly ? "Solo consulta: no puedes abrir caja desde esta cuenta" : description}
        </p>
      </div>

      {!hasDenominations ? (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 text-warning" />
            No hay denominaciones configuradas para esta sucursal
          </div>
          <p className="text-muted-foreground">
            Configura las monedas y billetes en Administracion / Denominaciones para que el formulario de apertura muestre el desglose.
          </p>
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          {denominations.map((denomination) => (
            <div key={denomination.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <DenominationVisual
                label={denomination.label}
                imageUrl={denomination.image_url}
                className="h-14 w-20 rounded-2xl"
                imageClassName="object-contain bg-white p-0.5"
                iconClassName="h-6 w-6"
              />
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-black leading-none text-red-600">${denomination.value.toFixed(2)}</div>
              </div>
              <Input
                type="number"
                min={0}
                value={counts[denomination.id] ?? 0}
                onChange={(e) => setCounts({ ...counts, [denomination.id]: parseInt(e.target.value, 10) || 0 })}
                className="h-9 w-20 rounded-lg text-center"
                disabled={readOnly}
              />
              <span className="w-20 text-right text-sm font-semibold text-foreground">
                ${((counts[denomination.id] ?? 0) * denomination.value).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 rounded-xl bg-primary/10 p-4 text-center">
        <p className="text-xs text-muted-foreground">Total en caja</p>
        <p className="font-display text-2xl font-bold text-primary">${total.toFixed(2)}</p>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={opening || readOnly || !hasDenominations}
        className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
      >
        {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abrir Caja"}
      </Button>
    </div>
  );
}
