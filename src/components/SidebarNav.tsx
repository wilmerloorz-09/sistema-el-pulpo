import { UserRound, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import ThemeToggle from "@/components/nav/ThemeToggle";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";
import { useAppVersion } from "@/hooks/useAppVersion";
import { getUserDisplayName } from "@/lib/userDisplay";
import { isMesasListOrigin } from "@/lib/mesasFlow";

interface SidebarNavProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenAccount: () => void;
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

const SidebarNav = ({ isDark, onToggleTheme, onOpenAccount, onClose, className }: SidebarNavProps) => {
  const { visibleItems } = useVisibleNavItems();
  const { profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, loading } = useBranch();
  const accountLabel = getUserDisplayName(profile);
  const initials = getInitials(accountLabel);
  const location = useLocation();
  const [openHoverCard, setOpenHoverCard] = useState<string | null>(null);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const appVersion = useAppVersion();

  const searchParams = new URLSearchParams(location.search);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <aside className={cn("hidden w-[248px] flex-col self-start border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:min-h-screen z-40", className)}>
      <div className="shrink-0 border-b border-sidebar-border/80 px-4 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="El Pulpo" className="h-10 w-auto object-contain" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sidebar-foreground/55">Sistema</p>
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate font-display text-lg font-black text-sidebar-foreground">El Pulpo</p>
              {appVersion.version ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-sidebar-foreground/45 transition-colors hover:bg-white/10 hover:text-sidebar-foreground/80"
                  onClick={() => setIsVersionOpen(true)}
                  title="Ver version instalada"
                >
                  v.{appVersion.version}
                </button>
              ) : null}
            </div>
          </div>
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
              <SelectTrigger className="h-11 w-full rounded-2xl border border-sidebar-border/80 bg-white/10 px-3 text-left text-xs font-semibold text-sidebar-foreground shadow-none hover:bg-white/12 [&>span]:truncate">
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
            <div className="inline-flex min-h-[42px] w-full items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/12 px-3 py-2 text-xs font-semibold text-emerald-100">
              <span className="truncate">{activeBranch.name}</span>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const mesasListOrigin = searchParams.get("origin");
          const isOriginMesasList = isMesasListOrigin(mesasListOrigin);
          const isOriginParaLlevar = searchParams.get("origin") === "para-llevar";
          const isOriginExpress = searchParams.get("origin") === "express";
          const isOriginOrdenEspecial = searchParams.get("origin") === "orden-especial";
          const isItemActive = item.to === "/mesas"
            ? (location.pathname === "/mesas" || location.pathname === "/mesas-v2" || (location.pathname === "/ordenes" && isOriginMesasList))
            : item.to === "/para-llevar"
              ? (location.pathname === "/para-llevar" || (location.pathname === "/ordenes" && isOriginParaLlevar))
              : item.to === "/express"
                ? (location.pathname === "/express" || (location.pathname === "/ordenes" && isOriginExpress))
              : item.to === "/orden-especial"
                ? (location.pathname === "/orden-especial" || (location.pathname === "/ordenes" && isOriginOrdenEspecial))
            : item.to === "/ordenes"
              ? (location.pathname === "/ordenes" && !isOriginMesasList && !isOriginParaLlevar && !isOriginExpress && !isOriginOrdenEspecial)
              : location.pathname === item.to;
          const hasSubItems = (item.subItems?.length ?? 0) > 0;

          const navLink = !hasSubItems ? (
            <NavLink
              to={item.to}
              onClick={onClose}
              forceActive={isItemActive}
              suppressActive={!isItemActive}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-sidebar-foreground/72 transition-all",
                "hover:border-white/10 hover:bg-white/10 hover:text-sidebar-foreground",
              )}
              activeClassName={cn(
                "border-white/10 bg-gradient-to-r text-white shadow-[0_18px_38px_-24px_rgba(245,158,11,0.82)]",
                item.tone.active,
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 transition-transform group-hover:scale-105">
                {item.icon}
              </span>
              <span className="truncate text-sm font-bold">{item.label}</span>
            </NavLink>
          ) : (
            <div
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-sidebar-foreground/72 transition-all",
                "hover:border-white/10 hover:bg-white/10 hover:text-sidebar-foreground",
                isItemActive && "border-white/10 bg-gradient-to-r text-white shadow-[0_18px_38px_-24px_rgba(245,158,11,0.82)]",
                isItemActive && item.tone.active
              )}
              onClick={(e) => {
                e.preventDefault();
                setOpenHoverCard(prev => prev === item.to ? null : item.to);
              }}
            >
              <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 transition-transform group-hover:scale-105">
                {item.icon}
              </span>
              <span className="relative z-10 truncate text-sm font-bold">{item.label}</span>
              <ChevronRight className={cn(
                "relative z-10 ml-auto h-4 w-4 shrink-0 opacity-40 transition-transform duration-300",
                (isItemActive || openHoverCard === item.to) && "rotate-90 opacity-100"
              )} />
            </div>
          );

          if (hasSubItems) {
            return (
              <HoverCard 
                key={item.to} 
                open={openHoverCard === item.to}
                onOpenChange={(open) => {
                  if (open) {
                    setOpenHoverCard(item.to);
                  } else if (openHoverCard === item.to) {
                    setOpenHoverCard(null);
                  }
                }}
                openDelay={0} 
                closeDelay={500}
              >
                <HoverCardTrigger asChild>
                  {navLink}
                </HoverCardTrigger>
                <HoverCardContent 
                  side="right" 
                  align="start" 
                  sideOffset={4}
                  className="z-[100] w-56 rounded-[24px] border border-sidebar-border bg-sidebar p-2 shadow-2xl"
                  onMouseEnter={() => setOpenHoverCard(item.to)}
                  onMouseLeave={() => setOpenHoverCard(null)}
                >
                  <div className="flex flex-col gap-1">
                    {item.subItems?.map((subItem) => {
                      const isSubActive =
                        (subItem.to === location.pathname + location.search) ||
                        (Boolean(subItem.end) && location.pathname === subItem.to && !location.search);

                      if (subItem.disabled) {
                        return (
                          <Tooltip key={`${subItem.label}-${subItem.to}`}>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  "group/sub flex cursor-not-allowed items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-sidebar-foreground/35",
                                )}
                              >
                                <div className="h-1.5 w-1.5 rounded-full bg-sidebar-foreground/15" />
                                {subItem.label}
                              </span>
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
                          onClick={() => {
                            setOpenHoverCard(null);
                            onClose?.();
                          }}
                          className={cn(
                            "group/sub flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-sidebar-foreground/70 transition-all",
                            "hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground",
                            isSubActive && "bg-sidebar-foreground/15 text-sidebar-foreground shadow-sm",
                          )}
                        >
                          <div className={cn(
                            "h-1.5 w-1.5 rounded-full transition-all",
                            isSubActive ? "bg-primary scale-100" : "bg-sidebar-foreground/20 scale-0 group-hover/sub:scale-100",
                          )} />
                          {subItem.label}
                        </NavLink>
                      );
                    })}
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          }

          return (
            <div key={item.to}>
              <Tooltip delayDuration={120}>
                <TooltipTrigger asChild>
                  {navLink}
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border/80 px-3 py-4">
        <div className="flex flex-col gap-2">
          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <div>
                <ThemeToggle
                  isDark={isDark}
                  onToggle={onToggleTheme}
                  label={isDark ? "Tema claro" : "Tema oscuro"}
                  className="flex h-12 w-full items-center justify-start gap-3 rounded-2xl border border-transparent px-3 text-sidebar-foreground/78 hover:border-white/10 hover:bg-white/10 hover:text-sidebar-foreground"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{isDark ? "Cambiar a claro" : "Cambiar a oscuro"}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  onOpenAccount();
                  onClose?.();
                }}
                className="flex h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 text-sidebar-foreground transition-colors hover:bg-white/12"
                aria-label="Mi cuenta"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={accountLabel}
                      className="h-full w-full object-cover"
                    />
                  ) : initials ? (
                    <span className="text-xs font-black tracking-wide">{initials}</span>
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </span>
                <span className="truncate text-sm font-bold">{accountLabel}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{accountLabel}</TooltipContent>
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
