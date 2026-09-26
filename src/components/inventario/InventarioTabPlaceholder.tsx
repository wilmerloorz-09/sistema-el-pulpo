import { Package } from "lucide-react";
import { Card } from "@/components/ui/card";

type InventarioTabPlaceholderProps = {
  title: string;
  description: string;
};

const InventarioTabPlaceholder = ({ title, description }: InventarioTabPlaceholderProps) => (
  <Card className="rounded-[28px] border border-border/80 p-6 shadow-sm">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
        <Package className="h-5 w-5" />
      </div>
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        <p className="mt-4 text-xs font-semibold text-amber-700">
          En construcción: la pestaña ya está disponible; la operativa se conectará en el siguiente paso.
        </p>
      </div>
    </div>
  </Card>
);

export default InventarioTabPlaceholder;
