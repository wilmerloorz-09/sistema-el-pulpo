import { UserRound } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
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
  const initials = getInitials(profile?.full_name);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <aside className="hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border/80 px-2">
        <img src="/logo.png" alt="El Pulpo" className="h-9 w-auto object-contain" />
      </div>

      <nav className="flex flex-1 flex-col items-center gap-2 px-2 py-4">
        {visibleItems.map((item) => (
          <Tooltip key={item.to} delayDuration={120}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                className={cn(
                  "group flex h-12 w-12 items-center justify-center rounded-2xl border border-transparent text-sidebar-foreground/70 transition-all",
                  "hover:border-white/10 hover:bg-white/10 hover:text-sidebar-foreground",
                )}
                activeClassName={cn(
                  "border-white/10 bg-gradient-to-b text-white shadow-[0_16px_35px_-22px_rgba(245,158,11,0.82)]",
                  item.tone.active,
                )}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl transition-transform group-hover:scale-105">
                  {item.icon}
                </span>
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-2 border-t border-sidebar-border/80 px-2 py-4">
        <Tooltip delayDuration={120}>
          <TooltipTrigger asChild>
            <div>
              <ThemeToggle
                isDark={isDark}
                onToggle={onToggleTheme}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-transparent text-sidebar-foreground/75 hover:border-white/10 hover:bg-white/10 hover:text-sidebar-foreground"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{isDark ? "Tema claro" : "Tema oscuro"}</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={120}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenAccount}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sidebar-foreground transition-colors hover:bg-white/12"
              aria-label="Mi cuenta"
            >
              {initials ? (
                <span className="text-sm font-black tracking-wide">{initials}</span>
              ) : (
                <UserRound className="h-5 w-5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Mi cuenta</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
};

export default SidebarNav;
