import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, History, ImageIcon, RefreshCw, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMenuTree, type MenuNode, type MenuScope } from "@/hooks/useMenuTree";

interface MenuNavigatorProps {
  onSelectProduct?: (node: MenuNode) => void;
  includeInactive?: boolean;
  menuScope?: MenuScope;
  renderNodeAction?: (node: MenuNode) => ReactNode;
  trayMode?: boolean;
  trayNodes?: MenuNode[];
  nodesOverride?: MenuNode[] | null;
  forceLoading?: boolean;
  disabled?: boolean;
}

const RECENT_SEARCHES_KEY = "menu-navigator-recent-searches";
const MAX_RECENT_SEARCHES = 6;

const renderNodeVisual = (node: MenuNode) => {
  if (node.image_url) {
    return <img src={node.image_url} alt={node.name} className="h-14 w-14 rounded-[1.1rem] object-cover md:h-16 md:w-16 md:rounded-2xl" />;
  }

  if (node.icon) {
    return <span className="text-[2rem] leading-none md:text-4xl">{node.icon}</span>;
  }

  return <ImageIcon className="h-10 w-10 text-muted-foreground/60 md:h-12 md:w-12" />;
};

const renderCompactNodeVisual = (node: MenuNode) => {
  if (node.image_url) {
    return <img src={node.image_url} alt={node.name} className="h-7 w-7 rounded-xl object-cover md:h-6 md:w-6 md:rounded-lg" />;
  }

  if (node.icon) {
    return <span className="text-base leading-none">{node.icon}</span>;
  }

  return <ImageIcon className="h-5 w-5 text-muted-foreground/60 md:h-4 md:w-4" />;
};

const NodeCard = ({
  node,
  onClick,
  nodeAction,
  trayMode = false,
}: {
  node: MenuNode;
  onClick: () => void;
  nodeAction?: ReactNode;
  trayMode?: boolean;
}) => {
  const isProduct = node.node_type === "product";
  const isDisabledNode = !node.is_active && !nodeAction;
  const showsManualPrice = trayMode || node.price == null;

  if (isProduct) {
    return (
      <div
        role="button"
        tabIndex={isDisabledNode ? -1 : 0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (isDisabledNode) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "group relative col-span-full flex min-h-[72px] items-center gap-2.5 rounded-[1.15rem] border border-emerald-300/80 bg-white px-3 py-2.5 text-left transition-all md:min-h-[78px] md:gap-3 md:px-4 md:py-3",
          !node.is_active && "opacity-70 saturate-75",
          !isDisabledNode && "cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40",
          isDisabledNode && "cursor-not-allowed",
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-200/70 md:h-12 md:w-12">
          {renderNodeVisual(node)}
        </div>

        <div className="min-w-0 flex flex-1 items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-foreground md:text-[15px]">{node.name}</p>
          <p className="shrink-0 text-lg font-bold text-red-600 md:text-xl">
            {showsManualPrice ? "Manual" : `$${Number(node.price).toFixed(2)}`}
          </p>
        </div>

        {!node.is_active && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
            Agotado
          </span>
        )}

        {nodeAction ? <div className="shrink-0">{nodeAction}</div> : null}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={isDisabledNode ? -1 : 0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (isDisabledNode) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group relative flex min-h-[146px] flex-col rounded-[1.4rem] p-3 text-center transition-all active:scale-[0.99] md:min-h-[184px] md:rounded-3xl md:p-4",
        "border border-dashed border-orange-400/95 bg-gradient-to-br from-orange-200 via-amber-100 to-yellow-200 shadow-[0_22px_46px_-32px_rgba(249,115,22,0.52)] hover:-translate-y-0.5 hover:border-orange-500 hover:shadow-[0_20px_34px_-20px_rgba(249,115,22,0.5)]",
        !node.is_active && "opacity-70 saturate-75",
        !isDisabledNode && "cursor-pointer",
        isDisabledNode && "cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit]",
          "bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.24),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(250,204,21,0.28),transparent_24%)] md:bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.24),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(250,204,21,0.28),transparent_22%)]",
        )}
      />
      <div className="mb-2 flex justify-center md:mb-4">{renderNodeVisual(node)}</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-0.5">
        <p className="line-clamp-3 w-full text-center text-base font-semibold leading-snug text-foreground md:text-lg">
          {node.name}
        </p>
        {!node.is_active && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
            Agotado
          </span>
        )}
      </div>

      {nodeAction ? <div className="mt-2">{nodeAction}</div> : null}

      <ChevronRight className="absolute right-4 top-4 h-4 w-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
};

const MenuNavigator = ({
  onSelectProduct,
  includeInactive = false,
  menuScope = "TABLE",
  renderNodeAction,
  trayMode = false,
  trayNodes,
  nodesOverride,
  forceLoading = false,
  disabled = false,
}: MenuNavigatorProps) => {
  const {
    visibleNodes,
    breadcrumb,
    activeL1,
    selectL1,
    drillDown,
    goBack,
    goToBreadcrumbIndex,
    getChildren,
    loading,
    error,
    refetch,
  } = useMenuTree({
    includeInactive,
    menuScope,
    nodesOverride: nodesOverride ?? (trayMode && trayNodes ? trayNodes : null),
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const animationTimeouts = useRef<number[]>([]);
  const [renderedNodes, setRenderedNodes] = useState<MenuNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showSlowLoading, setShowSlowLoading] = useState(false);
  const visibleSignature = useMemo(() => visibleNodes.map((node) => node.id).join("|"), [visibleNodes]);

  useEffect(() => {
    if (!loading && !forceLoading) {
      setShowSlowLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSlowLoading(true);
    }, 8000);

    return () => window.clearTimeout(timeoutId);
  }, [forceLoading, loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!searchFocused) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!searchPanelRef.current?.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchFocused]);

  const persistRecentSearches = (nextSearches: string[]) => {
    setRecentSearches(nextSearches);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(nextSearches));
    } catch {
      // noop
    }
  };

  const registerRecentSearch = (rawQuery: string) => {
    const normalized = rawQuery.trim();
    if (!normalized) return;
    const nextSearches = [
      normalized,
      ...recentSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, MAX_RECENT_SEARCHES);
    persistRecentSearches(nextSearches);
  };

  const clearRecentSearches = () => {
    persistRecentSearches([]);
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const lowerQuery = searchQuery.trim().toLowerCase();

    const recursiveFind = (nodes: MenuNode[]): MenuNode[] => {
      let results: MenuNode[] = [];
      for (const node of nodes) {
        if (node.node_type === "product" && node.name.toLowerCase().includes(lowerQuery)) {
          results.push(node);
        }
        if (node.node_type === "category") {
          results = [...results, ...recursiveFind(getChildren(node.id))];
        }
      }
      return results;
    };
    
    const rootNodes = getChildren(null);
    const foundInsideNavigation = recursiveFind(rootNodes);
    
    const dedupedResults = Array.from(new Map(foundInsideNavigation.map(item => [item.id, item])).values());
    
    return dedupedResults;
  }, [searchQuery, getChildren]);

  const displayNodes = searchQuery.trim() ? searchResults : renderedNodes;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      setRenderedNodes(visibleNodes);
      return;
    }

    if (renderedNodes.length === 0) {
      setRenderedNodes(visibleNodes);
      return;
    }

    panel.classList.remove("menu-panel-enter", "menu-panel-enter-active", "menu-panel-exit", "menu-panel-exit-active");
    void panel.offsetWidth;
    panel.classList.add("menu-panel-exit");

    const exitFrame = window.setTimeout(() => {
      panel.classList.add("menu-panel-exit-active");
    }, 0);

    const swapFrame = window.setTimeout(() => {
      setRenderedNodes(visibleNodes);
      panel.classList.remove("menu-panel-exit", "menu-panel-exit-active");
      panel.classList.add("menu-panel-enter");
      void panel.offsetWidth;
      const enterFrame = window.setTimeout(() => {
        panel.classList.add("menu-panel-enter-active");
      }, 0);
      animationTimeouts.current.push(enterFrame);
    }, 180);

    const cleanupFrame = window.setTimeout(() => {
      panel.classList.remove("menu-panel-enter", "menu-panel-enter-active");
    }, 380);

    animationTimeouts.current.push(exitFrame, swapFrame, cleanupFrame);

    return () => {
      for (const timeoutId of animationTimeouts.current) {
        window.clearTimeout(timeoutId);
      }
      animationTimeouts.current = [];
    };
    // Solo firma: `visibleNodes` suele ser nueva referencia en renders seguidos y repetía salida/entrada CSS (~3 parpadeos).
  }, [visibleSignature]);

  useEffect(() => {
    if (renderedNodes.length === 0 && visibleNodes.length > 0) {
      setRenderedNodes(visibleNodes);
    }
  }, [renderedNodes.length, visibleNodes]);

  const l1Nodes = useMemo(
    () => getChildren(null).filter((node) => node.node_type === "category"),
    [getChildren],
  );
  const showBreadcrumb = breadcrumb.length > 1;
  if ((loading || forceLoading) && showSlowLoading) {
    return (
      <div className="rounded-3xl border border-orange-200 bg-white/80 px-4 py-8 text-center shadow-sm">
        <p className="font-semibold text-foreground">Los productos estan tardando en cargar</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Esto puede pasar si la conexion con la base de datos esta lenta o si la sucursal no respondio a tiempo.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 rounded-2xl"
          onClick={refetch}
          disabled={forceLoading}
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  }

  if (loading || forceLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Skeleton className="h-11 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          <Skeleton className="h-36 rounded-[1.4rem]" />
          <Skeleton className="h-36 rounded-[1.4rem]" />
          <Skeleton className="h-36 rounded-[1.4rem]" />
          <Skeleton className="h-36 rounded-[1.4rem]" />
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">{error}</div>;
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3 transition-opacity", disabled && "opacity-50")}>
      {trayMode && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Modo bandeja por monto: solo se muestran categorias bandeja y el precio se define manualmente.
        </div>
      )}

      <div className="relative mb-1">
        <div ref={searchPanelRef} className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <Input
            type="search"
            placeholder="Buscar producto..."
            value={searchQuery}
            disabled={disabled}
            onFocus={() => setSearchFocused(true)}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                registerRecentSearch(searchQuery);
                setSearchFocused(false);
              }
            }}
            className="pl-9 h-11 w-full rounded-2xl border-orange-200/60 bg-white/70 shadow-sm backdrop-blur-md focus-visible:ring-primary/40 dark:border-border dark:bg-card/50"
          />

          {searchFocused && !searchQuery.trim() && recentSearches.length > 0 && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-20 rounded-2xl border border-orange-200 bg-white/95 p-2 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Busquedas recientes
                </div>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80"
                >
                  Limpiar
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-xl border border-transparent bg-muted/30 px-2 py-1.5 hover:border-orange-100 hover:bg-orange-50/70">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery(item);
                        registerRecentSearch(item);
                        setSearchFocused(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm text-foreground">{item}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        persistRecentSearches(recentSearches.filter((search) => search !== item));
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white hover:text-foreground"
                      aria-label={`Eliminar busqueda ${item}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {!searchQuery.trim() && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
          {l1Nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                selectL1(node.id);
              }}
            className={cn(
              "shrink-0 rounded-2xl border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors md:px-4 md:py-2 md:text-sm",
              activeL1?.id === node.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="flex items-center gap-2">
              {renderCompactNodeVisual(node)}
              <span>{node.name}</span>
            </span>
          </button>
        ))}
        </div>
      )}

      {!searchQuery.trim() && showBreadcrumb && (
        <div className="scrollbar-none inline-flex w-fit max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-orange-200/70 bg-gradient-to-r from-orange-50 via-white to-amber-50 px-3 py-1.5 text-xs shadow-[0_12px_28px_-24px_rgba(249,115,22,0.55)]">
          {breadcrumb.map((node, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <div key={node.id} className="flex items-center gap-2">
                {isLast ? (
                  <span className="rounded-full bg-orange-100 px-2.5 py-1 font-bold text-orange-800">{node.name}</span>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      goToBreadcrumbIndex(index);
                    }}
                    className="font-medium text-muted-foreground transition-colors hover:text-orange-700"
                  >
                    {node.name}
                  </button>
                )}
                {!isLast ? <span className="text-orange-400">{">"}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {searchQuery.trim() && searchResults.length > 0 && (
        <div className="mb-1 text-xs font-semibold text-muted-foreground">
          {searchResults.length} {searchResults.length === 1 ? 'resultado' : 'resultados'} para "{searchQuery}"
        </div>
      )}

      <div ref={panelRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 px-1 pb-4 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] md:gap-3">
          {displayNodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              trayMode={trayMode}
              onClick={() => {
                if (disabled) return;
                if (!node.is_active && !renderNodeAction?.(node)) return;
                if (searchQuery.trim()) {
                  registerRecentSearch(searchQuery);
                }
                if (node.node_type === "product") {
                  if (!node.is_active && !renderNodeAction?.(node)) return;
                  onSelectProduct?.(node);
                  setSearchFocused(false);
                  return;
                }
                drillDown(node);
              }}
              nodeAction={renderNodeAction?.(node)}
            />
          ))}

          {!searchQuery.trim() && displayNodes.length === 0 && (
            <div className="col-span-full rounded-3xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No hay nodos activos en este nivel.
            </div>
          )}

          {searchQuery.trim() && displayNodes.length === 0 && (
            <div className="col-span-full rounded-3xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
              <p>No se encontraron productos para "{searchQuery}"</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .menu-panel-exit {
          opacity: 1;
          transform: translateX(0);
        }
        .menu-panel-exit-active {
          opacity: 0;
          transform: translateX(-16px);
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .menu-panel-enter {
          opacity: 0;
          transform: translateX(16px);
        }
        .menu-panel-enter-active {
          opacity: 1;
          transform: translateX(0);
          transition: opacity 180ms ease, transform 180ms ease;
        }
      `}</style>
    </div>
  );
};

export default MenuNavigator;



