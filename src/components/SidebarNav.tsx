import { UserRound, ChevronRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutopedidosQrBadgeButton } from "@/components/autopedidos/AutopedidosQrPanel";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import { useAppVersion } from "@/hooks/useAppVersion";
import { getUserDisplayName, getUserRealName } from "@/lib/userDisplay";
import { isMesasListOrigin } from "@/lib/mesasFlow";

interface SidebarNavProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenAccount: () => void;
  onOpenAutopedidos?: () => void;
  onClose?: () => void;
  className?: string;
}

function getInitials(name?: string | null) {
  const clean = String(name ?? "").trim();
  if (!clean) return null;

  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function formatLocalBuildTime(value?: string | null) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

const SidebarNav = ({ isDark, onToggleTheme, onOpenAccount, onOpenAutopedidos, onClose, className }: SidebarNavProps) => {
  const { visibleItems } = useVisibleNavItems();
  const { profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, loading } = useBranch();
  const accountAlias = getUserDisplayName(profile);
  const accountRealName = getUserRealName(profile);
  const initials = getInitials(accountAlias);
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const appVersion = useAppVersion();

  const searchParams = new URLSearchParams(location.search);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <aside className={cn("hidden w-[248px] flex-col self-start border-r border-slate-800 bg-slate-900 text-slate-300 md:sticky md:top-0 md:flex md:h-screen md:min-h-screen z-40", className)}>
      <div className="shrink-0 border-b border-slate-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="El Pulpo" className="h-10 w-10 object-cover rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Sistema</p>
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate font-display text-lg font-black text-white">El Pulpo</p>
              {appVersion.version ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  onClick={() => setIsVersionOpen(true)}
                  title="Ver version instalada"
                >
                  v.{appVersion.version}
                </button>
              ) : null}
            </div>
          </div>
          {onOpenAutopedidos ? (
            <AutopedidosQrBadgeButton
              onClick={onOpenAutopedidos}
              className="border-slate-700 bg-slate-800 text-orange-300 hover:bg-slate-700"
            />
          ) : null}
        </div>

        <div className="mt-4 space-y-2">
          {activeBranch && branches.length > 1 ? (
            <Select
              value={activeBranchId ?? undefined}
              onValueChange={(value) => {
                const nextBranch = branches.find((branch) => branch.id === value) ?? null;
                if (nextBranch) {
                  void setActiveBranch(nextBranch);
                }
              }}
              disabled={loading}
            >
              <SelectTrigger className="h-11 w-full rounded-2xl border border-slate-700 bg-slate-800/50 px-3 text-left text-xs font-semibold text-slate-200 shadow-none hover:bg-slate-800 [&>span]:truncate">
                <SelectValue placeholder="Seleccionar sucursal" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : activeBranch ? (
            <div className="inline-flex min-h-[42px] w-full items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400">
              <span className="truncate">{activeBranch.name}</span>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {(["VENTA", "OPERATIVO", "FINANZAS", "PROMOCIONES", "ADMINISTRACIÓN"] as const).map(group => {
          const items = visibleItems.filter(item => item.group === group);
          if (items.length === 0) return null;

          return (
            <div key={group} className="flex flex-col gap-1.5">
              <h3 className="mb-1 px-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
                {group}
              </h3>
              <div className="flex flex-col gap-1">
                {items.map((item) => {
                  const mesasListOrigin = searchParams.get("origin");
                  const isOriginMesasList = isMesasListOrigin(mesasListOrigin);
                  const isOriginParaLlevar = searchParams.get("origin") === "para-llevar";
                  const isOriginExpress = searchParams.get("origin") === "express";
                  const isOriginExtra = searchParams.get("origin") === "extra";
                  const isOriginOrdenEspecial = searchParams.get("origin") === "orden-especial";
                  const isOriginClientes = searchParams.get("origin") === "clientes";
                  const isOriginPromociones = searchParams.get("origin") === "promociones";
                  const isOriginCampanas = searchParams.get("origin") === "campanas";
                  const hasSubItems = (item.subItems?.length ?? 0) > 0;
                  const isItemActive = item.to === "/mesas"
                    ? (location.pathname === "/mesas" || location.pathname === "/mesas-v2" || (location.pathname === "/ordenes" && isOriginMesasList))
                    : item.to === "/para-llevar"
                      ? (location.pathname === "/para-llevar" || (location.pathname === "/ordenes" && isOriginParaLlevar))
                      : item.to === "/express"
                        ? (location.pathname === "/express" || (location.pathname === "/ordenes" && isOriginExpress))
                      : item.to === "/extra"
                        ? (location.pathname === "/extra" || (location.pathname === "/ordenes" && isOriginExtra))
                      : item.to === "/orden-especial"
                        ? (location.pathname === "/orden-especial" || (location.pathname === "/ordenes" && isOriginOrdenEspecial))
                      : item.to.startsWith("/clientes")
                        ? (location.pathname === "/clientes" || isOriginClientes)
                      : item.to === "/promociones/consulta"
                        ? (location.pathname === "/promociones/consulta")
                      : item.to.startsWith("/promociones")
                        ? (location.pathname === "/promociones" || isOriginPromociones)
                      : item.to.startsWith("/campanas")
                        ? (location.pathname.startsWith("/campanas") || isOriginCampanas)
                    : item.to === "/ordenes"
                      ? (location.pathname === "/ordenes" && !isOriginMesasList && !isOriginParaLlevar && !isOriginExpress && !isOriginExtra && !isOriginOrdenEspecial && !isOriginClientes && !isOriginPromociones && !isOriginCampanas)
                      : item.to.includes("?") 
                        ? (location.pathname + location.search === item.to)
                        : item.end
                          ? (location.pathname === item.to && location.search === "")
                          : (location.pathname === item.to || (hasSubItems && location.pathname.startsWith(item.to)));

                  const isExpanded = expandedItem === item.to;

                  const navLinkContent = (
                    <>
                      <span className={cn(
                        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                        isItemActive ? "bg-indigo-500 text-white" : "text-slate-400 group-hover:text-slate-200"
                      )}>
                        {item.icon}
                      </span>
                      <span className={cn(
                        "relative z-10 truncate text-[13px] transition-colors",
                        isItemActive ? "font-semibold text-white" : "font-medium text-slate-300 group-hover:text-slate-100"
                      )}>
                        {item.label}
                      </span>
                      {hasSubItems && (
                        <ChevronRight className={cn(
                          "relative z-10 ml-auto h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300",
                          isExpanded && "rotate-90 text-slate-300"
                        )} />
                      )}
                    </>
                  );

                  const linkClasses = cn(
                    "group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1 transition-all",
                    "hover:bg-slate-800/50",
                    isItemActive && "bg-slate-800 border-slate-700",
                    isExpanded && !isItemActive && "bg-slate-800/30"
                  );

                  if (item.disabled) {
                    return (
                      <Tooltip key={`${item.to}-${item.label}`}>
                        <TooltipTrigger asChild>
                          <div className={cn(linkClasses, "cursor-not-allowed opacity-50 hover:bg-transparent")}>
                            {navLinkContent}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[220px] text-xs">
                          {item.disabledReason ?? "No disponible"}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <div key={`${item.to}-${item.label}`} className="flex flex-col">
                      {!hasSubItems ? (
                        <NavLink
                          to={item.to}
                          onClick={onClose}
                          forceActive={isItemActive}
                          suppressActive={!isItemActive}
                          className={linkClasses}
                          activeClassName="bg-slate-800 border-slate-700"
                        >
                          {navLinkContent}
                        </NavLink>
                      ) : (
                        <div
                          className={cn(linkClasses, "cursor-pointer")}
                          onClick={() => {
                            if (!isExpanded) navigate(item.to);
                            setExpandedItem(prev => prev === item.to ? null : item.to);
                          }}
                        >
                          {navLinkContent}
                        </div>
                      )}

                      {hasSubItems && (
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-1 flex flex-col gap-1 py-1 pl-11 pr-2">
                                {item.subItems?.map((subItem) => {
                                  const isSubActive =
                                    (subItem.to === location.pathname + location.search) ||
                                    (Boolean(subItem.end) && location.pathname === subItem.to && !location.search);

                                  if (subItem.disabled) {
                                    return (
                                      <Tooltip key={`${subItem.label}-${subItem.to}`}>
                                        <TooltipTrigger asChild>
                                          <div className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-slate-600">
                                            <div className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                                            <span className="truncate">{subItem.label}</span>
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-[220px] text-xs">
                                          {subItem.disabledReason ?? "No disponible"}
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  }

                                  return (
                                    <NavLink
                                      key={subItem.to}
                                      to={subItem.to}
                                      end={subItem.end}
                                      onClick={onClose}
                                      className={cn(
                                        "group/sub flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-slate-400 transition-colors",
                                        "hover:bg-slate-800/80 hover:text-slate-200",
                                        isSubActive && "bg-slate-800 text-slate-100"
                                      )}
                                    >
                                      <div className={cn(
                                        "h-1.5 w-1.5 rounded-full transition-all",
                                        isSubActive ? "bg-indigo-400 scale-100" : "bg-slate-600 scale-0 group-hover/sub:scale-100",
                                      )} />
                                      <span className="truncate">{subItem.label}</span>
                                    </NavLink>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-800 px-3 pt-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]">
        <div className="flex flex-col gap-2">
          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  onOpenAccount();
                  onClose?.();
                }}
                className="flex h-11 w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/50 px-3 text-slate-300 transition-colors hover:bg-slate-800"
                aria-label="Mi cuenta"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-700 text-slate-300">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={accountAlias}
                      className="h-full w-full object-cover"
                    />
                  ) : initials ? (
                    <span className="text-[10px] font-black tracking-wide">{initials}</span>
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-bold text-slate-200">{accountAlias}</span>
                  {accountRealName ? (
                    <span className="block truncate text-[10px] font-medium text-slate-500">{accountRealName}</span>
                  ) : null}
                </div>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">Rol: {profile?.role_name ?? "Usuario"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {accountAlias}
              {accountRealName ? ` · ${accountRealName}` : ""}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Dialog open={isVersionOpen} onOpenChange={setIsVersionOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Version instalada</DialogTitle>
            <DialogDescription>
              Confirma si este equipo esta usando el ultimo despliegue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-2xl border border-orange-100 bg-orange-50/60 p-4 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Version</p>
              <p className="mt-1 break-all font-mono text-base font-black text-foreground">
                {appVersion.fullVersion ?? appVersion.version ?? "No disponible"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build</p>
              <p className="mt-1 text-sm font-bold text-foreground" title={appVersion.builtAt ?? undefined}>
                {formatLocalBuildTime(appVersion.builtAt)}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
};

export default SidebarNav;
