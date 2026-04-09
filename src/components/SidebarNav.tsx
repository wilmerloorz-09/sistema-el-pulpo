import { UserRound } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import ThemeToggle from "@/components/nav/ThemeToggle";
import { useVisibleNavItems } from "@/components/nav/useVisibleNavItems";

interface SidebarNavProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenAccount: () => void;
}

function getInitials(name?: string | null) {
  const clean = String(name ?? "").trim();
  if (!clean) return null;

  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

const SidebarNav = ({ isDark, onToggleTheme, onOpenAccount }: SidebarNavProps) => {
  const { visibleItems } = useVisibleNavItems();
  const { profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, loading } = useBranch();
  const initials = getInitials(profile?.full_name);
  const accountLabel = profile?.full_name || profile?.username || "Mi cuenta";
  const location = useLocation();
  const cajaTabParam = new URLSearchParams(location.search).get("tab");
  const activeCajaTab =
    location.pathname === "/caja" && (cajaTabParam === "completed" || cajaTabParam === "capture")
      ? cajaTabParam
      : "pending";
  const fromMesas = location.pathname === "/ordenes" && new URLSearchParams(location.search).get("from") === "mesas";

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <aside className="hidden w-[248px] flex-col self-start overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:min-h-screen">
      <div className="shrink-0 border-b border-sidebar-border/80 px-4 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="El Pulpo" className="h-10 w-auto object-contain" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sidebar-foreground/55">Sistema</p>
            <p className="truncate font-display text-lg font-black text-sidebar-foreground">El Pulpo</p>
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
        {visibleItems.map((item) => (
          <div key={item.to}>
            <Tooltip delayDuration={120}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  forceActive={
                    (item.to === "/mesas" && (location.pathname === "/mesas" || fromMesas))
                    || (item.to === "/ordenes" && location.pathname === "/ordenes" && !fromMesas)
                  }
                  suppressActive={item.to === "/ordenes" && fromMesas}
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
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>

            {item.to === "/caja" && location.pathname === "/caja" ? (
              <div className="ml-[3.25rem] mt-1 grid gap-1">
                <NavLink
                  to="/caja"
                  end
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs font-semibold text-sidebar-foreground/60 transition-colors",
                    "hover:bg-white/8 hover:text-sidebar-foreground",
                    activeCajaTab !== "completed" && "bg-white/8 text-sidebar-foreground",
                  )}
                >
                  Por cobrar
                </NavLink>
                <NavLink
                  to="/caja?tab=completed"
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs font-semibold text-sidebar-foreground/60 transition-colors",
                    "hover:bg-white/8 hover:text-sidebar-foreground",
                    activeCajaTab === "completed" && "bg-white/8 text-sidebar-foreground",
                  )}
                >
                  Pagos realizados
                </NavLink>

              </div>
            ) : null}
          </div>
        ))}
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
                onClick={onOpenAccount}
                className="flex h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 text-sidebar-foreground transition-colors hover:bg-white/12"
                aria-label="Mi cuenta"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.full_name}
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
    </aside>
  );
};

export default SidebarNav;
