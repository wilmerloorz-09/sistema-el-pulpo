import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  bloquearTeclaNoEntera,
  estadoInventarioDesdeCantidad,
  etiquetaEstadoInventario,
  etiquetaTipoProducto,
  normalizarCantidadInventario,
  soloDigitosCantidad,
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
  canEdit: boolean;
  savingTipo: boolean;
  savingIntegra: boolean;
  onTipoChange: (tipo: TipoProducto) => void;
  onIntegraChange: (integra: boolean) => void;
};

export const InventarioProductosNodeMeta = ({
  info,
  canEdit,
  savingTipo,
  savingIntegra,
  onTipoChange,
  onIntegraChange,
}: InventarioProductosNodeMetaProps) => {
  const estado = estadoInventarioDesdeCantidad(info.cantidadDisponible);

  return (
    <div
      className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
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
        {canEdit ? (
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

      <MetaField label="Integra ventas">
        {canEdit ? (
          <Select
            value={info.integraConVentas ? "si" : "no"}
            onValueChange={(value) => onIntegraChange(value === "si")}
            disabled={savingIntegra}
          >
            <SelectTrigger className="h-8 rounded-lg text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">No</SelectItem>
              <SelectItem value="si">Sí</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="rounded-lg text-[10px] font-bold">
            {info.integraConVentas ? "Sí" : "No"}
          </Badge>
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

type LimiteStockFieldProps = {
  value: number;
  canEdit: boolean;
  saving: boolean;
  onSave: (limite: number) => void;
};

const LimiteStockField = ({ value, canEdit, saving, onSave }: LimiteStockFieldProps) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  if (!canEdit) {
    return <p className="text-sm font-bold tabular-nums text-foreground">{value}</p>;
  }

  const commit = () => {
    if (!draft) {
      setDraft(String(value));
      return;
    }
    const next = normalizarCantidadInventario(draft);
    if (next === value) {
      setDraft(String(value));
      return;
    }
    onSave(next);
  };

  return (
    <Input
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(soloDigitosCantidad(event.target.value))}
      onBlur={commit}
      onKeyDown={(event) => {
        bloquearTeclaNoEntera(event);
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className="h-8 rounded-lg text-[12px] font-bold tabular-nums"
    />
  );
};

type BodegaSucursalProductosNodeMetaProps = {
  info: InventarioProductoInfo;
  canEdit?: boolean;
  savingIntegra?: boolean;
  onIntegraChange?: (integra: boolean) => void;
  /** Solo Productos Sucursal; en bodega general no aplica. */
  showIntegraVentas?: boolean;
  /** Nevera: muestra Límite y oculta Estado, Activo catálogo y Tipo. */
  showLimite?: boolean;
  savingLimite?: boolean;
  onLimiteChange?: (limite: number) => void;
  canAjustar?: boolean;
  onAjustar?: () => void;
};

export const BodegaSucursalProductosNodeMeta = ({
  info,
  canEdit = false,
  savingIntegra = false,
  onIntegraChange,
  showIntegraVentas = false,
  showLimite = false,
  savingLimite = false,
  onLimiteChange,
  canAjustar = false,
  onAjustar,
}: BodegaSucursalProductosNodeMetaProps) => {
  const estado = estadoInventarioDesdeCantidad(info.cantidadDisponible);
  const columnas = 1 + (showLimite ? 1 : 3) + (showIntegraVentas ? 1 : 0);

  return (
    <div
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      onClick={stopTreeClick}
      onKeyDown={stopTreeClick}
    >
      <div
        className={cn(
          "grid flex-1 grid-cols-2 gap-2",
          columnas >= 5 ? "sm:grid-cols-3 lg:grid-cols-5" : columnas === 4 ? "sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        <MetaField label="Cantidad">
          <p className="text-sm font-bold tabular-nums text-foreground">{info.cantidadDisponible}</p>
        </MetaField>
        {showLimite ? (
          <MetaField label="Límite">
            <LimiteStockField
              value={info.limiteStock}
              canEdit={canEdit && Boolean(onLimiteChange)}
              saving={savingLimite}
              onSave={(limite) => onLimiteChange?.(limite)}
            />
          </MetaField>
        ) : (
          <>
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
              <p className="text-xs font-semibold text-foreground">{etiquetaTipoProducto(info.tipoProducto)}</p>
            </MetaField>
          </>
        )}
        {showIntegraVentas ? (
          <MetaField label="Integra ventas">
            {canEdit && onIntegraChange ? (
              <Select
                value={info.integraConVentas ? "si" : "no"}
                onValueChange={(value) => onIntegraChange(value === "si")}
                disabled={savingIntegra}
              >
                <SelectTrigger className="h-8 rounded-lg text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="si">Sí</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className="rounded-lg text-[10px] font-bold">
                {info.integraConVentas ? "Sí" : "No"}
              </Badge>
            )}
          </MetaField>
        ) : null}
      </div>

      {canAjustar && onAjustar ? (
        <Button
          size="sm"
          className="h-9 shrink-0 rounded-xl"
          onClick={(event) => {
            event.stopPropagation();
            onAjustar();
          }}
        >
          Ajustar
        </Button>
      ) : null}
    </div>
  );
};
