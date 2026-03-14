import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMenuTree, type MenuNode } from "@/hooks/useMenuTree";

interface MenuNavigatorProps {
  onSelectProduct?: (node: MenuNode) => void;
  includeInactive?: boolean;
  renderNodeAction?: (node: MenuNode) => ReactNode;
}

const MAX_DEPTH_DOTS = 6;

const renderNodeVisual = (node: MenuNode) => {
  if (node.image_url) {
    return <img src={node.image_url} alt={node.name} className="h-20 w-20 rounded-[1.75rem] object-cover md:h-16 md:w-16 md:rounded-2xl" />;
  }

  if (node.icon) {
    return <span className="text-4xl leading-none">{node.icon}</span>;
  }

  return <ImageIcon className="h-14 w-14 text-muted-foreground/60 md:h-12 md:w-12" />;
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
  childCount,
  additionalDepth,
  onClick,
  nodeAction,
}: {
  node: MenuNode;
  childCount: number;
  additionalDepth: number;
  onClick: () => void;
  nodeAction?: ReactNode;
}) => {
  const isProduct = node.node_type === "product";
  const isDisabledNode = !node.is_active && !nodeAction;

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
        "group relative flex min-h-[208px] flex-col rounded-3xl bg-card p-5 text-left transition-all active:scale-[0.99] md:min-h-[184px] md:p-4",
        isProduct
          ? "border border-border hover:-translate-y-0.5 hover:border-emerald-400/60 hover:shadow-[0_12px_24px_-18px_rgba(16,185,129,0.75)]"
          : "border border-dashed border-border hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_12px_24px_-18px_hsl(var(--primary)/0.55)]",
        !node.is_active && "opacity-70 saturate-75",
        !isDisabledNode && "cursor-pointer",
        isDisabledNode && "cursor-not-allowed",
      )}
    >
      <div className="mb-4 flex justify-center">{renderNodeVisual(node)}</div>
      <div className="flex-1">
        <p className="line-clamp-2 text-base font-semibold text-foreground md:text-sm">{node.name}</p>
        {isProduct ? (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-base font-semibold text-emerald-600 md:text-sm">${Number(node.price ?? 0).toFixed(2)}</p>
            {!node.is_active && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                Agotado
              </span>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-sm text-muted-foreground md:text-xs">{childCount} items</p>
            {!node.is_active && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                Agotado
              </span>
            )}
          </div>
        )}
      </div>

      {nodeAction ? <div className="mt-3">{nodeAction}</div> : null}

      {!isProduct && additionalDepth > 0 && (
        <span className="absolute bottom-3 right-3 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
          +{additionalDepth} nivel{additionalDepth === 1 ? "" : "es"}
        </span>
      )}

      {!isProduct && (
        <ChevronRight className="absolute right-4 top-4 h-4 w-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );
};

const MenuNavigator = ({ onSelectProduct, includeInactive = false, renderNodeAction }: MenuNavigatorProps) => {
  const {
    visibleNodes,
    breadcrumb,
    activeL1,
    selectL1,
    drillDown,
    goBack,
    goToBreadcrumbIndex,
    getChildren,
    countDescendantDepth,
    loading,
    error,
  } = useMenuTree({ includeInactive });

  const panelRef = useRef<HTMLDivElement>(null);
  const animationTimeouts = useRef<number[]>([]);
  const [renderedNodes, setRenderedNodes] = useState<MenuNode[]>([]);
  const visibleSignature = useMemo(() => visibleNodes.map((node) => node.id).join("|"), [visibleNodes]);

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
  }, [renderedNodes.length, visibleNodes, visibleSignature]);

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
  const currentLevel = Math.max(1, breadcrumb.length || (activeL1 ? 1 : 0));

  if (loading) {
    return <div className="rounded-3xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">Cargando menu...</div>;
  }

  if (error) {
    return <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="menu-scroll flex gap-2 overflow-x-auto pb-1">
        {l1Nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => selectL1(node.id)}
            className={cn(
              "shrink-0 rounded-2xl border-b-2 px-4 py-3 text-sm font-semibold transition-colors md:py-2",
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

      {showBreadcrumb && (
        <div className="menu-scroll flex items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-muted-foreground">
          {breadcrumb.map((node, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <div key={node.id} className="flex items-center gap-2">
                {isLast ? (
                  <span className="font-semibold text-foreground">{node.name}</span>
                ) : (
                  <button type="button" onClick={() => goToBreadcrumbIndex(index)} className="hover:text-foreground">
                    {node.name}
                  </button>
                )}
                {!isLast ? <span className="text-muted-foreground/60">{">"}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: MAX_DEPTH_DOTS }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-2.5 w-2.5 rounded-full transition-colors",
                index < Math.min(currentLevel, MAX_DEPTH_DOTS) ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-muted-foreground">Nivel {currentLevel}</span>
        {showBreadcrumb && (
          <button type="button" onClick={goBack} className="ml-auto inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-primary md:min-h-0">
            <ChevronLeft className="h-3.5 w-3.5" />
            Volver
          </button>
        )}
      </div>

      <div ref={panelRef} className="min-h-0 flex-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-4 md:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] md:gap-3">
          {renderedNodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              childCount={getChildren(node.id).length}
              additionalDepth={countDescendantDepth(node.id)}
              onClick={() => {
                if (!node.is_active && !renderNodeAction?.(node)) return;
                if (node.node_type === "product") {
                  if (!node.is_active && !renderNodeAction?.(node)) return;
                  onSelectProduct?.(node);
                  return;
                }
                drillDown(node);
              }}
              nodeAction={renderNodeAction?.(node)}
            />
          ))}

          {renderedNodes.length === 0 && (
            <div className="col-span-full rounded-3xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No hay nodos activos en este nivel.
            </div>
          )}
        </div>
      </div>

      <style>{`
        .menu-scroll {
          scrollbar-width: none;
        }
        .menu-scroll::-webkit-scrollbar {
          display: none;
        }
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



