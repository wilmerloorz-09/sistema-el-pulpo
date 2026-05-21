import React, { useState, useEffect } from 'react';
import { useReportesFiltros, type ReportesFilters } from '@/hooks/useReportesOnlineData';
import { useBranchShiftGate } from '@/hooks/useBranchShiftGate';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar, Filter, Search, X, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';

interface FiltrosPanelProps {
  branchId: string;
  onFilterChange: (filters: ReportesFilters) => void;
  activeTab: string;
}

export default function FiltrosPanel({ branchId, onFilterChange, activeTab }: FiltrosPanelProps) {
  const { data: filtersData, isLoading } = useReportesFiltros(branchId);
  const { data: shiftGate } = useBranchShiftGate();

  // Estados de filtros
  const [rangeType, setRangeType] = useState<string>('HOY');
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [shiftId, setShiftId] = useState<string>('ALL');
  const [cashierId, setCashierId] = useState<string>('ALL');
  const [creatorId, setCreatorId] = useState<string>('ALL');
  const [supervisorId, setSupervisorId] = useState<string>('ALL');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedOrderTypes, setSelectedOrderTypes] = useState<string[]>(['DINE_IN', 'TAKEOUT', 'EXPRESS', 'EXTRA']);

  // Buscador de productos
  const [productSearch, setProductSearch] = useState<string>('');
  const [isProductsOpen, setIsProductsOpen] = useState(false);

  // Manejar cambios en el Rango Rápido de Tiempo
  useEffect(() => {
    const now = new Date();
    let dStr = '';
    let hStr = '';

    if (rangeType === 'TURNO_ACTUAL') {
      // Intentar obtener el shift_id activo del shift gate
      const currentShiftId = shiftGate?.shiftId;
      const openedAtStr = shiftGate?.shiftId ? filtersData?.shifts?.find(s => s.id === currentShiftId)?.opened_at : null;
      
      if (openedAtStr) {
        dStr = format(new Date(openedAtStr), "yyyy-MM-dd'T'HH:mm");
        hStr = format(now, "yyyy-MM-dd'T'HH:mm");
        if (currentShiftId) setShiftId(currentShiftId);
      } else {
        // Fallback: usar el turno más reciente de la lista
        const mostRecentShift = filtersData?.shifts?.[0];
        if (mostRecentShift) {
          dStr = format(new Date(mostRecentShift.opened_at), "yyyy-MM-dd'T'HH:mm");
          hStr = mostRecentShift.closed_at 
            ? format(new Date(mostRecentShift.closed_at), "yyyy-MM-dd'T'HH:mm")
            : format(now, "yyyy-MM-dd'T'HH:mm");
          setShiftId(mostRecentShift.id);
        } else {
          // Fallback a hoy si no hay turnos
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          dStr = format(startOfToday, "yyyy-MM-dd'T'HH:mm");
          hStr = format(now, "yyyy-MM-dd'T'HH:mm");
        }
      }
    } else if (rangeType === 'HOY') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      dStr = format(startOfToday, "yyyy-MM-dd'T'HH:mm");
      hStr = format(endOfToday, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    } else if (rangeType === 'AYER') {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      dStr = format(startOfYesterday, "yyyy-MM-dd'T'HH:mm");
      hStr = format(endOfYesterday, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    } else if (rangeType === 'ULTIMOS_7_DIAS') {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);
      const startOfRange = new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate(), 0, 0, 0);
      dStr = format(startOfRange, "yyyy-MM-dd'T'HH:mm");
      hStr = format(now, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    }

    if (rangeType !== 'PERSONALIZADO' && dStr && hStr) {
      setDesde(dStr);
      setHasta(hStr);
    }
  }, [rangeType, filtersData?.shifts, shiftGate]);

  // Si cambia de turno manualmente en el combo, autocompletamos su rango de fechas
  const handleShiftChange = (val: string) => {
    setShiftId(val);
    if (val !== 'ALL') {
      const selected = filtersData?.shifts?.find((s) => s.id === val);
      if (selected) {
        setDesde(format(new Date(selected.opened_at), "yyyy-MM-dd'T'HH:mm"));
        setHasta(selected.closed_at 
          ? format(new Date(selected.closed_at), "yyyy-MM-dd'T'HH:mm")
          : format(new Date(), "yyyy-MM-dd'T'HH:mm")
        );
        setRangeType('PERSONALIZADO'); // Cambiamos a personalizado para reflejar que manda la fecha del turno
      }
    }
  };

  // Enviar filtros al componente padre
  const handleApplyFilters = () => {
    // Formatear a formato ISO para enviar a Supabase
    const desdeISO = desde ? new Date(desde).toISOString() : null;
    const hastaISO = hasta ? new Date(hasta).toISOString() : null;

    onFilterChange({
      branchId,
      desde: desdeISO,
      hasta: hastaISO,
      shiftId: shiftId === 'ALL' ? null : shiftId,
      cashierId: cashierId === 'ALL' ? null : cashierId,
      creatorId: creatorId === 'ALL' ? null : creatorId,
      supervisorId: supervisorId === 'ALL' ? null : supervisorId,
      productIds: selectedProductIds.length === 0 ? null : selectedProductIds,
      orderTypes: selectedOrderTypes.length === 0 ? null : selectedOrderTypes,
    });
  };

  // Limpiar filtros
  const handleClearFilters = () => {
    setRangeType('HOY');
    setShiftId('ALL');
    setCashierId('ALL');
    setCreatorId('ALL');
    setSupervisorId('ALL');
    setSelectedProductIds([]);
    setSelectedOrderTypes(['DINE_IN', 'TAKEOUT', 'EXPRESS', 'EXTRA']);
  };

  // Filtrar productos por búsqueda
  const filteredProducts = (filtersData?.products || []).filter((p) =>
    p.description.toLowerCase().includes(productSearch.toLowerCase())
  );

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const toggleOrderType = (type: string) => {
    setSelectedOrderTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="rounded-3xl border border-border/80 bg-card/60 p-5 shadow-sm backdrop-blur-md transition-all print:hidden">
      <div className="flex items-center gap-2 border-b border-border/60 pb-3 mb-4">
        <Filter className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-bold text-foreground">Filtros de Búsqueda</h3>
        {isLoading && <span className="text-xs text-muted-foreground animate-pulse ml-2">(Cargando catálogos...)</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Rango de Tiempo Rápido */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Rango de Tiempo</Label>
          <Select value={rangeType} onValueChange={setRangeType}>
            <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80">
              <SelectValue placeholder="Seleccionar rango" />
            </SelectTrigger>
            <SelectContent>
              {shiftGate?.shiftId && <SelectItem value="TURNO_ACTUAL">🚀 Turno Actual</SelectItem>}
              <SelectItem value="HOY">📅 Hoy</SelectItem>
              <SelectItem value="AYER">📅 Ayer</SelectItem>
              <SelectItem value="ULTIMOS_7_DIAS">🗓️ Últimos 7 días</SelectItem>
              <SelectItem value="PERSONALIZADO">⚙️ Rango Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Inputs Desde y Hasta */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Desde</Label>
          <div className="relative">
            <Input
              type="datetime-local"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setRangeType('PERSONALIZADO');
              }}
              className="h-10 rounded-xl bg-background/80 border-border/80 pr-10 font-medium text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Hasta</Label>
          <div className="relative">
            <Input
              type="datetime-local"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setRangeType('PERSONALIZADO');
              }}
              className="h-10 rounded-xl bg-background/80 border-border/80 pr-10 font-medium text-xs"
            />
          </div>
        </div>

        {/* Combo de Turnos */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Turno Específico</Label>
          <Select value={shiftId} onValueChange={handleShiftChange}>
            <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
              <SelectValue placeholder="Todos los turnos" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="ALL">Todos los turnos</SelectItem>
              {(filtersData?.shifts || []).map((s) => {
                const isCurrent = s.id === shiftGate?.shiftId;
                const formattedDate = format(new Date(s.opened_at), 'dd/MM/yy HH:mm');
                return (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {isCurrent ? '🌟 ' : ''}Turno #{s.shift_number || s.id.substring(0, 5)} ({formattedDate})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Combo de Cajero */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Cajero que Cobró</Label>
          <Select value={cashierId} onValueChange={setCashierId}>
            <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
              <SelectValue placeholder="Todos los cajeros" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los cajeros</SelectItem>
              {(filtersData?.profiles || []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.first_name || p.username} {p.last_name || ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Combo de Creador de Orden */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Usuario Creador de Orden</Label>
          <Select value={creatorId} onValueChange={setCreatorId}>
            <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
              <SelectValue placeholder="Todos los usuarios" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los creadores</SelectItem>
              {(filtersData?.profiles || []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.first_name || p.username} {p.last_name || ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Combo de Supervisor (Solo relevante en Anulaciones) */}
        {activeTab === 'voids' && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Supervisor Autorizante</Label>
            <Select value={supervisorId} onValueChange={setSupervisorId}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todos los supervisores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los supervisores</SelectItem>
                {(filtersData?.profiles || []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.first_name || p.username} {p.last_name || ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Buscador de Productos Multiselect */}
        {activeTab !== 'voids' && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Filtrar por Productos</Label>
            <Popover open={isProductsOpen} onOpenChange={setIsProductsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex h-10 w-full justify-between rounded-xl bg-background/80 border-border/80 px-3 text-left font-normal text-xs"
                >
                  <span className="truncate">
                    {selectedProductIds.length === 0
                      ? 'Todos los productos'
                      : `${selectedProductIds.length} prod. seleccionados`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] rounded-2xl p-0" align="start">
                <div className="flex items-center border-b border-border/60 p-2.5">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <Input
                    placeholder="Buscar producto..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="h-8 border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  {productSearch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProductSearch('')}
                      className="h-7 w-7 rounded-full p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <ScrollArea className="h-60 p-2">
                  <div className="space-y-1">
                    {filteredProducts.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">No se encontraron productos</p>
                    ) : (
                      filteredProducts.map((p) => {
                        const isSelected = selectedProductIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleProduct(p.id)}
                            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs transition-colors hover:bg-muted"
                          >
                            <Checkbox checked={isSelected} id={`check-${p.id}`} className="rounded-md" />
                            <span className="truncate leading-none">{p.description}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
                {selectedProductIds.length > 0 && (
                  <div className="flex items-center justify-between border-t border-border/60 p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedProductIds([])}
                      className="text-[10px] font-bold rounded-lg h-7"
                    >
                      Limpiar
                    </Button>
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedProductIds.length} seleccionados
                    </Badge>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Tipos de Orden */}
        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs font-bold text-muted-foreground">Tipo de Orden</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 py-1">
            {[
              { id: 'DINE_IN', label: '🪑 Mesas (Dine-in)' },
              { id: 'TAKEOUT', label: '🥡 Para Llevar' },
              { id: 'EXPRESS', label: '⚡ Express' },
              { id: 'EXTRA', label: '📦 Extra/General' },
            ].map((type) => {
              const isChecked = selectedOrderTypes.includes(type.id);
              return (
                <label
                  key={type.id}
                  className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground/80 hover:text-foreground"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleOrderType(type.id)}
                    className="rounded-md"
                  />
                  <span>{type.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 mt-5 pt-4">
        {/* Chips de productos seleccionados */}
        <div className="flex flex-wrap gap-1 max-w-[70%]">
          {selectedProductIds.slice(0, 3).map((id) => {
            const prod = filtersData?.products?.find((p) => p.id === id);
            return (
              <Badge key={id} variant="secondary" className="text-[10px] rounded-lg gap-1">
                <span className="truncate max-w-[80px]">{prod?.description || id}</span>
                <X
                  className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100"
                  onClick={() => toggleProduct(id)}
                />
              </Badge>
            );
          })}
          {selectedProductIds.length > 3 && (
            <Badge variant="outline" className="text-[10px] rounded-lg">
              +{selectedProductIds.length - 3} más
            </Badge>
          )}
        </div>

        {/* Botones de acción */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClearFilters}
            className="rounded-xl h-10 px-4 text-xs font-bold"
          >
            Limpiar Filtros
          </Button>
          <Button
            type="button"
            onClick={handleApplyFilters}
            className="rounded-xl h-10 px-5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95"
          >
            Aplicar Filtros
          </Button>
        </div>
      </div>
    </div>
  );
}
