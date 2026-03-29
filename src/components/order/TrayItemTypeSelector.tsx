import type { TrayItemType } from "@/hooks/useTrayOrder";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TrayItemTypeSelectorProps {
  open: boolean;
  onSelect: (type: TrayItemType) => void;
  onCancel: () => void;
}

const OPTIONS: Array<{
  type: TrayItemType;
  label: string;
  description: string;
  tone: string;
}> = [
  {
    type: "A",
    label: "Bandeja del cliente",
    description: "Usa el precio del producto y no agrega costo de envase.",
    tone: "border-sky-200 bg-sky-50 text-sky-900",
  },
  {
    type: "B",
    label: "Tarrina del local",
    description: "Usa el precio del producto y permite sumar costo de tarrina.",
    tone: "border-orange-200 bg-orange-50 text-orange-900",
  },
  {
    type: "C",
    label: "Por monto",
    description: "Solo muestra categorias bandeja y obliga precio manual mayor a cero.",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
];

export function TrayItemTypeSelector({ open, onSelect, onCancel }: TrayItemTypeSelectorProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-xl rounded-[28px] border-amber-200/60 p-5 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl font-black">Selecciona el tipo de item bandeja</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          {OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => onSelect(option.type)}
              className={`rounded-[22px] border p-4 text-left transition hover:-translate-y-0.5 ${option.tone}`}
            >
              <p className="text-sm font-black">{option.type}</p>
              <p className="mt-2 text-sm font-semibold">{option.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-current/80">{option.description}</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
