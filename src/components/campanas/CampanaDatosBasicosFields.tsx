import type { ReactNode } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ErroresCampanaFormulario, CampanaDatosBasicosFormulario } from "@/lib/campanasValidacion";

interface CampanaDatosBasicosFieldsProps {
  valores: CampanaDatosBasicosFormulario;
  errores: ErroresCampanaFormulario;
  onChange: (valores: CampanaDatosBasicosFormulario) => void;
  deshabilitado?: boolean;
  /** Una sola fila (detalle); por defecto bloques (modal crear). */
  disposicion?: "bloques" | "fila";
  onGuardar?: () => void;
  puedeGuardar?: boolean;
  guardando?: boolean;
}

const campoClass = "space-y-1";
const labelClass = "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const inputClass = "h-9";

function Campo({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={campoClass + (className ? ` ${className}` : "")}>
      <Label className={labelClass}>{label}</Label>
      {children}
      {error ? <p className="text-[10px] leading-tight text-destructive">{error}</p> : null}
    </div>
  );
}

export default function CampanaDatosBasicosFields({
  valores,
  errores,
  onChange,
  deshabilitado = false,
  disposicion = "bloques",
  onGuardar,
  puedeGuardar = false,
  guardando = false,
}: CampanaDatosBasicosFieldsProps) {
  const set = (parcial: Partial<CampanaDatosBasicosFormulario>) => onChange({ ...valores, ...parcial });

  const campos = (
    <>
      <Campo label="Título" error={disposicion === "fila" ? undefined : errores.titulo} className={disposicion === "fila" ? "w-[18rem] shrink-0 sm:w-[20rem]" : "col-span-2 sm:col-span-4"}>
        <Input
          className={inputClass}
          value={valores.titulo}
          disabled={deshabilitado}
          onChange={(e) => set({ titulo: e.target.value })}
        />
      </Campo>

      <Campo
        label="Mín. ($)"
        error={disposicion === "fila" ? undefined : errores.consumo_minimo}
        className={disposicion === "fila" ? "min-w-[6.5rem] max-w-[9rem] flex-1" : undefined}
      >
        <Input
          className={inputClass}
          inputMode="decimal"
          value={valores.consumo_minimo}
          disabled={deshabilitado}
          onChange={(e) => set({ consumo_minimo: e.target.value })}
        />
      </Campo>

      <Campo
        label="% desc."
        error={disposicion === "fila" ? undefined : errores.porcentaje_descuento}
        className={disposicion === "fila" ? "min-w-[6.5rem] max-w-[9rem] flex-1" : undefined}
      >
        <Input
          className={inputClass}
          inputMode="decimal"
          value={valores.porcentaje_descuento}
          disabled={deshabilitado}
          onChange={(e) => set({ porcentaje_descuento: e.target.value })}
        />
      </Campo>

      <Campo
        label="Tope ($)"
        error={disposicion === "fila" ? undefined : errores.descuento_maximo}
        className={disposicion === "fila" ? "min-w-[6.5rem] max-w-[9rem] flex-1" : undefined}
      >
        <Input
          className={inputClass}
          inputMode="decimal"
          value={valores.descuento_maximo}
          disabled={deshabilitado}
          onChange={(e) => set({ descuento_maximo: e.target.value })}
        />
      </Campo>

      <Campo
        label="Días"
        error={disposicion === "fila" ? undefined : errores.dias_vigencia_descuento}
        className={disposicion === "fila" ? "min-w-[5.5rem] max-w-[8rem] flex-1" : undefined}
      >
        <Input
          className={inputClass}
          inputMode="numeric"
          value={valores.dias_vigencia_descuento}
          disabled={deshabilitado}
          onChange={(e) => set({ dias_vigencia_descuento: e.target.value })}
        />
      </Campo>

      <div
        className={
          disposicion === "fila"
            ? "flex shrink-0 items-end gap-1.5 pb-0.5"
            : "col-span-2 flex items-center gap-2 sm:col-span-4"
        }
      >
        <Switch
          checked={valores.activa}
          disabled={deshabilitado}
          onCheckedChange={(v) => set({ activa: v })}
        />
        <Label className="whitespace-nowrap text-xs font-normal leading-none">Activa</Label>
      </div>

      {disposicion === "fila" && onGuardar ? (
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0 gap-1 rounded-xl px-3"
          disabled={deshabilitado || guardando || !puedeGuardar}
          onClick={onGuardar}
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
      ) : null}
    </>
  );

  const errorFila = disposicion === "fila" ? Object.values(errores).find(Boolean) : null;

  if (disposicion === "fila") {
    return (
      <div className="space-y-1">
        <div className="flex flex-nowrap items-end gap-x-2">{campos}</div>
        {errorFila ? <p className="text-xs text-destructive">{errorFila}</p> : null}
      </div>
    );
  }

  return <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">{campos}</div>;
}
