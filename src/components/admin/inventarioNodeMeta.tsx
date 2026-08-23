import type { ReactNode, SyntheticEvent } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  estadoInventarioDesdeCantidad,
  etiquetaEstadoInventario,
  etiquetaTipoProducto,
  type TipoProducto,
} from "@/lib/inventarioProductos";
import type { InventarioProductoInfo } from "@/lib/inventarioMenuData";

const stopTreeClick = (event: SyntheticEvent) => {
  event.stopPropagation();
};

type MetaFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

const MetaField = ({ label, children, className }: MetaFieldProps) => (
  <div className={cn("rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2", className)}>
    <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-1">{children}</div>
  </div>
);

type InventarioProductosNodeMetaProps = {
  info: InventarioProductoInfo;
  canEditTipo: boolean;
  savingTipo: boolean;
  onTipoChange: (tipo: TipoProducto) => void;
};

export const InventarioProductosNodeMeta = ({
  info,
  canEditTipo,
  savingTipo,
  onTipoChange,
}: InventarioProductosNodeMetaProps) => {
  const estado = estadoInventarioDesdeCantidad(info.cantidadDisponible);

  return (
    <div
      className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
      onClick={stopTreeClick}
      onKeyDown={stopTreeClick}
    >
      <MetaField label="Cantidad">
        <p className="text-sm font-bold tabular-nums text-foreground">{info.cantidadDisponible}</p>
      </MetaField>

      <MetaField label="Estado">
        <Badge
          variant="outline"
          className={cn(
            "rounded-lg text-[10px] font-bold",
            estado === "DISPONIBLE"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800",
          )}
        >
          {etiquetaEstadoInventario(estado)}
        </Badge>
      </MetaField>

      <MetaField label="Activo catálogo">
        <Badge variant="outline" className="rounded-lg text-[10px] font-bold">
          {info.activoCatalogo ? "Sí" : "No"}
        </Badge>
      </MetaField>

      <MetaField label="Tipo">
        {canEditTipo ? (
          <Select
            value={info.tipoProducto}
            onValueChange={(value) => onTipoChange(value as TipoProducto)}
            disabled={savingTipo}
          >
            <SelectTrigger className="h-8 rounded-lg text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="COMPRADO">Comprado</SelectItem>
              <SelectItem value="PREPARADO">Preparado</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs font-semibold text-foreground">{etiquetaTipoProducto(info.tipoProducto)}</p>
        )}
      </MetaField>
    </div>
  );
};

type InventarioMovimientosNodeMetaProps = {
  info: InventarioProductoInfo;
  canRegistrar: boolean;
  onRegistrar: () => void;
};

export const InventarioMovimientosNodeMeta = ({
  info,
  canRegistrar,
  onRegistrar,
}: InventarioMovimientosNodeMetaProps) => {
  const estado = estadoInventarioDesdeCantidad(info.cantidadDisponible);

  return (
    <div
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      onClick={stopTreeClick}
      onKeyDown={stopTreeClick}
    >
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
        <MetaField label="Stock">
          <p className="text-sm font-bold tabular-nums text-foreground">{info.cantidadDisponible}</p>
        </MetaField>
        <MetaField label="Estado">
          <Badge
            variant="outline"
            className={cn(
              "rounded-lg text-[10px] font-bold",
              estado === "DISPONIBLE"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800",
            )}
          >
            {etiquetaEstadoInventario(estado)}
          </Badge>
        </MetaField>
        <MetaField label="Tipo" className="hidden sm:block">
          <p className="text-xs font-semibold text-foreground">{etiquetaTipoProducto(info.tipoProducto)}</p>
        </MetaField>
      </div>

      {canRegistrar ? (
        <Button
          size="sm"
          className="h-9 shrink-0 rounded-xl"
          onClick={(event) => {
            event.stopPropagation();
            onRegistrar();
          }}
        >
          Registrar movimiento
        </Button>
      ) : null}
    </div>
  );
};
