import React, { useState, useEffect } from 'react';
import { useReportesFiltros, type ReportesFilters } from '@/hooks/useReportesOnlineData';
import { useBranchShiftGate } from '@/hooks/useBranchShiftGate';
import { useBranch } from '@/contexts/BranchContext';
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
import { getUserDisplayName } from '@/lib/userDisplay';

interface FiltrosPanelProps {
  branchId: string;
  onFilterChange: (filters: ReportesFilters) => void;
  activeTab: string;
}

export default function FiltrosPanel({ branchId, onFilterChange, activeTab }: FiltrosPanelProps) {
  const { data: shiftGate } = useBranchShiftGate();
  const { isGlobalAdmin, branches } = useBranch();

  // Estados de filtros
  const [localBranchId, setLocalBranchId] = useState<string>(branchId);
  
  useEffect(() => {
    setLocalBranchId(branchId);
  }, [branchId]);
  const [rangeType, setRangeType] = useState<string>('HOY');
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [shiftId, setShiftId] = useState<string>('ALL');
  const [cashierId, setCashierId] = useState<string>('ALL');
  const [creatorId, setCreatorId] = useState<string>('ALL');
  const [supervisorId, setSupervisorId] = useState<string>('ALL');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [selectedOrderType, setSelectedOrderType] = useState<string>('ALL');

  // Buscador de productos
  const [productSearch, setProductSearch] = useState<string>('');
  const [isProductsOpen, setIsProductsOpen] = useState(false);

  const effectiveBranchId = localBranchId || branchId;
  const { data: filtersData, isLoading } = useReportesFiltros(effectiveBranchId);

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

    // Resolver los nodos seleccionados a sus IDs de producto legacy para el backend
    const menuNodes = filtersData?.menuNodes || [];
    const legacyProducts = filtersData?.products || [];

    const collectLegacyIds = (nodeId: string, into: Set<string>) => {
      const node = menuNodes.find((n: any) => n.id === nodeId);
      if (!node) return;

      // Añadimos tanto el ID del nodo como su ID legacy para asegurar compatibilidad total con la tabla de orders_items
      into.add(node.id);
      if (node.legacy_product_id) {
        into.add(node.legacy_product_id);
      }

      // Fallback: Si un producto antiguo no está enlazado correctamente al árbol, lo buscamos por nombre
      if (node.name) {
        const nodeNameLower = node.name.toLowerCase().trim();
        const matchingLegacy = legacyProducts.filter((p: any) => {
          if (!p.description) return false;
          const descLower = p.description.toLowerCase().trim();
          if (descLower === nodeNameLower) return true;
          // Si el nombre tiene 4 letras o más, permitimos coincidencia parcial (ej: "Encebollado" coincide con "Encebollado Mixto")
          if (nodeNameLower.length >= 4 && descLower.includes(nodeNameLower)) return true;
          return false;
        });
        matchingLegacy.forEach((p: any) => into.add(p.id));
      }

      const children = menuNodes.filter((n: any) => n.parent_id === nodeId);
      for (const child of children) {
        collectLegacyIds(child.id, into);
      }
    };

    const categoryProductIds = new Set<string>();
    const selectedProductIds = new Set<string>();

    if (selectedCategoryId !== 'ALL') {
      collectLegacyIds(selectedCategoryId, categoryProductIds);
    }
    for (const nodeId of selectedNodeIds) {
      collectLegacyIds(nodeId, selectedProductIds);
    }

    let finalProductIds: string[] | null = null;
    const hasCategoryScope = selectedCategoryId !== 'ALL';
    const hasProductScope = selectedNodeIds.length > 0;

    if (hasCategoryScope && hasProductScope) {
      // Intersección: productos elegidos que pertenecen a la categoría
      finalProductIds = Array.from(selectedProductIds).filter((id) => categoryProductIds.has(id));
    } else if (hasCategoryScope) {
      finalProductIds = Array.from(categoryProductIds);
    } else if (hasProductScope) {
      finalProductIds = Array.from(selectedProductIds);
    }

    if (finalProductIds) {
      finalProductIds = finalProductIds.filter(Boolean);
      // Si eligieron categoría/producto pero no resolvió IDs, forzar vacío (no mostrar todo).
      if (finalProductIds.length === 0) {
        finalProductIds = ['00000000-0000-0000-0000-000000000000'];
      }
    }

    onFilterChange({
      branchId: localBranchId,
      desde: desdeISO,
      hasta: hastaISO,
      shiftId: shiftId === 'ALL' ? null : shiftId,
      cashierId: cashierId === 'ALL' ? null : cashierId,
      creatorId: creatorId === 'ALL' ? null : creatorId,
      supervisorId: supervisorId === 'ALL' ? null : supervisorId,
      productIds: finalProductIds,
      orderTypes: selectedOrderType === 'ALL' ? ['DINE_IN', 'TAKEOUT', 'EXPRESS', 'EXTRA', 'SPECIAL'] : [selectedOrderType],
    });
  };

  // Limpiar filtros
  const handleClearFilters = () => {
    setLocalBranchId(branchId);
    setRangeType('HOY');
    setShiftId('ALL');
    setCashierId('ALL');
    setCreatorId('ALL');
    setSupervisorId('ALL');
    setSelectedNodeIds([]);
    setSelectedCategoryId('ALL');
    setSelectedOrderType('ALL');
  };

  const menuNodes = filtersData?.menuNodes || [];

  const isNodeSelected = (nodeId: string): boolean => {
    if (selectedNodeIds.includes(nodeId)) return true;
    const node = menuNodes.find((n: any) => n.id === nodeId);
    if (!node || !node.parent_id) return false;
    return isNodeSelected(node.parent_id);
  };

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      } else {
        return [...prev, nodeId];
      }
    });
  };

  const getScopeSuffix = (scope?: string) => {
    switch (scope) {
      case 'TABLE': return ' DE MESA';
      case 'TAKEOUT': return ' CON ENVASE';
      case 'BULK': return ' A GRANEL';
      case 'EXTRA': return ' EXTRA';
      default: return '';
    }
  };

  const getDisplayName = (node: any) => {
    if (!node.parent_id && node.menu_scope) {
      return node.name + getScopeSuffix(node.menu_scope);
    }
    return node.name;
  };

  const getPath = (nodeId: string): string => {
    const node = menuNodes.find((n: any) => n.id === nodeId);
    if (!node) return '';
    const displayName = getDisplayName(node);
    if (!node.parent_id) return displayName;
    return `${getPath(node.parent_id)} > ${displayName}`;
  };

  const filteredSearchNodes = productSearch.trim()
    ? menuNodes.filter((n: any) => getDisplayName(n).toLowerCase().includes(productSearch.toLowerCase()))
    : [];

  const rootNodes = menuNodes.filter((n: any) => !n.parent_id);
  const categoryNodes = menuNodes.filter((n: any) => n.node_type === 'category');
  const showProductFilters = activeTab === 'products' || activeTab === 'payments';

  const renderTree = (nodes: any[], depth = 0) => {
    return nodes.map((node) => {
      const isSelected = isNodeSelected(node.id);
      const children = menuNodes.filter((n: any) => n.parent_id === node.id);
      return (
        <div key={node.id} className="flex flex-col w-full">
          <button
            type="button"
            onClick={() => toggleNode(node.id)}
            className="flex w-full items-center gap-2 rounded-xl py-1.5 text-left text-xs transition-colors hover:bg-muted"
            style={{ paddingLeft: `${0.5 + depth * 1.5}rem`, paddingRight: '0.5rem' }}
          >
            <Checkbox 
              checked={isSelected} 
              className="rounded-md h-3.5 w-3.5 pointer-events-none" 
            />
            <span className={`truncate leading-tight ${node.node_type === 'category' ? 'font-bold' : ''}`}>
              {getDisplayName(node)}
            </span>
          </button>
          {children.length > 0 && renderTree(children, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="rounded-3xl border border-border/80 bg-card/60 p-5 shadow-sm backdrop-blur-md transition-all print:hidden">
      <div className="flex items-center gap-2 border-b border-border/60 pb-3 mb-4">
        <Filter className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-bold text-foreground">Filtros de Búsqueda</h3>
        {isLoading && <span className="text-xs text-muted-foreground animate-pulse ml-2">(Cargando catálogos...)</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Filtro de Sucursal (Solo Admin Global) */}
        {isGlobalAdmin && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Sucursal</Label>
            <Select value={localBranchId} onValueChange={setLocalBranchId}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80">
                <SelectValue placeholder="Seleccionar sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="font-bold text-primary">🏢 Todas las sucursales</SelectItem>
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
                  {getUserDisplayName(p)}
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
                  {getUserDisplayName(p)}
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
                    {getUserDisplayName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Categoría de producto (menú) */}
        {showProductFilters && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Categoría de producto</Label>
            <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todas las categorías" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="ALL">Todas las categorías</SelectItem>
                {categoryNodes.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    Sin categorías en el menú
                  </SelectItem>
                ) : (
                  categoryNodes.map((node: any) => (
                    <SelectItem key={node.id} value={node.id} className="text-xs">
                      {getPath(node.id)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Buscador de Productos Multiselect */}
        {showProductFilters && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Filtrar por Productos</Label>
            <Popover open={isProductsOpen} onOpenChange={setIsProductsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex h-10 w-full justify-between rounded-xl bg-background/80 border-border/80 px-3 text-left font-normal text-xs"
                >
                  <span className="truncate">
                    {selectedNodeIds.length === 0
                      ? 'Todos los productos'
                      : `${selectedNodeIds.length} selecciones`}
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
                    {productSearch.trim() ? (
                      filteredSearchNodes.length === 0 ? (
                        <p className="p-4 text-center text-xs text-muted-foreground">No se encontraron productos</p>
                      ) : (
                        filteredSearchNodes.map((n) => {
                          const isSelected = isNodeSelected(n.id);
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => toggleNode(n.id)}
                              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] transition-colors hover:bg-muted"
                            >
                              <Checkbox checked={isSelected} className="rounded-md h-3.5 w-3.5 pointer-events-none" />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate leading-none font-bold">{n.name}</span>
                                <span className="truncate text-[9px] text-muted-foreground">{getPath(n.id)}</span>
                              </div>
                            </button>
                          );
                        })
                      )
                    ) : (
                      rootNodes.length === 0 ? (
                        <p className="p-4 text-center text-xs text-muted-foreground">No hay productos en el menú</p>
                      ) : (
                        renderTree(rootNodes)
                      )
                    )}
                  </div>
                </ScrollArea>
                {selectedNodeIds.length > 0 && (
                  <div className="flex items-center justify-between border-t border-border/60 p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedNodeIds([])}
                      className="text-[10px] font-bold rounded-lg h-7"
                    >
                      Limpiar
                    </Button>
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedNodeIds.length} seleccionados
                    </Badge>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Tipos de Orden */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-muted-foreground">Tipo de Orden</Label>
          <Select value={selectedOrderType} onValueChange={setSelectedOrderType}>
            <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los tipos</SelectItem>
              <SelectItem value="DINE_IN">🪑 Mesas (Dine-in)</SelectItem>
              <SelectItem value="TAKEOUT">🥡 Para Llevar</SelectItem>
              <SelectItem value="EXPRESS">⚡ Express</SelectItem>
              <SelectItem value="EXTRA">📦 Extra/General</SelectItem>
              <SelectItem value="SPECIAL">🌟 Especial</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 mt-5 pt-4">
        {/* Chips de categoría / productos seleccionados */}
        <div className="flex flex-wrap gap-1 max-w-[70%]">
          {selectedCategoryId !== 'ALL' && (
            <Badge variant="secondary" className="text-[10px] rounded-lg gap-1">
              <span className="truncate max-w-[120px]">
                {menuNodes.find((n: any) => n.id === selectedCategoryId)?.name || 'Categoría'}
              </span>
              <X
                className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100"
                onClick={() => setSelectedCategoryId('ALL')}
              />
            </Badge>
          )}
          {selectedNodeIds.slice(0, 3).map((id) => {
            const node = menuNodes.find((n: any) => n.id === id);
            return (
              <Badge key={id} variant="secondary" className="text-[10px] rounded-lg gap-1">
                <span className="truncate max-w-[80px]">{node?.name || id}</span>
                <X
                  className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100"
                  onClick={() => toggleNode(id)}
                />
              </Badge>
            );
          })}
          {selectedNodeIds.length > 3 && (
            <Badge variant="outline" className="text-[10px] rounded-lg">
              +{selectedNodeIds.length - 3} más
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
