import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CajaPayableOrderScope,
  CAJA_PAYABLE_SCOPE_ALL,
  CAJA_PAYABLE_SCOPE_MINE,
  cajaPayableScopeSelectValue,
  parseCajaPayableScopeSelectValue,
} from "@/lib/cajaPayableOrderScope";

interface Props {
  scope: CajaPayableOrderScope;
  creatorOptions: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onScopeChange: (scope: CajaPayableOrderScope) => void;
}

export default function CajaPayableOrderScopeSelect({
  scope,
  creatorOptions,
  disabled = false,
  onScopeChange,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor="caja-payable-scope" className="shrink-0 text-sm font-medium text-slate-700">
        Ver órdenes
      </label>
      <Select
        value={cajaPayableScopeSelectValue(scope)}
        onValueChange={(value) => onScopeChange(parseCajaPayableScopeSelectValue(value))}
        disabled={disabled}
      >
        <SelectTrigger id="caja-payable-scope" className="h-10 max-w-full sm:min-w-[240px]">
          <SelectValue placeholder="Seleccionar alcance" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CAJA_PAYABLE_SCOPE_ALL}>Todas las órdenes del turno</SelectItem>
          <SelectItem value={CAJA_PAYABLE_SCOPE_MINE}>Solo mis órdenes</SelectItem>
          {creatorOptions.length > 0 ? (
            <>
              {creatorOptions.map((creator) => (
                <SelectItem key={creator.id} value={`user:${creator.id}`}>
                  Órdenes de {creator.name}
                </SelectItem>
              ))}
            </>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
